import { eq } from 'drizzle-orm';
import { createDb, createPool } from './db.module.js';
import { destinations, sources } from './schema.js';

/**
 * Demo data for local development. The secret is shared with apps/mock-receiver so it can
 * verify signatures; never reuse it outside local dev.
 */
export const DEMO_SECRET = `whsec_${Buffer.from('demo-only-secret-do-not-use').toString('base64')}`;
const RECEIVER = process.env.MOCK_RECEIVER_URL ?? 'http://localhost:4000';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const pool = createPool(url);
const db = createDb(pool);

const [existing] = await db.select().from(sources).where(eq(sources.slug, 'demo'));
if (existing) {
  console.log('Demo source already exists; nothing to do');
} else {
  const [source] = await db
    .insert(sources)
    .values({ slug: 'demo', name: 'Demo shop (Stripe-style events)' })
    .returning();
  if (!source) throw new Error('Failed to create demo source');
  await db.insert(destinations).values([
    // The mock receiver's path decides how each one behaves: /ok always accepts,
    // /flaky fails half the time with a 503, /reject answers 422.
    { sourceId: source.id, name: 'Orders service', url: `${RECEIVER}/ok`, secret: DEMO_SECRET },
    {
      sourceId: source.id,
      name: 'Analytics',
      url: `${RECEIVER}/flaky`,
      secret: DEMO_SECRET,
      maxAttempts: 6,
    },
    { sourceId: source.id, name: 'Legacy CRM', url: `${RECEIVER}/reject`, secret: DEMO_SECRET },
  ]);
  console.log('Seeded source "demo" with 3 destinations. Send a test event:');
  console.log(
    `  curl -X POST localhost:3000/in/demo -H 'content-type: application/json' -d '{"type":"order.paid","amount":4990}'`,
  );
}
await pool.end();
