import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Raw request bodies are stored byte-for-byte so receivers can verify provider signatures. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const deliveryStatus = pgEnum('delivery_status', [
  'pending', // committed by ingest, not yet handed to the queue
  'queued', // enqueued, first attempt not finished yet
  'retrying', // at least one retryable failure, next attempt scheduled
  'succeeded',
  'dead', // permanent failure or attempts exhausted: the dead-letter queue
]);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const destinations = pgTable('destinations', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  /** Standard Webhooks signing secret, `whsec_<base64>`. */
  secret: text('secret').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  maxAttempts: integer('max_attempts').notNull().default(8),
  timeoutMs: integer('timeout_ms').notNull().default(10_000),
  createdAt: createdAt(),
});

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    /** From the provider's `webhook-id` / `Idempotency-Key` header, when present. */
    idempotencyKey: text('idempotency_key'),
    contentType: text('content_type'),
    headers: jsonb('headers').$type<Record<string, string>>().notNull(),
    body: bytea('body').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('events_source_idempotency_key')
      .on(t.sourceId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('events_received_at').on(t.receivedAt),
  ],
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    status: deliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    /** Set when this delivery is a manual replay of an earlier one. */
    replayOf: uuid('replay_of'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    // The relay's hot path: "oldest pending first".
    index('deliveries_pending').on(t.createdAt).where(sql`${t.status} = 'pending'`),
    index('deliveries_status').on(t.status),
    index('deliveries_event').on(t.eventId),
  ],
);

export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    statusCode: integer('status_code'),
    error: text('error'),
    responseSnippet: text('response_snippet'),
  },
  (t) => [index('attempts_delivery').on(t.deliveryId)],
);

export type DeliveryStatus = (typeof deliveryStatus.enumValues)[number];
