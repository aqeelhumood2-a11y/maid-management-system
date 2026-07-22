# نظام إدارة العاملات — Maid Management System

Production system for scheduling, booking and payment tracking for a maid/worker
staffing office in Bahrain. Arabic RTL interface, mobile-first, live-updating
schedule backed by Cloud Firestore.

## System overview

The root URL is the **Employee screen** — no login, no account, nothing to
enter. Anyone who opens the site sees the live schedule immediately, scoped
to exactly two read-mostly screens (see **Employee and Manager
permissions**):

- **Daily Schedule**, a color-coded grid (green/red/yellow/gray) of every
  active worker × morning/afternoon shift, read-only for an employee session
  — clicking a booked cell shows a read-only detail view (area, customer
  phone/location, duration); clicking an available cell does nothing, since
  booking creation is manager-only now.
- **Route Schedule**, a same-day operational view (worker, area, phone,
  location, duration, drop-off/pickup times, status) with exactly two
  buttons an employee can press: "تم التنزيل" (dropped off) and "تم
  الاستلام" (picked up).
- A small, unobtrusive **⚙︎** button in the header opens a manager password
  prompt. The correct password opens the **Manager** section: Daily
  Schedule, Weekly Schedule, Weekly Booking Grid, Future Booking, Worker
  Management, Recurring Weekly Schedule, Routes, Reports, Payments,
  Financial Settlement, Activity History and Settings — full booking
  create/edit/cancel, payment, and route-status reset, none of which an
  employee session can reach. A wrong password just shows an inline error —
  the visitor stays on the Employee screen.

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
- `exceljs` (server-side) for Financial Settlement Excel export; `jspdf` +
  `html2canvas` (client-side, dynamically imported) for its PDF export
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

