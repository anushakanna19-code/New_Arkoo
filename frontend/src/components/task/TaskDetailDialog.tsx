// ─── Task Detail Dialog Component ───────────────────────────
// Extracted from TaskModule.tsx — zero behavior changes.
// Displays complete task details, metadata, Notes, Voice Notes, and Timeline tabs.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MessageSquare, Mic, History } from 'lucide-react';
import { format } from 'date-fns';
import { isOverdue, formatDeadlineDisplay } from '@/lib/date-utils';
import { auth } from '@/lib/firebase';
import { NotesSubSection } from './NotesSubSection';
import { VoiceSubSection } from './VoiceSubSection';
import { TimelineSubSection } from './TimelineSubSection';

interface TaskDetailDialogProps {
  selectedTask: any;
  onClose: () => void;
  profile: any;
  activeDetailTab: string;
  setActiveDetailTab: (tab: string) => void;
  logTaskActivity: (taskId: string, action: string) => Promise<void>;
  createNotification: (userId: string, title: string, message: string, type: string) => Promise<void>;
  getStatusColor: (status: string) => string;
}

export function TaskDetailDialog({
  selectedTask,
  onClose,
  profile,
  activeDetailTab,
  setActiveDetailTab,
  logTaskActivity,
  createNotification,
  getStatusColor
}: TaskDetailDialogProps) {
  if (!selectedTask) return null;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[92vw] sm:max-w-[90vw] md:max-w-[85vw] lg:max-w-[80vw] xl:max-w-[1100px] w-full max-h-[92vh] overflow-y-auto overflow-x-hidden rounded-2xl bg-white p-0 gap-0 shadow-2xl border border-slate-100">
        <DialogHeader className="p-6 border-b border-slate-100 bg-slate-50/50">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge variant="outline" className={`text-[10px] font-black uppercase ${getStatusColor(selectedTask.status)}`}>
              {selectedTask.status}
            </Badge>
            {isOverdue(selectedTask.deadline, selectedTask.status) && (
              <Badge className="bg-red-600 text-white text-[10px] font-black uppercase">Overdue</Badge>
            )}
            <Badge variant="secondary" className="text-[10px] font-black uppercase">
              {selectedTask.priority || 'medium'}
            </Badge>
          </div>
          <DialogTitle className="text-xl font-extrabold text-slate-900 pr-6">
            {selectedTask.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 leading-relaxed font-semibold mt-1">
            {selectedTask.description}
          </DialogDescription>
        </DialogHeader>

        {/* Split Grid for Metadata on left, interactive tabs on right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 border-b border-slate-100">

          {/* Left Column Metadata list (4/12 width) */}
          <div className="lg:col-span-4 p-6 bg-slate-50/40 border-r border-slate-100 space-y-6">
            {/* Status & Priority Badge Deck */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest block pl-0.5">Task Status & Priority</span>
              <div className="flex flex-wrap gap-2 bg-white p-3 rounded-xl border border-slate-100 shadow-xs">
                <div className="flex flex-col gap-1.5 flex-1 min-w-[80px]">
                  <span className="text-[9px] uppercase font-bold text-slate-400">Status</span>
                  <Badge variant="outline" className={`text-[10px] font-black uppercase justify-center inline-flex py-0.5 ${getStatusColor(selectedTask.status)}`}>
                    {selectedTask.status}
                  </Badge>
                  {isOverdue(selectedTask.deadline, selectedTask.status) && (
                    <Badge className="bg-red-600 text-white text-[9px] font-black uppercase justify-center py-0.5">Overdue</Badge>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-[80px] border-l border-slate-100 pl-3">
                  <span className="text-[9px] uppercase font-bold text-slate-400">Priority</span>
                  <Badge variant="secondary" className="text-[10px] font-black uppercase justify-center py-0.5">
                    {selectedTask.priority || 'medium'}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Assignee & Department Section */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest block pl-0.5">Assigned To</span>
              <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-slate-100 shadow-xs">
                <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center font-black text-blue-600 text-sm shrink-0 border border-blue-100">
                  {String(selectedTask.assigneeName || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-slate-800 truncate">{selectedTask.assigneeName || 'Unassigned'}</p>
                  <p className="text-[10px] text-slate-400 font-extrabold uppercase mt-0.5">{selectedTask.department || 'General'}</p>
                </div>
              </div>
            </div>

            {/* Important Dates */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest block pl-0.5">Important Dates</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-xs space-y-1">
                  <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider block">Due Date</span>
                  <span className="text-xs font-extrabold text-slate-800 block">
                    {formatDeadlineDisplay(selectedTask.deadline)}
                  </span>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-xs space-y-1">
                  <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider block">Created Date</span>
                  <span className="text-xs font-extrabold text-slate-800 block">
                    {selectedTask.createdAt?.toDate ? format(selectedTask.createdAt.toDate(), 'dd-MM-yy') : 'Today'}
                  </span>
                </div>
              </div>
            </div>

            {/* Audit Coordinates list */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest pl-0.5 block">Audit Coordinates</span>
              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-xs space-y-2 text-[11px] leading-relaxed text-slate-600">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-400 font-medium whitespace-nowrap">Created By (ID):</span>
                  <span className="font-bold truncate text-slate-700 max-w-[120px]" title={selectedTask.createdByUid}>{selectedTask.createdByUid || 'System'}</span>
                </div>
                <div className="flex justify-between items-center gap-2 border-t border-slate-50 pt-1.5">
                  <span className="text-slate-400 font-medium whitespace-nowrap">Creator Name:</span>
                  <span className="font-bold text-slate-700">{selectedTask.assignedByName || 'Manager'}</span>
                </div>
                {selectedTask.updatedAt && (
                  <div className="flex justify-between items-center gap-2 border-t border-slate-50 pt-1.5">
                    <span className="text-slate-400 font-medium whitespace-nowrap">Last Saved:</span>
                    <span className="font-bold text-slate-700 text-right">
                      {selectedTask.updatedAt?.toDate ? format(selectedTask.updatedAt.toDate(), 'PP p') : 'Just now'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column Interactive Tabs (8/12 width) */}
          <div className="lg:col-span-8 p-6 flex flex-col min-w-0">
            <Tabs value={activeDetailTab} onValueChange={setActiveDetailTab} className="w-full space-y-4">
              <TabsList className="flex flex-wrap items-center gap-2 bg-slate-100 p-1.5 rounded-xl !h-auto w-full justify-start border border-slate-200/50">
                <TabsTrigger value="notes" className="rounded-lg text-xs font-bold gap-2 px-3 py-2 flex items-center justify-center whitespace-normal min-h-[36px] flex-1 sm:flex-initial !h-auto text-slate-700">
                  <MessageSquare className="w-4 h-4 shrink-0" /> <span>Notes</span>
                </TabsTrigger>
                <TabsTrigger value="voice" className="rounded-lg text-xs font-bold gap-2 px-3 py-2 flex items-center justify-center whitespace-normal min-h-[36px] flex-1 sm:flex-initial !h-auto text-slate-700">
                  <Mic className="w-4 h-4 shrink-0" /> <span>Voice Notes</span>
                </TabsTrigger>
                <TabsTrigger value="timeline" className="rounded-lg text-xs font-bold gap-2 px-3 py-2 flex items-center justify-center whitespace-normal min-h-[36px] flex-1 sm:flex-initial !h-auto text-slate-700">
                  <History className="w-4 h-4 shrink-0" /> <span>Timeline Log</span>
                </TabsTrigger>
              </TabsList>

              {/* 1. Comments/Notes Section Panel */}
              <TabsContent value="notes" className="space-y-4 w-full">
                <NotesSubSection
                  taskId={selectedTask.id}
                  profile={profile}
                  onLogActivity={async (msg) => {
                    await logTaskActivity(selectedTask.id, msg);
                    if (selectedTask.assigneeUid && selectedTask.assigneeUid !== auth.currentUser?.uid) {
                      await createNotification(
                        selectedTask.assigneeUid,
                        'Task Comment Activity',
                        `${profile?.fullName || 'Manager'} modified comments on: ${selectedTask.title}`,
                        'comment'
                      );
                    }
                  }}
                />
              </TabsContent>

              {/* 2. Voice Assistant Section Panel */}
              <TabsContent value="voice" className="space-y-4 w-full">
                <VoiceSubSection
                  taskId={selectedTask.id}
                  profile={profile}
                  onLogActivity={async (msg) => {
                    await logTaskActivity(selectedTask.id, msg);
                    if (selectedTask.assigneeUid && selectedTask.assigneeUid !== auth.currentUser?.uid) {
                      await createNotification(
                        selectedTask.assigneeUid,
                        'Voice Note Uploaded',
                        `${profile?.fullName || 'Manager'} recorded a new voice memo for you on: ${selectedTask.title}`,
                        'voice'
                      );
                    }
                  }}
                />
              </TabsContent>

              {/* 3. Task Timeline list */}
              <TabsContent value="timeline" className="space-y-4 w-full">
                <TimelineSubSection taskId={selectedTask.id} />
              </TabsContent>

            </Tabs>
          </div>

        </div>

        <DialogFooter className="p-4 border-t bg-slate-50/50">
          <Button type="button" variant="ghost" className="rounded-xl font-bold text-xs" onClick={onClose}>
            Dismiss Details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
