import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { percent } from "../lib/date";
import type { HabitStat, TrendWeek, WeekdayBucket } from "../lib/types";
import { AnimatedNumber, cx, habitColor } from "./ui";

/** Charts size to their container rather than a fixed width. */
function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/* ------------------------------------------------------------------- framing */

export function ChartFrame({
  title,
  subtitle,
  children,
  table,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  table?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="card p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
      {table && (
        <details className="mt-3 border-t border-rule pt-2">
          <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink">
            Show the numbers
          </summary>
          <div className="mt-2 overflow-x-auto">{table}</div>
        </details>
      )}
    </section>
  );
}

export function DataTable({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="text-ink-faint">
          {head.map((cell) => (
            <th key={cell} className="py-1 pr-4 font-medium">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="text-ink-soft">
        {rows.map((row, i) => (
          <tr key={i} className="border-t border-rule">
            {row.map((cell, j) => (
              <td key={j} className="py-1 pr-4">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* --------------------------------------------------------------- stat tiles */

export function StatTile({
  label,
  value,
  numeric,
  format,
  detail,
  delta,
}: {
  label: string;
  value: string;
  /** Supply the raw figure to have it count up when it changes. */
  numeric?: number;
  format?: (n: number) => string;
  detail?: string;
  delta?: number;
}) {
  const rising = (delta ?? 0) > 0;
  const flat = delta === undefined || Math.abs(delta) < 0.005;

  return (
    <div className="card px-4 py-3.5">
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-1.5 font-display text-[28px] leading-none text-ink">
        {numeric === undefined ? (
          value
        ) : (
          <AnimatedNumber value={numeric} format={format} />
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2 text-xs">
        {detail && <span className="text-ink-faint">{detail}</span>}
        {!flat && (
          <span
            className={cx(
              "tnum font-medium",
              rising ? "text-accent-ink" : "text-fire-ink",
            )}
          >
            {rising ? "▲" : "▼"} {Math.abs((delta ?? 0) * 100).toFixed(0)} pts
          </span>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- trend (line) */

export function TrendChart({ weeks: allWeeks }: { weeks: TrendWeek[] }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  // Weeks before a habit existed asked for nothing, so they have no rate. Plotting
  // them as 0% would draw a flat failure across a period that never happened.
  const weeks = allWeeks.filter((week) => week.expected > 0);

  const height = 190;
  const pad = { top: 12, right: 10, bottom: 24, left: 36 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const x = useCallback(
    (i: number) =>
      pad.left + (weeks.length <= 1 ? plotW / 2 : (i / (weeks.length - 1)) * plotW),
    [plotW, weeks.length, pad.left],
  );
  const y = useCallback(
    (rate: number) => pad.top + (1 - rate) * plotH,
    [plotH, pad.top],
  );

  if (!weeks.length)
    return (
      <div
        ref={ref}
        style={{ height }}
        className="flex items-center justify-center text-sm text-ink-faint"
      >
        Not enough history yet.
      </div>
    );

  // The final week is usually still running, so it is drawn as a dashed tail:
  // a dip there is missing days, not a real decline.
  const settled = weeks.filter((w) => !w.partial);
  const solidPath = settled.map((w, i) => `${i ? "L" : "M"}${x(i)},${y(w.rate)}`).join(" ");
  const tailPath =
    settled.length < weeks.length && settled.length > 0
      ? `M${x(settled.length - 1)},${y(weeks[settled.length - 1].rate)} L${x(
          weeks.length - 1,
        )},${y(weeks[weeks.length - 1].rate)}`
      : "";

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const local = event.clientX - box.left - pad.left;
    const step = weeks.length <= 1 ? plotW : plotW / (weeks.length - 1);
    const index = Math.round(local / step);
    setHover(index >= 0 && index < weeks.length ? index : null);
  };

  const active = hover !== null ? weeks[hover] : null;

  return (
    <div ref={ref} className="relative">
      <svg
        width="100%"
        height={height}
        role="img"
        aria-label="Weekly completion rate over time"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="touch-none"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--rule)"
              strokeWidth="1"
            />
            <text
              x={pad.left - 7}
              y={y(tick) + 3.5}
              textAnchor="end"
              className="tnum"
              fontSize="10"
              fill="var(--ink-faint)"
            >
              {tick * 100}
            </text>
          </g>
        ))}

        {active && (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={pad.top}
            y2={pad.top + plotH}
            stroke="var(--rule-strong)"
            strokeWidth="1"
          />
        )}

        {solidPath && (
          <path
            d={solidPath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {tailPath && (
          <path
            d={tailPath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="3 3"
            opacity="0.75"
          />
        )}

        {/* Only the newest point and the hovered one get a marker. */}
        {weeks.map((week, i) =>
          i === weeks.length - 1 || i === hover ? (
            <circle
              key={week.week_start}
              cx={x(i)}
              cy={y(week.rate)}
              r="4.5"
              fill="var(--accent)"
              stroke="var(--surface)"
              strokeWidth="2"
            />
          ) : null,
        )}

        {weeks.map((week, i) => {
          const last = i === weeks.length - 1;
          const stride = Math.ceil(weeks.length / 6);
          // Skip a tick that would collide with the pinned final label.
          if (!last && (i % stride !== 0 || weeks.length - 1 - i < stride))
            return null;
          return (
            <text
              key={week.week_start}
              x={last ? width - pad.right : i === 0 ? pad.left : x(i)}
              y={height - 7}
              textAnchor={last ? "end" : i === 0 ? "start" : "middle"}
              fontSize="10"
              fill="var(--ink-faint)"
            >
              {week.label}
            </text>
          );
        })}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border border-rule-strong bg-surface px-2.5 py-1.5 text-xs shadow-pop"
          style={{
            left: Math.min(Math.max(x(hover!), 60), Math.max(width - 60, 60)),
          }}
        >
          <div className="font-medium text-ink">Week of {active.label}</div>
          <div className="tnum text-ink-soft">
            {percent(active.rate)} · {active.completed}/{active.expected}
            {active.partial && " so far"}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ weekday (bars) */

/** A bar rounded only at the data end, so it stays anchored to the baseline. */
function roundedTop(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return [
    `M${x},${y + h}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + w - r},${y}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join(" ");
}

export function WeekdayChart({ buckets }: { buckets: WeekdayBucket[] }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const height = 170;
  const pad = { top: 18, right: 4, bottom: 22, left: 4 };
  const plotH = height - pad.top - pad.bottom;
  const plotW = Math.max(0, width - pad.left - pad.right);
  const slot = plotW / Math.max(1, buckets.length);
  const barWidth = Math.min(44, Math.max(8, slot - 8));

  const best = Math.max(...buckets.map((b) => b.rate), 0);

  return (
    <div ref={ref} className="relative">
      <svg
        width="100%"
        height={height}
        role="img"
        aria-label="Completion rate by day of the week"
      >
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--rule-strong)"
          strokeWidth="1"
        />

        {buckets.map((bucket, i) => {
          const barHeight = Math.max(bucket.rate > 0 ? 3 : 0, bucket.rate * plotH);
          const cx0 = pad.left + i * slot + (slot - barWidth) / 2;
          const top = pad.top + plotH - barHeight;
          const isBest = bucket.rate === best && best > 0;

          return (
            <g
              key={bucket.weekday}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            >
              {/* A full-height hit area, so the pointer target is not the bar. */}
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={plotH}
                fill="transparent"
              />
              <path
                d={roundedTop(cx0, top, barWidth, barHeight)}
                fill="var(--accent)"
                opacity={hover === null || hover === i ? (isBest ? 1 : 0.78) : 0.4}
              />
              <text
                x={cx0 + barWidth / 2}
                y={top - 6}
                textAnchor="middle"
                fontSize="10"
                className="tnum"
                fill={isBest ? "var(--ink)" : "var(--ink-faint)"}
                fontWeight={isBest ? 600 : 400}
              >
                {Math.round(bucket.rate * 100)}
              </text>
              <text
                x={cx0 + barWidth / 2}
                y={height - 7}
                textAnchor="middle"
                fontSize="10"
                fill="var(--ink-faint)"
              >
                {bucket.short}
              </text>
            </g>
          );
        })}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-md border border-rule-strong bg-surface px-2.5 py-1.5 text-xs shadow-pop"
          style={{
            left: Math.min(
              Math.max(pad.left + hover * slot + slot / 2, 55),
              Math.max(width - 55, 55),
            ),
          }}
        >
          <div className="font-medium text-ink">{buckets[hover].label}</div>
          <div className="tnum text-ink-soft">
            {percent(buckets[hover].rate)} of {buckets[hover].expected.toFixed(0)}{" "}
            planned
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------- per-habit rate (bars) */

export function HabitBars({ habits }: { habits: HabitStat[] }) {
  if (!habits.length)
    return <p className="py-6 text-center text-sm text-ink-faint">No habits yet.</p>;

  const ranked = [...habits].sort((a, b) => b.rate - a.rate);

  return (
    <ul className="space-y-2.5">
      {ranked.map((habit) => (
        <li key={habit.habit_id} className="grid grid-cols-[1fr_auto] gap-x-3">
          <Link
            to={`/habit/${habit.habit_id}`}
            className="flex min-w-0 items-center gap-2 hover:underline"
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: habitColor(habit.color) }}
            />
            <span className="truncate text-[13px] text-ink">
              {habit.emoji && <span className="mr-1">{habit.emoji}</span>}
              {habit.name}
            </span>
          </Link>
          <div className="tnum text-[13px] text-ink-soft">
            {percent(habit.rate)}
            <span className="ml-2 text-ink-faint">
              {habit.completed}/{habit.expected}
            </span>
          </div>
          <div className="col-span-2 mt-1 h-2 overflow-hidden rounded-full bg-sunk">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${Math.max(habit.rate * 100, habit.rate > 0 ? 2 : 0)}%`,
                backgroundColor: habitColor(habit.color),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
