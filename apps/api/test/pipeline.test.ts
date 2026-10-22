/**
 * End-to-end tests of the whole pipeline against real Postgres and Redis (Testcontainers):
 * HTTP ingest -> transactional outbox -> relay -> BullMQ worker -> a real HTTP receiver.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import { Webhook } from 'standardwebhooks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiApp } from '../src/api-app.js';
import { WorkerModule } from '../src/app.module.js';
import type { Config } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';

const TOKEN = 'integration-test-token';

/** A receiver whose behaviour per path is scripted by each test. */
class Receiver {
  server!: Server;
  url = '';
  received: Array<{ path: string; headers: Record<string, string>; body: Buffer }> = [];
  /** Status codes to answer with, consumed in order; then 200. */
  script = new Map<string, number[]>();
  /** Milliseconds to wait before answering, per path. */
  delays = new Map<string, number>();

  async start() {
    this.server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const path = req.url ?? '/';
      this.received.push({
        path,
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks),
      });
      const status = this.script.get(path)?.shift() ?? 200;
      const delay = this.delays.get(path);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      res.writeHead(status).end(JSON.stringify({ status }));
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  hits(path: string) {
    return this.received.filter((r) => r.path === path);
  }
}

let postgres: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;
let api: NestFastifyApplication;
let worker: INestApplicationContext;
let baseUrl: string;
let pool: pg.Pool;
const receiver = new Receiver();
let sourceId: string;

const admin = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
};

const ingest = (body: string, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}/in/shop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

async function addDestination(name: string, path: string, maxAttempts = 5) {
  return admin<{ id: string; secret: string }>('/api/destinations', {
    method: 'POST',
    body: JSON.stringify({ sourceId, name, url: `${receiver.url}${path}`, maxAttempts }),
  });
}

