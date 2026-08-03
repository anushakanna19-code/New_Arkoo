import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { toast } from 'sonner';
import { Trash2, RotateCcw, Video, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';

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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-orange"></div>
        <p className="mt-4 text-slate-500 font-medium">Loading deleted items...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pt-4 font-sans px-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Trash2 className="w-8 h-8 text-brand-orange" /> Recycle Bin
          </h2>
          <p className="text-slate-500 mt-1">Manage deleted meetings and tasks.</p>
        </div>
        
        {deletedMeetings.length > 0 && (
          <Button 
            variant="destructive" 
            className="rounded-xl h-10 px-6 text-xs font-bold uppercase tracking-widest bg-red-600 hover:bg-red-700 shadow-sm whitespace-nowrap"
            onClick={() => setConfirmDeleteAll(true)}
          >
            Empty Recycle Bin
          </Button>
        )}
      </div>

      {confirmDeleteAll && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-6 shadow-sm mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-red-900">Are you absolutely sure?</h4>
              <p className="text-xs text-red-700 mt-0.5">This will permanently delete all {deletedMeetings.length} items. This action cannot be undone.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-9 px-4 text-xs font-semibold rounded-xl bg-white text-slate-700" onClick={() => setConfirmDeleteAll(false)}>Cancel</Button>
            <Button variant="destructive" className="h-9 px-4 text-xs font-semibold rounded-xl" onClick={emptyRecycleBin}>Yes, Empty Bin</Button>
          </div>
        </div>
      )}

      {deletedMeetings.length === 0 ? (
        <div className="bg-white border border-slate-200/80 rounded-3xl p-12 text-center shadow-sm max-w-2xl mx-auto mt-12">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Trash2 className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">Recycle Bin is Empty</h3>
          <p className="text-slate-500 text-sm">Any deleted meetings will appear here. Items can be restored or permanently deleted.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {deletedMeetings.map(meeting => (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              key={meeting.id}
            >
              <Card className="border border-slate-200/80 shadow-sm rounded-2xl bg-white overflow-hidden hover:shadow-md transition-shadow h-full flex flex-col">
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                      <Video className="w-5 h-5 text-red-500" />
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Deleted On</div>
                      <div className="text-xs font-semibold text-slate-700">
                        {meeting.deletedAt?.toDate ? format(meeting.deletedAt.toDate(), 'MMM d, yyyy') : 'Unknown'}
                      </div>
                    </div>
                  </div>
                  
                  <h3 className="text-base font-bold text-slate-900 line-clamp-2 leading-snug mb-2">{meeting.title}</h3>
                  <div className="text-xs text-slate-500 mb-4">
                    Host: {meeting.hostName || meeting.createdBy || 'Unknown'}
                  </div>
                  
                  <div className="mt-auto pt-4 flex gap-2">
                    <Button 
                      variant="outline" 
                      className="flex-1 h-9 rounded-xl border-slate-200 text-slate-600 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 text-xs font-semibold transition-colors cursor-pointer"
                      onClick={() => restoreMeeting(meeting.id)}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Restore
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="w-9 h-9 p-0 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                      title="Permanently Delete"
                      onClick={() => permanentlyDeleteMeeting(meeting.id)}
                    >
                      <Trash2 className="w-4 h-4" />
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
