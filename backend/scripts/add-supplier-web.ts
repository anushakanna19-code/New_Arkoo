import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function main() {
  const email = "anusha.pgdm25014@mile.education";
  const fullName = "Anusha Supplier";

  console.log(`Querying employees for ${email}...`);
  const q = query(collection(db, "employees"), where("email", "==", email));
  const snap = await getDocs(q);

  const supplierData = {
    fullName: fullName,
    email: email,
    personalEmail: email,
    stakeholderType: "Supplier",
    role: "supplier",
    department: "Sourcing",
    designation: "Supplier Specialist",
    status: "Active",
    isActive: true,
    location: "Pune",
    employeeId: "SUP-1001",
    joiningDate: "2026-01-15",
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  };

  if (!snap.empty) {
    const targetDoc = snap.docs[0];
    await updateDoc(doc(db, "employees", targetDoc.id), supplierData);
    console.log(`✅ Updated existing document ${targetDoc.id} for ${email} to Active Supplier!`);
  } else {
    const newDoc = await addDoc(collection(db, "employees"), supplierData);
    console.log(`✅ Added new Active Supplier document ${newDoc.id} for ${email}!`);
  }

  // Send invitation email
  const user = (process.env.GMAIL_USER || process.env.SMTP_USER || 'anushakanna19@gmail.com').trim();
  const pass = (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '').trim();

  console.log(`Sending invitation email from ${user} to ${email}...`);
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });

  const mailOptions = {
    from: `"Arkoo Prebuild Admin" <${user}>`,
    to: email,
    subject: `✉️ Welcome to Arkoo Prebuild - Supplier Invitation Approved`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 20px; border-radius: 10px; text-align: center;">
          <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: bold;">Arkoo Prebuild Supplier Account</h2>
          <p style="color: #ffedd5; margin: 4px 0 0 0; font-size: 13px;">Construction & Infrastructure Operations</p>
        </div>
        
        <div style="padding: 24px 0 12px 0;">
          <p style="font-size: 16px; color: #1e293b; margin-top: 0;">Dear <strong>${fullName}</strong>,</p>
          <p style="font-size: 14px; color: #475569; line-height: 1.6;">Your account has been added and approved as a <strong>Supplier</strong> on the Arkoo Prebuild Platform.</p>
          
          <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-left: 5px solid #10b981; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin: 0 0 8px 0; color: #065f46; font-size: 15px;">📋 Account Credentials</h3>
            <p style="margin: 0 0 6px 0; color: #064e3b; font-size: 13px;"><strong>Email:</strong> ${email}</p>
            <p style="margin: 0 0 6px 0; color: #064e3b; font-size: 13px;"><strong>Stakeholder Role:</strong> Supplier</p>
            <p style="margin: 10px 0 0 0; color: #047857; font-size: 13px; font-weight: bold;">Status: Active / Approved</p>
          </div>
          
          <p style="font-size: 14px; color: #475569; line-height: 1.6;">You may now log in to the application using your Google account.</p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="https://appointee-sharpie-pouncing.ngrok-free.dev/" style="background-color: #f97316; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block;">Access Arkoo Platform</a>
          </div>
        </div>
      </div>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`✅ Dispatched invitation email to ${email}! MessageId: ${info.messageId}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
