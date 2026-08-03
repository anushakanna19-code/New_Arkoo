const fs = require('fs');
const path = require('path');
const { jsPDF } = require('jspdf');

function createDocumentationPDF() {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210
  const pageHeight = doc.internal.pageSize.getHeight(); // 297
  const margin = 14;
  const contentWidth = pageWidth - margin * 2; // 182

  let y = 15;
  let currentPage = 1;

  // Color Palette
  const colors = {
    darkSlate: [30, 41, 59],      // #1E293B
    brandOrange: [249, 115, 22],  // #F97316
    primaryBlue: [37, 99, 235],   // #2563EB
    emeraldGreen: [16, 185, 129], // #10B981
    purpleHeader: [124, 58, 237], // #7C3AED
    mutedSlate: [100, 116, 139],  // #64748B
    lightBg: [248, 250, 252],     // #F8FAFC
    borderGray: [226, 232, 240],  // #E2E8F0
    white: [255, 255, 255]
  };

  function addHeaderFooter(pageNum) {
    // Top Bar
    doc.setFillColor(...colors.darkSlate);
    doc.rect(0, 0, pageWidth, 12, 'F');

    doc.setFillColor(...colors.brandOrange);
    doc.rect(0, 12, pageWidth, 1.5, 'F');

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...colors.white);
    doc.text("ARKOO PREBUILD INTELLIGENCE — SYSTEM & ROLE DOCUMENTATION", margin, 8);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - margin, 8, { align: "right" });

    // Bottom Bar / Footer
    doc.setDrawColor(...colors.borderGray);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    doc.setFontSize(8);
    doc.setTextColor(...colors.mutedSlate);
    doc.text("Confidential — For Internal Operations & Role Authorization Reference", margin, pageHeight - 7);
    doc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 7, { align: "right" });
  }

  function checkPageBreak(neededHeight) {
    if (y + neededHeight > pageHeight - 18) {
      doc.addPage();
      currentPage++;
      addHeaderFooter(currentPage);
      y = 20;
    }
  }

  // --- PAGE 1: TITLE & EXECUTIVE SUMMARY ---
  addHeaderFooter(currentPage);
  y = 20;

  // Title Box
  doc.setFillColor(...colors.lightBg);
  doc.setDrawColor(...colors.borderGray);
  doc.roundedRect(margin, y, contentWidth, 32, 3, 3, 'FD');

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...colors.darkSlate);
  doc.text("ARKOO PREBUILD INTELLIGENCE", margin + 6, y + 10);

  doc.setFontSize(11);
  doc.setTextColor(...colors.brandOrange);
  doc.text("Complete Application Architecture, Module Functionality & RBAC Guide", margin + 6, y + 17);

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...colors.mutedSlate);
  doc.text("AI-Powered Meeting Transcriptions, Multi-Stakeholder Task Workflow & Role-Based Access Control System", margin + 6, y + 25);

  y += 38;

  // Section 1: Executive Overview
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...colors.primaryBlue);
  doc.text("1. Executive Overview & System Architecture", margin, y);
  doc.setDrawColor(...colors.primaryBlue);
  doc.line(margin, y + 1.5, margin + 85, y + 1.5);

  y += 7;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);

  const overviewText = [
    "Arkoo Prebuild Intelligence is a state-of-the-art enterprise resource management and intelligence platform. " +
    "The application integrates real-time browser audio recording, Gemini / OpenAI AI transcriptions, automatic task extraction, " +
    "and strict Administrator-Controlled Role-Based Access Control (RBAC).",
    "",
    "Key Architectural Highlights:",
    "• Single-Page Application (React 19 + TypeScript + Vite + TailwindCSS)",
    "• Backend Server & Express Middleware (tsx server.ts)",
    "• Cloud Database: Google Firebase Firestore (Master Stakeholders, Meetings, Tasks, Settings, Audit Logs)",
    "• Security & Authentication: Google OAuth2 via Firebase Auth with zero self-registration (Admin pre-approval required)",
    "• Integration Services: Persistent Google Drive Cloud Backup, Groq & NVIDIA AI Inference, Gmail SMTP Notifications"
  ];

  overviewText.forEach(line => {
    checkPageBreak(5);
    if (line.startsWith("•")) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...colors.darkSlate);
      doc.text(line, margin + 4, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(40, 40, 40);
    } else {
      doc.text(line, margin, y, { maxWidth: contentWidth });
    }
    y += line === "" ? 3 : 5.5;
  });

  y += 4;

  // Section 2: Detailed Tab-by-Tab Breakdown
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...colors.primaryBlue);
  doc.text("2. Complete Module & Tab-by-Tab Functionality", margin, y);
  doc.setDrawColor(...colors.primaryBlue);
  doc.line(margin, y + 1.5, margin + 95, y + 1.5);

  y += 8;

  const modules = [
    {
      title: "Tab 1: Dashboard (/dashboard)",
      roles: "Admin, Manager, Employee, Vendor, Supplier, Other",
      color: colors.primaryBlue,
      desc: "Centralized operational overview displaying real-time metrics, system health, and task analytics.",
      features: [
        "Metrics Cards: Total Tasks, Active Meetings, Registered Stakeholders, and Pending Requests.",
        "Priority & Status Breakdown: Visual charts categorizing tasks into Low, Medium, High, Critical priorities and Pending, In-Progress, Completed states.",
        "Real-Time Activity Timeline: Instant stream of system activities including newly created tasks, meeting uploads, and status changes.",
        "Stakeholder Distribution Tally: Breakdown of active users categorized into Employees, Managers, Vendors, and Suppliers."
      ]
    },
    {
      title: "Tab 2: Meetings (/meetings)",
      roles: "Admin, Manager, Employee, Vendor, Supplier",
      color: colors.purpleHeader,
      desc: "Repository of processed audio meeting recordings, AI summaries, and automated action item extraction.",
      features: [
        "Audio Transcripts: Full word-for-word text transcription generated via OpenAI Whisper & Gemini AI.",
        "Key Takeaways & Summaries: AI-generated executive summaries highlighting decisions made during meetings.",
        "Automated Action Items: AI automatically detects task commitments from spoken dialogue and prompts one-click task creation.",
        "Search & Filtering: Instant filter by meeting title, status (recording, processing, completed), or date range."
      ]
    },
    {
      title: "Tab 3: Record Meeting (/record-meeting)",
      roles: "Admin, Manager Only",
      color: colors.brandOrange,
      desc: "Interactive audio recording workspace for capturing live discussions or uploading pre-recorded audio files.",
      features: [
        "Browser Microphone Capture: Real-time audio recording with live waveform frequency visualization.",
        "Audio File Upload: Supports uploading audio files (.mp3, .wav, .m4a, .webm) up to 100MB.",
        "Background Processing Pipeline: Automatic ingestion -> Speech-to-Text conversion -> Gemini Key Takeaways parsing -> Firestore sync.",
        "Restricted Access: Strictly hidden and blocked for non-management roles to ensure meeting confidentiality."
      ]
    },
    {
      title: "Tab 4: Tasks (/tasks)",
      roles: "Admin, Manager, Employee, Vendor, Supplier, Other",
      color: colors.emeraldGreen,
      desc: "Comprehensive multi-stakeholder task management system supporting Kanban and List view modes.",
      features: [
        "Kanban & List Views: Drag-and-drop task workflow management across Pending, In-Progress, and Completed columns.",
        "Rich Task Details: Title, detailed description, priority (Low/Med/High/Critical), department, assigned employee/vendor, and due date.",
        "Subtasks Checklist: Breakdown of complex tasks into individual checkable sub-action items.",
        "Voice Notes & Activity Threads: Stakeholders can attach voice recordings, comments, and file attachments directly to tasks.",
        "Comprehensive Filters: Filter tasks by assigned stakeholder, priority, department, status, or due horizon (overdue, today, this week)."
      ]
    }
  ];

  modules.forEach(mod => {
    checkPageBreak(38);

    doc.setFillColor(...colors.lightBg);
    doc.setDrawColor(...colors.borderGray);
    doc.roundedRect(margin, y, contentWidth, 6, 1.5, 1.5, 'FD');

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...mod.color);
    doc.text(mod.title, margin + 3, y + 4.2);

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.darkSlate);
    doc.text(`[ Visible to: ${mod.roles} ]`, pageWidth - margin - 3, y + 4.2, { align: "right" });

    y += 8;

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...colors.mutedSlate);
    doc.text(mod.desc, margin + 2, y);

    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    mod.features.forEach(feat => {
      checkPageBreak(5);
      doc.text(`• ${feat}`, margin + 4, y, { maxWidth: contentWidth - 6 });
      y += 4.5;
    });

    y += 3;
  });

  // --- PAGE 2: CONTINUED MODULES & RBAC MATRIX ---
  doc.addPage();
  currentPage++;
  addHeaderFooter(currentPage);
  y = 20;

  const remainingModules = [
    {
      title: "Tab 5: Stakeholders / Master Directory (/employees)",
      roles: "Admin, Manager, Employee",
      color: colors.primaryBlue,
      desc: "Master directory for managing internal personnel and external vendor/supplier relationships.",
      features: [
        "Master Employee List: Full profiles including Official Email, Personal Email, Department, Phone, Blood Group, Emergency Contact.",
        "Stakeholder Types: Categorization into Employee, Manager, Vendor, Supplier, or Other.",
        "Approval Status Lifecycle: Pending Approval, Active, and Rejected states.",
        "Admin Invitation System: Triggers automated SMTP invitation email with sign-in instructions upon approval.",
        "Status Management: Admins can activate, deactivate, approve, or delete stakeholder records."
      ]
    },
    {
      title: "Tab 6: Role Management (/role-management)",
      roles: "Admin Only",
      color: colors.purpleHeader,
      desc: "Granular Role-Based Access Control (RBAC) engine for defining custom roles and feature permissions.",
      features: [
        "Permission Matrix: Toggle feature access across Dashboard, Meetings, Record Meeting, Tasks, Employees, Settings, and Recycle Bin.",
        "Custom Role Creation: Create new organizational roles tailored to specific company hierarchies.",
        "Two-Stage Deletion Guardrails: Stage 1 soft-delete warning and Stage 2 confirmation to prevent accidental loss of role definitions.",
        "System Default Safeguards: Default roles (Admin, Manager, Employee, Vendor, Supplier) are locked to preserve system integrity."
      ]
    },
    {
      title: "Tab 7: Settings (/settings)",
      roles: "Admin Only",
      color: colors.brandOrange,
      desc: "System-wide administrative configuration center for external integrations and AI providers.",
      features: [
        "Google Drive Integration: Connect persistent Google Drive OAuth credentials for cloud storage of meeting audio & task attachments.",
        "AI Provider Configuration: Configure API keys and model parameters for Groq AI (Llama 3.3) and NVIDIA NIM endpoints.",
        "Stakeholder Options: Add/remove custom stakeholder dropdown options and department tags.",
        "Notification Preferences: Configure SMTP email notification rules and system alerts."
      ]
    },
    {
      title: "Tab 8: Recycle Bin (/recycle-bin)",
      roles: "Admin Only",
      color: colors.mutedSlate,
      desc: "Safety buffer holding soft-deleted tasks, meetings, and stakeholder records.",
      features: [
        "Restore Capability: Instantly restore soft-deleted items back to active status without data loss.",
        "Permanent Purge: Admins can permanently delete items to clean up database storage.",
        "Audit Tracking: Tracks deletion timestamp and performing user ID."
      ]
    }
  ];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...colors.primaryBlue);
  doc.text("2. Complete Module Breakdown (Continued)", margin, y);
  doc.setDrawColor(...colors.primaryBlue);
  doc.line(margin, y + 1.5, margin + 80, y + 1.5);

  y += 7;

  remainingModules.forEach(mod => {
    checkPageBreak(35);

    doc.setFillColor(...colors.lightBg);
    doc.setDrawColor(...colors.borderGray);
    doc.roundedRect(margin, y, contentWidth, 6, 1.5, 1.5, 'FD');

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...mod.color);
    doc.text(mod.title, margin + 3, y + 4.2);

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.darkSlate);
    doc.text(`[ Visible to: ${mod.roles} ]`, pageWidth - margin - 3, y + 4.2, { align: "right" });

    y += 8;

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...colors.mutedSlate);
    doc.text(mod.desc, margin + 2, y);

    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    mod.features.forEach(feat => {
      checkPageBreak(5);
      doc.text(`• ${feat}`, margin + 4, y, { maxWidth: contentWidth - 6 });
      y += 4.5;
    });

    y += 3;
  });

  y += 4;

  // --- PAGE 3: ROLE-BASED ACCESS CONTROL (RBAC) MATRIX TABLE ---
  doc.addPage();
  currentPage++;
  addHeaderFooter(currentPage);
  y = 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...colors.primaryBlue);
  doc.text("3. Role-Based Access Control (RBAC) Master Matrix", margin, y);
  doc.setDrawColor(...colors.primaryBlue);
  doc.line(margin, y + 1.5, margin + 95, y + 1.5);

  y += 7;

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(60, 60, 60);
  doc.text("The table below details exact feature permissions, tab visibility, and action capabilities for every assigned role in the system:", margin, y);

  y += 6;

  // Table Setup
  const headers = ["Feature / Action", "Admin", "Manager", "Employee", "Vendor", "Supplier", "Other"];
  const colWidths = [52, 21, 22, 22, 21, 22, 22]; // Total = 182

  function drawTableHeader() {
    doc.setFillColor(...colors.darkSlate);
    doc.rect(margin, y, contentWidth, 7, 'F');

    let x = margin;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...colors.white);

    headers.forEach((h, idx) => {
      const align = idx === 0 ? "left" : "center";
      const posX = idx === 0 ? x + 2 : x + colWidths[idx] / 2;
      doc.text(h, posX, y + 4.8, { align });
      x += colWidths[idx];
    });

    y += 7;
  }

  drawTableHeader();

  const rbacData = [
    ["View Dashboard (/dashboard)", "FULL", "FULL", "FULL", "FULL", "FULL", "LIMITED"],
    ["View Meetings List (/meetings)", "FULL", "FULL", "FULL", "SHARED", "SHARED", "NONE"],
    ["Record & Process Audio Meeting", "FULL", "FULL", "NONE", "NONE", "NONE", "NONE"],
    ["View Tasks List (/tasks)", "ALL TASKS", "ALL TASKS", "ASSIGNED", "ASSIGNED", "ASSIGNED", "ASSIGNED"],
    ["Create & Assign Tasks", "FULL", "FULL", "FULL", "SELF/DEPT", "SELF/DEPT", "NONE"],
    ["Delete Tasks & Voice Notes", "FULL", "FULL", "OWN ONLY", "NONE", "NONE", "NONE"],
    ["Add Task Voice Notes & Comments", "FULL", "FULL", "FULL", "FULL", "FULL", "NONE"],
    ["View Stakeholders Directory", "FULL", "FULL", "FULL", "NONE", "NONE", "NONE"],
    ["Add / Edit Stakeholder Profile", "FULL", "FULL", "SELF ONLY", "NONE", "NONE", "NONE"],
    ["Approve / Reject Stakeholder", "FULL", "FULL", "NONE", "NONE", "NONE", "NONE"],
    ["Manage System Settings", "FULL", "NONE", "NONE", "NONE", "NONE", "NONE"],
    ["Manage Roles & Permissions", "FULL", "NONE", "NONE", "NONE", "NONE", "NONE"],
    ["Recycle Bin Recovery & Purge", "FULL", "NONE", "NONE", "NONE", "NONE", "NONE"]
  ];

  rbacData.forEach((row, rowIdx) => {
    checkPageBreak(7);

    if (rowIdx % 2 === 1) {
      doc.setFillColor(...colors.lightBg);
      doc.rect(margin, y, contentWidth, 6.5, 'F');
    }

    doc.setDrawColor(...colors.borderGray);
    doc.line(margin, y + 6.5, margin + contentWidth, y + 6.5);

    let x = margin;
    doc.setFontSize(7.5);

    row.forEach((cell, colIdx) => {
      if (colIdx === 0) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...colors.darkSlate);
        doc.text(cell, x + 2, y + 4.3);
      } else {
        doc.setFont("helvetica", "normal");
        if (cell === "FULL" || cell === "ALL TASKS") {
          doc.setTextColor(16, 185, 129); // Green
        } else if (cell === "NONE") {
          doc.setTextColor(239, 68, 68); // Red
        } else if (cell === "LIMITED" || cell === "SHARED" || cell === "SELF ONLY" || cell === "OWN ONLY" || cell === "SELF/DEPT") {
          doc.setTextColor(217, 119, 6); // Amber
        } else {
          doc.setTextColor(37, 99, 235); // Blue
        }
        doc.text(cell, x + colWidths[colIdx] / 2, y + 4.3, { align: "center" });
      }
      x += colWidths[colIdx];
    });

    y += 6.5;
  });

  y += 8;

  // Section 4: Security & Authentication Rules
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...colors.primaryBlue);
  doc.text("4. Security Rules & Self-Registration Governance", margin, y);
  doc.setDrawColor(...colors.primaryBlue);
  doc.line(margin, y + 1.5, margin + 95, y + 1.5);

  y += 7;

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);

  const securityNotes = [
    "• Self-Registration Disabled: Public sign-ups are strictly forbidden. Users attempting to sign in with Google whose email addresses are not pre-added to the Firestore Employees Master Directory will be rejected immediately with an Access Denied message.",
    "• System Super Admin Override: Hardcoded dedicated addresses (e.g., admin@arkooprebuild.com, anushakanna19@gmail.com) bypass directory verification to guarantee emergency administrative recovery.",
    "• Stakeholder Approval Workflow: When a new stakeholder is added, their status defaults to 'Pending' or 'Active'. Pending users cannot access any app modules until an Admin or Manager sets their status to 'Active'.",
    "• Firestore Security Rules Enforcement: All read/write operations on meetings, tasks, and settings are validated server-side by firestore.rules to prevent client-side authorization bypass."
  ];

  securityNotes.forEach(note => {
    checkPageBreak(8);
    doc.text(note, margin, y, { maxWidth: contentWidth });
    y += 7;
  });

  // Save PDF file
  const outputPath = path.join(process.cwd(), "Arkoo_Prebuild_Application_Documentation.pdf");
  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  fs.writeFileSync(outputPath, pdfBuffer);

  console.log("PDF generated successfully at:", outputPath);
  return outputPath;
}

createDocumentationPDF();
