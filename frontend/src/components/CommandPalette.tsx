import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, downloadCsv } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import type { GroupSummary, Habit } from "../lib/types";
import { cx, habitColor, useToast } from "./ui";

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  swatch?: string;
  emoji?: string | null;
  run: () => void;
}

/** Subsequence match, so "gm" finds "Gym" and "wkl" finds "Weekly review". */
function matches(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const target = haystack.toLowerCase();
  let i = 0;
  for (const char of needle.toLowerCase()) {
    i = target.indexOf(char, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

/** Month navigation lives in the Tracker page; the palette just asks for it. */
export function requestMonthShift(delta: number | "today") {
  window.dispatchEvent(new CustomEvent("habit:month", { detail: delta }));
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const navigate = useNavigate();
  const { setChoice } = useTheme();
  const { signOut } = useAuth();
  const toast = useToast();

  const habits = useQuery({
    queryKey: ["habits"],
    queryFn: () => api.get<Habit[]>("/api/habits"),
    enabled: open, // only fetched once someone actually opens the palette
  });

  const groups = useQuery({
    queryKey: ["groups", "mine"],
    queryFn: () => api.get<GroupSummary[]>("/api/groups"),
    enabled: open,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      navigate(path);
      close();
    };

    const habitCommands: Command[] = (habits.data ?? []).map((habit) => ({
      id: `habit-${habit.id}`,
      label: habit.name,
      group: "Habits",
      hint: habit.kind === "count" ? `${habit.target_per_day} a day` : undefined,
      swatch: habitColor(habit.color),
      emoji: habit.emoji,
      run: go(`/habit/${habit.id}`),
    }));

    const groupCommands: Command[] = (groups.data ?? []).map(({ group, unread }) => ({
      id: `group-${group.id}`,
      label: group.name,
      group: "Groups",
      hint: unread > 0 ? `${unread} new` : undefined,
      swatch: habitColor(group.color),
      emoji: group.emoji,
      run: go(`/groups/${group.id}`),
    }));

    return [
      ...habitCommands,
      ...groupCommands,
      {
        id: "new",
        label: "New habit",
        group: "Actions",
        hint: "n",
        run: () => {
          navigate("/");
          window.dispatchEvent(new CustomEvent("habit:new"));
          close();
        },
      },
      {
        id: "today",
        label: "Jump to this month",
        group: "Actions",
        run: () => {
          navigate("/");
          requestMonthShift("today");
          close();
        },
      },
      {
        id: "prev",
        label: "Previous month",
        group: "Actions",
        run: () => {
          navigate("/");
          requestMonthShift(-1);
          close();
        },
      },
      {
        id: "next",
        label: "Next month",
        group: "Actions",
        run: () => {
          navigate("/");
          requestMonthShift(1);
          close();
        },
      },
      {
        id: "export",
        label: "Export everything as CSV",
        group: "Actions",
        run: () => {
          downloadCsv().catch(() => toast.error("Could not export the CSV."));
          close();
        },
      },
      { id: "track", label: "Go to Track", group: "Go to", run: go("/") },
      { id: "groups", label: "Go to Groups", group: "Go to", run: go("/groups") },
      {
        id: "dash",
        label: "Go to Dashboard",
        group: "Go to",
        run: go("/dashboard"),
      },
      { id: "settings", label: "Go to Settings", group: "Go to", run: go("/settings") },
      {
        id: "light",
        label: "Theme: light",
        group: "Appearance",
        run: () => {
          setChoice("light");
          close();
        },
      },
      {
        id: "dark",
        label: "Theme: dark",
        group: "Appearance",
        run: () => {
          setChoice("dark");
          close();
        },
      },
      {
        id: "system",
        label: "Theme: match system",
        group: "Appearance",
        run: () => {
          setChoice("system");
          close();
        },
      },
      {
        id: "signout",
        label: "Sign out",
        group: "Appearance",
        run: () => {
          signOut();
          close();
        },
      },
    ];
  }, [habits.data, groups.data, navigate, close, setChoice, signOut, toast]);

  const filtered = useMemo(
    () => commands.filter((c) => matches(`${c.group} ${c.label}`, query)),
    [commands, query],
  );

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      filtered[active]?.run();
    }
  };

  let lastGroup = "";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="absolute inset-0 bg-[rgb(28_26_23/0.35)]"
        onClick={close}
        aria-hidden
      />
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-rule bg-surface shadow-pop motion-safe:animate-[pop-in_140ms_ease-out]">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search habits, jump somewhere, run something…"
          aria-label="Command palette search"
          role="combobox"
          aria-expanded
          aria-controls="command-list"
          className="w-full border-b border-rule bg-transparent px-4 py-3.5 text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
        />

        <ul
          id="command-list"
          ref={listRef}
          role="listbox"
          className="max-h-[52vh] overflow-y-auto py-1.5"
        >
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-ink-faint">
              Nothing matches that.
            </li>
          )}

          {filtered.map((command, index) => {
            const newGroup = command.group !== lastGroup;
            lastGroup = command.group;
            return (
              <li key={command.id}>
                {newGroup && (
                  <div className="eyebrow px-4 pb-1 pt-2.5">{command.group}</div>
                )}
                <button
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={command.run}
                  className={cx(
                    "flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13.5px]",
                    index === active ? "bg-sunk text-ink" : "text-ink-soft",
                  )}
                >
                  {command.swatch && (
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ backgroundColor: command.swatch }}
                    />
                  )}
                  <span className="flex-1 truncate">
                    {command.emoji && <span className="mr-1">{command.emoji}</span>}
                    {command.label}
                  </span>
                  {command.hint && (
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {command.hint}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-3 border-t border-rule px-4 py-2 text-[11px] text-ink-faint">
          <span>↑↓ move</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
