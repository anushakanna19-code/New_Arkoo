// ─── Arkoo Prebuild — Shared Constants ──────────────────────
// Replaces magic strings scattered throughout the codebase.

import type { TaskPriority, TaskStatus, MeetingStatus, UserRole } from '@/types';

// ─── Status & Priority Constants ────────────────────────

export const TASK_STATUSES: readonly TaskStatus[] = ['pending', 'in-progress', 'completed'] as const;
export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'critical'] as const;
export const MEETING_STATUSES: readonly MeetingStatus[] = ['processing', 'completed', 'failed', 'deleted'] as const;
export const USER_ROLES: readonly UserRole[] = ['admin', 'manager', 'employee', 'vendor', 'supplier'] as const;

// ─── Priority Normalization ─────────────────────────────

const PRIORITY_ALIASES: Record<string, TaskPriority> = {
  normal: 'medium',
};

/** Normalize a raw priority string to a valid TaskPriority. Defaults to 'medium'. */
export function normalizePriority(raw: string | undefined | null): TaskPriority {
  if (!raw) return 'medium';
  const lower = raw.toLowerCase();
  if (PRIORITY_ALIASES[lower]) return PRIORITY_ALIASES[lower];
  if ((TASK_PRIORITIES as readonly string[]).includes(lower)) return lower as TaskPriority;
  return 'medium';
}

// ─── Role Checks ────────────────────────────────────────

export function isAdminRole(role: string | undefined | null): boolean {
  return String(role || '').toLowerCase() === 'admin';
}

export function isAdminOrManager(role: string | undefined | null): boolean {
  const r = String(role || '').toLowerCase();
  return r === 'admin' || r === 'manager';
}

export function isVendorOrSupplier(role: string | undefined | null): boolean {
  const r = String(role || '').toLowerCase();
  return r === 'vendor' || r === 'supplier';
}

// ─── Status Display Helpers ─────────────────────────────

export const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  pending: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
  'in-progress': { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
  processing: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100' },
  failed: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-100' },
  deleted: { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200' },
};

export const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  low: { bg: 'bg-slate-100', text: 'text-slate-600' },
  medium: { bg: 'bg-blue-100', text: 'text-blue-700' },
  high: { bg: 'bg-red-100', text: 'text-red-700' },
  critical: { bg: 'bg-red-100', text: 'text-red-700' },
};

// ─── Audio / Recording Constants ────────────────────────

export const CHUNK_DURATION_SEC = 12;
export const MAX_AUDIO_SIZE_MB = 20;
export const AUDIO_MIME_TYPES = {
  preferred: 'audio/webm;codecs=opus',
  fallbackWebm: 'audio/webm',
  fallbackMp4: 'audio/mp4',
} as const;
