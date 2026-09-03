// ─── Timeline / Activity Logs Sub-Section Component ─────────
// Extracted from TaskModule.tsx — zero behavior changes.
// Displays audit activities for a specific task chronologically.

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Activity } from 'lucide-react';
import { format } from 'date-fns';

export function TimelineSubSection({ taskId }: { taskId: string }) {
  const [activities, setActivities] = useState<any[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'tasks', taskId, 'activities'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error('Activities fetch error:', error);
    });
    return unsubscribe;
  }, [taskId]);

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-2 border-b pb-2">
        <Activity className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-black uppercase text-slate-700 tracking-wider">Chronological Timeline logs ({activities.length})</span>
      </div>

      <div className="space-y-5 relative pl-4 border-l border-slate-200 mt-2 max-h-[440px] overflow-y-auto pr-1 py-1">
        {activities.length === 0 ? (
          <div className="text-center py-10 bg-slate-50/30 rounded-2xl border border-dashed border-slate-200">
            <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400 italic">No historical activities saved yet.</p>
          </div>
        ) : (
          activities.map((item, idx) => (
            <div key={item.id || idx} className="relative group text-left pb-1">
              {/* Timeline marker */}
              <span className="absolute -left-[20px] top-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-slate-300 ring-4 ring-white group-hover:bg-blue-600 transition-all duration-300" />

              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                <span className="font-extrabold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded uppercase tracking-wider">
                  {item.timestamp?.toDate ? format(item.timestamp.toDate(), 'PP') : 'Today'}
                </span>
                <span>•</span>
                <span className="text-slate-400">
                  {item.timestamp?.toDate ? format(item.timestamp.toDate(), 'p') : 'Just now'}
                </span>
              </div>

              <p className="text-xs font-black text-slate-800 leading-snug mt-1.5">
                {item.action}
              </p>

              <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-wider">
                BY: <span className="text-slate-600 font-black">{item.userName}</span>
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
