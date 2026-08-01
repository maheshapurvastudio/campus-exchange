/**
 * Standalone Cloudinary <-> Firestore reconciliation script.
 * Meant to be run on a schedule via GitHub Actions (see .github/workflows/cloudinary-cleanup.yml).
 *
 * Deletes Cloudinary images that are no longer referenced anywhere in Firestore
 * and are older than GRACE_PERIOD_HOURS (so a brand-new upload never gets
 * caught mid-flow, before its Firestore doc has been written).
 *
 * FIRESTORE SCHEMA ASSUMPTIONS (adjust to match your app):
 *   products/{productId}  -> { imagePublicIds: ["campus-exchange/products/abc123", ...] }
 *   users/{userId}        -> { profileImagePublicId: "campus-exchange/profiles/xyz789" }
 *
 * REQUIRED ENVIRONMENT VARIABLES (set as GitHub Secrets, injected by the workflow):
 *   FIREBASE_SERVICE_ACCOUNT   - full service account JSON, as a string
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */

const admin = require("firebase-admin");
const cloudinary = require("cloudinary").v2;

const GRACE_PERIOD_HOURS = 48;
const CLOUDINARY_ROOT_FOLDER = "campus-exchange"; // scope this to your upload folder

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  // --- Init Firebase Admin from the service account JSON secret ---
  const serviceAccount = JSON.parse(requireEnv("FIREBASE_SERVICE_ACCOUNT"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  const db = admin.firestore();

  // --- Init Cloudinary from secrets ---
  cloudinary.config({
    cloud_name: requireEnv("CLOUDINARY_CLOUD_NAME"),
    api_key: requireEnv("CLOUDINARY_API_KEY"),
    api_secret: requireEnv("CLOUDINARY_API_SECRET"),
  });

  // --- a) Collect every public_id currently referenced in Firestore ---
  const referencedIds = new Set();

  const productsSnap = await db.collection("products").get();
  productsSnap.forEach((doc) => {
    const ids = doc.data().imagePublicIds || [];
    ids.forEach((id) => referencedIds.add(id));
  });

  const usersSnap = await db.collection("users").get();
  usersSnap.forEach((doc) => {
    const id = doc.data().profileImagePublicId;
    if (id) referencedIds.add(id);
  });

  console.log(`Found ${referencedIds.size} referenced image(s) in Firestore.`);

  // --- b) List every resource in Cloudinary (paginated, 500 per page) ---
  let nextCursor = undefined;
  let totalChecked = 0;
  let totalDeleted = 0;
  const cutoff = Date.now() - GRACE_PERIOD_HOURS * 60 * 60 * 1000;

  do {
    const page = await cloudinary.api.resources({
      type: "upload",
      prefix: CLOUDINARY_ROOT_FOLDER,
      max_results: 500,
      next_cursor: nextCursor,
    });

    const orphans = page.resources.filter((resource) => {
      const isReferenced = referencedIds.has(resource.public_id);
      const createdAt = new Date(resource.created_at).getTime();
      const isOldEnough = createdAt < cutoff;
      return !isReferenced && isOldEnough;
    });

    totalChecked += page.resources.length;

    // --- c) Delete orphans in this page ---
    if (orphans.length > 0) {
      const orphanIds = orphans.map((r) => r.public_id);
      const result = await cloudinary.api.delete_resources(orphanIds);
      totalDeleted += Object.keys(result.deleted || {}).length;
      console.log(`Deleted ${orphanIds.length} orphaned image(s):`, orphanIds);
    }

    nextCursor = page.next_cursor;
  } while (nextCursor);

  console.log(`Reconciliation complete. Checked ${totalChecked}, deleted ${totalDeleted}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Reconciliation failed:", err);
    process.exit(1);
  });
