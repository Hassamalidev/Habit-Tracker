import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Button, Field, Input, Segmented, Select, useToast } from "../components/ui";
import { habitColor } from "../components/ui";
import { api, downloadCsv } from "../lib/api";
import { useAuth } from "../lib/auth";
import { WEEKDAY_LONG, guessTimezone } from "../lib/date";
import { useTheme, type ThemeChoice } from "../lib/theme";
import type { Habit } from "../lib/types";

function timezoneOptions(current: string): string[] {
  const detected = guessTimezone();
  let all: string[] = [];
  try {
    // Not in every browser yet, so fall back to just what is already in play.
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  const set = new Set([current, detected, "UTC", ...all]);
  return [...set].filter(Boolean);
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-ink-faint">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Settings() {
  const { user, updateUser, signOut } = useAuth();
  const { choice, setChoice } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [timezone, setTimezone] = useState(user?.timezone ?? "UTC");
  const [weekStart, setWeekStart] = useState(user?.week_start ?? 0);

  const zones = useMemo(() => timezoneOptions(user?.timezone ?? "UTC"), [user]);

  const dirty =
    displayName !== user?.display_name ||
    timezone !== user?.timezone ||
    weekStart !== user?.week_start;

  const save = useMutation({
    mutationFn: () =>
      updateUser({
        display_name: displayName.trim(),
        timezone,
        week_start: weekStart,
      }),
    onSuccess: () => {
      // Both the grid and every chart are computed in the user's zone.
      queryClient.invalidateQueries({ queryKey: ["grid"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast.notify("Settings saved");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not save settings."),
  });

  const archived = useQuery({
    queryKey: ["habits", "archived"],
    queryFn: async () => {
      const all = await api.get<Habit[]>("/api/habits?include_archived=true");
      return all.filter((habit) => habit.archived);
    },
  });

  const restore = useMutation({
    mutationFn: (habit: Habit) =>
      api.patch(`/api/habits/${habit.id}`, { archived: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["habits"] });
      queryClient.invalidateQueries({ queryKey: ["grid"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast.notify("Habit restored");
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="font-display text-[19px] text-ink">Settings</h1>

      <Section
        title="Your account"
        description="The timezone decides when your day rolls over, so streaks break at your midnight and not the server's."
      >
        <div className="space-y-4">
          <Field label="Display name">
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
            />
          </Field>

          <Field label="Email">
            <Input value={user?.email ?? ""} disabled readOnly />
          </Field>

          <Field label="Timezone">
            <Select
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Weeks start on"
            hint="Used by the heatmap and by habits measured in times per week."
          >
            <Select
              value={String(weekStart)}
              onChange={(event) => setWeekStart(Number(event.target.value))}
            >
              {WEEKDAY_LONG.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={!dirty}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              Save changes
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Appearance">
        <Segmented<ThemeChoice>
          ariaLabel="Theme"
          value={choice}
          onChange={setChoice}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
        />
      </Section>

      <Section
        title="Archived habits"
        description="Archiving hides a habit from the grid but keeps every day you logged."
      >
        {archived.isLoading ? (
          <p className="text-sm text-ink-faint">Loading…</p>
        ) : archived.data?.length ? (
          <ul className="divide-y divide-rule">
            {archived.data.map((habit) => (
              <li key={habit.id} className="flex items-center gap-3 py-2.5">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: habitColor(habit.color) }}
                />
                <span className="flex-1 truncate text-sm text-ink">
                  {habit.emoji && <span className="mr-1">{habit.emoji}</span>}
                  {habit.name}
                </span>
                <Button
                  size="sm"
                  onClick={() => restore.mutate(habit)}
                  loading={restore.isPending && restore.variables?.id === habit.id}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-faint">Nothing archived.</p>
        )}
      </Section>

      <Section
        title="Your data"
        description="Every tick you have ever made, as a spreadsheet. No lock-in."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              downloadCsv().catch(() => toast.error("Could not export the CSV."))
            }
          >
            Export everything as CSV
          </Button>
          <Button variant="quiet" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Section>
    </div>
  );
}
