import { useInfiniteQuery } from '@tanstack/react-query';
import { Bar, Button, EmptyRow, ErrorBlock, eventStatus, Mono, Pill } from '../components/ui';
import { api, type EventFilter } from '../lib/api';
import { formatBytes, formatDateTime, formatInt, shortId } from '../lib/format';
import { href, navigate } from '../lib/router';

const TABS: Array<{ filter: EventFilter; label: string }> = [
  { filter: 'all', label: 'All events' },
  { filter: 'attention', label: 'Needs attention' },
  { filter: 'delivered', label: 'Delivered' },
];

const EMPTY: Record<EventFilter, string> = {
  all: 'No events received yet. Point a provider at /in/demo, or send a test event from the overview.',
  attention: 'Nothing needs attention: every event reached all of its destinations.',
  delivered: 'No event has reached all of its destinations yet.',
};

export function Events({ filter }: { filter: EventFilter }) {
  const query = useInfiniteQuery({
    queryKey: ['events', filter],
    queryFn: ({ pageParam }) => api.events(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 5000,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] leading-7 font-semibold">Events</h1>
        <p className="mt-1 text-[15px] text-muted">
          Every webhook HookRelay accepted, newest first, with where each one got to.
        </p>
      </div>

      <nav aria-label="Filter events" className="flex gap-6 overflow-x-auto border-b border-border">
        {TABS.map((tab) => {
          const active = tab.filter === filter;
          return (
            <a
              key={tab.filter}
              href={href({ name: 'events', filter: tab.filter })}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px flex h-9 flex-none items-center border-b-2 text-sm ${
                active
                  ? 'border-ink font-semibold text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {tab.label}
            </a>
          );
        })}
      </nav>

      {query.isError ? (
        <ErrorBlock what="events" onRetry={() => query.refetch()} />
      ) : (
        <>
          <p className="text-xs text-muted">
            {query.isPending
              ? 'Loading…'
              : `${formatInt(rows.length)}${query.hasNextPage ? '+' : ''} events`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="h-9 w-[34%] font-normal">Event</th>
                  <th className="font-normal">Source</th>
                  <th className="font-normal">Content type</th>
                  <th className="px-3 text-right font-normal">Size</th>
                  <th className="px-3 text-right font-normal">Received</th>
                  <th className="pl-3 text-right font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {query.isPending &&
                  [0, 1, 2, 3, 4].map((i) => (
                    <tr key={i} className="border-t border-rule">
                      <td className="h-12" colSpan={6}>
                        <Bar w="60%" />
                      </td>
                    </tr>
                  ))}
                {rows.map((e) => {
                  const status = eventStatus(e.deliveries);
                  return (
                    <tr
                      key={e.id}
                      className="cursor-pointer border-t border-rule hover:bg-raised"
                      onClick={() => navigate({ name: 'event', id: e.id })}
                    >
                      <td className="h-12">
                        <a
                          href={href({ name: 'event', id: e.id })}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <Mono>{shortId(e.id)}</Mono>
                          <Mono className="text-muted">{e.id.slice(8, 13)}…</Mono>
                        </a>
                      </td>
                      <td>{e.sourceSlug}</td>
                      <td>
                        <Mono className="text-muted">{e.contentType ?? '—'}</Mono>
                      </td>
                      <td className="num px-3 text-right">{formatBytes(e.size)}</td>
                      <td className="num px-3 text-right whitespace-nowrap">
                        {formatDateTime(e.receivedAt)}
                      </td>
                      <td className="pl-3 text-right">
                        <Pill kind={status.kind}>{status.label}</Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!query.isPending && rows.length === 0 && <EmptyRow>{EMPTY[filter]}</EmptyRow>}
          {query.hasNextPage && (
            <div>
              <Button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage ? 'Loading…' : 'Load 50 more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
