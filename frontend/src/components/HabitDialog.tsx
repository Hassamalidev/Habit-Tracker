import { useEffect, useState } from "react";

import { WEEKDAY_SHORT } from "../lib/date";
import { COLOR_TOKENS } from "../lib/types";
import type { ColorToken, Habit, HabitDraft, HabitKind, ScheduleType } from "../lib/types";
import { Button, Field, Input, Modal, Segmented, Select, cx, habitColor } from "./ui";

const QUICK_EMOJI = ["🕌", "🏋", "📖", "💧", "🏃", "🌙", "🧘", "✍", "🍎", "💊", "🧹", "💻"];

const EMPTY: HabitDraft = {
  name: "",
  description: "",
  emoji: null,
  color: "evergreen",
  kind: "binary",
  target_per_day: 1,
  unit: "",
  schedule_type: "daily",
  weekdays: [0, 2, 4],
  weekly_target: 3,
};

interface Props {
  open: boolean;
  habit: Habit | null;
  onClose: () => void;
  onSave: (draft: HabitDraft) => Promise<void>;
  onArchive?: (habit: Habit) => Promise<void>;
  onDelete?: (habit: Habit) => Promise<void>;
}

export function HabitDialog({
  open,
  habit,
  onClose,
  onSave,
  onArchive,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<HabitDraft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmDelete(false);
    setDraft(
      habit
        ? {
            name: habit.name,
            description: habit.description ?? "",
            emoji: habit.emoji,
            color: habit.color,
            kind: habit.kind,
            target_per_day: habit.target_per_day,
            unit: habit.unit ?? "",
            schedule_type: habit.schedule_type,
            weekdays: habit.weekdays.length ? habit.weekdays : [0, 2, 4],
            weekly_target: habit.weekly_target,
          }
        : EMPTY,
    );
  }, [open, habit]);

  const patch = (changes: Partial<HabitDraft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const toggleWeekday = (index: number) => {
    const next = draft.weekdays.includes(index)
      ? draft.weekdays.filter((d) => d !== index)
      : [...draft.weekdays, index].sort((a, b) => a - b);
    patch({ weekdays: next });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError("Give the habit a name.");
      return;
    }
    if (draft.schedule_type === "weekdays" && draft.weekdays.length === 0) {
      setError("Pick at least one day of the week.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...draft,
        name: draft.name.trim(),
        description: draft.description?.trim() || null,
        unit: draft.kind === "count" ? draft.unit?.trim() || null : null,
        // A binary habit is always a target of one; the server rejects anything else.
        target_per_day: draft.kind === "count" ? draft.target_per_day : 1,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the habit.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={habit ? "Edit habit" : "New habit"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex gap-3">
          <div className="w-20 shrink-0">
            <Field label="Icon">
              <Input
                value={draft.emoji ?? ""}
                onChange={(e) => patch({ emoji: e.target.value.slice(0, 2) || null })}
                placeholder="—"
                className="text-center text-lg"
                aria-label="Habit icon"
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Prayer, Gym, Read…"
                autoFocus
                maxLength={80}
              />
            </Field>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {QUICK_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => patch({ emoji })}
              className={cx(
                "h-7 w-7 rounded border text-sm transition-colors",
                draft.emoji === emoji
                  ? "border-accent bg-accent-soft"
                  : "border-rule hover:bg-sunk",
              )}
              aria-label={`Use ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>

        <Field label="Colour">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {COLOR_TOKENS.map((token: ColorToken) => (
              <button
                key={token}
                type="button"
                role="radio"
                aria-checked={draft.color === token}
                aria-label={token}
                onClick={() => patch({ color: token })}
                className={cx(
                  "h-7 w-7 rounded-md border-2 transition-transform",
                  draft.color === token
                    ? "scale-110 border-ink"
                    : "border-transparent hover:scale-105",
                )}
                style={{ backgroundColor: habitColor(token) }}
              />
            ))}
          </div>
        </Field>

        <Field
          label="How is it measured?"
          hint={
            draft.kind === "binary"
              ? "One tick per day — done or not done."
              : "Counts up to a daily target, and the grid fills as you go."
          }
        >
          <Segmented<HabitKind>
            ariaLabel="Measurement"
            value={draft.kind}
            onChange={(kind) =>
              patch({ kind, target_per_day: kind === "count" ? 5 : 1 })
            }
            options={[
              { value: "binary", label: "A simple tick" },
              { value: "count", label: "A count" },
            ]}
          />
        </Field>

        {draft.kind === "count" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Daily target">
              <Input
                type="number"
                min={1}
                max={1000}
                value={draft.target_per_day}
                onChange={(e) =>
                  patch({ target_per_day: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            </Field>
            <Field label="Unit" hint="Optional">
              <Input
                value={draft.unit ?? ""}
                onChange={(e) => patch({ unit: e.target.value })}
                placeholder="prayers, pages, glasses"
                maxLength={24}
              />
            </Field>
          </div>
        )}

        <Field label="How often?">
          <Select
            value={draft.schedule_type}
            onChange={(e) => patch({ schedule_type: e.target.value as ScheduleType })}
          >
            <option value="daily">Every day</option>
            <option value="weekdays">On chosen days of the week</option>
            <option value="weekly_count">A number of times each week</option>
          </Select>
        </Field>

        {draft.schedule_type === "weekdays" && (
          <div className="flex gap-1.5">
            {WEEKDAY_SHORT.map((label, index) => {
              const on = draft.weekdays.includes(index);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleWeekday(index)}
                  className={cx(
                    "h-9 flex-1 rounded-md border text-xs font-medium transition-colors",
                    on
                      ? "border-accent bg-accent text-on-accent"
                      : "border-rule-strong text-ink-soft hover:bg-sunk",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {draft.schedule_type === "weekly_count" && (
          <Field
            label="Times per week"
            hint="Any days you like — the streak counts weeks, not days."
          >
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={draft.weekly_target === n}
                  onClick={() => patch({ weekly_target: n })}
                  className={cx(
                    "tnum h-9 flex-1 rounded-md border text-sm font-medium transition-colors",
                    draft.weekly_target === n
                      ? "border-accent bg-accent text-on-accent"
                      : "border-rule-strong text-ink-soft hover:bg-sunk",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Note to self" hint="Optional">
          <Input
            value={draft.description ?? ""}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Why this matters"
            maxLength={280}
          />
        </Field>

        {error && (
          <p className="rounded-md border border-danger px-3 py-2 text-sm text-danger-ink">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between border-t border-rule pt-4">
          <div className="flex gap-2">
            {habit && onArchive && (
              <Button
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => onArchive(habit).then(onClose)}
              >
                Archive
              </Button>
            )}
            {habit && onDelete && (
              <Button
                type="button"
                variant={confirmDelete ? "danger" : "quiet"}
                size="sm"
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    return;
                  }
                  onDelete(habit).then(onClose);
                }}
              >
                {confirmDelete ? "Delete for good?" : "Delete"}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {habit ? "Save changes" : "Create habit"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
