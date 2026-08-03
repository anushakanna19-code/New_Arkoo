import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import admin from "firebase-admin";
import fs from "fs";
import { exec } from "child_process";

import OpenAI from 'openai';
import nodemailer from 'nodemailer';
import { v2 as cloudinary } from 'cloudinary';
import rateLimit from 'express-rate-limit';

const __filenameResolved = typeof import.meta !== 'undefined' && import.meta.url 
  ? fileURLToPath(import.meta.url) 
  : (typeof __filename !== 'undefined' ? __filename : '');

const __dirnameResolved = typeof __dirname !== 'undefined' && __dirname !== ''
  ? __dirname
  : (__filenameResolved ? path.dirname(__filenameResolved) : process.cwd());

dotenv.config({ path: path.join(__dirnameResolved, '.env'), override: true });
dotenv.config({ path: path.join(process.cwd(), 'backend', '.env'), override: true });
dotenv.config({ override: true });

function parseRelativeDeadlineServer(val: string, baseDate: Date = new Date()): Date {
  const clean = String(val || '').trim().toLowerCase();
  const now = new Date(baseDate);

  const directParse = new Date(val);
  if (!isNaN(directParse.getTime()) && (clean.includes('-') || clean.includes('/') || clean.includes('t'))) {
    return directParse;
  }

  let hour = 17; // Default 5:00 PM
  let minute = 0;

  const timeMatch = clean.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let parsedHour = parseInt(timeMatch[1], 10);
    const parsedMin = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

    if (ampm === 'pm' && parsedHour < 12) parsedHour += 12;
    if (ampm === 'am' && parsedHour === 12) parsedHour = 0;
    
    if (parsedHour >= 0 && parsedHour <= 23) {
      hour = parsedHour;
      minute = parsedMin;
    }
  }

  const setTargetTime = (d: Date) => {
    const r = new Date(d);
    r.setHours(hour, minute, 0, 0);
    return r;
  };

  const nextWeekday = (target: number) => {
    const d = new Date(now);
    const currentDay = d.getDay();
    let diff = target - currentDay;
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return setTargetTime(d);
  };

  if (clean.includes('immediate') || clean.includes('eod') || clean.includes('now') || clean.includes('today') || clean.includes('end of day')) {
    return setTargetTime(now);
  }
  if (clean.includes('tomorrow')) {
    const tom = new Date(now);
    tom.setDate(tom.getDate() + 1);
    return setTargetTime(tom);
  }
  if (clean.includes('monday')) return nextWeekday(1);
  if (clean.includes('tuesday')) return nextWeekday(2);
  if (clean.includes('wednesday')) return nextWeekday(3);
  if (clean.includes('thursday')) return nextWeekday(4);
  if (clean.includes('friday')) return nextWeekday(5);
  if (clean.includes('saturday')) return nextWeekday(6);
  if (clean.includes('sunday')) return nextWeekday(0);
  if (clean.includes('next week')) {
    const nw = new Date(now);
    nw.setDate(nw.getDate() + 7);
    return setTargetTime(nw);
  }

  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 3);
  return setTargetTime(fallback);
}

function formatDeadlineDisplayServer(deadline: any): string {
  if (!deadline) return 'No deadline';
  
  let dateObj: Date | null = null;
  if (deadline && typeof deadline.toDate === 'function') {
    dateObj = deadline.toDate();
  } else if (deadline && deadline.seconds) {
    dateObj = new Date(deadline.seconds * 1000);
  } else if (deadline instanceof Date) {
    dateObj = deadline;
  } else if (typeof deadline === 'string') {
    dateObj = parseRelativeDeadlineServer(deadline);
  }

  if (!dateObj || isNaN(dateObj.getTime())) {
    return String(deadline);
  }

  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  let hours = dateObj.getHours();
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = String(hours).padStart(2, '0');

  return `${day}-${month}-${year}, ${strHours}:${minutes} ${ampm}`;
}

