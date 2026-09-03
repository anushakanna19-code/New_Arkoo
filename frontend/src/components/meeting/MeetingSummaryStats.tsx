// ─── Meeting Summary Stats Component ────────────────────────
// Extracted from MeetingModule.tsx — zero behavior changes.
// Shows stats grid (total tasks, high priority, deadlines, decisions, participants).

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export function MeetingSummaryStats({ meetingId, keyDecisions, participants }: { meetingId: string; keyDecisions: string[]; participants: string[] }) {
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
    { label: 'Total Tasks', value: taskStats.total, color: 'text-blue-500' },
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
