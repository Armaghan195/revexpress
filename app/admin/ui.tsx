/**
 * Dashboard building blocks. All server components: the charts are plain SVG
 * rendered on the server, so the portal ships no charting library and the
 * numbers are in the HTML rather than appearing after a client fetch.
 */
import type { ReactNode } from 'react';
import type { BarItem, Stat as StatValue, TrendPoint } from '@/lib/analytics';

export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`p-panel ${className}`}>
      {(title || right) && (
        <header className="p-panel-head">
          {title && <h2 className="p-panel-title">{title}</h2>}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  stat,
  tone,
  note,
}: {
  label: string;
  value: string;
  stat?: StatValue;
  tone?: 'blue' | 'orange';
  note?: string;
}) {
  return (
    <article className="p-stat">
      <div className="p-stat-head">
        <span className="p-stat-label">{label}</span>
        {stat && (
          <span className="p-delta" data-dir={stat.delta.dir}>
            {stat.delta.dir === 'up' ? '▲' : stat.delta.dir === 'down' ? '▼' : '—'} {stat.delta.pct}%
          </span>
        )}
      </div>
      <div className="p-stat-value" data-tone={tone}>
        {value}
      </div>
      {note && <div className="p-stat-note">{note}</div>}
    </article>
  );
}

export function BarList({
  items,
  tone = 'blue',
  empty = 'No data for this period',
}: {
  items: BarItem[];
  tone?: 'blue' | 'orange' | 'gradient' | 'soft';
  empty?: string;
}) {
  if (!items.length) return <p className="p-empty">{empty}</p>;
  // Scale against the largest row so the leader always fills the track.
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <div className="p-barlist">
      {items.map((item, i) => (
        <div key={item.label + i}>
          <div className="p-barrow-top">
            <span className="p-barrow-label" title={item.label}>
              {item.label}
            </span>
            <span className="p-barrow-meta">
              {item.value.toLocaleString()}
              {item.meta ? ` · ${item.meta}` : ''}
            </span>
          </div>
          <div className="p-bartrack">
            <div
              className="p-barfill"
              data-tone={tone}
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Two-series line chart. viewBox scales to the container; strokes stay crisp. */
export function TrendChart({ points, hourly = false }: { points: TrendPoint[]; hourly?: boolean }) {
  if (points.length < 2) return <p className="p-empty">Not enough data yet</p>;

  const W = 1000;
  const H = 260;
  const padL = 34;
  const padB = 26;
  const padT = 10;
  const max = Math.max(...points.flatMap(p => [p.views, p.visitors]), 4);
  // Round the axis up to something readable rather than to the raw maximum.
  const step = Math.pow(10, Math.max(0, String(Math.ceil(max / 4)).length - 1));
  const top = Math.ceil(max / step) * step || 4;

  const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - 6);
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);

  const path = (key: 'views' | 'visitors') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
  const area = (key: 'views' | 'visitors') =>
    `${path(key)} L ${x(points.length - 1).toFixed(1)} ${y(0)} L ${x(0).toFixed(1)} ${y(0)} Z`;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(top * f));
  // Roughly eight labels, whatever the range length.
  const labelEvery = Math.max(1, Math.round(points.length / 8));

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return hourly
      ? `${String(d.getHours()).padStart(2, '0')}:00`
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <svg className="p-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
         aria-label="Traffic trend">
      {gridValues.map(v => (
        <g key={v}>
          <line className="grid" x1={padL} x2={W - 6} y1={y(v)} y2={y(v)} vectorEffect="non-scaling-stroke" />
          <text className="axis" x={4} y={y(v) + 3}>{v}</text>
        </g>
      ))}

      <defs>
        <linearGradient id="fillViews" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b9dff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#5b9dff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fillVisitors" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff9d4d" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#ff9d4d" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area('views')} fill="url(#fillViews)" />
      <path d={area('visitors')} fill="url(#fillVisitors)" />
      <path className="line" d={path('views')} stroke="#5b9dff" vectorEffect="non-scaling-stroke" />
      <path className="line" d={path('visitors')} stroke="#ff9d4d" vectorEffect="non-scaling-stroke" />

      {points.map((p, i) => {
        // Label every nth point, plus the final one -- but drop that final
        // label when it would collide with the previous one and overprint it.
        const isNth = i % labelEvery === 0;
        const isLast = i === points.length - 1;
        const lastCollides = isLast && (points.length - 1) % labelEvery < labelEvery * 0.6;
        if (!isNth && !isLast) return null;
        if (lastCollides && isLast) return null;
        return (
          <text className="axis" key={i} x={x(i)} y={H - 8}
                textAnchor={isLast ? 'end' : i === 0 ? 'start' : 'middle'}>
            {fmt(p.date)}
          </text>
        );
      })}
    </svg>
  );
}

export function ChartLegend() {
  return (
    <div className="p-legend">
      <span><i style={{ background: '#5b9dff' }} />Views</span>
      <span><i style={{ background: '#ff9d4d' }} />Visitors</span>
    </div>
  );
}

/** 636 → "636", 12400 → "12.4K" */
export function compact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return Math.round(n).toLocaleString();
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
