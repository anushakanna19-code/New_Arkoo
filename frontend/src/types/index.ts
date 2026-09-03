// ─── Arkoo Prebuild — Shared Type Definitions ──────────────
// These types replace 'any' usage throughout the frontend.
// They mirror the actual Firestore document shapes.

import { Timestamp } from 'firebase/firestore';

// ─── User & Auth ────────────────────────────────────────

export type UserRole = 'admin' | 'manager' | 'employee' | 'vendor' | 'supplier';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string;
  role: UserRole;
  department: string;
  stakeholderType: string;
  isActive: boolean;
  employeeId?: string;
  fullName?: string;
}

// ─── Meeting ────────────────────────────────────────────

export type MeetingStatus = 'processing' | 'completed' | 'failed' | 'deleted';

export interface MeetingMOM {
  attendees?: string[];
  agendaItems?: string[];
  keyDecisions?: string[];
  nextSteps?: string[];
  actionItems?: string[];
  [key: string]: unknown;
}

export interface Meeting {
  id: string;
  title: string;
  status: MeetingStatus;
  createdAt?: Timestamp | { seconds: number; nanoseconds: number } | null;
  hostName?: string;
  createdBy?: string;
  creatorId?: string;
  creatorEmail?: string;
  userEmail?: string;
  createdByEmail?: string;
  createdByUid?: string;
  userId?: string;
  duration?: string;
  audioUrl?: string;
  transcript?: string;
  mom?: MeetingMOM | string | null;
  momText?: string | null;
  summary?: string;
  tasksCount?: number;
  driveFileId?: string;
  driveFileUrl?: string;
  gdriveUploadStatus?: string;
  gdriveUploadTimestamp?: Timestamp | null;
  gdriveFolderId?: string;
  gdriveLeafFolderId?: string;
  isDeleted?: boolean;
  deletedAt?: Timestamp | null;
  processedAt?: Timestamp | null;
  failureReason?: string;
}

// ─── Task ───────────────────────────────────────────────

export type TaskStatus = 'pending' | 'in-progress' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeName: string;
  department: string;
  meetingId?: string;
  deadline?: Timestamp | string | null;
  deadlineTimestamp?: Timestamp | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  isDeleted?: boolean;
  deletedAt?: Timestamp | null;
  createdByUid?: string;
  assigneeUid?: string;
  assignedByUid?: string;
  assigneeEmail?: string;
  email?: string;
}

// ─── Employee / Stakeholder ─────────────────────────────

export interface Employee {
  id: string;
  fullName: string;
  email?: string;
  personalEmail?: string;
  department?: string;
  role?: string;
  stakeholderType?: string;
  status?: string;
  isActive?: boolean;
  uid?: string;
}

// ─── Notification ───────────────────────────────────────

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt?: Timestamp | null;
}

// ─── Task Activity Log ──────────────────────────────────

export interface TaskActivity {
  id: string;
  userId: string;
  userName: string;
  action: string;
  timestamp?: Timestamp | null;
}

// ─── Live Caption (Recording) ───────────────────────────

export interface LiveCaption {
  index: number;
  text: string;
}

// ─── Google Drive State ─────────────────────────────────

export interface GDriveState {
  connected: boolean;
  isOauthConfigured?: boolean;
  userEmail?: string;
  folderId?: string;
  lastSynced?: string | null;
}

// ─── Dashboard Stats ────────────────────────────────────

export interface DashboardStats {
  totalMeetings: number;
  totalTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  delayedTasks: number;
}

// ─── Alert ──────────────────────────────────────────────

export interface DashboardAlert {
  type: string;
  title: string;
  subtitle: string;
  detail: string;
  color: string;
}
