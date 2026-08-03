import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

async function main() {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (!fs.existsSync(firebaseConfigPath)) {
    console.error("Config not found!");
    process.exit(1);
  }
  const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));
  console.log("Found config:", firebaseConfig);

  // Method 1: Original new admin.firestore.Firestore
  try {
    console.log("\n--- Testing Method 1: raw new admin.firestore.Firestore ---");
    const db1 = new admin.firestore.Firestore({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId
    });
    const snap = await db1.collection("settings").doc("gdrive").get();
    console.log("Success! Snap exists:", snap.exists);
  } catch (err: any) {
    console.error("Method 1 failed:", err.message || err);
  }

  // Initialize admin app
  if (admin.apps.length === 0) {
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }

  // Method 2: getFirestore(admin.apps[0] or default)
  try {
    console.log("\n--- Testing Method 2: getFirestore(default) with databaseId ---");
    const db2 = getFirestore(firebaseConfig.firestoreDatabaseId);
    const snap = await db2.collection("settings").doc("gdrive").get();
    console.log("Success! Snap exists:", snap.exists);
  } catch (err: any) {
    console.error("Method 2 failed:", err.message || err);
  }

  // Method 3: admin.firestore() with credential/project config inside initializeApp
  try {
    console.log("\n--- Testing Method 3: admin.initializeApp with credential ---");
    // Let's see if we need credential
  } catch (err) {}
}

main();