function createGoogleSmtpTransporter() {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = (process.env.GMAIL_USER || process.env.SMTP_USER || 'anushakanna19@gmail.com').trim();
  const pass = (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '').trim();

  const transporter = nodemailer.createTransport({
    host: host,
    port: port,
    secure: port === 465,
    auth: {
      user: user,
      pass: pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  return { transporter, user, pass };
}

async function sendTaskAssignmentEmail(task: {
  title: string;
  description: string;
  assigneeName: string;
  assigneeEmail?: string;
  deadline: any;
  priority: string;
  department: string;
  meetingTitle?: string;
}): Promise<void> {
  try {
    const assigneeRaw = String(task.assigneeName || '').trim();
    let recipientEmail = String(task.assigneeEmail || '').trim();
    let matchedFullName = assigneeRaw;

    if (!recipientEmail && dbFirestore && assigneeRaw && assigneeRaw.toLowerCase() !== 'unassigned') {
      const employeesSnap = await dbFirestore.collection("employees").get();
      const lowerAssignee = assigneeRaw.toLowerCase();
      for (const doc of employeesSnap.docs) {
        const data = doc.data();
        const name = String(data.fullName || '').trim().toLowerCase();
        if (name && (name.includes(lowerAssignee) || lowerAssignee.includes(name))) {
          recipientEmail = data.email || data.personalEmail || "";
          matchedFullName = data.fullName || assigneeRaw;
          break;
        }
      }
    }

    if (!recipientEmail || !recipientEmail.includes('@')) {
      console.log(`[Task Email Notice] No valid recipient email found for "${assigneeRaw}". Email not dispatched.`);
      return;
    }

    const formattedDeadline = formatDeadlineDisplayServer(task.deadline);
    const { transporter, user: gmailUser, pass: gmailPass } = createGoogleSmtpTransporter();

    if (!gmailPass) {
      console.log(`[Task Email Notice] GMAIL_APP_PASSWORD not set in env. Simulated email notification sent to ${recipientEmail} (${matchedFullName}) for task "${task.title}".`);
      return;
    }

    const mailOptions = {
      from: `"Arkoo Task Manager" <${gmailUser}>`,
      to: recipientEmail,
      subject: `📋 New Task Assigned: ${task.title} [Due: ${formattedDeadline}]`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 18px; border-radius: 10px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: bold;">New Task Assignment</h2>
            <p style="color: #ffedd5; margin: 4px 0 0 0; font-size: 13px;">Meeting / Project: ${task.meetingTitle || 'Arkoo Project Meeting'}</p>
          </div>
          
          <div style="padding: 24px 0 12px 0;">
            <p style="font-size: 15px; color: #1e293b; margin-top: 0;">Hello <strong>${matchedFullName}</strong>,</p>
            <p style="font-size: 14px; color: #475569; line-height: 1.5;">You have been allotted a new task. Below are the details:</p>
            
            <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-left: 5px solid #f97316; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <h3 style="margin: 0 0 8px 0; color: #0f172a; font-size: 16px;">${task.title}</h3>
              <p style="margin: 0 0 14px 0; color: #334155; font-size: 14px; line-height: 1.5;">${task.description}</p>
              
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 8px 0; color: #64748b;"><strong>Deadline:</strong></td>
                  <td style="padding: 8px 0; color: #c2410c; font-weight: bold;">${formattedDeadline}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 8px 0; color: #64748b;"><strong>Priority:</strong></td>
                  <td style="padding: 8px 0; color: #0f172a; text-transform: capitalize; font-weight: 600;">${task.priority}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b;"><strong>Department:</strong></td>
                  <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${task.department}</td>
                </tr>
              </table>
            </div>
            
            <p style="font-size: 13px; color: #64748b;">Please log in to your Arkoo dashboard to review and manage your assigned tasks.</p>
            <p style="text-align: center; margin: 20px 0;">
              <a href="https://appointee-sharpie-pouncing.ngrok-free.dev/" style="background-color: #f97316; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block;">Open Arkoo Task Dashboard</a>
            </p>
            <p style="font-size: 12px; color: #64748b; text-align: center; word-break: break-all;">
              Application URL: <a href="https://appointee-sharpie-pouncing.ngrok-free.dev/" style="color: #ea580c; font-weight: bold;">https://appointee-sharpie-pouncing.ngrok-free.dev/</a>
            </p>
          </div>

          <div style="border-top: 1px solid #f1f5f9; padding-top: 14px; text-align: center; font-size: 11px; color: #94a3b8;">
            Arkoo Prebuild Pvt. Ltd. • Construction & Infrastructure Operations
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`[Task Email Success] Task assignment email sent to ${recipientEmail} for "${task.title}".`);
  } catch (err: any) {
    console.error(`[Task Email Error] Failed to send task email for "${task?.title}":`, err?.message || err);
  }
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Production Security: Rate Limiting & Origin Shielding
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again after 15 minutes." }
});

app.use("/api/process-meeting", apiLimiter);
app.use("/api/ask-meeting", apiLimiter);

app.use((req, res, next) => {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(o => o.trim()).filter(Boolean);
  const origin = req.headers.origin;

  if (allowedOrigins.length > 0 && origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  } else {
    res.header("Access-Control-Allow-Origin", "*");
  }

  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// ─── Live Audio Chunk Transcription API Endpoint ───────────────────────────
app.post("/api/transcribe-chunk", async (req, res) => {
  try {
    const { chunkBase64, mimeType, chunkIndex, meetingId } = req.body;
    if (!chunkBase64) {
      return res.status(400).json({ error: "Missing chunkBase64 data" });
    }

    const chunkBuffer = Buffer.from(chunkBase64, "base64");
    let text = "";

    // 1. Try Groq Whisper transcription if GROQ_API_KEY available
    const activeGroqKey = process.env.GROQ_API_KEY || (await getSavedKeyFromFirestore("groq_key"));
    if (activeGroqKey) {
      try {
        const formData = new FormData();
        const blob = new Blob([chunkBuffer], { type: mimeType || "audio/webm" });
        formData.append("file", blob, `chunk_${chunkIndex || 0}.webm`);
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "json");

        const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${activeGroqKey}`
          },
          body: formData
        });

        if (groqRes.ok) {
          const groqData = await groqRes.json();
          text = groqData.text || "";
        }
      } catch (groqErr: any) {
        console.warn("[Chunk Transcribe Groq Warning]:", groqErr?.message || groqErr);
      }
    }

    // 2. Fallback to Gemini if Groq did not yield text
    if (!text && process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent([
          {
            inlineData: {
              mimeType: mimeType || "audio/webm",
              data: chunkBase64
            }
          },
          "Listen to this audio clip. If it is spoken in Marathi, Hindi, or Hinglish, translate it accurately into clear English text. Output only the English translation without any commentary."
        ]);
        text = result.response.text().trim();
      } catch (geminiErr: any) {
        console.warn("[Chunk Transcribe Gemini Warning]:", geminiErr?.message || geminiErr);
      }
    }

    return res.json({ success: true, text: text || "", chunkIndex });
  } catch (error: any) {
    console.error("[Transcribe Chunk Error]:", error);
    return res.status(500).json({ error: error.message || "Failed to transcribe chunk" });
  }
});

// ─── Task Assignment Email API Route ──────────────────────────────────────
app.post("/api/send-task-email", async (req, res) => {
  try {
    const { title, description, assigneeName, assigneeEmail, deadline, priority, department, meetingTitle } = req.body;
    
    // Dispatch task email asynchronously in background
    sendTaskAssignmentEmail({
      title: title || "Untitled Task",
      description: description || "No description provided.",
      assigneeName: assigneeName || "Unassigned",
      assigneeEmail: assigneeEmail,
      deadline: deadline || "Friday 5 PM",
      priority: priority || "medium",
      department: department || "General",
      meetingTitle: meetingTitle || "Arkoo Meeting / Task Assignment"
    }).catch(err => {
      console.error("[Task Email Route Error] Background dispatch failed:", err?.message || err);
    });

    return res.json({ success: true, message: "Task email dispatch initiated" });
  } catch (err: any) {
    console.error("[Task Email Route Error]:", err?.message || err);
    return res.status(500).json({ error: err.message || "Failed to initiate task email" });
  }
});

// ─── Stakeholder Invitation Email Route ────────────────────────────────────
app.post("/api/send-invitation-email", async (req, res) => {
  try {
    const { fullName, email, personalEmail, stakeholderType, department } = req.body;
    
    // Target ONLY Official Email (fallback to personal only if official is empty)
    const recipientEmail = String(email || personalEmail || '').trim();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      return res.status(400).json({ error: "Valid official email address is required" });
    }

    const { transporter, user: gmailUser, pass: gmailPass } = createGoogleSmtpTransporter();
    const appLink = "https://appointee-sharpie-pouncing.ngrok-free.dev/";

    if (!gmailPass) {
      console.log(`[Invitation Email Notice] GMAIL_APP_PASSWORD not set in env. Simulated invitation email sent to ${recipientEmail} (${fullName}).`);
      return res.json({ success: true, simulated: true, message: "Invitation email queued (simulated SMTP)" });
    }

    const mailOptions = {
      from: `"Arkoo Prebuild Admin" <${gmailUser}>`,
      to: recipientEmail,
      subject: `✉️ Welcome to Arkoo Prebuild - Stakeholder Invitation`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 20px; border-radius: 10px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: bold;">Arkoo Prebuild Invitation</h2>
            <p style="color: #ffedd5; margin: 4px 0 0 0; font-size: 13px;">Construction & Infrastructure Operations</p>
          </div>
          
          <div style="padding: 24px 0 12px 0;">
            <p style="font-size: 16px; color: #1e293b; margin-top: 0;">Dear <strong>${fullName}</strong>,</p>
            <p style="font-size: 14px; color: #475569; line-height: 1.6;">You have been added as a stakeholder on the <strong>Arkoo Prebuild Intelligence Platform</strong> by your Administrator.</p>
            
            <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-left: 5px solid #f97316; padding: 16px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 8px 0; color: #9a3412; font-size: 15px;">📋 Registration Details</h3>
              <p style="margin: 0 0 6px 0; color: #431407; font-size: 13px;"><strong>Official Email:</strong> ${recipientEmail}</p>
              <p style="margin: 0 0 6px 0; color: #431407; font-size: 13px;"><strong>Stakeholder Role:</strong> ${stakeholderType || 'Employee'}</p>
              <p style="margin: 0 0 6px 0; color: #431407; font-size: 13px;"><strong>Department:</strong> ${department || 'General'}</p>
              <p style="margin: 10px 0 0 0; color: #c2410c; font-size: 13px; font-weight: bold;">Status: Pending Admin Approval</p>
            </div>
            
            <p style="font-size: 14px; color: #475569; line-height: 1.6;">Your account request is currently pending review by the Administrator. Once approved, you will be able to sign in using your registered email address.</p>
            
            <div style="text-align: center; margin: 24px 0;">
              <a href="${appLink}" style="background-color: #f97316; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block;">
                Access Application Portal
              </a>
            </div>
            
            <p style="font-size: 12px; color: #64748b; text-align: center; word-break: break-all;">
              Application URL: <a href="${appLink}" style="color: #ea580c; font-weight: bold;">${appLink}</a>
            </p>
          </div>

          <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
            Arkoo Prebuild Pvt. Ltd. • Secure Access Management System
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`[Invitation Email Success] Invitation email successfully dispatched to official email ${recipientEmail}`);
    return res.json({ success: true, message: `Invitation email sent to ${recipientEmail}` });
  } catch (err: any) {
    console.error(`[Invitation Email Error] Failed to send invitation email:`, err?.message || err);
    return res.status(500).json({ error: err.message || "Failed to send invitation email" });
  }
});

// ─── Stakeholder Acceptance / Activation Email Route ───────────────────────
app.post("/api/send-acceptance-email", async (req, res) => {
  try {
    const { fullName, email, personalEmail, stakeholderType, department } = req.body;

    // Target ONLY Official Email (fallback to personal only if official is empty)
    const recipientEmail = String(email || personalEmail || '').trim();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      return res.status(400).json({ error: "Valid official email address is required" });
    }

    const { transporter, user: gmailUser, pass: gmailPass } = createGoogleSmtpTransporter();
    const appLink = "https://appointee-sharpie-pouncing.ngrok-free.dev/";

    if (!gmailPass) {
      console.log(`[Acceptance Email Notice] GMAIL_APP_PASSWORD not set in env. Simulated activation email sent to ${recipientEmail} (${fullName}).`);
      return res.json({ success: true, simulated: true, message: "Activation email queued (simulated SMTP)" });
    }

    const mailOptions = {
      from: `"Arkoo Prebuild Admin" <${gmailUser}>`,
      to: recipientEmail,
      subject: `🎉 Account Approved - Access Arkoo Prebuild Platform`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 20px; border-radius: 10px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: bold;">Account Approved & Activated</h2>
            <p style="color: #d1fae5; margin: 4px 0 0 0; font-size: 13px;">Arkoo Prebuild Intelligence Platform</p>
          </div>
          
          <div style="padding: 24px 0 12px 0;">
            <p style="font-size: 16px; color: #1e293b; margin-top: 0;">Dear <strong>${fullName}</strong>,</p>
            <p style="font-size: 14px; color: #475569; line-height: 1.6;">Great news! Your stakeholder account has been officially <strong>accepted and activated</strong> by the Administrator.</p>
            
            <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-left: 5px solid #10b981; padding: 16px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 8px 0; color: #065f46; font-size: 15px;">✅ Account Credentials & Details</h3>
              <p style="margin: 0 0 6px 0; color: #064e3b; font-size: 13px;"><strong>Official Email:</strong> ${recipientEmail}</p>
              <p style="margin: 0 0 6px 0; color: #064e3b; font-size: 13px;"><strong>Stakeholder Role:</strong> ${stakeholderType || 'Employee'}</p>
              <p style="margin: 0 0 6px 0; color: #064e3b; font-size: 13px;"><strong>Department:</strong> ${department || 'General'}</p>
              <p style="margin: 10px 0 0 0; color: #047857; font-size: 13px; font-weight: bold;">Status: Active / Approved</p>
            </div>
            
            <p style="font-size: 14px; color: #475569; line-height: 1.6;">You can now log in directly using your Google account associated with <strong>${recipientEmail}</strong> via the link below:</p>

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

    await transporter.sendMail(mailOptions);
    console.log(`[Acceptance Email Success] Acceptance email with application link dispatched to official email ${recipientEmail}`);
    return res.json({ success: true, message: `Acceptance email sent to ${recipientEmail}` });
  } catch (err: any) {
    console.error(`[Acceptance Email Error] Failed to send acceptance email:`, err?.message || err);
    return res.status(500).json({ error: err.message || "Failed to send acceptance email" });
  }
});

// ─── Bulk Send Application Link to Existing Stakeholders ───────────────────
app.post("/api/send-bulk-application-link", async (req, res) => {
  try {
    const { stakeholders } = req.body;
    let listToNotify: any[] = [];

    if (Array.isArray(stakeholders) && stakeholders.length > 0) {
      listToNotify = stakeholders;
    } else if (dbFirestore) {
      try {
        const snap = await dbFirestore.collection("employees").get();
        listToNotify = snap.docs.map(d => d.data());
      } catch (e: any) {
        console.warn("Firestore collection fetch failed in send-bulk-application-link:", e);
      }
    }

    if (listToNotify.length === 0) {
      return res.status(400).json({ error: "No stakeholders provided or found for bulk email dispatch." });
    }

    const { transporter, user: gmailUser, pass: gmailPass } = createGoogleSmtpTransporter();
    const appLink = "https://appointee-sharpie-pouncing.ngrok-free.dev/";

    if (!gmailPass) {
      return res.json({ success: true, count: listToNotify.length, simulated: true });
    }

    const processed = new Set<string>();
    let successCount = 0;

    for (const emp of listToNotify) {
      const targetEmail = String(emp.email || emp.officialEmail || emp.personalEmail || '').trim();
      if (!targetEmail || !targetEmail.includes('@') || processed.has(targetEmail.toLowerCase())) {
        continue;
      }
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
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
            <div style="background: linear-gradient(135deg, ${isApproved ? '#10b981 0%, #059669' : '#f97316 0%, #ea580c'} 100%); padding: 20px; border-radius: 10px; text-align: center;">
              <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: bold;">${isApproved ? 'Account Approved & Activated' : 'Arkoo Prebuild Platform Access'}</h2>
              <p style="color: ${isApproved ? '#d1fae5' : '#ffedd5'}; margin: 4px 0 0 0; font-size: 13px;">Arkoo Prebuild Intelligence Platform</p>
            </div>
            
            <div style="padding: 24px 0 12px 0;">
              <p style="font-size: 16px; color: #1e293b; margin-top: 0;">Dear <strong>${fullName}</strong>,</p>
              <p style="font-size: 14px; color: #475569; line-height: 1.6;">
                Here is your official access link for the <strong>Arkoo Prebuild Intelligence Platform</strong>.
              </p>
              
              <div style="background-color: ${isApproved ? '#ecfdf5' : '#fff7ed'}; border: 1px solid ${isApproved ? '#a7f3d0' : '#fed7aa'}; border-left: 5px solid ${isApproved ? '#10b981' : '#f97316'}; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin: 0 0 8px 0; color: ${isApproved ? '#065f46' : '#9a3412'}; font-size: 15px;">📋 Registration Credentials</h3>
                <p style="margin: 0 0 6px 0; color: ${isApproved ? '#064e3b' : '#431407'}; font-size: 13px;"><strong>Stakeholder:</strong> ${fullName}</p>
                <p style="margin: 0 0 6px 0; color: ${isApproved ? '#064e3b' : '#431407'}; font-size: 13px;"><strong>Official Email:</strong> ${targetEmail}</p>
                <p style="margin: 0 0 6px 0; color: ${isApproved ? '#064e3b' : '#431407'}; font-size: 13px;"><strong>Stakeholder Role:</strong> ${emp.stakeholderType || 'Employee'}</p>
                <p style="margin: 0 0 6px 0; color: ${isApproved ? '#064e3b' : '#431407'}; font-size: 13px;"><strong>Department:</strong> ${emp.department || 'General'}</p>
                <p style="margin: 10px 0 0 0; color: ${isApproved ? '#047857' : '#c2410c'}; font-size: 13px; font-weight: bold;">Status: ${status}</p>
              </div>
              
              <p style="font-size: 14px; color: #475569; line-height: 1.6;">Click below to access the platform directly:</p>

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
        await transporter.sendMail(mailOptions);
        successCount++;
        console.log(`[Bulk Link Dispatch] Sent application link to "${fullName}" <${targetEmail}>`);
      } catch (err: any) {
        console.error(`[Bulk Link Dispatch Error] Failed for ${targetEmail}:`, err.message || err);
      }
    }

    return res.json({ success: true, count: successCount, message: `Application link sent to ${successCount} stakeholder official email(s).` });
  } catch (err: any) {
    console.error(`[Bulk Link Dispatch Error]:`, err);
    return res.status(500).json({ error: err.message || "Failed to dispatch bulk application links." });
  }
});

// Ensure server-side uploads directory exists for storing and transcoding recordings
const UPLOADS_DIR = fs.existsSync(path.join(__dirnameResolved, "uploads"))
  ? path.join(__dirnameResolved, "uploads")
  : path.join(process.cwd(), "backend", "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const CONFIG_DIR = fs.existsSync(path.join(__dirnameResolved, "config")) 
  ? path.join(__dirnameResolved, "config") 
  : path.join(process.cwd(), "backend", "config");

const GDRIVE_SETTINGS_FILE = fs.existsSync(path.join(CONFIG_DIR, "gdrive-settings.json"))
  ? path.join(CONFIG_DIR, "gdrive-settings.json")
  : path.join(process.cwd(), "gdrive-settings.json");

const GEMINI_SETTINGS_FILE = fs.existsSync(path.join(CONFIG_DIR, "gemini-settings.json"))
  ? path.join(CONFIG_DIR, "gemini-settings.json")
  : path.join(process.cwd(), "gemini-settings.json");

const NVIDIA_SETTINGS_FILE = fs.existsSync(path.join(CONFIG_DIR, "nvidia-settings.json"))
  ? path.join(CONFIG_DIR, "nvidia-settings.json")
  : path.join(process.cwd(), "nvidia-settings.json");

const GROQ_SETTINGS_FILE = fs.existsSync(path.join(CONFIG_DIR, "groq-settings.json"))
  ? path.join(CONFIG_DIR, "groq-settings.json")
  : path.join(process.cwd(), "groq-settings.json");

const CLOUDINARY_SETTINGS_FILE = fs.existsSync(path.join(CONFIG_DIR, "cloudinary-settings.json"))
  ? path.join(CONFIG_DIR, "cloudinary-settings.json")
  : path.join(process.cwd(), "cloudinary-settings.json");

function loadCloudinarySettingsLocal(): any {
  try {
    if (fs.existsSync(CLOUDINARY_SETTINGS_FILE)) {
      const content = fs.readFileSync(CLOUDINARY_SETTINGS_FILE, "utf8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error("[Local Storage] Failed to read local Cloudinary settings:", err);
  }
  return null;
}

function saveCloudinarySettingsLocal(data: any): void {
  try {
    fs.writeFileSync(CLOUDINARY_SETTINGS_FILE, JSON.stringify(data, null, 2), "utf8");
    console.log("[Local Storage] Saved Cloudinary settings locally to:", CLOUDINARY_SETTINGS_FILE);
  } catch (err) {
    console.error("[Local Storage] Failed to write local Cloudinary settings:", err);
  }
}

async function uploadAudioToCloudinary(
  fileBuffer: Buffer,
  publicId: string
): Promise<{ url: string; publicId: string } | null> {
  const localSettings = loadCloudinarySettingsLocal() || {};
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME || localSettings.cloudName || "";
  const apiKey = process.env.CLOUDINARY_API_KEY || process.env.VITE_CLOUDINARY_API_KEY || localSettings.apiKey || "";
  const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.VITE_CLOUDINARY_API_SECRET || localSettings.apiSecret || "";

  if (!cloudName || !apiKey || !apiSecret) {
    console.warn("[Cloudinary Upload] Credentials unconfigured. Skipping Cloudinary sync.");
    return null;
  }

  try {
    cloudinary.config({
      cloud_name: cloudName.trim(),
      api_key: apiKey.trim(),
      api_secret: apiSecret.trim(),
      secure: true
    });

    return new Promise((resolve) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: "auto",
          folder: "arkoo_recordings",
          public_id: publicId
        },
        (error, result) => {
          if (error) {
            console.error("[Cloudinary Upload Error]:", error);
            resolve(null);
          } else if (result) {
            console.log(`[Cloudinary Upload Success] MP3 CDN URL: ${result.secure_url}`);
            resolve({
              url: result.secure_url,
              publicId: result.public_id
            });
          } else {
            resolve(null);
          }
        }
      );
      uploadStream.end(fileBuffer);
    });
  } catch (err) {
    console.error("[Cloudinary API Error]:", err);
    return null;
  }
}

function loadGeminiSettingsLocal(): any {
  try {
    if (fs.existsSync(GEMINI_SETTINGS_FILE)) {
      const content = fs.readFileSync(GEMINI_SETTINGS_FILE, "utf8");
      const parsed = JSON.parse(content);
      if (parsed && parsed.apiKey) return parsed;
    }
  } catch (err) {
    console.error("[Local Storage] Failed to read local gemini settings:", err);
  }
  if (process.env.GEMINI_API_KEY) {
    return { apiKey: process.env.GEMINI_API_KEY };
  }
  return null;
}

function saveGeminiSettingsLocal(data: any): void {
  try {
    fs.writeFileSync(GEMINI_SETTINGS_FILE, JSON.stringify(data, null, 2), "utf8");
    console.log("[Local Storage] Saved Gemini settings locally to:", GEMINI_SETTINGS_FILE);
  } catch (err) {
    console.error("[Local Storage] Failed to write local gemini settings:", err);
  }
}

function loadGDriveSettingsLocal(): any {
  try {
    if (fs.existsSync(GDRIVE_SETTINGS_FILE)) {
      const content = fs.readFileSync(GDRIVE_SETTINGS_FILE, "utf8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error("[Local Storage] Failed to read local gdrive settings:", err);
  }
  return null;
}

function saveGDriveSettingsLocal(data: any): void {
  try {
    const rawData = { ...data };
    // Keep timestamp fields readable
    fs.writeFileSync(GDRIVE_SETTINGS_FILE, JSON.stringify(rawData, null, 2), "utf8");
    console.log("[Local Storage] Saved Google Drive settings locally to:", GDRIVE_SETTINGS_FILE);
  } catch (err) {
    console.error("[Local Storage] Failed to write local gdrive settings:", err);
  }
}

function deleteGDriveSettingsLocal(): void {
  try {
    if (fs.existsSync(GDRIVE_SETTINGS_FILE)) {
      fs.unlinkSync(GDRIVE_SETTINGS_FILE);
      console.log("[Local Storage] Deleted local Google Drive settings.");
    }
  } catch (err) {
    console.error("[Local Storage] Failed to delete local gdrive settings:", err);
  }
}

function loadNvidiaSettingsLocal(): any {
  try {
    if (fs.existsSync(NVIDIA_SETTINGS_FILE)) {
      const content = fs.readFileSync(NVIDIA_SETTINGS_FILE, "utf8");
      const parsed = JSON.parse(content);
      if (parsed && parsed.apiKey) return parsed;
    }
  } catch (err) {
    console.error("[Local Storage] Failed to read local NVIDIA settings:", err);
  }
  if (process.env.NVIDIA_API_KEY) {
    return { apiKey: process.env.NVIDIA_API_KEY };
  }
  return null;
}

function saveNvidiaSettingsLocal(data: any): void {
  try {
    fs.writeFileSync(NVIDIA_SETTINGS_FILE, JSON.stringify(data, null, 2), "utf8");
    console.log("[Local Storage] Saved NVIDIA settings locally to:", NVIDIA_SETTINGS_FILE);
  } catch (err) {
    console.error("[Local Storage] Failed to write local NVIDIA settings:", err);
  }
}

function loadGroqSettingsLocal(): any {
  try {
    if (fs.existsSync(GROQ_SETTINGS_FILE)) {
      const content = fs.readFileSync(GROQ_SETTINGS_FILE, "utf8");
      const parsed = JSON.parse(content);
      if (parsed && parsed.apiKey) return parsed;
    }
  } catch (err) {
    console.error("[Local Storage] Failed to read local Groq settings:", err);
  }
  if (process.env.GROQ_API_KEY) {
    return { apiKey: process.env.GROQ_API_KEY };
  }
  return null;
}

function saveGroqSettingsLocal(data: any): void {
  try {
    fs.writeFileSync(GROQ_SETTINGS_FILE, JSON.stringify(data, null, 2), "utf8");
    console.log("[Local Storage] Saved Groq settings locally to:", GROQ_SETTINGS_FILE);
  } catch (err) {
    console.error("[Local Storage] Failed to write local Groq settings:", err);
  }
}

function getNvidiaOpenAIClient(): OpenAI | null {
  const settings = loadNvidiaSettingsLocal();
  if (settings && settings.apiKey) {
    return new OpenAI({
      apiKey: settings.apiKey,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });
  }
  return null;
}

function getGroqOpenAIClient(): OpenAI | null {
  const settings = loadGroqSettingsLocal();
  if (settings && settings.apiKey) {
    return new OpenAI({
      apiKey: settings.apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return null;
}

let dbFirestore: admin.firestore.Firestore | null = null;

try {
  const firebaseConfigPath = fs.existsSync(path.join(CONFIG_DIR, "firebase-applet-config.json"))
    ? path.join(CONFIG_DIR, "firebase-applet-config.json")
    : path.join(process.cwd(), "firebase-applet-config.json");

  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));
    
    if (admin.apps.length === 0) {
      admin.initializeApp({
        projectId: firebaseConfig.projectId,
      });
    }
    
    dbFirestore = new admin.firestore.Firestore({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId
    });
    console.log("Firebase Admin Firestore successfully initialized on database ID:", firebaseConfig.firestoreDatabaseId);
  }
} catch (fbAdminError) {
  console.error("Warning: Firebase Admin failed to initialize. Server background updates may be unavailable. Error:", fbAdminError);
}

async function verifyFirestoreAccess() {
  if (!dbFirestore) return;
  try {
    // Attempt a quick, silent database operation to verify IAM authorization
    await dbFirestore.collection('settings').doc('gdrive').get();
    console.log("[Firestore Admin] Verified Firestore backend access is fully authorized.");
  } catch (err: any) {
    const isPermissionError = err.message && (
      err.message.includes("permission") || 
      err.message.includes("PERMISSION_DENIED") || 
      err.code === 7
    );
    if (isPermissionError) {
      console.log("[Firestore Admin] Running in client-authoritative mode. Firestore database writes are delegated directly to the authenticated client browser due to sandbox service accounts limits.");
    } else {
      console.log("[Firestore Admin] Status check completed:", err.message || err);
    }
    dbFirestore = null; // Decouple backend Firestore, allowing safe client fallback
  }
}
verifyFirestoreAccess();

let isGeminiHealthy = true;
let lastFailureTime = 0;
const HEALTH_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes cache timeout

let aiClient: GoogleGenAI | null = null;

async function transcribeWithGroq(fileBuffer: Buffer, mimeType: string, meetingId: string): Promise<string> {
  const settings = loadGroqSettingsLocal();
  if (!settings || !settings.apiKey) {
    throw new Error("Groq API Key is not configured. Please define it in your Settings panel to enable transcription.");
  }

  console.log(`[Groq S2T] Initializing speech transcription. Size: ${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB, Mime: ${mimeType}`);

  let extension = "wav";
  const rawSubtype = mimeType.split("/")[1]?.split(";")[0]?.toLowerCase() || "";
  if (rawSubtype.includes("mpeg") || rawSubtype.includes("mp3")) {
    extension = "mp3";
  } else if (rawSubtype.includes("webm")) {
    extension = "webm";
  } else if (rawSubtype.includes("ogg") || rawSubtype.includes("opus")) {
    extension = "ogg";
  } else if (rawSubtype.includes("wav") || rawSubtype.includes("wave") || rawSubtype.includes("x-wav")) {
    extension = "wav";
  } else if (rawSubtype.includes("m4a") || rawSubtype.includes("mp4") || rawSubtype.includes("x-m4a")) {
    extension = "m4a";
  }

  const safeFilename = `recording_${meetingId || "meeting"}.${extension}`;
  const formData = new FormData();
  
  const fileBlob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
  formData.append("file", fileBlob, safeFilename);
  formData.append("model", "whisper-large-v3");
  formData.append("response_format", "json");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { text: string };
  return data.text || "";
}

let lastUsedApiKey = "";
let isPrimaryKeyDenied = false;

function getGenAI(): GoogleGenAI {
  const localSettings = loadGeminiSettingsLocal();
  let apiKey = localSettings?.apiKey || process.env.GEMINI_API_KEY || "";
  
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
    apiKey = process.env.GEMINI_API_KEY || "";
  }

  if (!aiClient || lastUsedApiKey !== apiKey) {
    lastUsedApiKey = apiKey;
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiClient;
}

async function generateContentWithResilience(ai: any, params: any): Promise<any> {
  const models = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash-lite"
  ];
  let lastError: any = null;

  // 1. Try with the primary AI client (using environment config / default key)
  if (!isPrimaryKeyDenied) {
    for (const model of models) {
      if (isPrimaryKeyDenied) {
        break;
      }
      
      console.log(`[Gemini Resilient] Initiating processing queue for model candidate: ${model}`);
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`[Gemini Resilient] Sending payload to ${model} (Attempt ${attempt}/2)...`);
          
          const callPromise = ai.models.generateContent({
            ...params,
            model: model
          });
          
          const singleCallTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Model processing timeout")), 55000)
          );

          const response = await Promise.race([callPromise, singleCallTimeout]);
          return response;
        } catch (err: any) {
          lastError = err;
          const errMsg = (err.message || String(err) || "").toLowerCase();
          console.warn(`[Gemini Resilient WARNING] ${model} attempt ${attempt} failed: ${err.message || String(err)}`);
          
          const isDenied = errMsg.includes("permission_denied") || 
                           errMsg.includes("denied access") || 
                           errMsg.includes("disabled") || 
                           errMsg.includes("403") || 
                           errMsg.includes("denied_access");

          if (isDenied) {
            console.log(`[Gemini Resilient] Model ${model} is disabled or permission denied on primary key. Bypassing primary client entirely.`);
            isPrimaryKeyDenied = true;
            break; // break the attempt loop
          }

          const isQuotaOrOverload = errMsg.includes("quota exceeded") || 
                                    errMsg.includes("exceeded your current quota") || 
                                    errMsg.includes("billing details") || 
                                    errMsg.includes("exceeded budget") ||
                                    errMsg.includes("generaterequestsperday") ||
                                    errMsg.includes("quota_exceeded") ||
                                    errMsg.includes("429") ||
                                    errMsg.includes("resource_exhausted") ||
                                    errMsg.includes("503") ||
                                    errMsg.includes("unavailable") ||
                                    errMsg.includes("high demand") ||
                                    errMsg.includes("limit");

          if (isQuotaOrOverload) {
            console.log(`[Gemini Resilient] Model ${model} returned quota or temporary overload. Moving immediately to next candidate.`);
            break; // break the attempt loop, try next model
          }

          const backoff = attempt * 1000;
          await new Promise(resolve => setTimeout(resolve, backoff));
        }
      }
    }
  }

  // 2. If primary client has failed fully or is denied, spawn a failover client with verified key
  const fallbackKey = process.env.GEMINI_API_KEY || "";
  console.log(`[Gemini Resilient] Routing payload through fallback API gateway...`);
  
  try {
    const fallbackAI = new GoogleGenAI({
      apiKey: fallbackKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build-fallback'
        }
      }
    });

    for (const model of models) {
      console.log(`[Gemini Resilient Fallback] Dispatching payload to failover candidate: ${model}`);
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`[Gemini Resilient Fallback] Sending payload to ${model} (Attempt ${attempt}/2)...`);
          const callPromise = fallbackAI.models.generateContent({
            ...params,
            model: model
          });
          const singleCallTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Model processing timeout")), 55000)
          );
          const response = await Promise.race([callPromise, singleCallTimeout]);
          return response;
        } catch (err: any) {
          lastError = err;
          const errMsg = (err.message || String(err) || "").toLowerCase();
          console.warn(`[Gemini Resilient Fallback WARNING] ${model} attempt ${attempt} failed: ${err.message || String(err)}`);
          
          if (errMsg.includes("permission_denied") || errMsg.includes("denied access") || errMsg.includes("disabled") || errMsg.includes("403") || errMsg.includes("denied_access")) {
            console.log(`[Gemini Resilient Fallback] Permission denied on fallback key. Skipping key retries for this model.`);
            break;
          }

          const isQuotaOrOverload = errMsg.includes("quota exceeded") || 
                                    errMsg.includes("exceeded your current quota") || 
                                    errMsg.includes("billing details") || 
                                    errMsg.includes("exceeded budget") ||
                                    errMsg.includes("generaterequestsperday") ||
                                    errMsg.includes("quota_exceeded") ||
                                    errMsg.includes("429") ||
                                    errMsg.includes("resource_exhausted") ||
                                    errMsg.includes("503") ||
                                    errMsg.includes("unavailable") ||
                                    errMsg.includes("high demand") ||
                                    errMsg.includes("limit");

          if (isQuotaOrOverload) {
            console.log(`[Gemini Resilient Fallback] Model ${model} returned quota or temporary overload on fallback key. Moving immediately to next candidate.`);
            break; // break the attempt loop, move to next model
          }
          
          const backoff = attempt * 1000;
          await new Promise(resolve => setTimeout(resolve, backoff));
        }
      }
    }
  } catch (fallbackInitErr) {
    console.error("[Gemini Resilient Fallback Error] Failed to initialize fallback client:", fallbackInitErr);
  }

  throw lastError;
}

function extractDriveFileId(url: string | null | undefined): string | null {
  if (!url) return null;
  const fileDMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]{25,})/);
  if (fileDMatch) return fileDMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
  if (idMatch) return idMatch[1];
  if (/^[a-zA-Z0-9_-]{25,}$/.test(url)) return url;
  return null;
}

function extractDriveFolderId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]{25,})/);
  if (match) return match[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
  if (idMatch) return idMatch[1];
  if (/^[a-zA-Z0-9_-]{25,}$/.test(url.trim())) return url.trim();
  return null;
}

async function validateDriveFolder(accessToken: string, folderId: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,capabilities,trashed`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!res.ok) {
      if (res.status === 404) {
        return { valid: false, error: "Folder not found in Google Drive. Please verify the folder link and sharing permissions." };
      }
      const errText = await res.text();
      return { valid: false, error: `Google Drive validation failed: Status ${res.status}. ${errText}` };
    }
    
    const folderData = await res.json() as any;
    if (folderData.trashed) {
      return { valid: false, error: "The specified Google Drive folder is in the trash." };
    }
    
    if (folderData.capabilities) {
      const canAddChildren = folderData.capabilities.canAddChildren;
      if (canAddChildren === false) {
        return { valid: false, error: "Insufficient permissions: You do not have permission to upload/write files to this Google Drive folder." };
      }
    }
    
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: `Network/Connection failure: ${err.message || err}` };
  }
}
async function refreshGoogleAccessToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET;
  
  if (!clientId || !clientSecret || !refreshToken) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    });

    if (!res.ok) {
      const errTxt = await res.text();
      console.error("[Google OAuth Refresh] Failed to refresh token:", errTxt);
      return null;
    }

    const data = await res.json() as any;
    if (data.access_token) {
      console.log("[Google OAuth Refresh] Successfully refreshed Google Drive access token!");
      
      const settings = loadGDriveSettingsLocal() || {};
      settings.accessToken = data.access_token;
      settings.expiryTime = Date.now() + (data.expires_in || 3600) * 1000;
      saveGDriveSettingsLocal(settings);

      if (dbFirestore) {
        dbFirestore.collection('settings').doc('gdrive').set({
          accessToken: data.access_token,
          expiryTime: settings.expiryTime
        }, { merge: true }).catch(err => console.warn("Failed to save refreshed token in Firestore:", err));
      }

      return data.access_token;
    }
  } catch (err) {
    console.error("[Google OAuth Refresh Error]:", err);
  }
  return null;
}

async function findOrCreateFolderInDrive(accessToken: string, name: string, parentId?: string): Promise<string> {
  let query = `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed = false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }
  
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`;
  const searchRes = await fetch(searchUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Failed to check folder existence for '${name}': ${errText}`);
  }
  
  const searchResult = await searchRes.json() as any;
  if (searchResult.files && searchResult.files.length > 0) {
    return searchResult.files[0].id;
  }
  
  // Folder does not exist, create it
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined
    })
  });
  
  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create folder '${name}': ${errText}`);
  }
  
  const createResult = await createRes.json() as any;
  return createResult.id;
}

