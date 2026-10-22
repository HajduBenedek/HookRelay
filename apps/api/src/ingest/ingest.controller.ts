import { Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IngestService } from './ingest.service.js';

@Controller('in')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  /**
   * Accepts any content type. `202` means the event is committed to Postgres and will be
   * delivered; `200` means it is a duplicate of an event already accepted.
   */
  @Post(':source')
  @HttpCode(202)
  async receive(
    @Param('source') source: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = await this.ingest.ingest(source, req.headers, body);
    if (result.duplicate) reply.status(200);
    return result;
  }
}
