import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq, inArray, sql } from 'drizzle-orm';
import pg from 'pg';
import { OUTBOX_CHANNEL } from '../common/outbox.js';
import type { DeliveryJob } from '../common/queue.module.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Db, PG_POOL } from '../db/db.module.js';
import { deliveries, destinations } from '../db/schema.js';

const BATCH = 200;

/**
 * Moves committed `pending` deliveries into BullMQ (the relay half of the transactional
 * outbox). Woken by LISTEN/NOTIFY for low latency, with a periodic sweep as the safety net.
 */
@Injectable()
export class RelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RelayService.name);
  private listener?: pg.PoolClient;
  private sweepTimer?: NodeJS.Timeout;
  private running: Promise<void> | null = null;
  private rerun = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(CONFIG) private readonly config: Config,
    private readonly queue: Queue<DeliveryJob>,
  ) {}

  async onApplicationBootstrap() {
    this.listener = await this.pool.connect();
    this.listener.on('notification', () => void this.trigger());
    await this.listener.query(`LISTEN ${OUTBOX_CHANNEL}`);
    this.sweepTimer = setInterval(() => void this.trigger(), this.config.RELAY_SWEEP_MS);
    await this.trigger();
  }

  async onApplicationShutdown() {
    clearInterval(this.sweepTimer);
    await this.running;
    this.listener?.release();
  }

  /** Coalesces bursts of notifications into back-to-back drains, never concurrent ones. */
  trigger(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerun = false;
        try {
          while ((await this.drainBatch()) === BATCH) {}
        } catch (error) {
          this.logger.error(error, 'Relay drain failed; will retry on next sweep');
        }
      } while (this.rerun);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Returns how many deliveries were handed to the queue. */
  async drainBatch(): Promise<number> {
    return this.db.transaction(async (tx) => {
      // SKIP LOCKED lets several worker processes drain in parallel without double-claiming.
      const claimed = await tx
        .select({ id: deliveries.id, maxAttempts: destinations.maxAttempts })
        .from(deliveries)
        .innerJoin(destinations, eq(destinations.id, deliveries.destinationId))
        .where(eq(deliveries.status, 'pending'))
        .orderBy(deliveries.createdAt)
        .limit(BATCH)
        .for('update', { of: deliveries, skipLocked: true });
      if (claimed.length === 0) return 0;

      // jobId = delivery id: if we crash after enqueueing but before the update commits,
      // the next sweep re-adds the same ids and BullMQ ignores the duplicates.
      await this.queue.addBulk(
        claimed.map((d) => ({
          name: 'deliver',
          data: { deliveryId: d.id },
          opts: {
            jobId: d.id,
            attempts: d.maxAttempts,
            backoff: { type: 'policy' },
            removeOnComplete: { age: 3600, count: 10_000 },
            removeOnFail: { age: 24 * 3600 },
          },
        })),
      );
      await tx
        .update(deliveries)
        .set({ status: 'queued', updatedAt: sql`now()` })
        .where(
          inArray(
            deliveries.id,
            claimed.map((d) => d.id),
          ),
        );
      return claimed.length;
    });
  }
}
