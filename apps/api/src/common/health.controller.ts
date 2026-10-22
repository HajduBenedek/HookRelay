import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import pg from 'pg';
import { PG_POOL } from '../db/db.module.js';
import { REDIS } from './queue.module.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Readiness: ingest needs Postgres; the queue needs Redis. */
  @Get()
  async check() {
    const [db, redis] = await Promise.allSettled([this.pool.query('select 1'), this.redis.ping()]);
    const status = { postgres: db.status === 'fulfilled', redis: redis.status === 'fulfilled' };
    if (!status.postgres || !status.redis) throw new ServiceUnavailableException(status);
    return status;
  }
}
