const nodemailer = require('nodemailer');
require('dotenv').config();

async function testEmail() {
  const user = (process.env.GMAIL_USER || process.env.SMTP_USER || 'anushakanna19@gmail.com').trim();
  const pass = (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '').trim();

  console.log("Using SMTP User:", user);
  console.log("Using SMTP Pass length:", pass.length);

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: user,
      pass: pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  try {
    const info = await transporter.sendMail({
      from: `"Arkoo Prebuild Admin" <${user}>`,
      to: 'anusha.pgdm25014@mile.education',
      subject: '✉️ Welcome to Arkoo Prebuild - Stakeholder Invitation Test',
      html: '<p>Test invitation email for stakeholder Supplier account.</p>'
    });
    console.log("Email sent successfully! MessageId:", info.messageId);
  } catch (err) {
    console.error("Email send failed:", err);
  }
}

testEmail();
