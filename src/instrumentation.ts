/**
 * Runs once, automatically, whenever a new Next.js server instance starts
 * (see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
 * Used here to bootstrap the very first manager account with no manual step
 * required after deploying — no setup page, no Vercel environment variable,
 * nothing to visit or click.
 *
 * completeFirstManagerSetup() claims a permanent Firestore lock
 * (settings/setupState.firstManagerCreated) inside a transaction before
 * writing anything, so this is safe to run on every cold start: once the
 * account exists it's a single cheap read that short-circuits, and two
 * server instances starting at once can't create duplicate accounts.
 *
 * The bootstrap password below is a ONE-TIME credential for
 * aqeelhumood2@gmail.com. Change it immediately after the first login.
 */

const FIRST_MANAGER_BOOTSTRAP_PASSWORD = "Rkf@3UIn82zZSRHl";

export async function register() {
  // The Admin SDK only runs in the Node.js runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getAdminAuth, getAdminDb } = await import("@/lib/firebase/admin");
  const { completeFirstManagerSetup } = await import("@/lib/server/setupService");

  try {
    const { uid } = await completeFirstManagerSetup(getAdminDb(), getAdminAuth(), {
      password: FIRST_MANAGER_BOOTSTRAP_PASSWORD,
    });
    console.log(`[bootstrap] First manager account ready (uid: ${uid}).`);
  } catch (err) {
    if ((err as { code?: string })?.code === "SETUP_ALREADY_COMPLETED") {
      // Expected on every startup after the first one succeeds.
      return;
    }
    // Never let a bootstrap failure (e.g. missing Admin credentials) block
    // the server from starting — just log it for whoever has deploy access.
    console.error("[bootstrap] First manager auto-setup did not complete:", err);
  }
}