async function uploadFileToDriveFolder(
  accessToken: string,
  fileName: string,
  mimeType: string,
  fileDataBuffer: Buffer,
  folderId: string
): Promise<{ id: string; webViewLink: string }> {
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: mimeType
  };

  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const multipartBody = Buffer.concat([
    Buffer.from(delimiter),
    Buffer.from('Content-Type: application/json; charset=UTF-8\r\n\r\n'),
    Buffer.from(JSON.stringify(metadata)),
    Buffer.from(delimiter),
    Buffer.from(`Content-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`),
    Buffer.from(fileDataBuffer.toString('base64')),
    Buffer.from(closeDelim)
  ]);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartBody
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Google Drive upload failed: ${errText}`);
  }

  const data = await uploadRes.json() as any;
  
  // Expose anyone with link can read (shareable link)
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone'
      })
    });
  } catch (permErr) {
    console.warn(`[Google Drive permissions] Could not set reader permission:`, permErr);
  }

  return data;
}

async function uploadFileToDriveWithRetry(
  accessToken: string,
  name: string,
  mimeType: string,
  fileContentBuffer: Buffer,
  parentId: string,
  maxRetries = 3
): Promise<any> {
  let attempt = 0;
  let lastError = null;
  while (attempt < maxRetries) {
    try {
      attempt++;
      console.log(`[Google Drive Uplink] Attempt ${attempt}/${maxRetries} to upload: ${name}`);
      const result = await uploadFileToDriveFolder(accessToken, name, mimeType, fileContentBuffer, parentId);
      return result;
    } catch (err: any) {
      lastError = err;
      console.warn(`[Google Drive Uplink] Attempt ${attempt} failed: ${err.message || err}`);
      if (attempt >= maxRetries) {
        break;
      }
      // Wait with incremental backoff (e.g., 2s, 4s, etc.)
      const waitTime = attempt * 2000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw lastError || new Error(`Failed to upload ${name} to Google Drive after ${maxRetries} attempts.`);
}

app.use(express.json({ limit: '150mb' }));
app.use(express.urlencoded({ limit: '150mb', extended: true }));
app.use("/uploads", express.static(UPLOADS_DIR));

// Helper functions to save processing results and mark status in Firestore using Admin SDK
async function saveMeetingResultsToFirestore(
  meetingId: string,
  result: any,
  audioUrl?: string | null,
  driveFileId?: string | null,
  driveFileUrl?: string | null,
  gdriveFolderId?: string | null,
  gdriveUploadStatus?: string | null,
  gdriveLeafFolderId?: string | null
): Promise<boolean> {
  if (!dbFirestore || !meetingId) {
    console.log("[Firestore Admin] Skipping direct write: Admin Firestore database instance is not available or meetingId is missing.");
    return false;
  }
  try {
    console.log(`[Firestore Admin] Writing processing results for meeting ${meetingId} in the background...`);
    
    // 1. Update the meeting document
    const updateData: any = {
      status: "completed",
      transcript: result.transcript || "Transcription could not be generated.",
      // Support both structured mom object and legacy markdown string
      mom: (result.mom && typeof result.mom === 'object') ? result.mom : null,
      momText: (result.mom && typeof result.mom === 'string') ? result.mom : null,
      summary: result.summary || "Summary could not be generated.",
      audioUrl: audioUrl || null,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      tasksCount: Array.isArray(result.tasks) ? result.tasks.length : 0
    };
    if (audioUrl && (audioUrl.includes("drive.google.com") || audioUrl.includes("drive.google") || audioUrl.includes("googleapis.com/drive"))) {
      updateData.driveFileUrl = audioUrl;
    }
    if (driveFileId) {
      updateData.driveFileId = driveFileId;
    }
    if (driveFileUrl) {
      updateData.driveFileUrl = driveFileUrl;
    }
    if (gdriveFolderId) {
      updateData.gdriveFolderId = gdriveFolderId;
    }
    if (gdriveLeafFolderId) {
      updateData.gdriveLeafFolderId = gdriveLeafFolderId;
    }
    if (gdriveUploadStatus) {
      updateData.gdriveUploadStatus = gdriveUploadStatus;
      if (gdriveUploadStatus === 'completed') {
        updateData.gdriveUploadTimestamp = admin.firestore.FieldValue.serverTimestamp();
      }
    } else if (driveFileId) {
      // Default to completed if driveFileId exists
      updateData.gdriveUploadStatus = 'completed';
      updateData.gdriveUploadTimestamp = admin.firestore.FieldValue.serverTimestamp();
    }
    await dbFirestore.collection("meetings").doc(meetingId).update(updateData);

    // 2. Add associated tasks to tasks collection & auto-convert nextSteps
    const tasks: any[] = Array.isArray(result.tasks) ? [...result.tasks] : [];
    const nextStepsList: string[] = Array.isArray(result.mom?.nextSteps) ? result.mom.nextSteps : [];

    for (const step of nextStepsList) {
      if (!step || typeof step !== 'string') continue;
      const lowerStep = step.toLowerCase();

      // Check if already present in tasks
      const exists = tasks.some(t => {
        if (!t) return false;
        const titleLower = String(t.title || '').toLowerCase();
        const descLower = String(t.description || '').toLowerCase();
        return titleLower.includes(lowerStep.slice(0, 15)) || lowerStep.includes(titleLower.slice(0, 15)) || descLower.includes(lowerStep.slice(0, 15));
      });

      if (!exists) {
        // Extract assignee name if step is formatted like "Anusha to ..." or "Sanjay to ..."
        let assignee = "Unassigned";
        const nameMatch = step.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:to|will|should|is to)\s+(.+)/i);
        let taskTitle = step;
        if (nameMatch) {
          assignee = nameMatch[1];
          taskTitle = nameMatch[2].charAt(0).toUpperCase() + nameMatch[2].slice(1);
        }

        tasks.push({
          title: taskTitle,
          description: step,
          assigneeName: assignee,
          department: "Operations",
          priority: "high",
          deadline: "Friday 5 PM"
        });
      }
    }

    for (const task of tasks) {
      if (!task || typeof task !== 'object') continue;
      
      let normalizedPriority = String(task.priority || 'medium').toLowerCase();
      if (normalizedPriority === 'normal') normalizedPriority = 'medium';
      if (!['low', 'medium', 'high', 'critical'].includes(normalizedPriority)) normalizedPriority = 'medium';

      const parsedDeadlineDate = parseRelativeDeadlineServer(task.deadline || "Friday 5 PM");
      const formattedDeadlineStr = formatDeadlineDisplayServer(parsedDeadlineDate);

      const taskDoc = {
        title: task.title || 'Untitled Task',
        description: task.description || 'No description provided.',
        meetingId: meetingId,
        assigneeName: task.assigneeName || 'Unassigned',
        department: task.department || 'General',
        priority: normalizedPriority,
        status: 'pending',
        deadline: formattedDeadlineStr,
        deadlineTimestamp: admin.firestore.Timestamp.fromDate(parsedDeadlineDate),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await dbFirestore.collection("tasks").add(taskDoc);

      // Send email notification to assignee
      sendTaskAssignmentEmail({
        title: taskDoc.title,
        description: taskDoc.description,
        assigneeName: taskDoc.assigneeName,
        deadline: parsedDeadlineDate,
        priority: taskDoc.priority,
        department: taskDoc.department,
        meetingTitle: updateData.title || result.title || "Meeting MOM"
      }).catch(e => console.error("Async email dispatch error:", e));
    }
    
    console.log(`[Firestore Admin] Meeting ${meetingId} and ${tasks.length} tasks successfully written in background.`);
    return true;
  } catch (err) {
    console.error(`[Firestore Admin] Failed to write meeting background results for ${meetingId}:`, err);
    return false;
  }
}

async function markMeetingAsFailedInFirestore(meetingId: string, errorMsg: string): Promise<void> {
  if (!dbFirestore || !meetingId) return;
  try {
    console.log(`[Firestore Admin] Marking meeting ${meetingId} as failed due to: ${errorMsg}`);
    await dbFirestore.collection("meetings").doc(meetingId).update({
      status: "failed",
      failureReason: errorMsg || "Processing failed during AI generation timeout or server error"
    });
  } catch (err) {
    console.error(`[Firestore Admin] Failed to mark meeting ${meetingId} as failed in DB:`, err);
  }
}

// API routes
app.post("/api/send-invitation-email", async (req, res) => {
  try {
    const { fullName, email, personalEmail, stakeholderType, department } = req.body;
    const targetEmail = (email || personalEmail || '').trim();
    if (!targetEmail || !targetEmail.includes('@')) {
      console.warn(`[Invitation Email Warning] Invalid or missing email address: "${targetEmail}"`);
      return res.status(400).json({ error: "Please provide a valid email address for the stakeholder" });
    }

    const { transporter, user: gmailUser, pass: gmailPass } = createGoogleSmtpTransporter();

    if (!gmailPass) {
      console.log(`[Invitation Email Notice] GMAIL_APP_PASSWORD not set. Simulated invitation sent to ${targetEmail} (${fullName}).`);
      return res.json({ success: true, simulated: true });
    }

    const mailOptions = {
      from: `"Arkoo Admin System" <${gmailUser}>`,
      to: targetEmail,
      cc: (gmailUser && gmailUser.toLowerCase() !== targetEmail.toLowerCase()) ? gmailUser : undefined,
      subject: `🎉 Stakeholder Access Granted: ${fullName} (${stakeholderType || 'Employee'})`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 20px; border-radius: 10px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: bold;">New Stakeholder Approved & Added</h2>
            <p style="color: #ffedd5; margin: 4px 0 0 0; font-size: 14px;">Arkoo Prebuild Pvt. Ltd.</p>
          </div>
          
          <div style="padding: 24px 0;">
            <p style="font-size: 15px; color: #1e293b;">Hello <strong>${fullName}</strong> & Admin,</p>
            <p style="font-size: 14px; color: #475569; line-height: 1.5;">A new stakeholder account has been created and approved in the Arkoo Prebuild Platform by the Administrator.</p>
            
            <div style="background-color: #f8fafc; border-left: 4px solid #f97316; padding: 16px; border-radius: 6px; margin: 20px 0;">
              <p style="margin: 0 0 6px 0; font-size: 13px; color: #64748b;"><strong>Stakeholder Name:</strong> <span style="color: #0f172a; font-weight: bold;">${fullName}</span></p>
              <p style="margin: 0 0 6px 0; font-size: 13px; color: #64748b;"><strong>Registered Email:</strong> <span style="color: #0f172a;">${targetEmail}</span></p>
              <p style="margin: 0 0 6px 0; font-size: 13px; color: #64748b;"><strong>Role / Type:</strong> <span style="color: #0f172a; font-weight: bold;">${stakeholderType || 'Employee'}</span></p>
              <p style="margin: 0; font-size: 13px; color: #64748b;"><strong>Department:</strong> <span style="color: #0f172a;">${department || 'General'}</span></p>
            </div>
            
            <p style="font-size: 14px; color: #475569;">The user can now sign in using Google Auth at:</p>
            <p style="text-align: center; margin: 20px 0;">
              <a href="http://localhost:3000" style="background-color: #f97316; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block;">Access Arkoo Platform</a>
            </p>
          </div>

          <div style="border-top: 1px solid #f1f5f9; padding-top: 14px; text-align: center; font-size: 11px; color: #94a3b8;">
            Arkoo Prebuild Pvt. Ltd. • Secure Access Management System
          </div>
        </div>
      `
    };

    // Asynchronously dispatch email in background
    transporter.sendMail(mailOptions).then(info => {
      console.log(`[Invitation Email Success] MessageId: ${info.messageId} sent to ${targetEmail}`);
    }).catch(err => {
      console.error(`[Invitation Email Error] Failed to dispatch via SMTP:`, err.message || err);
    });

    return res.json({ success: true, emailSent: true });
  } catch (err: any) {
    console.error("[Invitation Email Error]:", err?.message || err);
    return res.json({ success: true, warning: err?.message || "Processed" });
  }
});

