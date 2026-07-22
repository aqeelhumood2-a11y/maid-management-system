# نظام إدارة العاملات — Maid Management System

Production system for scheduling, booking and payment tracking for a maid/worker
staffing office in Bahrain. Arabic RTL interface, mobile-first, live-updating
schedule backed by Cloud Firestore.

## System overview

The root URL is the **Employee screen** — no login, no account, nothing to
enter. Anyone who opens the site sees the live schedule immediately:

- **Today Schedule** and **Weekly Schedule**, a color-coded grid
  (green/red/yellow/gray) of every active worker × morning/afternoon shift.
  Clicking an available cell opens a quick booking form; clicking a booked
  cell opens details with edit/cancel.
- A small, unobtrusive **⚙︎** button in the header opens a manager password
  prompt. The correct password opens the **Manager** section: Future
  Booking, Worker Management, Recurring Weekly Schedule, Routes, Reports,
  Payments, Activity History and Settings. A wrong password just
  shows an inline error — the visitor stays on the Employee screen.

There is no Firebase Authentication anywhere in this app, and no concept of
individual employee or manager accounts. "Employee" access is simply
"anyone with the URL"; "Manager" access is a single shared password, checked
server-side. See **Manager access** and **Security approach** below for the
full model and the trade-offs that come with it.

Availability (green/red/yellow/gray) is never stored — it's computed on the fly
from active bookings, recurring weekly schedules, single-occurrence exceptions,
worker active status and the fixed Friday holiday rule, so it works correctly for
any future date without pre-generating documents.

## Technology stack

- Next.js 16 (App Router, Turbopack, Proxy) + TypeScript
- Tailwind CSS v4, Arabic RTL UI (Cairo font)
- Cloud Firestore, accessed **exclusively server-side** through the Firebase
  Admin SDK — there is no client-side Firebase SDK of any kind in the app
  bundle. The browser talks only to this app's own Next.js API routes.
- Vitest for unit tests, `@firebase/rules-unit-testing` + Firebase Emulator
  Suite for security-rules/integration tests
