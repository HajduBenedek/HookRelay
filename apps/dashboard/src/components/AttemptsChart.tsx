import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Overview } from '../lib/api';

const PAD = { top: 12, right: 8, bottom: 24, left: 36 };
const MINUTES = 60;

/**
 * Attempts per minute over the last hour as diverging columns on one scale: accepted above
 * the zero line in the data hue, failed below it in the negative colour.
 * Drawn at the container's real pixel width so axis text stays 11px on every screen.
 */
export function AttemptsChart({
  data,
  now,
  height = 236,
}: {
  data: Overview['attemptsPerMinute'];
  now: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setW(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const H = W < 480 ? 180 : height;
  const { bins, top, ticks, labels } = useMemo(() => build(data, now, W < 480), [data, now, W]);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const zeroY = PAD.top + plotH / 2;
  const scale = (v: number) => (v / top) * (plotH / 2);
  const step = plotW / MINUTES;
  const barW = Math.max(2, step - 2);

  return (
    <div ref={ref}>
      <svg width={W} height={H} className="block" role="img" aria-label={describe(bins)}>
        {ticks.map((t) => {
          const y = zeroY - scale(t);
          return (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
                stroke="var(--grid)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--muted)"
                className="num"
              >
                {t > 0 ? `+${t}` : t < 0 ? `−${-t}` : '0'}
              </text>
            </g>
          );
        })}
        {bins.map((b, i) => {
          const x = PAD.left + i * step + (step - barW) / 2;
          return (
            <g key={b.minute}>
              {b.ok > 0 && (
                <rect
                  x={x}
                  y={zeroY - scale(b.ok)}
                  width={barW}
                  height={scale(b.ok)}
                  fill="var(--chart-1)"
                >
                  <title>{`${b.label} · ${b.ok} accepted`}</title>
                </rect>
              )}
              {b.failed > 0 && (
                <rect x={x} y={zeroY} width={barW} height={scale(b.failed)} fill="var(--negative)">
                  <title>{`${b.label} · ${b.failed} failed`}</title>
                </rect>
              )}
            </g>
          );
        })}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--muted)"
          strokeWidth={1}
        />
        {labels.map((l) => (
          <text
            key={l.label}
            x={PAD.left + l.index * step + step / 2}
            y={H - 6}
            textAnchor={l.index === 0 ? 'start' : l.index >= MINUTES - 1 ? 'end' : 'middle'}
            fontSize={11}
            fill="var(--muted)"
            className="num"
          >
            {l.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

function build(data: Overview['attemptsPerMinute'], now: string, narrow: boolean) {
  const end = new Date(now);
  end.setSeconds(0, 0);
  const byMinute = new Map(data.map((d) => [new Date(d.minute).getTime(), d]));
  const hhmm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const bins = Array.from({ length: MINUTES }, (_, i) => {
    const t = new Date(end.getTime() - (MINUTES - 1 - i) * 60_000);
    const row = byMinute.get(t.getTime());
    return { minute: t.toISOString(), label: hhmm(t), ok: row?.ok ?? 0, failed: row?.failed ?? 0 };
  });

  const max = Math.max(1, ...bins.map((b) => Math.max(b.ok, b.failed)));
  const stepSize = niceStep(max);
  const top = stepSize * Math.ceil((max + 0.0001) / stepSize);
  const ticks: number[] = [];
  for (let v = top; v >= -top; v -= stepSize) ticks.push(v);

  // Labels on one step ending at the current minute: every 15 min, every 30 on a phone.
  const at = narrow ? [0, 29, 59] : [0, 14, 29, 44, 59];
  const labels = at.map((index) => ({ index, label: bins[index]?.label ?? '' }));
  return { bins, top, ticks, labels };
}

/** 1, 2 or 5 times a power of ten, giving 2-3 gridlines on each side of zero. */
function niceStep(max: number) {
  const raw = max / 2;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow);
}

function describe(bins: Array<{ ok: number; failed: number }>) {
  const ok = bins.reduce((s, b) => s + b.ok, 0);
  const failed = bins.reduce((s, b) => s + b.failed, 0);
  return `Last 60 minutes: ${ok} attempts accepted, ${failed} failed`;
}
