import { useQuery } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/realtime";
import { useTheme, type ThemeChoice } from "../lib/theme";
import type { GroupSummary } from "../lib/types";
import { cx } from "./ui";

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden fill="none">
      <rect x="1" y="1" width="7.5" height="7.5" rx="2" fill="var(--accent)" />
      <rect x="11.5" y="1" width="7.5" height="7.5" rx="2" fill="var(--rule-strong)" />
      <rect x="1" y="11.5" width="7.5" height="7.5" rx="2" fill="var(--rule-strong)" />
      <rect x="11.5" y="11.5" width="7.5" height="7.5" rx="2" fill="var(--accent)" />
    </svg>
  );
}

const THEME_LABEL: Record<ThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function ThemeButton() {
  const { choice, cycle } = useTheme();
  return (
    <button
      onClick={cycle}
      title={`Theme: ${THEME_LABEL[choice]}. Click to change.`}
      aria-label={`Theme: ${THEME_LABEL[choice]}. Click to change.`}
      className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-sunk hover:text-ink"
    >
      {choice === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M13.5 9.6A5.8 5.8 0 016.4 2.5a5.8 5.8 0 107.1 7.1z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ) : choice === "light" ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2L3.1 3.1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect
            x="1.5"
            y="2.7"
            width="13"
            height="9"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M5.5 13.8h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

function LiveDot({ status, devices }: { status: string; devices: number }) {
  // Only worth showing when it means something: another device is watching.
  if (status !== "live" || devices <= 1) return null;
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-rule px-2 py-0.5 text-[11px] text-ink-faint sm:inline-flex"
      title={`Syncing live with ${devices} devices`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
      Live
    </span>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = (user?.display_name || "?")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-rule-strong bg-sunk text-[11px] font-semibold text-ink-soft hover:text-ink"
      >
        {initials}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-40 w-52 rounded-lg border border-rule bg-surface py-1 shadow-pop"
        >
          <div className="border-b border-rule px-3 py-2">
            <div className="truncate text-[13px] font-medium text-ink">
              {user?.display_name}
            </div>
            <div className="truncate text-[11px] text-ink-faint">{user?.email}</div>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/settings");
            }}
            className="block w-full px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-sunk hover:text-ink"
          >
            Settings
          </button>
          <button
            role="menuitem"
            onClick={signOut}
            className="block w-full px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-sunk hover:text-ink"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const LINKS = [
  { to: "/", label: "Track", end: true },
  { to: "/dashboard", label: "Dashboard", end: false },
  { to: "/groups", label: "Groups", end: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { status, devices } = useRealtime(Boolean(user));

  // The socket invalidates ["groups"] on every incoming message, so this count
  // is live without any polling of its own.
  const groups = useQuery({
    queryKey: ["groups", "mine"],
    queryFn: () => api.get<GroupSummary[]>("/api/groups"),
    enabled: Boolean(user),
  });
  const unread = (groups.data ?? []).reduce((sum, g) => sum + g.unread, 0);

  return (
    <div className="relative z-1 min-h-screen">
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-4 px-4 sm:px-6">
          <div className="flex shrink-0 items-center gap-2">
            <Mark />
            {/* A third nav item pushed the header past a phone's width, so the
                wordmark stands down and the logo carries the identity. */}
            <span className="hidden font-display text-[16px] font-semibold tracking-tight text-ink sm:inline">
              Habit Tracker
            </span>
          </div>

          <nav
            className="-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto px-1"
            aria-label="Main"
          >
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cx(
                    "relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                    isActive
                      ? "bg-sunk text-ink"
                      : "text-ink-faint hover:bg-sunk hover:text-ink",
                  )
                }
              >
                {link.label}
                {link.to === "/groups" && unread > 0 && (
                  <span
                    className="tnum rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-on-accent"
                    aria-label={`${unread} unread messages`}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <LiveDot status={status} devices={devices} />
            <button
              onClick={() =>
                document.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "k", metaKey: true }),
                )
              }
              title="Search and commands"
              className="hidden items-center gap-2 rounded-md border border-rule-strong px-2 py-1 text-[12px] text-ink-faint transition-colors hover:bg-sunk hover:text-ink sm:flex"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <circle
                  cx="5.2"
                  cy="5.2"
                  r="3.4"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M7.8 7.8L10.5 10.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              Search
              <kbd className="rounded border border-rule bg-sunk px-1 font-sans text-[10px]">
                ⌘K
              </kbd>
            </button>
            <ThemeButton />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
