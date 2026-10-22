import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DELIVERY_QUEUE, type DeliveryJob, REDIS } from '../common/queue.module.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Db } from '../db/db.module.js';
import { attempts, deliveries, destinations, events } from '../db/schema.js';
import { send } from './deliverer.js';
import { decide } from './retry-policy.js';

/** Thrown to hand a retryable failure back to BullMQ, carrying our own computed delay. */
export class RetryLater extends Error {
  constructor(
    message: string,
    readonly delayMs: number,
  ) {
    super(message);
  }
}

@Injectable()
export class DeliveryProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DeliveryProcessor.name);
  private worker?: Worker<DeliveryJob>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap() {
    this.worker = new Worker<DeliveryJob>(DELIVERY_QUEUE, (job) => this.process(job), {
      // Workers need their own blocking connection.
      connection: this.redis.duplicate(),
      concurrency: this.config.WORKER_CONCURRENCY,
      settings: {
        // The retry policy already decided the delay; BullMQ only schedules it.
        backoffStrategy: (_attempts, _type, err) =>
          err instanceof RetryLater ? err.delayMs : this.config.RETRY_BASE_MS,
      },
    });
    this.worker.on('error', (err) => this.logger.error(err, 'Worker error'));
  }

  async onApplicationShutdown() {
    // Lets in-flight deliveries finish; anything unfinished is retried by another worker.
    await this.worker?.close();
  }

  async process(job: Job<DeliveryJob>): Promise<void> {
    await this.deliver(job.data.deliveryId, job.attemptsMade + 1);
  }

  /** One attempt for one delivery. Public so tests can drive it without Redis. */
  async deliver(deliveryId: string, attemptNo: number): Promise<void> {
    const [row] = await this.db
      .select({ delivery: deliveries, destination: destinations, event: events })
      .from(deliveries)
      .innerJoin(destinations, eq(destinations.id, deliveries.destinationId))
      .innerJoin(events, eq(events.id, deliveries.eventId))
      .where(eq(deliveries.id, deliveryId));

    if (!row) return; // Deleted (e.g. destination removed) while queued.
    const { delivery, destination, event } = row;
    if (delivery.status === 'succeeded' || delivery.status === 'dead') return;

    const startedAt = new Date();
    const result = await send({
      url: destination.url,
      secret: destination.secret,
      messageId: event.id,
      contentType: event.contentType,
      body: event.body,
      timeoutMs: destination.timeoutMs,
    });
    const outcome = decide(result, attemptNo, {
      baseMs: this.config.RETRY_BASE_MS,
      maxMs: this.config.RETRY_MAX_MS,
      maxAttempts: destination.maxAttempts,
    });

    await this.db.transaction(async (tx) => {
      await tx.insert(attempts).values({
        deliveryId,
        attemptNo,
        startedAt,
        durationMs: result.durationMs,
        statusCode: result.statusCode ?? null,
        error: result.error ?? null,
        responseSnippet: result.responseSnippet ?? null,
      });
      await tx
        .update(deliveries)
        .set({
          attempts: attemptNo,
          lastStatusCode: result.statusCode ?? null,
          lastError: outcome.kind === 'success' ? null : outcome.reason,
          status:
            outcome.kind === 'success'
              ? 'succeeded'
              : outcome.kind === 'dead'
                ? 'dead'
                : 'retrying',
          nextAttemptAt: outcome.kind === 'retry' ? new Date(Date.now() + outcome.delayMs) : null,
          deliveredAt: outcome.kind === 'success' ? new Date() : null,
          updatedAt: sql`now()`,
        })
        .where(eq(deliveries.id, deliveryId));
    });

    if (outcome.kind === 'retry') throw new RetryLater(outcome.reason, outcome.delayMs);
  }
}
