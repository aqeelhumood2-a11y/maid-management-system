/**
 * Best-effort bootstrap trigger: runs whenever a new Next.js server instance
 * starts, on platforms that actually spin one up for this to fire on
 * (see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
 *
 * This is NOT the guaranteed trigger — on Vercel, a request that only ever
 * touches statically-served content (like the /login page and its
 * client-side-only Firebase Auth call) can complete without any Node.js
 * server instance ever starting, so this hook may never fire at all in that
 * case. src/proxy.ts is the actual guaranteed mechanism, since Proxy runs
 * on every matched request regardless of caching. This file is kept as a
 * cheap, harmless second attempt for platforms/requests where it does fire
 * (e.g. `next start` outside Vercel, or any request that does need a fresh
 * server instance) — completeFirstManagerSetup()'s permanent Firestore lock
 * makes running it from two places safe.
 */

export async function register() {
  // The Admin SDK only runs in the Node.js runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getAdminAuth, getAdminDb } = await import("@/lib/firebase/admin");
  const { completeFirstManagerSetup } = await import("@/lib/server/setupService");
  const { FIRST_MANAGER_BOOTSTRAP_PASSWORD } = await import("@/lib/server/bootstrapCredentials");

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
