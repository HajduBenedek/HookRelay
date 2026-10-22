import { type DynamicModule, Global, Module } from '@nestjs/common';
import { CONFIG, type Config, loadConfig } from '../config.js';

@Global()
@Module({})
export class ConfigModule {
  /** Pass a config explicitly in tests; otherwise it is read from the environment. */
  static forRoot(config: Config = loadConfig()): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}
