/**
 * The one-time bootstrap password for the first manager account
 * (aqeelhumood2@gmail.com), used by both src/proxy.ts and
 * src/instrumentation.ts so there is exactly one place to change it.
 *
 * This is a real, one-time credential committed to source — change it
 * immediately after the first login. It exists here, and only here, so it
 * is never duplicated across the two places that trigger the bootstrap.
 */
export const FIRST_MANAGER_BOOTSTRAP_PASSWORD = "Rkf@3UIn82zZSRHl";
