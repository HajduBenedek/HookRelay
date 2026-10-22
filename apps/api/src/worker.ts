import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './app.module.js';
import { loadConfig } from './config.js';

const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(loadConfig()), {
  bufferLogs: true,
});
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
