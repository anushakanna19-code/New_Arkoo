import { Router } from 'express';
import { sendInvitationEmail, sendAcceptanceEmail, sendTaskAssignmentEmail, createSmtpTransporter } from '../services/email.service.js';
import { getFirestore } from '../config/firebase.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ─── Send Task Assignment Email ────────────────────────────
router.post('/send-task-email', async (req, res) => {
  try {
    const { title, description, assigneeName, assigneeEmail, deadline, priority, department, meetingTitle } = req.body;

    sendTaskAssignmentEmail({
      title: title || 'Untitled Task',
      description: description || 'No description provided.',
      assigneeName: assigneeName || 'Unassigned',
      assigneeEmail,
      deadline: deadline || 'Friday 5 PM',
      priority: priority || 'medium',
      department: department || 'General',
      meetingTitle: meetingTitle || 'Arkoo Meeting / Task Assignment',
    }).catch(err => {
      logger.error('EmailRoutes', 'Background task email dispatch failed', err);
    });

    return res.json({ success: true, message: 'Task email dispatch initiated' });
  } catch (err: any) {
    logger.error('EmailRoutes', 'Task email route error', err);
    return res.status(500).json({ error: err.message || 'Failed to initiate task email' });
  }
});

// ─── Send Stakeholder Invitation Email ─────────────────────
router.post('/send-invitation-email', async (req, res) => {
  try {
    const { fullName, email, personalEmail, stakeholderType, department } = req.body;
    const result = await sendInvitationEmail({ fullName, email, personalEmail, stakeholderType, department });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true, simulated: result.simulated, message: `Invitation email queued for ${email || personalEmail}` });
  } catch (err: any) {
    logger.error('EmailRoutes', 'Invitation email error', err);
    return res.status(500).json({ error: err.message || 'Failed to process invitation' });
  }
});

// ─── Send Acceptance / Activation Email ────────────────────
router.post('/send-acceptance-email', async (req, res) => {
  try {
    const { fullName, email, personalEmail, stakeholderType, department } = req.body;
    const result = await sendAcceptanceEmail({ fullName, email, personalEmail, stakeholderType, department });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true, simulated: result.simulated, message: `Acceptance email queued for ${email || personalEmail}` });
  } catch (err: any) {
    logger.error('EmailRoutes', 'Acceptance email error', err);
    return res.status(500).json({ error: err.message || 'Failed to process acceptance' });
  }
});

// ─── Bulk Send Application Link ────────────────────────────
router.post('/send-bulk-application-link', async (req, res) => {
  try {
    const { stakeholders } = req.body;
    let listToNotify: any[] = [];

    if (Array.isArray(stakeholders) && stakeholders.length > 0) {
      listToNotify = stakeholders;
    } else {
      const dbFirestore = getFirestore();
      if (dbFirestore) {
        try {
          const snap = await dbFirestore.collection('employees').get();
          listToNotify = snap.docs.map(d => d.data());
        } catch (e: any) {
          logger.warn('EmailRoutes', 'Firestore fetch failed in bulk email', { error: e.message });
        }
      }
    }

    if (listToNotify.length === 0) {
      return res.status(400).json({ error: 'No stakeholders provided or found.' });
    }

    const { transporter, user: gmailUser, pass: gmailPass } = createSmtpTransporter();
    const appLink = env.APP_URL || 'https://new-arkoo.pages.dev/';

    if (!gmailPass) {
      return res.json({ success: true, count: listToNotify.length, simulated: true });
    }

    const processed = new Set<string>();
    let successCount = 0;

    for (const emp of listToNotify) {
      const targetEmail = String(emp.email || emp.officialEmail || emp.personalEmail || '').trim();
      if (!targetEmail || !targetEmail.includes('@') || processed.has(targetEmail.toLowerCase())) continue;
      processed.add(targetEmail.toLowerCase());

      const fullName = emp.fullName || 'Stakeholder';
      const status = String(emp.status || (emp.isActive !== false ? 'Active' : 'Pending'));
      const isApproved = status.toLowerCase() === 'active' || status.toLowerCase() === 'accepted';

      const mailOptions = {
        from: `"Arkoo Prebuild Admin" <${gmailUser}>`,
        to: targetEmail,
        subject: isApproved
          ? `🎉 Account Approved - Access Arkoo Prebuild Platform`
          : `✉️ Welcome to Arkoo Prebuild - Stakeholder Portal Link`,
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <p>Dear <strong>${fullName}</strong>,</p>
          <p>Access the Arkoo Prebuild Platform: <a href="${appLink}">${appLink}</a></p>
          <p>Status: ${status}</p>
        </div>`,
      };

      try {
        await transporter.sendMail(mailOptions);
        successCount++;
      } catch (err: any) {
        logger.error('EmailRoutes', `Bulk email failed for ${targetEmail}`, err);
      }
    }

    return res.json({ success: true, count: successCount, message: `Application link sent to ${successCount} stakeholder(s).` });
  } catch (err: any) {
    logger.error('EmailRoutes', 'Bulk email dispatch error', err);
    return res.status(500).json({ error: err.message || 'Failed to dispatch bulk emails.' });
  }
});

export default router;