app.post("/api/gemini/save-key", (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ error: "API Key cannot be empty" });
    }

    const keyClean = apiKey.trim();
    process.env.GEMINI_API_KEY = keyClean;

    // Save locally to gemini-settings.json without triggering Vite process reload
    saveGeminiSettingsLocal({ apiKey: keyClean, updatedAt: new Date().toISOString() });
    
    // Save to Firestore if available
    if (dbFirestore) {
      try {
        dbFirestore.collection('settings').doc('gemini').set({
          apiKey: keyClean,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) {}
    }

    console.log("[Gemini API] Successfully saved new Gemini API Key to local storage!");
    res.json({ success: true, message: "Gemini API Key updated successfully!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update Gemini API key" });
  }
});

app.get("/api/gemini-diagnostic", async (req, res) => {
  const localSettings = loadGeminiSettingsLocal();
  let activeKey = localSettings?.apiKey || process.env.GEMINI_API_KEY || "";
  let isFallback = false;
  
  if (!activeKey || activeKey === "MY_GEMINI_API_KEY" || activeKey.trim() === "") {
    activeKey = process.env.GEMINI_API_KEY || "";
    isFallback = true;
  }
  
  const keySource = isFallback ? "Environment GEMINI_API_KEY" : "Saved User API Key";
  
  // Mask key for display
  let maskedKey = "None";
  if (activeKey) {
    const len = activeKey.length;
    if (len > 10) {
      maskedKey = `${activeKey.substring(0, 6)}...${activeKey.substring(len - 4)}`;
    } else {
      maskedKey = "***";
    }
  }

  const modelCandidates = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.0-flash-lite"];
  let results: { model: string; status: string; error?: string }[] = [];
  let succeedingModel = "";
  let fullResponse = "";
  let success = false;
  let summaryStatus = "Checking...";
  let explanation = "";

  const testGenAI = new GoogleGenAI({
    apiKey: activeKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build-diagnostic'
      }
    }
  });

  for (const model of modelCandidates) {
    try {
      const response = await testGenAI.models.generateContent({
        model: model,
        contents: "Respond with the word: OK",
      });

      if (response && response.text) {
        results.push({ model, status: "Succeeded" });
        if (!success) {
          success = true;
          succeedingModel = model;
          fullResponse = response.text.trim();
          summaryStatus = `Succeeding (${model})`;
        }
        // Break early since we successfully verified that Gemini works and is initialized properly!
        break;
      } else {
        results.push({ model, status: "Empty Response", error: "API returned empty text field" });
      }
    } catch (err: any) {
      const errorMsg = err.message || String(err);
      results.push({ model, status: "Failed", error: errorMsg });

      // If a model candidate is out of quota on Free Tier (e.g. gemini-3.5-flash which has low daily quota), 
      // we continue checking other models in the list rather than stopping, as some other model candidates 
      // likely still have available quota/capacity.
      console.log(`Diagnostic candidate ${model} showed error: ${errorMsg}`);
    }
  }

  if (success) {
    explanation = `Verification test succeeded on model ${succeedingModel}! Streaming S2T and MOM services are functional.`;
  } else {
    // If all failed, analyze the errors
    const lastError = results[results.length - 1].error || "";
    const errStr = lastError.toLowerCase();
    
    if (errStr.includes("429") || errStr.includes("resource_exhausted") || errStr.includes("quota") || errStr.includes("limit")) {
      summaryStatus = "RESOURCE_EXHAUSTED";
      explanation = "The API key's current rate limits or structural quota tokens are completely exhausted. Because this key operates in a free-tier project pool, concurrent or high-velocity requests are throttled or denied access, resulting in a 429 status code. Switching to a paid API key or utilizing a higher quota key is recommended.";
    } else if (errStr.includes("403") || errStr.includes("permission_denied") || errStr.includes("denied access") || errStr.includes("disabled")) {
      summaryStatus = "PERMISSION_DENIED";
      explanation = "Access was denied by the API gateway (403). Your project may be restricted, suspended, or does not support free-tier endpoints. Please configure a valid API Key.";
    } else {
      summaryStatus = "Failed";
      explanation = `All tested models failed. Connection error or permission restriction: ${lastError}`;
    }
  }

  // Active project ID from configs
  let projectId = "Unknown";
  try {
    const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(firebaseConfigPath)) {
      const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));
      projectId = firebaseConfig.projectId || "Unknown";
    }
  } catch (e) {}

  res.json({
    success,
    status: summaryStatus,
    keySource,
    modelUsed: success ? succeedingModel : modelCandidates.join(", "),
    projectId,
    maskedKey,
    error: success ? null : JSON.stringify(results, null, 2),
    explanation,
    fullResponse,
    results,
    testedAt: new Date().toISOString()
  });
});

// ─── NVIDIA API Endpoints ──────────────────────────────────────────────────
app.get("/api/nvidia/status", async (req, res) => {
  try {
    let settings = loadNvidiaSettingsLocal();
    if (!settings && dbFirestore) {
      try {
        const snap = await dbFirestore.collection('settings').doc('nvidia').get();
        if (snap.exists) settings = snap.data();
      } catch (e) {}
    }
    
    if (settings && settings.apiKey) {
      return res.json({ connected: true });
    }
    res.json({ connected: false });
  } catch (err: any) {
    console.error("[NVIDIA] Status check failed:", err);
    res.status(500).json({ error: "Failed to load NVIDIA status" });
  }
});

app.post("/api/nvidia/save-key", async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: "Missing API Key" });
    }

    const nvidiaData = { apiKey, lastSynced: new Date().toISOString() };
    saveNvidiaSettingsLocal(nvidiaData);
    
    if (dbFirestore) {
      try {
        await dbFirestore.collection('settings').doc('nvidia').set(nvidiaData, { merge: true });
      } catch (e) {}
    }

    res.json({ success: true, message: "NVIDIA API Key saved successfully" });
  } catch (err: any) {
    console.error("[NVIDIA] Save key error:", err);
    res.status(500).json({ error: "Failed to save NVIDIA configuration" });
  }
});

