import { sql } from 'drizzle-orm';

/** Postgres channel the relay LISTENs on. NOTIFY inside a transaction fires on commit. */
export const OUTBOX_CHANNEL = 'hookrelay_outbox';

export const notifyOutbox = sql`select pg_notify(${OUTBOX_CHANNEL}, '')`;
