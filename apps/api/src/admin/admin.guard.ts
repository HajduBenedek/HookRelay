import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CONFIG, type Config } from '../config.js';

/** Single shared bearer token. Enough for a self-hosted admin API; SSO is on the roadmap. */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(@Inject(CONFIG) config: Config) {
    this.expected = Buffer.from(`Bearer ${config.ADMIN_TOKEN}`);
  }

  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<FastifyRequest>().headers.authorization ?? '';
    const actual = Buffer.from(header);
    if (actual.length !== this.expected.length || !timingSafeEqual(actual, this.expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
