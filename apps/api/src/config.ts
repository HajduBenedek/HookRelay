import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(3000),
  ADMIN_TOKEN: z.string().min(8, 'ADMIN_TOKEN must be at least 8 characters'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(20),
  /** Base delay of the exponential retry backoff. Tests shrink it to keep runs fast. */
  RETRY_BASE_MS: z.coerce.number().int().positive().default(1_000),
  RETRY_MAX_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 60_000),
  /** How often the outbox relay sweeps for pending deliveries in case a NOTIFY was missed. */
  RELAY_SWEEP_MS: z.coerce.number().int().positive().default(1_000),
  INGEST_BODY_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof schema>;

export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
