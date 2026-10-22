import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { AttemptsChart } from '../components/AttemptsChart';
import { LaneLegend, LaneStrip } from '../components/LaneStrip';
import { Bar, Button, ErrorBlock, eventStatus, Mono, Panel, Pill } from '../components/ui';
import { api, type Lane, type Overview as OverviewData } from '../lib/api';
import {
  formatAgo,
  formatBytes,
  formatInt,
  formatMs,
  formatPercent,
  formatTime,
  shortId,
} from '../lib/format';
import { href, navigate } from '../lib/router';
import { sampleEvent } from '../lib/sample';

export function Overview() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
    refetchInterval: 3000,
  });
  const sendTest = useMutation({
    mutationFn: () => api.sendTestEvent('demo', sampleEvent()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['overview'] }),
  });
  const data = overview.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-7 font-semibold">Overview</h1>
          <p className="mt-1 max-w-[70ch] text-[15px] text-muted">
            {data ? finding(data) : 'Checking every destination…'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className="hidden text-xs text-muted sm:inline">
              Updated <span className="num">{formatTime(data.generatedAt)}</span>
            </span>
          )}
          <Button onClick={() => sendTest.mutate()} disabled={sendTest.isPending}>
            Send test event
          </Button>
          {data && data.deliveries.dead > 0 && (
            <a
              href={href({ name: 'dead-letters' })}
              className="inline-flex h-8 items-center gap-1.5 rounded-control bg-primary px-3 text-[13px] font-medium text-on-primary hover:opacity-90"
            >
              Review {data.deliveries.dead} dead letters
              <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
            </a>
          )}
        </div>
      </div>

      <HealthStrip data={data} />

      <Panel title="Destinations" aside={<LaneLegend />} flush className="overflow-hidden">
        {overview.isError ? (
          <ErrorBlock what="destinations" onRetry={() => overview.refetch()} />
        ) : (
          <Lanes lanes={data?.lanes} />
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Attempts per minute"
          aside={<span>Last 60 minutes · accepted above the line, failed below</span>}
        >
          {data ? (
            <AttemptsChart data={data.attemptsPerMinute} now={data.generatedAt} />
          ) : (
            <Bar w="100%" h={200} />
          )}
        </Panel>
        <Panel
          title="Latest events"
          aside={
            <a href={href({ name: 'events', filter: 'all' })} className="text-ink hover:underline">
              View all
            </a>
          }
          flush
        >
          <RecentEvents events={data?.recentEvents} />
        </Panel>
      </div>
    </div>
  );
}

/** The one line under the title: the fact that most needs attention right now. */
function finding(data: OverviewData): string {
  // Built from the same lane counts the table shows, so the sentence and the KPI always agree.
  const failing = data.lanes
    .filter((l) => l.deliveries.dead > 0)
    .sort((a, b) => b.deliveries.dead - a.deliveries.dead);
  if (failing.length > 0) {
    const total = failing.reduce((s, l) => s + l.deliveries.dead, 0);
    const parts = failing.map((l) => {
      // "HTTP 503 (gave up after 6 attempts)" reads as "HTTP 503 after 6 attempts" here.
      const reason = (l.lastDeadReason ?? 'errors')
        .replace(/ \(not retryable\)$/, '')
        .replace(/ \(gave up after (\d+) attempts\)$/, ' after $1 attempts');
      return `${l.deliveries.dead} at ${l.name} (${reason})`;
    });
    return `${total} ${total === 1 ? 'delivery has' : 'deliveries have'} given up: ${parts.join(', ')}. They stay parked until you fix the receiver and replay them.`;
  }
  if (data.deliveries.retrying > 0) {
    return `${data.deliveries.retrying} deliveries are being retried. Nothing has been given up on.`;
  }
  if (data.lastHour.events === 0) return 'No webhooks received in the last hour.';
  return `All ${data.lanes.length} destinations accepted every webhook received in the last hour.`;
}

function HealthStrip({ data }: { data: OverviewData | undefined }) {
  const cells = data
    ? [
        {
          label: 'Events received',
          window: 'last hour',
          value: formatInt(data.lastHour.events),
        },
        {
          label: 'Attempt success',
          window: `last hour · ${formatInt(data.lastHour.attempts)} attempts`,
          value: formatPercent(data.lastHour.successRate),
        },
        {
          label: 'Retrying',
          window: 'now',
          value: formatInt(
            data.deliveries.retrying + data.deliveries.queued + data.deliveries.pending,
          ),
        },
        {
          label: 'Dead letters',
          window: 'open, not replayed',
          value: formatInt(data.deliveries.dead),
          bad: data.deliveries.dead > 0,
        },
      ]
    : null;
  return (
    <section
      aria-label="Health"
      className="grid grid-cols-2 overflow-hidden rounded-card border border-border bg-border gap-px lg:grid-cols-4"
    >
      {(cells ?? Array.from({ length: 4 }, () => null)).map((cell, i) => (
        <div key={cell?.label ?? i} className="flex flex-col gap-1 bg-surface px-5 py-4">
          {cell ? (
            <>
              <span className="text-[13px] font-semibold">{cell.label}</span>
              <span className={`num text-[28px] leading-9 ${cell.bad ? 'text-negative' : ''}`}>
                {cell.value}
              </span>
              <span className="text-xs text-muted">{cell.window}</span>
            </>
          ) : (
            <>
              <Bar w={90} h={14} />
              <Bar w={60} h={28} />
              <Bar w={80} h={12} />
            </>
          )}
        </div>
      ))}
    </section>
  );
}

