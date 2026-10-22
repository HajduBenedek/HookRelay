import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { notifyOutbox } from '../common/outbox.js';
import { DB, type Db } from '../db/db.module.js';
import { deliveries, destinations, events, sources } from '../db/schema.js';

export interface IngestResult {
  eventId: string;
  /** True when the provider re-sent an event we already stored (same idempotency key). */
  duplicate: boolean;
  deliveries: number;
}

/** Headers that would leak credentials into the event log and the dashboard. */
const REDACTED_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key']);

@Injectable()
export class IngestService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async ingest(
    sourceSlug: string,
    rawHeaders: Record<string, string | string[] | undefined>,
    body: Buffer,
  ): Promise<IngestResult> {
    const headers = normalizeHeaders(rawHeaders);
    const idempotencyKey = headers['webhook-id'] ?? headers['idempotency-key'] ?? null;

    return this.db.transaction(async (tx) => {
      const [source] = await tx.select().from(sources).where(eq(sources.slug, sourceSlug));
      if (!source) throw new NotFoundException(`Unknown source "${sourceSlug}"`);

      const [inserted] = await tx
        .insert(events)
        .values({
          sourceId: source.id,
          idempotencyKey,
          contentType: headers['content-type'] ?? null,
          headers,
          body,
        })
        .onConflictDoNothing()
        .returning({ id: events.id });

      if (!inserted) {
        // Only reachable with an idempotency key: the provider retried an event we have.
        const [existing] = await tx
          .select({ id: events.id })
          .from(events)
          .where(
            and(eq(events.sourceId, source.id), eq(events.idempotencyKey, idempotencyKey ?? '')),
          );
        if (!existing) throw new Error('Idempotency conflict without an existing event');
        return { eventId: existing.id, duplicate: true, deliveries: 0 };
      }

      const targets = await tx
        .select({ id: destinations.id })
        .from(destinations)
        .where(and(eq(destinations.sourceId, source.id), eq(destinations.enabled, true)));

      if (targets.length > 0) {
        await tx
          .insert(deliveries)
          .values(targets.map((d) => ({ eventId: inserted.id, destinationId: d.id })));
        await tx.execute(notifyOutbox);
      }
      return { eventId: inserted.id, duplicate: false, deliveries: targets.length };
    });
  }
}

function normalizeHeaders(raw: Record<string, string | string[] | undefined>) {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const key = name.toLowerCase();
    out[key] = REDACTED_HEADERS.has(key)
      ? '[redacted]'
      : Array.isArray(value)
        ? value.join(', ')
        : value;
  }
  return out;
}
