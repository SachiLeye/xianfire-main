import fs from "fs";
import path from "path";
import adminSDK from "firebase-admin";

let authAdmin = null;
let adminAvailable = false;

// Try to locate a service account JSON. Prefer explicit service account for local/server usage.
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "serviceAccountKey.json");

try {
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
    adminSDK.initializeApp({ credential: adminSDK.credential.cert(serviceAccount) });
    authAdmin = adminSDK.auth();
    adminAvailable = true;
    console.log("Firebase Admin initialized using service account at:", serviceAccountPath);
  } else {
    // Do not attempt to use metadata server / ADC in local environments.
    adminAvailable = false;
    console.warn("Firebase Admin not initialized. To enable admin features (create Auth users), place a service account JSON at ./serviceAccountKey.json or set GOOGLE_APPLICATION_CREDENTIALS to its path.");
  }
} catch (err) {
  console.error("Failed to initialize Firebase Admin:", err);
  adminAvailable = false;
}

export { authAdmin, adminAvailable };
