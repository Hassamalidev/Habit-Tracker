import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Spinner,
  cx,
  habitColor,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { COLOR_TOKENS } from "../lib/types";
import type { ColorToken, Discover, GroupSummary } from "../lib/types";

function whenLast(iso: string | null): string {
  if (!iso) return "no messages yet";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function GroupCard({
  summary,
  onJoin,
  joining,
}: {
  summary: GroupSummary;
  onJoin?: (id: string) => void;
  joining?: boolean;
}) {
  const { group } = summary;

  const body = (
    <>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[15px]"
          style={{
            backgroundColor: `color-mix(in srgb, ${habitColor(group.color)} 14%, transparent)`,
          }}
        >
          {group.emoji ?? "#"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium text-ink">
              {group.name}
            </span>
            {summary.unread > 0 && (
              <span className="tnum shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-on-accent">
                {summary.unread}
              </span>
            )}
          </div>

          {group.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-ink-faint">
              {group.description}
            </p>
          )}

          <p className="mt-1 line-clamp-1 text-xs text-ink-soft">
            {summary.last_message_preview ?? (
              <span className="text-ink-faint">No messages yet</span>
            )}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-faint">
            <span className="tnum">
              {summary.member_count}{" "}
              {summary.member_count === 1 ? "member" : "members"}
            </span>
            {summary.online_count > 0 && (
              <span className="flex items-center gap-1">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                {summary.online_count} online
              </span>
            )}
            {/* The preview line already says so when a room is empty. */}
            {summary.last_message_at && (
              <span>{whenLast(summary.last_message_at)}</span>
            )}
          </div>

          {summary.matched_habit && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-rule px-2 py-0.5 text-[11px] text-ink-soft">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-[2px]"
                style={{ backgroundColor: habitColor(group.color) }}
              />
              you track {summary.matched_habit}
            </span>
          )}
        </div>

        {onJoin && (
          <Button
            size="sm"
            loading={joining}
            onClick={(event) => {
              event.preventDefault();
              onJoin(group.id);
            }}
          >
            Join
          </Button>
        )}
      </div>
    </>
  );

  if (onJoin) return <div className="card p-3.5">{body}</div>;

  return (
    <Link
      to={`/groups/${group.id}`}
      className="card block p-3.5 transition-colors hover:border-rule-strong"
    >
      {body}
    </Link>
  );
}

function CreateDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<ColorToken>("evergreen");
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const create = useMutation({
    mutationFn: () =>
      api.post<GroupSummary>("/api/groups", {
        name: name.trim(),
        emoji: emoji || null,
        description: description.trim() || null,
        color,
      }),
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      onClose();
      setName("");
      setEmoji("");
      setDescription("");
      navigate(`/groups/${summary.group.id}`);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Could not create the group."),
  });

  return (
    <Modal open={open} title="New group" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          if (name.trim().length < 2) {
            setError("Give the group a name.");
            return;
          }
          create.mutate();
        }}
      >
        <p className="text-xs text-ink-faint">
          Name it after the habit it is about — people who track something with that
          name will see it suggested to them.
        </p>

        <div className="flex gap-3">
          <div className="w-20 shrink-0">
            <Field label="Icon">
              <Input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
                placeholder="—"
                className="text-center text-lg"
                aria-label="Group icon"
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Gym, Prayer, Reading…"
                maxLength={60}
                autoFocus
              />
            </Field>
          </div>
        </div>

        <Field label="What is it for?" hint="Optional">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Early morning lifters, keeping each other honest"
            maxLength={280}
          />
        </Field>

        <Field label="Colour">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {COLOR_TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                role="radio"
                aria-checked={color === token}
                aria-label={token}
                onClick={() => setColor(token)}
                className={cx(
                  "h-7 w-7 rounded-md border-2 transition-transform",
                  color === token
                    ? "scale-110 border-ink"
                    : "border-transparent hover:scale-105",
                )}
                style={{ backgroundColor: habitColor(token) }}
              />
            ))}
          </div>
        </Field>

        {error && (
          <p className="rounded-md border border-danger px-3 py-2 text-sm text-danger-ink">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create group
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function Groups() {
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const mine = useQuery({
    queryKey: ["groups", "mine"],
    queryFn: () => api.get<GroupSummary[]>("/api/groups"),
  });

  const discover = useQuery({
    queryKey: ["groups", "discover"],
    queryFn: () => api.get<Discover>("/api/groups/discover"),
  });

  const join = useMutation({
    mutationFn: (groupId: string) =>
      api.post<GroupSummary>(`/api/groups/${groupId}/join`),
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      toast.notify(`Joined ${summary.group.name}`);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not join."),
  });

  if (mine.isLoading) return <Spinner label="Loading your groups" />;

  const suggested = discover.data?.suggested ?? [];
  const others = discover.data?.others ?? [];
  const joined = mine.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[19px] text-ink">Groups</h1>
          <p className="text-xs text-ink-faint">
            Rooms built around a habit. Talk to people working on the same thing.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <span aria-hidden>+</span> New group
        </Button>
      </div>

      {joined.length > 0 ? (
        <section>
          <h2 className="eyebrow mb-2">Your groups</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {joined.map((summary) => (
              <GroupCard key={summary.group.id} summary={summary} />
            ))}
          </div>
        </section>
      ) : (
        <div className="card">
          <EmptyState
            title="You are not in any groups yet"
            body="Join one below, or start a room for a habit you care about. Groups are matched to the habits you already track."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create a group
              </Button>
            }
          />
        </div>
      )}

      {suggested.length > 0 && (
        <section>
          <h2 className="eyebrow mb-2">Because of what you track</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {suggested.map((summary) => (
              <GroupCard
                key={summary.group.id}
                summary={summary}
                onJoin={(id) => join.mutate(id)}
                joining={join.isPending && join.variables === summary.group.id}
              />
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h2 className="eyebrow mb-2">Everything else</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {others.map((summary) => (
              <GroupCard
                key={summary.group.id}
                summary={summary}
                onJoin={(id) => join.mutate(id)}
                joining={join.isPending && join.variables === summary.group.id}
              />
            ))}
          </div>
        </section>
      )}

      <CreateDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
