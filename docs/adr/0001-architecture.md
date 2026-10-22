# ADR 0001: Architecture and delivery semantics

- Status: accepted
- Date: 2026-10-22

## Context

HookRelay sits between webhook providers (Stripe, Barion, GitHub, ...) and your services.
Providers retry for a while and then give up; your service may be down, slow or mid-deploy
exactly then. HookRelay accepts the webhook immediately, stores it durably, and keeps
delivering it to one or more destinations until they accept it or it is parked for a human.

## Decisions

### Processes

- **api** (NestJS on Fastify): ingest endpoint `POST /in/:source` and the admin REST API.
  Stateless; scale horizontally.
- **worker**: the outbox relay and the BullMQ delivery workers. Scale horizontally; Postgres
  row locks and BullMQ job ids keep them from stepping on each other.
- **PostgreSQL** is the source of truth. **Redis** (BullMQ) is only a scheduling layer: it can
  be wiped without losing an event.

### Transactional outbox

Ingest writes the event and one `deliveries` row per enabled destination in **one
transaction**, then `NOTIFY`s the worker. The relay claims `pending` rows with
`FOR UPDATE SKIP LOCKED`, enqueues a BullMQ job whose id is the delivery id, and marks the
row `queued`. If the relay crashes between enqueue and update, the next sweep enqueues the
same job id again and BullMQ drops the duplicate. A 1-second sweep backs up `LISTEN/NOTIFY`,
so a lost notification only costs latency.

Result: **at-least-once** delivery. A `202` from ingest means the event is committed.

### Delivery and retries

- Requests are signed per the [Standard Webhooks](https://www.standardwebhooks.com/) spec
  (`webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256>`), so
  receivers can verify and deduplicate with off-the-shelf libraries.
- Retry on network errors, timeouts, `408`, `429` and `5xx`, with full-jitter exponential
  backoff (1 s base, 10 min cap). `Retry-After` from the receiver wins when present.
- Other `4xx` responses are treated as permanent: the receiver rejected the payload, and
  retrying will not change its mind. The delivery goes straight to `dead`.
- After `max_attempts` (default 8, per destination) a delivery becomes `dead`: the
  dead-letter queue is a status, not a separate store, so it is queryable and replayable.
- Every attempt is recorded (status code, duration, error, first 2 KB of the response).

### Idempotent ingest

If the provider sends `webhook-id` or `Idempotency-Key`, `(source, key)` is unique: a provider
retry of an event we already have returns `200` with the original event id instead of
creating a duplicate.

### Replay

Replaying creates a **new** delivery row for the same event and destination. History stays
append-only, so "what happened to this webhook" always has a complete answer.

## Consequences

- Receivers must be idempotent (they get `webhook-id` to make that easy).
- Ordering is not guaranteed across events. Per-destination FIFO is on the roadmap.
- Two moving parts (Postgres + Redis) instead of one. Accepted because BullMQ gives
  battle-tested scheduling, rate limiting and observability hooks for free.
