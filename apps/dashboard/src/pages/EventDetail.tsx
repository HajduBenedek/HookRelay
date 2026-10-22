import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { AttemptLadder } from '../components/AttemptLadder';
import { Bar, Button, deliveryPill, ErrorBlock, Mono, Panel, Pill } from '../components/ui';
import { ApiError, api, type EventDelivery } from '../lib/api';
import { formatBytes, formatDateTime, formatTime } from '../lib/format';
import { href } from '../lib/router';

export function EventDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const event = useQuery({
    queryKey: ['event', id],
    queryFn: () => api.event(id),
    // Poll while anything is still moving; stop once every delivery has settled.
    refetchInterval: (q) =>
      q.state.data?.deliveries.some((d) => d.status !== 'succeeded' && d.status !== 'dead')
        ? 1500
        : false,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['event', id] });
    queryClient.invalidateQueries({ queryKey: ['overview'] });
  };
  const replayAll = useMutation({ mutationFn: () => api.replayEvent(id), onSuccess: invalidate });

  const data = event.data;
  const notFound = event.error instanceof ApiError && event.error.status === 404;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <a
            href={href({ name: 'events', filter: 'all' })}
            className="text-sm text-muted hover:text-ink"
          >
            Events
          </a>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[22px] leading-7 font-semibold">
            Event <span className="font-mono text-[20px] font-medium">{id.slice(0, 8)}</span>
            <CopyId id={id} />
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            {data ? (
              <>
                Received <span className="num">{formatDateTime(data.receivedAt)}</span> on{' '}
                <Mono>/in/{data.sourceSlug}</Mono> · {data.contentType ?? 'no content type'} ·{' '}
                {formatBytes(data.size)}
                {data.idempotencyKey && (
                  <>
                    {' '}
                    · webhook-id <Mono>{data.idempotencyKey}</Mono>
                  </>
                )}
              </>
            ) : notFound ? (
              'No event with this id.'
            ) : (
              <Bar w={360} />
            )}
          </p>
        </div>
        {data && data.deliveries.length > 0 && (
          <Button
            variant="primary"
            onClick={() => replayAll.mutate()}
            disabled={replayAll.isPending}
          >
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
            Replay to all destinations
          </Button>
        )}
      </div>

      {event.isError && !notFound && (
        <ErrorBlock what="this event" onRetry={() => event.refetch()} />
      )}

      {data && (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            {data.deliveries.length === 0 && (
              <Panel title="Deliveries">
                <p className="text-sm text-muted">
                  This source had no enabled destinations when the event arrived.
                </p>
              </Panel>
            )}
            {data.deliveries.map((d) => (
              <DeliveryCard
                key={d.id}
                delivery={d}
                receivedAt={data.receivedAt}
                onReplayed={invalidate}
              />
            ))}
          </div>
          <Panel title="Payload" aside={data.truncated ? <span>First 16 KB</span> : undefined}>
            <pre className="max-h-[420px] overflow-auto rounded-control bg-raised p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
              {pretty(data.bodyPreview, data.contentType)}
            </pre>
            <h3 className="mt-5 mb-2 text-[13px] font-semibold">Headers</h3>
            <dl className="flex flex-col">
              {Object.entries(data.headers).map(([name, value]) => (
                <div key={name} className="flex gap-3 border-t border-rule py-1.5 text-xs">
                  <dt className="w-[42%] flex-none truncate font-mono text-muted">{name}</dt>
                  <dd className="min-w-0 truncate font-mono">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      )}
    </div>
  );
}

function DeliveryCard({
  delivery,
  receivedAt,
  onReplayed,
}: {
  delivery: EventDelivery;
  receivedAt: string;
  onReplayed: () => void;
}) {
  const replay = useMutation({
    mutationFn: () => api.replayDelivery(delivery.id),
    onSuccess: onReplayed,
  });
  const pill = deliveryPill[delivery.status];
  const settled = delivery.status === 'succeeded' || delivery.status === 'dead';
  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          {delivery.destinationName}
          <Pill kind={pill.kind}>{pill.label}</Pill>
          {delivery.replayOf && <span className="text-xs font-normal text-muted">replay</span>}
        </span>
      }
      aside={
        <>
          {delivery.status === 'retrying' && delivery.nextAttemptAt && (
            <span>
              Next attempt <span className="num">{formatTime(delivery.nextAttemptAt)}</span>
            </span>
          )}
          {settled && (
            <Button onClick={() => replay.mutate()} disabled={replay.isPending}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
              Replay
            </Button>
          )}
        </>
      }
    >
      <Mono small className="mb-3 block truncate text-muted">
        POST {delivery.url}
      </Mono>
      {delivery.status === 'dead' && delivery.lastError && (
        <p className="mb-3 text-sm">
          <span className="font-medium text-negative">Gave up:</span> {delivery.lastError}
        </p>
      )}
      <AttemptLadder attempts={delivery.attempts} receivedAt={receivedAt} />
    </Panel>
  );
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="grid size-7 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
      aria-label="Copy event id"
      onClick={async () => {
        await navigator.clipboard.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} strokeWidth={1.5} />}
    </button>
  );
}

function pretty(body: string, contentType: string | null) {
  if (contentType?.includes('json')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // Not valid JSON despite the header: show it as received.
    }
  }
  return body || '(empty body)';
}
