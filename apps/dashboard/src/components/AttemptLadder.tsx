import type { Attempt } from '../lib/api';
import { attemptKind, formatGap, formatMs, formatTime } from '../lib/format';
import { laneColours } from './LaneStrip';
import { Mono } from './ui';

/**
 * Every attempt of one delivery on a shared time axis that starts when the event arrived,
 * so the backoff between attempts is visible as distance, then the attempts as rows.
 */
export function AttemptLadder({
  attempts,
  receivedAt,
}: {
  attempts: Attempt[];
  receivedAt: string;
}) {
  if (attempts.length === 0) {
    return <p className="text-sm text-muted">Not attempted yet: queued for the next worker.</p>;
  }
  const start = new Date(receivedAt).getTime();
  const last = attempts.at(-1);
  const end = last ? new Date(last.startedAt).getTime() + last.durationMs : start;
  const span = Math.max(end - start, 1);

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative h-6"
        role="img"
        aria-label={`${attempts.length} attempts over ${formatGap(span).slice(1)}`}
      >
        <div className="absolute top-1/2 right-0 left-0 h-px bg-border" />
        {attempts.map((a) => {
          const at = new Date(a.startedAt).getTime() - start;
          const kind = attemptKind(
            a.statusCode,
            a.statusCode !== null && a.statusCode < 300 && a.statusCode >= 200,
          );
          return (
            <span
              key={a.id}
              title={`Attempt ${a.attemptNo} at ${formatTime(a.startedAt)}`}
              className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-[1px]"
              style={{ left: `${(at / span) * 100}%`, background: laneColours[kind] }}
            />
          );
        })}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="h-8 w-16 pr-4 text-right font-normal">Attempt</th>
            <th className="w-24 font-normal">Sent</th>
            <th
              className="w-28 font-normal"
              title="Time since the event arrived, then the backoff before each retry"
            >
              Waited
            </th>
            <th className="w-20 font-normal">Response</th>
            <th className="w-20 px-3 text-right font-normal">Took</th>
            <th className="font-normal">Detail</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a, i) => {
            const prev = attempts[i - 1];
            const after = prev
              ? new Date(a.startedAt).getTime() -
                (new Date(prev.startedAt).getTime() + prev.durationMs)
              : new Date(a.startedAt).getTime() - start;
            const ok = a.statusCode !== null && a.statusCode >= 200 && a.statusCode < 300;
            return (
              <tr key={a.id} className="border-t border-rule align-top">
                <td className="num py-2 pr-4 text-right">{a.attemptNo}</td>
                <td className="num py-2">{formatTime(a.startedAt)}</td>
                <td className="num py-2 whitespace-nowrap text-muted">
                  {formatGap(after)}
                  {i > 0 && <span className="text-xs"> backoff</span>}
                </td>
                <td className="py-2">
                  <Mono className={ok ? 'text-positive' : 'text-negative'}>
                    {a.statusCode ?? 'none'}
                  </Mono>
                </td>
                <td className="num px-3 py-2 text-right">{formatMs(a.durationMs)}</td>
                <td className="max-w-0 py-2">
                  <Mono small className="block truncate text-muted">
                    {a.error ?? (a.responseSnippet || '—')}
                  </Mono>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
