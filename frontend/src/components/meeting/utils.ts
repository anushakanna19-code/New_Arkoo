// ─── Meeting Utility Functions ──────────────────────────────
// Extracted from MeetingModule.tsx — zero behavior changes.

import type { Employee, Meeting, UserProfile } from '@/types';

/**
 * Resolves the display name for a meeting's host using a multi-step fallback strategy:
 * 1. Explicit hostName field (skip dummy defaults)
 * 2. createdBy field
 * 3. Employee directory lookup by UID
 * 4. Employee directory lookup by email
 * 5. Explicit hostName/createdBy (even dummy defaults)
 * 6. Logged-in user profile fallback
 */
export const resolveHostName = (meeting: any, employees: any[] = [], profile?: any) => {
  if (!meeting) return 'Unknown Host';

  // 1. Check if meeting has a valid hostName set (and not generic dummy default)
  if (meeting.hostName && String(meeting.hostName).trim() && meeting.hostName !== 'Anusha Kanna') {
    return String(meeting.hostName).trim();
  }

  // 2. Check if meeting has a valid createdBy set
  if (meeting.createdBy && String(meeting.createdBy).trim() && meeting.createdBy !== 'Anusha Kanna') {
    return String(meeting.createdBy).trim();
  }

  // 3. Look up creator in employees directory by UID
  const creatorId = meeting.creatorId || meeting.userId || meeting.createdByUid;
  if (creatorId) {
    const matchedEmp = employees.find((e: any) => e.uid === creatorId || e.id === creatorId);
    if (matchedEmp && matchedEmp.fullName) {
      return matchedEmp.fullName;
    }
    if (profile && (profile.uid === creatorId || profile.id === creatorId)) {
      return profile.fullName || profile.displayName || profile.name || 'Host';
    }
  }

  // 4. Look up creator by email in employees directory
  const creatorEmail = String(meeting.creatorEmail || meeting.userEmail || meeting.createdByEmail || '').trim().toLowerCase();
  if (creatorEmail) {
    const matchedEmp = employees.find((e: any) => 
      String(e.email || '').trim().toLowerCase() === creatorEmail ||
      String(e.personalEmail || '').trim().toLowerCase() === creatorEmail
    );
    if (matchedEmp && matchedEmp.fullName) {
      return matchedEmp.fullName;
    }
    if (profile && String(profile.email || '').trim().toLowerCase() === creatorEmail) {
      return profile.fullName || profile.displayName || profile.name || 'Host';
    }
    const emailPrefix = creatorEmail.split('@')[0];
    if (emailPrefix) {
      const cleanName = emailPrefix.split('.')[0];
      return cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    }
  }

  // 5. If hostName or createdBy exists explicitly
  if (meeting.hostName && String(meeting.hostName).trim()) {
    return String(meeting.hostName).trim();
  }
  if (meeting.createdBy && String(meeting.createdBy).trim()) {
    return String(meeting.createdBy).trim();
  }

  // 6. Dynamic fallback from logged-in user profile
  return profile?.fullName || profile?.displayName || 'Host';
};

/** Format seconds to MM:SS */
export const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};
