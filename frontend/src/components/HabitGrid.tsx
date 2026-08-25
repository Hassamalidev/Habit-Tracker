import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  WEEKDAY_INITIALS,
  dayNumber,
  formatDayLong,
  isWeekend,
  weekdayIndex,
} from "../lib/date";
import type { GridResponse, GridRow, Habit } from "../lib/types";
import { cx, habitColor } from "./ui";

export interface CellChange {
  habitId: string;
  day: string;
  value: number;
  note?: string | null;
}

interface Props {
  grid: GridResponse;
  onSet: (change: CellChange) => void;
  onBulkSet: (changes: CellChange[]) => void;
  /** Paint cells without writing. A drag previews as it moves, then commits once. */
  onPreview: (changes: CellChange[]) => void;
  onOpenDay: (day: string) => void;
  onReorder: (habitIds: string[]) => void;
}

/** Is this habit owed on this date? Mirrors `is_scheduled` on the server. */
function isScheduled(habit: Habit, day: string): boolean {
  if (habit.start_date && day < habit.start_date) return false;
  if (habit.schedule_type === "weekdays")
    return habit.weekdays.includes(weekdayIndex(day));
  return true;
}

function isSatisfied(habit: Habit, value: number): boolean {
  return habit.kind === "count" ? value >= habit.target_per_day : value >= 1;
}

function describe(habit: Habit, day: string, value: number): string {
  const when = formatDayLong(day);
  if (habit.kind === "count") {
    return `${habit.name}, ${when}: ${value} of ${habit.target_per_day}${
      habit.unit ? ` ${habit.unit}` : ""
    }`;
  }
  return `${habit.name}, ${when}: ${value >= 1 ? "done" : "not done"}`;
}

const COLUMN_WIDTH = 32;

