/**
 * Standalone Cloudinary <-> Firestore reconciliation script.
 * Meant to be run on a schedule via GitHub Actions (see .github/workflows/cloudinary-cleanup.yml).
 *
 * Deletes Cloudinary images that are no longer referenced anywhere in Firestore
 * and are older than GRACE_PERIOD_HOURS (so a brand-new upload never gets
 * caught mid-flow, before its Firestore doc has been written).
 *
 * FIRESTORE SCHEMA (matches the actual app):
 *   listings_items/{itemId}  -> { photoUrls: ["https://res.cloudinary.com/.../v123/campus-exchange/products/abc.jpg", ...] }
 *   users/{userId}           -> { photoUrl: "https://res.cloudinary.com/.../v123/campus-exchange/profiles/xyz.jpg" }
 *
 * There's no separate public_id field being saved, so instead of reading one,
 * this script DERIVES the public_id straight from each Cloudinary URL
 * (everything after "/upload/", minus any transformation segments, the
 * version segment, and the file extension). This means it works correctly
 * whether or not a public_id field ever gets added later.
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

/**
 * Extracts a Cloudinary public_id from a delivery URL.
 * Handles URLs with or without a version segment (v123456) and with or
 * without transformation segments (e.g. c_fill,w_400).
 * Returns null if the URL doesn't look like a Cloudinary upload URL.
 */
function extractPublicIdFromUrl(url) {
  if (!url || typeof url !== "string") return null;

  const uploadMarker = "/upload/";
  const idx = url.indexOf(uploadMarker);
  if (idx === -1) return null;

  const afterUpload = url.slice(idx + uploadMarker.length);
  const segments = afterUpload.split("/");

  const isVersionSegment = (seg) => /^v\d+$/.test(seg);
  // Transformation segments look like "c_fill,w_400,h_400" or "q_auto" —
  // short letter_value pairs, optionally comma-separated, no dots or slashes.
  const isTransformationSegment = (seg) =>
    seg.includes(",") || /^[a-z]{1,3}_[^./]+$/i.test(seg);

  const idSegments = segments.filter(
    (seg) => !isVersionSegment(seg) && !isTransformationSegment(seg)
  );

  const publicIdWithExt = idSegments.join("/");
  const lastDot = publicIdWithExt.lastIndexOf(".");
  const publicId = lastDot !== -1 ? publicIdWithExt.slice(0, lastDot) : publicIdWithExt;

  return publicId || null;
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

  const listingsSnap = await db.collection("listings_items").get();
  listingsSnap.forEach((doc) => {
    const urls = doc.data().photoUrls || [];
    urls.forEach((url) => {
      const publicId = extractPublicIdFromUrl(url);
      if (publicId) referencedIds.add(publicId);
    });
  });

  const usersSnap = await db.collection("users").get();
  usersSnap.forEach((doc) => {
    const url = doc.data().photoUrl;
    const publicId = extractPublicIdFromUrl(url);
    if (publicId) referencedIds.add(publicId);
  });

  console.log(`Found ${referencedIds.size} referenced image(s) in Firestore.`);
  console.log("Sample referenced public_ids:", Array.from(referencedIds).slice(0, 5));

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
