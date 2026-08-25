import type { Streak } from "./types";

/** Runs worth stopping to notice. Sparse on purpose, so the praise stays cheap. */
const DAY_MARKS = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 250, 300, 365];
const WEEK_MARKS = [2, 4, 8, 12, 16, 26, 39, 52];

function crossed(marks: number[], before: number, after: number): number | null {
  if (after <= before) return null;
  // Only the highest mark cleared by this tick, so one write never fires twice.
  const hit = marks.filter((m) => m > before && m <= after);
  return hit.length ? hit[hit.length - 1] : null;
}

export interface Milestone {
  value: number;
  unit: "day" | "week";
  isRecord: boolean;
}

/**
 * Did this write push a habit past a milestone?
 *
 * Compares the streak the server just reported against the one held before, so
 * it cannot fire on a refetch, a page load, or another device's change.
 */
export function milestoneReached(
  before: Streak | undefined,
  after: Streak,
): Milestone | null {
  if (!before) return null;
  const marks = after.unit === "week" ? WEEK_MARKS : DAY_MARKS;
  const value = crossed(marks, before.current, after.current);
  if (value === null) return null;
  return {
    value,
    unit: after.unit,
    isRecord: after.current >= after.longest && after.longest > before.longest,
  };
}

export function milestoneMessage(habitName: string, milestone: Milestone): string {
  const unit = `${milestone.unit}${milestone.value === 1 ? "" : "s"}`;
  return milestone.isRecord
    ? `${milestone.value} ${unit} of ${habitName} — a new best.`
    : `${milestone.value} ${unit} of ${habitName} in a row.`;
}
