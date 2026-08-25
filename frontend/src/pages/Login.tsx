import { useState } from "react";

import { useAuth } from "../lib/auth";
import { Button, Field, Input, cx } from "../components/ui";

type Mode = "signin" | "signup";

/** One source of truth: the button below and the printed hint sign in as the
 *  same account, so the credentials on screen can never drift from the ones
 *  that actually work. These match what `backend/seed_demo.py` creates. */
const DEMO = { email: "demo@example.com", password: "demo12345" };

/** A small static sample of the grid, so the page shows what it is offering. */
function Preview() {
  // `null` marks a day the habit was never scheduled on, which the caption explains.
  const rows: {
    name: string;
    emoji: string;
    color: string;
    marks: (number | null)[];
  }[] = [
    { name: "Prayer", emoji: "🕌", color: "var(--h-evergreen)", marks: [1, 1, 0.6, 1, 1, 1, 0.8] },
    { name: "Gym", emoji: "🏋", color: "var(--h-clay)", marks: [1, null, 1, null, 1, null, null] },
    { name: "Read", emoji: "📖", color: "var(--h-indigo)", marks: [0.5, 1, 1, 0, 1, 1, 0] },
    { name: "Water", emoji: "💧", color: "var(--h-teal)", marks: [1, 1, 1, 0.75, 1, 0.5, 1] },
  ];

  return (
    <div className="card w-full max-w-sm p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-display text-[15px] font-semibold text-ink">August</span>
        <span className="eyebrow">Mon — Sun</span>
      </div>
      <div className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.name} className="flex items-center gap-3">
            <span className="w-20 shrink-0 truncate text-[12px] text-ink-soft">
              <span className="mr-1">{row.emoji}</span>
              {row.name}
            </span>
            <div className="flex gap-1.5">
              {row.marks.map((mark, i) =>
                mark === null ? (
                  <span key={i} className="flex h-5 w-5 items-center justify-center">
                    <span className="h-1 w-1 rounded-full bg-rule-strong" />
                  </span>
                ) : (
                  <span
                    key={i}
                    className="relative block h-5 w-5 overflow-hidden rounded-[5px] border"
                    style={{
                      borderColor: mark > 0 ? "transparent" : "var(--rule-strong)",
                      backgroundColor:
                        mark >= 1
                          ? row.color
                          : mark > 0
                            ? `color-mix(in srgb, ${row.color} 16%, transparent)`
                            : "transparent",
                    }}
                  >
                    {mark > 0 && mark < 1 && (
                      <span
                        className="absolute inset-x-0 bottom-0 block"
                        style={{ height: `${mark * 100}%`, backgroundColor: row.color }}
                      />
                    )}
                  </span>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 border-t border-rule pt-3 text-[11px] leading-relaxed text-ink-faint">
        A filled square is a day you kept. A part-filled one is a count that fell short.
        A dot is a day the habit never asked for.
      </p>
    </div>
  );
}

export function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    run(() =>
      mode === "signin"
        ? signIn(email.trim(), password)
        : signUp(email.trim(), password, displayName.trim() || email.split("@")[0]),
    );
  };

  return (
    <div className="relative z-1 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-4xl items-center gap-10 md:grid-cols-2">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="font-display text-[30px] leading-tight text-ink">
            Keep the days you meant to keep.
          </h1>
          <p className="mt-2 mb-7 text-[14px] leading-relaxed text-ink-soft">
            One grid for the month, one tick per day, and an honest picture of what it
            adds up to.
          </p>

          <div className="mb-5 inline-flex rounded-md border border-rule-strong bg-sunk p-0.5">
            {(["signin", "signup"] as Mode[]).map((option) => (
              <button
                key={option}
                onClick={() => {
                  setMode(option);
                  setError(null);
                }}
                className={cx(
                  "rounded-[5px] px-3 py-1 text-[13px] font-medium transition-colors",
                  mode === option
                    ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
                    : "text-ink-faint hover:text-ink",
                )}
              >
                {option === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3.5">
            {mode === "signup" && (
              <Field label="Name">
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </Field>
            )}

            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </Field>

            <Field
              label="Password"
              hint={mode === "signup" ? "At least 8 characters." : undefined}
            >
              <Input
                type="password"
                required
                minLength={mode === "signup" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </Field>

            {error && (
              <p
                role="alert"
                className="rounded-md border border-danger px-3 py-2 text-sm text-danger-ink"
              >
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" loading={busy} className="w-full">
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="mt-4 flex items-center gap-3 text-[11px] text-ink-faint">
            <span className="h-px flex-1 bg-rule" />
            or
            <span className="h-px flex-1 bg-rule" />
          </div>

          <Button
            variant="secondary"
            className="mt-4 w-full"
            disabled={busy}
            onClick={() =>
              run(async () => {
                try {
                  await signIn(DEMO.email, DEMO.password);
                } catch {
                  throw new Error(
                    "No demo account on this server. Run seed_demo.py to create one.",
                  );
                }
              })
            }
          >
            Explore the demo account
          </Button>

          <div className="mt-3 rounded-md border border-dashed border-rule-strong bg-sunk/50 px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="eyebrow mb-1">Demo login</div>
                <dl className="space-y-0.5 text-[12.5px]">
                  <div className="flex gap-2">
                    <dt className="w-[72px] shrink-0 text-ink-faint">Email</dt>
                    <dd className="tnum truncate font-medium text-ink" translate="no">
                      {DEMO.email}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-[72px] shrink-0 text-ink-faint">Password</dt>
                    <dd className="tnum font-medium text-ink" translate="no">
                      {DEMO.password}
                    </dd>
                  </div>
                </dl>
              </div>

              <button
                type="button"
                // Fills the form rather than signing in, so the credentials can
                // be seen going in — the button above is the one-click route.
                onClick={() => {
                  setMode("signin");
                  setEmail(DEMO.email);
                  setPassword(DEMO.password);
                  setError(null);
                }}
                className="shrink-0 rounded-md border border-rule-strong bg-surface px-2 py-1 text-[11.5px] font-medium text-ink-soft transition-colors hover:bg-sunk hover:text-ink"
              >
                Fill in
              </button>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Loaded with 120 days of sample habits and a couple of group chats.
              Anything you change there is only sample data.
            </p>
          </div>
        </div>

        <div className="hidden justify-center md:flex">
          <Preview />
        </div>
      </div>
    </div>
  );
}
