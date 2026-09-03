// ─── Meeting Tasks Table Component ──────────────────────────
// Extracted from MeetingModule.tsx — zero behavior changes.
// Shows a detailed task table in the MeetingDetail main content area.

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { formatDeadlineDisplay } from '@/lib/date-utils';

export function MeetingTasksTable({ meetingId, status }: { meetingId: string; status: string }) {
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
