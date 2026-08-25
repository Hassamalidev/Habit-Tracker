import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DayPanel, type DayChange } from "../components/DayPanel";
import { HabitDialog } from "../components/HabitDialog";
import { HabitGrid, type CellChange } from "../components/HabitGrid";
import { Button, EmptyState, Spinner, cx, useToast } from "../components/ui";
import { api } from "../lib/api";
import { addMonths, monthKey, monthLabel } from "../lib/date";
import { milestoneMessage, milestoneReached } from "../lib/milestones";
import type {
  BulkWriteOut,
  EntryWriteOut,
  GridResponse,
  Habit,
  HabitDraft,
  Streak,
} from "../lib/types";

export function Tracker() {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const toast = useToast();
  const gridKey = useMemo(() => ["grid", month], [month]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: gridKey,
    queryFn: () => api.get<GridResponse>(`/api/entries/grid?month=${month}`),
  });

  // A drag fires a burst of writes; refreshing once after the burst keeps the
  // completion totals exact without a request per cell.
  const refreshTimer = useRef<number>(undefined);
  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["grid"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    }, 500);
  }, [queryClient]);

  useEffect(() => () => window.clearTimeout(refreshTimer.current), []);

  const snapshot = useCallback(
    () => queryClient.getQueryData<GridResponse>(gridKey),
    [queryClient, gridKey],
  );

  const restore = useCallback(
    (previous: GridResponse | undefined) => {
      if (previous) queryClient.setQueryData(gridKey, previous);
    },
    [queryClient, gridKey],
  );

  /** Paint the change straight into the cache so the tick lands instantly. */
  const applyLocally = useCallback(
    (changes: CellChange[]) => {
      queryClient.setQueryData<GridResponse>(gridKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          rows: current.rows.map((row) => {
            const mine = changes.filter((c) => c.habitId === row.habit.id);
            if (!mine.length) return row;

            const values = { ...row.values };
            const notes = { ...row.notes };
            for (const change of mine) {
              if (change.value > 0) values[change.day] = change.value;
              else delete values[change.day];
              // `note` is only present when the day panel sent one; a plain
              // tick leaves whatever note is already there untouched.
              if (change.note !== undefined) {
                if (change.note) notes[change.day] = change.note;
                else delete notes[change.day];
              }
            }

            const isDone = (value: number) =>
              row.habit.kind === "count"
                ? value >= row.habit.target_per_day
                : value >= 1;
            const completed = Object.entries(values).filter(
              ([day, value]) => day <= current.today && isDone(value),
            ).length;

            return {
              ...row,
              values,
              notes,
              completed_days: Math.min(completed, row.scheduled_days || completed),
            };
          }),
        };
      });
    },
    [queryClient, gridKey],
  );

  /** Drop the server's freshly computed streak into the row badge. */
  const applyStreaks = useCallback(
    (streaks: Record<string, Streak>) => {
      queryClient.setQueryData<GridResponse>(gridKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          rows: current.rows.map((row) =>
            streaks[row.habit.id] ? { ...row, streak: streaks[row.habit.id] } : row,
          ),
        };
      });
    },
    [queryClient, gridKey],
  );

  // A drag writes once optimistically and once on commit; without this the same
  // milestone would be announced twice for the same run.
  const announced = useRef<Record<string, number>>({});

  const announceMilestones = useCallback(
    (before: GridResponse | undefined, streaks: Record<string, Streak>) => {
      if (!before) return;
      for (const [habitId, after] of Object.entries(streaks)) {
        const row = before.rows.find((r) => r.habit.id === habitId);
        const milestone = milestoneReached(row?.streak, after);
        if (!milestone || !row) continue;
        if (announced.current[habitId] === milestone.value) continue;
        announced.current[habitId] = milestone.value;
        toast.celebrate(milestoneMessage(row.habit.name, milestone));
      }
    },
    [toast],
  );

  const setCell = useMutation({
    mutationFn: (change: CellChange) =>
      api.put<EntryWriteOut>("/api/entries", {
        habit_id: change.habitId,
        day: change.day,
        value: change.value,
        // Sending the key only when it is meant keeps the server from clearing
        // a note that a plain tick never intended to touch.
        ...(change.note !== undefined ? { note: change.note } : {}),
      }),
    onMutate: async (change: CellChange) => {
      await queryClient.cancelQueries({ queryKey: gridKey });
      const previous = snapshot();
      applyLocally([change]);
      return { previous };
    },
    onSuccess: (result, _change, context) => {
      const streaks = { [result.habit_id]: result.streak };
      applyStreaks(streaks);
      announceMilestones(context?.previous, streaks);
    },
    onError: (err, _change, context) => {
      restore(context?.previous);
      toast.error(err instanceof Error ? err.message : "Could not save that tick.");
    },
    onSettled: scheduleRefresh,
  });

  const setCells = useMutation({
    mutationFn: (changes: CellChange[]) =>
      api.post<BulkWriteOut>("/api/entries/bulk", {
        entries: changes.map((c) => ({
          habit_id: c.habitId,
          day: c.day,
          value: c.value,
          ...(c.note !== undefined ? { note: c.note } : {}),
        })),
      }),
    onMutate: async (changes: CellChange[]) => {
      await queryClient.cancelQueries({ queryKey: gridKey });
      const previous = snapshot();
      applyLocally(changes);
      return { previous };
    },
    onSuccess: (result, _changes, context) => {
      applyStreaks(result.streaks);
      announceMilestones(context?.previous, result.streaks);
    },
    onError: (err, _changes, context) => {
      restore(context?.previous);
      toast.error(err instanceof Error ? err.message : "Could not save those days.");
    },
    onSettled: scheduleRefresh,
  });

  const onBulkSet = useCallback(
    (changes: CellChange[]) => {
      const before = snapshot();
      const undo: CellChange[] = before
        ? changes.map((change) => {
            const row = before.rows.find((r) => r.habit.id === change.habitId);
            return { ...change, value: row?.values[change.day] ?? 0 };
          })
        : [];

      setCells.mutate(changes);
      toast.notify(`${changes.length} days updated`, {
        label: "Undo",
        run: () => setCells.mutate(undo),
      });
    },
    [setCells, snapshot, toast],
  );

  const reorder = useMutation({
    mutationFn: (habitIds: string[]) =>
      api.post("/api/habits/reorder", { habit_ids: habitIds }),
    onMutate: async (habitIds: string[]) => {
      await queryClient.cancelQueries({ queryKey: gridKey });
      const previous = snapshot();
      queryClient.setQueryData<GridResponse>(gridKey, (current) => {
        if (!current) return current;
        const byId = new Map(current.rows.map((row) => [row.habit.id, row]));
        return {
          ...current,
          rows: habitIds.map((id) => byId.get(id)!).filter(Boolean),
        };
      });
      return { previous };
    },
    onError: (err, _ids, context) => {
      restore(context?.previous);
      toast.error(err instanceof Error ? err.message : "Could not reorder.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["habits"] });
      scheduleRefresh();
    },
  });

  const saveHabit = useCallback(
    async (draft: HabitDraft) => {
      if (editing) await api.patch(`/api/habits/${editing.id}`, draft);
      else await api.post("/api/habits", draft);
      await queryClient.invalidateQueries({ queryKey: ["grid"] });
      await queryClient.invalidateQueries({ queryKey: ["habits"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    [editing, queryClient],
  );

  const openNew = useCallback(() => {
    setEditing(null);
    setDialogOpen(true);
  }, []);

  // "n" for a new habit, as long as the user is not typing into something.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "n") {
        event.preventDefault();
        openNew();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openNew]);

  // The command palette drives this page from a distance.
  useEffect(() => {
    const onNew = () => openNew();
    const onMonth = (event: Event) => {
      const detail = (event as CustomEvent<number | "today">).detail;
      setMonth((current) =>
        detail === "today" ? monthKey(new Date()) : addMonths(current, detail),
      );
    };
    window.addEventListener("habit:new", onNew);
    window.addEventListener("habit:month", onMonth);
    return () => {
      window.removeEventListener("habit:new", onNew);
      window.removeEventListener("habit:month", onMonth);
    };
  }, [openNew]);

  const applyDayChange = useCallback(
    (change: DayChange) => setCell.mutate(change),
    [setCell],
  );

  const thisMonth = monthKey(new Date());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth(addMonths(month, -1))}
            aria-label="Previous month"
            className="rounded-md p-1.5 text-ink-faint hover:bg-sunk hover:text-ink"
          >
            <Chevron direction="left" />
          </button>
          <h1 className="min-w-[168px] px-1 text-center font-display text-[19px] text-ink">
            {monthLabel(month)}
          </h1>
          <button
            onClick={() => setMonth(addMonths(month, 1))}
            aria-label="Next month"
            className="rounded-md p-1.5 text-ink-faint hover:bg-sunk hover:text-ink"
          >
            <Chevron direction="right" />
          </button>
          <button
            onClick={() => setMonth(thisMonth)}
            disabled={month === thisMonth}
            className={cx(
              "ml-2 rounded-md px-2 py-1 text-[12px] font-medium transition-colors",
              month === thisMonth
                ? "cursor-default text-ink-faint opacity-50"
                : "text-ink-soft hover:bg-sunk hover:text-ink",
            )}
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-2">
          {data && data.rows.length > 0 && (
            <Button size="sm" variant="quiet" onClick={() => setOpenDay(data.today)}>
              Log today
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={openNew}>
            <span aria-hidden>+</span> New habit
          </Button>
        </div>
      </div>

      {isLoading && <Spinner label="Loading your month" />}

      {isError && (
        <div className="card px-4 py-8 text-center">
          <p className="text-sm text-danger-ink">
            {error instanceof Error ? error.message : "Could not load the grid."}
          </p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: gridKey })}
          >
            Try again
          </Button>
        </div>
      )}

      {data && data.rows.length === 0 && (
        <div className="card">
          <EmptyState
            title="No habits yet"
            body="Add the first thing you want to keep track of. Prayer, the gym, reading — anything with a rhythm to it."
            action={
              <Button variant="primary" onClick={openNew}>
                Create your first habit
              </Button>
            }
          />
        </div>
      )}

      {data && data.rows.length > 0 && (
        <HabitGrid
          grid={data}
          onSet={(change) => setCell.mutate(change)}
          onBulkSet={onBulkSet}
          onPreview={applyLocally}
          onOpenDay={setOpenDay}
          onReorder={(ids) => reorder.mutate(ids)}
        />
      )}

      {data && (
        <DayPanel
          day={openDay}
          grid={data}
          onClose={() => setOpenDay(null)}
          onApply={applyDayChange}
        />
      )}

      <HabitDialog
        open={dialogOpen}
        habit={editing}
        onClose={() => setDialogOpen(false)}
        onSave={saveHabit}
      />
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d={direction === "left" ? "M10 3.5L5.5 8l4.5 4.5" : "M6 3.5L10.5 8 6 12.5"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
