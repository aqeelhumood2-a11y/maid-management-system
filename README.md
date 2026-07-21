# نظام إدارة العاملات — Maid Management System

Production system for scheduling, booking and payment tracking for a maid/worker
staffing office in Bahrain. Arabic RTL interface, mobile-first, real-time
multi-user sync on Cloud Firestore.

## System overview

Two roles — **Employee** and **Manager** — share one live schedule:

- **Employees** see two screens: **Today Schedule** and **Weekly Schedule**, a
  color-coded grid (green/red/yellow/gray) of every active worker × morning/afternoon
  shift. Clicking an available cell opens a quick booking form; clicking a booked
  cell opens details with edit/cancel.
- **Managers** additionally get a **Manager** section: Future Booking, Worker
  Management, Recurring Weekly Schedule, Routes, Reports, Unpaid Bookings,
  Activity History and Settings.

Availability (green/red/yellow/gray) is never stored — it's computed on the fly
from active bookings, recurring weekly schedules, single-occurrence exceptions,
worker active status and the fixed Friday holiday rule, so it works correctly for
any future date without pre-generating documents.

## Technology stack

- Next.js 16 (App Router, Turbopack, Proxy) + TypeScript
- Tailwind CSS v4, Arabic RTL UI (Cairo font)
- Firebase Authentication (Email/Password), Firebase Admin SDK for server routes
- Cloud Firestore with real-time listeners
- Vitest for unit tests, `@firebase/rules-unit-testing` + Firebase Emulator Suite
  for security-rules/integration tests
- Deployed on Vercel

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in your Firebase web config (see below)
npm run dev
```

## Firebase setup

1. Create (or reuse) a Firebase project with **Firestore** and
   **Authentication → Email/Password** enabled.
2. Firebase Console → Project settings → General → "Your apps" → add a Web app,
   copy the config into `.env.local` as the `NEXT_PUBLIC_FIREBASE_*` values.
3. Firebase Console → Project settings → Service accounts → "Generate new
   private key" → use the resulting `project_id` / `client_email` / `private_key`
   for the `FIREBASE_ADMIN_*` variables (server-only, never commit these).
4. Update `.firebaserc` — replace `REPLACE_WITH_FIREBASE_PROJECT_ID` with your
   real Firebase project id (used only by the `firebase` CLI, not by the app).

## Environment variables

See `.env.example` for the full list. Summary:

| Variable | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_*` (6 vars) | Browser | Public Firebase Web config |
| `FIREBASE_ADMIN_PROJECT_ID` | Server | Admin SDK |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Server | Admin SDK, from the service account |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Server | Admin SDK; keep the `\n` escapes literal |
| `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` | Browser | Set `true` only for local emulator dev |

No real secrets are committed to this repository.

## First manager bootstrap

There is no public registration page — accounts are created by a manager (via
Settings → Users, which uses the Admin SDK server route) or, for the very first
manager on a fresh project, via the bootstrap script:

```bash
# Against production Firebase (uses FIREBASE_ADMIN_* env vars):
npm run bootstrap:manager -- --email manager@example.com --password 'Str0ngPass1' --name "اسم المدير"

# Against the local emulator instead, set these first:
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
npm run bootstrap:manager -- --email manager@example.com --password 'Str0ngPass1' --name "اسم المدير"
```

The script creates the Firebase Auth user (or updates it if it already exists),
sets the `role: manager` custom claim, writes the `users/{uid}` Firestore profile,
and seeds the `settings/app` document if missing. It is idempotent and safe to
re-run.

## Firestore rules & indexes deployment

```bash
npx firebase deploy --only firestore:rules --project <your-project-id>
npx firebase deploy --only firestore:indexes --project <your-project-id>
```

`firestore.rules` and `firestore.indexes.json` are the source of truth; nothing
is configured by hand in the console.

## Emulator usage

```bash
npx firebase emulators:start --only firestore,auth
```

UI: http://127.0.0.1:4000. The app itself can also point at the emulators for
local dev by setting `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` in `.env.local`.

## Test commands

```bash
npm run test          # unit tests (pure availability/date/recurring logic)
npm run test:emulator # Firestore rules + booking-transaction integration tests
                       # (spins up the emulator via `firebase emulators:exec`)
npm run test:all       # both, sequentially
npm run lint
npm run typecheck
npm run build          # production build
```

## Production build

```bash
npm run build
npm start
```

## Vercel deployment

