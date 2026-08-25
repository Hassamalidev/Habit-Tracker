import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Button, Modal, Spinner, cx, habitColor, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDayLong, todayISO } from "../lib/date";
import { COLOR_TOKENS } from "../lib/types";
import type {
  ChatMessage,
  GroupDetail,
  Habit,
  MessagePage,
} from "../lib/types";

/** A stable colour per person, so faces are recognisable down a long thread. */
function avatarColor(userId: string): string {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return habitColor(COLOR_TOKENS[hash % COLOR_TOKENS.length]);
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${`${d.getDate()}`.padStart(2, "0")}`;
}

function dayLabel(iso: string): string {
  return dayOf(iso) === todayISO() ? "Today" : formatDayLong(dayOf(iso));
}

/* ------------------------------------------------------------ share a streak */

function ShareDialog({
  open,
  onClose,
  groupId,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
}) {
  const [note, setNote] = useState("");
  const [habitId, setHabitId] = useState<string | null>(null);
  const toast = useToast();

  const habits = useQuery({
    queryKey: ["habits"],
    queryFn: () => api.get<Habit[]>("/api/habits"),
    enabled: open,
  });

  const share = useMutation({
    mutationFn: () =>
      api.post(`/api/groups/${groupId}/share`, {
        habit_id: habitId,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      setNote("");
      setHabitId(null);
      onClose();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not share that."),
  });

  return (
    <Modal open={open} title="Share a streak" onClose={onClose}>
      <p className="mb-3 text-xs text-ink-faint">
        The figures are read from your own record when you post, so what the group
        sees is what you actually did.
      </p>

      {habits.isLoading ? (
        <Spinner label="Loading habits" />
      ) : habits.data?.length ? (
        <div className="space-y-3">
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {habits.data.map((habit) => (
              <li key={habit.id}>
                <button
                  type="button"
                  onClick={() => setHabitId(habit.id)}
                  aria-pressed={habitId === habit.id}
                  className={cx(
                    "flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[13px] transition-colors",
                    habitId === habit.id
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-rule text-ink-soft hover:bg-sunk",
                  )}
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: habitColor(habit.color) }}
                  />
                  {habit.emoji && <span>{habit.emoji}</span>}
                  {habit.name}
                </button>
              </li>
            ))}
          </ul>

          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Say something about it (optional)"
            maxLength={280}
            aria-label="Note"
            className="w-full rounded-md border border-rule-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />

          <div className="flex justify-end gap-2 border-t border-rule pt-3">
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!habitId}
              loading={share.isPending}
              onClick={() => share.mutate()}
            >
              Post it
            </Button>
          </div>
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-ink-faint">
          You have no habits to share yet.
        </p>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- one message */

function ProgressCard({ message }: { message: ChatMessage }) {
  const meta = message.meta ?? {};
  const color = habitColor(meta.color ?? "evergreen");
  const unit = `${meta.unit ?? "day"}${meta.current === 1 ? "" : "s"}`;
  const isBest = (meta.current ?? 0) >= (meta.longest ?? 0);

  return (
    <div
      className="mt-1 inline-flex max-w-full items-center gap-3 rounded-lg border px-3 py-2"
      style={{
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      <span className="text-base leading-none" aria-hidden>
        {meta.emoji ?? "🔥"}
      </span>
      <span className="min-w-0">
        <span className="tnum block text-[15px] font-semibold text-ink">
          {meta.current} {unit}
          <span className="ml-1.5 font-normal text-ink-soft">on {meta.habit}</span>
        </span>
        <span className="text-[11px] text-ink-faint">
          {isBest ? "personal best" : `best so far ${meta.longest} ${meta.unit}s`}
        </span>
      </span>
    </div>
  );
}

function MessageRow({
  message,
  compact,
  mine,
}: {
  message: ChatMessage;
  compact: boolean;
  mine: boolean;
}) {
  return (
    <div
      className={cx(
        "flex gap-2.5 px-1",
        compact ? "mt-0.5" : "mt-3",
        mine && "bg-sunk/40 -mx-1 rounded-md px-2 py-0.5",
      )}
    >
      <div className="w-7 shrink-0">
        {!compact && (
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ backgroundColor: avatarColor(message.user_id) }}
          >
            {initials(message.author)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-ink">
              {mine ? "You" : message.author}
            </span>
            <span className="tnum text-[10px] text-ink-faint">
              {clockTime(message.created_at)}
            </span>
          </div>
        )}

        {message.kind === "progress" ? (
          <ProgressCard message={message} />
        ) : (
          <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink-soft">
            {message.body}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the room */

export function GroupChat() {
  const { groupId = "" } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const [draft, setDraft] = useState("");
  const [sharing, setSharing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const detail = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => api.get<GroupDetail>(`/api/groups/${groupId}`),
    // Who is online changes without any message being sent, and refreshing on
    // every message would double the chat's traffic for a green dot.
    refetchInterval: 30_000,
  });

  const isMember = detail.data?.is_member ?? false;

  const page = useQuery({
    queryKey: ["group-messages", groupId],
    queryFn: () => api.get<MessagePage>(`/api/groups/${groupId}/messages`),
    enabled: isMember,
  });

  const markRead = useCallback(() => {
    api
      .post(`/api/groups/${groupId}/read`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["groups"] }))
      .catch(() => {
        /* a failed read receipt is not worth interrupting anyone over */
      });
  }, [groupId, queryClient]);

  // Opening the room clears its badge, and so does anything arriving while it is open.
  useEffect(() => {
    if (isMember) markRead();
  }, [isMember, markRead, page.data?.messages.length]);

  // Stay pinned to the newest line unless the reader has scrolled up to look back.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [page.data?.messages.length]);

  const send = useMutation({
    mutationFn: (body: string) =>
      api.post<ChatMessage>(`/api/groups/${groupId}/messages`, { body }),
    onSuccess: (message) => {
      // The server excludes the sender from its own broadcast, so this tab
      // appends the message itself rather than waiting for an echo.
      queryClient.setQueryData<MessagePage>(
        ["group-messages", groupId],
        (current) =>
          !current || current.messages.some((m) => m.id === message.id)
            ? current
            : { ...current, messages: [...current.messages, message] },
      );
      pinned.current = true;
      queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (err, body) => {
      setDraft(body); // hand the text back rather than losing it
      toast.error(err instanceof Error ? err.message : "Could not send that.");
    },
  });

  const join = useMutation({
    mutationFn: () => api.post(`/api/groups/${groupId}/join`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });

  const leave = useMutation({
    mutationFn: () => api.del(`/api/groups/${groupId}/leave`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      toast.notify("You left the group");
      navigate("/groups");
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    send.mutate(body);
  };

  if (detail.isLoading) return <Spinner label="Opening the room" />;

  if (detail.isError || !detail.data)
    return (
      <div className="card px-4 py-10 text-center">
        <p className="text-sm text-danger-ink">That group could not be opened.</p>
        <Link to="/groups">
          <Button className="mt-3" size="sm">
            Back to groups
          </Button>
        </Link>
      </div>
    );

  const { group, members, member_count } = detail.data;
  const online = members.filter((m) => m.online).length;
  const messages = page.data?.messages ?? [];

  return (
    <div className="space-y-3">
      <Link
        to="/groups"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-faint hover:text-ink"
      >
        <span aria-hidden>←</span> All groups
      </Link>

      <div className="grid gap-4 lg:grid-cols-[1fr_216px]">
        <div className="card flex h-[68vh] min-h-[420px] flex-col overflow-hidden">
          <header className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[15px]"
                style={{
                  backgroundColor: `color-mix(in srgb, ${habitColor(group.color)} 14%, transparent)`,
                }}
              >
                {group.emoji ?? "#"}
              </span>
              <div className="min-w-0">
                <h1 className="truncate font-display text-[16px] text-ink">
                  {group.name}
                </h1>
                <p className="truncate text-[11px] text-ink-faint">
                  {member_count} {member_count === 1 ? "member" : "members"}
                  {online > 0 && ` · ${online} online`}
                  {group.description && ` · ${group.description}`}
                </p>
              </div>
            </div>

            {isMember && (
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => setSharing(true)}>
                  Share a streak
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  loading={leave.isPending}
                  onClick={() => leave.mutate()}
                >
                  Leave
                </Button>
              </div>
            )}
          </header>

          {!isMember ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="max-w-sm text-sm text-ink-soft">
                Join {group.name} to read along and post. Groups are open to anyone
                tracking the same thing.
              </p>
              <Button
                variant="primary"
                loading={join.isPending}
                onClick={() => join.mutate()}
              >
                Join this group
              </Button>
            </div>
          ) : (
            <>
              <div
                ref={scrollRef}
                onScroll={(event) => {
                  const el = event.currentTarget;
                  pinned.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                }}
                className="flex-1 overflow-y-auto px-3 py-2"
              >
                {page.isLoading && <Spinner label="Loading messages" />}

                {!page.isLoading && messages.length === 0 && (
                  <p className="py-10 text-center text-sm text-ink-faint">
                    Nothing here yet. Say hello, or share a streak.
                  </p>
                )}

                {messages.map((message, index) => {
                  const previous = messages[index - 1];
                  const newDay =
                    !previous ||
                    dayOf(previous.created_at) !== dayOf(message.created_at);
                  // Consecutive lines from one person within five minutes read as
                  // one turn, so the thread does not repeat a name every line.
                  const compact =
                    !newDay &&
                    previous?.user_id === message.user_id &&
                    message.kind === "text" &&
                    previous?.kind === "text" &&
                    new Date(message.created_at).getTime() -
                      new Date(previous.created_at).getTime() <
                      5 * 60 * 1000;

                  return (
                    <div key={message.id}>
                      {newDay && (
                        <div className="my-3 flex items-center gap-3">
                          <span className="h-px flex-1 bg-rule" />
                          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                            {dayLabel(message.created_at)}
                          </span>
                          <span className="h-px flex-1 bg-rule" />
                        </div>
                      )}
                      <MessageRow
                        message={message}
                        compact={compact}
                        mine={message.user_id === user?.id}
                      />
                    </div>
                  );
                })}
              </div>

              <form
                onSubmit={submit}
                className="flex items-end gap-2 border-t border-rule px-3 py-2.5"
              >
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submit(event);
                    }
                  }}
                  rows={1}
                  maxLength={2000}
                  placeholder={`Message ${group.name}…`}
                  aria-label={`Message ${group.name}`}
                  className="max-h-28 min-h-9 flex-1 resize-none rounded-md border border-rule-strong bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!draft.trim()}
                >
                  Send
                </Button>
              </form>
            </>
          )}
        </div>

        <aside className="card hidden h-fit p-3 lg:block">
          <h2 className="eyebrow mb-2">Members</h2>
          <ul className="space-y-1.5">
            {members.map((member) => (
              <li key={member.user_id} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                  style={{ backgroundColor: avatarColor(member.user_id) }}
                >
                  {initials(member.display_name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">
                  {member.user_id === user?.id ? "You" : member.display_name}
                </span>
                {member.online && (
                  <span
                    aria-label="online"
                    title="online"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  />
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <ShareDialog
        open={sharing}
        groupId={groupId}
        onClose={() => setSharing(false)}
      />
    </div>
  );
}
