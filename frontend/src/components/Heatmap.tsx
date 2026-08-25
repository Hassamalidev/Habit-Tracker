import { useEffect, useMemo, useRef, useState } from "react";

import { formatDayLong, parseISO, percent, weekdayIndex } from "../lib/date";
import type { HeatmapDay } from "../lib/types";
import { cx } from "./ui";

const GAP = 3;
const LABEL_COLUMN = 30;
const MIN_CELL = 9;
const MAX_CELL = 20;

/** Six steps of one hue: empty, then five bands of "how much of today got done". */
function bandOf(day: HeatmapDay): string {
  if (day.future || day.expected <= 0) return "transparent";
  if (day.completed <= 0) return "var(--seq-0)";
  if (day.ratio >= 0.999) return "var(--seq-5)";
  if (day.ratio > 0.75) return "var(--seq-4)";
  if (day.ratio > 0.5) return "var(--seq-3)";
  if (day.ratio > 0.25) return "var(--seq-2)";
  return "var(--seq-1)";
}

interface Props {
  days: HeatmapDay[];
  weekStart: number;
}

export function Heatmap({ days, weekStart }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [hover, setHover] = useState<{ day: HeatmapDay; x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry.contentRect.width),
    );
    observer.observe(element);
    setAvailable(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const { columns, months } = useMemo(() => {
    const rowOf = (iso: string) => (weekdayIndex(iso) - weekStart + 7) % 7;

    const columns: (HeatmapDay | null)[][] = [];
    let current: (HeatmapDay | null)[] = Array(7).fill(null);
    let started = false;

    for (const day of days) {
      const row = rowOf(day.day);
      if (row === 0 && started) {
        columns.push(current);
        current = Array(7).fill(null);
      }
      current[row] = day;
      started = true;
    }
    if (started) columns.push(current);

    const months: { index: number; label: string }[] = [];
    let lastMonth = -1;
    columns.forEach((column, index) => {
      const first = column.find(Boolean);
      if (!first) return;
      const month = parseISO(first.day).getMonth();
      if (month !== lastMonth) {
        lastMonth = month;
        months.push({
          index,
          label: parseISO(first.day).toLocaleDateString(undefined, { month: "short" }),
        });
      }
    });

    return { columns, months };
  }, [days, weekStart]);

  // Squares grow to use the card rather than huddling at one edge, and shrink
  // (with a scrollbar) rather than overflow when the card is narrow.
  const cell = useMemo(() => {
    if (!available || !columns.length) return 13;
    const perColumn = (available - LABEL_COLUMN) / columns.length - GAP;
    return Math.round(Math.max(MIN_CELL, Math.min(MAX_CELL, perColumn)));
  }, [available, columns.length]);

  const step = cell + GAP;
  const radius = Math.max(2, Math.round(cell / 5));

  // Drop any month label that would sit on top of the one before it.
  const visibleMonths = useMemo(() => {
    const kept: { index: number; label: string }[] = [];
    let lastX = -Infinity;
    for (const month of months) {
      const x = month.index * step;
      if (x - lastX >= 26) {
        kept.push(month);
        lastX = x;
      }
    }
    return kept;
  }, [months, step]);

  const weekdayNames = useMemo(() => {
    const base = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return Array.from({ length: 7 }, (_, row) => base[(row + weekStart) % 7]);
  }, [weekStart]);

  return (
    <div ref={hostRef} className="relative">
      <div className="overflow-x-auto pb-1">
        <div style={{ width: columns.length * step + LABEL_COLUMN }}>
          <div className="relative mb-1 h-3.5" style={{ marginLeft: LABEL_COLUMN }}>
            {visibleMonths.map(({ index, label }) => (
              <span
                key={`${label}-${index}`}
                className="absolute text-[10px] text-ink-faint"
                style={{ left: index * step }}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="flex" style={{ gap: GAP }}>
            <div
              className="flex shrink-0 flex-col pr-1.5"
              style={{ width: LABEL_COLUMN, gap: GAP }}
            >
              {weekdayNames.map((name, row) => (
                <span
                  key={name + row}
                  className="text-right text-[9px] text-ink-faint"
                  style={{ height: cell, lineHeight: `${cell}px` }}
                >
                  {row % 2 === 1 ? name : ""}
                </span>
              ))}
            </div>

            {columns.map((column, columnIndex) => (
              <div
                key={columnIndex}
                className="flex flex-col"
                style={{ gap: GAP }}
              >
                {column.map((day, row) => {
                  if (!day)
                    return (
                      <div key={row} style={{ width: cell, height: cell }} aria-hidden />
                    );

                  const untracked = day.expected <= 0 && !day.future;
                  return (
                    <div
                      key={row}
                      role="img"
                      aria-label={`${formatDayLong(day.day)}: ${
                        day.future
                          ? "upcoming"
                          : untracked
                            ? "nothing scheduled"
                            : percent(day.ratio)
                      }`}
                      onPointerEnter={(event) => {
                        const box = event.currentTarget.getBoundingClientRect();
                        const host = hostRef.current!.getBoundingClientRect();
                        setHover({
                          day,
                          x: box.left - host.left + cell / 2,
                          y: box.top - host.top,
                        });
                      }}
                      onPointerLeave={() => setHover(null)}
                      className={cx(
                        "transition-transform",
                        !day.future && !untracked && "hover:scale-110",
                        // Days before the habit existed, and days still ahead,
                        // are hollow rather than filled: absent, not failed. A
                        // plain hairline stays quiet across a mostly-empty year
                        // in a way that dashes do not.
                        (day.future || untracked) && "border border-rule opacity-70",
                      )}
                      style={{
                        width: cell,
                        height: cell,
                        borderRadius: radius,
                        backgroundColor: bandOf(day),
                        boxShadow: day.perfect
                          ? "inset 0 0 0 1.5px var(--surface)"
                          : undefined,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-1.5 text-[10px] text-ink-faint">
        <span>Less</span>
        {[
          "var(--seq-0)",
          "var(--seq-1)",
          "var(--seq-2)",
          "var(--seq-3)",
          "var(--seq-4)",
          "var(--seq-5)",
        ].map((color) => (
          <span
            key={color}
            className="rounded-[3px]"
            style={{ width: 11, height: 11, backgroundColor: color }}
            aria-hidden
          />
        ))}
        <span>More</span>
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-rule-strong bg-surface px-2.5 py-1.5 text-xs shadow-pop"
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          <div className="font-medium text-ink">{formatDayLong(hover.day.day)}</div>
          <div className="tnum text-ink-soft">
            {hover.day.future
              ? "Still to come"
              : hover.day.expected <= 0
                ? "Nothing scheduled"
                : `${percent(hover.day.ratio)} done${
                    hover.day.perfect ? " · perfect day" : ""
                  }`}
          </div>
        </div>
      )}
    </div>
  );
}
