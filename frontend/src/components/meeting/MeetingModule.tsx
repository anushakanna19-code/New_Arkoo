import { useState, useEffect, useRef } from 'react';
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

export function LiveAudioVisualizer({ stream }: { stream: MediaStream | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) return;

    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioContext = new AudioCtx();
      source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const canvasCtx = canvas.getContext('2d');
      if (!canvasCtx) return;

      const draw = () => {
        if (!analyser || !canvas) return;
        animationRef.current = requestAnimationFrame(draw);

        analyser.getByteFrequencyData(dataArray);

        // Fill background
        canvasCtx.fillStyle = '#f8fafc'; // slate-50 background
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw volume bar bars
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const value = dataArray[i];
          const percent = value / 255;
          const barHeight = Math.max(4, percent * canvas.height * 0.85);

          // Deep bold sunset orange gradient
          const gradient = canvasCtx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
          gradient.addColorStop(0, '#f97316'); // Orange-500
          gradient.addColorStop(1, '#ffedd5'); // Orange-100

          canvasCtx.fillStyle = gradient;
          
          // Draw symmetric rounded pill-shaped bars
          const yPos = (canvas.height - barHeight) / 2;
          
          canvasCtx.beginPath();
          if ((canvasCtx as any).roundRect) {
            (canvasCtx as any).roundRect(x, yPos, barWidth - 2, barHeight, 4);
          } else {
            canvasCtx.rect(x, yPos, barWidth - 2, barHeight);
          }
          canvasCtx.fill();

          x += barWidth;
        }
      };

      draw();
    } catch (err) {
      console.error('[Visualizer Error] Analyser failed:', err);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioContext) {
        try {
          audioContext.close();
        } catch (e) {}
      }
    };
  }, [stream]);

  return (
    <div className="w-full flex flex-col items-center justify-center bg-slate-50 border border-slate-100 rounded-xl p-4 shadow-inner">
      <div className="flex items-center gap-2 mb-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
        </span>
        <span className="text-xs font-mono text-slate-500 uppercase tracking-widest font-bold">Voice Energetics Waveform</span>
      </div>
      <canvas ref={canvasRef} className="w-full h-16 bg-slate-50 rounded-lg hover:brightness-95 transition-all" width={500} height={64} />
    </div>
  );
}

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
    return (
      meeting.title?.toLowerCase().includes(q) ||
      meeting.createdBy?.toLowerCase().includes(q) ||
      meeting.hostName?.toLowerCase().includes(q)
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
          meetingId: meetingTempId
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
          channelCount: 1,
          sampleRate: 16000
        } 
      });

      rawStreamRef.current = stream;

      let processedStream = stream;
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass({ sampleRate: 16000 });
          audioContextRef.current = audioCtx;

          const source = audioCtx.createMediaStreamSource(stream);
          const filterHighPass = audioCtx.createBiquadFilter();
          filterHighPass.type = 'highpass';
          filterHighPass.frequency.value = 80;

          const filterLowPass = audioCtx.createBiquadFilter();
          filterLowPass.type = 'lowpass';
          filterLowPass.frequency.value = 7500;

          const dest = audioCtx.createMediaStreamDestination();
          source.connect(filterHighPass);
          filterHighPass.connect(filterLowPass);
          filterLowPass.connect(dest);

          processedStream = dest.stream;
        }
      } catch (dspError) {
        console.warn('[Audio DSP Warning] Voice isolation filters failed, proceeding with raw mic stream:', dspError);
        processedStream = stream;
      }

      const options = {
        audioBitsPerSecond: 32000,
        mimeType: 'audio/webm;codecs=opus'
      };

      const MIME_TYPE = MediaRecorder.isTypeSupported(options.mimeType) 
        ? options.mimeType 
        : 'audio/webm';

      mediaRecorder.current = new MediaRecorder(processedStream, {
        audioBitsPerSecond: options.audioBitsPerSecond,
        mimeType: MIME_TYPE
      });

      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.current.push(event.data);
        }
      };

      mediaRecorder.current.onstop = async () => {
        const audioBlob = new Blob(audioChunks.current, { type: MIME_TYPE });
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

      const titleToUse = meetingTitle.trim() || `Meeting ${format(new Date(), 'yyyy-MM-dd HH:mm')}`;
      await setDoc(meetingRef, {
        title: titleToUse,
        createdAt: serverTimestamp(),
        status: 'processing',
        creatorId: auth.currentUser?.uid,
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

          // Fire-and-forget background cloud backup tasks so recording processing starts in under 5 seconds
          (async () => {
            try {
              const fileExtension = blob.type.split('/')[1]?.split(';')[0] || 'webm';
              const audioPath = `meetings/${meetingRefId}/audio_${Date.now()}.${fileExtension}`;
              const storageRef = ref(storage, audioPath);
              const uploadSnapshot = await uploadBytes(storageRef, blob);
              const cloudUrl = await getDownloadURL(uploadSnapshot.ref);
              await updateDoc(doc(db, 'meetings', meetingRefId), { audioUrl: cloudUrl });
              console.log('[Background Storage] Audio uploaded to Firebase Storage:', cloudUrl);
            } catch (storageErr) {
              console.warn('[Background Storage Warning] Non-blocking Storage upload omitted:', storageErr);
            }
          })();

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

      await setDoc(meetingRef, {
        title: `Drive Meeting ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
        createdAt: serverTimestamp(),
        status: 'processing',
        creatorId: auth.currentUser?.uid,
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
          googleAccessToken: googleAccessToken || null
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
    return <MeetingDetail meeting={selectedMeeting} onBack={() => setView('list')} onDelete={deleteMeeting} profile={profile} />;
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
            className="h-12 text-base rounded-xl border-slate-200 focus:border-brand-orange focus:ring-brand-orange bg-white shadow-sm"
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
                <div className="w-16 h-16 rounded-full border-4 border-brand-orange/20 border-t-brand-orange animate-spin flex items-center justify-center">
                  <BrainCircuit className="w-8 h-8 text-brand-orange" />
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
                  className="w-20 h-20 rounded-full bg-brand-orange hover:bg-orange-600 active:scale-95 text-white flex items-center justify-center shadow-xl shadow-orange-500/30 transition-all cursor-pointer group"
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
        <Card className="border-orange-200 bg-orange-50/20 shadow-sm overflow-hidden animate-in fade-in duration-300">
          <CardHeader className="bg-orange-50/50 pb-3 border-b border-orange-100/50">
            <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-orange opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-orange"></span>
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
                  <div className={`h-2 w-2 rounded-full ${transcribingStatus === 'transcribing_live' ? 'bg-orange-500 animate-pulse' : 'bg-green-500 animate-pulse'}`} />
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
                      className="text-sm leading-relaxed text-slate-700 flex items-start gap-2 border-l-2 border-orange-500/30 pl-2 py-0.5"
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
              <div className="animate-spin h-3.5 w-3.5 border-2 border-brand-orange border-t-transparent rounded-full" />
              <span className="text-sm font-bold text-slate-700">{progressLabel || 'Processing...'}</span>
            </div>
            <span className="text-xs font-mono font-bold text-slate-500">{uploadProgress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-brand-orange transition-all duration-300 rounded-full" 
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Meetings Table View matching reference image */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
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

                  const hostName = meeting.hostName || meeting.createdBy || 'Anusha Kanna';
                  const firstChar = hostName.charAt(0).toUpperCase() || 'A';

                  return (
                    <tr key={meeting.id} className="hover:bg-slate-50/60 transition-colors cursor-pointer" onClick={() => handleOpenMeetingDetail(meeting.id)}>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-orange-100/60 text-brand-orange flex items-center justify-center shrink-0">
                            <Video className="w-4 h-4 text-orange-500" />
                          </div>
                          <span className="font-bold text-slate-900 hover:text-brand-orange transition-colors">{meeting.title}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2.5 text-slate-700">
                          <div className="w-7 h-7 rounded-full bg-blue-100/70 text-blue-600 font-bold flex items-center justify-center text-xs shrink-0">
                            {firstChar}
                          </div>
                          <span className="text-sm font-medium text-slate-800">{hostName}</span>
                        </div>
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

function MeetingAudioPlayer({ audioUrl, title }: { audioUrl: string; title: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isLoaded, setIsLoaded] = useState(false);

  const isDriveUrl = audioUrl.includes('drive.google.com') || audioUrl.includes('googleapis.com/drive');

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration;
      if (dur && dur !== Infinity && !isNaN(dur)) {
        setDuration(dur);
      }
      setIsLoaded(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.volume = v;
    setVolume(v);
  };

  const handleEnded = () => setIsPlaying(false);

  const fmt = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
        <div className="w-6 h-6 rounded-lg bg-orange-100/70 text-orange-500 flex items-center justify-center text-xs">
          🎙️
        </div>
        Meeting Audio Recording
      </div>

      {isDriveUrl ? (
        /* Drive file — cannot stream directly, show open link */
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center text-2xl">🎵</div>
          <p className="text-xs text-slate-500 font-medium leading-relaxed">
            This meeting's audio is stored on Google Drive.<br />
            Click below to open and play it directly in Drive.
          </p>
          <a
            href={audioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors"
          >
            <Play className="w-3.5 h-3.5" /> Open in Google Drive
          </a>
        </div>
      ) : (
        /* Local / Firebase Storage audio — stream inline */
        <div className="space-y-4">
          {/* Hidden native audio element */}
          <audio
            ref={audioRef}
            src={audioUrl}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onDurationChange={handleLoadedMetadata}
            onCanPlay={handleLoadedMetadata}
            onEnded={handleEnded}
            preload="metadata"
            crossOrigin="anonymous"
          />

          {/* Waveform visual placeholder + play button */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 flex items-center gap-4">
            {/* Play / Pause button */}
            <button
              onClick={togglePlay}
              className="w-11 h-11 rounded-full bg-orange-500 hover:bg-orange-600 flex items-center justify-center text-white shadow-lg transition-all active:scale-95 shrink-0"
            >
              {isPlaying ? (
                <Square className="w-4 h-4 fill-white" />
              ) : (
                <Play className="w-4 h-4 fill-white ml-0.5" />
              )}
            </button>

            {/* Waveform bars animation */}
            <div className="flex items-center gap-[3px] h-8 shrink-0">
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-orange-400 transition-all"
                  style={{
                    height: isPlaying
                      ? `${20 + Math.sin((Date.now() / 200 + i * 0.7)) * 12}px`
                      : `${8 + (i % 3) * 6}px`,
                    animation: isPlaying ? `pulse ${0.4 + i * 0.05}s ease-in-out infinite alternate` : 'none',
                    opacity: isPlaying ? 1 : 0.4
                  }}
                />
              ))}
            </div>

            {/* Title & time */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white truncate">{title}</p>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                {fmt(currentTime)} / {fmt(duration)}
              </p>
            </div>
          </div>

          {/* Seek bar */}
          <div className="relative w-full h-4 flex items-center group cursor-pointer mb-2">
            {/* Background track */}
            <div className="absolute w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              {/* Fill track */}
              <div
                className="absolute left-0 top-0 h-full bg-orange-500 rounded-full transition-all pointer-events-none"
                style={{ width: `${progress}%` }}
              />
            </div>
            {/* Range input slider */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              disabled={!isLoaded || duration === 0}
              className="absolute w-full h-full opacity-0 cursor-pointer z-10"
            />
          </div>

          {/* Volume + Download */}
          <div className="flex items-center justify-between gap-4">
            {/* Volume */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">🔈</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={handleVolumeChange}
                className="w-20 accent-orange-500 cursor-pointer"
              />
              <span className="text-xs text-slate-400 font-mono w-7">{Math.round(volume * 100)}%</span>
            </div>

            {/* Download */}
            <a
              href={audioUrl}
              download={`${title || 'meeting'}_recording.webm`}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-orange-600 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Download Audio
            </a>
          </div>

          {!isLoaded && (
            <p className="text-[10px] text-slate-400 text-center font-medium animate-pulse">
              Loading audio file...
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MeetingDetail({ meeting, onBack, onDelete, profile }: { meeting: any, onBack: () => void, onDelete: (id: string) => void, profile?: any }) {
  const userRole = String(profile?.role || 'employee').toLowerCase();
  const isAdminOrManager = ['admin', 'manager'].includes(userRole);
  const [activeTab, setActiveTab] = useState<'mom' | 'transcript' | 'tasks' | 'ask'>('mom');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [retryingUpload, setRetryingUpload] = useState(false);
  const [currentMeeting, setCurrentMeeting] = useState(meeting);

  useEffect(() => {
    setCurrentMeeting(meeting);
  }, [meeting]);

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
        doc.setFont("helvetica", fontStyle);
        if (isBold) {
          doc.setFont("helvetica", "bold");
        }
        doc.setFontSize(fontSize);
        doc.setTextColor(51, 65, 85); // Slate gray body
        
        const lines = doc.splitTextToSize(text, contentWidth);
        for (const line of lines) {
          if (y > 275) {
            doc.addPage();
            y = 25;
            addTableHeader(doc, doc.internal.pages.length - 1);
          }
          doc.text(line, margin, y);
          y += 5.5;
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
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(234, 88, 12); // Brand Orange
      doc.text("ARKOO PREBUILD PVT. LTD.", margin, y);
      y += 5;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text("AI MEETING INTELLIGENCE REPORT", margin, y);
      y += 12;

      // Draw horizontal separator
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(0.4);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      // Metadata card grid
      doc.setFillColor(248, 250, 252); // slate-50 background
      doc.rect(margin, y, contentWidth, 42, "F");
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.rect(margin, y, contentWidth, 42, "S");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      
      let meetingDateStr = "Unknown Date";
      if (meeting.createdAt) {
        meetingDateStr = meeting.createdAt.toDate ? format(meeting.createdAt.toDate(), 'PPP p') : format(new Date(meeting.createdAt), 'PPP p');
      }

      const participantsList = (meeting.participants && Array.isArray(meeting.participants)) 
        ? meeting.participants.join(", ")
        : "Site Manager, Safety Officer, Civil Engineer, Stakeholders";

      doc.text(`Meeting Title: ${meeting.title || 'Untitled Meeting'}`, margin + 5, y + 8);
      doc.text(`Date & Time: ${meetingDateStr}`, margin + 5, y + 16);
      doc.text(`Duration: ${meeting.duration || '15 mins'} (Voice Captured)`, margin + 5, y + 24);
      doc.text(`Participants: ${participantsList}`, margin + 5, y + 32);
      doc.text(`AI Intelligence Engine: Gemini Core Active`, margin + 5, y + 38);
      y += 52;

      // Executive Summary Section
      printSectionHeader("Executive Summary");
      printBlock(meeting.summary || "No summary was generated during analytical collection.", false, 10, 6, "normal");

      // Minutes of Meeting (MOM) Section
      printSectionHeader("Minutes of Meeting (MOM)");
      
      // Since MOM is markdown formatted, let's clean up headers for raw TXT presentation
      const rawMom = (meeting.mom || "No MOM is available.")
        .replace(/###/g, "  •")
        .replace(/##/g, "")
        .replace(/#/g, "")
        .replace(/\*\*/g, "");
      printBlock(rawMom, false, 9.5, 10);

      // Task Allocation Section
      printSectionHeader("Action Item & Task Allocation");

      if (meetingTasks.length > 0) {
        meetingTasks.forEach((task: any, idx: number) => {
          if (y > 245) {
            doc.addPage();
            y = 25;
            addTableHeader(doc, doc.internal.pages.length - 1);
          }
          doc.setFillColor(248, 250, 252); // slate-50 card style
          doc.rect(margin, y, contentWidth, 24, "F");
          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.2);
          doc.rect(margin, y, contentWidth, 24, "S");
          
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(30, 58, 138); // Deep Blue For task title
          doc.text(`${idx + 1}. [${String(task.priority || 'medium').toUpperCase()}] ${task.title || 'Untitled Task'}`, margin + 4, y + 6);
          
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.5);
          doc.setTextColor(71, 85, 105);
          doc.text(`Assignee: ${task.assigneeName || 'Unassigned'} | Department: ${task.department || 'General'} | Deadline: ${formatDeadlineDisplay(task.deadline)}`, margin + 4, y + 12);
          
          const descText = task.description || 'No detailed instructions provided.';
          const truncatedDesc = descText.length > 115 ? descText.substring(0, 112) + "..." : descText;
          doc.text(`Instruction: ${truncatedDesc}`, margin + 4, y + 18);
          
          y += 28;
        });
      } else {
        printBlock("No dedicated action items or structured tasks were extracted from this conversation.", false, 10, 6, "italic");
      }

      // Full Transcript Section
      printSectionHeader("Full Meeting Transcript");
      printBlock(meeting.transcript || "No visual transcript data was available.", false, 9, 8);

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
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text("Generated automatically by Arkoo Meeting Intelligence AI Platform. End of security document.", margin, y);

      // 3. Save draft to browser
      const filename = `Arkoo_Report_${meeting.id}.pdf`;
      doc.save(filename);
      toast.success("Professional executive report downloaded successfully!", { id: loadingToast });

      // 4. Secure upload back to Firebase Storage (Automated synchronization)
      try {
        const pdfBlob = doc.output("blob");
        const dateStr = format(new Date(), 'yyyy-MM-dd');
        const pdfPath = `reports/${dateStr}/report_${meeting.id}_${Date.now()}.pdf`;
        const storageRef = ref(storage, pdfPath);
        const uploadSnapshot = await uploadBytes(storageRef, pdfBlob);
        const pdfUrl = await getDownloadURL(uploadSnapshot.ref);
        
        console.log("Successfully uploaded PDF report to Firebase Storage:", pdfUrl);
        toast.success("Synchronized secure PDF backup to cloud storage!");
        
        meeting.pdfUrl = pdfUrl;
        
        try {
          await updateDoc(firestoreDoc(db, "meetings", meeting.id), {
            pdfUrl: pdfUrl
          });
          console.log("Successfully updated pdfUrl on meeting document!");
        } catch (dbErr) {
          console.warn("pdfUrl update failed on client side:", dbErr);
        }
      } catch (pdfUploadErr: any) {
        console.error("Error uploading report PDF to Firebase Storage:", pdfUploadErr);
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

  const hostName = currentMeeting.hostName || currentMeeting.createdBy || 'Anusha Kanna';

  // For legacy meetings (old markdown mom format), build participants from available sources:
  // host name + unique task assignee names extracted from Firestore (passed via prop below)
  // For new structured meetings, use momData.participants directly
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
              <User className="w-4 h-4 text-orange-500" />
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
              <div className="w-6 h-6 rounded-lg bg-orange-100/70 text-orange-500 flex items-center justify-center text-sm">📄</div>
              Minutes of Meeting (MOM)
            </div>

            {/* MOM Meta Bar */}
            <div className="grid grid-cols-4 gap-0 bg-slate-50/80 rounded-xl border border-slate-100 divide-x divide-slate-100 overflow-hidden">
              <div className="p-4 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider"># MEETING TITLE</div>
                <div className="text-sm font-bold text-slate-900 truncate">{currentMeeting.title}</div>
              </div>
              <div className="p-4 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">📅 DATE</div>
                <div className="text-sm font-bold text-slate-900">{momDateStr}</div>
              </div>
              <div className="p-4 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">🕐 TIME</div>
                <div className="text-sm font-bold text-slate-900">{momTimeStr}</div>
              </div>
              <div className="p-4 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">👤 MEETING HOST</div>
                <div className="text-sm font-bold text-slate-900">{hostName}</div>
              </div>
            </div>

            {/* Participants with avatars */}
            {displayParticipants.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                    <User className="w-4 h-4 text-orange-500" /> Participants
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
                      <span className="w-5 h-5 rounded-full bg-orange-100 text-orange-600 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
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
                        <div className="text-xs text-orange-500 font-medium italic">{dp.summary}</div>
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
                <span className="text-base text-orange-500">→</span> Next Steps
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
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <div className="w-6 h-6 rounded-lg bg-blue-100/70 text-blue-500 flex items-center justify-center text-xs">💬</div>
                Full Meeting Transcript
              </div>
              <div className="bg-slate-900 text-slate-200 font-mono text-xs p-4 rounded-xl max-h-80 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                {currentMeeting.transcript}
              </div>
            </div>
          )}

          {/* Meeting Audio Player */}
          {currentMeeting.audioUrl && (
            <MeetingAudioPlayer audioUrl={currentMeeting.audioUrl} title={currentMeeting.title} />
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
            <div className="bg-orange-50/60 border border-orange-100 rounded-2xl p-5 shadow-sm">
              <div className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-2">Executive Summary</div>
              <p className="text-xs text-slate-700 leading-relaxed font-medium">{currentMeeting.summary}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function MeetingTasksSidebar({ meetingId, status }: { meetingId: string; status: string }) {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'tasks'), where('meetingId', '==', meetingId));
    const unsub = onSnapshot(q, (snap) => setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))), (err) => {
      handleFirestoreError(err, OperationType.LIST, `tasks_sidebar_${meetingId}`);
    });
    return unsub;
  }, [meetingId]);

  const priorityBadge = (p: string) => {
    if (p === 'high' || p === 'critical') return 'bg-red-50 text-red-500 border border-red-100';
    if (p === 'medium') return 'bg-amber-50 text-amber-600 border border-amber-100';
    return 'bg-slate-100 text-slate-500';
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 text-slate-900 font-bold text-sm border-b border-slate-100 pb-3 mb-3">
        <CheckCircle2 className="w-4 h-4 text-orange-500" />
        Tasks ({tasks.length})
      </div>

      {status === 'processing' ? (
        <div className="text-xs text-slate-400 text-center py-4 flex flex-col items-center gap-2">
          <span className="animate-spin h-4 w-4 border-2 border-brand-orange border-t-transparent rounded-full" />
          Extracting tasks from recording...
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-4">No tasks found for this meeting.</p>
      ) : (
        <div className="space-y-2.5">
          {tasks.map(task => (
            <div key={task.id} className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-start justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800 leading-snug">{task.title}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 capitalize ${priorityBadge(task.priority)}`}>
                {task.priority || 'medium'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingTasksTable({ meetingId, status }: { meetingId: string; status: string }) {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'tasks'), where('meetingId', '==', meetingId));
    const unsub = onSnapshot(q, (snap) => setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))), (err) => {
      handleFirestoreError(err, OperationType.LIST, `tasks_table_${meetingId}`);
    });
    return unsub;
  }, [meetingId]);

  if (status === 'processing') return null;
  if (tasks.length === 0) return null;

  const priorityBadge = (p: string) => {
    if (p === 'high' || p === 'critical') return 'bg-red-50 text-red-600 border border-red-100';
    if (p === 'medium') return 'bg-amber-50 text-amber-600 border border-amber-100';
    return 'bg-slate-100 text-slate-500';
  };

  const statusBadge = (s: string) => {
    if (s === 'completed') return 'bg-emerald-50 text-emerald-600 border border-emerald-100';
    return 'bg-slate-100 text-slate-500';
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center gap-2 font-semibold text-sm text-slate-800">
        <span className="text-base">📋</span> Action Items / Tasks Assigned
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="py-2.5 text-left w-6">#</th>
              <th className="py-2.5 text-left">Task Description</th>
              <th className="py-2.5 text-left">Assigned To</th>
              <th className="py-2.5 text-center">Priority</th>
              <th className="py-2.5 text-left">Deadline</th>
              <th className="py-2.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {tasks.map((task, i) => (
              <tr key={task.id} className="hover:bg-slate-50/60 transition-colors">
                <td className="py-3 text-slate-400 font-medium">{i + 1}</td>
                <td className="py-3 font-semibold text-slate-800 pr-4">{task.title}</td>
                <td className="py-3 text-slate-400 font-medium">{task.assigneeName || 'TBD'}</td>
                <td className="py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${priorityBadge(task.priority)}`}>
                    {task.priority || 'medium'}
                  </span>
                </td>
                <td className="py-3 text-slate-500 font-medium">
                  {task.deadline ? (
                    <span className="font-semibold text-slate-700">{formatDeadlineDisplay(task.deadline)}</span>
                  ) : (
                    <span className="text-slate-300 text-xs">Not specified</span>
                  )}
                </td>
                <td className="py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${statusBadge(task.status)}`}>
                    {task.status || 'Pending'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MeetingSummaryStats({ meetingId, keyDecisions, participants }: { meetingId: string; keyDecisions: string[]; participants: string[] }) {
  const [taskStats, setTaskStats] = useState({ total: 0, high: 0, withDeadlines: 0 });

  useEffect(() => {
    const q = query(collection(db, 'tasks'), where('meetingId', '==', meetingId));
    const unsub = onSnapshot(q, (snap) => {
      const tasks = snap.docs.map(d => d.data());
      setTaskStats({
        total: tasks.length,
        high: tasks.filter(t => t.priority === 'high' || t.priority === 'critical').length,
        withDeadlines: tasks.filter(t => t.deadline && t.deadline !== 'Not set' && t.deadline !== 'Pending').length
      });
    });
    return unsub;
  }, [meetingId]);

  const stats = [
    { label: 'Total Tasks', value: taskStats.total, color: 'text-orange-500' },
    { label: 'High Priority', value: taskStats.high, color: 'text-red-500' },
    { label: 'With Deadlines', value: taskStats.withDeadlines, color: 'text-amber-500' },
    { label: 'Decisions Made', value: keyDecisions.length, color: 'text-emerald-600' },
    { label: 'Participants', value: participants.length, color: 'text-blue-600' },
  ];

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center gap-2 font-semibold text-sm text-slate-800">
        <span className="text-base">📊</span> Summary
      </div>
      <div className="grid grid-cols-5 gap-3">
        {stats.map((s, i) => (
          <div key={i} className="bg-slate-50/80 rounded-xl p-3 text-center border border-slate-100">
            <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-[10px] font-semibold text-slate-400 mt-1 leading-tight">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MeetingAIChat({ meeting }: { meeting: any }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleAsk = async () => {
    if (!input.trim() || loading) return;
    
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch(getApiUrl('/api/ask-meeting'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          meetingData: { 
            mom: meeting.mom, 
            summary: meeting.summary, 
            transcript: meeting.transcript 
          }, 
          question: userMsg 
        }),
      });

      if (!res.ok) throw new Error('AI response failed');
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'ai', content: data.answer }]);
    } catch (error) {
      toast.error('AI assistant is busy. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[500px] bg-slate-50 rounded-3xl border border-slate-200 overflow-hidden shadow-inner">
      <div className="p-6 border-b bg-white flex items-center justify-between">
         <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-brand-orange flex items-center justify-center text-white">
               <BrainCircuit className="w-4 h-4" />
            </div>
            <div>
               <p className="text-xs font-black text-slate-900 uppercase tracking-widest">Meeting AI Assistant</p>
               <p className="text-[10px] text-brand-orange font-bold uppercase tracking-widest">Active & Informed</p>
            </div>
         </div>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
            <MessageSquare className="w-12 h-12 mb-4 text-slate-400" />
            <p className="text-sm font-bold uppercase tracking-widest text-slate-500">Ask anything about this meeting</p>
            <p className="text-[10px] max-w-xs mt-2 font-medium">Examples: "What were the main blockers mentioned?" or "Did we finalize the budget?"</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`
              max-w-[80%] p-4 rounded-2xl text-sm font-medium leading-relaxed
              ${m.role === 'user' ? 'bg-brand-blue text-white rounded-tr-none shadow-lg shadow-blue-100' : 'bg-white text-slate-700 rounded-tl-none border border-slate-200 shadow-sm'}
            `}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
             <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-slate-200 flex gap-1">
                <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" />
             </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-white border-t border-slate-100 flex gap-2">
        <Input 
          placeholder="Ask AI assistant about the discussion..." 
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAsk()}
          className="rounded-xl border-slate-200 h-11 focus:ring-brand-blue shadow-sm"
        />
        <Button onClick={handleAsk} disabled={loading} className="bg-brand-blue text-white rounded-xl h-11 px-6 shadow-lg shadow-blue-100 hover:bg-blue-700">
          Ask AI
        </Button>
      </div>
    </div>
  );
}

