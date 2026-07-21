/**
 * Gate for GET /api/diagnostics/bootstrap — a temporary, read-mostly route
 * for inspecting the real production Firebase Auth/Firestore state of the
 * first-manager bootstrap without needing Vercel dashboard log access.
 * Not a Vercel env var by design (see bootstrapCredentials.ts for why this
 * project prefers committed one-time values over new env vars). Delete this
 * file and src/app/api/diagnostics/bootstrap/route.ts once the login issue
 * is confirmed fixed — it is not meant to stay in the codebase long-term.
 */
export const DIAGNOSTICS_TOKEN = "_abFqAFJDz34D9YQEGjkMXdu5hU4JPnQ";
