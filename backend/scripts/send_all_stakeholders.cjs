const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = new admin.firestore.Firestore({
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId
});

async function sendEmailToAllStakeholders() {
  const user = (process.env.GMAIL_USER || process.env.SMTP_USER || 'anushakanna19@gmail.com').trim();
  const pass = (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '').trim();
  const appLink = 'https://appointee-sharpie-pouncing.ngrok-free.dev/';

  console.log('[Bulk Dispatch] Connecting SMTP user:', user);
  console.log('[Bulk Dispatch] Target Firestore databaseId:', firebaseConfig.firestoreDatabaseId);

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });

  const snap = await db.collection('employees').get();
  console.log(`[Bulk Dispatch] Total stakeholders found in Firestore master directory: ${snap.docs.length}`);

  const dispatchedEmails = new Set();

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const fullName = data.fullName || 'Stakeholder';
    const officialEmail = String(data.email || '').trim();
    const personalEmail = String(data.personalEmail || '').trim();
    const stakeholderType = data.stakeholderType || 'Employee';
    const department = data.department || 'General';
    const status = data.status || (data.isActive !== false ? 'Active' : 'Pending');

    // Target both official and personal email addresses
    const emailsToNotify = [officialEmail, personalEmail]
      .filter(Boolean)
      .filter(e => e.includes('@'))
      .filter(e => !dispatchedEmails.has(e.toLowerCase()));

    for (const email of emailsToNotify) {
      dispatchedEmails.add(email.toLowerCase());

      const isApproved = status.toLowerCase() === 'active' || status.toLowerCase() === 'accepted';
      const subject = isApproved 
        ? `🎉 Account Approved - Access Arkoo Prebuild Platform`
        : `✉️ Welcome to Arkoo Prebuild - Stakeholder Invitation`;

      const mailOptions = {
        from: `"Arkoo Prebuild Admin" <${user}>`,
        to: email,
        subject: subject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
            <div style="background: linear-gradient(135deg, ${isApproved ? '#10b981 0%, #059669' : '#f97316 0%, #ea580c'} 100%); padding: 20px; border-radius: 10px; text-align: center;">
              <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: bold;">${isApproved ? 'Account Approved & Activated' : 'Arkoo Prebuild Invitation'}</h2>
              <p style="color: ${isApproved ? '#d1fae5' : '#ffedd5'}; margin: 4px 0 0 0; font-size: 13px;">Arkoo Prebuild Intelligence Platform</p>
            </div>
            
            <div style="padding: 24px 0 12px 0;">
              <p style="font-size: 16px; color: #1e293b; margin-top: 0;">Dear <strong>${fullName}</strong>,</p>
              <p style="font-size: 14px; color: #475569; line-height: 1.6;">
                ${isApproved ? 'Your stakeholder account has been officially <strong>accepted and activated</strong> by the Administrator.' : 'You have been registered on the <strong>Arkoo Prebuild Intelligence Platform</strong>.'}
              </p>
              
              <div style="background-color: ${isApproved ? '#ecfdf5' : '#fff7ed'}; border: 1px solid ${isApproved ? '#a7f3d0' : '#fed7aa'}; border-left: 5px solid ${isApproved ? '#10b981' : '#f97316'}; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin: 0 0 8px 0; color: ${isApproved ? '#065f46' : '#9a3412'}; font-size: 15px;">📋 Account Credentials & Details</h3>
                <p style="margin: 0 0 6px 0; color: ${isApproved ? '#064e3b' : '#431407'}; font-size: 13px;"><strong>Stakeholder:</strong> ${fullName}</p>
                <p style="margin: 0 0 6px 0; color: ${isApproved ? '#064e3b' : '#431407'}; font-size: 13px;"><strong>Registered Email:</strong> ${email}</p>
                <p style="margin: 0 0 6px 0; color: ${isApproved ? '#064e3b' : '#431407'}; font-size: 13px;"><strong>Stakeholder Role:</strong> ${stakeholderType}</p>
                <p style="margin: 0 0 6px 0; color: ${isApproved ? '#064e3b' : '#431407'}; font-size: 13px;"><strong>Department:</strong> ${department}</p>
                <p style="margin: 10px 0 0 0; color: ${isApproved ? '#047857' : '#c2410c'}; font-size: 13px; font-weight: bold;">Status: ${status}</p>
              </div>
              
              <p style="font-size: 14px; color: #475569; line-height: 1.6;">You can access the application platform directly using the link below:</p>

              <div style="text-align: center; margin: 28px 0;">
                <a href="${appLink}" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: #ffffff; padding: 14px 28px; text-decoration: none; font-weight: bold; border-radius: 10px; display: inline-block; font-size: 15px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                  🚀 Open Arkoo Application
                </a>
              </div>

              <p style="font-size: 12px; color: #64748b; text-align: center; word-break: break-all;">
                Application Link: <a href="${appLink}" style="color: #ea580c; font-weight: bold;">${appLink}</a>
              </p>
            </div>

            <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
              Arkoo Prebuild Pvt. Ltd. • Secure Access Management System
            </div>
          </div>
        `
      };

      try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`[Sent Success] Dispatched application link email to "${fullName}" <${email}>. MessageId: ${info.messageId}`);
      } catch (err) {
        console.error(`[Sent Error] Failed to send email to ${email}:`, err.message || err);
      }
    }
  }

  console.log(`\n🎉 Finished sending application link emails to all ${dispatchedEmails.size} unique stakeholder email address(es)!`);
  process.exit(0);
}

sendEmailToAllStakeholders().catch(err => {
  console.error(err);
  process.exit(1);
});
