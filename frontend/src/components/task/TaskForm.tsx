// ─── Task Form Component ──────────────────────────────────
// Extracted from TaskModule.tsx — zero behavior changes.
// Used for creating and editing tasks.

import { useState } from 'react';
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { getApiUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { parseFirestoreDate, parseInputDate } from '@/lib/date-utils';

export function TaskForm({ task, profile, employees, onSuccess }: { task?: any; profile: any; employees: any[]; onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const userRole = String(profile?.role || '').toLowerCase();
  const isVendorOrSupplier = userRole === 'vendor' || userRole === 'supplier';

  const [formData, setFormData] = useState({
    title: task?.title || '',
    description: task?.description || '',
    assigneeName: task?.assigneeName || '',
    department: task?.department || 'Production',
    priority: task?.priority || 'medium',
    status: task?.status || 'pending',
    deadline: task?.deadline
      ? format(parseFirestoreDate(task.deadline) || new Date(), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd')
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.assigneeName && !isVendorOrSupplier) {
      toast.error('Please assign this task to an employee');
      return;
    }
    setLoading(true);
    const isUpdate = !!task?.id;
    try {
      const deadlineDate = parseInputDate(formData.deadline);
      const matchedEmp = employees.find(emp => emp.fullName === formData.assigneeName);

      const payload: any = isVendorOrSupplier ? {
        status: formData.status,
        updatedAt: serverTimestamp()
      } : {
        title: formData.title,
        description: formData.description,
        assigneeName: formData.assigneeName,
        assigneeUid: matchedEmp?.userId || matchedEmp?.id || '',
        department: formData.department,
        priority: formData.priority,
        status: formData.status,
        deadline: Timestamp.fromDate(deadlineDate),
        updatedAt: serverTimestamp(),
        assignedByName: profile?.fullName || auth.currentUser?.displayName || 'Manager',
        assignedByUid: auth.currentUser?.uid || ''
      };

      if (isUpdate) {
        await updateDoc(doc(db, 'tasks', task.id), payload);
        toast.success('Task updated successfully');
      } else {
        await addDoc(collection(db, 'tasks'), {
          ...payload,
          createdByUid: auth.currentUser?.uid || '',
          createdByEmail: auth.currentUser?.email || '',
          createdByName: profile?.fullName || auth.currentUser?.displayName || 'System',
          createdAt: serverTimestamp()
        });
        toast.success('Task successfully indexed');
      }

      // Dispatch task assignment email notification to stakeholder
      if (formData.assigneeName && formData.assigneeName !== 'Unassigned') {
        const recipientEmail = matchedEmp?.email || matchedEmp?.personalEmail || '';
        fetch(getApiUrl('/api/send-task-email'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: formData.title,
            description: formData.description,
            assigneeName: formData.assigneeName,
            assigneeEmail: recipientEmail,
            priority: formData.priority,
            department: formData.department,
            deadline: formData.deadline,
            meetingTitle: 'Task Assignment'
          })
        }).catch(err => console.error('Task email notification error:', err));
      }

      onSuccess();
    } catch (error) {
      handleFirestoreError(error, isUpdate ? OperationType.UPDATE : OperationType.CREATE, isUpdate ? `tasks/${task.id}` : 'tasks');
      toast.error(isUpdate ? 'Failed to update task' : 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      {isVendorOrSupplier && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-semibold text-amber-800 mb-2">
          ℹ️ Vendor & Supplier accounts can update task Status and Notes. Other fields are read-only.
        </div>
      )}

      {/* Task Status Dropdown */}
      <div className="space-y-1.5">
        <Label htmlFor="status" className="text-xs font-bold text-slate-700">Task Status</Label>
        <Select value={formData.status} onValueChange={val => setFormData({ ...formData, status: val })}>
          <SelectTrigger className="rounded-xl border-slate-200 h-10">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent className="z-[60]">
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in-progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="delayed">Delayed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="title" className="text-xs font-bold text-slate-700">Task Title</Label>
        <Input
          id="title"
          required
          disabled={isVendorOrSupplier}
          value={formData.title}
          onChange={e => setFormData({ ...formData, title: e.target.value })}
          className="rounded-xl h-10 border-slate-200"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description" className="text-xs font-bold text-slate-700">Brief Scope Description</Label>
        <Input
          id="description"
          required
          disabled={isVendorOrSupplier}
          value={formData.description}
          onChange={e => setFormData({ ...formData, description: e.target.value })}
          className="rounded-xl h-10 border-slate-200"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="assignee" className="text-xs font-bold text-slate-700">Assignee</Label>
          <Select
            disabled={isVendorOrSupplier}
            value={formData.assigneeName}
            onValueChange={val => {
              const matchedEmp = employees.find(e => e.fullName === val);
              setFormData({
                ...formData,
                assigneeName: val,
                department: matchedEmp ? (matchedEmp.department || 'Production') : formData.department
              });
            }}
          >
            <SelectTrigger className="rounded-xl border-slate-200 dialog-trigger select-trigger h-10">
              <SelectValue placeholder="Assign employee" />
            </SelectTrigger>
            <SelectContent className="z-[60]">
              {employees.length === 0 ? (
                <SelectItem value="..." disabled>Loading employees...</SelectItem>
              ) : (
                employees.map(e => (
                  <SelectItem key={e.id} value={e.fullName}>{e.fullName}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dept" className="text-xs font-bold text-slate-700">Department</Label>
          <Select disabled={isVendorOrSupplier} value={formData.department} onValueChange={val => setFormData({ ...formData, department: val })}>
            <SelectTrigger className="rounded-xl border-slate-200 h-10">
              <SelectValue placeholder="Select unit" />
            </SelectTrigger>
            <SelectContent className="z-[60]">
              <SelectItem value="Production">Production</SelectItem>
              <SelectItem value="Sourcing">Sourcing</SelectItem>
              <SelectItem value="Management">Management</SelectItem>
              <SelectItem value="Design">Design</SelectItem>
              <SelectItem value="Quality Control">Quality Control</SelectItem>
              <SelectItem value="Project">Project</SelectItem>
              <SelectItem value="Accounts">Accounts</SelectItem>
              <SelectItem value="HR">HR</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="priority" className="text-xs font-bold text-slate-700">Priority Tier</Label>
          <Select disabled={isVendorOrSupplier} value={formData.priority} onValueChange={val => setFormData({ ...formData, priority: val })}>
            <SelectTrigger className="rounded-xl border-slate-200 h-10">
              <SelectValue placeholder="Priority Level" />
            </SelectTrigger>
            <SelectContent className="z-[60]">
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deadline" className="text-xs font-bold text-slate-700">Deadline Target</Label>
          <Input
            id="deadline"
            type="date"
            required
            disabled={isVendorOrSupplier}
            value={formData.deadline}
            onChange={e => setFormData({ ...formData, deadline: e.target.value })}
            className="rounded-xl font-medium border-slate-200 h-10"
          />
        </div>
      </div>
      <DialogFooter className="pt-4 border-t gap-2 md:gap-0">
        <Button type="button" variant="ghost" onClick={onSuccess} className="rounded-xl h-10 font-bold text-xs">Cancel</Button>
        <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700 font-bold px-8 text-white h-10 rounded-xl shadow-md shadow-blue-500/20">
          {loading ? 'indexing...' : (task?.id ? 'Save Changes' : 'Create Task')}
        </Button>
      </DialogFooter>
    </form>
  );
}
