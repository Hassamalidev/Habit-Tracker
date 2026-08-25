export type HabitKind = "binary" | "count";
export type ScheduleType = "daily" | "weekdays" | "weekly_count";

export const COLOR_TOKENS = [
  "evergreen",
  "clay",
  "indigo",
  "ochre",
  "plum",
  "teal",
  "rose",
  "violet",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

export interface User {
  id: string;
  email: string;
  display_name: string;
  timezone: string;
  week_start: number;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Habit {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  color: ColorToken;
  kind: HabitKind;
  target_per_day: number;
  unit: string | null;
  schedule_type: ScheduleType;
  weekdays: number[];
  weekly_target: number;
  position: number;
  archived: boolean;
  start_date: string | null;
  created_at: string;
}

export interface Streak {
  current: number;
  longest: number;
  unit: "day" | "week";
}

export interface GridRow {
  habit: Habit;
  values: Record<string, number>;
  notes: Record<string, string>;
  streak: Streak;
  scheduled_days: number;
  completed_days: number;
}

export interface GridResponse {
  month: string;
  days: string[];
  today: string;
  rows: GridRow[];
}

export interface Group {
  id: string;
  name: string;
  slug: string;
  topic: string;
  description: string | null;
  emoji: string | null;
  color: ColorToken;
  created_at: string;
}

export interface GroupSummary {
  group: Group;
  member_count: number;
  online_count: number;
  is_member: boolean;
  unread: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  /** The habit of yours that caused this group to be suggested. */
  matched_habit: string | null;
}

export interface GroupMember {
  user_id: string;
  display_name: string;
  online: boolean;
  joined_at: string;
}

export interface GroupDetail {
  group: Group;
  members: GroupMember[];
  is_member: boolean;
  member_count: number;
}

export interface Discover {
  suggested: GroupSummary[];
  others: GroupSummary[];
}

export interface ChatMessage {
  id: string;
  group_id: string;
  user_id: string;
  author: string;
  body: string;
  kind: "text" | "progress";
  meta: {
    habit?: string;
    emoji?: string | null;
    color?: ColorToken;
    current?: number;
    longest?: number;
    unit?: "day" | "week";
  } | null;
  created_at: string;
}

export interface MessagePage {
  messages: ChatMessage[];
  has_more: boolean;
}

export interface EntryWriteOut {
  entry: EntryOut | null;
  habit_id: string;
  streak: Streak;
}

export interface BulkWriteOut {
  entries: EntryOut[];
  streaks: Record<string, Streak>;
}

export interface EntryOut {
  id: string;
  habit_id: string;
  day: string;
  value: number;
  note: string | null;
  updated_at: string;
}

export interface HabitStat {
  habit_id: string;
  name: string;
  emoji: string | null;
  color: ColorToken;
  kind: HabitKind;
  unit: string | null;
  schedule_type: ScheduleType;
  expected: number;
  completed: number;
  rate: number;
  current_streak: number;
  longest_streak: number;
  streak_unit: "day" | "week";
  total_value: number;
}

export interface Summary {
  range: { from: string; to: string };
  today: string;
  active_habits: number;
  completion_rate: number;
  completed_slots: number;
  expected_slots: number;
  perfect_days: number;
  days_tracked: number;
  momentum: { recent_rate: number; prior_rate: number; delta: number };
  best_streak: HabitStat | null;
  weakest_habit: HabitStat | null;
  habits: HabitStat[];
}

export interface HeatmapDay {
  day: string;
  expected: number;
  completed: number;
  ratio: number;
  perfect: boolean;
  future: boolean;
}

export interface WeekdayBucket {
  weekday: number;
  label: string;
  short: string;
  expected: number;
  completed: number;
  rate: number;
}

export interface TrendWeek {
  week_start: string;
  label: string;
  rate: number;
  completed: number;
  expected: number;
  partial: boolean;
}

export interface Insight {
  tone: "positive" | "neutral" | "warning";
  title: string;
  body: string;
}

export interface HabitDraft {
  name: string;
  description?: string | null;
  emoji?: string | null;
  color: ColorToken;
  kind: HabitKind;
  target_per_day: number;
  unit?: string | null;
  schedule_type: ScheduleType;
  weekdays: number[];
  weekly_target: number;
}
