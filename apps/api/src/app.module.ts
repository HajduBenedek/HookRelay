import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AdminController } from './admin/admin.controller.js';
import { AdminGuard } from './admin/admin.guard.js';
import { AdminService } from './admin/admin.service.js';
import { ConfigModule } from './common/config.module.js';
import { HealthController } from './common/health.controller.js';
import { QueueModule } from './common/queue.module.js';
import { type Config, loadConfig } from './config.js';
import { DbModule } from './db/db.module.js';
import { DeliveryProcessor } from './delivery/delivery.processor.js';
import { RelayService } from './delivery/relay.service.js';
import { IngestController } from './ingest/ingest.controller.js';
import { IngestService } from './ingest/ingest.service.js';

function infrastructure(config: Config) {
  // Human-readable logs in local development only; JSON everywhere else (prod, CI, tests).
  const pretty = !['production', 'test'].includes(process.env.NODE_ENV ?? '');
  return [
    ConfigModule.forRoot(config),
    LoggerModule.forRoot({
      pinoHttp: {
        level: config.LOG_LEVEL,
        ...(pretty
          ? {
              transport: {
                target: 'pino-pretty',
                options: { singleLine: true, ignore: 'pid,hostname' },
              },
            }
          : {}),
        // One compact line per request. Webhook bodies and headers are never logged.
        serializers: {
          req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        autoLogging: { ignore: (req) => req.url === '/health' },
      },
    }),
    DbModule,
    QueueModule,
  ];
}

/** HTTP process: ingest + admin API. */
@Module({})
export class ApiModule {
  static forRoot(config: Config = loadConfig()): DynamicModule {
    return {
      module: ApiModule,
      imports: infrastructure(config),
      controllers: [IngestController, AdminController, HealthController],
      providers: [IngestService, AdminService, AdminGuard],
    };
  }
}

/** Background process: outbox relay + delivery workers. */
@Module({})
export class WorkerModule {
  static forRoot(config: Config = loadConfig()): DynamicModule {
    return {
      module: WorkerModule,
      imports: infrastructure(config),
      providers: [RelayService, DeliveryProcessor],
    };
  }
}
