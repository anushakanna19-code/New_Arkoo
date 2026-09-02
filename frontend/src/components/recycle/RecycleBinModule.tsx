import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { toast } from 'sonner';
import { Trash2, RotateCcw, Video, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { motion } from 'motion/react';

export function RecycleBinModule({ profile }: { profile: any }) {
  const [deletedMeetings, setDeletedMeetings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  useEffect(() => {
    // Query for soft-deleted meetings
    const q = query(
      collection(db, 'meetings'),
      where('isDeleted', '==', true)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort client-side safely
      data.sort((a: any, b: any) => {
        const timeA = a.deletedAt?.seconds || 0;
        const timeB = b.deletedAt?.seconds || 0;
        return timeB - timeA; // most recently deleted first
      });
      setDeletedMeetings(data);
      setIsLoading(false);
    }, (error) => {
      console.warn('Firestore recycle bin listener error:', error);
      handleFirestoreError(error, OperationType.LIST, 'meetings');
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const restoreMeeting = async (id: string) => {
    const loadingToast = toast.loading('Restoring meeting...');
    try {
      // 1. Restore associated tasks
      const tasksQ = query(collection(db, 'tasks'), where('meetingId', '==', id), where('isDeleted', '==', true));
      const tasksSnap = await getDocs(tasksQ);
      if (tasksSnap.size > 0) {
        const restorePromises = tasksSnap.docs.map(d => updateDoc(doc(db, 'tasks', d.id), {
          isDeleted: false,
          deletedAt: null
        }));
        await Promise.all(restorePromises);
      }

      // 2. Restore meeting
      await updateDoc(doc(db, 'meetings', id), {
        status: 'completed', // Assuming it was completed before delete
        isDeleted: false,
        deletedAt: null
      });
      
      toast.success('Meeting restored successfully', { id: loadingToast });
    } catch (error: any) {
      toast.error('Failed to restore meeting', { id: loadingToast });
      handleFirestoreError(error, OperationType.WRITE, `meetings/${id}`);
    }
  };

  const permanentlyDeleteMeeting = async (id: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this meeting? This action cannot be undone.")) return;
    
    const loadingToast = toast.loading('Permanently deleting...');
    try {
      // 1. Delete associated tasks permanently
      const tasksQ = query(collection(db, 'tasks'), where('meetingId', '==', id));
      const tasksSnap = await getDocs(tasksQ);
      if (tasksSnap.size > 0) {
        const deletePromises = tasksSnap.docs.map(d => deleteDoc(doc(db, 'tasks', d.id)));
        await Promise.all(deletePromises);
      }

      // 2. Delete meeting permanently
      await deleteDoc(doc(db, 'meetings', id));
      
      toast.success('Meeting permanently deleted', { id: loadingToast });
    } catch (error: any) {
      toast.error('Failed to permanently delete', { id: loadingToast });
      handleFirestoreError(error, OperationType.WRITE, `meetings/${id}`);
    }
  };

  const emptyRecycleBin = async () => {
    setConfirmDeleteAll(false);
    const loadingToast = toast.loading('Emptying recycle bin...');
    try {
      for (const meeting of deletedMeetings) {
        // Delete associated tasks permanently
        const tasksQ = query(collection(db, 'tasks'), where('meetingId', '==', meeting.id));
        const tasksSnap = await getDocs(tasksQ);
        if (tasksSnap.size > 0) {
          const deletePromises = tasksSnap.docs.map(d => deleteDoc(doc(db, 'tasks', d.id)));
          await Promise.all(deletePromises);
        }
        // Delete meeting permanently
        await deleteDoc(doc(db, 'meetings', meeting.id));
      }
      toast.success('Recycle bin emptied', { id: loadingToast });
    } catch (error: any) {
      toast.error('Failed to empty recycle bin', { id: loadingToast });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh]">
        <div className="animate-spin rounded-full h-7 w-7 border-2 border-blue-500 border-t-transparent"></div>
        <p className="mt-3 text-[13px] text-slate-500">Loading deleted items...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Recycle Bin</h2>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">Manage and recover deleted meetings and tasks.</p>
        </div>
        
        {deletedMeetings.length > 0 && (
          <Button 
            className="rounded-lg h-10 px-4 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-500/20 whitespace-nowrap cursor-pointer w-full sm:w-auto justify-center flex items-center gap-2 border-0"
            onClick={() => setConfirmDeleteAll(true)}
          >
            <Trash2 className="w-4 h-4 text-white" />
            <span className="text-white font-bold">Empty Recycle Bin</span>
          </Button>
        )}
      </div>

      {confirmDeleteAll && (
        <Card className="border-red-200 bg-red-50/50 rounded-2xl">
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-red-900">Permanently delete all {deletedMeetings.length} items?</p>
                <p className="text-[11px] text-red-600 mt-0.5 font-medium">This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-2 w-full sm:w-auto shrink-0 justify-end">
              <Button variant="outline" size="sm" className="rounded-lg text-xs font-bold bg-white text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer flex-1 sm:flex-initial h-9 px-4" onClick={() => setConfirmDeleteAll(false)}>Cancel</Button>
              <Button size="sm" className="rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 text-white cursor-pointer flex-1 sm:flex-initial h-9 px-4 border-0" onClick={emptyRecycleBin}>Delete All</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {deletedMeetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 border border-blue-100">
            <Trash2 className="w-7 h-7 text-blue-600" />
          </div>
          <h3 className="text-base font-bold text-slate-800 mb-1">Recycle Bin is Empty</h3>
          <p className="text-xs text-slate-400 font-medium">Deleted meetings will appear here for recovery.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {deletedMeetings.map(meeting => (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              key={meeting.id}
            >
              <Card className="h-full flex flex-col rounded-2xl border-slate-200 shadow-xs hover:shadow-md transition-all bg-white">
                <CardContent className="p-4 sm:p-5 flex flex-col h-full">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
                      <Video className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Deleted</div>
                      <div className="text-xs font-bold text-slate-700">
                        {meeting.deletedAt?.toDate ? format(meeting.deletedAt.toDate(), 'MMM d, yyyy') : 'Unknown'}
                      </div>
                    </div>
                  </div>
                  
                  <h3 className="text-sm font-bold text-slate-900 line-clamp-2 leading-snug mb-1">{meeting.title}</h3>
                  <p className="text-xs text-slate-400 mb-4 font-medium">
                    Host: <span className="text-slate-600 font-semibold">{meeting.hostName || meeting.createdBy || 'Unknown'}</span>
                  </p>
                  
                  <div className="mt-auto pt-3 border-t border-slate-100 flex gap-2">
                    <Button 
                      size="sm"
                      className="flex-1 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer justify-center flex items-center gap-1.5 h-9"
                      onClick={() => restoreMeeting(meeting.id)}
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-white" />
                      <span className="text-white font-bold">Restore</span>
                    </Button>
                    <Button 
                      variant="outline" 
                      size="icon-sm"
                      className="rounded-lg text-red-500 border-red-200 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer h-9 w-9 shrink-0"
                      title="Permanently Delete"
                      onClick={() => permanentlyDeleteMeeting(meeting.id)}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
