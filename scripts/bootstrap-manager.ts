/**
 * Creates the first manager account. This is the only supported way to get a
 * manager into a fresh system — there is no public registration page.
 *
 * Usage:
 *   FIREBASE_ADMIN_PROJECT_ID=... FIREBASE_ADMIN_CLIENT_EMAIL=... FIREBASE_ADMIN_PRIVATE_KEY=... \
 *     npm run bootstrap:manager -- --email manager@example.com --password 'Str0ng!Pass' --name "اسم المدير"
 *
 * Against the local emulator, set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 and
 * FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 instead of the admin credentials.
 */
import { getAdminAuth, getAdminDb } from "../src/lib/firebase/admin";

function parseArgs() {
  const args = process.argv.slice(2);
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      values[key] = args[i + 1];
      i++;
    }
  }
  return values;
}

async function main() {
  const { email, password, name } = parseArgs();

  if (!email || !password || !name) {
    console.error(
      "Usage: npm run bootstrap:manager -- --email <email> --password <password> --name <name>"
    );
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Password must be at least 6 characters.");
    process.exit(1);
  }

  const auth = getAdminAuth();
  const db = getAdminDb();

  let uid: string;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    console.log(`User already exists in Firebase Auth (uid=${uid}), updating password and profile...`);
    await auth.updateUser(uid, { password, displayName: name });
  } catch {
    const created = await auth.createUser({ email, password, displayName: name });
    uid = created.uid;
    console.log(`Created Firebase Auth user (uid=${uid}).`);
  }

  await auth.setCustomUserClaims(uid, { role: "manager" });

  await db.collection("users").doc(uid).set(
    {
      email,
      name,
      role: "manager",
      active: true,
      createdAt: new Date(),
      createdBy: "bootstrap-script",
      updatedAt: new Date(),
      updatedBy: "bootstrap-script",
    },
    { merge: true }
  );

  const settingsRef = db.collection("settings").doc("app");
  const settingsSnap = await settingsRef.get();
  if (!settingsSnap.exists) {
    await settingsRef.set({
      businessName: "نظام إدارة العاملات",
      timezone: "Asia/Bahrain",
      updatedAt: new Date(),
      updatedBy: uid,
    });
    console.log("Initialized default settings document.");
  }

  console.log(`\nManager account ready.\n  email: ${email}\n  uid:   ${uid}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
