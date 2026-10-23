/**
 * A deliberately unreliable webhook receiver for local demos:
 *   /ok      always 200
 *   /flaky   503 with probability FAIL_RATE (default 0.5)
 *   /slow    200 after SLOW_MS (default 3000)
 *   /reject  422, a permanent failure
 * Every request is checked against the Standard Webhooks signature.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4000);
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0.5);
const SLOW_MS = Number(process.env.SLOW_MS ?? 3000);
// Must match DEMO_SECRET in apps/api/src/db/seed.ts.
const SECRET =
  process.env.MOCK_SECRET ??
  `whsec_${Buffer.from('demo-only-secret-do-not-use').toString('base64')}`;

function validSignature(id: string, ts: string, body: Buffer, header: string): boolean {
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const expected = Buffer.from(
    `v1,${createHmac('sha256', key).update(`${id}.${ts}.`).update(body).digest('base64')}`,
  );
  return header.split(' ').some((sig) => {
    const actual = Buffer.from(sig);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

const seen = new Set<string>();

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);

  const id = String(req.headers['webhook-id'] ?? '');
  const ts = String(req.headers['webhook-timestamp'] ?? '');
  const sig = String(req.headers['webhook-signature'] ?? '');
  const signed = validSignature(id, ts, body, sig);
  const duplicate = seen.has(`${req.url}:${id}`);

  const reply = (status: number, extraHeaders: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
    res.end(JSON.stringify({ status, signed, duplicate }));
    const mark = status < 300 ? '✔' : '✘';
    console.log(
      `${mark} ${req.url} ${status} id=${id.slice(0, 8)} signed=${signed}${duplicate ? ' dup' : ''}`,
    );
  };

  if (!signed) return reply(401);

  switch (req.url) {
    case '/ok':
      seen.add(`${req.url}:${id}`);
      return reply(200);
    case '/flaky':
      if (Math.random() < FAIL_RATE) return reply(503);
      seen.add(`${req.url}:${id}`);
      return reply(200);
    case '/slow':
      await new Promise((r) => setTimeout(r, SLOW_MS));
      return reply(200);
    case '/reject':
      return reply(422);
    default:
      return reply(404);
  }
}).listen(PORT, () => console.log(`mock receiver on :${PORT} (flaky fail rate ${FAIL_RATE})`));