export function HabitGrid({
  grid,
  onSet,
  onBulkSet,
  onPreview,
  onOpenDay,
  onReorder,
}: Props) {
  const { days, today } = grid;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [focus, setFocus] = useState<{ row: number; col: number }>({ row: 0, col: 0 });

  // Drag-to-paint state. Kept in a ref so the pointer handlers never re-bind.
  const drag = useRef<{
    habitId: string;
    value: number;
    touched: Map<string, CellChange>;
  } | null>(null);

  // Row reordering is a separate gesture, started only from the grab handle.
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [overRow, setOverRow] = useState<string | null>(null);

  const todayIndex = useMemo(() => days.indexOf(today), [days, today]);

  // Open on the current week rather than the 1st, which is where the work is.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || todayIndex < 0) return;
    scroller.scrollTo({
      left: Math.max(0, (todayIndex - 6) * COLUMN_WIDTH),
      behavior: "auto",
    });
  }, [todayIndex, grid.month]);

  const commitDrag = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    // A plain click was already written by startDrag; only a real drag, which
    // merely previewed the cells it crossed, still needs sending.
    if (!current || current.touched.size < 2) return;
    onBulkSet([...current.touched.values()]);
  }, [onBulkSet]);

  useEffect(() => {
    const stop = () => commitDrag();
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [commitDrag]);

  const startDrag = (row: GridRow, day: string, current: number) => {
    const next = isSatisfied(row.habit, current)
      ? 0
      : row.habit.kind === "count"
        ? row.habit.target_per_day
        : 1;
    const change = { habitId: row.habit.id, day, value: next };
    drag.current = {
      habitId: row.habit.id,
      value: next,
      touched: new Map([[day, change]]),
    };
    onSet(change);
  };

  const extendDrag = (row: GridRow, day: string) => {
    const state = drag.current;
    // A drag stays on the row it began in; crossing rows would be a mis-swipe.
    if (!state || state.habitId !== row.habit.id || state.touched.has(day)) return;
    if (day > today || !isScheduled(row.habit, day)) return;
    const change = { habitId: row.habit.id, day, value: state.value };
    state.touched.set(day, change);
    // Previewed only: the whole run is written in one request on pointer-up.
    onPreview([change]);
  };

  const nudge = (row: GridRow, day: string, delta: number) => {
    const habit = row.habit;
    if (habit.kind !== "count") return;
    const current = row.values[day] ?? 0;
    const next = Math.max(0, Math.min(habit.target_per_day * 3, current + delta));
    if (next !== current) onSet({ habitId: habit.id, day, value: next });
  };

  const dropOnto = (targetId: string) => {
    if (!dragRow || dragRow === targetId) return;
    const ids = grid.rows.map((r) => r.habit.id);
    const from = ids.indexOf(dragRow);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    onReorder(ids);
  };

  const onKeyDown = (
    event: React.KeyboardEvent,
    row: GridRow,
    rowIndex: number,
    colIndex: number,
  ) => {
    const day = days[colIndex];
    const moves: Record<string, [number, number]> = {
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
    };

    if (moves[event.key]) {
      event.preventDefault();
      const [dr, dc] = moves[event.key];
      const nextRow = Math.min(grid.rows.length - 1, Math.max(0, rowIndex + dr));
      const nextCol = Math.min(days.length - 1, Math.max(0, colIndex + dc));
      setFocus({ row: nextRow, col: nextCol });
      document
        .querySelector<HTMLButtonElement>(
          `[data-cell="${grid.rows[nextRow].habit.id}:${days[nextCol]}"]`,
        )
        ?.focus();
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (day <= today && isScheduled(row.habit, day))
        startDrag(row, day, row.values[day] ?? 0);
      drag.current = null;
      return;
    }

    // "d" opens the full day, where notes and exact counts live.
    if (event.key.toLowerCase() === "d") {
      event.preventDefault();
      onOpenDay(day);
      return;
    }

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      nudge(row, day, 1);
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      nudge(row, day, -1);
    }
  };

  return (
    <div className="card overflow-hidden">
      <div
        ref={scrollerRef}
        onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 2)}
        // `relative` is load-bearing: without a positioned scroll container the
        // sticky cells' overflow escapes to the document, and the whole page
        // scrolls sideways on a phone instead of just the grid.
        className="relative overflow-x-auto"
      >
        <table className="border-separate border-spacing-0" style={{ minWidth: "100%" }}>
          <caption className="sr-only">
            Habits down the side, days of the month across the top. Arrow keys move
            between cells, space toggles one, and d opens the whole day.
          </caption>

          <thead>
            <tr>
              <th
                scope="col"
                className={cx(
                  "sticky left-0 z-20 bg-surface px-4 py-2 text-left align-bottom",
                  "border-b border-rule",
                  scrolled && "shadow-[4px_0_8px_-4px_rgb(0_0_0/0.12)]",
                  "grid-name-col",
                )}
              >
                <span className="eyebrow">Habit</span>
              </th>

              {days.map((day) => {
                const isToday = day === today;
                return (
                  <th
                    key={day}
                    scope="col"
                    className={cx(
                      "border-b border-rule p-0 text-center align-bottom font-normal",
                      isWeekend(day) && !isToday && "bg-sunk/60",
                      isToday && "bg-accent-soft",
                    )}
                    style={{ width: COLUMN_WIDTH, minWidth: COLUMN_WIDTH }}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenDay(day)}
                      title={`Open ${formatDayLong(day)}`}
                      aria-label={`Open ${formatDayLong(day)}`}
                      className="w-full py-1.5 transition-colors hover:bg-rule/60"
                    >
                      <span
                        className={cx(
                          "block text-[10px] leading-tight",
                          isToday ? "text-accent-ink" : "text-ink-faint",
                        )}
                      >
                        {WEEKDAY_INITIALS[weekdayIndex(day)]}
                      </span>
                      <span
                        className={cx(
                          "tnum block text-[12px] leading-tight",
                          isToday
                            ? "font-semibold text-accent-ink"
                            : isWeekend(day)
                              ? "text-ink-faint"
                              : "text-ink-soft",
                        )}
                      >
                        {dayNumber(day)}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {grid.rows.map((row, rowIndex) => (
              <tr
                key={row.habit.id}
                className={cx(
                  "group",
                  dragRow === row.habit.id && "opacity-40",
                  overRow === row.habit.id &&
                    dragRow !== row.habit.id &&
                    "outline outline-2 -outline-offset-2 outline-accent",
                )}
                onDragOver={(event) => {
                  if (!dragRow) return;
                  event.preventDefault();
                  setOverRow(row.habit.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dropOnto(row.habit.id);
                  setDragRow(null);
                  setOverRow(null);
                }}
              >
                <th
                  scope="row"
                  className={cx(
                    "sticky left-0 z-10 bg-surface px-4 py-2 text-left font-normal",
                    "border-b border-rule group-last:border-b-0",
                    scrolled && "shadow-[4px_0_8px_-4px_rgb(0_0_0/0.12)]",
                    "grid-name-col",
                  )}
                >
                  <RowHeader
                    row={row}
                    dragging={dragRow === row.habit.id}
                    onDragStart={() => setDragRow(row.habit.id)}
                    onDragEnd={() => {
                      setDragRow(null);
                      setOverRow(null);
                    }}
                  />
                </th>

                {days.map((day, colIndex) => {
                  const value = row.values[day] ?? 0;
                  const scheduled = isScheduled(row.habit, day);
                  const future = day > today;
                  return (
                    <td
                      key={day}
                      className={cx(
                        "border-b border-rule p-0 text-center align-middle",
                        "group-last:border-b-0",
                        isWeekend(day) && day !== today && "bg-sunk/60",
                        day === today && "bg-accent-soft/50",
                      )}
                      style={{ width: COLUMN_WIDTH, minWidth: COLUMN_WIDTH }}
                    >
                      <Cell
                        habit={row.habit}
                        day={day}
                        value={value}
                        note={row.notes[day]}
                        scheduled={scheduled}
                        future={future}
                        tabIndex={
                          focus.row === rowIndex && focus.col === colIndex ? 0 : -1
                        }
                        onPointerDown={() => {
                          if (future || !scheduled) return;
                          setFocus({ row: rowIndex, col: colIndex });
                          startDrag(row, day, value);
                        }}
                        onPointerEnter={() => extendDrag(row, day)}
                        onFocus={() => setFocus({ row: rowIndex, col: colIndex })}
                        onKeyDown={(event) => onKeyDown(event, row, rowIndex, colIndex)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onOpenDay(day);
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule px-4 py-2 text-[11px] text-ink-faint">
        <span>
          Click to tick, drag along a row to fill days, drag the handle to reorder.
          Click a date, or right-click a cell, to open that whole day.
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-3 w-3 rounded-[3px] border border-dashed border-rule-strong"
            />
            optional day
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-1 w-1 rounded-full bg-rule-strong" />
            not scheduled
          </span>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ row head */

function RowHeader({
  row,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  row: GridRow;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { habit, streak, completed_days, scheduled_days } = row;
  const rate = scheduled_days ? completed_days / scheduled_days : 0;

  return (
    <div className="flex items-center gap-2">
      <span
        draggable
        onDragStart={(event) => {
          // Firefox refuses to start a drag without payload on the transfer.
          event.dataTransfer.setData("text/plain", habit.id);
          event.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        role="button"
        tabIndex={-1}
        aria-label={`Reorder ${habit.name}`}
        title="Drag to reorder"
        className={cx(
          "-ml-2 shrink-0 cursor-grab px-1 text-ink-faint opacity-0 transition-opacity",
          "group-hover:opacity-100 active:cursor-grabbing",
          dragging && "opacity-100",
        )}
      >
        <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden fill="currentColor">
          <circle cx="1.5" cy="2" r="1.2" />
          <circle cx="6.5" cy="2" r="1.2" />
          <circle cx="1.5" cy="7" r="1.2" />
          <circle cx="6.5" cy="7" r="1.2" />
          <circle cx="1.5" cy="12" r="1.2" />
          <circle cx="6.5" cy="12" r="1.2" />
        </svg>
      </span>

      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
        style={{ backgroundColor: habitColor(habit.color) }}
      />

      <div className="min-w-0 flex-1">
        <Link
          to={`/habit/${habit.id}`}
          className="block max-w-full truncate text-left text-[13.5px] font-medium text-ink hover:text-accent-ink hover:underline"
          title={`Open ${habit.name}`}
        >
          {habit.emoji && <span className="mr-1">{habit.emoji}</span>}
          {habit.name}
        </Link>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
          <span className="tnum">
            {completed_days}/{scheduled_days}
          </span>
          <span aria-hidden>·</span>
          <span className="tnum">{Math.round(rate * 100)}%</span>
          {streak.current > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="tnum font-medium text-fire-ink">
                {streak.current}
                {streak.unit === "week" ? "w" : "d"}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- cell */

interface CellProps {
  habit: Habit;
  day: string;
  value: number;
  note?: string;
  scheduled: boolean;
  future: boolean;
  tabIndex: number;
  onPointerDown: () => void;
  onPointerEnter: () => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

function Cell({
  habit,
  day,
  value,
  note,
  scheduled,
  future,
  tabIndex,
  onPointerDown,
  onPointerEnter,
  onFocus,
  onKeyDown,
  onContextMenu,
}: CellProps) {
  const done = isSatisfied(habit, value);
  const ratio =
    habit.kind === "count" ? Math.min(1, value / habit.target_per_day) : done ? 1 : 0;
  const partial = ratio > 0 && ratio < 1;
  const color = habitColor(habit.color);

  // Pulse only on the transition into done, never on first render or a refetch.
  const wasDone = useRef(done);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (done && !wasDone.current) {
      setPop(true);
      const timer = window.setTimeout(() => setPop(false), 280);
      return () => window.clearTimeout(timer);
    }
    wasDone.current = done;
  }, [done]);
  useEffect(() => {
    wasDone.current = done;
  }, [done]);

  // A day the schedule never asked for is marked, not left blank, so a gap in
  // the row reads as "not required" rather than "missed".
  if (!scheduled) {
    return (
      <div
        className="mx-auto flex h-8 w-8 items-center justify-center"
        title={`${habit.name} is not scheduled on ${formatDayLong(day)}`}
      >
        <span aria-hidden className="h-1 w-1 rounded-full bg-rule-strong" />
        <span className="sr-only">
          {habit.name}, {formatDayLong(day)}: not scheduled
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      data-cell={`${habit.id}:${day}`}
      tabIndex={tabIndex}
      disabled={future}
      aria-pressed={done}
      aria-label={describe(habit, day, value) + (note ? `. Note: ${note}` : "")}
      title={describe(habit, day, value) + (note ? `\n${note}` : "")}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      className={cx(
        "relative mx-auto flex h-8 w-8 items-center justify-center rounded-[6px]",
        "transition-transform duration-75 active:scale-90",
        future ? "cursor-default opacity-35" : "cursor-pointer",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "relative block h-[22px] w-[22px] overflow-hidden rounded-[5px] border transition-colors",
          pop && "cell-pop",
          done || partial
            ? "border-transparent"
            : // A weekly quota does not owe any particular day, so an untouched
              // square is drawn dashed: available, not missed.
              habit.schedule_type === "weekly_count"
              ? "border-dashed border-rule-strong bg-transparent"
              : "border-rule-strong bg-transparent",
        )}
        style={
          done
            ? { backgroundColor: color }
            : partial
              ? { backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }
              : undefined
        }
      >
        {partial && (
          // Counted progress fills from the bottom, like a measure filling up.
          <span
            className="absolute inset-x-0 bottom-0 block transition-[height] duration-200"
            style={{ height: `${ratio * 100}%`, backgroundColor: color }}
          />
        )}
        {done && (
          <svg viewBox="0 0 22 22" className="absolute inset-0" fill="none" aria-hidden>
            <path
              d="M6 11.5l3.2 3.2L16 8"
              stroke="var(--on-accent)"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.92"
            />
          </svg>
        )}
      </span>

      {note && (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full border border-surface bg-fire"
          title={note}
        />
      )}
    </button>
  );
}
