import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { notifyOutbox } from '../common/outbox.js';
import { DB, type Db } from '../db/db.module.js';
import {
  attempts,
  type DeliveryStatus,
  deliveries,
  destinations,
  events,
  sources,
} from '../db/schema.js';
import { generateSecret } from '../delivery/signature.js';

const BODY_PREVIEW_BYTES = 16 * 1024;

export type EventFilter = 'all' | 'attention' | 'delivered';

/**
 * True for a delivery that has been replayed at least once. The outer column is written out
 * in full: Drizzle renders `${deliveries.id}` unqualified in single-table queries, which
 * would silently bind to the subquery's own `id`.
 */
const replayed = sql`exists (select 1 from deliveries r where r.replay_of = "deliveries"."id")`;

@Injectable()
export class AdminService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async stats() {
    // A dead letter stops counting once someone has replayed it; the replay has its own row.
    const byStatus = await this.db
      .select({ status: deliveries.status, count: sql<number>`count(*)::int` })
      .from(deliveries)
      .where(sql`not (${deliveries.status} = 'dead' and ${replayed})`)
      .groupBy(deliveries.status);

    const [lastHour] = await this.db
      .execute<{
        events: number;
        attempts: number;
        p50: number | null;
        p95: number | null;
        success_rate: number | null;
      }>(sql`
      select
        (select count(*)::int from ${events} where received_at > now() - interval '1 hour') as events,
        count(*)::int as attempts,
        percentile_cont(0.5) within group (order by duration_ms) as p50,
        percentile_cont(0.95) within group (order by duration_ms) as p95,
        avg(case when status_code between 200 and 299 then 1.0 else 0.0 end) as success_rate
      from ${attempts}
      where started_at > now() - interval '1 hour'
    `)
      .then((r) => r.rows);

