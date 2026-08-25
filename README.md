# Habit Tracker

A month grid you tick every day, and a dashboard that tells you the truth about it.

Habits are rows, days of the month are columns. A habit can be a plain tick (Gym),
a count against a daily target (Prayer, 5 a day), or a weekly quota (Run, 3 times a
week) — and streaks, completion rates and every chart understand the difference.

There are also **groups**: live chat rooms built around a habit, so the people in
the Gym room are people who actually track the gym.

- **Backend** — FastAPI, SQLAlchemy 2.0 (async), Postgres, JWT auth
- **Frontend** — React 19, TypeScript, Vite, TanStack Query, Tailwind v4
- **Free to host** — Vercel (web) + Render (API) + Neon (Postgres), no card needed

---

## Running it locally

You need Python 3.11+ and Node 20+.

### 1. Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements-dev.txt
cp .env.example .env          # defaults to a local SQLite file, nothing to configure

python seed_demo.py           # optional: 120 days of sample data
uvicorn app.main:app --reload
```

The API is on <http://127.0.0.1:8000>, with interactive docs at
<http://127.0.0.1:8000/docs>.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` to the backend, so there is no
CORS setup and no environment file needed in development.

If you ran the seed script, sign in with **demo@example.com / demo12345**, or use
the *Explore the demo account* button.

To watch group chat sync live, open a second browser window and sign in as one of
the seeded companions — **omar@example.com**, **ayesha@example.com** or
**zainab@example.com**, all with the password `demo12345`. They are fictional
accounts that only `seed_demo.py` creates; a message sent in one window appears in
the other without a refresh.

### Tests

```bash
cd backend && pytest              # 76 tests: schedule maths, auth, entries, analytics, groups
cd frontend && npm run typecheck
```

---

## Deploying it for free

Three services, all free tier, all deploy on `git push`. Do them in this order —
each step needs a value from the one before.

Push this project to GitHub first:

```bash
git init
git add .
git commit -m "Habit tracker"
git branch -M main
git remote add origin https://github.com/<you>/habit-tracker.git
git push -u origin main
```

### Step 1 — Database on Neon

1. Sign up at <https://neon.tech> and create a project (no card required).
2. On the dashboard, copy the **connection string**. It looks like:
   `postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
3. Keep it to hand — Render needs it next.

Neon's free tier is 0.5 GB, which is far more than this app will ever use: a year
of six habits is a few thousand rows.

### Step 2 — API on Render

1. Sign up at <https://render.com> and choose **New → Blueprint**.
2. Point it at your GitHub repo. Render reads [`render.yaml`](render.yaml) and
   sets up the service itself.
3. When prompted, fill in the two variables it asks for:
   - `DATABASE_URL` — the Neon string from step 1, pasted unchanged
   - `CORS_ORIGINS` — leave it as `http://localhost:5173` for now; you will come 
     back and add the Vercel URL in step 4
4. Deploy. When it finishes, visit `https://<your-service>.onrender.com/api/health`
   — it should return `{"status":"ok",...}`. Tables are created on first boot.

If you created the service by hand instead of from the blueprint, the defaults
already work: Render builds the [`Dockerfile`](Dockerfile) at the repo root, and
that Dockerfile reaches into `backend/` itself. Leave **Root Directory** empty.

> **The free-tier catch:** Render sleeps a free service after 15 minutes of no
> traffic, so the next request takes 30–60 seconds to wake it. The app handles
> this — requests retry and the UI shows a loading state — but it is worth knowing
> before you demo it to someone. Opening the site a minute early is enough.

> **`failed to read dockerfile: open Dockerfile: no such file or directory`**
> means the service is pointed somewhere without a Dockerfile. The Dockerfile is
> at the repo root, so clear **Root Directory** in the service settings (or set
> **Dockerfile Path** to `./Dockerfile`) and redeploy.

### Step 3 — Web app on Vercel

1. Sign up at <https://vercel.com> and **Add New → Project**, importing the same repo.
2. Set **Root Directory** to `frontend`. Vercel detects Vite for everything else.
3. Add one environment variable:
   - `VITE_API_URL` = `https://<your-service>.onrender.com` (no trailing slash)
4. Deploy.

### Step 4 — Let the two talk

Go back to Render → your service → **Environment**, and set `CORS_ORIGINS` to your
Vercel URL:

```
https://<your-project>.vercel.app
```

Save. Render redeploys, and the app is live. (Add `http://localhost:5173` as a
second comma-separated value if you also want to keep developing against the
deployed API.)

### Optional — a demo account on the live site

```bash
cd backend
DATABASE_URL="<your Neon string>" python seed_demo.py
```

---

## How it is built