- **Employee** (anyone with the URL) — Daily Schedule (`/`, read-only) and
  Route Schedule (`/routes`). No booking create/edit/cancel, no payment
  anywhere, no Weekly Schedule. The one write an employee session can make
  anywhere in the app is marking a booking's route status (drop-off/pickup)
  on the Route Schedule. Cannot reach `/manager/*` (blocked by Proxy and by
  the manager layout's server-side session check).
- **Manager** (the shared password) — everything an employee has, plus the
  full `/manager` section: Daily/Weekly Schedule with full create/edit/
  cancel, the Weekly Booking Grid, Future Booking (manual date selection +
  Friday override), Worker Management, Recurring Weekly Schedule, Routes,
  Reports, Payments (mark/edit/revert paid status, filter by All/Paid/
  Unpaid/Cash/BenefitPay), Financial Settlement (worker payouts, Manager
  Net, PDF/Excel export), Activity History, Settings (business name, areas).
  Payment, pricing and financial data are visible to a manager session only;
  see **Manager Payment Tracking** and **Manager Financial Settlement**.

Since there are no individual accounts anymore, every action's audit trail
(`activityLogs`, and `createdBy`/`updatedBy`/`cancelledBy` fields) is
attributed to one of two fixed identities — `"employee"` / `"موظف"` or
`"manager"` / `"المدير"` — rather than a named person. This is an intentional
consequence of removing per-user login, not an oversight.

## Employee and Manager permissions

Booking management (create/edit/cancel/move/change-worker) and payment are
now manager-only end to end, not just hidden in the employee UI. This is
enforced identically to every other manager-only capability in this app —
in the trusted server layer, independent of the route or the client:

- **`createBookingServer`, `updateBookingServer`, `cancelBookingServer`**
  (`src/lib/server/bookingService.ts`) all call `requireManager(actor)` as
  their first line — an employee `Actor` is rejected with `FORBIDDEN`
  before any Firestore read, regardless of what route called them or what
  the request body contains.
- **`POST /api/bookings`, `PATCH /api/bookings/[id]`,
  `POST /api/bookings/[id]/cancel`** additionally check
  `isManagerSession()` at the route level and return `401` immediately —
  the same defense-in-depth pattern (route check *and* service check) this
  app has used for payment/financial routes since those modules shipped.
- **`PATCH /api/bookings/[id]` now also accepts `date`/`shift`/`workerId`/
  `workerName`** when present in the body ("Edit booking date" / "Change
  worker"), forwarding to the "move" primitive `updateBookingServer` already
  supported internally (previously only reachable from recurring-schedule
  materialization, never exposed to a manager directly). `EditForm` in
  `BookingDetailsModal` now offers both fields for a plain (non-recurring)
  booking.
- **`GET /api/bookings` redacts the booking `amount` for a non-manager
  session**, the same way it already redacted every payment field —
  `redactEmployeeRestrictedFields` (`src/lib/server/bookingService.ts`)
  composes `redactPaymentFields` with zeroing `amount`, since the approved
  employee permissions list what an employee may view (booking, area,
  customer phone/location, duration, route status) and pricing isn't on it.
- **`ScheduleTable`** only calls `onCellClick` for a booked cell when the
  session isn't a manager — an employee can never open the "create a
  booking" form on an available cell. `BookingDetailsModal`'s Edit/Cancel
  buttons, and the amount field in its read-only view, are gated on
  `isManager` with no exception (a plain non-recurring booking used to be
  editable by whoever created it; it no longer is).
- **Weekly Schedule moved from a public `/weekly` route to `/manager/weekly`**
  — it gets the same server-side session gate every other manager page has
  (`src/app/manager/layout.tsx`) instead of a bespoke check, and
  `EmployeeShell`'s nav only lists Daily Schedule and Route Schedule for a
  non-manager session (it still shows "الأسبوع" for a manager, purely as a
  navigation convenience — the actual gate is the route, not the nav list).
- **Route status (drop-off/pickup) is the one exception** to "employees
  can't write anything": `updateBookingRouteStatusServer` allows any valid
  actor for `drop_off`/`pickup`, but still calls `requireManager` for
  `reset_drop_off`/`reset_pickup` ("Manager can: Reset drop-off, Reset
  pickup"). See **Route Schedule** below.

## Main workflows

- **Booking a shift (manager only)**: on Daily/Weekly Schedule or the Weekly
  Booking Grid, click a green cell → fill area/hours/amount →
  saved atomically with a slot lock (see below). No payment is collected or
  asked for at booking time — see **Manager Payment Tracking**.
- **Recurring schedule**: manager defines a weekly pattern (worker, area, shift,
  day-of-week ≠ Friday, hours/amount) starting on any date — previous,
  current, or future (see **Weekly Booking Grid** below). Editing or
  cancelling requires choosing a scope — this occurrence only / from this
  date onward / entire schedule (edit) or this date only / from this date
  onward (cancel) — matching the Arabic labels specified in the brief.
- **Payments (manager only)**: manager marks a booking (or a specific
  occurrence of a recurring schedule) paid, selecting Benefit/Cash and an
  amount; payment date and recorder are recorded automatically. See
  **Manager Payment Tracking**.
- **Route Schedule**: whoever is on the ground (employee or manager) marks a
  booking dropped off, then picked up, from one same-day list. See **Route
  Schedule** below.
- **Routes (manager)**: manager picks a date + shift and gets a copyable/callable list of
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
  UI. `GET /api/bookings` is the same endpoint the employee Daily Schedule
  and Route Schedule poll, so instead of a second endpoint, that route's
  response is redacted server-side for non-manager sessions:
  `redactPaymentFields` (`src/lib/server/bookingService.ts`) nulls out every
  payment field before the JSON is ever serialized, unit-tested directly in
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

## Manager Financial Settlement

`/manager/financial` computes what each worker has earned and what the
office actually kept, purely by reading existing `bookings` documents — it
adds no new collection, no new booking field, and never writes back to a
booking. All of the logic lives in `src/lib/server/financialSummary.ts`.

- **"Completed" is a read-time interpretation, not a stored status.**
  Bookings only ever have `status: "active" | "cancelled"` (unchanged by
  this feature). A booking counts as completed here if it's `active` and its
  `date` is on or before today in Asia/Bahrain — see `isCompleted()`. This is
  deliberate: adding a real "completed" status would have meant migrating
  every existing booking and touching the booking-creation/edit path, which
  requirement #10 explicitly rules out. Because it's computed at read time,
  every booking that already exists — including ones created before this
  feature shipped — is included automatically (requirement #8), with no
  backfill.
- **Worker payout formula** (`computeDailyPayout`, unit-tested in
  `tests/unit/financialSummary.test.ts`), applied per worker per calendar
  day, counting only that worker's **completed AND paid** bookings that day:
  0 → 0 BHD, 1 → 3 BHD, 2 → 7 BHD (not 3+3), and every booking after the
  second → +3 BHD flat (3 → 10, 4 → 13, 5 → 16, ...). A day's payout can
  only be computed once all of that day's relevant bookings are known, so
  earnings are always summed per-day first, then rolled up into weekly/
  monthly totals — never averaged or estimated.
- **Worker Summary** (`getFinancialSummaryServer` → `GET
  /api/financial-summary?start=&end=`), per worker: total completed
  bookings (regardless of payment — useful for spotting outstanding dues),
  total paid bookings, total earnings, and the same numbers broken down
  daily / weekly (Bahrain Sat–Fri work-week, matching `weekStart()`
  elsewhere) / monthly, toggled in the UI without re-fetching since all
  three are derived from the same daily breakdown in one response.
- **Workers Total / Overall Total / Manager Net**: Workers Total is the sum
  of every worker's earnings; Overall Total is the sum actually collected
  from customers (`paidAmount ?? amount`, same legacy fallback as the
  Payment Tracking module) for completed+paid bookings in range; Manager Net
  = Overall Total − Workers Total. All three use the same completed+paid
  bookings, so Manager Net is a real "what the office kept" figure, not a
  mix of realized worker cost against unrelated future-dated revenue.
- **Filters**: Today / This Week / This Month / a custom date range —
  mirrors the same range-mode pattern as the Reports page.
- **Exports**: "تصدير Excel" hits `GET /api/financial-summary/export`,
  which recomputes the summary server-side with `getFinancialSummaryServer`
  (guaranteeing the export always matches what a manager could see on
  screen) and streams a real `.xlsx` workbook via `exceljs` — Arabic text
  needs no special handling since Excel/OOXML store plain UTF-8 strings.
  "تصدير PDF" instead screenshots the rendered report with `html2canvas`
  and paginates it into a PDF via `jspdf`
  (`src/lib/export/exportToPdf.ts`), entirely client-side: `jsPDF`'s own
  text layer has no Arabic shaping support, so rendering through the
  browser's own text engine and capturing the result as an image is what
  keeps worker/area names readable instead of turning into disconnected or
  reversed glyphs.
- **Security**: manager-only, the same way every other `/manager/*` page and
  API route is — `isManagerSession()` in the API routes,
  `src/app/manager/layout.tsx`'s server-side redirect for the page itself,
  and `requireManager()` inside `getFinancialSummaryServer` as a third,
  independent check in the trusted server layer.
- **Activity Log**: every settlement calculation — whether triggered by
  loading the page with a given filter or by an export, since exports
  recompute the same way — writes a `settlement_calculated` entry to
  `activityLogs` with the range and resulting totals (requirement #9).
  There's no persisted "payout" record to diff a before/after against (it's
  fully derived), so this logs the calculation event itself rather than a
  data mutation, same spirit as the rest of this app's append-only audit
  trail.

## Route Schedule

`/routes` (open to both roles, `src/components/schedule/RouteSchedule.tsx`)
tracks the physical drop-off/pickup of each booking for a chosen date,
independent of payment or booking management entirely — it's the one screen
an employee session can write to.

- **Fields shown, exactly the approved list**: worker, area, phone,
  location, duration, drop-off time, planned pickup, actual pickup, status.
  Nothing about payment or the booking amount ever appears here — it
  couldn't: `GET /api/bookings` already strips those fields for a
  non-manager session before the page's data even exists in the browser.
- **`dropOffAt`/`pickupAt`** are two new nullable Timestamp fields on
  `Booking` (`src/lib/types.ts`), both `null` at creation, set only via
  `updateBookingRouteStatusServer` (`src/lib/server/bookingService.ts`) — the
  only function that ever touches them. "Planned pickup" isn't a stored
  field at all; it's computed client-side as `dropOffAt + hours` once a
  drop-off is recorded, so it only ever appears after that.
- **Status** is derived, not stored: no `dropOffAt` → "بانتظار التنزيل"; a
  `dropOffAt` with no `pickupAt` → "تم التنزيل — بانتظار الاستلام"; a
  `pickupAt` → "تم الاستلام".
- **"تم التنزيل" (`drop_off`) and "تم الاستلام" (`pickup`) are open to any
  valid actor** — the one write capability an employee session has anywhere
  in this app. Pickup is rejected unless a drop-off is already recorded, and
  each action can only happen once (rejects if already set), so the two
  timestamps can never end up in the wrong order or overwritten silently.
- **"إعادة تعيين التنزيل"/"إعادة تعيين الاستلام" (`reset_drop_off`/
  `reset_pickup`) are manager-only** ("Manager can: Reset drop-off, Reset
  pickup") — `updateBookingRouteStatusServer` calls `requireManager` for
  just those two actions, rejecting an employee actor with `FORBIDDEN`.
  Resetting drop-off also clears pickup with it, since a pickup can't
  logically survive an undone drop-off.
- **Recurring occurrences materialize on first route-status write**, exactly
  like payment does — `setRecurringOccurrenceRouteStatusServer`
  (`src/lib/server/recurringService.ts`) creates the concrete `Booking` for
  that date if one doesn't exist yet, via `materializeOccurrenceBookingServer`
  (a manager-check-free variant of booking creation used only for this and
  the equivalent payment/edit materialization paths — see **Employee and
  Manager permissions**), then calls `updateBookingRouteStatusServer` on it.
  This has to stay reachable by an employee actor, which is exactly why it's
  a separate function from the public, manager-only `createBookingServer`.
- Every transition is logged (`route_dropped_off`, `route_picked_up`,
  `route_dropoff_reset`, `route_pickup_reset`) to `activityLogs`.

## Weekly Booking Grid

`/manager/weekly-grid` (manager-only) is the fast path for filling a
worker's whole week instead of creating each day's booking one at a time
from a different screen.

- **Workflow**: pick a worker, pick any date (no minimum — see **Booking
  dates**) → the page computes `weekStart()`/`weekDates()` for that date
  (the existing Bahrain Sat–Fri work-week helpers) and renders the exact
  same `ScheduleTable` component Daily/Weekly Schedule use, scoped to that
  one worker across all 7 dates. Each day shows two cells (morning,
  afternoon) exactly like everywhere else in the app.
- **Every cell reuses the literal same booking form as everywhere else** —
  `QuickBookingModal` for an empty cell, `BookingDetailsModal` for a booked
  one (with its full existing-booking and existing-recurring-booking options:
  edit, cancel, single/forward/entire scope, and payment, all already
  manager-gated). This is a deliberate architectural choice: rather than
  building a second, parallel booking-mutation code path that would have to
  independently re-implement slot-locking, the Friday restriction and
  payment validation, the grid is a thin worker/week-scoped view over
  components and server functions that already exist and are already
  tested. Each cell saves immediately on its own form submit, the same way
  every booking action in this app always has — there is no separate
  "stage the whole week, then commit as one batch" step, since that would
  mean either reimplementing per-booking transactional safety for a batch of
  up to 14 documents, or silently losing that safety, and requirement #9
  explicitly asks to keep the existing architecture rather than replace it.
  What the page actually solves — "no need to create each day separately" —
  is not having to navigate to a different date to see and fill every slot
  for that worker; the whole week is one screen.
- **Weekly editing (requirement #7)** falls out of what already exists,
  with no new code: "edit one day only" is `RecurringEditForm`'s existing
  `single` scope; "edit the whole recurring schedule" is its existing
  `entire` scope; "apply changes to future recurring weeks" is its existing
  `forward` scope; "edit the selected week" is simply being on that week's
  grid and clicking whichever cells need changing.

## Booking dates

Recurring schedules are not forced to start today — `AddRecurringModal`
(`/manager/recurring`) no longer has a `min` on its start-date input, and
`createRecurringScheduleServer` never validated one server-side either,
so a manager can pick a start date in the past, today, or the future; the
Weekly Booking Grid's date picker has no minimum either, and always resolves
to the Sat–Fri week containing whatever date is chosen.

## Database design (Firestore collections)

- `workers/{id}` — `name, phone, active, createdAt/By, updatedAt/By`
- `areas/{id}` — `name, active, createdAt/By, updatedAt/By`
- `bookings/{id}` — full booking record (date `yyyy-MM-dd`, shift, worker/area id
  + name snapshot, hours, amount, `paid`, `paymentMethod`, `paidAmount`,
  `paymentDate`, `paymentBy`, `dropOffAt`, `pickupAt`, customerPhone/Location,
  source, recurringSeriesId, status, cancellation metadata, createdBy/At,
  updatedBy/At). Payment and route-status fields all start `false`/`null` at
  creation and are only ever set afterward via `updateBookingPaymentServer` /
  `updateBookingRouteStatusServer` — see **Manager Payment Tracking** and
  **Route Schedule**.
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
- Booking create/edit/cancel and payment mutations are manager-only,
  enforced by `requireManager` inside the trusted server layer itself (not
  just at the route level) — see **Employee and Manager permissions** and
  **Manager Payment Tracking**. Route status (drop-off/pickup) is the
  narrow, explicitly-approved exception, and even it keeps its two reset
  actions manager-only the same way.
- `GET /api/bookings` — the one read endpoint an employee session can reach
  for schedule data — redacts every payment field and the booking amount
  for a non-manager session before the response is ever serialized
  (`redactEmployeeRestrictedFields`), not just hidden client-side.
- `activityLogs` is append-only and manager-read-only
  (`GET /api/activity`) — no route ever updates or deletes an entry.

## Implemented employee features

Daily Schedule (read-only: view booking, area, customer phone/location,
duration — never amount or payment) and Route Schedule (worker, area,
phone, location, duration, drop-off/pickup times and status, with "تم
التنزيل"/"تم الاستلام" buttons). No booking creation, editing, cancellation,
or payment of any kind — see **Employee and Manager permissions**. Friday
shown as a fixed holiday everywhere. None of this requires any credential.

## Implemented manager features

Daily/Weekly Schedule with full create/edit/cancel (including "Edit booking
date" and "Change worker"), the Weekly Booking Grid (fill a worker's whole
week from one screen), Future Booking (manual date + Friday-holiday
override with explicit confirmation), Worker Management (add/edit/activate/
deactivate, history preserved), Recurring Weekly Schedule (create with any
start date + 3-way edit scope + 2-way cancel scope), Routes (date+shift →
worker/area/phone/location, active bookings only, tap-to-call), Route
Schedule reset controls (undo a drop-off/pickup), Reports (worker/area/
date/date-range/week/month/paid/payment method/shift filters with totals
and a reset button), Payments (mark paid/edit/revert with method + amount +
audit trail, filter by All/Paid/Unpaid/Cash/BenefitPay), Dashboard Payment
Summary (unpaid/paid-today/paid-this-week/cash/benefit/grand totals),
Financial Settlement (per-worker completed/paid/earnings with daily/weekly/
monthly breakdowns, Workers Total, Overall Total, Manager Net, Today/Week/
Month/custom-range filters, PDF and Excel export), Activity History
(filterable, immutable, including payment-, settlement- and route-status-
specific action types), Settings (business name, area CRUD).

## Tests and exact results

```
npm run test           → 7 files, 58 tests passed  (date / availability / recurring pure
                          logic, managerAuth password/session-token, scheduleCellLabel,
                          payment- and amount-redaction security, and financial-settlement
                          payout-formula unit tests)
npm run test:emulator  → 4 files, 89 tests passed  (Firestore deny-all rules for every
                          collection, server booking/recurring/payment/route-status/
                          financial-settlement transaction tests, and server catalog
                          (areas/workers/settings) tests — run against the Firebase
                          Emulator Suite via `firebase emulators:exec`)
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
security regression guard — that `redactPaymentFields`/
`redactEmployeeRestrictedFields` strip every payment field (and, for the
latter, the amount) from a booking before it can reach a non-manager
session.

Employee/Manager permissions and Route Schedule coverage: booking create/
edit/cancel rejecting an employee actor unconditionally (including on
Friday, where it used to be allowed) while a manager still succeeds on both
a weekday and Friday, "Change worker" moving a booking's slot lock
correctly, `materializeOccurrenceBookingServer` still enforcing the Friday
restriction as defense in depth, an employee marking drop-off then pickup
(and being rejected for a duplicate or out-of-order action), an employee
being rejected for either reset action while a manager succeeds (resetting
drop-off also clearing pickup), a not-yet-materialized recurring
occurrence's route status materializing exactly one booking for an employee
actor without affecting other dates, and a recurring schedule accepting a
start date a year in the past.

Financial Settlement coverage: the payout formula for 0–6 completed+paid
bookings in a single day (`computeDailyPayout`), correct per-worker/per-day
aggregation and independence between workers, excluding unpaid bookings from
earnings while still counting them as completed, excluding cancelled and
future-dated bookings entirely, the `paidAmount ?? amount` legacy fallback
for bookings paid before this feature existed, `workersTotal`/`overallTotal`/
`managerNet` arithmetic, daily→weekly→monthly aggregation consistency,
manager-only rejection of `getFinancialSummaryServer`, and the
`settlement_calculated` activity-log entry written for every calculation.

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
- "Completed" for Financial Settlement purposes is `date <= today`, with no
  finer-grained notion of a shift actually being marked done — a same-day
  morning booking is treated as completed as soon as the calendar date
  arrives, not when the shift itself ends. See **Manager Financial
  Settlement** for why this was the chosen interpretation.
- The PDF export is a rasterized screenshot of the rendered report
  (`html2canvas` + `jspdf`), not vector text — chosen deliberately so Arabic
  worker/area names render correctly (see **Manager Financial Settlement**),
  at the cost of a larger file size and non-selectable text. The Excel
  export has neither limitation.
- The Weekly Booking Grid saves each cell immediately on that cell's own
  form submit, the same as every other booking action in this app, rather
  than staging the whole week and committing it as one batch on a page-level
  "Save" — see **Weekly Booking Grid** for the reasoning (reusing the
  existing, already-tested per-booking mutation path instead of building a
  second one). A manager filling several cells still never has to leave the
  page or pick a different date to do it.
- "Planned pickup" on the Route Schedule is a client-side estimate
  (drop-off time + duration), not a value the manager can set independently
  — there's no separate "expected pickup time" input anywhere in the
  approved feature list to capture one.
