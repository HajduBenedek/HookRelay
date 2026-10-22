import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { CONFIG, type Config } from '../config.js';

export const DELIVERY_QUEUE = 'deliveries';
export const REDIS = Symbol('REDIS');

export interface DeliveryJob {
  deliveryId: string;
}

export function createRedis(url: string): Redis {
  // BullMQ workers block on Redis; ioredis must not give up on those commands.
  return new Redis(url, { maxRetriesPerRequest: null });
}

@Global()
@Module({
  providers: [
    { provide: REDIS, inject: [CONFIG], useFactory: (c: Config) => createRedis(c.REDIS_URL) },
    {
      provide: Queue,
      inject: [REDIS],
      useFactory: (connection: Redis) => new Queue<DeliveryJob>(DELIVERY_QUEUE, { connection }),
    },
  ],
  exports: [REDIS, Queue],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    private readonly queue: Queue,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown() {
    await this.queue.close();
    this.redis.disconnect();
  }
}
