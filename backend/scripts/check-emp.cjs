const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId
  });
}

const db = admin.firestore();

async function check() {
  const snapshot = await db.collection('employees').get();
  console.log("=== EMPLOYEES LIST IN FIRESTORE (" + snapshot.size + " docs) ===");
  snapshot.docs.forEach(doc => {
    const d = doc.data();
    console.log(`ID: ${doc.id} | Name: ${d.fullName} | Email: "${d.email}" | PersonalEmail: "${d.personalEmail}" | StakeholderType: "${d.stakeholderType}" | Status: "${d.status}"`);
  });
}

check().catch(console.error);
