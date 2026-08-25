import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  ChartFrame,
  DataTable,
  HabitBars,
  StatTile,
  TrendChart,
  WeekdayChart,
} from "../components/charts";
import { Heatmap } from "../components/Heatmap";
import { Button, EmptyState, Segmented, Spinner, cx, useToast } from "../components/ui";
import { api, downloadCsv } from "../lib/api";
import { percent, plural } from "../lib/date";
import type {
  HeatmapDay,
  Insight,
  Summary,
  TrendWeek,
  WeekdayBucket,
} from "../lib/types";

type Range = "7" | "30" | "90";

const TREND_WEEKS: Record<Range, number> = { "7": 8, "30": 12, "90": 20 };
const RANGE_LABEL: Record<Range, string> = {
  "7": "the last 7 days",
  "30": "the last 30 days",
  "90": "the last 90 days",
};

const TONE_STYLE: Record<Insight["tone"], string> = {
  positive: "border-l-[3px] border-l-accent",
  neutral: "border-l-[3px] border-l-rule-strong",
  warning: "border-l-[3px] border-l-fire",
};

export function Dashboard() {
  const [range, setRange] = useState<Range>("30");
  const toast = useToast();

  const summary = useQuery({
    queryKey: ["analytics", "summary", range],
    queryFn: () => api.get<Summary>(`/api/analytics/summary?days=${range}`),
  });

  const heatmap = useQuery({
    queryKey: ["analytics", "heatmap"],
    queryFn: () =>
      api.get<{ days: HeatmapDay[]; week_start: number }>(
        "/api/analytics/heatmap?days=364",
      ),
  });

  const weekday = useQuery({
    queryKey: ["analytics", "weekday", range],
    queryFn: () =>
      api.get<{ weekdays: WeekdayBucket[] }>(`/api/analytics/weekday?days=${range}`),
  });

  const trend = useQuery({
    queryKey: ["analytics", "trend", range],
    queryFn: () =>
      api.get<{ weeks: TrendWeek[] }>(
        `/api/analytics/trend?weeks=${TREND_WEEKS[range]}`,
      ),
  });

  const insights = useQuery({
    queryKey: ["analytics", "insights", range],
    queryFn: () =>
      api.get<{ insights: Insight[] }>(`/api/analytics/insights?days=${range}`),
  });

  if (summary.isLoading) return <Spinner label="Crunching your numbers" />;

  if (summary.isError)
    return (
      <div className="card px-4 py-8 text-center text-sm text-danger-ink">
        {summary.error instanceof Error
          ? summary.error.message
          : "Could not load the dashboard."}
      </div>
    );

  const data = summary.data!;

  if (data.active_habits === 0)
    return (
      <div className="card">
        <EmptyState
          title="Nothing to chart yet"
          body="Once you have a habit or two and a few days of ticks, this page fills up with streaks, trends and a year-long heatmap."
        />
      </div>
    );

  const best = data.best_streak;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[19px] text-ink">Dashboard</h1>
          <p className="text-xs text-ink-faint">
            Everything below covers {RANGE_LABEL[range]}, except the heatmap.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented<Range>
            ariaLabel="Time range"
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "7d" },
              { value: "30", label: "30d" },
              { value: "90", label: "90d" },
            ]}
          />
          <Button
            size="sm"
            onClick={() =>
              downloadCsv().catch(() => toast.error("Could not export the CSV."))
            }
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Completion"
          value={percent(data.completion_rate)}
          numeric={data.completion_rate * 100}
          format={(n) => `${Math.round(n)}%`}
          detail={`${data.completed_slots} of ${data.expected_slots}`}
          delta={data.momentum.delta}
        />
        <StatTile
          label="Longest run now"
          value={
            best && best.current_streak > 0
              ? `${best.current_streak}${best.streak_unit === "week" ? "w" : "d"}`
              : "—"
          }
          detail={best && best.current_streak > 0 ? best.name : "No active streak"}
        />
        <StatTile
          label="Perfect days"
          value={String(data.perfect_days)}
          numeric={data.perfect_days}
          detail={`of ${plural(data.days_tracked, "day")}`}
        />
        <StatTile
          label="Habits"
          value={String(data.active_habits)}
          numeric={data.active_habits}
          detail={data.weakest_habit ? `Weakest: ${data.weakest_habit.name}` : undefined}
        />
      </div>

      {!!insights.data?.insights.length && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {insights.data.insights.slice(0, 3).map((insight) => (
            <div
              key={insight.title}
              className={cx("card px-3.5 py-3", TONE_STYLE[insight.tone])}
            >
              <div className="text-[13px] font-semibold text-ink">{insight.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                {insight.body}
              </p>
            </div>
          ))}
        </div>
      )}

      <ChartFrame
        title="The last year"
        subtitle="Each square is a day. Darker means more of what you planned actually happened; dashed squares are days before the habit existed."
      >
        {heatmap.data ? (
          <Heatmap days={heatmap.data.days} weekStart={heatmap.data.week_start} />
        ) : (
          <div className="h-28" />
        )}
      </ChartFrame>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Weekly completion"
          subtitle="Share of planned slots kept, week by week. The dashed tail is the week still running."
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
          title="Which days you keep"
          subtitle="Completion rate by day of the week. Your strongest day is highlighted."
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
        title="Habit by habit"
        subtitle={`Completion over ${RANGE_LABEL[range]}, strongest first.`}
        table={
          <DataTable
            head={["Habit", "Rate", "Kept", "Planned", "Streak", "Best"]}
            rows={data.habits.map((h) => [
              h.name,
              percent(h.rate),
              h.completed,
              h.expected,
              `${h.current_streak} ${h.streak_unit}${h.current_streak === 1 ? "" : "s"}`,
              `${h.longest_streak} ${h.streak_unit}${h.longest_streak === 1 ? "" : "s"}`,
            ])}
          />
        }
      >
        <HabitBars habits={data.habits} />
      </ChartFrame>
    </div>
  );
}
