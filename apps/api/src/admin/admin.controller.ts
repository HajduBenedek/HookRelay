import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { deliveryStatus } from '../db/schema.js';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';

const uuid = new ZodPipe(z.string().uuid());

const createSource = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'lowercase letters, digits and dashes'),
  name: z.string().min(1).max(100),
});

const createDestination = z.object({
  sourceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//.test(u), 'http(s) URLs only'),
  maxAttempts: z.number().int().min(1).max(25).optional(),
  timeoutMs: z.number().int().min(100).max(60_000).optional(),
});

const listEvents = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime({ offset: true }).optional(),
  filter: z.enum(['all', 'attention', 'delivered']).default('all'),
});

const listDeliveries = z.object({
  status: z.enum(deliveryStatus.enumValues).default('dead'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('api')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Post('deliveries/replay-dead')
  replayDead(
    @Body(new ZodPipe(z.object({ destinationId: z.string().uuid().optional() })))
    body: { destinationId?: string | undefined },
  ) {
    return this.admin.replayDead(body.destinationId);
  }

  @Get('sources')
  listSources() {
    return this.admin.listSources();
  }

  @Post('sources')
  createSource(@Body(new ZodPipe(createSource)) body: z.infer<typeof createSource>) {
    return this.admin.createSource(body);
  }

  @Get('destinations')
  listDestinations() {
    return this.admin.listDestinations();
  }

  @Post('destinations')
  createDestination(@Body(new ZodPipe(createDestination)) body: z.infer<typeof createDestination>) {
    return this.admin.createDestination(body);
  }

  @Patch('destinations/:id')
  setEnabled(
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(z.object({ enabled: z.boolean() }))) body: { enabled: boolean },
  ) {
    return this.admin.setDestinationEnabled(id, body.enabled);
  }

  @Get('events')
  listEvents(@Query(new ZodPipe(listEvents)) query: z.infer<typeof listEvents>) {
    return this.admin.listEvents(query.limit, query.before, query.filter);
  }

  @Get('events/:id')
  getEvent(@Param('id', uuid) id: string) {
    return this.admin.getEvent(id);
  }

  @Post('events/:id/replay')
  replayEvent(@Param('id', uuid) id: string) {
    return this.admin.replayEvent(id);
  }

  @Get('deliveries')
  listDeliveries(@Query(new ZodPipe(listDeliveries)) query: z.infer<typeof listDeliveries>) {
    return this.admin.listDeliveries(query.status, query.limit);
  }

  @Post('deliveries/:id/replay')
  replayDelivery(@Param('id', uuid) id: string) {
    return this.admin.replayDelivery(id);
  }
}
