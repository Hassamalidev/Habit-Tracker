import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  ChartFrame,
  DataTable,
  StatTile,
  TrendChart,
  WeekdayChart,
} from "../components/charts";
import { HabitDialog } from "../components/HabitDialog";
import { Heatmap } from "../components/Heatmap";
import { Button, EmptyState, Segmented, Spinner, habitColor, useToast } from "../components/ui";
import { api } from "../lib/api";
import { WEEKDAY_SHORT, formatDay, percent, plural, shiftDays, todayISO } from "../lib/date";
import type {
  EntryOut,
  Habit,
  HabitDraft,
  HeatmapDay,
  Summary,
  TrendWeek,
  WeekdayBucket,
} from "../lib/types";

type Range = "30" | "90" | "365";

const TREND_WEEKS: Record<Range, number> = { "30": 12, "90": 20, "365": 52 };
const RANGE_LABEL: Record<Range, string> = {
  "30": "30 days",
  "90": "90 days",
  "365": "a year",
};

/** The schedule, in words, as a sentence someone would actually say. */
export function describeSchedule(habit: Habit): string {
  const measure =
    habit.kind === "count"
      ? `${habit.target_per_day}${habit.unit ? ` ${habit.unit}` : ""} a day`
      : "once a day";

  if (habit.schedule_type === "weekly_count")
    return `${habit.weekly_target}x a week, any days`;
  if (habit.schedule_type === "weekdays") {
    const days = habit.weekdays.map((d) => WEEKDAY_SHORT[d]).join(", ");
    return `${measure} on ${days}`;
  }
  return `${measure}, every day`;
}

