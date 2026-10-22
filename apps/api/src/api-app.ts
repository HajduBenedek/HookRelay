import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { ApiModule } from './app.module.js';
import type { Config } from './config.js';

const JSON_TYPE = /^application\/(.+\+)?json/i;

export async function createApiApp(config: Config): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ bodyLimit: config.INGEST_BODY_LIMIT });
  const app = await NestFactory.create<NestFastifyApplication>(ApiModule.forRoot(config), adapter, {
    bodyParser: false,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // Ingest must see the exact bytes the provider sent (provider signatures are computed over
  // them), so /in/* bodies stay Buffers whatever the content type. Admin routes get JSON.
  const fastify = app.getHttpAdapter().getInstance();
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (req, body, done) => {
    const raw = body as Buffer;
    if (req.url.startsWith('/in/') || !JSON_TYPE.test(req.headers['content-type'] ?? '')) {
      return done(null, raw);
    }
    try {
      done(null, raw.length === 0 ? {} : JSON.parse(raw.toString('utf8')));
    } catch {
      done(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }), undefined);
    }
  });

  return app;
}