1. Import this repository into Vercel. `vercel.json` at the repo root pins
   `"framework": "nextjs"`, so Vercel builds it with the Next.js builder
   (`.next` / Vercel's serverless/edge output) instead of expecting a static
   `public` output directory — if the project's dashboard **Framework
   Preset** was ever set to something other than "Next.js" (or the Output
   Directory field was manually overridden), correct it to "Next.js" and
   clear any custom Output Directory override; `vercel.json` overrides these
   dashboard build settings, but a stale custom Output Directory can still
   surface as `Error: No Output Directory named "public"` on some setups.
2. Add the environment variables listed above (`NEXT_PUBLIC_FIREBASE_*` and
   `FIREBASE_ADMIN_*`) in Vercel → Project → Settings → Environment Variables,
   for Production (and Preview if desired).
3. Deploy. No build command changes are required — `next build` is used as-is.

## User roles

- **Employee** — Today Schedule, Weekly Schedule. Can create/edit/cancel plain
  bookings from those two screens. Cannot reach `/manager/*` (blocked by Proxy,
  by the manager layout's server-side session check, and by Firestore rules).
- **Manager** — everything an employee has, plus the full `/manager` section:
  Future Booking (manual date selection + Friday override), Worker Management,
  Recurring Weekly Schedule, Routes, Reports, Unpaid Bookings, Activity History,
  Settings (business name, areas, user accounts).

## Main workflows

- **Booking a shift**: click a green cell → fill area/hours/amount/payment →
  saved atomically with a slot lock (see below).
- **Recurring schedule**: manager defines a weekly pattern (worker, area, shift,
  day-of-week ≠ Friday, hours/amount/payment). Editing or cancelling requires
  choosing a scope — this occurrence only / from this date onward / entire
  schedule (edit) or this date only / from this date onward (cancel) — matching
  the Arabic labels specified in the brief.
- **Unpaid bookings**: manager marks a booking paid, selecting Benefit/Cash;
  payment date and the acting user are recorded, and the booking disappears
  from the unpaid list immediately for every connected client.
- **Routes**: manager picks a date + shift and gets a copyable/callable list of
  worker → area → customer phone/location for active bookings only.

## Database design (Firestore collections)

- `users/{uid}` — `email, name, role(employee|manager), active, createdAt/By, updatedAt/By`
- `workers/{id}` — `name, phone, active, createdAt/By, updatedAt/By`
- `areas/{id}` — `name, active, createdAt/By, updatedAt/By`
- `bookings/{id}` — full booking record (date `yyyy-MM-dd`, shift, worker/area id
  + name snapshot, hours, amount, paymentMethod, paid, paymentDate/By,
  customerPhone/Location, source, recurringSeriesId, status, cancellation
  metadata, createdBy/At, updatedBy/At)
- `slots/{workerId_date_shift}` — the double-booking lock document (see below)
- `recurringSchedules/{id}` — the weekly pattern (worker/area/shift/dayOfWeek,
  hours/amount/payment, startDate, endDate, status, `replacesId` for "edit from
  this date onward" chains)
- `recurringExceptions/{recurringId_date}` — marks one calendar date as
  cancelled out of a recurring pattern (single-occurrence edits instead
  materialize a concrete `bookings` document — see Concurrency below)
- `activityLogs/{id}` — append-only audit trail (type, entity, acting user,
  before/after snapshot, timestamp); manager-readable only, never editable
- `settings/app` — `businessName, timezone` (fixed to `Asia/Bahrain`)

## Concurrency and double-booking strategy

`bookings`, `slots`, `recurringSchedules` and `recurringExceptions` are written
**exclusively server-side**, through the Admin SDK
(`src/lib/server/bookingService.ts` and `src/lib/server/recurringService.ts`),
called only from the API routes under `src/app/api/bookings` and
`src/app/api/recurring`. The client never writes to these collections
directly — Firestore rules deny it outright (`allow write: if false`) — it
only reads them in real time via `onSnapshot`.

Every booking's worker/date/shift maps to a deterministic Firestore document id
`slots/{workerId}_{date}_{shift}`. Creating (or moving) a booking runs in a
single Firestore transaction (Admin SDK `db.runTransaction`) that:

1. Reads the slot document for the target worker/date/shift.
2. Aborts with `تم حجز العاملة للتو، اختر عاملة أخرى.` if it already exists.
3. Otherwise creates the booking and the slot document together, atomically.

If two requests race for the same slot, Firestore's optimistic-concurrency
transaction retry guarantees only one commit wins — the loser's transaction
re-reads the now-existing slot doc and throws the conflict error instead of
silently double-booking. Cancelling a booking deletes the slot document in the
same transaction that marks the booking `cancelled`, releasing the worker for
that slot immediately for every connected client via the real-time listener.

Editing/cancelling a **recurring** occurrence that hasn't been booked yet for
that specific date "materializes" it — the same server transaction creates a
concrete `bookings` document (same slot-locking guarantee applies) instead of
ever pre-generating every future week's bookings.

## Security approach

- Firebase Authentication (Email/Password only, no public sign-up).
- A server-set **httpOnly session cookie** (created via `/api/session` after
  client-side sign-in, verified with the Admin SDK) is the real page-access
  boundary; Next.js Proxy (`src/proxy.ts`) only does a cheap *optimistic* peek
  at the cookie for fast redirects, per Next 16's guidance that Proxy shouldn't
  do slow/cryptographic work. The actual authorization check — full signature
  verification plus a fresh Firestore `active`/`role` read — happens in the
  `(protected)` and `manager` layouts' Server Components on every request, so a
  deactivation takes effect on the very next navigation, not next login.
- **All writes to `bookings`, `slots`, `recurringSchedules` and
  `recurringExceptions` go through Admin-SDK API routes**, never straight from
  the browser to Firestore. Each route calls `getServerSession()` to derive
  the caller's verified `uid`/`role` from the session cookie — never from
  anything the request body claims — and then calls into
  `src/lib/server/bookingService.ts` / `recurringService.ts`, which:
  - reject any attempt to **create a booking on a Friday date**, or to
    **edit/move an existing booking so its date becomes a Friday**, unless
    `actor.role === "manager"` (`FridayRestrictedError`, matching the
    approved requirement that only a manager may create an exceptional
    Friday booking);
  - re-validate every field (shift/payment-method enums, positive
    hours/amount, date shape) — nothing here trusts client-side form
    validation;
  - require `role === "manager"` for all recurring-schedule operations.

  This was a deliberate fix: Firestore rules alone cannot reliably derive a
  weekday from a plain `yyyy-MM-dd` string, so a rules-only implementation of
  the Friday restriction could be bypassed by a client writing directly to
  Firestore with the SDK. Routing every write through this server layer and
  then denying direct client writes in `firestore.rules` closes that gap
  entirely rather than trying to re-implement calendar math in the rules
  language. See `tests/emulator/transactions.test.ts` for tests exercising
  this directly (weekday booking, Friday rejection, move-to-Friday rejection,
  manager override, concurrent double-booking) and
  `tests/emulator/rules.test.ts` for tests proving direct client writes to
  these four collections are rejected regardless of role or payload shape.
- **Firestore security rules** (`firestore.rules`) are the remaining data-layer
  boundary for the collections still written directly by clients (`workers`,
  `areas`, `settings`, and the `activityLogs` audit trail for those actions):
  role and active-status are re-read from each caller's own `users/{uid}`
  document (not from a possibly-stale ID token claim), and write payloads are
  validated field-by-field.
- `users/{uid}` documents can **never** be written by any client — accounts are
  only created/edited/activated through the Admin-SDK-backed `/api/users` route,
  which is itself gated by `requireManagerSession()`. This is what makes
  self-promotion impossible.
- `activityLogs` are create-only for any active user (each entry is pinned to
  the caller's own uid) and `allow update/delete: if false` unconditionally —
  nobody, including a manager, can alter or delete history.

## Implemented employee features

Today Schedule and Weekly Schedule (with previous/current/next week
navigation), quick booking on an available cell (area/hours/amount/payment
method only — worker/date/shift are implicit), booking details with edit/cancel
on a booked cell, Friday shown as a fixed holiday everywhere.

## Implemented manager features

Future Booking (manual date + Friday-holiday override with explicit
confirmation), Worker Management (add/edit/activate/deactivate, history
preserved), Recurring Weekly Schedule (create + 3-way edit scope + 2-way cancel
scope), Routes (date+shift → worker/area/phone/location, active bookings only,
tap-to-call), Reports (worker/area/date/date-range/week/month/paid/payment
method/shift filters with totals and a reset button), Unpaid Bookings (mark
paid with method + audit trail), Activity History (filterable, immutable),
Settings (business name, area CRUD, user account creation/activation).

## Tests and exact results

```
npm run test           → 3 files, 22 tests passed  (date / availability / recurring pure logic)
npm run test:emulator  → 2 files, 43 tests passed  (Firestore rules + server booking/recurring
                          service, run against the Firebase Emulator Suite via
                          `firebase emulators:exec`)
npm run lint            → 0 problems
npm run typecheck       → 0 errors
npm run build           → succeeds (Turbopack production build, 25 routes)
```

Covered scenarios include: route/role protection expectations at the rules
layer, worker activation/deactivation, automatic availability calculation,
Friday holiday behavior, double-booking prevention under both sequential and
concurrent attempts, cancellation releasing availability, recurring
single-occurrence exceptions, future availability many months out with zero
pre-generated documents, the unpaid→paid transition, and — for the Friday
exceptional-booking authorization fix specifically — an employee's normal
weekday booking succeeding, an employee's Friday booking being rejected, an
employee being unable to move an existing booking onto a Friday date (while
still being able to edit a Friday booking's non-date fields once a manager
placed it there), a manager's Friday override succeeding, and direct client
writes to `bookings`/`slots`/`recurringSchedules`/`recurringExceptions` being
rejected outright regardless of role or payload.

## Known limitations

- Reports scans all active bookings in the selected date range and applies the
  worker/area/paid/payment-method/shift filters client-side, rather than
  maintaining a composite Firestore index for every filter combination. This
  keeps the index list short and is appropriate at this system's scale (a
  single staffing office); a very large multi-year, no-date-filter export could
  read more documents than a fully server-filtered query would.