    const counts = Object.fromEntries(byStatus.map((r) => [r.status, r.count])) as Partial<
      Record<DeliveryStatus, number>
    >;
    return {
      deliveries: {
        pending: counts.pending ?? 0,
        queued: counts.queued ?? 0,
        retrying: counts.retrying ?? 0,
        succeeded: counts.succeeded ?? 0,
        dead: counts.dead ?? 0,
      },
      lastHour: {
        events: lastHour?.events ?? 0,
        attempts: lastHour?.attempts ?? 0,
        p50Ms:
          lastHour?.p50 === null || lastHour?.p50 === undefined ? null : Math.round(lastHour.p50),
        p95Ms:
          lastHour?.p95 === null || lastHour?.p95 === undefined ? null : Math.round(lastHour.p95),
        successRate: lastHour?.success_rate === null ? null : Number(lastHour?.success_rate),
      },
    };
  }

  /**
   * Everything the overview screen needs in one round trip: per-destination "lanes" with
   * their latest attempts, and attempts per minute for the last hour.
   */
  async overview() {
    const stats = await this.stats();

    const lanes = await this.db
      .execute<{
        id: string;
        name: string;
        url: string;
        enabled: boolean;
        max_attempts: number;
        succeeded: number;
        retrying: number;
        in_flight: number;
        dead: number;
        attempts_1h: number;
        success_rate_1h: number | null;
        p95_ms_1h: number | null;
        last_dead_reason: string | null;
        recent: Array<{ at: string; code: number | null; ok: boolean }> | null;
      }>(sql`
      select d.id, d.name, d.url, d.enabled, d.max_attempts,
        count(*) filter (where dl.status = 'succeeded')::int as succeeded,
        count(*) filter (where dl.status = 'retrying')::int as retrying,
        count(*) filter (where dl.status in ('pending', 'queued'))::int as in_flight,
        count(*) filter (where dl.status = 'dead' and not exists (
          select 1 from ${deliveries} r where r.replay_of = dl.id))::int as dead,
        (select count(*)::int from ${attempts} a join ${deliveries} x on x.id = a.delivery_id
          where x.destination_id = d.id and a.started_at > now() - interval '1 hour') as attempts_1h,
        (select avg(case when a.status_code between 200 and 299 then 1.0 else 0.0 end)
          from ${attempts} a join ${deliveries} x on x.id = a.delivery_id
          where x.destination_id = d.id and a.started_at > now() - interval '1 hour') as success_rate_1h,
        (select percentile_cont(0.95) within group (order by a.duration_ms)
          from ${attempts} a join ${deliveries} x on x.id = a.delivery_id
          where x.destination_id = d.id and a.started_at > now() - interval '1 hour') as p95_ms_1h,
        (select x.last_error from ${deliveries} x
          where x.destination_id = d.id and x.status = 'dead'
          order by x.updated_at desc limit 1) as last_dead_reason,
        (select json_agg(r order by r.at) from (
          select a.started_at as at, a.status_code as code,
            coalesce(a.status_code between 200 and 299, false) as ok
          from ${attempts} a join ${deliveries} x on x.id = a.delivery_id
          where x.destination_id = d.id order by a.started_at desc limit 30) r) as recent
      from ${destinations} d
      left join ${deliveries} dl on dl.destination_id = d.id
      group by d.id
      order by d.created_at
    `)
      .then((r) => r.rows);

    const perMinute = await this.db
      .execute<{ minute: string; ok: number; failed: number }>(sql`
      select to_char(date_trunc('minute', started_at), 'YYYY-MM-DD"T"HH24:MI:00"Z"') as minute,
        count(*) filter (where status_code between 200 and 299)::int as ok,
        count(*) filter (where status_code is null or status_code not between 200 and 299)::int as failed
      from ${attempts}
      where started_at > date_trunc('minute', now()) - interval '59 minutes'
      group by 1 order by 1
    `)
      .then((r) => r.rows);

    const recentEvents = await this.listEvents(6);

    return {
      generatedAt: new Date().toISOString(),
      ...stats,
      lanes: lanes.map((l) => ({
        id: l.id,
        name: l.name,
        url: l.url,
        enabled: l.enabled,
        maxAttempts: l.max_attempts,
        deliveries: {
          succeeded: l.succeeded,
          retrying: l.retrying,
          inFlight: l.in_flight,
          dead: l.dead,
        },
        lastHour: {
          attempts: l.attempts_1h,
          successRate: l.success_rate_1h === null ? null : Number(l.success_rate_1h),
          p95Ms: l.p95_ms_1h === null ? null : Math.round(Number(l.p95_ms_1h)),
        },
        lastDeadReason: l.last_dead_reason,
        recentAttempts: l.recent ?? [],
      })),
      attemptsPerMinute: perMinute,
      recentEvents: recentEvents.items,
    };
  }

  /** Bulk replay of the dead-letter queue, optionally for one destination. */
  async replayDead(destinationId?: string) {
    return this.db.transaction(async (tx) => {
      const dead = await tx
        .select({
          id: deliveries.id,
          eventId: deliveries.eventId,
          destinationId: deliveries.destinationId,
        })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.status, 'dead'),
            destinationId ? eq(deliveries.destinationId, destinationId) : undefined,
            // Skip dead letters that already have a replay, so a double click does not fan out.
            sql`not ${replayed}`,
          ),
        );
      if (dead.length === 0) return { deliveries: 0 };
      await tx
        .insert(deliveries)
        .values(
          dead.map((d) => ({ eventId: d.eventId, destinationId: d.destinationId, replayOf: d.id })),
        );
      await tx.execute(notifyOutbox);
      return { deliveries: dead.length };
    });
  }

  listSources() {
    return this.db.select().from(sources).orderBy(asc(sources.createdAt));
  }

  async createSource(input: { slug: string; name: string }) {
    const [source] = await this.db.insert(sources).values(input).returning();
    return source;
  }

  listDestinations() {
    return this.db
      .select({
        id: destinations.id,
        sourceId: destinations.sourceId,
        name: destinations.name,
        url: destinations.url,
        enabled: destinations.enabled,
        maxAttempts: destinations.maxAttempts,
        timeoutMs: destinations.timeoutMs,
        createdAt: destinations.createdAt,
      })
      .from(destinations)
      .orderBy(asc(destinations.createdAt));
  }

  /** The only time the signing secret is returned: the receiver needs it to verify. */
  async createDestination(input: {
    sourceId: string;
    name: string;
    url: string;
    maxAttempts?: number | undefined;
    timeoutMs?: number | undefined;
  }) {
    const [destination] = await this.db
      .insert(destinations)
      .values({ ...stripUndefined(input), secret: generateSecret() })
      .returning();
    return destination;
  }

  async setDestinationEnabled(id: string, enabled: boolean) {
    const [updated] = await this.db
      .update(destinations)
      .set({ enabled })
      .where(eq(destinations.id, id))
      .returning({ id: destinations.id, enabled: destinations.enabled });
    if (!updated) throw new NotFoundException();
    return updated;
  }

  /** Newest first, keyset-paginated by `received_at` so deep pages stay fast. */
  async listEvents(limit: number, before?: string, filter: EventFilter = 'all') {
    const needsAttention = sql`exists (select 1 from deliveries x where x.event_id = ${events.id}
      and (x.status in ('retrying', 'pending', 'queued')
        or (x.status = 'dead' and not exists (select 1 from deliveries r where r.replay_of = x.id))))`;
    const rows = await this.db
      .select({
        id: events.id,
        sourceSlug: sources.slug,
        contentType: events.contentType,
        receivedAt: events.receivedAt,
        size: sql<number>`octet_length(${events.body})::int`,
      })
      .from(events)
      .innerJoin(sources, eq(sources.id, events.sourceId))
      .where(
        and(
          before ? lt(events.receivedAt, new Date(before)) : undefined,
          filter === 'attention' ? needsAttention : undefined,
          filter === 'delivered' ? sql`not ${needsAttention}` : undefined,
        ),
      )
      .orderBy(desc(events.receivedAt))
      .limit(limit);

    const statuses = rows.length
      ? await this.db
          .select({
            eventId: deliveries.eventId,
            status: deliveries.status,
            count: sql<number>`count(*)::int`,
          })
          .from(deliveries)
          .where(
            and(
              inArray(
                deliveries.eventId,
                rows.map((r) => r.id),
              ),
              // A replayed dead letter is superseded by its replay; count only the latest.
              sql`not (${deliveries.status} = 'dead' and ${replayed})`,
            ),
          )
          .groupBy(deliveries.eventId, deliveries.status)
      : [];

    return {
      items: rows.map((r) => ({
        ...r,
        deliveries: Object.fromEntries(
          statuses.filter((s) => s.eventId === r.id).map((s) => [s.status, s.count]),
        ),
      })),
      nextCursor: rows.length === limit ? rows.at(-1)?.receivedAt.toISOString() : null,
    };
  }

  async getEvent(id: string) {
    const [event] = await this.db
      .select({ event: events, sourceSlug: sources.slug })
      .from(events)
      .innerJoin(sources, eq(sources.id, events.sourceId))
      .where(eq(events.id, id));
    if (!event) throw new NotFoundException();

    const deliveryRows = await this.db
      .select({ delivery: deliveries, destinationName: destinations.name, url: destinations.url })
      .from(deliveries)
      .innerJoin(destinations, eq(destinations.id, deliveries.destinationId))
      .where(eq(deliveries.eventId, id))
      .orderBy(asc(deliveries.createdAt));

    const attemptRows = deliveryRows.length
      ? await this.db
          .select()
          .from(attempts)
          .where(
            inArray(
              attempts.deliveryId,
              deliveryRows.map((d) => d.delivery.id),
            ),
          )
          .orderBy(asc(attempts.attemptNo))
      : [];

    const { body, ...meta } = event.event;
    return {
      ...meta,
      sourceSlug: event.sourceSlug,
      size: body.length,
      bodyPreview: body.subarray(0, BODY_PREVIEW_BYTES).toString('utf8'),
      truncated: body.length > BODY_PREVIEW_BYTES,
      deliveries: deliveryRows.map(({ delivery, destinationName, url }) => ({
        ...delivery,
        destinationName,
        url,
        attempts: attemptRows.filter((a) => a.deliveryId === delivery.id),
      })),
    };
  }

  listDeliveries(status: DeliveryStatus, limit: number) {
    return this.db
      .select({
        id: deliveries.id,
        eventId: deliveries.eventId,
        status: deliveries.status,
        attempts: deliveries.attempts,
        lastStatusCode: deliveries.lastStatusCode,
        lastError: deliveries.lastError,
        updatedAt: deliveries.updatedAt,
        destinationId: deliveries.destinationId,
        destinationName: destinations.name,
        url: destinations.url,
      })
      .from(deliveries)
      .innerJoin(destinations, eq(destinations.id, deliveries.destinationId))
      .where(
        and(eq(deliveries.status, status), status === 'dead' ? sql`not ${replayed}` : undefined),
      )
      .orderBy(desc(deliveries.updatedAt))
      .limit(limit);
  }

  /** Replays append a new delivery, so the history of the original stays intact. */
  async replayDelivery(id: string) {
    return this.db.transaction(async (tx) => {
      const [original] = await tx.select().from(deliveries).where(eq(deliveries.id, id));
      if (!original) throw new NotFoundException();
      const [replay] = await tx
        .insert(deliveries)
        .values({
          eventId: original.eventId,
          destinationId: original.destinationId,
          replayOf: original.id,
        })
        .returning({ id: deliveries.id });
      await tx.execute(notifyOutbox);
      return replay;
    });
  }

  async replayEvent(id: string) {
    return this.db.transaction(async (tx) => {
      const [event] = await tx
        .select({ id: events.id, sourceId: events.sourceId })
        .from(events)
        .where(eq(events.id, id));
      if (!event) throw new NotFoundException();
      const targets = await tx
        .select({ id: destinations.id })
        .from(destinations)
        .where(and(eq(destinations.sourceId, event.sourceId), eq(destinations.enabled, true)));
      if (targets.length === 0) return { deliveries: 0 };
      await tx
        .insert(deliveries)
        .values(targets.map((d) => ({ eventId: id, destinationId: d.id })));
      await tx.execute(notifyOutbox);
      return { deliveries: targets.length };
    });
  }
}

function stripUndefined<T extends object>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]-?: Exclude<T[K], undefined>;
  };
}