/** Polls the event until every delivery has settled (succeeded or dead). */
async function settled(eventId: string, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const event = await admin<{
      deliveries: Array<{
        id: string;
        status: string;
        destinationName: string;
        attempts: unknown[];
      }>;
    }>(`/api/events/${eventId}`);
    if (event.deliveries.every((d) => d.status === 'succeeded' || d.status === 'dead'))
      return event;
    if (Date.now() > until)
      throw new Error(`Event ${eventId} did not settle: ${JSON.stringify(event)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  await receiver.start();
  await runMigrations(postgres.getConnectionUri());

  const config: Config = {
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    API_PORT: 0,
    ADMIN_TOKEN: TOKEN,
    WORKER_CONCURRENCY: 10,
    RETRY_BASE_MS: 20,
    RETRY_MAX_MS: 200,
    RELAY_SWEEP_MS: 200,
    INGEST_BODY_LIMIT: 1024 * 1024,
    LOG_LEVEL: 'error',
  };
  api = await createApiApp(config);
  await api.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = await api.getUrl();
  worker = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), {
    logger: false,
  });
  pool = new pg.Pool({ connectionString: config.DATABASE_URL });

  ({ id: sourceId } = await admin<{ id: string }>('/api/sources', {
    method: 'POST',
    body: JSON.stringify({ slug: 'shop', name: 'Test shop' }),
  }));
});

afterAll(async () => {
  await worker?.close();
  await api?.close();
  await pool?.end();
  receiver.server?.close();
  await Promise.all([postgres?.stop(), redis?.stop()]);
});

beforeEach(async () => {
  // Each test starts with no destinations so deliveries do not leak between tests.
  await pool.query('delete from destinations');
  receiver.received = [];
  receiver.script.clear();
  receiver.delays.clear();
});

describe('delivery pipeline', () => {
  it('delivers the exact bytes, signed so the official library verifies them', async () => {
    const { secret } = await addDestination('Orders', '/orders');
    const payload = '{"type":"invoice.paid","amount":4990,"note":"árvíztűrő"}';

    const res = await ingest(payload);
    expect(res.status).toBe(202);
    const { eventId } = (await res.json()) as { eventId: string };
    const event = await settled(eventId);

    expect(event.deliveries[0]?.status).toBe('succeeded');
    const [hit] = receiver.hits('/orders');
    expect(hit?.body.toString()).toBe(payload);
    expect(hit?.headers['webhook-id']).toBe(eventId);
    expect(() => new Webhook(secret).verify(hit?.body ?? '', hit?.headers ?? {})).not.toThrow();
  });

  it('retries 503s with backoff until the receiver recovers', async () => {
    await addDestination('Analytics', '/flaky');
    receiver.script.set('/flaky', [503, 503]);

    const { eventId } = (await (await ingest('{"n":1}')).json()) as { eventId: string };
    const event = await settled(eventId);

    expect(event.deliveries[0]).toMatchObject({ status: 'succeeded' });
    expect(event.deliveries[0]?.attempts).toHaveLength(3);
    expect(receiver.hits('/flaky')).toHaveLength(3);
    // Every retry carries the same webhook-id, so receivers can deduplicate.
    expect(new Set(receiver.hits('/flaky').map((h) => h.headers['webhook-id'])).size).toBe(1);
  });

  it('dead-letters a 422 at once, and a replay delivers it after the receiver is fixed', async () => {
    const destination = await addDestination('CRM', '/crm');
    receiver.script.set('/crm', [422]);

    const { eventId } = (await (await ingest('{"n":2}')).json()) as { eventId: string };
    const event = await settled(eventId);
    expect(event.deliveries[0]).toMatchObject({ status: 'dead' });
    expect(receiver.hits('/crm')).toHaveLength(1);

    const dead = await admin<Array<{ id: string }>>('/api/deliveries?status=dead');
    expect(dead.map((d) => d.id)).toContain(event.deliveries[0]?.id);

    // The receiver now accepts (the script is empty), so the replay succeeds.
    const replay = await admin<{ deliveries: number }>('/api/deliveries/replay-dead', {
      method: 'POST',
      body: JSON.stringify({ destinationId: destination.id }),
    });
    expect(replay.deliveries).toBe(1);
    const after = await settled(eventId);
    expect(after.deliveries.map((d) => d.status)).toEqual(['dead', 'succeeded']);

    // The replayed dead letter no longer counts as open.
    const stillDead = await admin<Array<{ id: string }>>('/api/deliveries?status=dead');
    expect(stillDead.map((d) => d.id)).not.toContain(event.deliveries[0]?.id);
  });

  it('gives up after maxAttempts and parks the delivery', async () => {
    await addDestination('Down', '/down', 3);
    receiver.script.set('/down', [500, 500, 500, 500]);

    const { eventId } = (await (await ingest('{"n":3}')).json()) as { eventId: string };
    const event = await settled(eventId);

    expect(event.deliveries[0]).toMatchObject({ status: 'dead' });
    expect(receiver.hits('/down')).toHaveLength(3);
  });

  it('a second bulk replay does not fan out the same dead letters again', async () => {
    const destination = await addDestination('Strict', '/strict');
    receiver.script.set('/strict', [422, 422, 422]);
    const { eventId } = (await (await ingest('{"n":4}')).json()) as { eventId: string };
    await settled(eventId);

    // Slow the receiver so the first replay is still in flight during the second call;
    // otherwise it could fail again and become a new, legitimately replayable dead letter.
    receiver.delays.set('/strict', 1_500);
    const first = await admin<{ deliveries: number }>('/api/deliveries/replay-dead', {
      method: 'POST',
      body: JSON.stringify({ destinationId: destination.id }),
    });
    const second = await admin<{ deliveries: number }>('/api/deliveries/replay-dead', {
      method: 'POST',
      body: JSON.stringify({ destinationId: destination.id }),
    });
    expect(first.deliveries).toBe(1);
    expect(second.deliveries).toBe(0);
  });
});

describe('ingest', () => {
  it('stores a provider retry with the same webhook-id only once', async () => {
    await addDestination('Orders', '/orders');
    const headers = { 'webhook-id': `evt_${Date.now()}` };

    const first = await ingest('{"n":5}', headers);
    const second = await ingest('{"n":5}', headers);

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    const a = (await first.json()) as { eventId: string };
    const b = (await second.json()) as { eventId: string; duplicate: boolean };
    expect(b).toMatchObject({ eventId: a.eventId, duplicate: true });
    await settled(a.eventId);
    expect(receiver.hits('/orders')).toHaveLength(1);
  });

  it('accepts non-JSON bodies byte for byte', async () => {
    await addDestination('Forms', '/forms');
    const res = await fetch(`${baseUrl}/in/shop`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1&b=%C3%A1',
    });
    const { eventId } = (await res.json()) as { eventId: string };
    await settled(eventId);
    expect(receiver.hits('/forms')[0]?.body.toString()).toBe('a=1&b=%C3%A1');
  });

  it('answers 404 for an unknown source and 401 for the admin API without a token', async () => {
    expect((await fetch(`${baseUrl}/in/nope`, { method: 'POST', body: 'x' })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/stats`)).status).toBe(401);
  });
});

describe('outbox relay', () => {
  it('picks up a pending delivery even if its NOTIFY was lost', async () => {
    const destination = await addDestination('Orders', '/orders');
    // Write an event and a pending delivery behind HookRelay's back: no NOTIFY is sent.
    const { rows } = await pool.query<{ id: string }>(
      `insert into events (source_id, headers, body, content_type)
       values ($1, '{}', convert_to('{"n":6}', 'UTF8'), 'application/json') returning id`,
      [sourceId],
    );
    const eventId = rows[0]?.id ?? '';
    await pool.query('insert into deliveries (event_id, destination_id) values ($1, $2)', [
      eventId,
      destination.id,
    ]);

    const event = await settled(eventId);
    expect(event.deliveries[0]?.status).toBe('succeeded');
  });
});
