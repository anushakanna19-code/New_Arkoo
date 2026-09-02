import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { getFirestore } from '../config/firebase.js';
import { parseRelativeDeadline, formatDeadlineDisplay } from '../utils/date.js';
import { logger } from '../utils/logger.js';
import type { TaskEmailPayload } from '../types/meeting.js';

// ─── Email Service ─────────────────────────────────────────

/**
 * Create an SMTP transporter with credentials from environment.
 * No hardcoded fallback credentials — if env is empty, returns empty user/pass.
 */
export function createSmtpTransporter() {
  const user = env.GMAIL_USER;
  const pass = env.GMAIL_APP_PASSWORD;

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user, pass },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    // TLS verification enabled in production (was disabled before)
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  });

  return { transporter, user, pass };
}

/**
 * Send a task assignment email notification.
 */
export async function sendTaskAssignmentEmail(task: TaskEmailPayload): Promise<void> {
  try {
    const assigneeRaw = String(task.assigneeName || '').trim();
    let recipientEmail = String(task.assigneeEmail || '').trim();
    let matchedFullName = assigneeRaw;

    const dbFirestore = getFirestore();
    if (!recipientEmail && dbFirestore && assigneeRaw && assigneeRaw.toLowerCase() !== 'unassigned') {
      const employeesSnap = await dbFirestore.collection('employees').get();
      const lowerAssignee = assigneeRaw.toLowerCase();
      for (const doc of employeesSnap.docs) {
        const data = doc.data();
        const name = String(data.fullName || '').trim().toLowerCase();
        if (name && (name.includes(lowerAssignee) || lowerAssignee.includes(name))) {
          recipientEmail = data.email || data.personalEmail || '';
          matchedFullName = data.fullName || assigneeRaw;
          break;
        }
      }
    }

    if (!recipientEmail || !recipientEmail.includes('@')) {
      logger.info('EmailService', `No valid recipient email for "${assigneeRaw}". Email not sent.`);
      return;
    }

    const formattedDeadline = formatDeadlineDisplay(task.deadline);
    const { transporter, user: gmailUser, pass: gmailPass } = createSmtpTransporter();

    if (!gmailPass) {
      logger.info('EmailService', `SMTP not configured. Simulated email to ${recipientEmail} for "${task.title}".`);
      return;
    }

    const appLink = env.APP_URL || 'https://new-arkoo.pages.dev/';

    const mailOptions = {
      from: `"Arkoo Task Manager" <${gmailUser}>`,
      to: recipientEmail,
      subject: `📋 New Task Assigned: ${task.title} [Due: ${formattedDeadline}]`,
      html: buildTaskEmailHtml(matchedFullName, task, formattedDeadline, appLink),
    };

    await transporter.sendMail(mailOptions);
    logger.info('EmailService', `Task email sent to ${recipientEmail} for "${task.title}".`);
  } catch (err: any) {
    logger.error('EmailService', `Failed to send task email for "${task?.title}"`, err);
  }
}

/**
 * Send a stakeholder invitation email.
 */
