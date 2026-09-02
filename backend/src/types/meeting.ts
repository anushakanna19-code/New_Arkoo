// ─── Meeting Types ─────────────────────────────────────────

export interface MeetingProcessRequest {
  meetingId: string;
  audioBase64?: string;
  title?: string;
  mimeType?: string;
  audioUrl?: string;
  preTranscribedText?: string;
  driveFileUrl?: string;
  googleAccessToken?: string;
  knownNames?: string;
}

export interface MeetingResult {
  transcript: string;
  summary: string;
  mom: MomData;
  tasks: TaskData[];
}

export interface MomData {
  participants: string[];
  agenda: string[];
  discussionPoints: DiscussionPoint[];
  keyDecisions: string[];
  risks: string[];
  nextSteps: string[];
}

export interface DiscussionPoint {
  topic: string;
  summary: string;
  points: string[];
}

export interface TaskData {
  title: string;
  description: string;
  assigneeName: string;
  assigneeEmail?: string;
  department: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  deadline: string;
  meetingTitle?: string;
}

export interface TaskEmailPayload {
  title: string;
  description: string;
  assigneeName: string;
  assigneeEmail?: string;
  deadline: any;
  priority: string;
  department: string;
  meetingTitle?: string;
}
