import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { LaneStrip } from '../components/LaneStrip';
import { Bar, Button, EmptyRow, ErrorBlock, Mono, Panel, Pill } from '../components/ui';
import { api, type DeadLetter, type Lane } from '../lib/api';
import { formatAgo, formatInt, formatPercent, shortId } from '../lib/format';
import { href } from '../lib/router';

export function DeadLetters() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['dead-letters'],
    queryFn: api.deadLetters,
    refetchInterval: 3000,
  });
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
    refetchInterval: 3000,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['dead-letters'] });
    queryClient.invalidateQueries({ queryKey: ['overview'] });
  };
  const replayAll = useMutation({
    mutationFn: (destinationId?: string) => api.replayDead(destinationId),
    onSuccess: refresh,
  });
  const replayOne = useMutation({
    mutationFn: (id: string) => api.replayDelivery(id),
    onSuccess: refresh,
  });

  const rows = query.data ?? [];
  const groups = groupByDestination(rows);
  const lanes = new Map((overview.data?.lanes ?? []).map((l) => [l.id, l]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] leading-7 font-semibold">Dead letters</h1>
          <p className="mt-1 max-w-[70ch] text-[15px] text-muted">
            {query.data
              ? rows.length === 0
                ? 'Nothing is parked. Every delivery either succeeded or is still being retried.'
                : `${formatInt(rows.length)} ${rows.length === 1 ? 'delivery' : 'deliveries'} gave up. Fix the receiver first, then replay: a replay sends the same webhook-id, so idempotent receivers will not double-process.`
              : 'Loading…'}
          </p>
        </div>
        {rows.length > 0 && (
          <Button
            variant="primary"
            onClick={() => replayAll.mutate(undefined)}
            disabled={replayAll.isPending}
          >
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
            Replay all {formatInt(rows.length)}
          </Button>
        )}
      </div>

      {query.isError && <ErrorBlock what="dead letters" onRetry={() => query.refetch()} />}
      {query.isPending && <Bar w="100%" h={160} />}
      {query.data && rows.length === 0 && (
        <EmptyRow>
          No dead letters. Deliveries that are still retrying show on the overview.
        </EmptyRow>
      )}

      {groups.length > 0 && (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-8 lg:col-span-2">
            {groups.map(([destination, items]) => (
              <section key={destination.id} className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">
                    {destination.name}{' '}
                    <span className="num font-normal text-muted">· {formatInt(items.length)}</span>
                  </h2>
                  <Button
                    variant="ghost"
                    onClick={() => replayAll.mutate(destination.id)}
                    disabled={replayAll.isPending}
                  >
                    {items.length === 1 ? 'Replay it' : `Replay these ${formatInt(items.length)}`}
                  </Button>
                </div>
                <Mono small className="mb-2 truncate text-muted">
                  {destination.url}
                </Mono>
                {/* Phone: two-line rows, every field kept, the action at the right. */}
                <ul className="sm:hidden">
                  {items.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 border-t border-rule py-2.5">
                      <span className="min-w-0 flex-1">
                        <a href={href({ name: 'event', id: d.eventId })}>
                          <Mono>{shortId(d.eventId)}</Mono>
                        </a>
                        <span className="block text-[13px] text-muted">
                          {d.lastError ?? '—'} · {d.attempts}{' '}
                          {d.attempts === 1 ? 'attempt' : 'attempts'} · {formatAgo(d.updatedAt)}
                        </span>
                      </span>
                      <Button onClick={() => replayOne.mutate(d.id)} disabled={replayOne.isPending}>
                        Replay
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="h-9 w-28 font-normal">Event</th>
                        <th className="font-normal">Why it gave up</th>
                        <th className="w-20 px-3 text-right font-normal">Attempts</th>
                        <th className="w-28 px-3 text-right font-normal">Gave up</th>
                        <th className="w-20" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((d) => (
                        <tr key={d.id} className="border-t border-rule">
                          <td className="h-12">
                            <a
                              href={href({ name: 'event', id: d.eventId })}
                              className="hover:underline"
                            >
                              <Mono>{shortId(d.eventId)}</Mono>
                            </a>
                          </td>
                          <td className="max-w-0 truncate pr-3">{d.lastError ?? '—'}</td>
                          <td className="num px-3 text-right">{d.attempts}</td>
                          <td className="num px-3 text-right whitespace-nowrap">
                            {formatAgo(d.updatedAt)}
                          </td>
                          <td className="text-right">
                            <Button
                              onClick={() => replayOne.mutate(d.id)}
                              disabled={replayOne.isPending}
                            >
                              Replay
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>

          <Panel title="Is the receiver accepting again?" className="lg:sticky lg:top-6">
            <p className="mb-4 text-sm text-muted">
              Replaying into a receiver that still fails only parks the event again. Each lane shows
              that destination's latest attempts, newest on the right.
            </p>
            <ul className="flex flex-col">
              {groups.map(([destination]) => (
                <ReceiverCheck
                  key={destination.id}
                  name={destination.name}
                  lane={lanes.get(destination.id)}
                />
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}

function ReceiverCheck({ name, lane }: { name: string; lane: Lane | undefined }) {
  const last = lane?.recentAttempts.at(-1);
  const verdict = !last
    ? { kind: 'neutral' as const, label: 'No attempts' }
    : last.ok
      ? { kind: 'positive' as const, label: 'Accepting' }
      : { kind: 'negative' as const, label: `Still failing${last.code ? ` · ${last.code}` : ''}` };
  return (
    <li className="flex flex-col gap-2 border-t border-rule py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{name}</span>
        <Pill kind={verdict.kind}>{verdict.label}</Pill>
      </div>
      {lane ? <LaneStrip attempts={lane.recentAttempts} /> : <Bar w="100%" h={20} />}
      <span className="num text-xs text-muted">
        {lane
          ? `${formatPercent(lane.lastHour.successRate)} of attempts accepted in the last hour`
          : ' '}
      </span>
    </li>
  );
}

function groupByDestination(rows: DeadLetter[]) {
  const map = new Map<string, [{ id: string; name: string; url: string }, DeadLetter[]]>();
  for (const row of rows) {
    const entry = map.get(row.destinationId) ?? [
      { id: row.destinationId, name: row.destinationName, url: row.url },
      [],
    ];
    entry[1].push(row);
    map.set(row.destinationId, entry);
  }
  return [...map.values()];
}
