import type { Lane } from '../lib/api';
import { attemptKind, formatTime } from '../lib/format';

const TICKS = 30;

export const laneColours = {
  ok: 'var(--chart-1)',
  retried: 'var(--chart-3)',
  rejected: 'var(--negative)',
} as const;

/**
 * The signature element: a destination's last 30 attempts as ticks, oldest on the left.
 * Empty slots stay drawn as faint ticks, so a new destination reads as "few attempts",
 * not as a short strip.
 */
export function LaneStrip({ attempts }: { attempts: Lane['recentAttempts'] }) {
  // The strip has 30 fixed positions; the position is each tick's identity.
  const slots = Array.from({ length: TICKS }, (_, position) => ({
    position,
    attempt: attempts[attempts.length - TICKS + position],
  }));
  return (
    <div className="flex h-5 items-stretch gap-[3px]" role="img" aria-label={summarize(attempts)}>
      {slots.map(({ position, attempt: a }) => {
        if (!a) return <span key={position} className="w-1 rounded-[1px] bg-raised" />;
        const kind = attemptKind(a.code, a.ok);
        return (
          <span
            key={position}
            title={`${formatTime(a.at)} · ${a.code ?? 'no response'}`}
            className="w-1 rounded-[1px]"
            style={{ background: laneColours[kind] }}
          />
        );
      })}
    </div>
  );
}

/** Legend built from the same colours as the ticks, so each swatch is the mark it explains. */
export function LaneLegend() {
  const items: Array<[keyof typeof laneColours, string]> = [
    ['ok', 'Accepted'],
    ['retried', 'Failed, retried'],
    ['rejected', 'Rejected'],
  ];
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map(([kind, label]) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span className="h-3 w-1 rounded-[1px]" style={{ background: laneColours[kind] }} />
          {label}
        </span>
      ))}
    </span>
  );
}

function summarize(attempts: Lane['recentAttempts']) {
  if (attempts.length === 0) return 'No attempts yet';
  const ok = attempts.filter((a) => a.ok).length;
  return `${ok} of the last ${attempts.length} attempts accepted`;
}