export async function sendInvitationEmail(params: {
  fullName: string;
  email: string;
  personalEmail?: string;
  stakeholderType?: string;
  department?: string;
}): Promise<{ success: boolean; simulated?: boolean; error?: string }> {
  const recipientEmail = String(params.email || params.personalEmail || '').trim();
  if (!recipientEmail || !recipientEmail.includes('@')) {
    return { success: false, error: 'Valid email address required' };
  }

  const { transporter, user: gmailUser, pass: gmailPass } = createSmtpTransporter();
  const appLink = env.APP_URL || 'https://new-arkoo.pages.dev/';

  if (!gmailPass) {
    logger.info('EmailService', `SMTP not configured. Simulated invitation to ${recipientEmail}.`);
    return { success: true, simulated: true };
  }

  const mailOptions = {
    from: `"Arkoo Prebuild Admin" <${gmailUser}>`,
    to: recipientEmail,
    subject: `✉️ Welcome to Arkoo Prebuild - Stakeholder Invitation`,
    html: buildInvitationEmailHtml(params.fullName, recipientEmail, params.stakeholderType, params.department, appLink),
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('EmailService', `Invitation sent to ${recipientEmail}`);
    return { success: true };
  } catch (err: any) {
    logger.error('EmailService', `Invitation failed for ${recipientEmail}`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Send an account acceptance/activation email.
 */
export async function sendAcceptanceEmail(params: {
  fullName: string;
  email: string;
  personalEmail?: string;
  stakeholderType?: string;
  department?: string;
}): Promise<{ success: boolean; simulated?: boolean; error?: string }> {
  const recipientEmail = String(params.email || params.personalEmail || '').trim();
  if (!recipientEmail || !recipientEmail.includes('@')) {
    return { success: false, error: 'Valid email address required' };
  }

  const { transporter, user: gmailUser, pass: gmailPass } = createSmtpTransporter();
  const appLink = env.APP_URL || 'https://new-arkoo.pages.dev/';

  if (!gmailPass) {
    logger.info('EmailService', `SMTP not configured. Simulated acceptance to ${recipientEmail}.`);
    return { success: true, simulated: true };
  }

  const mailOptions = {
    from: `"Arkoo Prebuild Admin" <${gmailUser}>`,
    to: recipientEmail,
    subject: `🎉 Account Approved - Access Arkoo Prebuild Platform`,
    html: buildAcceptanceEmailHtml(params.fullName, recipientEmail, params.stakeholderType, params.department, appLink),
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info('EmailService', `Acceptance email sent to ${recipientEmail}`);
    return { success: true };
  } catch (err: any) {
    logger.error('EmailService', `Acceptance email failed for ${recipientEmail}`, err);
    return { success: false, error: err.message };
  }
}

// ─── Email HTML Templates ──────────────────────────────────

function buildTaskEmailHtml(name: string, task: TaskEmailPayload, deadline: string, appLink: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
      <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 18px; border-radius: 10px; text-align: center;">
        <h2 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: bold;">New Task Assignment</h2>
        <p style="color: #ffedd5; margin: 4px 0 0 0; font-size: 13px;">Meeting / Project: ${task.meetingTitle || 'Arkoo Project Meeting'}</p>
      </div>
      <div style="padding: 24px 0 12px 0;">
        <p style="font-size: 15px; color: #1e293b; margin-top: 0;">Hello <strong>${name}</strong>,</p>
        <p style="font-size: 14px; color: #475569; line-height: 1.5;">You have been allotted a new task. Below are the details:</p>
        <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-left: 5px solid #f97316; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <h3 style="margin: 0 0 8px 0; color: #0f172a; font-size: 16px;">${task.title}</h3>
          <p style="margin: 0 0 14px 0; color: #334155; font-size: 14px; line-height: 1.5;">${task.description}</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #64748b;"><strong>Deadline:</strong></td><td style="padding: 8px 0; color: #c2410c; font-weight: bold;">${deadline}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #64748b;"><strong>Priority:</strong></td><td style="padding: 8px 0; color: #0f172a; text-transform: capitalize; font-weight: 600;">${task.priority}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;"><strong>Department:</strong></td><td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${task.department}</td></tr>
          </table>
        </div>
        <p style="font-size: 13px; color: #64748b;">Please log in to your Arkoo dashboard to review and manage your assigned tasks.</p>
        <p style="text-align: center; margin: 20px 0;">
          <a href="${appLink}" style="background-color: #f97316; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block;">Open Arkoo Task Dashboard</a>
        </p>
      </div>
      <div style="border-top: 1px solid #f1f5f9; padding-top: 14px; text-align: center; font-size: 11px; color: #94a3b8;">
        Arkoo Prebuild Pvt. Ltd. • Construction &amp; Infrastructure Operations
      </div>
    </div>`;
}

function buildInvitationEmailHtml(name: string, email: string, role?: string, department?: string, appLink?: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
      <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 20px; border-radius: 10px; text-align: center;">
        <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: bold;">Arkoo Prebuild Invitation</h2>
        <p style="color: #ffedd5; margin: 4px 0 0 0; font-size: 13px;">Construction &amp; Infrastructure Operations</p>
      </div>
      <div style="padding: 24px 0 12px 0;">
        <p style="font-size: 16px; color: #1e293b; margin-top: 0;">Dear <strong>${name}</strong>,</p>
        <p style="font-size: 14px; color: #475569; line-height: 1.6;">You have been added as a stakeholder on the <strong>Arkoo Prebuild Intelligence Platform</strong> by your Administrator.</p>
        <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-left: 5px solid #f97316; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px 0; color: #9a3412; font-size: 15px;">📋 Registration Details</h3>
          <p style="margin: 0 0 6px 0; color: #431407; font-size: 13px;"><strong>Official Email:</strong> ${email}</p>
          <p style="margin: 0 0 6px 0; color: #431407; font-size: 13px;"><strong>Stakeholder Role:</strong> ${role || 'Employee'}</p>
          <p style="margin: 0 0 6px 0; color: #431407; font-size: 13px;"><strong>Department:</strong> ${department || 'General'}</p>
          <p style="margin: 10px 0 0 0; color: #c2410c; font-size: 13px; font-weight: bold;">Status: Pending Admin Approval</p>
        </div>
        <p style="font-size: 14px; color: #475569; line-height: 1.6;">Your account request is currently pending review by the Administrator.</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${appLink}" style="background-color: #f97316; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block;">Access Application Portal</a>
        </div>
      </div>
      <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
        Arkoo Prebuild Pvt. Ltd. • Secure Access Management System
      </div>
    </div>`;
}

function buildAcceptanceEmailHtml(name: string, email: string, role?: string, department?: string, appLink?: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
      <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 20px; border-radius: 10px; text-align: center;">
        <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: bold;">Account Approved &amp; Activated</h2>
        <p style="color: #d1fae5; margin: 4px 0 0 0; font-size: 13px;">Arkoo Prebuild Intelligence Platform</p>
      </div>
      <div style="padding: 24px 0 12px 0;">
        <p style="font-size: 16px; color: #1e293b; margin-top: 0;">Dear <strong>${name}</strong>,</p>
        <p style="font-size: 14px; color: #475569; line-height: 1.6;">Great news! Your stakeholder account has been officially <strong>accepted and activated</strong>.</p>
        <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-left: 5px solid #10b981; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px 0; color: #065f46; font-size: 15px;">✅ Account Details</h3>
          <p style="margin: 0 0 6px 0; color: #064e3b; font-size: 13px;"><strong>Official Email:</strong> ${email}</p>
          <p style="margin: 0 0 6px 0; color: #064e3b; font-size: 13px;"><strong>Stakeholder Role:</strong> ${role || 'Employee'}</p>
          <p style="margin: 0 0 6px 0; color: #064e3b; font-size: 13px;"><strong>Department:</strong> ${department || 'General'}</p>
          <p style="margin: 10px 0 0 0; color: #047857; font-size: 13px; font-weight: bold;">Status: Active / Approved</p>
        </div>
        <p style="font-size: 14px; color: #475569; line-height: 1.6;">You can now log in using your Google account associated with <strong>${email}</strong>:</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${appLink}" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: #ffffff; padding: 14px 28px; text-decoration: none; font-weight: bold; border-radius: 10px; display: inline-block; font-size: 15px;">🚀 Open Arkoo Application</a>
        </div>
      </div>
      <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
        Arkoo Prebuild Pvt. Ltd. • Secure Access Management System
      </div>
    </div>`;
}
