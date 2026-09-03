// ─── Meeting Tasks Sidebar Component ────────────────────────
// Extracted from MeetingModule.tsx — zero behavior changes.
// Shows task list in the right sidebar of MeetingDetail.

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CheckCircle2 } from 'lucide-react';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';

export function MeetingTasksSidebar({ meetingId, status }: { meetingId: string; status: string }) {
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
        <CheckCircle2 className="w-4 h-4 text-blue-500" />
        Tasks ({tasks.length})
      </div>

      {status === 'processing' ? (
        <div className="text-xs text-slate-400 text-center py-4 flex flex-col items-center gap-2">
          <span className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
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
