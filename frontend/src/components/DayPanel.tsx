import { useEffect, useState } from "react";

import { formatDayLong, weekdayIndex } from "../lib/date";
import type { GridResponse, Habit } from "../lib/types";
import { Button, Drawer, Stepper, cx, habitColor } from "./ui";

export interface DayChange {
  habitId: string;
  day: string;
  value: number;
  note?: string | null;
}

function isScheduled(habit: Habit, day: string): boolean {
  if (habit.start_date && day < habit.start_date) return false;
  if (habit.schedule_type === "weekdays")
    return habit.weekdays.includes(weekdayIndex(day));
  return true;
}

function scheduleNote(habit: Habit): string | null {
  if (habit.schedule_type === "weekly_count")
    return `${habit.weekly_target}x a week — optional today`;
  return null;
}

/**
 * One day, every habit, in full detail.
 *
 * The grid is built for speed and can only say done or not done. This is where
 * an exact count goes, and it is the only place a note can be written.
 */
export function DayPanel({
  day,
  grid,
  onClose,
  onApply,
}: {
  day: string | null;
  grid: GridResponse;
  onClose: () => void;
  onApply: (change: DayChange) => void;
}) {
  // Notes are edited locally and committed on blur, so every keystroke is not a
  // request; the map is keyed by habit so several can be open at once.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!day) return;
    const next: Record<string, string> = {};
    for (const row of grid.rows) next[row.habit.id] = row.notes[day] ?? "";
    setDrafts(next);
  }, [day, grid.rows]);

  if (!day) return null;

  const future = day > grid.today;
  const isToday = day === grid.today;

  const commitNote = (habitId: string, value: number) => {
    const row = grid.rows.find((r) => r.habit.id === habitId);
    const original = row?.notes[day] ?? "";
    const draft = (drafts[habitId] ?? "").trim();
    if (draft === original) return;
    onApply({ habitId, day, value, note: draft || null });
  };

  return (
    <Drawer
      open
      title={isToday ? "Today" : formatDayLong(day)}
      subtitle={isToday ? formatDayLong(day) : undefined}
      onClose={onClose}
    >
      {future ? (
        <p className="py-8 text-center text-sm text-ink-faint">
          This day has not happened yet.
        </p>
      ) : (
        <ul className="divide-y divide-rule">
          {grid.rows.map((row) => {
            const habit = row.habit;
            const value = row.values[day] ?? 0;
            const scheduled = isScheduled(habit, day);
            const done =
              habit.kind === "count" ? value >= habit.target_per_day : value >= 1;
            const hint = scheduleNote(habit);

            return (
              <li key={habit.id} className="py-3">
                <div className="flex items-start gap-2.5">
                  <span
                    aria-hidden
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: habitColor(habit.color) }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={cx(
                          "truncate text-[13.5px]",
                          scheduled ? "text-ink" : "text-ink-faint",
                        )}
                      >
                        {habit.emoji && <span className="mr-1">{habit.emoji}</span>}
                        {habit.name}
                      </span>

                      {!scheduled ? (
                        <span className="shrink-0 text-[11px] text-ink-faint">
                          not scheduled
                        </span>
                      ) : habit.kind === "count" ? (
                        <Stepper
                          label={habit.name}
                          value={value}
                          target={habit.target_per_day}
                          unit={habit.unit}
                          onChange={(next) =>
                            onApply({ habitId: habit.id, day, value: next })
                          }
                        />
                      ) : (
                        <button
                          type="button"
                          aria-pressed={done}
                          onClick={() =>
                            onApply({ habitId: habit.id, day, value: done ? 0 : 1 })
                          }
                          className={cx(
                            "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors",
                            done
                              ? "border-transparent text-on-accent"
                              : "border-rule-strong text-ink-soft hover:bg-sunk",
                          )}
                          style={
                            done
                              ? { backgroundColor: habitColor(habit.color) }
                              : undefined
                          }
                        >
                          {done ? "Done" : "Mark done"}
                        </button>
                      )}
                    </div>

                    {hint && (
                      <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>
                    )}

                    {scheduled && (
                      <input
                        value={drafts[habit.id] ?? ""}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [habit.id]: event.target.value,
                          }))
                        }
                        onBlur={() => commitNote(habit.id, value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                        placeholder="Add a note…"
                        maxLength={500}
                        aria-label={`Note for ${habit.name}`}
                        className="mt-1.5 w-full rounded-md border border-transparent bg-sunk px-2 py-1 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent focus:bg-surface focus:outline-none"
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex justify-end border-t border-rule pt-3">
        <Button size="sm" variant="quiet" onClick={onClose}>
          Done
        </Button>
      </div>
    </Drawer>
  );
}