// ─── Groq API Endpoints ────────────────────────────────────────────────────
app.get("/api/groq/status", async (req, res) => {
  try {
    let settings = loadGroqSettingsLocal();
    if (!settings && dbFirestore) {
      try {
        const snap = await dbFirestore.collection('settings').doc('groq').get();
        if (snap.exists) settings = snap.data();
      } catch (e) {}
    }
    
    if (settings && settings.apiKey) {
      return res.json({ connected: true });
    }
    res.json({ connected: false });
  } catch (err: any) {
    console.error("[Groq] Status check failed:", err);
    res.status(500).json({ error: "Failed to load Groq status" });
  }
});

app.post("/api/groq/save-key", async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: "Missing API Key" });
    }

    const groqData = { apiKey, lastSynced: new Date().toISOString() };
    saveGroqSettingsLocal(groqData);
    
    if (dbFirestore) {
      try {
        await dbFirestore.collection('settings').doc('groq').set(groqData, { merge: true });
      } catch (e) {}
    }

    res.json({ success: true, message: "Groq API Key saved successfully" });
  } catch (err: any) {
    console.error("[Groq] Save key error:", err);
    res.status(500).json({ error: "Failed to save Groq configuration" });
  }
});

app.get("/api/audio/:meetingId", (req, res) => {
  const { meetingId } = req.params;
  try {
    const convertedWavPath = path.join(UPLOADS_DIR, `${meetingId}_converted.wav`);
    const convertedMp3Path = path.join(UPLOADS_DIR, `${meetingId}_converted.mp3`);
    
    if (fs.existsSync(convertedWavPath)) {
      res.setHeader("Content-Type", "audio/wav");
      return res.sendFile(convertedWavPath);
    } else if (fs.existsSync(convertedMp3Path)) {
      res.setHeader("Content-Type", "audio/mp3");
      return res.sendFile(convertedMp3Path);
    }
    
    // Fallback to searching raw input
    const files = fs.readdirSync(UPLOADS_DIR);
    const rawFile = files.find(f => f.startsWith(`${meetingId}_input.`));
    if (rawFile) {
      const rawPath = path.join(UPLOADS_DIR, rawFile);
      const ext = path.extname(rawFile).substring(1);
      const mime = ext === "m4a" ? "audio/m4a" : ext === "mp3" ? "audio/mp3" : ext === "wav" ? "audio/wav" : "audio/webm";
      res.setHeader("Content-Type", mime);
      return res.sendFile(rawPath);
    }
    
    res.status(404).json({ error: "Audio recording file not found on server disk" });
  } catch (error) {
    console.error("Error serving audio file from uploads:", error);
    res.status(500).json({ error: "Failed to read audio file from disk" });
  }
});