export function HabitDetail() {
  const { habitId = "" } = useParams();
  const [range, setRange] = useState<Range>("90");
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const habit = useQuery({
    queryKey: ["habits", habitId],
    queryFn: () => api.get<Habit>(`/api/habits/${habitId}`),
  });

  // Every analytics endpoint already accepts a habit filter; this page is what
  // finally uses it, so the numbers here are the same maths, scoped to one row.
  const scope = `habit_id=${habitId}`;

  const summary = useQuery({
    queryKey: ["analytics", "summary", range, habitId],
    queryFn: () =>
      api.get<Summary>(`/api/analytics/summary?days=${range}&${scope}`),
  });

  const heatmap = useQuery({
    queryKey: ["analytics", "heatmap", habitId],
    queryFn: () =>
      api.get<{ days: HeatmapDay[]; week_start: number }>(
        `/api/analytics/heatmap?days=364&${scope}`,
      ),
  });

  const trend = useQuery({
    queryKey: ["analytics", "trend", range, habitId],
    queryFn: () =>
      api.get<{ weeks: TrendWeek[] }>(
        `/api/analytics/trend?weeks=${TREND_WEEKS[range]}&${scope}`,
      ),
  });

  const weekday = useQuery({
    queryKey: ["analytics", "weekday", range, habitId],
    queryFn: () =>
      api.get<{ weekdays: WeekdayBucket[] }>(
        `/api/analytics/weekday?days=${range}&${scope}`,
      ),
  });

  const notes = useQuery({
    queryKey: ["entries", "notes", habitId],
    queryFn: () =>
      api.get<EntryOut[]>(
        `/api/entries?from=${shiftDays(todayISO(), -365)}&to=${todayISO()}&${scope}`,
      ),
    select: (rows) =>
      rows
        .filter((row) => row.note)
        .sort((a, b) => b.day.localeCompare(a.day))
        .slice(0, 12),
  });

  if (habit.isLoading) return <Spinner label="Loading habit" />;

  if (habit.isError || !habit.data)
    return (
      <div className="card">
        <EmptyState
          title="Habit not found"
          body="It may have been deleted, or the link points at something that is not yours."
          action={<Link to="/"><Button>Back to the grid</Button></Link>}
        />
      </div>
    );

  const h = habit.data;
  const stat = summary.data?.habits.find((s) => s.habit_id === habitId);

  const saveHabit = async (draft: HabitDraft) => {
    await api.patch(`/api/habits/${habitId}`, draft);
    await queryClient.invalidateQueries({ queryKey: ["habits"] });
    queryClient.invalidateQueries({ queryKey: ["grid"] });
    queryClient.invalidateQueries({ queryKey: ["analytics"] });
  };

  return (
    <div className="space-y-4">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-faint hover:text-ink"
      >
        <span aria-hidden>←</span> All habits
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-1.5 h-4 w-4 shrink-0 rounded-[4px]"
            style={{ backgroundColor: habitColor(h.color) }}
          />
          <div>
            <h1 className="font-display text-[22px] leading-tight text-ink">
              {h.emoji && <span className="mr-1.5">{h.emoji}</span>}
              {h.name}
            </h1>
            <p className="mt-0.5 text-[13px] text-ink-soft">{describeSchedule(h)}</p>
            {h.description && (
              <p className="mt-1 max-w-lg text-xs text-ink-faint">{h.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Segmented<Range>
            ariaLabel="Time range"
            value={range}
            onChange={setRange}
            options={[
              { value: "30", label: "30d" },
              { value: "90", label: "90d" },
              { value: "365", label: "1y" },
            ]}
          />
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Current run"
          value={
            stat ? `${stat.current_streak}${stat.streak_unit === "week" ? "w" : "d"}` : "—"
          }
          detail={stat?.current_streak ? "keep it going" : "not running"}
        />
        <StatTile
          label="Best ever"
          value={
            stat ? `${stat.longest_streak}${stat.streak_unit === "week" ? "w" : "d"}` : "—"
          }
          detail={
            stat && stat.current_streak >= stat.longest_streak && stat.longest_streak > 0
              ? "that is right now"
              : undefined
          }
        />
        <StatTile
          label={`Last ${RANGE_LABEL[range]}`}
          value={stat ? percent(stat.rate) : "—"}
          detail={stat ? `${stat.completed} of ${stat.expected}` : undefined}
          delta={summary.data?.momentum.delta}
        />
        <StatTile
          label={h.kind === "count" ? `Total ${h.unit ?? "logged"}` : "Days kept"}
          value={
            stat ? String(h.kind === "count" ? stat.total_value : stat.completed) : "—"
          }
          detail={h.kind === "count" ? `over ${RANGE_LABEL[range]}` : undefined}
        />
      </div>

      <ChartFrame
        title="The last year"
        subtitle="Every day this habit was owed, and whether it happened."
      >
        {heatmap.data ? (
          <Heatmap days={heatmap.data.days} weekStart={heatmap.data.week_start} />
        ) : (
          <div className="h-28" />
        )}
      </ChartFrame>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Week by week"
          subtitle="The dashed tail is the week still running."
          table={
            trend.data && (
              <DataTable
                head={["Week of", "Rate", "Kept", "Planned"]}
                rows={trend.data.weeks.map((w) => [
                  w.label,
                  percent(w.rate),
                  w.completed,
                  w.expected,
                ])}
              />
            )
          }
        >
          {trend.data ? <TrendChart weeks={trend.data.weeks} /> : <div className="h-48" />}
        </ChartFrame>

        <ChartFrame
          title="Which days you keep it"
          subtitle="Completion by day of the week."
          table={
            weekday.data && (
              <DataTable
                head={["Day", "Rate", "Kept", "Planned"]}
                rows={weekday.data.weekdays.map((d) => [
                  d.label,
                  percent(d.rate),
                  d.completed.toFixed(0),
                  d.expected.toFixed(0),
                ])}
              />
            )
          }
        >
          {weekday.data ? (
            <WeekdayChart buckets={weekday.data.weekdays} />
          ) : (
            <div className="h-44" />
          )}
        </ChartFrame>
      </div>

      <ChartFrame
        title="Notes"
        subtitle={
          notes.data?.length
            ? `The last ${plural(notes.data.length, "note")} you left on this habit.`
            : "Notes you write on a day show up here."
        }
      >
        {notes.data?.length ? (
          <ul className="divide-y divide-rule">
            {notes.data.map((entry) => (
              <li key={entry.id} className="flex gap-3 py-2.5">
                <span className="tnum w-24 shrink-0 text-[12px] text-ink-faint">
                  {formatDay(entry.day)}
                </span>
                <span className="flex-1 text-[13px] text-ink-soft">{entry.note}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-sm text-ink-faint">
            Open a day from the grid — click the date at the top of a column — to
            write one.
          </p>
        )}
      </ChartFrame>

      <HabitDialog
        open={editing}
        habit={h}
        onClose={() => setEditing(false)}
        onSave={saveHabit}
        onArchive={async (target) => {
          await api.del(`/api/habits/${target.id}`);
          queryClient.invalidateQueries({ queryKey: ["grid"] });
          queryClient.invalidateQueries({ queryKey: ["analytics"] });
          toast.notify(`${target.name} archived`);
          navigate("/");
        }}
        onDelete={async (target) => {
          await api.del(`/api/habits/${target.id}?hard=true`);
          queryClient.invalidateQueries({ queryKey: ["grid"] });
          queryClient.invalidateQueries({ queryKey: ["analytics"] });
          toast.notify(`${target.name} deleted`);
          navigate("/");
        }}
      />
    </div>
  );
}