```
backend/
  app/
    main.py           FastAPI app, CORS, the WebSocket endpoint
    models.py         users, habits, entries, groups, members, messages
    schemas.py        request and response shapes, with validation
    security.py       Argon2 password hashing, JWT signing
    deps.py           auth dependency, per-user "today"
    routers/          auth, habits, entries, analytics, groups
    services/
      schedule.py     what a habit is owed and how long the run is
      analytics.py    rates, streaks, heatmap, weekday split, insights
  seed_demo.py        120 days of realistic sample data
  tests/              76 tests
frontend/
  src/
    components/       the grid, day panel, command palette, charts, UI pieces
    pages/            Login, Tracker, Dashboard, HabitDetail, Groups, GroupChat, Settings
    lib/              API client, auth, realtime, dates, theme, milestones
```

### The idea that makes the numbers work

Everything is counted in **slots** — one completion the schedule actually asked
for. A daily habit asks for one slot a day. A Mon/Wed/Fri habit asks for one on
those days and none on the others. A "3 times a week" habit spreads three slots
across each week, wherever you use them.

Every percentage in the app is *slots kept ÷ slots asked for*. That is what lets
a five-a-day prayer habit and a three-a-week gym habit sit inside the same average
without one distorting the other, and it is why an off day never shows up as a
miss. The rules live in one file, [`services/schedule.py`](backend/app/services/schedule.py),
and everything else reads from it.

Streaks follow the same logic: they skip days the habit was never owed on, they
count weeks rather than days for weekly-quota habits, and an untouched *today*
counts as pending rather than failed — the day is not over yet.

### What you can actually do

- **The grid** — click to tick, drag along a row to fill several days at once
  (one request, one undo), drag the handle to reorder habits.
- **The day panel** — click a date at the top of a column, right-click any cell,
  press `d`, or hit *Log today*. It opens that whole day: exact counts on a
  stepper, and a note per habit. Notes show as a small mark on the cell.
- **A page per habit** — click a habit name for its own year heatmap, weekly
  trend, weekday split, streak records, and every note you have left on it.
- **Command palette** — `⌘K` / `Ctrl+K`. Fuzzy-jump to a habit, change month,
  create, export, switch theme. Typing `jrn` finds *Journal*.
- **Milestones** — crossing 3, 7, 14, 21, 30, 50, 100… days on a habit is
  announced once, and says when it is a personal best.
- **Groups** — chat rooms built around a habit. The Groups page suggests rooms
  that match the habits you already track ("you track Read" → the Reading room),
  and *Share a streak* posts one of your habits into the conversation, with the
  figures recomputed server-side so a shared streak is always a real one.

### Notable details

- **Optimistic ticking.** A click paints the cell immediately and reconciles with
  the server afterwards; a failure rolls the cell back and says so.
- **Streaks come back with the write.** `PUT /api/entries` returns the
  recalculated streak alongside the entry, so the badge and any milestone are
  correct the instant a cell is ticked, with no refetch to wait on.
- **A tick never erases a note.** The API only changes `note` when the request
  actually carries the field, so toggling a cell leaves what you wrote alone.
- **One socket does both jobs.** The same per-user WebSocket carries habit sync
  and group chat: a tick on your phone appears on your laptop, and a message in a
  room reaches every member wherever they are in the app, so the unread badge is
  live without any polling. State is in-process, which suits one Render instance;
  a multi-instance deploy would swap the dictionary in `realtime.py` for Redis
  pub/sub.
- **Rooms are closed until you join.** Reading or posting requires membership —
  a non-member gets a 403, not a preview — and posting is rate-limited per user.
- **Timezones.** "Today" is resolved in each user's own zone, so streaks break at
  *your* midnight, not the server's.
- **Keyboard.** Arrow keys move through the grid, space toggles, `+`/`-` adjust a
  count, `d` opens the day, `n` opens a new habit, `⌘K` opens the palette.
- **Colour.** The eight habit colours were checked with a contrast and
  colour-vision validator in both themes rather than picked by eye; the heatmap
  uses a single-hue ramp with monotone lightness steps. Dark mode is re-stepped
  from the same hues against the dark surface, not flipped.
- **Your data is yours.** Export everything as CSV from the dashboard or settings.

---

## Other ways to run it

The stack is containerised if you would rather not use Render:

```bash
docker compose up          # API on :8000, Postgres on :5432
```

There is one [`Dockerfile`](Dockerfile), at the repo root, and it is what Render,
compose, Fly.io, Railway, Koyeb and any box running Docker all build — so what
you test locally is what deploys. It builds the API only; the frontend is static
files served by Vercel.

## Configuration

| Variable       | Where     | Purpose                                                    |
| -------------- | --------- | ---------------------------------------------------------- |
| `DATABASE_URL` | backend   | Neon/Postgres string. Defaults to local SQLite.             |
| `JWT_SECRET`   | backend   | Signs tokens. Render generates one; never reuse the default.|
| `CORS_ORIGINS` | backend   | Comma-separated origins allowed to call the API.            |
| `VITE_API_URL` | frontend  | API base URL. Leave unset locally to use the Vite proxy.    |