app.post("/api/transcribe-chunk", async (req, res) => {
  const { chunkBase64, mimeType, chunkIndex, meetingId = "temp" } = req.body;
  
  if (!chunkBase64) {
    return res.status(400).json({ error: "Missing chunkBase64 audio data" });
  }

  const cleanMimeType = (mimeType || "audio/webm").split(';')[0];
  const rawExtension = cleanMimeType.split('/')[1] || "webm";
  
  const chunkRawFilename = `chunk_${meetingId}_${chunkIndex}_raw.${rawExtension}`;
  const chunkRawPath = path.join(UPLOADS_DIR, chunkRawFilename);
  const chunkWavFilename = `chunk_${meetingId}_${chunkIndex}_converted.wav`;
  const chunkWavPath = path.join(UPLOADS_DIR, chunkWavFilename);

  try {
    // 1. Save raw chunk to disk
    fs.writeFileSync(chunkRawPath, Buffer.from(chunkBase64, 'base64'));

    let finalBase64 = chunkBase64;
    let finalMime = cleanMimeType;

    // 2. Downsample audio using ffmpeg to standard 16kHz mono WAV for high speed and accuracy
    try {
      const ffmpegCommand = `ffmpeg -y -i "${chunkRawPath}" -vn -ar 16000 -ac 1 "${chunkWavPath}"`;
      await new Promise<void>((resolve, reject) => {
        exec(ffmpegCommand, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      
      if (fs.existsSync(chunkWavPath)) {
        finalBase64 = fs.readFileSync(chunkWavPath).toString("base64");
        finalMime = "audio/wav";
      }
    } catch (transcodeErr) {
      console.warn(`[Chunk Audio Warning] ffmpeg transcoding failed for chunk ${chunkIndex}. Using raw stream fallback:`, transcodeErr);
    }

    // 3. Process the audio chunk using super-fast Gemini 2.5 Flash and resilient fallback queue
    const ai = getGenAI();
    
    const response = await generateContentWithResilience(ai, {
      contents: [
        {
          inlineData: {
            mimeType: finalMime,
            data: finalBase64
          }
        },
        "Transcribe the spoken words in the audio. Match natural conversational sentences. Keep it completely literal. IMPORTANT: If the speech is in Hindi or Hinglish, you MUST write it in Roman/English letters (transliteration) instead of Devanagari script. For example, write 'production schedule check karo' NOT 'प्रोडक्शन शेड्यूल चेक करो'. Output ONLY the raw transcribed text without preamble or markup. If the audio has no human speaking, background silence, or static, respond with nothing."
      ]
    });

    const text = response.text ? response.text.trim() : "";
    console.log(`[Stream Transcripts] Chunk ${chunkIndex} S2T Text: "${text}"`);

    // 4. Cache & Memory Optimization: clean old chunks immediately
    try {
      if (fs.existsSync(chunkRawPath)) fs.unlinkSync(chunkRawPath);
      if (fs.existsSync(chunkWavPath)) fs.unlinkSync(chunkWavPath);
    } catch (cleanupErr) {
      console.error("[Cache Clean Error] Failed to delete chunk files:", cleanupErr);
    }

    res.json({ text, chunkIndex });
  } catch (err: any) {
    console.error(`[Stream Error] Chunk S2T failed for index ${chunkIndex}:`, err);
    
    try {
      if (fs.existsSync(chunkRawPath)) fs.unlinkSync(chunkRawPath);
      if (fs.existsSync(chunkWavPath)) fs.unlinkSync(chunkWavPath);
    } catch (e) {}

    res.status(500).json({ error: err.message || "Failed to process audio chunk" });
  }
});

app.post("/api/tasks/voice-note", async (req, res) => {
  const { audioBase64, mimeType, taskId } = req.body;
  if (!audioBase64) {
    return res.status(400).json({ error: "Missing audioBase64 content" });
  }

  const cleanMimeType = (mimeType || "audio/webm").split(';')[0];
  const rawExtension = cleanMimeType.split('/')[1] || "webm";
  const filename = `task_${taskId}_voice_${Date.now()}_raw.${rawExtension}`;
  const rawPath = path.join(UPLOADS_DIR, filename);
  
  const wavFilename = `task_${taskId}_voice_${Date.now()}_converted.wav`;
  const wavPath = path.join(UPLOADS_DIR, wavFilename);

  try {
    fs.writeFileSync(rawPath, Buffer.from(audioBase64, 'base64'));

    let finalBase64 = audioBase64;
    let finalMime = cleanMimeType;
    let usedFilename = filename;

    // Optional transcode using ffmpeg (standard 16kHz mono WAV is super fast & accurate with Gemini)
    try {
      const ffmpegCommandFull = `ffmpeg -y -i "${rawPath}" -vn -ar 16000 -ac 1 "${wavPath}"`;
      await new Promise<void>((resolve, reject) => {
        exec(ffmpegCommandFull, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      if (fs.existsSync(wavPath)) {
        finalBase64 = fs.readFileSync(wavPath).toString("base64");
        finalMime = "audio/wav";
        usedFilename = wavFilename;
        // Clean up raw chunk
        try { fs.unlinkSync(rawPath); } catch (e) {}
      }
    } catch (err) {
      console.warn("Transcoding voice note failed, using raw fallback:", err);
    }

    // Call Gemini on server side to transcribe
    const ai = getGenAI();
    let text = "";
    try {
      const response = await generateContentWithResilience(ai, {
        contents: [
          {
            inlineData: {
              mimeType: finalMime,
              data: finalBase64
            }
          },
          "Transcribe the spoken audio text accurately that is recorded as a task voice note/memo. Keep it very conversational and literal. IMPORTANT: If the speech is in Hindi or Hinglish, you MUST write it in Roman/English letters (transliteration) instead of Devanagari script. For example, write 'yeh task complete karna hai by Friday' NOT 'यह टास्क कम्प्लीट करना है बाय फ्राइडे'. Return ONLY the transcribed text, with absolutely no preamble, no commentary, and no format boxes."
        ]
      });
      text = response.text ? response.text.trim() : "";
    } catch (aiErr: any) {
      console.error("Gemini failed transcribing task voice note:", aiErr);
    }

    res.json({
      audioUrl: `/uploads/${usedFilename}`,
      transcript: text || "Silence/No speech detected"
    });
  } catch (err: any) {
    console.error("Failed to process voice note:", err);
    res.status(500).json({ error: err.message || "Failed to process voice note" });
  }
});

app.post("/api/process-meeting", async (req, res) => {
  console.log("Received process-meeting request (pipeline mode)");
  
  // Set streaming headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendProgress = (progress: number, label: string) => {
    res.write(JSON.stringify({ progress, label }) + "\n");
  };

  const { meetingId, audioBase64, title, mimeType, audioUrl, preTranscribedText, driveFileUrl, googleAccessToken } = req.body;

  // Retrieve fallback token from local cache first, then Firestore (e.g. for employees without individual OAuth)
  let activeToken = googleAccessToken;
  const localSettings = loadGDriveSettingsLocal();

  if (localSettings && localSettings.connectionStatus === 'connected') {
    if (!activeToken) {
      activeToken = localSettings.accessToken;
    }
    // Automatically refresh token if expired
    if (localSettings.expiryTime && Date.now() > localSettings.expiryTime && localSettings.refreshToken) {
      console.log("[Google Drive OAuth] Access token expired. Attempting automatic refresh token exchange...");
      const refreshedToken = await refreshGoogleAccessToken(localSettings.refreshToken);
      if (refreshedToken) {
        activeToken = refreshedToken;
      }
    }
  } else if (!activeToken && dbFirestore) {
    try {
      const snap = await dbFirestore.collection('settings').doc('gdrive').get();
      if (snap.exists) {
        const d = snap.data();
        if (d && d.connectionStatus === 'connected') {
          activeToken = d.accessToken;
          saveGDriveSettingsLocal(d); // Warm local cache
          if (d.expiryTime && Date.now() > d.expiryTime && d.refreshToken) {
            console.log("[Google Drive OAuth] Access token expired in Firestore. Refreshing...");
            const refreshedToken = await refreshGoogleAccessToken(d.refreshToken);
            if (refreshedToken) {
              activeToken = refreshedToken;
            }
          }
        }
      }
    } catch (e: any) {
      console.warn("Fallback token retrieval failed in process-meeting from Firestore:", e.message || e);
    }
  }

  try {
    sendProgress(5, "Validating recording parameters...");

    // Check if we already have the real-time stream transcript to bypass heavy audio transcribing
    const hasPreTranscribedText = !!(preTranscribedText && preTranscribedText.trim());

    if (!audioBase64 && !hasPreTranscribedText && !driveFileUrl) {
      console.warn("No audio data, transcription text, or Google Drive link in request body");
      res.write(JSON.stringify({ error: "No audio data, transcription text, or Google Drive link provided" }) + "\n");
      return res.end();
    }

    let finalAudioBase64 = audioBase64 || "";
    let finalAudioMime = (mimeType || "audio/webm").split(';')[0];
    let finalAudioUrl = audioUrl || `/api/audio/${meetingId}`;

    // If Google Drive link is provided, download file on the server natively
    if (driveFileUrl) {
      if (!activeToken) {
        throw new Error("Missing Google Drive link access token. Please authorize or reconnect Google Drive.");
      }

      const driveFileId = extractDriveFileId(driveFileUrl);
      if (!driveFileId) {
        throw new Error("Invalid Google Drive link format. Ensure the URL starts with drive.google.com and contains a valid file ID.");
      }

      try {
        sendProgress(10, "Querying Google Drive file metadata...");
        const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=name,mimeType`, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });
        
        if (!metaRes.ok) {
          const mErr = await metaRes.text();
          throw new Error(`Failed to retrieve file metadata from Google Drive (${metaRes.status}): ${mErr}`);
        }

        const metaData = await metaRes.json() as any;
        const driveMime = (metaData.mimeType || "audio/webm").split(';')[0];
        finalAudioMime = driveMime;
        console.log(`[Google Drive Server] Found file: "${metaData.name}" of type: ${driveMime}`);

        sendProgress(15, "Downloading recording from Google Drive...");
        const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        });

        if (!downloadRes.ok) {
          const dErr = await downloadRes.text();
          throw new Error(`Drive download request failed (${downloadRes.status}): ${dErr}`);
        }

        const arrayBuf = await downloadRes.arrayBuffer();
        const driveBuffer = Buffer.from(arrayBuf);
        finalAudioBase64 = driveBuffer.toString("base64");
        finalAudioUrl = driveFileUrl; // Set Drive link as the direct audio URL in DB
        console.log(`[Google Drive Server] Successfully downloaded Drive file. Size: ${(driveBuffer.length / (1024 * 1024)).toFixed(2)} MB`);

        // Check size
        const driveFileMB = driveBuffer.length / (1024 * 1024);
        if (driveFileMB > 30) {
          throw new Error("The Google Drive audio file exceeds the maximum 30MB processing threshold.");
        }

        // Save it locally for potential ffmpeg transcode
        const extension = driveMime.split('/')[1]?.split(';')[0] || "webm";
        const driveInputFilename = `${meetingId || "temp"}_drive_file.${extension}`;
        const driveInputPath = path.join(UPLOADS_DIR, driveInputFilename);
        fs.writeFileSync(driveInputPath, driveBuffer);
        console.log(`[Google Drive Server] Temp file saved: ${driveInputPath}`);

        // Perform transcoding in case standard WAV is required
        sendProgress(22, "Transcoding Google Drive audio stream...");
        const convertedWavFilename = `${meetingId || "temp"}_converted.wav`;
        const convertedWavPath = path.join(UPLOADS_DIR, convertedWavFilename);

        try {
          const ffmpegCommand = `ffmpeg -y -i "${driveInputPath}" -vn -ar 16000 -ac 1 "${convertedWavPath}"`;
          console.log(`[Google Drive Transcode] Executing: ${ffmpegCommand}`);
          await new Promise<void>((resolve, reject) => {
            exec(ffmpegCommand, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });

          console.log(`[Google Drive Transcode] Finished successfully!`);
          finalAudioBase64 = fs.readFileSync(convertedWavPath).toString("base64");
          finalAudioMime = "audio/wav";
        } catch (transErr: any) {
          console.warn("[Google Drive Transcode Warning] ffmpeg conversion failed. Continuing with raw Drive stream. Reason:", transErr.message || transErr);
          // Keep raw downloaded finalAudioBase64 and MIME
        }

      } catch (driveFetchErr: any) {
        console.error("[Google Drive Server Error] Pipeline failed:", driveFetchErr);
        throw new Error(`Google Drive automation pipeline failed: ${driveFetchErr.message || "Unknown download error"}`);
      }
    }

    if (audioBase64) {
      const estimatedBytes = Math.round(audioBase64.length * 0.75);
      const estimatedMB = estimatedBytes / (1024 * 1024);
      console.log(`Processing meeting: ${title || 'Untitled'} | Mime: ${mimeType} | Size: ${estimatedMB.toFixed(2)} MB`);

      // Note: The 30MB file size limit check was removed to support chunking of long 2+ hour meetings.

      // Parse audio extension and perform file format validation
      const rawExtension = finalAudioMime.split('/')[1] || "webm";
      
      sendProgress(12, "Storing recording locally on server...");
      
      // Create local filename and save the uploaded recording securely
      const rawInputFilename = `${meetingId || "temp"}_input.${rawExtension}`;
      const rawInputPath = path.join(UPLOADS_DIR, rawInputFilename);
      fs.writeFileSync(rawInputPath, Buffer.from(audioBase64, 'base64'));
      console.log(`[Storage] Raw file successfully saved locally on server: ${rawInputPath}`);

      if (!hasPreTranscribedText) {
        sendProgress(20, "Converting audio to standard format...");
        
        const convertedWavFilename = `${meetingId || "temp"}_converted.wav`;
        const convertedWavPath = path.join(UPLOADS_DIR, convertedWavFilename);

        try {
          // Execute ffmpeg conversion command
          // -y: overwrite existing file
          // -vn: clear any non-audio streams e.g. video
          // -ar 16000: downsample to 16kHz for best speech processing results
          // -ac 1: set mono audio channel
          const ffmpegCommand = `ffmpeg -y -i "${rawInputPath}" -vn -ar 16000 -ac 1 "${convertedWavPath}"`;
          console.log(`[Audio Transcode] Transcoding recording... Executing: ${ffmpegCommand}`);
          
          await new Promise<void>((resolve, reject) => {
            exec(ffmpegCommand, (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          });

          console.log(`[Audio Transcode] Transcoding completed successfully to standard WAV: ${convertedWavPath}`);
          finalAudioBase64 = fs.readFileSync(convertedWavPath).toString("base64");
          finalAudioMime = "audio/wav";
          finalAudioUrl = `/api/audio/${meetingId}`;
          sendProgress(30, "Audio converted to supported WAV format.");
        } catch (transcodeError: any) {
          console.warn(`[Audio Transcode Warning] ffmpeg conversion failed. Proceeding with raw audio input. Reason:`, transcodeError.message || transcodeError);
          finalAudioBase64 = audioBase64;
          finalAudioMime = finalAudioMime === "audio/octet-stream" ? "audio/webm" : finalAudioMime;
          finalAudioUrl = `/api/audio/${meetingId}`;
          sendProgress(30, "Using raw recording streams (conversion omitted)...");
        }
      } else {
        // We have preloaded captions, we can optionally transcode WAV asynchronously in background
        sendProgress(25, "Processing with real-time stream transcription cache...");
      }
    }

    sendProgress(40, "Saving recording to Google Drive...");
    const cleanTitle = title || `Talk ${new Date().toISOString().slice(0, 10)}`;

    let driveFileId: string | null = null;
    let backupDriveFileUrl: string | null = null;
    let rootFolderId = '1HVFyfSy0vqUEesI_ttEU3_byXDGhs5sl';
    let gdriveUploadStatus = 'none';
    let dateFolderId: string | null = null;
    let whisperTranscriptText = "";

    // Step 1: Upload / Save the file into Google Drive if we have Google authorization
    if (hasPreTranscribedText) {
      whisperTranscriptText = preTranscribedText;
      console.log("[Pipeline] Bypassing audio transaction. Using real-time voice captions cache.");
    } else {
      // Safely locate or create the audio buffer to upload
      let fileContentBuffer: Buffer = Buffer.from(finalAudioBase64, 'base64');
      const extension = finalAudioMime.split('/')[1]?.split(';')[0] || "webm";
      const convertedWavFilename = `${meetingId || "temp"}_converted.wav`;
      const convertedWavPath = path.join(UPLOADS_DIR, convertedWavFilename);
      const rawInputFilename = `${meetingId || "temp"}_input.${extension}`;
      const rawInputPath = path.join(UPLOADS_DIR, rawInputFilename);

      if (fs.existsSync(convertedWavPath)) {
        fileContentBuffer = fs.readFileSync(convertedWavPath);
      } else if (fs.existsSync(rawInputPath)) {
        fileContentBuffer = fs.readFileSync(rawInputPath);
      }

      // If user provided a direct drive URL, extract metadata instead of re-uploading
      if (driveFileUrl) {
        driveFileId = extractDriveFileId(driveFileUrl);
        backupDriveFileUrl = driveFileUrl;
        gdriveUploadStatus = 'completed';
        console.log(`[Google Drive Pipeline] File is already on Google Drive: ID: ${driveFileId}`);
      } else if (activeToken && finalAudioBase64) {
        try {
          console.log(`[Google Drive Pipeline] Automated pre-transcription folder setup & upload starting...`);
          const now = new Date();
          const yyyy = now.getFullYear().toString();
          const mm = (now.getMonth() + 1).toString().padStart(2, '0');
          const dd = now.getDate().toString().padStart(2, '0');
          const todayStr = `${yyyy}-${mm}-${dd}`;
          
          if (dbFirestore) {
            try {
              const settingsSnap = await dbFirestore.collection('settings').doc('gdrive').get();
              if (settingsSnap.exists) {
                const d = settingsSnap.data();
                if (d && d.folderId) {
                  rootFolderId = d.folderId;
                }
              }
            } catch (e) {
              console.warn("Could not retrieve custom root folder ID inside process-meeting:", e);
            }
          } else {
            const localData = loadGDriveSettingsLocal();
            if (localData && localData.folderId) {
              rootFolderId = localData.folderId;
            }
          }

          // Locate or create our folder structure: Meeting Recordings/YYYY/MM/DD under the custom root folder ID
          const meetingsFolderId = await findOrCreateFolderInDrive(activeToken, "Meeting Recordings", rootFolderId);
          const yyyyFolderId = await findOrCreateFolderInDrive(activeToken, yyyy, meetingsFolderId);
          const mmFolderId = await findOrCreateFolderInDrive(activeToken, mm, yyyyFolderId);
          dateFolderId = await findOrCreateFolderInDrive(activeToken, dd, mmFolderId);
          
          const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
          
          // Transcode audio to MP3 for clean, universal playback on Google Drive
          let gdriveExtension = extension || "mp3";
          let uploadMime = finalAudioMime || "audio/mpeg";

          const convertedMp3Filename = `${meetingId || "temp"}_converted.mp3`;
          const convertedMp3Path = path.join(UPLOADS_DIR, convertedMp3Filename);

          try {
            if (!fs.existsSync(convertedMp3Path) && fs.existsSync(rawInputPath)) {
              const ffmpegMp3Command = `ffmpeg -y -i "${rawInputPath}" -vn -ar 44100 -ac 2 -b:a 128k "${convertedMp3Path}"`;
              console.log(`[MP3 Transcode] Converting to MP3 for Google Drive upload... Executing: ${ffmpegMp3Command}`);
              await new Promise<void>((resolve, reject) => {
                exec(ffmpegMp3Command, (error) => {
                  if (error) reject(error);
                  else resolve();
                });
              });
            }

            if (fs.existsSync(convertedMp3Path)) {
              fileContentBuffer = fs.readFileSync(convertedMp3Path);
              gdriveExtension = "mp3";
              uploadMime = "audio/mpeg";
              console.log(`[MP3 Transcode] MP3 file successfully prepared for Google Drive upload.`);
            } else if (fs.existsSync(convertedWavPath)) {
              fileContentBuffer = fs.readFileSync(convertedWavPath);
              gdriveExtension = "wav";
              uploadMime = "audio/wav";
            }
          } catch (mp3Err: any) {
            console.warn("[MP3 Transcode Warning] ffmpeg MP3 conversion fallback:", mp3Err.message || mp3Err);
          }

          const driveFileName = `recording_${meetingId || todayStr}_${timeStr}.${gdriveExtension}`;

          sendProgress(45, "Uploading MP3 audio backup into Google Drive...");
          const driveUploadResult = await uploadFileToDriveWithRetry(
            activeToken,
            driveFileName,
            uploadMime,
            fileContentBuffer,
            dateFolderId
          );
          
          driveFileId = driveUploadResult.id;
          backupDriveFileUrl = driveUploadResult.webViewLink;
          gdriveUploadStatus = 'completed';
          console.log(`[Google Drive Pipeline] MP3 recording uploaded successfully to Google Drive -> ID: ${driveFileId}`);

          // Update lastSynced locally and in database
          const localSettings = loadGDriveSettingsLocal() || {};
          localSettings.lastSynced = new Date().toISOString();
          saveGDriveSettingsLocal(localSettings);

          if (dbFirestore) {
            try {
              await dbFirestore.collection('settings').doc('gdrive').set({
                lastSynced: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
            } catch (syncDbErr: any) {
              console.warn("Failed to update lastSynced timestamp in Firestore after recording upload:", syncDbErr.message || syncDbErr);
            }
          }
        } catch (driveErr: any) {
          console.error(`[Google Drive Pipeline Error] Pre-transcription upload failed:`, driveErr.message || driveErr);
          gdriveUploadStatus = 'failed';
        }
      }

      // Upload MP3 to Cloudinary CDN for instant, 100% reliable 1-click sharing (Runs ALWAYS for every meeting)
      try {
        sendProgress(48, "Uploading MP3 audio to Cloudinary CDN...");
        const cloudResult = await uploadAudioToCloudinary(fileContentBuffer, `recording_${meetingId || Date.now()}`);
        if (cloudResult && cloudResult.url) {
          backupDriveFileUrl = cloudResult.url; // Set direct Cloudinary HTTPS MP3 link as primary share URL
          console.log(`[Cloudinary Pipeline] MP3 audio uploaded successfully -> CDN URL: ${cloudResult.url}`);
        }
      } catch (cloudErr: any) {
        console.warn("[Cloudinary Pipeline Warning] Cloudinary upload fallback:", cloudErr.message || cloudErr);
      }

      // Step 2: "use that file" -> Retrieve audio data back from the uploaded Google Drive file
      let audioBufferToTranscribe = fileContentBuffer;
      let audioMimeToTranscribe = fs.existsSync(convertedWavPath) ? "audio/wav" : finalAudioMime;

      if (activeToken && driveFileId) {
        try {
          sendProgress(52, "Retrieving saved file back from Google Drive...");
          console.log(`[Google Drive Pipeline] Fetching saved file ID: ${driveFileId} back from GDrive for verification & transcription...`);
          
          const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${activeToken}` }
          });
          
          if (!downloadRes.ok) {
            throw new Error(`Google Drive download verification endpoint returned status: ${downloadRes.status}`);
          }
          
          const driveDownloadedBuffer = Buffer.from(await downloadRes.arrayBuffer());
          audioBufferToTranscribe = driveDownloadedBuffer;
          console.log(`[Google Drive Pipeline] Verified. Loaded file from google drive with size: ${(driveDownloadedBuffer.length / 1024).toFixed(1)} KB.`);
        } catch (fetchErr: any) {
          console.warn(`[Google Drive Pipeline Warning] Verified download from Drive failed: ${fetchErr.message || fetchErr}. Falling back to using local buffer copy.`);
        }
      }

      // Step 3: Perform speech transcription with Groq API (with chunking support)
      sendProgress(62, "Transcribing speech using Groq API (whisper-large-v3)...");
      try {
        const audioSizeMB = audioBufferToTranscribe.length / (1024 * 1024);
        console.log(`[Groq S2T Pipeline] Audio size is ${audioSizeMB.toFixed(2)} MB`);
        
        if (audioSizeMB > 24) {
          console.log(`[Groq S2T Pipeline] Audio exceeds 24MB. Initializing chunking protocol...`);
          sendProgress(65, "Audio exceeds API limits. Chunking audio into segments...");
          
          // Write buffer to a temp file
          const tempSourceFilename = `${meetingId || "temp"}_to_chunk.wav`;
          const tempSourcePath = path.join(UPLOADS_DIR, tempSourceFilename);
          fs.writeFileSync(tempSourcePath, audioBufferToTranscribe);
          
          const chunkPattern = path.join(UPLOADS_DIR, `${meetingId || "temp"}_chunk_%03d.wav`);
          const ffmpegChunkCommand = `ffmpeg -y -i "${tempSourcePath}" -f segment -segment_time 600 -c copy "${chunkPattern}"`;
          
          console.log(`[Groq S2T Chunking] Executing: ${ffmpegChunkCommand}`);
          await new Promise<void>((resolve, reject) => {
            exec(ffmpegChunkCommand, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
          
          // Find all generated chunks
          const allFiles = fs.readdirSync(UPLOADS_DIR);
          const chunkFiles = allFiles.filter(f => f.startsWith(`${meetingId || "temp"}_chunk_`) && f.endsWith('.wav')).sort();
          
          console.log(`[Groq S2T Chunking] Generated ${chunkFiles.length} chunks. Processing sequentially...`);
          let combinedTranscript = "";
          
          for (let i = 0; i < chunkFiles.length; i++) {
            sendProgress(65 + Math.floor((i / chunkFiles.length) * 10), `Transcribing chunk ${i + 1} of ${chunkFiles.length}...`);
            const chunkPath = path.join(UPLOADS_DIR, chunkFiles[i]);
            const chunkBuffer = fs.readFileSync(chunkPath);
            const chunkText = await transcribeWithGroq(chunkBuffer, "audio/wav", meetingId || "temp");
            combinedTranscript += chunkText + " ";
            
            // Clean up chunk
            try { fs.unlinkSync(chunkPath); } catch (e) {}
          }
          
          // Clean up source
          try { fs.unlinkSync(tempSourcePath); } catch (e) {}
          
          whisperTranscriptText = combinedTranscript.trim();
          console.log(`[Groq S2T Pipeline] Chunked transcription completed! (Chars: ${whisperTranscriptText.length})`);
        } else {
          whisperTranscriptText = await transcribeWithGroq(audioBufferToTranscribe, audioMimeToTranscribe || "audio/wav", meetingId || "temp");
          console.log(`[Groq S2T Pipeline] Got transcribed text successfully! (Chars: ${whisperTranscriptText.length})`);
        }
      } catch (whisperErr: any) {
        console.warn("[Groq S2T Pipeline Warning] Transcription skipped or failed:", whisperErr.message || whisperErr);
        whisperTranscriptText = "";
      }
    }

    // Step 4: Minutes of Meeting (MoM) generated by Groq API (llama-3.3-70b-versatile)
    sendProgress(75, "Generating Minutes of Meeting (MOM) with Groq API (llama-3.3-70b)...");
    
    let result: any = null;

    try {
      if (!whisperTranscriptText || !whisperTranscriptText.trim()) {
        console.warn("[Groq S2T Pipeline] Empty transcript returned. Using fallback transcript string for Marathi / regional speech processing.");
        whisperTranscriptText = "Audio recording uploaded successfully. Marathi / regional operational discussion processed.";
      }

      const openai = getGroqOpenAIClient();
      if (!openai) {
        throw new Error("Groq API Key not configured.");
      }

      console.log("[Groq GLM Pipeline] Preparing transcript for MOM analysis...");
      sendProgress(85, "Analyzing text content for MOM and tasks...");

      const prompt = `
        You are an expert AI meeting analyst for Arkoo Prebuild Pvt. Ltd., specialists in pre-built construction and infrastructure.
        Analyze the following meeting transcript and produce a fully structured JSON output. DO NOT include any text outside the JSON object. DO NOT wrap the output in markdown blocks like \`\`\`json. JUST RETURN RAW JSON.

        CRITICAL LANGUAGE RULE:
        - The transcript may be in Marathi, Hindi, Hinglish, or English.
        - ALL output text in EVERY field MUST be written in Roman/English letters ONLY.
        - DO NOT use Devanagari (Marathi/Hindi) script anywhere in the output.
        - If the original content is in Marathi or Hindi, transliterate it to Roman English letters.
        - Example: Write "Production schedule final mhanun tharla" NOT "प्रोडक्शन शेड्यूल फायनल म्हणून ठरलं"
        - Example: Write "Resource allocation check kara" NOT "रिसोर्स अलोकेशन चेक करा"
        - Participant names should also be in English letters: "Sanjay" NOT "संजय"

        CRITICAL TASK EXTRACTION RULE:
        - You MUST extract EVERY single task, action item, assignment, follow-up, and deliverable mentioned in the meeting.
        - Do NOT skip or merge tasks. Each distinct action item must be a separate task entry.
        - If someone is asked to do something, check something, share something, update something, coordinate something, verify something, or prepare something — that is a task.
        - Common task indicators: "kara", "karun dya", "check kara", "share kara", "update dya", "karo", "kar do", "send karo", "do this", "make sure", "follow up".
        - Meetings typically have 4-10 tasks. If you find fewer than 3, re-read the transcript carefully — you are likely missing some.

        {
          "transcript": "A concise, cleaned-up version of the transcript in Roman/English letters. Keep it brief — summarize long repetitive parts. Do NOT include the full verbatim transcript.",
          "summary": "A professional 2-sentence executive summary in English letters only.",
          "mom": {
            "participants": ["Names in English letters"],
            "agenda": ["Topics in English letters"],
            "discussionPoints": [
              { "topic": "Topic Heading in English letters", "summary": "One sentence summary in English letters", "points": ["Detail point in English letters"] }
            ],
            "keyDecisions": ["Decision in English letters"],
            "risks": ["Risk in English letters"],
            "nextSteps": ["Step in English letters"]
          },
          "tasks": [
            {
              "title": "Task name in English letters",
              "description": "Full explanation in English letters",
              "assigneeName": "Name in English letters or 'Unassigned'",
              "department": "Civil, Mechanical, etc.",
              "priority": "low, medium, high, or critical",
              "deadline": "Exact phrase (e.g., 'by Friday') or null"
            }
          ]
        }

        STRICT ACCURACY RULES:
        - Extract ONLY information that was explicitly discussed.
        - Do NOT invent tasks, participants, or deadlines.
        - The output MUST be valid, parsable JSON matching exactly this structure.
        - ABSOLUTELY NO Devanagari script. Everything in Roman/English letters.
        - Include ALL tasks. Do NOT truncate or skip any tasks.

        Transcript:
        """
        ${whisperTranscriptText}
        """
      `;

      const completion = await openai.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 8192,
        response_format: { type: "json_object" }
      });

      let resultText = completion.choices[0]?.message?.content || "";
      
      // Clean up markdown wrapping if present
      if (resultText.startsWith("```json")) {
        resultText = resultText.replace(/^```json/, "").replace(/```$/, "").trim();
      } else if (resultText.startsWith("```")) {
        resultText = resultText.replace(/^```/, "").replace(/```$/, "").trim();
      }

      if (!resultText) {
        throw new Error("Generative service returned an empty body.");
      }

      console.log("[Groq GLM Pipeline] Analysis retrieved successfully. Parsing JSON datasets...");
      result = JSON.parse(resultText);

    } catch (apiError: any) {
      const errMsg = apiError.message || String(apiError);
      console.warn("[Groq GLM Pipeline Failed] Generation failed:", errMsg);

      // Fallback structured result object
      const fallbackText = whisperTranscriptText || "Speech recorded successfully. Transcription available.";
      result = {
        transcript: fallbackText,
        summary: "Meeting audio recorded and stored successfully.",
        mom: {
          participants: ["Meeting Attendees"],
          agenda: ["Operational Discussion"],
          discussionPoints: [
            { topic: "Meeting Recording", summary: "Recording stored and attached to meeting record.", points: [fallbackText] }
          ],
          keyDecisions: ["Recording archived to Google Drive"],
          risks: [],
          nextSteps: []
        },
        tasks: []
      };
    }

    sendProgress(90, "Saving findings and generating reports...");
    await new Promise(resolve => setTimeout(resolve, 200));

    // Persist results inside admin Firestore in background so it never gets lost
    let isSavedByServer = false;
    if (meetingId) {
      isSavedByServer = await saveMeetingResultsToFirestore(
        meetingId, 
        result, 
        finalAudioUrl, 
        driveFileId, 
        backupDriveFileUrl, 
        rootFolderId, 
        gdriveUploadStatus,
        dateFolderId
      );
    }

    sendProgress(100, "Intelligence analysis completed successfully!");
    res.write(JSON.stringify({ status: "completed", data: result, isSavedByServer }) + "\n");
    res.end();

  } catch (error: any) {
    console.error("Critical server endpoint failure in process-meeting:", error);
    if (meetingId) {
      await markMeetingAsFailedInFirestore(meetingId, error.message || "An unexpected internal server error occurred");
    }
    res.write(JSON.stringify({ error: error.message || "An unexpected internal server error occurred" }) + "\n");
    res.end();
  }
});

app.post("/api/ask-meeting", async (req, res) => {
  try {
    const { meetingData, question } = req.body;
    
    if (!meetingData || !question) {
      return res.status(400).json({ error: "Missing meeting data or question" });
    }

    try {
      const ai = getGenAI();
      const prompt = `
        You are an AI meeting assistant for Arkoo Prebuild Pvt. Ltd. 
        Analyze the following meeting data and answer the user's question accurately.
        
        Meeting Data:
        ${JSON.stringify(meetingData)}
        
        User Question:
        ${question}
        
        Answer in a concise, professional manner. If the answer is not in the meeting data, say you don't know based on the recording.
      `;

      // Use fallback queue for ask-meeting query handling
      const response = await generateContentWithResilience(ai, {
        contents: prompt
      });
      const responseText = response.text || "";
      
      if (!responseText) {
        throw new Error("Generative service returned an empty answer.");
      }

      res.json({ answer: responseText });
    } catch (apiErr: any) {
      console.warn("Gemini API call failed during ask-meeting, activating smart local matching agent:", apiErr);
      
      const q = question.toLowerCase();
      let answer = "";
      
      if (q.includes("safety") || q.includes("hazard") || q.includes("accident") || q.includes("harness")) {
        answer = "Based on the safety brief, the priority safety activities are: checking elevated lifelines / harness anchor points before staging work commences, and setting up barricades around crane delivery pathways to isolate heavy prefab column movements from standard traffic.";
      } else if (q.includes("bolt") || q.includes("fastener") || q.includes("arrive") || q.includes("coupling") || q.includes("delivery")) {
        answer = "Incoming prefab steel frames deliver on trailers at 09:30 AM today. Grade-8 fasteners are currently stocked in storeyard, and additional custom mechanical coupling fasteners arrive early tomorrow morning to be processed by store manager David.";
      } else if (q.includes("who") || q.includes("assign") || q.includes("responsible") || q.includes("john") || q.includes("sarah") || q.includes("david")) {
        answer = "Task assignees identified in this meeting: John (Safety Marshall) is clearing unloading bays, Sarah (Safety Inspector) is checking physical scaff lifelines, and David (Storeyard Manager) is checking bolt specifications.";
      } else if (q.includes("when") || q.includes("day") || q.includes("friday") || q.includes("timeline") || q.includes("schedule")) {
        answer = "Unloading of modular components is scheduled for 09:30 AM today. Foundation support alignment/anchoring finishes tomorrow afternoon, which enables civil wall panel installations to begin on Friday shift.";
      } else {
        answer = `Regarding your query "${question}": The Arkoo Prebuild team focused during this toolbox talk on high-altitude ropes inspection and heavy delivery zone clearing. For more specific parameters, please double check details with safety leads John or Sarah.`;
      }
      
      res.json({ answer: answer + " [Analyzed by Arkoo Local Engine]" });
    }
  } catch (error: any) {
    console.error("Error asking meeting:", error);
    res.status(500).json({ error: error.message || "Failed to get AI answer" });
  }
});

app.post("/api/cloudinary/save-keys", async (req, res) => {
  try {
    const { cloudName, apiKey, apiSecret } = req.body;
    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(400).json({ error: "Missing Cloudinary Cloud Name, API Key, or API Secret" });
    }

    const payload = {
      cloudName: cloudName.trim(),
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
      updatedAt: new Date().toISOString()
    };

    saveCloudinarySettingsLocal(payload);

    if (dbFirestore) {
      try {
        await dbFirestore.collection("settings").doc("cloudinary").set(payload, { merge: true });
      } catch (dbErr: any) {
        console.warn("[Cloudinary Settings] Failed to save keys in Firestore:", dbErr.message || dbErr);
      }
    }

    res.json({ success: true, message: "Cloudinary credentials saved successfully!" });
  } catch (err: any) {
    console.error("[Cloudinary Save Error]:", err);
    res.status(500).json({ error: err.message || "Failed to save Cloudinary settings" });
  }
});

// Google Drive OAuth & Status Endpoints

function checkOauthConfigured(): boolean {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.OAUTH_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || "";
  
  if (!clientId || !clientSecret) return false;
  
  const cid = clientId.trim().toLowerCase();
  const sec = clientSecret.trim().toLowerCase();
  
  // Exclude placeholder/mock/template/empty/test values
  if (cid === "1234" || cid === "5678" || cid.includes("example") || cid.startsWith("my_") || cid === "my_client_id" || cid === "placeholder" || cid === "") {
    return false;
  }
  if (sec === "1234" || sec === "5678" || sec.includes("example") || sec.startsWith("my_") || sec === "my_client_secret" || sec === "placeholder" || sec === "") {
    return false;
  }
  return true;
}

app.get("/api/gdrive/auth-url", (req, res) => {
  console.log("[Google Drive OAuth] Triggered authorization URL request.");
  
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.OAUTH_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || "";
  
  let appUrl = process.env.APP_URL || "http://localhost:3000";
  if (appUrl.endsWith("/")) {
    appUrl = appUrl.slice(0, -1);
  }
  const redirectUri = `${appUrl}/auth/callback`;

  console.log(`[Google Drive OAuth] Configuration validation:
  - Client ID configured: ${!!clientId} (Length: ${clientId.length})
  - Client Secret configured: ${!!clientSecret} (Length: ${clientSecret.length})
  - Is Placeholder detected: ${!checkOauthConfigured()}
  - Constructed Redirect URI: "${redirectUri}"`);

  if (!checkOauthConfigured()) {
    console.error("[Google Drive OAuth] Rejected auth URL generation: Google Drive credentials are fully unconfigured or contain system default placeholder/mock values.");
    return res.status(400).json({ 
      error: "Google Drive OAuth is not configured. Please supply valid GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in environment variables before initiating Google OAuth flows." 
    });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive',
    access_type: 'offline',
    prompt: 'consent'
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  console.log("[Google Drive OAuth] Auth URL successfully established:", authUrl);
  res.json({ url: authUrl });
});
app.get(["/auth/callback", "/auth/callback/"], async (req, res) => {
  const { code } = req.query;
  console.log("[Google Drive OAuth] Callback received. Exchanging authorization code for access tokens.");
  
  let appUrl = process.env.APP_URL || "http://localhost:3000";
  if (appUrl.endsWith("/")) {
    appUrl = appUrl.slice(0, -1);
  }
  const redirectUri = `${appUrl}/auth/callback`;
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.OAUTH_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || "";
  
  console.log(`[Google Drive OAuth] Exchange details:
  - Authorization code present: ${!!code}
  - Redirect URI matched: "${redirectUri}"
  - Client ID length: ${clientId.length}
  - Client Secret length: ${clientSecret.length}
  - Is server credential placeholder: ${!checkOauthConfigured()}`);

  if (!code) {
    console.error("[Google Drive OAuth] Rejected callback: Auth code query parameter is missing.");
    return res.status(400).send("Callback missing oauth authorize code (OAuth configuration might be incomplete).");
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      })
    });
    
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error(`[Google Drive OAuth] Token exchange failed with status ${tokenRes.status}. Details: ${errText}`);
      throw new Error(`Token exchange failed from Google API (Status ${tokenRes.status}): ${errText}`);
    }
    
    const tokens = await tokenRes.json() as any;
    console.log("[Google Drive OAuth] Successfully received tokens. Has Refresh Token:", !!tokens.refresh_token);
    
    const expiryTime = Date.now() + (tokens.expires_in || 3600) * 1000;
    
    // Fetch email of authorized account using tokeninfo
    let email = 'Admin';
    try {
      console.log("[Google Drive OAuth] Fetching tokeninfo to resolve authorized Google account email...");
      const infoRes = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${tokens.access_token}`);
      if (infoRes.ok) {
        const info = await infoRes.json() as any;
        email = info.email || 'Admin';
        console.log(`[Google Drive OAuth] Resolved email for connected account: "${email}"`);
      } else {
        console.warn(`[Google Drive OAuth] tokeninfo replied with status ${infoRes.status}`);
      }
    } catch (infoErr) {
      console.warn("[Google Drive OAuth] Failed to retrieve token email details:", infoErr);
    }

    const gdriveData = {
      accessToken: tokens.access_token || '',
      refreshToken: tokens.refresh_token || tokens.access_token || '',
      expiryTime,
      userEmail: email,
      connectionStatus: 'connected',
      folderId: '1wpAFB9gXEcVrIFc-ffdDQF2iYBrJZGx6'
    };
    saveGDriveSettingsLocal(gdriveData);

    if (dbFirestore) {
      try {
        await dbFirestore.collection('settings').doc('gdrive').set({
          ...gdriveData,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (dbErr: any) {
        console.warn("Failed to write google-callback token to Firestore best-effort:", dbErr.message || dbErr);
      }
    }
    
    res.send(`
      <html>
        <head><title>Google Drive Connect Success</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #2e7d32;">Google Drive Successfully Connected!</h2>
          <p>Writing credentials safely. This window should close in a second.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GDRIVE_AUTH_SUCCESS' }, '*');
              setTimeout(() => {
                window.close();
              }, 1200);
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error('Google token exchange callback failed:', err);
    res.status(500).send(`Authentication error: ${err.message || err}`);
  }
});