function Lanes({ lanes }: { lanes: Lane[] | undefined }) {
  if (!lanes) {
    return (
      <div className="px-5 pb-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-14 items-center gap-6">
            <Bar w={220} /> <Bar w={180} h={20} />
          </div>
        ))}
      </div>
    );
  }
  if (lanes.length === 0) {
    return (
      <p className="px-5 pb-5 text-sm text-muted">
        No destinations yet.{' '}
        <a className="text-ink underline" href={href({ name: 'destinations' })}>
          Add the first one
        </a>{' '}
        to start forwarding webhooks.
      </p>
    );
  }
  return (
    <>
      {/* Phone: each lane is a two-line row with the strip full width. No field is dropped. */}
      <ul className="sm:hidden">
        {lanes.map((lane) => (
          <li key={lane.id} className="flex flex-col gap-2 border-t border-rule px-5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-medium">{lane.name}</span>
              {lane.deliveries.dead > 0 ? (
                <a
                  href={href({ name: 'dead-letters' })}
                  className="num flex-none text-sm font-medium text-negative"
                >
                  {formatInt(lane.deliveries.dead)} dead
                </a>
              ) : (
                <span className="num flex-none text-sm text-muted">0 dead</span>
              )}
            </div>
            <LaneStrip attempts={lane.recentAttempts} />
            <span className="num text-[13px] text-muted">
              {formatPercent(lane.lastHour.successRate)} success · p95{' '}
              {formatMs(lane.lastHour.p95Ms)} · {formatInt(lane.deliveries.succeeded)} delivered
            </span>
          </li>
        ))}
      </ul>
      <LanesTable lanes={lanes} />
    </>
  );
}

function LanesTable({ lanes }: { lanes: Lane[] }) {
  return (
    <div className="hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="h-9 px-5 font-normal">Destination</th>
            <th className="font-normal">Last 30 attempts</th>
            <th className="px-3 text-right font-normal">Success · 1 h</th>
            <th className="px-3 text-right font-normal">p95 · 1 h</th>
            <th className="px-3 text-right font-normal">Delivered</th>
            <th className="px-5 text-right font-normal">Dead letters</th>
          </tr>
        </thead>
        <tbody>
          {lanes.map((lane) => (
            <tr key={lane.id} className="border-t border-rule">
              <td className="h-14 max-w-[300px] px-5">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{lane.name}</span>
                  {!lane.enabled && <Pill kind="neutral">Paused</Pill>}
                </div>
                <Mono small className="block truncate text-muted">
                  {lane.url}
                </Mono>
              </td>
              <td>
                <LaneStrip attempts={lane.recentAttempts} />
              </td>
              <td className="num px-3 text-right">{formatPercent(lane.lastHour.successRate)}</td>
              <td className="num px-3 text-right">{formatMs(lane.lastHour.p95Ms)}</td>
              <td className="num px-3 text-right">{formatInt(lane.deliveries.succeeded)}</td>
              <td className="num px-5 text-right">
                {lane.deliveries.dead > 0 ? (
                  <a
                    href={href({ name: 'dead-letters' })}
                    className="font-medium text-negative hover:underline"
                    title={lane.lastDeadReason ?? undefined}
                  >
                    {formatInt(lane.deliveries.dead)}
                  </a>
                ) : (
                  <span className="text-muted">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentEvents({ events }: { events: OverviewData['recentEvents'] | undefined }) {
  if (!events) {
    return (
      <div className="px-5 pb-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex h-12 items-center">
            <Bar w="70%" />
          </div>
        ))}
      </div>
    );
  }
  if (events.length === 0) {
    return <p className="px-5 pb-5 text-sm text-muted">Nothing received yet. Send a test event.</p>;
  }
  return (
    <ul className="pb-2">
      {events.slice(0, 5).map((e) => {
        const status = eventStatus(e.deliveries);
        return (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => navigate({ name: 'event', id: e.id })}
              className="flex w-full items-center gap-3 border-t border-rule px-5 py-2.5 text-left hover:bg-raised"
            >
              <span className="min-w-0 flex-1">
                <Mono className="block">{shortId(e.id)}</Mono>
                <span className="block truncate text-xs text-muted">
                  {e.sourceSlug} · {formatBytes(e.size)} · {formatAgo(e.receivedAt)}
                </span>
              </span>
              <Pill kind={status.kind}>{status.label}</Pill>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
