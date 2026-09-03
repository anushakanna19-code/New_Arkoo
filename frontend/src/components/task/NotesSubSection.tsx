// ─── Notes / Discussions Sub-Section Component ──────────────
// Extracted from TaskModule.tsx — zero behavior changes.
// Handles task notes, comments, edits, and deletions.

import { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc,
  addDoc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { MessageSquare, Check, X, Edit3, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { format } from 'date-fns';

export function NotesSubSection({ taskId, profile, onLogActivity }: { taskId: string; profile: any; onLogActivity: (m: string) => void }) {
  const [notes, setNotes] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'tasks', taskId, 'notes'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setNotes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error('Notes fetch error:', error);
    });
    return unsubscribe;
  }, [taskId]);

  const handlePostNote = async () => {
    if (!newComment.trim()) return;
    setLoading(true);
    try {
      const textToComment = newComment.trim();
      const docRef = await addDoc(collection(db, 'tasks', taskId, 'notes'), {
        taskId: taskId,
        userId: auth.currentUser?.uid || '',
        userName: profile?.fullName || auth.currentUser?.displayName || auth.currentUser?.email || 'Anonymous',
        userRole: profile?.role || 'User',
        content: textToComment,
        comment: textToComment, // kept for display backwards-compatibility
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Update with generated note ID
      await updateDoc(doc(db, 'tasks', taskId, 'notes', docRef.id), {
        noteId: docRef.id
      });

      setNewComment('');
      toast.success('Note published');
      onLogActivity(`Added note: "${textToComment.substring(0, 30)}..."`);
    } catch (e) {
      toast.error('Failed to post note');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdit = async (noteId: string) => {
    if (!editingText.trim()) return;
    try {
      await updateDoc(doc(db, 'tasks', taskId, 'notes', noteId), {
        content: editingText.trim(),
        comment: editingText.trim(), // kept for display backwards-compatibility
        updatedAt: serverTimestamp()
      });
      setEditingNoteId(null);
      toast.success('Note modified');
      onLogActivity('Edited note');
    } catch (e) {
      toast.error('Edit failed');
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Are you sure you want to delete this note?')) return;
    try {
      await deleteDoc(doc(db, 'tasks', taskId, 'notes', noteId));
      toast.success('Note deleted');
      onLogActivity('Deleted a note');
    } catch (e) {
      toast.error('Failed to delete note');
    }
  };

  const currentUid = auth.currentUser?.uid;
  const isAuthorized = (item: any) => {
    const isOwner = item.userId === currentUid;
    const isAdmin = String(profile?.role).toLowerCase() === 'admin';
    const isManagement = String(profile?.role).toLowerCase() === 'management';
    return isOwner || isAdmin || isManagement;
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-2 border-b pb-2">
        <MessageSquare className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-black uppercase text-slate-700 tracking-wider">Notes & Comments ({notes.length})</span>
      </div>

      {/* Write block */}
      <div className="flex gap-2 w-full">
        <Input
          placeholder="Type a note or comment for the team..."
          value={newComment}
          onChange={e => setNewComment(e.target.value)}
          disabled={loading}
          onKeyDown={e => { if (e.key === 'Enter') handlePostNote(); }}
          className="rounded-xl h-11 border-slate-200 text-xs flex-1 bg-slate-50/50 focus:bg-white transition-all w-full"
        />
        <Button onClick={handlePostNote} disabled={loading} className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs h-11 rounded-xl px-5">
          {loading ? 'Posting...' : 'Publish Note'}
        </Button>
      </div>

      {/* List block */}
      <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
        {notes.length === 0 ? (
          <div className="text-center py-10 bg-slate-50/30 rounded-2xl border border-dashed border-slate-200">
            <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400 italic">No team notes logged yet.</p>
          </div>
        ) : (
          notes.map(note => (
            <div key={note.id} className="bg-white p-4 rounded-xl border border-slate-100 shadow-xs relative group/msg hover:border-slate-200 transition-all">
              <div className="flex flex-wrap items-center justify-between text-[10px] font-bold text-slate-400 mb-2 gap-1.5 border-b border-slate-50 pb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-slate-800 font-extrabold">{note.userName}</span>
                  {note.userRole && (
                    <Badge variant="outline" className={`text-[8px] px-1.5 py-0 uppercase font-black tracking-widest ${String(note.userRole).toLowerCase() === 'admin' || String(note.userRole).toLowerCase() === 'management'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-slate-100 text-slate-600'
                      }`}>
                      {note.userRole}
                    </Badge>
                  )}
                </div>
                <span className="text-slate-400">
                  {note.createdAt?.toDate ? format(note.createdAt.toDate(), 'PP p') : 'Just now'}
                </span>
              </div>

              {editingNoteId === note.id ? (
                <div className="flex gap-1.5 mt-1 pb-1">
                  <Input
                    value={editingText}
                    onChange={e => setEditingText(e.target.value)}
                    className="h-9 text-xs bg-white border-slate-200 rounded-lg flex-1"
                  />
                  <Button size="sm" onClick={() => handleSaveEdit(note.id)} className="h-9 bg-green-600 hover:bg-green-700 text-white rounded-lg px-2"><Check className="w-3.5 h-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingNoteId(null)} className="h-9 rounded-lg px-2 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></Button>
                </div>
              ) : (
                <p className="text-xs text-slate-600 leading-relaxed font-semibold break-words pr-12 pb-1">{note.comment || note.content}</p>
              )}

              {isAuthorized(note) && editingNoteId !== note.id && (
                <div className="absolute right-2.5 bottom-2.5 opacity-0 group-hover/msg:opacity-100 transition-opacity flex gap-1 bg-white/90 p-0.5 rounded shadow-xs">
                  <button
                    onClick={() => { setEditingNoteId(note.id); setEditingText(note.comment || note.content || ''); }}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-sky-600 transition-all cursor-pointer"
                    title="Edit Note"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-red-500 transition-all cursor-pointer"
                    title="Delete Note"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
