/** Typed client for the HookRelay admin API. Types mirror apps/api/src/admin/admin.service.ts. */

export type DeliveryStatus = 'pending' | 'queued' | 'retrying' | 'succeeded' | 'dead';

export interface Lane {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  maxAttempts: number;
  deliveries: { succeeded: number; retrying: number; inFlight: number; dead: number };
  lastHour: { attempts: number; successRate: number | null; p95Ms: number | null };
  lastDeadReason: string | null;
  recentAttempts: Array<{ at: string; code: number | null; ok: boolean }>;
}

export interface EventSummary {
  id: string;
  sourceSlug: string;
  contentType: string | null;
  receivedAt: string;
  size: number;
  deliveries: Partial<Record<DeliveryStatus, number>>;
}

export interface Overview {
  generatedAt: string;
  deliveries: Record<DeliveryStatus, number>;
  lastHour: {
    events: number;
    attempts: number;
    p50Ms: number | null;
    p95Ms: number | null;
    successRate: number | null;
  };
  lanes: Lane[];
  attemptsPerMinute: Array<{ minute: string; ok: number; failed: number }>;
  recentEvents: EventSummary[];
}

export interface Attempt {
  id: string;
  attemptNo: number;
  startedAt: string;
  durationMs: number;
  statusCode: number | null;
  error: string | null;
  responseSnippet: string | null;
}

export interface EventDelivery {
  id: string;
  destinationId: string;
  destinationName: string;
  url: string;
  status: DeliveryStatus;
  attempts: Attempt[];
  lastError: string | null;
  nextAttemptAt: string | null;
  replayOf: string | null;
  createdAt: string;
}

export interface EventDetail {
  id: string;
  sourceSlug: string;
  idempotencyKey: string | null;
  contentType: string | null;
  headers: Record<string, string>;
  receivedAt: string;
  size: number;
  bodyPreview: string;
  truncated: boolean;
  deliveries: EventDelivery[];
}

export interface DeadLetter {
  id: string;
  eventId: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  updatedAt: string;
  destinationId: string;
  destinationName: string;
  url: string;
}

export interface Destination {
  id: string;
  sourceId: string;
  name: string;
  url: string;
  enabled: boolean;
  maxAttempts: number;
  timeoutMs: number;
  createdAt: string;
}

export interface Source {
  id: string;
  slug: string;
  name: string;
}

export type EventFilter = 'all' | 'attention' | 'delivered';

// Local development default; set VITE_ADMIN_TOKEN for anything else.
const TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? 'dev-admin-token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.message ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  overview: () => request<Overview>('/api/overview'),
  events: (filter: EventFilter, before?: string) =>
    request<{ items: EventSummary[]; nextCursor: string | null }>(
      `/api/events?limit=50&filter=${filter}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    ),
  event: (id: string) => request<EventDetail>(`/api/events/${id}`),
  replayEvent: (id: string) =>
    request<{ deliveries: number }>(`/api/events/${id}/replay`, { method: 'POST' }),
  deadLetters: () => request<DeadLetter[]>('/api/deliveries?status=dead&limit=200'),
  replayDelivery: (id: string) =>
    request<{ id: string }>(`/api/deliveries/${id}/replay`, { method: 'POST' }),
  replayDead: (destinationId?: string) =>
    request<{ deliveries: number }>('/api/deliveries/replay-dead', {
      method: 'POST',
      body: JSON.stringify(destinationId ? { destinationId } : {}),
    }),
  destinations: () => request<Destination[]>('/api/destinations'),
  sources: () => request<Source[]>('/api/sources'),
  createDestination: (input: {
    sourceId: string;
    name: string;
    url: string;
    maxAttempts?: number;
  }) =>
    request<Destination & { secret: string }>('/api/destinations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  setEnabled: (id: string, enabled: boolean) =>
    request<{ id: string; enabled: boolean }>(`/api/destinations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  /** Ingest is public: this is what a provider would send. */
  sendTestEvent: async (source: string, payload: unknown) => {
    const response = await fetch(`/in/${source}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new ApiError(response.status, `Ingest returned ${response.status}`);
    return response.json() as Promise<{ eventId: string; deliveries: number }>;
  },
};
