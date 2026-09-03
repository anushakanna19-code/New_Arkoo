import { useState, useEffect, useRef, useMemo } from 'react';
import Markdown from 'react-markdown';
import { 
  collection, 
  addDoc, 
  setDoc,
  onSnapshot, 
  query, 
  orderBy,
  serverTimestamp,
  updateDoc,
  doc,
  deleteDoc,
  getDocs,
  where,
  Timestamp
} from 'firebase/firestore';
import { doc as firestoreDoc } from 'firebase/firestore';
import { db, auth, storage } from '@/lib/firebase';
import { getApiUrl } from '@/lib/api';
import { saveAudioToLocalCache, getAudioFromLocalCache } from '@/lib/audio-cache';
import { parseRelativeDeadline, formatDeadlineDisplay } from '@/lib/date-utils';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { 
  Mic, 
  Square, 
  Play, 
  Upload, 
  Search, 
  Filter, 
  FileAudio, 
  ChevronRight,
  BrainCircuit,
  MessageSquare,
  ClipboardCheck,
  Download,
  Trash2,
  Clock,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Globe,
  Video,
  User,
  Eye
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { jsPDF } from 'jspdf';
import { LiveAudioVisualizer } from './LiveAudioVisualizer';
import { resolveHostName, formatTime } from './utils';
import { MeetingDetail } from './MeetingDetail';

export { LiveAudioVisualizer, resolveHostName };

export interface MeetingModuleProps {
  profile: any;
  initialView?: 'list' | 'record';
  googleAccessToken?: string | null;
  setGoogleAccessToken?: (token: string | null) => void;
  onGoogleSignIn?: () => void;
  gdriveState?: {
    connected: boolean;
    isOauthConfigured?: boolean;
    userEmail?: string;
    folderId?: string;
    lastSynced?: string | null;
  };
  onDisconnectDrive?: () => void;
  onProcessingFinished?: () => void;
}

export function MeetingModule({ 
  profile, 
  initialView = 'list',
  googleAccessToken = null, 
  setGoogleAccessToken = () => {}, 
  onGoogleSignIn = () => {},
  gdriveState = { connected: false },
  onDisconnectDrive = () => {},
  onProcessingFinished
}: MeetingModuleProps) {
  const [meetings, setMeetings] = useState<any[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [view, setView] = useState<'list' | 'detail'>(initialView === 'record' ? 'list' : 'list');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [progressLabel, setProgressLabel] = useState<string>('');
  const [liveCaptions, setLiveCaptions] = useState<Array<{ index: number; text: string }>>([]);
  const [transcribingStatus, setTranscribingStatus] = useState<'idle' | 'listening' | 'transcribing_live'>('idle');
  const [meetingToDelete, setMeetingToDelete] = useState<string | null>(null);
  const [pastedDriveLink, setPastedDriveLink] = useState('');
  const [isBackupEnabled, setIsBackupEnabled] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [employees, setEmployees] = useState<any[]>([]);
  const [editingHostId, setEditingHostId] = useState<string | null>(null);
  const [customHostInput, setCustomHostInput] = useState<string>('');

  useEffect(() => {
    try {
      const q = query(collection(db, 'employees'), orderBy('fullName', 'asc'));
      const unsubscribe = onSnapshot(q, (snap) => {
        setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, () => {});
      return unsubscribe;
    } catch (e) {
      console.warn('Employees listener error in MeetingModule:', e);
    }
  }, []);

  const getHostName = (m: any) => resolveHostName(m, employees, profile);

  const handleSaveHostName = async (meetingId: string, newHost: string) => {
    const trimmed = newHost.trim();
    if (!trimmed) return;
    try {
      await updateDoc(doc(db, 'meetings', meetingId), {
        hostName: trimmed,
        createdBy: trimmed,
        updatedAt: serverTimestamp()
      });
      toast.success(`Meeting host updated to "${trimmed}"`);
      setEditingHostId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `meetings/${meetingId}`);
      toast.error('Failed to update meeting host');
    }
  };

  const userRole = String(profile?.role || 'employee').toLowerCase();
  const isAdminOrManager = ['admin', 'manager'].includes(userRole);
  const isVendorOrSupplier = userRole === 'vendor' || userRole === 'supplier';

  const handleOpenMeetingDetail = (meetingId: string) => {
    if (isVendorOrSupplier) {
      toast.error("Vendor & Supplier accounts cannot view meeting details.");
      return;
    }
    setSelectedMeetingId(meetingId);
    setView('detail');
  };

  const filteredMeetings = meetings.filter(meeting => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const host = resolveHostName(meeting).toLowerCase();
    return (
      meeting.title?.toLowerCase().includes(q) ||
      meeting.createdBy?.toLowerCase().includes(q) ||
      meeting.hostName?.toLowerCase().includes(q) ||
      host.includes(q)
    );
  });

  // Auto-enable backup when Google Drive is connected centrally or locally
  useEffect(() => {
    const isConn = !!(googleAccessToken || gdriveState?.connected);
    if (isConn) {
      setIsBackupEnabled(true);
    }
  }, [googleAccessToken, gdriveState?.connected]);
  
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioChunks = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const finalDurationRef = useRef<string>('00:00');
  const rawStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<any>(null);

  // References for live chunking transcription
  const chunkTranscriptsRef = useRef<Record<number, string>>({});
  const chunkRecorderRef = useRef<MediaRecorder | null>(null);
  const chunkTimeoutRef = useRef<any>(null);
  const chunkIndexRef = useRef<number>(0);
  const CHUNK_DURATION_SEC = 12;

  const selectedMeeting = meetings.find(m => m.id === selectedMeetingId);

  useEffect(() => {
    let q;
    try {
      q = query(collection(db, 'meetings'), orderBy('createdAt', 'desc'));
    } catch (e) {
      q = collection(db, 'meetings');
    }

    const unsubscribe = onSnapshot(collection(db, 'meetings'), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort client-side safely to prevent missing Firestore index blocks
      // Filter out deleted meetings so they only show in Recycle Bin
      const activeMeetings = data.filter((m: any) => m.status !== 'deleted' && m.isDeleted !== true);
      activeMeetings.sort((a: any, b: any) => {
        const timeA = a.createdAt?.seconds || (typeof a.createdAt?.toDate === 'function' ? a.createdAt.toDate().getTime() / 1000 : 0);
        const timeB = b.createdAt?.seconds || (typeof b.createdAt?.toDate === 'function' ? b.createdAt.toDate().getTime() / 1000 : 0);
        return timeB - timeA;
      });
      setMeetings(activeMeetings);
    }, (error) => {
      console.warn('Firestore meetings listener error, falling back to simple collection fetch:', error);
      handleFirestoreError(error, OperationType.LIST, 'meetings');
    });
    return unsubscribe;
  }, []);

  // Monitor and automatically mark stuck "processing" meetings as Failed after 45 seconds of inactivity
  useEffect(() => {
    const checkInterval = setInterval(async () => {
      const now = Date.now();
      for (const meeting of meetings as any[]) {
        if (meeting.status === 'processing') {
          const createdAtTimestamp = meeting.createdAt;
          if (createdAtTimestamp) {
            let createdMillis = 0;
            if (typeof createdAtTimestamp.toDate === 'function') {
              createdMillis = createdAtTimestamp.toDate().getTime();
            } else if (createdAtTimestamp.seconds) {
              createdMillis = createdAtTimestamp.seconds * 1000;
            } else if (typeof createdAtTimestamp === 'number') {
              createdMillis = createdAtTimestamp;
            }

            if (createdMillis > 0) {
              const ageInSeconds = (now - createdMillis) / 1000;
              // If stuck in processing for more than 180 seconds, transition to failed
              if (ageInSeconds > 180) {
                console.warn(`[Timeout Recovery] Meeting ${meeting.id} has been stuck in 'processing' state for ${ageInSeconds.toFixed(1)}s. Auto-transitioning to Failed.`);
                try {
                  await updateDoc(doc(db, 'meetings', meeting.id), {
                    status: 'failed',
                    failureReason: 'AI generation pipeline timed out (180s)'
                  });
                } catch (err) {
                  console.error('Failed to auto-timeout stuck meeting:', err);
                }
              }
            }
          }
        }
      }
    }, 5000);

    return () => clearInterval(checkInterval);
  }, [meetings]);

  const uploadAndTranscribeChunk = async (blob: Blob, index: number, meetingTempId: string) => {
    try {
      setTranscribingStatus('transcribing_live');
      
      // 1. Convert chunk blob to base64
      const reader = new FileReader();
      const readPromise = new Promise<void>((resolve, reject) => {
        reader.onloadend = () => resolve();
        reader.onerror = () => reject(new Error("FileReader failed for chunk"));
      });
      reader.readAsDataURL(blob);
      await readPromise;
      
      const base64Data = (reader.result as string).split(',')[1];
      if (!base64Data) {
        throw new Error("Empty audio data after base64 transcoding");
      }

      // 2. Fetch chunk transcription API
      const response = await fetch(getApiUrl('/api/transcribe-chunk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chunkBase64: base64Data,
          mimeType: blob.type,
          chunkIndex: index,
          meetingId: meetingTempId,
          knownNames: employees?.map((e: any) => e.fullName).join(", ") || ""
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP Error status: ${response.status}`);
      }

      const resData = await response.json();
      const text = resData.text || '';
      
      console.log(`[Chunker] Received Transcription for Chunk ${index}: "${text}"`);
      
      if (text.trim()) {
        chunkTranscriptsRef.current[index] = text;
        setLiveCaptions(prev => {
          const filtered = prev.filter(c => c.index !== index);
          const newList = [...filtered, { index, text }].sort((a, b) => a.index - b.index);
          return newList;
        });
      }
    } catch (err) {
      console.error(`[Chunker Error] Failed to transcribe chunk ${index}:`, err);
    } finally {
      setTranscribingStatus('listening');
    }
  };

  const startChunking = (stream: MediaStream) => {
    setTranscribingStatus('listening');
    chunkIndexRef.current = 0;
    chunkTranscriptsRef.current = {};
    setLiveCaptions([]);

    const runNextChunkInput = () => {
      // Loop halts if stream is no longer active, or mediaRecorder is inactive/not set
      if (!mediaRecorder.current || mediaRecorder.current.state === 'inactive') {
        console.log('[Chunker] Continuous recording halted, ending live chunk loop.');
        return;
      }

      const currentIdx = chunkIndexRef.current++;
      console.log(`[Chunker] Initiating chunk recorder [Index ${currentIdx}]`);
      
      let chunkRecorder: MediaRecorder | null = null;
      try {
        const chunkMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        chunkRecorder = new MediaRecorder(stream, {
          audioBitsPerSecond: 16000,
          mimeType: chunkMime
        });
        chunkRecorderRef.current = chunkRecorder;
      } catch (rErr) {
        console.error('[Chunker Error] Failed to create secondary chunk recorder:', rErr);
        return;
      }

      const chunkAudioChunks: Blob[] = [];
      
      chunkRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunkAudioChunks.push(ev.data);
        }
      };

      chunkRecorder.onstop = async () => {
        if (chunkAudioChunks.length === 0) return;
        const chunkBlob = new Blob(chunkAudioChunks, { type: chunkRecorder?.mimeType || 'audio/webm' });
        console.log(`[Chunker] Captured chunk [Index ${currentIdx}], size: ${chunkBlob.size} bytes. Transcribing...`);
        
        await uploadAndTranscribeChunk(chunkBlob, currentIdx, "temp_stream");
      };

      try {
        chunkRecorder.start();
      } catch (startErr) {
        console.error('[Chunker Error] Failed to start chunkRecorder:', startErr);
        return;
      }

      // Split chunks every 12 seconds dynamically to avoid exceeding public rate limits
      chunkTimeoutRef.current = setTimeout(() => {
        try {
          if (chunkRecorder && chunkRecorder.state !== 'inactive') {
            chunkRecorder.stop();
          }
        } catch (stopErr) {
          console.error('[Chunker Error] Failed to stop chunkRecorder:', stopErr);
        }
        runNextChunkInput();
      }, CHUNK_DURATION_SEC * 1000);
    };

    runNextChunkInput();
  };

  const startRecording = async () => {
    if (!meetingTitle.trim()) {
      toast.error('Meeting Title is necessary. Please enter a meeting title before starting.');
      return;
    }

    try {
      console.log('[Mic Setup] Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });

      rawStreamRef.current = stream;

      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('audio/webm') 
          ? 'audio/webm' 
          : MediaRecorder.isTypeSupported('audio/mp4') 
          ? 'audio/mp4' 
          : '';
      }

      const recorderOptions: MediaRecorderOptions = {};
      if (mimeType) {
        recorderOptions.mimeType = mimeType;
      }

      mediaRecorder.current = new MediaRecorder(stream, recorderOptions);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunks.current.push(event.data);
        }
      };

      mediaRecorder.current.onstop = async () => {
        const audioBlob = new Blob(audioChunks.current, { type: mimeType || 'audio/webm' });
        await processAudio(audioBlob, finalDurationRef.current);
      };

      mediaRecorder.current.start(1000);
      setIsRecording(true);
      setIsPaused(false);

      startChunking(stream);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      toast.info('Recording started');
    } catch (error: any) {
      console.error('[Mic Error] Complete hardware initialization failure:', error);
      toast.error('Could not access microphone: ' + (error.message || 'Check browser permissions'));
    }
  };

  const pauseRecording = () => {
    if (mediaRecorder.current && isRecording && !isPaused) {
      mediaRecorder.current.pause();
      setIsPaused(true);
      clearInterval(timerRef.current);
      toast.info('Recording paused');
    }
  };

  const resumeRecording = () => {
    if (mediaRecorder.current && isRecording && isPaused) {
      mediaRecorder.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      toast.info('Recording resumed');
    }
  };

  const stopRecording = () => {
    console.log('[Mic Setup] Stopping audio recording sequence...');
    if (mediaRecorder.current && isRecording) {
      finalDurationRef.current = formatTime(recordingTime);
      
      if (chunkTimeoutRef.current) {
        clearTimeout(chunkTimeoutRef.current);
        chunkTimeoutRef.current = null;
      }
      if (chunkRecorderRef.current && chunkRecorderRef.current.state !== 'inactive') {
        try {
          chunkRecorderRef.current.stop();
        } catch (e) {}
        chunkRecorderRef.current = null;
      }
      setTranscribingStatus('idle');
      
      try {
        mediaRecorder.current.stop();
      } catch (stopErr) {}

      if (rawStreamRef.current) {
        rawStreamRef.current.getTracks().forEach((track) => track.stop());
        rawStreamRef.current = null;
      }

      if (audioContextRef.current) {
        try {
          if (audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
          }
        } catch (ctxErr) {}
        audioContextRef.current = null;
      }

      setIsRecording(false);
      setIsPaused(false);
      clearInterval(timerRef.current);
      setRecordingTime(0);
      toast.success('Meeting ended, processing starting...');
    }
  };

  const processAudio = async (blob: Blob, duration?: string) => {
    // Safety check: Don't process if blob is too large (approx 20MB limit to stay safe with base64 increase)
    const MAX_SIZE_MB = 20;
    if (blob.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`Recording is too large (${(blob.size / (1024 * 1024)).toFixed(1)}MB). Limit is ${MAX_SIZE_MB}MB.`);
      return;
    }

    setIsUploading(true);
    setUploadProgress(4);
    setProgressLabel("Analyzing speech energetics...");

    let meetingRefId = '';
    try {
      // 1. Create a meeting record in Firestore with "processing" status and initial proxy audioUrl
      const meetingColRef = collection(db, 'meetings');
      const meetingRef = doc(meetingColRef);
      meetingRefId = meetingRef.id;

      // Cache audio locally in browser IndexedDB for instant playback & download with sound
      await saveAudioToLocalCache(meetingRefId, blob);

      const titleToUse = meetingTitle.trim() || `Meeting ${format(new Date(), 'yyyy-MM-dd HH:mm')}`;
      const currentUserName = profile?.fullName || profile?.displayName || auth.currentUser?.displayName || (auth.currentUser?.email ? auth.currentUser.email.split('@')[0] : 'Host');
      const currentUserEmail = profile?.email || auth.currentUser?.email || '';

      await setDoc(meetingRef, {
        title: titleToUse,
        createdAt: serverTimestamp(),
        status: 'processing',
        creatorId: auth.currentUser?.uid || '',
        creatorEmail: currentUserEmail,
        createdBy: currentUserName,
        hostName: currentUserName,
        duration: duration || 'Unknown',
        audioUrl: `/api/audio/${meetingRefId}`
      });

      setProcessingId(meetingRefId);
      toast.loading('Analyzing toolbox talk recording...', { id: 'processing-meeting' });

      // 2. Convert to base64 and upload to Firebase Storage
      setUploadProgress(12);
      setProgressLabel("Transcoding audio streams...");
      
      const reader = new FileReader();
      
      reader.onerror = () => {
        toast.error('File reading failed', { id: 'processing-meeting' });
        setIsUploading(false);
      };

      reader.onloadend = async () => {
        try {
          const base64Audio = (reader.result as string).split(',')[1];
          
          // Send base64 directly to processing server API immediately without waiting for storage uploads
          let audioUrl = `/api/audio/${meetingRefId}`;
          let driveFileId = '';
          let driveFileUrl = '';

          // Upload audio to Firebase Storage for permanent cloud persistence
          try {
            const fileExtension = blob.type.split('/')[1]?.split(';')[0] || 'webm';
            const audioPath = `meetings/${meetingRefId}/audio_${Date.now()}.${fileExtension}`;
            const storageRef = ref(storage, audioPath);
            
            // Allow up to 4s for cloud upload before streaming AI analysis
            const uploadPromise = uploadBytes(storageRef, blob).then(snap => getDownloadURL(snap.ref));
            const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
            
            const cloudUrl = await Promise.race([uploadPromise, timeoutPromise]);
            if (cloudUrl) {
              audioUrl = cloudUrl;
              await updateDoc(doc(db, 'meetings', meetingRefId), { audioUrl: cloudUrl });
              console.log('[Storage] Audio uploaded to Firebase Storage:', cloudUrl);
            } else {
              // Finish in background if it takes longer than 4s
              uploadPromise.then(async (bgCloudUrl) => {
                if (bgCloudUrl) {
                  await updateDoc(doc(db, 'meetings', meetingRefId), { audioUrl: bgCloudUrl });
                  console.log('[Background Storage] Audio uploaded to Firebase Storage (deferred):', bgCloudUrl);
                }
              }).catch(() => {});
            }
          } catch (storageErr) {
            console.warn('[Storage] Firebase Storage upload skipped:', storageErr);
          }

          if (googleAccessToken && isBackupEnabled) {
            (async () => {
              try {
                const fileExtension = blob.type.split('/')[1]?.split(';')[0] || 'webm';
                const fileTitle = `Arkoo_Prebuild_Meeting_${format(new Date(), 'yyyyMMdd_HHmm')}.${fileExtension}`;
                const driveMetadata = {
                  name: fileTitle,
                  mimeType: blob.type || 'audio/webm'
                };
                const driveForm = new FormData();
                driveForm.append('metadata', new Blob([JSON.stringify(driveMetadata)], { type: 'application/json' }));
                driveForm.append('file', blob);

                const driveUploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${googleAccessToken}` },
                  body: driveForm
                });

                if (driveUploadRes.ok) {
                  const driveResult = await driveUploadRes.json();
                  await updateDoc(doc(db, 'meetings', meetingRefId), {
                    driveFileId: driveResult.id,
                    driveFileUrl: driveResult.webViewLink,
                    gdriveUploadStatus: 'completed'
                  });
                  console.log('[Background Drive] Drive backup sync finished:', driveResult.webViewLink);
                }
              } catch (driveErr) {
                console.warn('[Background Drive Warning] Non-blocking Drive upload omitted:', driveErr);
              }
            })();
          }

          // Force pre-save the audioUrl in Firestore to ensure the recording remains active and accessible
          const finalClientAudioUrl = audioUrl || `/api/audio/${meetingRefId}`;
          try {
            await updateDoc(doc(db, 'meetings', meetingRefId), {
              audioUrl: finalClientAudioUrl,
              driveFileId: driveFileId || null,
              driveFileUrl: driveFileUrl || null
            });
            console.log('Pre-saved audioUrl and Drive metadata to Firestore early:', finalClientAudioUrl);
          } catch (dbPreSaveError) {
            console.warn('Pre-saving audioUrl failed non-blocking:', dbPreSaveError);
          }
          
          // 3. Call server via streaming connection
          setUploadProgress(28);
          setProgressLabel("Contacting AI agent pipeline...");

          const res = await fetch(getApiUrl('/api/process-meeting'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              meetingId: meetingRefId,
              audioBase64: base64Audio, 
              title: titleToUse,
              mimeType: blob.type,
              audioUrl: audioUrl || null,
              driveFileUrl: driveFileUrl || null,
              googleAccessToken: googleAccessToken || null,
              knownNames: employees?.map((e: any) => e.fullName).join(", ") || "",
              preTranscribedText: Object.keys(chunkTranscriptsRef.current).length > 0 
                ? Object.keys(chunkTranscriptsRef.current)
                    .map(Number)
                    .sort((a,b) => a-b)
                    .map(idx => chunkTranscriptsRef.current[idx])
                    .join(" ")
                : null
            }),
          });

          if (!res.ok) {
            throw new Error(`Server returned error status (${res.status})`);
          }

          const readerStream = res.body?.getReader();
          const decoder = new TextDecoder("utf-8");
          let finished = false;
          let buffer = "";
          let finalData: any = null;
          let isSavedByServer = false;
          let streamError: string | null = null;

          if (!readerStream) {
            throw new Error("Unable to establish processing stream connection.");
          }

          while (!finished) {
            const { value, done } = await readerStream.read();
            finished = done;
            if (value) {
              buffer += decoder.decode(value, { stream: !done });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const payload = JSON.parse(line);
                  if (payload.progress !== undefined) {
                    setUploadProgress(payload.progress);
                  }
                  if (payload.label) {
                    setProgressLabel(payload.label);
                  }
                  if (payload.status === 'completed' && payload.data) {
                    finalData = payload.data;
                  }
                  if (payload.isSavedByServer !== undefined) {
                    isSavedByServer = payload.isSavedByServer;
                  }
                  if (payload.error) {
                    streamError = payload.error;
                  }
                } catch (err) {
                  // Partial chunk or non-critical parsing warning
                }
              }
              if (streamError) {
                throw new Error(streamError);
              }
            }
          }

          if (buffer.trim()) {
            try {
              const payload = JSON.parse(buffer);
              if (payload.status === 'completed' && payload.data) {
                finalData = payload.data;
              }
              if (payload.isSavedByServer !== undefined) {
                isSavedByServer = payload.isSavedByServer;
              }
              if (payload.error) {
                streamError = payload.error;
              }
            } catch (err) {
              // Ignore
            }
          }

          if (streamError) {
            throw new Error(streamError);
          }

          if (!finalData) {
            throw new Error(streamError || "AI processing pipeline encountered a temporary error while analyzing the audio. Please try uploading again.");
          }

          console.log('AI Data received:', finalData, 'Saved by server:', isSavedByServer);

          if (!isSavedByServer) {
            console.log("Saving results from client fallback as fallback...");
            // 4. Update Firestore with results
            setUploadProgress(95);
            setProgressLabel("Writing reports to Firestore (Client Dynamic Fallback)...");

            await updateDoc(doc(db, 'meetings', meetingRefId), {
              status: 'completed',
              transcript: finalData.transcript || "Transcription could not be generated.",
              mom: finalData.mom || "MOM could not be generated.",
              summary: finalData.summary || "Summary could not be generated.",
              audioUrl: audioUrl || `/api/audio/${meetingRefId}`,
              processedAt: serverTimestamp(),
            });

            // 5. Create tasks in Firestore
            const tasks = Array.isArray(finalData.tasks) ? finalData.tasks : [];
            
            for (const task of tasks) {
              if (!task || typeof task !== 'object') continue;
              
              // Normalize priority to match firestore rules
              let normalizedPriority = String(task.priority || 'medium').toLowerCase();
              if (normalizedPriority === 'normal') normalizedPriority = 'medium';
              if (!['low', 'medium', 'high', 'critical'].includes(normalizedPriority)) normalizedPriority = 'medium';

              try {
                await addDoc(collection(db, 'tasks'), {
                  title: task.title || 'Untitled Task',
                  description: task.description || 'No description provided.',
                  meetingId: meetingRefId,
                  assigneeName: task.assigneeName || 'Unassigned',
                  department: task.department || 'General',
                  priority: normalizedPriority,
                  status: 'pending',
                  // Store the exact deadline phrase spoken in the meeting, or null if none was mentioned
                  deadline: task.deadline || null,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp()
                });

                // Dispatch task email notification to assigned stakeholder
                fetch('/api/send-task-email', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    title: task.title || 'Untitled Task',
                    description: task.description || 'No description provided.',
                    assigneeName: task.assigneeName || 'Unassigned',
                    priority: normalizedPriority,
                    department: task.department || 'General',
                    deadline: task.deadline || 'Friday 5 PM',
                    meetingTitle: finalData?.title || 'Meeting Audio Recording'
                  })
                }).catch(e => console.error('Task email dispatch error:', e));
              } catch (taskErr) {
                console.error('Failed to save individual task:', taskErr);
              }
            }

            // 6. Update meeting with task count
            await updateDoc(doc(db, 'meetings', meetingRefId), {
              tasksCount: tasks.length
            });
          } else {
             console.log("Saved directly by backend pipeline server. Skipping client-side database writes.");
          }

          setProcessingId(null);
          setIsUploading(false);
          setMeetingTitle('');
          setView('list');
          toast.success('Meeting intelligence generated and added to Meetings list!', { id: 'processing-meeting' });
          if (onProcessingFinished) {
            onProcessingFinished();
          }
        } catch (innerError: any) {
          console.error(innerError);
          toast.error('Processing failed: ' + innerError.message, { id: 'processing-meeting' });
          try {
            await updateDoc(doc(db, 'meetings', meetingRefId), { 
              status: 'failed',
              failureReason: innerError.message || 'Unknown processing error'
            });
          } catch (e) {
            handleFirestoreError(e, OperationType.UPDATE, `meetings/${meetingRefId}`);
          }
          setProcessingId(null);
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(blob);
    } catch (error: any) {
      console.error(error);
      toast.error('Initial setup failed: ' + error.message, { id: 'processing-meeting' });
      if (meetingRefId) {
        try {
          await updateDoc(doc(db, 'meetings', meetingRefId), { status: 'failed' });
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, `meetings/${meetingRefId}`);
        }
      }
      handleFirestoreError(error, OperationType.CREATE, 'meetings');
      setProcessingId(null);
      setIsUploading(false);
    }
  };

  const processFromDriveLink = async () => {
    if (!pastedDriveLink.trim()) {
      toast.error('Please input a valid Google Drive link.');
      return;
    }

    const isDriveActive = !!(googleAccessToken || gdriveState?.connected);
    if (!isDriveActive) {
      toast.error('Connect Google Drive first using the sync manager before submitting Drive URLs.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(4);
    setProgressLabel("Initializing Drive integration stream...");

    let meetingRefId = '';
    try {
      // 1. Create a meeting record in Firestore with "processing" status
      const meetingColRef = collection(db, 'meetings');
      const meetingRef = doc(meetingColRef);
      meetingRefId = meetingRef.id;

      const currentUserName = profile?.fullName || profile?.displayName || auth.currentUser?.displayName || (auth.currentUser?.email ? auth.currentUser.email.split('@')[0] : 'Host');
      const currentUserEmail = profile?.email || auth.currentUser?.email || '';

      await setDoc(meetingRef, {
        title: `Drive Meeting ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
        createdAt: serverTimestamp(),
        status: 'processing',
        creatorId: auth.currentUser?.uid || '',
        creatorEmail: currentUserEmail,
        createdBy: currentUserName,
        hostName: currentUserName,
        duration: 'Drive File',
        driveFileUrl: pastedDriveLink,
        audioUrl: pastedDriveLink
      });

      setProcessingId(meetingRefId);
      toast.loading('Analyzing construction meeting from Google Drive URL...', { id: 'processing-meeting' });

      // 2. Call server via streaming connection
      setUploadProgress(12);
      setProgressLabel("Downloading Drive audio contents on server...");

      const res = await fetch(getApiUrl('/api/process-meeting'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          meetingId: meetingRefId,
          title: `Drive Meeting ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
          driveFileUrl: pastedDriveLink,
          googleAccessToken: googleAccessToken || null,
          knownNames: employees?.map((e: any) => e.fullName).join(", ") || ""
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned error status (${res.status})`);
      }

      const readerStream = res.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let finished = false;
      let buffer = "";
      let finalData: any = null;
      let isSavedByServer = false;
      let streamError: string | null = null;

      if (!readerStream) {
        throw new Error("Unable to establish processing stream connection.");
      }

      while (!finished) {
        const { value, done } = await readerStream.read();
        finished = done;
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const payload = JSON.parse(line);
              if (payload.progress !== undefined) {
                setUploadProgress(payload.progress);
              }
              if (payload.label) {
                setProgressLabel(payload.label);
              }
              if (payload.status === 'completed' && payload.data) {
                finalData = payload.data;
              }
              if (payload.isSavedByServer !== undefined) {
                isSavedByServer = payload.isSavedByServer;
              }
              if (payload.error) {
                streamError = payload.error;
              }
            } catch (err) {}
          }
          if (streamError) {
            throw new Error(streamError);
          }
        }
      }

      if (buffer.trim()) {
        try {
          const payload = JSON.parse(buffer);
          if (payload.status === 'completed' && payload.data) {
            finalData = payload.data;
          }
          if (payload.isSavedByServer !== undefined) {
            isSavedByServer = payload.isSavedByServer;
          }
          if (payload.error) {
            streamError = payload.error;
          }
        } catch (err) {}
      }

      if (streamError) {
        throw new Error(streamError);
      }

      if (!finalData) {
        throw new Error(streamError || "AI processing pipeline encountered a temporary error while analyzing the audio. Please try uploading again.");
      }

      if (!isSavedByServer) {
        console.log("Saving Google Drive results from client fallback as fallback...");
        await updateDoc(doc(db, 'meetings', meetingRefId), {
          status: 'completed',
          transcript: finalData.transcript || "Transcription could not be generated.",
          mom: finalData.mom || "MOM could not be generated.",
          summary: finalData.summary || "Summary could not be generated.",
          processedAt: serverTimestamp(),
          tasksCount: Array.isArray(finalData.tasks) ? finalData.tasks.length : 0
        });

        // Create tasks
        const tasks = Array.isArray(finalData.tasks) ? finalData.tasks : [];
        for (const task of tasks) {
          if (!task || typeof task !== 'object') continue;
          let normalizedPriority = String(task.priority || 'medium').toLowerCase();
          if (normalizedPriority === 'normal') normalizedPriority = 'medium';
          if (!['low', 'medium', 'high', 'critical'].includes(normalizedPriority)) normalizedPriority = 'medium';

          try {
            await addDoc(collection(db, 'tasks'), {
              title: task.title || 'Untitled Task',
              description: task.description || 'No description provided.',
              meetingId: meetingRefId,
              assigneeName: task.assigneeName || 'Unassigned',
              department: task.department || 'General',
              priority: normalizedPriority,
              status: 'pending',
              deadline: Timestamp.fromDate(parseRelativeDeadline(task.deadline || 'Pending')),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });

            // Dispatch task email notification to assigned stakeholder
            fetch('/api/send-task-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: task.title || 'Untitled Task',
                description: task.description || 'No description provided.',
                assigneeName: task.assigneeName || 'Unassigned',
                priority: normalizedPriority,
                department: task.department || 'General',
                deadline: task.deadline || 'Pending',
                meetingTitle: finalData?.title || 'Meeting Audio Recording'
              })
            }).catch(e => console.error('Task email dispatch error:', e));
          } catch (taskErr) {
            console.error('Failed to save individual task:', taskErr);
          }
        }
      }

      setProcessingId(null);
      setIsUploading(false);
      setPastedDriveLink('');
      toast.success('Google Drive meeting intelligence generated successfully!', { id: 'processing-meeting' });

    } catch (innerError: any) {
      console.error(innerError);
      toast.error('Google Drive processing failed: ' + innerError.message, { id: 'processing-meeting' });
      try {
        await updateDoc(doc(db, 'meetings', meetingRefId), { 
          status: 'failed',
          failureReason: innerError.message || 'Unknown processing error'
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.UPDATE, `meetings/${meetingRefId}`);
      }
      setProcessingId(null);
      setIsUploading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const deleteMeeting = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setMeetingToDelete(id);
  };

  const confirmDeleteMeeting = async () => {
    if (!meetingToDelete) return;
    const id = meetingToDelete;
    setMeetingToDelete(null);
    
    const loadingToast = toast.loading('Deleting meeting...');
    try {
      console.log('Initiating deletion for meeting:', id);
      
      // 1. Find and soft-delete associated tasks first
      const tasksQ = query(collection(db, 'tasks'), where('meetingId', '==', id));
      const tasksSnap = await getDocs(tasksQ);
      
      if (tasksSnap.size > 0) {
        console.log(`Soft deleting ${tasksSnap.size} tasks...`);
        const deletePromises = tasksSnap.docs.map(d => updateDoc(doc(db, 'tasks', d.id), {
          isDeleted: true,
          deletedAt: serverTimestamp()
        }));
        await Promise.all(deletePromises);
      }
 
      // 2. Soft-delete the meeting record
      await updateDoc(doc(db, 'meetings', id), {
        status: 'deleted',
        isDeleted: true,
        deletedAt: serverTimestamp()
      });
      console.log('Meeting soft-deleted successfully in DB');
      
      toast.success('Meeting moved to Recycle Bin', { id: loadingToast });
      
      // IMPORTANT: Local state cleanup MUST happen after successful DB deletion
      // If we are currently viewing this meeting, go back
      if (selectedMeetingId === id) {
        setView('list');
        setSelectedMeetingId(null);
      }
    } catch (error: any) {
      console.error('CRITICAL: Delete operation failed:', error);
      toast.error(`Delete failed: ${error.message || 'Unknown error'}`, { id: loadingToast });
      handleFirestoreError(error, OperationType.WRITE, `meetings/${id}`);
    }
  };

  if (view === 'detail' && selectedMeeting) {
    return <MeetingDetail meeting={selectedMeeting} onBack={() => setView('list')} onDelete={deleteMeeting} profile={profile} employees={employees} />;
  }

  if (initialView === 'record') {
    return (
      <div className="max-w-3xl mx-auto space-y-6 pt-4">
        {/* Meeting Title Input */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-600">Meeting Title</label>
          <Input
            type="text"
            placeholder="e.g. Q2 Sprint Planning"
            value={meetingTitle}
            onChange={(e) => setMeetingTitle(e.target.value)}
            disabled={isRecording || isUploading}
            className="h-12 text-base rounded-xl border-slate-200 focus:border-blue-600 focus:ring-blue-600 bg-white shadow-sm"
          />
        </div>

        {/* Record Card */}
        <Card className="border border-slate-200/80 shadow-sm rounded-2xl bg-white overflow-hidden">
          <CardContent className="p-12 flex flex-col items-center justify-center min-h-[260px]">
            {isRecording ? (
              <div className="flex flex-col items-center gap-6 w-full">
                <div className="flex items-center gap-3 bg-red-50 px-5 py-2.5 rounded-full border border-red-100">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-widest font-mono">
                    {isPaused ? 'RECORDING PAUSED' : 'RECORDING IN PROGRESS'}
                  </span>
                  <span className="text-red-600 font-bold font-mono text-base ml-2">{formatTime(recordingTime)}</span>
                </div>

                <LiveAudioVisualizer stream={rawStreamRef.current} />

                {/* Control Action Buttons: Pause / Resume & End Meeting */}
                <div className="flex items-center gap-6 mt-2">
                  {isPaused ? (
                    <Button 
                      onClick={resumeRecording}
                      className="h-12 px-6 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs uppercase tracking-wider shadow-md shadow-amber-500/20 cursor-pointer"
                    >
                      ▶ Resume Recording
                    </Button>
                  ) : (
                    <Button 
                      onClick={pauseRecording}
                      variant="outline"
                      className="h-12 px-6 rounded-2xl border-slate-300 text-slate-700 font-bold text-xs uppercase tracking-wider hover:bg-slate-100 cursor-pointer"
                    >
                      ⏸ Pause Recording
                    </Button>
                  )}

                  <Button 
                    onClick={stopRecording}
                    className="h-12 px-6 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider shadow-md shadow-red-500/20 cursor-pointer"
                  >
                    ⏹ End Meeting
                  </Button>
                </div>

                <p className="text-xs text-slate-400 font-medium pt-1">
                  Click <span className="font-bold text-slate-600">End Meeting</span> to finish, generate AI intelligence & add to Meetings list.
                </p>
              </div>
            ) : isUploading ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <div className="w-16 h-16 rounded-full border-4 border-blue-600/20 border-t-blue-600 animate-spin flex items-center justify-center">
                  <BrainCircuit className="w-8 h-8 text-blue-600" />
                </div>
                <div className="space-y-1">
                  <p className="font-bold text-slate-800 text-base">{progressLabel || "Processing meeting with AI..."}</p>
                  <p className="text-xs text-slate-400">Transcribing audio and creating structured task assignments</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-6 text-center">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">READY TO RECORD</span>
                <button
                  onClick={startRecording}
                  className="w-20 h-20 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white flex items-center justify-center shadow-xl shadow-blue-500/30 transition-all cursor-pointer group"
                  title="Start Recording"
                >
                  <Mic className="w-9 h-9 text-white group-hover:scale-110 transition-transform" />
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Action Bar matching user screenshot */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative flex-1 w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input 
            placeholder="Search meetings..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-10 bg-white border-slate-200 rounded-xl text-sm" 
          />
        </div>
        {isAdminOrManager && (
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <Button 
              onClick={() => fileInputRef.current?.click()} 
              variant="outline" 
              disabled={isUploading}
              className="h-10 rounded-xl px-4 border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 bg-white shadow-sm"
            >
              <Upload className="w-4 h-4 mr-2 text-slate-500" /> Upload
            </Button>
            <input 
              type="file" 
              ref={fileInputRef}
              className="hidden" 
              accept="audio/*,video/*" 
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  processAudio(file);
                  e.target.value = '';
                }
              }} 
            />
            <Button 
              onClick={startRecording} 
              disabled={isUploading}
              className="h-10 rounded-xl px-5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-500/20"
            >
              <Mic className="w-4 h-4 mr-1.5" /> Record
            </Button>
          </div>
        )}
      </div>

      {isRecording && (
        <Card className="border-blue-200 bg-blue-50/20 shadow-sm overflow-hidden animate-in fade-in duration-300">
          <CardHeader className="bg-blue-50/50 pb-3 border-b border-blue-100/50">
            <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-600 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
              </span>
              REAL-TIME INTELLIGENCE FEED
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-5">
            <LiveAudioVisualizer stream={rawStreamRef.current} />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Live Captions Stream</span>
                <div className="flex items-center gap-1.5">
                  <div className={`h-2 w-2 rounded-full ${transcribingStatus === 'transcribing_live' ? 'bg-blue-500 animate-pulse' : 'bg-green-500 animate-pulse'}`} />
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wide font-bold">
                    {transcribingStatus === 'transcribing_live' ? 'AI Transcribing Live...' : 'Listening...'}
                  </span>
                </div>
              </div>

              <div className="bg-white border border-slate-100 rounded-xl p-4 h-40 overflow-y-auto space-y-3 shadow-inner font-sans scrollbar-thin">
                {liveCaptions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 space-y-1">
                    <Mic className="w-5 h-5 text-slate-300 animate-bounce" />
                    <p className="text-xs font-medium">Capturing voice feeds...</p>
                  </div>
                ) : (
                  liveCaptions.map((caption) => (
                    <motion.div 
                      key={caption.index}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-sm leading-relaxed text-slate-700 flex items-start gap-2 border-l-2 border-blue-500/30 pl-2 py-0.5"
                    >
                      <span className="text-[9px] font-mono font-bold text-slate-400 mt-1 uppercase shrink-0">[{formatTime(caption.index * CHUNK_DURATION_SEC)}]</span>
                      <p className="flex-1 font-medium">{caption.text}</p>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isUploading && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="animate-spin h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent rounded-full" />
              <span className="text-sm font-bold text-slate-700">{progressLabel || 'Processing...'}</span>
            </div>
            <span className="text-xs font-mono font-bold text-slate-500">{uploadProgress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-600 transition-all duration-300 rounded-full" 
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Meetings Dual View: Cards on Mobile (< md), Data Table on Desktop (>= md) */}
      
      {/* Mobile Card List (< md) */}
      <div className="md:hidden space-y-3">
        {filteredMeetings.length === 0 ? (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-8 text-center text-slate-400">
            <FileAudio className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p className="font-semibold text-sm">No meetings found.</p>
          </div>
        ) : (
          filteredMeetings.map((meeting) => {
            const dateStr = meeting.createdAt?.toDate 
              ? format(meeting.createdAt.toDate(), 'MMM d, yyyy, hh:mm a') 
              : 'Jul 21, 2026, 12:57 PM';
            const hostName = resolveHostName(meeting);
            const firstChar = hostName.charAt(0).toUpperCase() || 'H';

            return (
              <div
                key={meeting.id}
                onClick={() => handleOpenMeetingDetail(meeting.id)}
                className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs hover:border-blue-300 transition-all cursor-pointer active:scale-[0.99] space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <Video className="w-4.5 h-4.5 text-blue-500" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-900 text-sm leading-tight truncate">{meeting.title}</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">{dateStr}</p>
                    </div>
                  </div>

                  {/* Status Badge */}
                  {meeting.status === 'processing' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200 shrink-0">
                      <span className="animate-spin h-2 w-2 border-2 border-amber-600 border-t-transparent rounded-full" /> Processing
                    </span>
                  ) : meeting.status === 'failed' ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 shrink-0">
                      Failed
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                      Completed
                    </span>
                  )}
                </div>

                {/* Host & Actions Footer */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                  <div className="flex items-center gap-2 min-w-0" onClick={(e) => e.stopPropagation()}>
                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-[10px] shrink-0">
                      {firstChar}
                    </div>
                    <span className="text-slate-600 font-medium truncate max-w-[140px]">{hostName}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleOpenMeetingDetail(meeting.id)}
                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg text-xs transition-colors flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" /> View
                    </button>
                    {isAdminOrManager && (
                      <button
                        onClick={(e) => deleteMeeting(meeting.id, e)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete Meeting"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop Data Table (>= md) */}
      <div className="hidden md:block bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-4 px-6 font-semibold flex items-center gap-2">
                  <Video className="w-3.5 h-3.5 text-slate-400" />
                  MEETING
                </th>
                <th className="py-4 px-6 font-semibold">
                  <span className="inline-flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-slate-400" /> MEETING HOST</span>
                </th>
                <th className="py-4 px-6 font-semibold">DATE</th>
                <th className="py-4 px-6 font-semibold text-center">STATUS</th>
                <th className="py-4 px-6 font-semibold text-right pr-8">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredMeetings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <FileAudio className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    No meetings found.
                  </td>
                </tr>
              ) : (
                filteredMeetings.map((meeting) => {
                  const dateStr = meeting.createdAt?.toDate 
                    ? format(meeting.createdAt.toDate(), 'MMM d, yyyy, hh:mm a') 
                    : 'Jul 21, 2026, 12:57 PM';

                  const hostName = resolveHostName(meeting);
                  const firstChar = hostName.charAt(0).toUpperCase() || 'H';

                  return (
                    <tr key={meeting.id} className="hover:bg-slate-50/60 transition-colors cursor-pointer" onClick={() => handleOpenMeetingDetail(meeting.id)}>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-blue-100/60 text-blue-600 flex items-center justify-center shrink-0">
                            <Video className="w-4 h-4 text-blue-500" />
                          </div>
                          <span className="font-bold text-slate-900 hover:text-blue-600 transition-colors">{meeting.title}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6" onClick={(e) => e.stopPropagation()}>
                        {editingHostId === meeting.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              defaultValue={hostName}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveHostName(meeting.id, (e.target as HTMLInputElement).value);
                                if (e.key === 'Escape') setEditingHostId(null);
                              }}
                              onBlur={(e) => handleSaveHostName(meeting.id, e.target.value)}
                              className="text-xs bg-white border border-blue-400 rounded px-2 py-1 text-slate-900 font-medium outline-none shadow-sm"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2.5 text-slate-700 group cursor-pointer" title="Click to edit meeting host" onClick={() => setEditingHostId(meeting.id)}>
                            <div className="w-7 h-7 rounded-full bg-blue-100/70 text-blue-600 font-bold flex items-center justify-center text-xs shrink-0">
                              {firstChar}
                            </div>
                            <span className="text-sm font-medium text-slate-800 group-hover:text-blue-600 transition-colors">{hostName}</span>
                            <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-6 text-slate-500 text-xs font-medium">
                        {dateStr}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {meeting.status === 'processing' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-100">
                            <span className="animate-spin h-2.5 w-2.5 border-2 border-amber-600 border-t-transparent rounded-full" /> Processing
                          </span>
                        ) : meeting.status === 'failed' ? (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-100">
                            Failed
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
                            Completed
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-right pr-8">
                        <div className="flex items-center justify-end gap-1.5">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenMeetingDetail(meeting.id);
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="View Meeting Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {isAdminOrManager && (
                            <button 
                              onClick={(e) => deleteMeeting(meeting.id, e)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete Meeting"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {meetingToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden"
          >
            <div className="p-6">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-600 mb-4 animate-pulse">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2 font-sans tracking-tight">Delete Meeting Intelligence?</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Are you absolutely sure you want to delete this meeting? This will permanently delete all recorded transcriptions, AI minutes of the meeting, executive summaries, and action-item tasks associated with it. This action cannot be undone.
              </p>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex gap-3 justify-end border-t border-slate-100">
              <Button 
                variant="outline" 
                onClick={() => setMeetingToDelete(null)}
                className="rounded-xl border-slate-200 text-xs font-semibold h-9 px-4"
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={confirmDeleteMeeting}
                className="bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold h-9 px-4"
              >
                Delete Permanently
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