function MeetingTasks({ meetingId, status }: { meetingId: string, status: string }) {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'tasks'), where('meetingId', '==', meetingId));
    const unsubscribe = onSnapshot(q, (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `tasks_for_meeting_${meetingId}`);
    });
    return unsubscribe;
  }, [meetingId]);

  const deleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
      toast.success('Task deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `tasks/${taskId}`);
      toast.error('Delete failed');
    }
  };

  if (status === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-4">
        <div className="flex gap-2">
           <ClipboardCheck className="w-8 h-8 text-brand-blue animate-pulse" />
        </div>
        <p className="text-slate-400 text-sm italic">AI is extracting and allocating tasks from the audio...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tasks.length === 0 && <p className="text-slate-400 text-center py-10">No tasks extracted for this meeting.</p>}
      {tasks.map(task => (
        <div key={task.id} className="flex gap-4 p-5 rounded-2xl bg-white border border-slate-100 hover:border-slate-200 transition-all group">
          <div className={`mt-1 h-5 w-5 rounded-full border-2 flex items-center justify-center ${task.status === 'completed' ? 'border-green-500 bg-green-500 text-white' : 'border-slate-300'}`}>
            {task.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
          </div>
          <div className="flex-1">
             <div className="flex justify-between items-start">
                <h4 className="font-bold text-slate-900">{task.title}</h4>
                <div className="flex items-center gap-2">
                  <Badge className={`
                    text-[10px] uppercase font-bold
                    ${task.priority === 'high' || task.priority === 'critical' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}
                  `}>
                    {task.priority || 'Medium'}
                  </Badge>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => deleteTask(task.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
             </div>
             <p className="text-sm text-slate-600 mt-1">{task.description}</p>
             <div className="mt-4 flex items-center gap-6">
                <div className="flex items-center gap-2">
                   <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                     {task.assigneeName?.[0] || 'A'}
                   </div>
                   <span className="text-xs font-medium text-slate-500">{task.assigneeName || 'Unassigned'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                   <AlertCircle className="w-3 h-3" />
                   <span>{formatDeadlineDisplay(task.deadline)}</span>
                </div>
                <span className="text-[10px] font-bold text-brand-blue uppercase px-2 py-0.5 bg-brand-blue/5 rounded-md">
                  {task.department || 'General'}
                </span>
             </div>
          </div>
        </div>
      ))}
    </div>
  );
}
