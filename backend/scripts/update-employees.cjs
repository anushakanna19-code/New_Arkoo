const admin = require('firebase-admin');
const serviceAccount = require('./firebase-applet-config.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function updateEmployees() {
  const snapshot = await db.collection('employees').get();
  
  for (const doc of snapshot.docs) {
    console.log(`Updating ${doc.id}`);
    await doc.ref.update({
      dateOfBirth: '2001-10-10',
      bloodGroup: 'O+',
      emergencyContact: 'Mother - +91 9876543210',
      currentAddress: '123 Main Street, Pune, Maharashtra 411001'
    });
  }
  
  console.log('All employees updated successfully with dummy data.');
}

updateEmployees().catch(console.error);