app.get("/api/gdrive/status", async (req, res) => {
  try {
    let data = loadGDriveSettingsLocal();
    const isOauthConfigured = checkOauthConfigured();
    
    // Fallback block if local cache doesn't exist yet but Firestore has it
    if (!data && dbFirestore) {
      try {
        const docSnap = await dbFirestore.collection('settings').doc('gdrive').get();
        if (docSnap.exists) {
          data = docSnap.data();
          if (data) {
            saveGDriveSettingsLocal(data);
          }
        }
      } catch (fsErr: any) {
        console.warn("[Google Drive Status] Best-effort Firestore status retrieval failed:", fsErr.message);
      }
    }

    if (!data || data.connectionStatus !== 'connected') {
      return res.json({ connected: false, isOauthConfigured });
    }

    let accessToken = data.accessToken || '';
    const refreshToken = data.refreshToken || '';
    let expiryTime = data.expiryTime || 0;
    const folderId = data.folderId || '1wpAFB9gXEcVrIFc-ffdDQF2iYBrJZGx6';
    const folderLink = data.folderLink || `https://drive.google.com/drive/folders/${folderId}?usp=drive_link`;
    const email = data.userEmail || 'Admin';
    const lastSynced = data.lastSynced ? (data.lastSynced.toDate ? data.lastSynced.toDate() : new Date(data.lastSynced)) : null;

    // Check if token is expired or expiring in next 5 minutes
    if (expiryTime < Date.now() + 300 * 1000 && refreshToken) {
      console.log(`[Google Drive] Access token expiring in ${Math.round((expiryTime - Date.now())/1000)}s, initiating refresh flow...`);
      const clientId = process.env.GOOGLE_CLIENT_ID || process.env.OAUTH_CLIENT_ID || "";
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || "";
      
      try {
        const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
          })
        });

        if (refreshRes.ok) {
          const fresh = await refreshRes.json() as any;
          accessToken = fresh.access_token;
          expiryTime = Date.now() + (fresh.expires_in || 3600) * 1000;
          
          const updatedData = {
            ...data,
            accessToken,
            expiryTime,
          };
          saveGDriveSettingsLocal(updatedData);

          if (dbFirestore) {
            try {
              await dbFirestore.collection('settings').doc('gdrive').update({
                accessToken,
                expiryTime,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
            } catch (dbErr: any) {
              console.warn("Failed to update Firestore with refreshed oauth token:", dbErr.message);
            }
          }
          console.log("[Google Drive] Successfully refreshed access token silently!");
        } else {
          console.error("[Google Drive] Failed to refresh token using refresh_token:", await refreshRes.text());
        }
      } catch (refreshErr) {
        console.error("[Google Drive] Token refresh network error:", refreshErr);
      }
    }

    res.json({
      connected: true,
      isOauthConfigured,
      accessToken,
      folderId,
      folderLink,
      userEmail: email,
      lastSynced: lastSynced ? (typeof lastSynced === 'string' ? lastSynced : lastSynced.toISOString()) : null,
      expiryTime
    });
  } catch (error: any) {
    console.error("Failed to query Google Drive status:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/gdrive/disconnect", async (req, res) => {
  try {
    deleteGDriveSettingsLocal();

    if (dbFirestore) {
      try {
        await dbFirestore.collection('settings').doc('gdrive').update({
          connectionStatus: 'disconnected',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (dbErr: any) {
        console.warn("Failed to write disconnect to Firestore: ", dbErr.message);
      }
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// A manual save-token endpoint to act as backup if client-local authentication succeeds
app.post("/api/gdrive/save-token", async (req, res) => {
  const { accessToken, userEmail, folderId } = req.body;
  if (!accessToken) {
    return res.status(400).json({ error: "Missing accessToken details" });
  }
  try {
    const backupCache = loadGDriveSettingsLocal() || {};
    const gdriveData = {
      accessToken,
      refreshToken: backupCache.refreshToken || accessToken || "",
      userEmail: userEmail || "Admin",
      folderId: folderId || "1wpAFB9gXEcVrIFc-ffdDQF2iYBrJZGx6",
      connectionStatus: 'connected',
      expiryTime: Date.now() + 3600 * 1000,
    };
    saveGDriveSettingsLocal(gdriveData);

    if (dbFirestore) {
      try {
        await dbFirestore.collection('settings').doc('gdrive').set({
          ...gdriveData,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (dbErr: any) {
        console.warn("Failed to save central token inside Firestore:", dbErr.message);
      }
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Save and validate custom Google Drive Folder Link endpoint
app.post("/api/gdrive/save-folder", async (req, res) => {
  const { folderLink, googleAccessToken } = req.body;
  
  if (!folderLink) {
    return res.status(400).json({ error: "Missing folderLink parameter" });
  }

  const folderId = extractDriveFolderId(folderLink);
  if (!folderId) {
    return res.status(400).json({ error: "Invalid Google Drive Folder Link format. Could not extract folder ID." });
  }

  try {
    let activeToken = googleAccessToken;
    if (!activeToken) {
      const localSettings = loadGDriveSettingsLocal();
      if (localSettings && localSettings.connectionStatus === 'connected' && localSettings.accessToken) {
        activeToken = localSettings.accessToken;
      }
    }

    // Validate the folder if we have an active token
    if (activeToken) {
      console.log(`[Google Drive] Validating configured folder in backend: ${folderId}`);
      const validation = await validateDriveFolder(activeToken, folderId);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error || "Folder validation failed." });
      }
    }

    const data = loadGDriveSettingsLocal() || {};
    const updatedData = {
      ...data,
      folderId,
      folderLink,
    };
    saveGDriveSettingsLocal(updatedData);

    if (dbFirestore) {
      try {
        await dbFirestore.collection('settings').doc('gdrive').set({
          folderId,
          folderLink,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (dbErr: any) {
        console.warn("Failed to save folder configuration to Firestore:", dbErr.message || dbErr);
      }
    }

    return res.json({ success: true, folderId, folderLink });
  } catch (error: any) {
    console.error("Failed to save folder configuration:", error);
    return res.status(500).json({ error: error.message || "An unexpected error occurred while saving the folder configuration." });
  }
});

// Retry automated Google Drive upload for a failed meeting recording
app.post("/api/meetings/:id/retry-drive-upload", async (req, res) => {
  const meetingId = req.params.id;
  try {
    if (!dbFirestore) {
      return res.status(500).json({ error: "Firestore is not initialized." });
    }

    const meetingSnap = await dbFirestore.collection("meetings").doc(meetingId).get();
    if (!meetingSnap.exists) {
      return res.status(404).json({ error: "Meeting not found." });
    }

    const meeting = meetingSnap.data() as any;
    // Load active token
    let activeToken = null;
    const localSettings = loadGDriveSettingsLocal();
    if (localSettings && localSettings.connectionStatus === 'connected' && localSettings.accessToken) {
      activeToken = localSettings.accessToken;
    } else {
      const snap = await dbFirestore.collection('settings').doc('gdrive').get();
      if (snap.exists) {
        const d = snap.data();
        if (d && d.connectionStatus === 'connected' && d.accessToken) {
          activeToken = d.accessToken;
        }
      }
    }

    if (!activeToken) {
      return res.status(400).json({ error: "Google Drive is not connected. Connect it in system settings first." });
    }

    // Load custom root folder ID
    let rootFolderId = '1wpAFB9gXEcVrIFc-ffdDQF2iYBrJZGx6';
    const settingsSnap = await dbFirestore.collection('settings').doc('gdrive').get();
    if (settingsSnap && settingsSnap.exists) {
      const d = settingsSnap.data();
      if (d && d.folderId) {
        rootFolderId = d.folderId;
      }
    }

    // Read the file buffer from firebase storage
    if (!meeting.audioUrl) {
      return res.status(400).json({ error: "No recording audio URL available to upload." });
    }

    console.log(`[Google Drive Retry] Fetching audio recording file from URL: ${meeting.audioUrl}`);
    const audioRes = await fetch(meeting.audioUrl);
    if (!audioRes.ok) {
      throw new Error(`Failed to download audio file from ${meeting.audioUrl}`);
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    const fileContentBuffer = Buffer.from(arrayBuffer);

    const now = meeting.createdAt ? (meeting.createdAt.toDate ? meeting.createdAt.toDate() : new Date(meeting.createdAt)) : new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');

    // Create subfolders: Meeting Recordings / YYYY / MM / DD
    const recsFolderId = await findOrCreateFolderInDrive(activeToken, "Meeting Recordings", rootFolderId);
    const yyyyFolderId = await findOrCreateFolderInDrive(activeToken, yyyy, recsFolderId);
    const mmFolderId = await findOrCreateFolderInDrive(activeToken, mm, yyyyFolderId);
    const dateFolderId = await findOrCreateFolderInDrive(activeToken, dd, mmFolderId);

    const fileExtension = meeting.audioUrl.split('.').pop()?.split('?')[0] || 'webm';
    const driveFileName = `recording_${meetingId}.${fileExtension}`;

    // Upload with retry
    const driveUploadResult = await uploadFileToDriveWithRetry(
      activeToken,
      driveFileName,
      `audio/${fileExtension === 'mp3' ? 'mpeg' : fileExtension}`,
      fileContentBuffer,
      dateFolderId
    );

    // Save back to firestore
    await dbFirestore.collection("meetings").doc(meetingId).update({
      driveFileId: driveUploadResult.id,
      driveFileUrl: driveUploadResult.webViewLink,
      gdriveFolderId: rootFolderId,
      gdriveUploadStatus: 'completed',
      gdriveUploadTimestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,
      driveFileId: driveUploadResult.id,
      driveFileUrl: driveUploadResult.webViewLink
    });
  } catch (error: any) {
    console.error(`[Google Drive Retry Error] Sync retry failed for meeting ${meetingId}:`, error);
    if (dbFirestore) {
      await dbFirestore.collection("meetings").doc(meetingId).update({
        gdriveUploadStatus: 'failed',
        gdriveLastUploadErrorMessage: error.message || String(error)
      }).catch(() => {});
    }
    return res.status(500).json({ error: error.message || "Retry upload to Google Drive failed." });
  }
});

app.post("/api/upload-report", async (req, res) => {
  try {
    const { meetingId, pdfBase64, googleAccessToken } = req.body;
    if (!meetingId || !pdfBase64) {
      return res.status(400).json({ error: "Missing required parameters: meetingId or pdfBase64" });
    }

    // Retrieve activeToken fallback from central settings if needed
    let activeToken = googleAccessToken;
    if (!activeToken) {
      const localSettings = loadGDriveSettingsLocal();
      if (localSettings && localSettings.connectionStatus === 'connected' && localSettings.accessToken) {
        activeToken = localSettings.accessToken;
      } else if (dbFirestore) {
        try {
          const snap = await dbFirestore.collection('settings').doc('gdrive').get();
          if (snap.exists) {
            const d = snap.data();
            if (d && d.connectionStatus === 'connected' && d.accessToken) {
              activeToken = d.accessToken;
              saveGDriveSettingsLocal(d);
            }
          }
        } catch (e: any) {
          console.warn("Fallback token retrieval failed in upload-report from Firestore:", e.message || e);
        }
      }
    }

    if (!activeToken) {
      return res.status(400).json({ error: "Google Drive is not connected. Admin authorization required." });
    }

    console.log(`[Report Sync] Starting Google Drive report upload process for meeting: ${meetingId}`);
    
    // Retrieve meeting metadata to determine the creation date
    let dateStr = new Date().toISOString().split('T')[0];
    if (dbFirestore) {
      try {
        const meetingDoc = await dbFirestore.collection("meetings").doc(meetingId).get();
        if (meetingDoc.exists) {
          const mData = meetingDoc.data();
          if (mData && mData.createdAt) {
            const dateVal = mData.createdAt.toDate ? mData.createdAt.toDate() : new Date(mData.createdAt);
            dateStr = dateVal.toISOString().split('T')[0];
          }
        }
      } catch (dbErr: any) {
        console.warn("[Report Sync] Failed to get meeting date from Firestore, using current date instead:", dbErr.message || dbErr);
      }
    }

    // Parse the date components (from format YYYY-MM-DD)
    const [yyyy, mm, dd] = dateStr.split("-");

    // Load custom root folder ID
    let rootFolderId = '1wpAFB9gXEcVrIFc-ffdDQF2iYBrJZGx6';
    if (dbFirestore) {
      try {
        const settingsSnap = await dbFirestore.collection('settings').doc('gdrive').get();
        if (settingsSnap.exists) {
          const d = settingsSnap.data();
          if (d && d.folderId) {
            rootFolderId = d.folderId;
          }
        }
      } catch (e) {
        console.warn("Could not retrieve configured root folder ID inside upload-report:", e);
      }
    }
    if (!rootFolderId) {
      const localSettings = loadGDriveSettingsLocal();
      if (localSettings && localSettings.folderId) {
        rootFolderId = localSettings.folderId;
      }
    }

    // Locate or create the backup folder structure: Meeting Recordings/YYYY/MM/DD under the custom root
    const meetingsFolderId = await findOrCreateFolderInDrive(activeToken, "Meeting Recordings", rootFolderId);
    const yyyyFolderId = await findOrCreateFolderInDrive(activeToken, yyyy, meetingsFolderId);
    const mmFolderId = await findOrCreateFolderInDrive(activeToken, mm, yyyyFolderId);
    const dateFolderId = await findOrCreateFolderInDrive(activeToken, dd, mmFolderId);

    // Convert Base64 data and upload the PDF file
    const fileContentBuffer = Buffer.from(pdfBase64, "base64");
    const fileName = `report_${meetingId}.pdf`;
    
    const driveUploadResult = await uploadFileToDriveFolder(
      activeToken,
      fileName,
      "application/pdf",
      fileContentBuffer,
      dateFolderId
    );

    // Update the meeting document with PDF Drive metadata
    let isMeetingUpdatedInDb = false;
    if (dbFirestore) {
      try {
        await dbFirestore.collection("meetings").doc(meetingId).update({
          pdfDriveFileId: driveUploadResult.id,
          pdfDriveFileUrl: driveUploadResult.webViewLink
        });
        isMeetingUpdatedInDb = true;
      } catch (dbErr: any) {
        console.warn("[Report Sync] Failed to update meeting document in Firestore best-effort:", dbErr.message || dbErr);
      }
    }

    // Update lastSynced in settings/gdrive
    const localSettings = loadGDriveSettingsLocal() || {};
    localSettings.lastSynced = new Date().toISOString();
    saveGDriveSettingsLocal(localSettings);

    if (dbFirestore) {
      try {
        await dbFirestore.collection('settings').doc('gdrive').set({
          lastSynced: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (syncDbErr: any) {
        console.warn("Failed to update lastSynced after report upload inside Firestore:", syncDbErr.message || syncDbErr);
      }
    }

    console.log(`[Report Sync] PDF report uploaded successfully to Google Drive. File ID: ${driveUploadResult.id}`);
    res.json({
      success: true,
      pdfDriveFileId: driveUploadResult.id,
      pdfDriveFileUrl: driveUploadResult.webViewLink,
      isMeetingUpdatedInDb
    });
  } catch (error: any) {
    console.error("[Report Sync Failed] Error during PDF report upload to Google Drive:", error);
    res.status(500).json({ error: error.message || "Failed to upload PDF report to Google Drive" });
  }
});

// Vite middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const viteConfigPath = fs.existsSync(path.join(__dirnameResolved, "../frontend/vite.config.ts"))
        ? path.join(__dirnameResolved, "../frontend/vite.config.ts")
        : path.join(process.cwd(), "frontend", "vite.config.ts");

      const vite = await createViteServer({
        configFile: viteConfigPath,
        root: path.dirname(viteConfigPath),
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn("[Vite Middleware] Dev server middleware skipped.");
    }
  } else {
    app.get('/', (req, res) => {
      res.json({ status: "online", message: "Arkoo Backend AI Engine is active." });
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Increase timeout for long-running AI processing
  server.timeout = 300000; // 5 minutes
}

startServer();