- Deployed on Vercel

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in your Firebase Admin credentials (see below)
npm run dev
```

## Firebase setup

This app only uses **Firestore** as a database — no Firebase Authentication
product needs to be enabled at all.

1. Create (or reuse) a Firebase project with **Firestore** enabled.
2. Firebase Console → Project settings → Service accounts → "Generate new
   private key" → use the resulting `project_id` / `client_email` /
   `private_key` for the `FIREBASE_ADMIN_*` variables (server-only, never
   commit these).
3. Update `.firebaserc` — replace `REPLACE_WITH_FIREBASE_PROJECT_ID` with your
   real Firebase project id (used only by the `firebase` CLI, not by the app).

## Environment variables

See `.env.example` for the full list. Summary:

| Variable | Used by | Notes |
|---|---|---|
| `FIREBASE_ADMIN_PROJECT_ID` | Server | Admin SDK (Firestore only) |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Server | Admin SDK, from the service account |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Server | Admin SDK; keep the `\n` escapes literal |

No real secrets are committed to this repository, **except** the manager
password and session-signing secret described below — see **Manager
access** for why those are handled differently.

## Manager access

There is no login page, no setup flow, and nothing to configure by hand or
via an environment variable. The entire manager surface is gated by one
shared password, hardcoded server-side in `src/lib/server/managerAuth.ts`:

```
33199666
```

- `POST /api/manager/login` checks the submitted password against this
  constant using a **timing-safe comparison** (`crypto.timingSafeEqual`),
  never a plain `===`. It is never sent to, compared in, or hardcoded into
  any client-side ("use client") code — the browser only ever sends the
  password the visitor typed, over HTTPS, and receives a cookie back.
- On a match, the server issues a **signed, expiring session token**
  (HMAC-SHA256 over an expiry timestamp, keyed by a second server-only
  secret in the same file) and sets it as an `httpOnly` cookie. This is not
  a JWT library or Firebase Auth under the hood — it's ~60 lines of plain
  Node `crypto`, verified in `src/lib/server/managerAuth.ts` and unit-tested
  in `tests/unit/managerAuth.test.ts` (round-trip, tampered payload,
  tampered signature, expiry).
- A wrong password returns `401` and sets no cookie; the visitor simply
  stays on the Employee screen with an inline error, exactly as specified.
- Repeated wrong attempts from the same IP are throttled (8 attempts / 10
  minutes, in-memory) as a speed bump against casual brute-forcing — note
  this resets on a cold serverless start and isn't shared across instances,
  so treat it as a deterrent, not a hard guarantee, for an 8-digit password.
- `src/proxy.ts` does a fast, optimistic signature+expiry check on every
  `/manager/*` request and redirects to `/` if it fails; `src/app/manager/layout.tsx`
  (a Server Component) re-checks the exact same thing authoritatively on
  every request — Proxy is a UX shortcut, not the security boundary.
- Logging out (`DELETE /api/manager/login`) just clears the cookie.

**Change the password** by editing `MANAGER_PASSWORD` in
`src/lib/server/managerAuth.ts` and redeploying — it is deliberately not an
environment variable, matching this project's established pattern of
committed, rotatable one-time/shared credentials over adding new Vercel
config steps.

## Data access model

Employees have no identity at all, so Firestore Security Rules have nothing
left to authorize a direct client read or write against (`request.auth` is
always null — there is no more Firebase Authentication to populate it).
Rather than opening Firestore's rules to public read — which would make
every booking's customer phone number and location directly, publicly
queryable by anyone who can reach the Firestore project, not just visitors
to this site — **all reads and writes go through this app's own Next.js API
routes**, which use the Admin SDK server-side:

- `firestore.rules` denies **all** direct client read/write access,
  unconditionally, for every collection (`allow read, write: if false`).
  Verified in `tests/emulator/rules.test.ts` for every collection, for both
  an unauthenticated client and one merely claiming an arbitrary uid.
- Reads that used to be Firestore `onSnapshot` real-time listeners
  (`useAreas`, `useWorkers`, `useBookingsForDates`, `useRecurringSchedules`,
  `useRecurringExceptions`, `useSettings` — see `src/hooks/`) now poll their
  corresponding `GET` API route every ~4 seconds
  (`src/hooks/usePolledFetch.ts`). The schedule still updates live for every
  connected client, just on a short interval instead of an instant push —
  the one behavior change this redesign required, and the trade-off made
  explicitly to keep customer PII off the public internet.
- Writes to `bookings`/`slots`/`recurringSchedules`/`recurringExceptions`
  were already Admin-SDK-only from an earlier security fix; this redesign
  extends the same pattern to `areas`, `workers` and `settings`, which used
  to be written directly from the browser under Firestore rules keyed on
  Firebase Auth custom claims (see `src/lib/server/catalogService.ts`).

## Firestore rules & indexes deployment

```bash
npx firebase deploy --only firestore:rules --project <your-project-id>
npx firebase deploy --only firestore:indexes --project <your-project-id>
```

`firestore.rules` and `firestore.indexes.json` are the source of truth; nothing
is configured by hand in the console.

## Emulator usage

```bash
npx firebase emulators:start --only firestore
```

UI: http://127.0.0.1:4000. Only the Firestore emulator is needed — there is
no Firebase Authentication to emulate. Point the app at it locally by
setting `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` before `npm run dev`.

## Test commands

```bash
npm run test           # unit tests (pure availability/date/recurring logic + managerAuth)
npm run test:emulator  # Firestore rules + server booking/recurring/catalog service tests
                        # (spins up the Firestore emulator via `firebase emulators:exec`)
npm run test:all       # both, sequentially
npm run lint
npm run typecheck
npm run build           # production build
```

## Production build

```bash
npm run build
npm start
```

## Vercel deployment

1. Import this repository into Vercel. `vercel.json` at the repo root pins
   `"framework": "nextjs"`, so Vercel builds it with the Next.js builder.
2. Add the `FIREBASE_ADMIN_*` environment variables listed above in Vercel →
   Project → Settings → Environment Variables, for Production (and Preview
   if desired). No other environment variables are required — the manager
   password is not an env var (see **Manager access**).
3. Deploy. No build command changes are required — `next build` is used as-is.

## Access model

- **Employee** (anyone with the URL) — Today Schedule, Weekly Schedule. Can
  create/edit/cancel plain bookings from those two screens. Cannot reach
  `/manager/*` (blocked by Proxy and by the manager layout's server-side
  session check) and cannot create/move a booking onto a Friday date.
- **Manager** (the shared password) — everything an employee has, plus the
  full `/manager` section: Future Booking (manual date selection + Friday
  override), Worker Management, Recurring Weekly Schedule, Routes, Reports,
  Payments (mark/edit/revert paid status, filter by All/Paid/Unpaid/Cash/
  BenefitPay), Activity History, Settings (business name, areas). Payment
  data — on the schedule grid, in Reports, and via the Payments page — is
  visible to a manager session only; see **Manager Payment Tracking**.

Since there are no individual accounts anymore, every action's audit trail
(`activityLogs`, and `createdBy`/`updatedBy`/`cancelledBy` fields) is
attributed to one of two fixed identities — `"employee"` / `"موظف"` or
`"manager"` / `"المدير"` — rather than a named person. This is an intentional
consequence of removing per-user login, not an oversight.

## Main workflows

- **Booking a shift**: click a green cell → fill area/hours/amount →
  saved atomically with a slot lock (see below). No payment is collected or
  asked for at booking time — see **Manager Payment Tracking**.
- **Recurring schedule**: manager defines a weekly pattern (worker, area, shift,
  day-of-week ≠ Friday, hours/amount). Editing or cancelling requires
  choosing a scope — this occurrence only / from this date onward / entire
  schedule (edit) or this date only / from this date onward (cancel) — matching
  the Arabic labels specified in the brief.
- **Payments**: manager marks a booking (or a specific occurrence of a
  recurring schedule) paid, selecting Benefit/Cash and an amount; payment date
  and recorder are recorded automatically. See **Manager Payment Tracking**.
- **Routes**: manager picks a date + shift and gets a copyable/callable list of
  worker → area → customer phone/location for active bookings only.

## Manager Payment Tracking

Payment is entirely decoupled from booking creation and lives only in the
manager-only surface — a booking (or recurring occurrence) is created with no
payment fields at all, and a manager records payment for it afterward,
whenever and however they choose.

- **Booking creation never touches payment.** `createBookingServer` always
  writes a new booking with `paid: false, paymentMethod: null, paidAmount:
  null, paymentDate: null, paymentBy: null`, regardless of what the caller
  sends — there is no `paymentMethod`/`paid` field left in any booking-create
  or booking-edit input type (`CreateBookingInput`, `BookingPatch`,
  `EditableBookingFields`, `CreateRecurringInput`). Payment is set exclusively
  through the dedicated payment endpoints below.
- **Payment is set per-booking, atomically, by `updateBookingPaymentServer`**
  (`src/lib/server/bookingService.ts`), the only function that ever writes
  `paid`/`paymentMethod`/`paidAmount`/`paymentDate`/`paymentBy`:
  - Manager-only (`requireManager`) — throws `FORBIDDEN` for any non-manager
    `Actor`, checked server-side against the real session cookie, not the
    request body.
  - Marking paid requires a payment method (`benefit` or `cash`) and a
    non-negative numeric amount (`validatePaymentFields`); `paymentDate` is
    set once, server-side (`FieldValue.serverTimestamp()`), the first time a
    booking transitions to paid, and never overwritten by a later edit to the
    method or amount while it stays paid.
  - Unchecking paid clears `paymentMethod`, `paidAmount` and `paymentDate`
    back to `null` in the same transaction.
  - Every transition is logged to `activityLogs` with the precise action that
    happened — `payment_marked_paid`, `payment_reverted`,
    `payment_method_changed`, `payment_amount_changed` — computed by diffing
    the before/after payment state, so editing the amount on an
    already-paid booking logs `payment_amount_changed`, not another
    `payment_marked_paid`.
- **Recurring schedules carry no payment concept of their own.**
  `RecurringSchedule` has no `paymentMethod`/`paid` field at all — payment is
  strictly a property of one materialized `Booking` document for one calendar
  date. `setRecurringOccurrencePaymentServer` (`src/lib/server/recurringService.ts`)
  materializes that date's booking on demand (from the recurring schedule's
  own current fields, exactly like a single-occurrence edit) if it doesn't
  exist yet, then calls `updateBookingPaymentServer` on it. This guarantees
  paying one occurrence can never mark any other occurrence — past, future,
  materialized or not — as paid; see the "per-occurrence independence" tests
  in `tests/emulator/transactions.test.ts`.
- **Manager-only API surface**: `PATCH /api/bookings/[id]/payment`,
  `PATCH /api/recurring/[id]/payment` (occurrence payment), and
  `GET /api/bookings/payments?filter=all|paid|unpaid|cash|benefit` (the
  filterable Payments listing) all `401` immediately for a non-manager
  session, before touching Firestore.
- **Employees never see payment data, on any route** — not just hidden in the
  UI. `GET /api/bookings` is the same endpoint the Employee Today/Weekly
  schedule polls, so instead of a second endpoint, that route's response is
  redacted server-side for non-manager sessions: `redactPaymentFields`
  (`src/lib/server/bookingService.ts`) nulls out every payment field before
  the JSON is ever serialized, unit-tested directly in
  `tests/unit/paymentSecurity.test.ts`. The manager-only Payments listing
  (`/api/bookings/payments`) and the Reports/Payments pages are separate
  routes that skip the redaction for a verified manager session.
- **Dashboard Payment Summary** (`GET /api/dashboard/payment-summary`,
  computed by `src/lib/server/paymentSummary.ts`, shown on `/manager`): Total
  Unpaid, Total Paid Today, Total Paid This Week, Cash Total, BenefitPay
  Total, Grand Total Collected. "Today"/"this week" are calendar-date buckets
  in `Asia/Bahrain`, matching every other date computation in this app; a
  paid booking's contribution falls in "today"/"this week" based on its
  `paymentDate`, not its booking `date`.
- **Manager filtering**: the Payments page (`/manager/unpaid`) filters
  bookings by All / Paid / Unpaid / Cash / BenefitPay, backed by
  `GET /api/bookings/payments` and a composite Firestore index on
  `status, paid, paymentMethod, date`.
- **Migration**: there is no backfill script. Existing bookings already had
  `paid: false` by construction before this feature, satisfying "unpaid
  defaults" automatically. The one field genuinely added after some bookings
  already existed, `paidAmount`, is read with a `paidAmount ?? amount`
  fallback everywhere a paid total is computed (`paymentSummary.ts`, the
  Payments page) — matching this project's established pattern of handling
  legacy/missing fields gracefully in code rather than running a manual
  migration step.
- **On the schedule grid**: booked cells show a small green/amber dot
  (paid/unpaid) in `ScheduleTable`, rendered only when `isManager` is true —
  the underlying data is already redacted for employees regardless, so this
  is a UX-only gate on top of the real security boundary above.

## Database design (Firestore collections)

- `workers/{id}` — `name, phone, active, createdAt/By, updatedAt/By`
- `areas/{id}` — `name, active, createdAt/By, updatedAt/By`
- `bookings/{id}` — full booking record (date `yyyy-MM-dd`, shift, worker/area id
  + name snapshot, hours, amount, `paid`, `paymentMethod`, `paidAmount`,
  `paymentDate`, `paymentBy`, customerPhone/Location, source,
  recurringSeriesId, status, cancellation metadata, createdBy/At, updatedBy/At).
  Payment fields always start `false`/`null` at creation and are only ever
  set afterward via `updateBookingPaymentServer` — see **Manager Payment
  Tracking**.
- `slots/{workerId_date_shift}` — the double-booking lock document (see below)
- `recurringSchedules/{id}` — the weekly pattern (worker/area/shift/dayOfWeek,
  hours/amount, startDate, endDate, status, `replacesId` for "edit from
  this date onward" chains). Carries no payment field — payment belongs to a
  materialized occurrence, never the schedule itself.
- `recurringExceptions/{recurringId_date}` — marks one calendar date as
  cancelled out of a recurring pattern (single-occurrence edits instead
  materialize a concrete `bookings` document — see Concurrency below)
- `activityLogs/{id}` — append-only audit trail (type, entity, acting
  identity, before/after snapshot, timestamp); manager-only via
  `GET /api/activity`
- `settings/app` — `businessName, timezone` (fixed to `Asia/Bahrain`)

There is no `users` collection — see **Access model** above.

## Concurrency and double-booking strategy

`bookings`, `slots`, `recurringSchedules`, `recurringExceptions`, `areas`,
`workers` and `settings` are all written **exclusively server-side**, through
the Admin SDK (`src/lib/server/bookingService.ts`, `recurringService.ts`,
`catalogService.ts`), called only from this app's own API routes. The
browser never writes to Firestore directly — `firestore.rules` denies it
outright — and reads it only indirectly, through polled `GET` routes.

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
that slot for every client on its next poll.

Editing/cancelling a **recurring** occurrence that hasn't been booked yet for
that specific date "materializes" it — the same server transaction creates a
concrete `bookings` document (same slot-locking guarantee applies) instead of
ever pre-generating every future week's bookings.

## Security approach

- **No Firebase Authentication anywhere** — removed entirely, along with the
  client Firebase SDK, the login page, per-user accounts, and the `users`
  collection. See **Manager access** for what replaced it.
- **Firestore is unreachable from the browser, period.** `firestore.rules`
  denies all direct client read/write access to every collection, and every
  actual read/write happens server-side under the Admin SDK, in Next.js API
  routes. This is deliberately the strongest posture available (rather than
  opening Firestore to public read) because bookings contain customer phone
  numbers and locations — see **Data access model** above for the reasoning.
- **The manager password is checked server-side only**, with a timing-safe
  comparison, and is never present in any code that ships to the browser.
  The resulting session cookie is `httpOnly`, signed (HMAC-SHA256) and
  expiring — see **Manager access**.
- **The Friday-exceptional-booking rule is enforced in the trusted server
  layer**, not in Firestore rules or client-side validation: creating a
  booking on a Friday, or moving an existing booking's date onto a Friday,
  throws `FridayRestrictedError` unless the request carries a valid manager
  session (`src/lib/server/bookingService.ts`). Firestore rules cannot
  reliably derive a weekday from a plain `yyyy-MM-dd` string, so this can't
  be implemented at the rules layer at all — routing every write through
  this server layer and denying all direct client writes closes the gap
  entirely. See `tests/emulator/transactions.test.ts` (weekday booking,
  Friday rejection, move-to-Friday rejection, manager override, concurrent
  double-booking) and `tests/emulator/rules.test.ts` (direct client access
  denied for every collection).
- Every write re-validates its own fields server-side (shift enum, positive
  hours/amount, date shape, payment-method enum + non-negative amount when
  marking paid) — nothing trusts client-side form validation.
- Payment mutations are manager-only, enforced by `requireManager` inside
  the trusted server layer itself (not just at the route level) — see
  **Manager Payment Tracking**.
- `activityLogs` is append-only and manager-read-only
  (`GET /api/activity`) — no route ever updates or deletes an entry.

## Implemented employee features

Today Schedule and Weekly Schedule (with previous/current/next week
navigation), quick booking on an available cell (area/hours/amount only —
worker/date/shift are implicit, no payment step), booking details with
edit/cancel on a booked cell, Friday shown as a fixed holiday everywhere. None
of this requires any credential, and none of it ever exposes payment data.

## Implemented manager features

Future Booking (manual date + Friday-holiday override with explicit
confirmation), Worker Management (add/edit/activate/deactivate, history
preserved), Recurring Weekly Schedule (create + 3-way edit scope + 2-way cancel
scope), Routes (date+shift → worker/area/phone/location, active bookings only,
tap-to-call), Reports (worker/area/date/date-range/week/month/paid/payment
method/shift filters with totals and a reset button), Payments (mark
paid/edit/revert with method + amount + audit trail, filter by All/Paid/
Unpaid/Cash/BenefitPay), Dashboard Payment Summary (unpaid/paid-today/
paid-this-week/cash/benefit/grand totals), Activity History (filterable,
immutable, including payment-specific action types), Settings (business
name, area CRUD).

## Tests and exact results

```
npm run test           → 6 files, 42 tests passed  (date / availability / recurring pure
                          logic, managerAuth password/session-token, scheduleCellLabel, and
                          payment-redaction security unit tests)
npm run test:emulator  → 3 files, 72 tests passed  (Firestore deny-all rules for every
                          collection, server booking/recurring/payment transaction tests, and
                          server catalog (areas/workers/settings) tests — run against the
                          Firebase Emulator Suite via `firebase emulators:exec`)
npm run lint            → 0 problems
npm run typecheck       → 0 errors
npm run build           → succeeds (Turbopack production build)
```

Covered scenarios include: every collection denying direct client read/write
regardless of claimed identity, automatic availability calculation, Friday
holiday behavior, double-booking prevention under both sequential and
concurrent attempts, cancellation releasing availability, recurring
single-occurrence exceptions, future availability many months out with zero
pre-generated documents, manager-only authorization for areas/workers/
settings/recurring schedules, and — for the manager password session
specifically — correct/incorrect password handling, tampered-payload and
tampered-signature rejection, and expiry.

Payment-specific coverage: default unpaid booking creation, mark
paid (method + amount + auto payment date), rejecting a missing payment
method or a negative amount, rejecting a non-manager actor, preserving the
original payment date across a method/amount edit while staying paid,
clearing all payment fields on revert, the exact activity-log action logged
for each transition, per-occurrence payment independence for recurring
schedules (paying one date never touches another), and — as a unit-level
security regression guard — that `redactPaymentFields` strips every payment
field from a booking before it can reach a non-manager session.

## Known limitations

- Real-time updates are now polling-based (~4s interval) rather than an
  instant Firestore push, a deliberate trade-off — see **Data access model**.
- The manager password's brute-force throttle is in-memory per server
  instance, so it resets on a cold serverless start and doesn't coordinate
  across concurrent instances — a meaningful speed bump, not a guarantee,
  for an 8-digit numeric password. Consider adding a durable rate limiter
  (e.g. Firestore- or Redis-backed) if this becomes a real threat model.
- Reports scans all active bookings in the selected date range and applies the
  worker/area/paid/payment-method/shift filters client-side, rather than
  maintaining a composite Firestore index for every filter combination. This
  keeps the index list short and is appropriate at this system's scale (a
  single staffing office); a very large multi-year, no-date-filter export could
  read more documents than a fully server-filtered query would.
