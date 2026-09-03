// ─── Meeting Detail Component ───────────────────────────────
// Extracted from MeetingModule.tsx — zero behavior changes.
// The full meeting detail view with MOM, transcript, audio, tasks, AI chat.

import { useState, useEffect } from 'react';
import {
  collection,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  serverTimestamp
} from 'firebase/firestore';
import { doc as firestoreDoc } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { getApiUrl } from '@/lib/api';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { formatDeadlineDisplay } from '@/lib/date-utils';
import {
  Download,
  Trash2,
  User,
  AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { jsPDF } from 'jspdf';

// Import extracted sub-components
import { MeetingAudioPlayer } from './MeetingAudioPlayer';
import { MeetingTasksSidebar } from './MeetingTasksSidebar';
import { MeetingTasksTable } from './MeetingTasksTable';
import { MeetingSummaryStats } from './MeetingSummaryStats';
import { resolveHostName } from './utils';

export function MeetingDetail({ meeting, onBack, onDelete, profile, employees = [] }: { meeting: any, onBack: () => void, onDelete: (id: string) => void, profile?: any, employees?: any[] }) {
  const userRole = String(profile?.role || 'employee').toLowerCase();
  const isAdminOrManager = ['admin', 'manager'].includes(userRole);
  const [activeTab, setActiveTab] = useState<'mom' | 'transcript' | 'tasks' | 'ask'>('mom');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [retryingUpload, setRetryingUpload] = useState(false);
  const [currentMeeting, setCurrentMeeting] = useState(meeting);
  const [isEditingHost, setIsEditingHost] = useState(false);
  const [customHostInput, setCustomHostInput] = useState('');

  useEffect(() => {
    setCurrentMeeting(meeting);
  }, [meeting]);

  const handleSaveHostNameDetail = async (newHost: string) => {
    const trimmed = newHost.trim();
    if (!trimmed) return;
    try {
      await updateDoc(doc(db, 'meetings', currentMeeting.id), {
        hostName: trimmed,
        createdBy: trimmed,
        updatedAt: serverTimestamp()
      });
      setCurrentMeeting((prev: any) => ({
        ...prev,
        hostName: trimmed,
        createdBy: trimmed
      }));
      toast.success(`Meeting host updated to "${trimmed}"`);
      setIsEditingHost(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `meetings/${currentMeeting.id}`);
      toast.error('Failed to update meeting host');
    }
  };

  const handleLocalRetryUpload = async () => {
    setRetryingUpload(true);
    const retryToast = toast.loading("Initiating secure backup upload retry to Google Drive...");
    try {
      const res = await fetch(getApiUrl(`/api/meetings/${currentMeeting.id}/retry-drive-upload`), {
        method: 'POST'
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to retry upload.");
      }
      const data = await res.json();
      toast.success("Google Drive upload completed successfully!", { id: retryToast });
      
      setCurrentMeeting((prev: any) => ({
        ...prev,
        gdriveUploadStatus: 'completed',
        driveFileId: data.driveFileId,
        driveFileUrl: data.driveFileUrl,
      }));
    } catch (err: any) {
      toast.error(`Retry upload failed: ${err.message}`, { id: retryToast });
    } finally {
      setRetryingUpload(false);
    }
  };

  const handleDownloadReport = async () => {
    if (isGeneratingReport) return;
    setIsGeneratingReport(true);
    const loadingToast = toast.loading("Assembling executive intelligence report...");

    try {
      // 1. Fetch live tasks associated with this meeting
      const tasksQ = query(collection(db, 'tasks'), where('meetingId', '==', meeting.id));
      const tasksSnap = await getDocs(tasksQ);
      const meetingTasks = tasksSnap.docs.map(d => d.data());

      // 2. Initialize jsPDF
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
      const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2); // 170mm

      let y = 25; // tracking y coordinate

      // Fetch logo as base64 for PDF
      let logoBase64: string | null = null;
      try {
        const resLogo = await fetch('/arkoo_logo.png');
        if (resLogo.ok) {
          const blobLogo = await resLogo.blob();
          logoBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blobLogo);
          });
        }
      } catch (err) {
        console.warn("Failed to load logo for PDF", err);
      }

      // Helper to add clean headers on every page except page 1
      const addTableHeader = (document: jsPDF, pageNum: number) => {
        document.setFont("helvetica", "normal");
        document.setFontSize(8);
        document.setTextColor(150, 150, 150);
        document.text("Arkoo Prebuild Pvt. Ltd. | AI Meeting Intelligence Report", margin, 12);
        document.text(`Page ${pageNum}`, pageWidth - margin - 15, 12);
        document.setDrawColor(230, 230, 230);
        document.setLineWidth(0.2);
        document.line(margin, 14, pageWidth - margin, 14);
      };

      // Helper to print auto-wrapped blocks of text with page-breaking
      const printBlock = (text: string, isBold = false, fontSize = 10, offsetAfter = 6, fontStyle = "normal") => {
        const applyFontState = () => {
          doc.setFont("helvetica", fontStyle);
          if (isBold) {
            doc.setFont("helvetica", "bold");
          }
          doc.setFontSize(fontSize);
          doc.setTextColor(51, 65, 85); // Slate gray body
        };
        applyFontState();
        
        const paragraphs = text.split('\n');
        for (const para of paragraphs) {
          if (para.trim() === '') {
            y += 3; // Space for empty lines
            continue;
          }
          
          const lines = doc.splitTextToSize(para, contentWidth);
          for (const line of lines) {
            if (y > 275) {
              doc.addPage();
              y = 25;
              addTableHeader(doc, doc.internal.pages.length - 1);
              applyFontState(); // Restore state after header overrides it
            }
            doc.text(line, margin, y);
            y += 5.5; // Line height
          }
          y += 2; // Extra space after each paragraph block
        }
        y += offsetAfter;
      };

      // Helper to print section titles
      const printSectionHeader = (title: string) => {
        if (y > 250) {
          doc.addPage();
          y = 25;
          addTableHeader(doc, doc.internal.pages.length - 1);
        }
        y += 4;
        doc.setDrawColor(30, 58, 138); // Deep Blue line
        doc.setLineWidth(0.6);
        doc.line(margin, y, pageWidth - margin, y);
        y += 6;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(30, 58, 138); // Deep Blue
        doc.text(title.toUpperCase(), margin, y);
        y += 8;
      };

      // --- PAGE 1: COVER HEADER ---
      // Accent bar top
      doc.setFillColor(30, 58, 138); // Deep Blue
      doc.rect(0, 0, pageWidth, 8, "F");

      // Company Brand
      if (logoBase64) {
        doc.addImage(logoBase64, "PNG", margin, y - 5, 45, 11);
        y += 12;
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(234, 88, 12); // Brand Orange
        doc.text("ARKOO PREBUILD PVT. LTD.", margin, y);
        y += 7;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text("AI MEETING INTELLIGENCE REPORT", margin, y);
      y += 6;

      // Draw horizontal separator
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(0.4);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      // Metadata card grid
      doc.setFillColor(248, 250, 252); // slate-50 background

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      
      let meetingDateStr = "Unknown Date";
      if (meeting.createdAt) {
        meetingDateStr = meeting.createdAt.toDate ? format(meeting.createdAt.toDate(), 'PPP p') : format(new Date(meeting.createdAt), 'PPP p');
      }

      const hostName = resolveHostName(meeting, employees, profile);
      
      let allParticipants: string[] = [];
      if (meeting.participants && Array.isArray(meeting.participants)) {
        allParticipants = meeting.participants.filter((p: string) => 
          p.toLowerCase() !== hostName.toLowerCase() && 
          p.toLowerCase() !== `${hostName} (host)`.toLowerCase()
        );
      }
      
      allParticipants.push(`${hostName} (Host)`);
      const totalPersons = allParticipants.length;
      const participantsList = `${allParticipants.join(", ")} (${totalPersons} Total Person${totalPersons > 1 ? 's' : ''})`;

      const titleLines = doc.splitTextToSize(`Meeting Title: ${meeting.title || 'Untitled Meeting'}`, contentWidth - 10);
      const participantsLines = doc.splitTextToSize(`Participants: ${participantsList}`, contentWidth - 10);

      let textY = y + 8;
      const titleOffset = (titleLines.length * 5) + 3;
      const participantsOffset = (participantsLines.length * 5) + 3;
      
      const boxHeight = 8 + titleOffset + 8 + 8 + participantsOffset;

      doc.rect(margin, y, contentWidth, boxHeight, "F");
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.rect(margin, y, contentWidth, boxHeight, "S");

      doc.text(titleLines, margin + 5, textY);
      textY += titleOffset;

      doc.text(`Date & Time: ${meetingDateStr}`, margin + 5, textY);
      textY += 8;

      doc.text(`Duration: ${meeting.duration || '15 mins'} (Voice Captured)`, margin + 5, textY);
      textY += 8;

      doc.text(participantsLines, margin + 5, textY);
      
      y += boxHeight + 10;

      // Helper to handle characters that jsPDF's built-in Helvetica cannot render
      const sanitizeForPdf = (text: string, isTranscript = false) => {
        if (!text) return "";
        const hasDevanagari = /[\u0900-\u097F]/.test(text);
        
        if (isTranscript && hasDevanagari) {
          return "[ The original transcript contains local language text (Hindi/Marathi) which cannot be rendered in this PDF format. Please view the full transcript in the web dashboard. ]";
        }
        
        let sanitized = text.replace(/•/g, "-");
        sanitized = sanitized.replace(/[^\x00-\x7F]+/g, " ");
        sanitized = sanitized.replace(/[ \t]+/g, " ").trim();
        
        return sanitized;
      };

      // Executive Summary Section
      printSectionHeader("Executive Summary");
      printBlock(sanitizeForPdf(meeting.summary || "No summary was generated during analytical collection."), false, 10, 6, "normal");

      // Minutes of Meeting (MOM) Section
      printSectionHeader("Minutes of Meeting (MOM)");
      
      let rawMomStr = "No MOM is available.";
      if (meeting.momText) {
        rawMomStr = meeting.momText;
      } else if (typeof meeting.mom === 'string') {
        rawMomStr = meeting.mom;
      } else if (meeting.mom && typeof meeting.mom === 'object') {
        const m = meeting.mom;
        const agenda = m.agenda && m.agenda.length ? `Agenda:\n• ${m.agenda.join("\n• ")}\n\n` : "";
        const discussions = m.discussionPoints && m.discussionPoints.length 
          ? `Discussion Points:\n` + m.discussionPoints.map((dp: any) => `• ${dp.topic}: ${dp.summary}`).join("\n") + `\n\n`
          : "";
        const decisions = m.keyDecisions && m.keyDecisions.length ? `Key Decisions:\n• ${m.keyDecisions.join("\n• ")}\n\n` : "";
        const risks = m.risks && m.risks.length ? `Risks:\n• ${m.risks.join("\n• ")}\n\n` : "";
        const nextSteps = m.nextSteps && m.nextSteps.length ? `Next Steps:\n• ${m.nextSteps.join("\n• ")}\n\n` : "";
        rawMomStr = agenda + discussions + decisions + risks + nextSteps;
      }

      const rawMom = rawMomStr
        .replace(/### (.*)/g, "\n$1\n")
        .replace(/## (.*)/g, "\n$1\n")
        .replace(/# (.*)/g, "\n$1\n")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1");
      
      printBlock(sanitizeForPdf(rawMom), false, 9.5, 10);

      // Task Allocation Section
      printSectionHeader("Action Item & Task Allocation");

      if (meetingTasks.length > 0) {
        meetingTasks.forEach((task: any, idx: number) => {
          const descText = task.description || 'No detailed instructions provided.';
          const instructionLines = doc.splitTextToSize(`Instruction: ${sanitizeForPdf(descText)}`, contentWidth - 8);
          
          const boxHeight = 20 + (instructionLines.length * 4.5);
          
          if (y + boxHeight > 275) {
            doc.addPage();
            y = 25;
            addTableHeader(doc, doc.internal.pages.length - 1);
          }
          
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y, contentWidth, boxHeight, "F");
          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.2);
          doc.rect(margin, y, contentWidth, boxHeight, "S");
          
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(30, 58, 138);
          doc.text(`${idx + 1}. [${String(task.priority || 'medium').toUpperCase()}] ${task.title || 'Untitled Task'}`, margin + 4, y + 6);
          
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.5);
          doc.setTextColor(71, 85, 105);
          doc.text(`Assignee: ${task.assigneeName || 'Unassigned'} | Department: ${task.department || 'General'} | Deadline: ${formatDeadlineDisplay(task.deadline)}`, margin + 4, y + 12);
          
          let lineY = y + 18;
          for (const line of instructionLines) {
            doc.text(line, margin + 4, lineY);
            lineY += 4.5;
          }
          
          y += boxHeight + 4;
        });
      } else {
        printBlock("No dedicated action items or structured tasks were extracted from this conversation.", false, 10, 6, "italic");
      }

      // Full Transcript Section
      printSectionHeader("Full Meeting Transcript");
      
      const transcriptText = sanitizeForPdf(meeting.transcript || "No visual transcript data was available.", true);
      printBlock(transcriptText, false, 9, 8);

      // Footer brand signature
      if (y > 260) {
        doc.addPage();
        y = 25;
        addTableHeader(doc, doc.internal.pages.length - 1);
      }
      y += 5;
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text("Generated automatically by Arkoo Meeting Intelligence AI Platform. End of security document.", margin, y);

      // 3. Save draft to browser
      const filename = `Arkoo_Report_${meeting.id}.pdf`;
      doc.save(filename);
      toast.success("Professional executive report downloaded successfully!", { id: loadingToast });

      // 4. Secure upload back to Firebase Storage
      try {
        const pdfBlob = doc.output("blob");
        const dateStr = format(new Date(), 'yyyy-MM-dd');
        const pdfPath = `reports/${dateStr}/report_${meeting.id}_${Date.now()}.pdf`;
        const storageRef = ref(storage, pdfPath);
        
        uploadBytes(storageRef, pdfBlob).then(async (uploadSnapshot) => {
          const pdfUrl = await getDownloadURL(uploadSnapshot.ref);
          console.log("Successfully uploaded PDF report to Firebase Storage:", pdfUrl);
          toast.success("Synchronized secure PDF backup to cloud storage!");
          
          meeting.pdfUrl = pdfUrl;
          try {
            await updateDoc(firestoreDoc(db, "meetings", meeting.id), { pdfUrl: pdfUrl });
          } catch (dbErr) {
            console.warn("pdfUrl update failed on client side:", dbErr);
          }
        }).catch(err => {
          console.error("Error uploading report PDF to Firebase Storage in background:", err);
        });
        
      } catch (pdfUploadErr: any) {
        console.error("Error preparing report PDF upload:", pdfUploadErr);
      }

    } catch (err: any) {
      console.error("Report PDF compilation failed:", err);
      toast.error(`Report generation failed: ${err.message || 'Unknown error'}`, { id: loadingToast });
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // Parse structured MOM - support both new object format and legacy text
  const momData = currentMeeting.mom && typeof currentMeeting.mom === 'object' 
    ? currentMeeting.mom 
    : null;
  const legacyMomText = currentMeeting.momText || (typeof currentMeeting.mom === 'string' ? currentMeeting.mom : null);

  const participants: string[] = momData?.participants || [];
  const agenda: string[] = momData?.agenda || [];
  const discussionPoints: Array<{ topic: string; summary: string; points: string[] }> = momData?.discussionPoints || [];
  const keyDecisions: string[] = momData?.keyDecisions || [];
  const risks: string[] = momData?.risks || [];
  const nextSteps: string[] = momData?.nextSteps || [];

  const formattedDateStr = currentMeeting.createdAt?.toDate 
    ? format(currentMeeting.createdAt.toDate(), 'MMM d, yyyy, hh:mm a') 
    : 'Jul 21, 2026, 12:57 PM';

  const momDateStr = currentMeeting.createdAt?.toDate 
    ? format(currentMeeting.createdAt.toDate(), 'dd/MM/yyyy') 
    : '21/07/2026';

  const momTimeStr = currentMeeting.createdAt?.toDate 
    ? format(currentMeeting.createdAt.toDate(), 'hh:mm a') 
    : '12:00 PM';

  const hostName = resolveHostName(currentMeeting, employees, profile);

  const displayParticipants: string[] = participants.length > 0
    ? participants
    : hostName ? [hostName] : [];

  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-20 font-sans">
      {/* Navigation Header */}
      <div className="flex items-center justify-between">
        <button 
          onClick={onBack} 
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <span className="text-base">←</span> Back
        </button>

        <Button 
          variant="outline"
          onClick={handleDownloadReport}
          disabled={isGeneratingReport}
          className="h-9 rounded-xl px-4 border-slate-200 text-slate-700 font-semibold text-xs bg-white shadow-sm hover:bg-slate-50 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 mr-2 text-slate-500" /> Export to Drive
        </Button>
      </div>

      {/* Main Title & Status Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">{currentMeeting.title}</h1>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span>{formattedDateStr}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            <span className="text-emerald-600 font-semibold">Audio recorded</span>
          </div>
        </div>
        {currentMeeting.status === 'processing' ? (
          <span className="px-4 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-100 flex items-center gap-1.5">
            <span className="animate-spin h-2.5 w-2.5 border-2 border-amber-600 border-t-transparent rounded-full" /> Processing
          </span>
        ) : (
          <span className="px-4 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
            Completed
          </span>
        )}
      </div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* LEFT: Main Content */}
        <div className="lg:col-span-2 space-y-4">

          {/* Participants (top) */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 text-slate-800 font-bold text-sm mb-3">
              <User className="w-4 h-4 text-blue-500" />
              Participants ({displayParticipants.length})
            </div>
            {displayParticipants.length === 0 ? (
              <p className="text-xs text-slate-400 font-medium">No attendees recorded</p>
            ) : (
              <p className="text-xs text-slate-500 font-medium">
                {displayParticipants.join(', ')}
              </p>
            )}
          </div>

          {/* Minutes of Meeting (MOM) */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-5">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-base border-b border-slate-100 pb-4">
              <div className="w-6 h-6 rounded-lg bg-blue-100/70 text-blue-500 flex items-center justify-center text-sm">📄</div>
              Minutes of Meeting (MOM)
            </div>

            {/* MOM Meta Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-0 bg-slate-50/80 rounded-xl border border-slate-100 sm:divide-x divide-slate-100 overflow-hidden p-2 sm:p-0">
              <div className="p-3 sm:p-4 space-y-1 bg-white sm:bg-transparent rounded-lg sm:rounded-none border sm:border-0 border-slate-100">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider"># TITLE</div>
                <div className="text-xs sm:text-sm font-bold text-slate-900 truncate">{currentMeeting.title}</div>
              </div>
              <div className="p-3 sm:p-4 space-y-1 bg-white sm:bg-transparent rounded-lg sm:rounded-none border sm:border-0 border-slate-100">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">📅 DATE</div>
                <div className="text-xs sm:text-sm font-bold text-slate-900">{momDateStr}</div>
              </div>
              <div className="p-3 sm:p-4 space-y-1 bg-white sm:bg-transparent rounded-lg sm:rounded-none border sm:border-0 border-slate-100">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">🕐 TIME</div>
                <div className="text-xs sm:text-sm font-bold text-slate-900">{momTimeStr}</div>
              </div>
              <div className="p-3 sm:p-4 space-y-1 bg-white sm:bg-transparent rounded-lg sm:rounded-none border sm:border-0 border-slate-100 relative group">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>👤 MEETING HOST</span>
                  {!isEditingHost && (
                    <button 
                      onClick={() => {
                        setIsEditingHost(true);
                        setCustomHostInput(hostName);
                      }}
                      className="text-[10px] text-blue-600 hover:underline font-semibold"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {isEditingHost ? (
                  <div className="flex flex-col gap-1 mt-1">
                    <input
                      type="text"
                      value={customHostInput}
                      onChange={(e) => setCustomHostInput(e.target.value)}
                      placeholder="Enter host name..."
                      className="text-xs bg-white border border-blue-400 rounded px-2 py-1 text-slate-900 font-semibold focus:ring-1 focus:ring-blue-500 outline-none w-full"
                    />
                    {employees.length > 0 && (
                      <select
                        onChange={(e) => {
                          if (e.target.value) setCustomHostInput(e.target.value);
                        }}
                        className="text-[11px] bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-slate-700 outline-none w-full"
                      >
                        <option value="">Choose from directory...</option>
                        {employees.map(e => (
                          <option key={e.id} value={e.fullName}>{e.fullName}</option>
                        ))}
                      </select>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      <button
                        onClick={() => handleSaveHostNameDetail(customHostInput)}
                        className="text-[11px] bg-blue-600 text-white px-2 py-0.5 rounded font-bold hover:bg-blue-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setIsEditingHost(false)}
                        className="text-[11px] text-slate-500 hover:text-slate-800 px-1"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm font-bold text-slate-900 truncate" title={hostName}>{hostName}</div>
                )}
              </div>
            </div>

            {/* Participants with avatars */}
            {displayParticipants.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                    <User className="w-4 h-4 text-blue-500" /> Participants
                  </div>
                  <span className="text-xs text-slate-400 font-medium">{displayParticipants.length} {displayParticipants.length === 1 ? 'person' : 'people'}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {displayParticipants.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                      <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0">
                        {p.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xs font-semibold text-slate-800">{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Agenda */}
            {agenda.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                  <span className="text-base">📋</span> Agenda
                </div>
                <ol className="space-y-1.5">
                  {agenda.map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <span className="font-medium">{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Discussion Points */}
            {discussionPoints.length > 0 && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                  <span className="text-base">💬</span> Discussion Points
                </div>
                <div className="space-y-4">
                  {discussionPoints.map((dp, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="font-bold text-sm text-slate-900">{dp.topic}</div>
                      {dp.summary && (
                        <div className="text-xs text-blue-500 font-medium italic">{dp.summary}</div>
                      )}
                      <ul className="space-y-1">
                        {(dp.points || []).map((pt, j) => (
                          <li key={j} className="flex items-start gap-2 text-sm text-slate-700">
                            <span className="text-orange-400 mt-1 text-xs">◆</span>
                            <span className="font-medium">{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                {/* Meeting Recording for A — embedded inside Discussion Points */}
                {currentMeeting.audioUrl && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <div className="flex items-center gap-2 text-slate-700 font-semibold text-xs mb-3">
                      <span className="text-sm">🎙️</span>
                      <span className="uppercase tracking-wider">Meeting Recording for A</span>
                    </div>
                    <MeetingAudioPlayer audioUrl={currentMeeting.audioUrl} title={currentMeeting.title} meetingId={currentMeeting.id} />
                  </div>
                )}
              </div>
            )}

            {/* Key Decisions */}
            {keyDecisions.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                  <span className="text-base">🔑</span> Key Decisions
                </div>
                <ul className="space-y-1.5">
                  {keyDecisions.map((d, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">✓</span>
                      <span className="font-medium">{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Risks & Issues */}
            {risks.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                  <AlertCircle className="w-4 h-4 text-amber-500" /> Risks & Issues
                </div>
                <ul className="space-y-1.5">
                  {risks.map((r, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                      <span className="font-medium">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Legacy MOM text fallback */}
            {!momData && legacyMomText && (
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <div className="prose prose-sm max-w-none text-slate-700 whitespace-pre-line text-xs font-medium leading-relaxed bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                  {legacyMomText}
                </div>
              </div>
            )}

            {!momData && !legacyMomText && (
              <div className="text-xs text-slate-400 text-center py-4">
                Minutes of Meeting will appear here after processing completes.
              </div>
            )}
          </div>

          {/* Action Items / Tasks Assigned */}
          <MeetingTasksTable meetingId={currentMeeting.id} status={currentMeeting.status} />

          {/* Next Steps */}
          {nextSteps.length > 0 && (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                <span className="text-base text-blue-500">→</span> Next Steps
              </div>
              <ol className="space-y-1.5">
                {nextSteps.map((step: string, i: number) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    <span className="font-medium">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Summary Stats */}
          <MeetingSummaryStats meetingId={currentMeeting.id} keyDecisions={keyDecisions} participants={displayParticipants} />

          {/* Full Transcript Card */}
          {currentMeeting.transcript && (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                  <div className="w-6 h-6 rounded-lg bg-blue-100/70 text-blue-500 flex items-center justify-center text-xs">💬</div>
                  Full Meeting Transcript
                </div>
                <span className="text-[10px] text-slate-400 font-medium bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg">
                  Word-to-word verbatim · unclear words shown as ....
                </span>
              </div>
              <div className="bg-slate-900 text-slate-200 font-mono text-xs p-4 rounded-xl leading-relaxed whitespace-pre-wrap">
                {currentMeeting.transcript}
              </div>
            </div>
          )}

          {/* Meeting Audio Player — shown standalone only when no discussionPoints exist */}
          {currentMeeting.audioUrl && discussionPoints.length === 0 && (
            <MeetingAudioPlayer audioUrl={currentMeeting.audioUrl} title={currentMeeting.title} meetingId={currentMeeting.id} />
          )}
        </div>

        {/* RIGHT: Tasks Sidebar */}
        <div className="space-y-4">
          <MeetingTasksSidebar meetingId={currentMeeting.id} status={currentMeeting.status} />

          {/* Actions Card */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-2.5">
            <Button 
              onClick={handleDownloadReport}
              disabled={isGeneratingReport}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase text-[10px] tracking-widest shadow-md h-10 rounded-xl cursor-pointer"
              id="download-report-btn"
            >
              {isGeneratingReport ? (
                <span className="flex items-center gap-1"><span className="animate-spin h-3.5 w-3.5 border-b-2 border-white rounded-full inline-block mr-2" /> Generating...</span>
              ) : (
                <><Download className="w-3.5 h-3.5 mr-2" /> Download Report</>
              )}
            </Button>

            {currentMeeting.driveFileUrl && (
              <a 
                href={currentMeeting.driveFileUrl} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="w-full flex items-center justify-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase text-[10px] tracking-widest rounded-xl h-10 transition cursor-pointer text-center"
                id="view-recording-drive-btn"
              >
                🎵 View Recording
              </a>
            )}

            {isAdminOrManager && (
              <Button 
                variant="ghost" 
                className="w-full text-red-600 hover:bg-red-50 hover:text-red-700 font-bold text-[10px] uppercase tracking-widest h-10 rounded-xl"
                onClick={() => onDelete(currentMeeting.id)}
                id="delete-meeting-btn"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Meeting
              </Button>
            )}
          </div>

          {/* Executive Summary */}
          {currentMeeting.summary && (
            <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-5 shadow-sm">
              <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-2">Executive Summary</div>
              <p className="text-xs text-slate-700 leading-relaxed font-medium">{currentMeeting.summary}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
