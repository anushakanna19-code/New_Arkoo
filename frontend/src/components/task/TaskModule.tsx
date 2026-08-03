import { useState, useEffect, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc,
  where,
  addDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  getDocs
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { getApiUrl } from '@/lib/api';
import {
  ClipboardList,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  AlertCircle,
  MoreVertical,
  Calendar,
  User,
  Building2,
  ChevronDown,
  Trash2,
  Plus,
  Edit3,
  Mic,
  Square,
  Play,
  Pause,
  Loader2,
  Volume2,
  Activity,
  MessageSquare,
  ChevronRight,
  Bell,
  Check,
  UserCheck,
  X,
  History,
  Upload
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import {
  parseFirestoreDate,
  formatDeadlineDisplay,
  parseRelativeDeadline,
  parseInputDate,
  isOverdue
} from '@/lib/date-utils';

export function TaskModule({ profile }: { profile: any }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [openAdd, setOpenAdd] = useState(false);
  const [sortBy, setSortBy] = useState('created-desc');
  const [editingTask, setEditingTask] = useState<any | null>(null);

  // Advanced Filter state variables
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterPriorities, setFilterPriorities] = useState<string[]>([]);
  const [filterDepartments, setFilterDepartments] = useState<string[]>([]);
  const [filterEmployees, setFilterEmployees] = useState<string[]>([]);
  const [filterDueHorizon, setFilterDueHorizon] = useState<string>('all'); // 'all', 'today', 'week', 'month'
  const [filterRole, setFilterRole] = useState<string>('all'); // 'all', 'created-by-me', 'assigned-by-me', 'assigned-to-me'

  // Selected task detail popup state
  const [selectedTask, setSelectedTask] = useState<any | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<string>('notes');
  const [taskToDelete, setTaskToDelete] = useState<any | null>(null);

  // Notifications state
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const isAdminOrManager = profile && (String(profile.role).toLowerCase() === 'admin' || String(profile.role).toLowerCase() === 'manager' || String(profile.role).toLowerCase() === 'management');
  const canDeleteTask = profile && (String(profile.role).toLowerCase() === 'admin' || String(profile.role).toLowerCase() === 'management');

  // Load saved filters on startup
  useEffect(() => {
    const userUid = auth.currentUser?.uid || 'guest';
    const saved = localStorage.getItem(`task_filter_presets_${userUid}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.statuses)) setFilterStatuses(parsed.statuses);
        if (Array.isArray(parsed.priorities)) setFilterPriorities(parsed.priorities);
        if (Array.isArray(parsed.departments)) setFilterDepartments(parsed.departments);
        if (Array.isArray(parsed.employees)) setFilterEmployees(parsed.employees);
        if (parsed.dueHorizon) setFilterDueHorizon(parsed.dueHorizon);
        if (parsed.role) setFilterRole(parsed.role);
        if (parsed.sortBy) setSortBy(parsed.sortBy);
      } catch (e) {
        console.error('Failed to parse saved filters', e);
      }
    }
  }, [profile]);

  // Save filters on model update
  useEffect(() => {
    const userUid = auth.currentUser?.uid || 'guest';
    const stateObj = {
      statuses: filterStatuses,
      priorities: filterPriorities,
      departments: filterDepartments,
      employees: filterEmployees,
      dueHorizon: filterDueHorizon,
      role: filterRole,
      sortBy
    };
    localStorage.setItem(`task_filter_presets_${userUid}`, JSON.stringify(stateObj));
  }, [filterStatuses, filterPriorities, filterDepartments, filterEmployees, filterDueHorizon, filterRole, sortBy]);

  // Fetch live tasks data
  useEffect(() => {
    let q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snap) => {
      let fetchedTasks = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // Filter out soft-deleted tasks
      fetchedTasks = fetchedTasks.filter(t => t.isDeleted !== true);

      // Enforce task ownership and visibility:
      // Vendor & Supplier users see ONLY tasks assigned to them.
      // Employee, Admin, Manager can view assigned tasks.
      if (profile) {
        const role = String(profile.role || '').toLowerCase();
        if (role === 'vendor' || role === 'supplier') {
          const userNameClean = String(profile.fullName || profile.displayName || '').toLowerCase().trim();
          const userEmailClean = String(profile.email || auth.currentUser?.email || '').toLowerCase().trim();

          fetchedTasks = fetchedTasks.filter(t => {
            const assigneeClean = String(t.assigneeName || '').toLowerCase().trim();
            const assigneeEmailClean = String(t.assigneeEmail || t.email || '').toLowerCase().trim();
            return (
              (userNameClean && (assigneeClean.includes(userNameClean) || userNameClean.includes(assigneeClean))) ||
              (userEmailClean && (assigneeEmailClean === userEmailClean || assigneeClean === userEmailClean))
            );
          });
        }
      }

      setTasks(fetchedTasks);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tasks');
    });
    return unsubscribe;
  }, [profile]);

  // Fetch employees list
  useEffect(() => {
    const q = query(collection(db, 'employees'), orderBy('fullName', 'asc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error('Error fetching employees:', error);
    });
    return unsubscribe;
  }, []);

  // Fetch real-time user-targeted notifications
  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (e) => {
      console.warn("Notifications subscription error:", e);
    });
    return unsubscribe;
  }, []);

  // Utility to create a notification record 
  const createNotification = async (userId: string, title: string, message: string, type: string) => {
    if (!userId) return;
    try {
      await addDoc(collection(db, 'notifications'), {
        userId,
        title,
        message,
        type,
        read: false,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.error('Failed to write notification:', e);
    }
  };

  // Log audit logs chronologically
  const logTaskActivity = async (taskId: string, action: string) => {
    if (!taskId) return;
    try {
      await addDoc(collection(db, 'tasks', taskId, 'activities'), {
        userId: auth.currentUser?.uid || '',
        userName: profile?.fullName || auth.currentUser?.displayName || auth.currentUser?.email || 'System',
        action,
        timestamp: serverTimestamp()
      });
    } catch (e) {
      console.error('Failed to log task activity:', e);
    }
  };

  // Auto-migrate standard relative or string-based tasks to Timestamp records in Firestore
  useEffect(() => {
    if (tasks.length === 0) return;

    tasks.forEach(async (task) => {
      const rawDeadline = task.deadline;
      let needsUpdate = false;
      let parsedDate: Date | null = null;

      if (typeof rawDeadline === 'string') {
        needsUpdate = true;
        parsedDate = parseRelativeDeadline(rawDeadline);
      } else if (!rawDeadline) {
        needsUpdate = true;
        parsedDate = parseRelativeDeadline('Pending');
      }

      if (needsUpdate && parsedDate) {
        try {
          await updateDoc(doc(db, 'tasks', task.id), {
            deadline: Timestamp.fromDate(parsedDate),
            updatedAt: serverTimestamp()
          });
          console.log(`Auto-migrated task ${task.id} deadline to Timestamp.`);
        } catch (e) {
          console.error(`Failed to auto-migrate task ${task.id}:`, e);
        }
      }
    });
  }, [tasks]);

  const updateStatus = async (taskId: string, newStatus: string) => {
    try {
      const taskObj = tasks.find(t => t.id === taskId);
      await updateDoc(doc(db, 'tasks', taskId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      toast.success(`Task status updated to ${newStatus}`);

      // Log Activity
      await logTaskActivity(taskId, `Changed status to "${newStatus}"`);

      // Notify
      if (taskObj) {
        const actorName = profile?.fullName || 'Someone';
        const msg = `${actorName} updated status of task "${taskObj.title}" to "${newStatus}"`;

        if (taskObj.createdByUid && taskObj.createdByUid !== auth.currentUser?.uid) {
          await createNotification(taskObj.createdByUid, 'Task Status Changed', msg, 'status');
        }
        if (taskObj.assigneeUid && taskObj.assigneeUid !== auth.currentUser?.uid) {
          await createNotification(taskObj.assigneeUid, 'Task Status Changed', msg, 'status');
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`);
      toast.error('Update failed');
    }
  };

  const executeDeleteTask = async (taskId: string) => {
    if (!canDeleteTask) {
      toast.error('Unauthorized: Only Admin and Management can delete tasks.');
      return;
    }

    const toastId = toast.loading('Deleting task resources from master records...');
    try {
      // 1. Delete associated notes
      const notesSnap = await getDocs(collection(db, 'tasks', taskId, 'notes'));
      const notesDeletes = notesSnap.docs.map(d => deleteDoc(doc(db, 'tasks', taskId, 'notes', d.id)));

      // 2. Delete associated voiceNotes
      const voiceSnap = await getDocs(collection(db, 'tasks', taskId, 'voiceNotes'));
      const voiceDeletes = voiceSnap.docs.map(d => deleteDoc(doc(db, 'tasks', taskId, 'voiceNotes', d.id)));

      // 3. Delete associated activities
      const activitiesSnap = await getDocs(collection(db, 'tasks', taskId, 'activities'));
      const activitiesDeletes = activitiesSnap.docs.map(d => deleteDoc(doc(db, 'tasks', taskId, 'activities', d.id)));

      // Wait for all sub-collection deletions
      await Promise.all([...notesDeletes, ...voiceDeletes, ...activitiesDeletes]);

      // 4. Delete parent task document
      await deleteDoc(doc(db, 'tasks', taskId));

      if (selectedTask?.id === taskId) {
        setSelectedTask(null);
      }

      toast.dismiss(toastId);
      toast.success('Task deleted successfully with all associations');
    } catch (error) {
      toast.dismiss(toastId);
      handleFirestoreError(error, OperationType.DELETE, `tasks/${taskId}`);
      toast.error('Delete failed');
    }
  };

  // Reset all filters
  const handleClearFilters = () => {
    setFilterStatuses([]);
    setFilterPriorities([]);
    setFilterDepartments([]);
    setFilterEmployees([]);
    setFilterDueHorizon('all');
    setFilterRole('all');
    setSelectedDueHorizon('all');
    setSelectedRoleFilter('all');
    toast.success('All filters cleared');
  };

  // Convert states to simple variables keeping tab UI matching values
  const [selectedDueHorizon, setSelectedDueHorizon] = useState('all');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState('all');

  useEffect(() => {
    setFilterDueHorizon(selectedDueHorizon);
  }, [selectedDueHorizon]);

  useEffect(() => {
    setFilterRole(selectedRoleFilter);
  }, [selectedRoleFilter]);

  // Compute Task Counts reactively from Firestore stream data
  const getTaskCounts = () => {
    const today = new Date();
    const counts = {
      all: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      inProgress: tasks.filter(t => t.status === 'in-progress' || t.status === 'in Progress').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      overdue: tasks.filter(t => isOverdue(t.deadline, t.status)).length,

      // Priorities
      critical: tasks.filter(t => t.priority === 'critical').length,
      high: tasks.filter(t => t.priority === 'high').length,
      medium: tasks.filter(t => t.priority === 'medium' || !t.priority).length,
      low: tasks.filter(t => t.priority === 'low').length,

      // Time horizons
      dueToday: tasks.filter(t => {
        const d = parseFirestoreDate(t.deadline);
        return d && d.toDateString() === today.toDateString();
      }).length,
      dueWeek: tasks.filter(t => {
        const d = parseFirestoreDate(t.deadline);
        if (!d) return false;
        const diffDays = Math.ceil((d.getTime() - today.getTime()) / (1000 * 3600 * 24));
        return diffDays >= 0 && diffDays <= 7;
      }).length,
      dueMonth: tasks.filter(t => {
        const d = parseFirestoreDate(t.deadline);
        return d && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
      }).length,

      // Roles
      byMe: tasks.filter(t => t.createdByUid === auth.currentUser?.uid).length,
      assignedByMe: tasks.filter(t => t.assignedByUid === auth.currentUser?.uid).length,
      assignedToMe: tasks.filter(t => {
        const nameClean = String(profile?.fullName || '').toLowerCase();
        return String(t.assigneeName || '').toLowerCase() === nameClean;
      }).length,

      // Departments tally
      departments: {} as Record<string, number>,
      // Employees tally
      employees: {} as Record<string, number>
    };

    tasks.forEach(t => {
      const d = t.department || 'General';
      counts.departments[d] = (counts.departments[d] || 0) + 1;

      const emp = t.assigneeName || 'Unassigned';
      counts.employees[emp] = (counts.employees[emp] || 0) + 1;
    });

    return counts;
  };

  const counts = getTaskCounts();

  // Multi-Filter criteria processor
  const filteredTasks = tasks.filter(t => {
    // 1. Search Query
    const searchLower = search.trim().toLowerCase();
    const matchesSearch = !searchLower ||
      (t.title || '').toLowerCase().includes(searchLower) ||
      (t.description || '').toLowerCase().includes(searchLower) ||
      (t.assigneeName || '').toLowerCase().includes(searchLower) ||
      (t.department || '').toLowerCase().includes(searchLower);

    // 2. Status
    let matchesStatus = true;
    if (filterStatuses.length > 0) {
      matchesStatus = filterStatuses.some(s => {
        if (s === 'overdue') return isOverdue(t.deadline, t.status);
        return t.status === s;
      });
    }

    // 3. Priorities
    let matchesPriority = true;
    if (filterPriorities.length > 0) {
      matchesPriority = filterPriorities.includes(t.priority || 'medium');
    }

    // 4. Departments
    let matchesDept = true;
    if (filterDepartments.length > 0) {
      matchesDept = filterDepartments.includes(t.department || 'General');
    }

    // 5. Employees
    let matchesEmp = true;
    if (filterEmployees.length > 0) {
      matchesEmp = filterEmployees.includes(t.assigneeName || 'Unassigned');
    }

    // 6. Due Horizon
    let matchesDue = true;
    const today = new Date();
    if (filterDueHorizon !== 'all') {
      const dDate = parseFirestoreDate(t.deadline);
      if (!dDate) {
        matchesDue = false;
      } else if (filterDueHorizon === 'today') {
        matchesDue = dDate.toDateString() === today.toDateString();
      } else if (filterDueHorizon === 'week') {
        const diffDays = Math.ceil((dDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
        matchesDue = diffDays >= 0 && diffDays <= 7;
      } else if (filterDueHorizon === 'month') {
        matchesDue = dDate.getMonth() === today.getMonth() && dDate.getFullYear() === today.getFullYear();
      }
    }

    // 7. Ownership Roles
    let matchesRole = true;
    if (filterRole !== 'all') {
      if (filterRole === 'created-by-me') {
        matchesRole = t.createdByUid === auth.currentUser?.uid;
      } else if (filterRole === 'assigned-by-me') {
        matchesRole = t.assignedByUid === auth.currentUser?.uid;
      } else if (filterRole === 'assigned-to-me') {
        const nameClean = String(profile?.fullName || '').toLowerCase();
        matchesRole = String(t.assigneeName || '').toLowerCase() === nameClean;
      }
    }

    return matchesSearch && matchesStatus && matchesPriority && matchesDept && matchesEmp && matchesDue && matchesRole;
  });

  const getSortedTasks = (tasksList: any[]) => {
    return [...tasksList].sort((a, b) => {
      if (sortBy === 'created-desc') {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return bTime - aTime;
      }
      if (sortBy === 'created-asc') {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return aTime - bTime;
      }
      if (sortBy === 'due-asc') {
        const aDate = parseFirestoreDate(a.deadline) || new Date(8640000000000000);
        const bDate = parseFirestoreDate(b.deadline) || new Date(8640000000000000);
        return aDate.getTime() - bDate.getTime();
      }
      if (sortBy === 'due-desc') {
        const aDate = parseFirestoreDate(a.deadline) || new Date(0);
        const bDate = parseFirestoreDate(b.deadline) || new Date(0);
        return bDate.getTime() - aDate.getTime();
      }
      return 0;
    });
  };

  const sortedTasks = getSortedTasks(filteredTasks);

  const getStatusColor = (status: string) => {
    switch (String(status).toLowerCase()) {
      case 'completed': return 'bg-green-50 text-green-700 border-green-200';
      case 'in-progress':
      case 'in progress': return 'bg-sky-50 text-sky-700 border-sky-200';
      case 'delayed': return 'bg-red-50 text-red-700 border-red-200';
      default: return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  const toggleStatusesFilter = (val: string) => {
    setFilterStatuses(prev =>
      prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]
    );
  };

  const togglePrioritiesFilter = (val: string) => {
    setFilterPriorities(prev =>
      prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]
    );
  };

  const toggleDepartmentsFilter = (val: string) => {
    setFilterDepartments(prev =>
      prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]
    );
  };

  const toggleEmployeesFilter = (val: string) => {
    setFilterEmployees(prev =>
      prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]
    );
  };

  const markAllNotificationsAsRead = async () => {
    try {
      const promises = notifications.map(n =>
        updateDoc(doc(db, 'notifications', n.id), { read: true })
      );
      await Promise.all(promises);
      toast.success('Marked all notifications as read');
    } catch (e) {
      console.error(e);
    }
  };

  const clearAllNotifications = async () => {
    if (!confirm('Are you sure you want to clear your alerts log?')) return;
    try {
      const promises = notifications.map(n =>
        deleteDoc(doc(db, 'notifications', n.id))
      );
      await Promise.all(promises);
      toast.success('Alert logs cleared');
    } catch (e) {
      console.error(e);
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="space-y-6">
      {/* Header Panel with Premium Notifications Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Task Management Terminal</h2>
            <Badge variant="outline" className="bg-slate-100 text-slate-700 pointer-events-none text-[10px] font-bold">
              Live DB Synced
            </Badge>
          </div>
          <p className="text-slate-500 text-xs font-semibold leading-relaxed">
            Monitor, assign, discuss, and attach voice transcript mementos to dynamically generated deliverables
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Notifications Trigger */}
          <div className="relative">
            <Button
              variant="outline"
              onClick={() => setShowNotifications(!showNotifications)}
              className={`h-10 px-3.5 rounded-xl border-slate-200 transition-all cursor-pointer relative ${unreadCount > 0 ? 'bg-orange-50/50 border-orange-200' : ''}`}
            >
              <Bell className={`w-4.5 h-4.5 text-slate-700 ${unreadCount > 0 ? 'text-brand-orange animate-wiggle' : ''}`} />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-600 text-[10px] font-black text-white shadow-md animate-pulse">
                  {unreadCount}
                </span>
              )}
            </Button>

            {/* Notifications Panel Box */}
            {showNotifications && (
              <div id="notifications-box" className="absolute right-0 mt-2.5 w-80 lg:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-bold text-slate-800">Your Task Alerts ({notifications.length})</span>
                  <div className="flex gap-1.5">
                    {unreadCount > 0 && (
                      <Button variant="ghost" onClick={markAllNotificationsAsRead} className="h-6 text-[10px] text-brand-orange hover:bg-orange-50 font-black px-1.5 rounded">
                        Read All
                      </Button>
                    )}
                    {notifications.length > 0 && (
                      <Button variant="ghost" onClick={clearAllNotifications} className="h-6 text-[10px] text-slate-400 hover:text-red-600 hover:bg-red-50 font-black px-1.5 rounded">
                        Clear Log
                      </Button>
                    )}
                    <button onClick={() => setShowNotifications(false)} className="text-slate-400 hover:text-slate-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {notifications.length === 0 ? (
                    <div className="text-center py-6">
                      <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-[11px] text-slate-400 font-medium">No alerts registered yet.</p>
                    </div>
                  ) : (
                    notifications.map(n => (
                      <div
                        key={n.id}
                        className={`p-3 rounded-xl border text-[11px] leading-relaxed transition-all ${n.read
                            ? 'bg-slate-50/50 border-slate-100/80 text-slate-500'
                            : 'bg-orange-50/40 border-orange-100 text-slate-800 font-semibold'
                          }`}
                      >
                        <div className="flex justify-between items-start gap-1">
                          <span className="text-slate-900 font-bold">{n.title}</span>
                          <span className="text-[9px] text-slate-400 whitespace-nowrap">
                            {n.createdAt?.toDate ? format(n.createdAt.toDate(), 'p') : 'Recently'}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-600">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {String(profile?.role || '').toLowerCase() !== 'vendor' && String(profile?.role || '').toLowerCase() !== 'supplier' && (
            <Dialog open={openAdd} onOpenChange={setOpenAdd}>
              <DialogTrigger render={<Button className="bg-brand-orange hover:bg-orange-600 font-extrabold h-10 rounded-xl text-xs px-5 shadow-sm hover:shadow-md transition-all cursor-pointer text-white">
                <Plus className="w-4.5 h-4.5 mr-2" /> CREATE TASK
              </Button>} />
              <DialogContent className="max-w-md rounded-xl bg-white">
                <DialogHeader>
                  <DialogTitle className="text-lg font-extrabold text-slate-900">Add Live Task</DialogTitle>
                  <DialogDescription className="text-xs text-slate-500">
                    Manually assign standard deliverables to team members
                  </DialogDescription>
                </DialogHeader>
                <TaskForm profile={profile} employees={employees} onSuccess={() => { setOpenAdd(false); logTaskActivity('last_created', 'Created manual task'); }} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Dynamic Filter Bento Overview Counts Box */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <div
          onClick={handleClearFilters}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all cursor-pointer space-y-1 group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black text-slate-400 tracking-wider">All Deliverables</span>
            <ClipboardList className="w-4 h-4 text-slate-400 group-hover:text-amber-500 transition-colors" />
          </div>
          <p className="text-2xl font-black text-slate-900">{counts.all}</p>
          <p className="text-[10px] text-brand-orange font-bold group-hover:underline">Clear filter logs</p>
        </div>

        <div
          onClick={() => { setFilterStatuses(['pending']); }}
          className={`p-4 rounded-xl border shadow-xs transition-all cursor-pointer space-y-1 ${filterStatuses.includes('pending') ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200 hover:border-slate-300'}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black text-amber-500 tracking-wider">Pending Tasks</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-black text-slate-900">{counts.pending}</p>
          <p className="text-[10px] text-slate-400 font-medium">Ready to initialize</p>
        </div>

        <div
          onClick={() => { setFilterStatuses(['in-progress']); }}
          className={`p-4 rounded-xl border shadow-xs transition-all cursor-pointer space-y-1 ${filterStatuses.includes('in-progress') || filterStatuses.includes('in Progress') ? 'bg-sky-50 border-sky-300' : 'bg-white border-slate-200 hover:border-slate-300'}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black text-sky-500 tracking-wider">Under Way</span>
            <Activity className="w-4 h-4 text-sky-500 animate-pulse" />
          </div>
          <p className="text-2xl font-black text-slate-900">{counts.inProgress}</p>
          <p className="text-[10px] text-slate-400 font-medium">Active work streams</p>
        </div>

        <div
          onClick={() => { setFilterStatuses(['completed']); }}
          className={`p-4 rounded-xl border shadow-xs transition-all cursor-pointer space-y-1 ${filterStatuses.includes('completed') ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200 hover:border-slate-300'}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black text-green-500 tracking-wider">Fully Completed</span>
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          </div>
          <p className="text-2xl font-black text-slate-900">{counts.completed}</p>
          <p className="text-[10px] text-slate-400 font-medium">Archived solutions</p>
        </div>

        <div
          onClick={() => { setFilterStatuses(['overdue']); }}
          className={`p-4 rounded-xl border shadow-xs transition-all cursor-pointer space-y-1 col-span-2 md:col-span-1 ${filterStatuses.includes('overdue') ? 'bg-red-50 border-red-300' : 'bg-white border-slate-200 hover:border-slate-300'}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black text-red-600 tracking-wider">Overdue Alerts</span>
            <AlertCircle className="w-4 h-4 text-red-600 animate-bounce" />
          </div>
          <p className="text-2xl font-black text-red-600">{counts.overdue}</p>
          <p className="text-[10px] text-red-500 font-bold">Requires support</p>
        </div>
      </div>

      {/* Main Terminal View Grid split into Sidebar (Filters) and List (Tasks) */}
      <div className="flex flex-col lg:flex-row gap-6">

        {/* Left Side Advanced Filtering Panel (Aesthetic Sidebar) */}
        <div className="w-full lg:w-72 shrink-0 space-y-5 bg-white p-5 rounded-2xl border border-slate-200 h-fit shadow-xs">
          <div className="flex items-center justify-between border-b pb-3.5">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-700" />
              <span className="text-xs font-black uppercase text-slate-800 tracking-wider">Filter Settings</span>
            </div>
            {(filterStatuses.length > 0 || filterPriorities.length > 0 || filterDepartments.length > 0 || filterEmployees.length > 0 || filterDueHorizon !== 'all' || filterRole !== 'all') && (
              <Button
                variant="ghost"
                onClick={handleClearFilters}
                className="h-6 px-1.5 text-[10px] text-red-500 font-extrabold hover:bg-red-50 rounded"
              >
                Clear All
              </Button>
            )}
          </div>

          <div className="space-y-4">
            {/* Status Checkbox List */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest pl-1">Status Stages</span>
              <div className="space-y-1">
                {[
                  { id: 'pending', label: 'Pending', count: counts.pending, dot: 'bg-amber-400' },
                  { id: 'in-progress', label: 'In-Progress', count: counts.inProgress, dot: 'bg-sky-400' },
                  { id: 'completed', label: 'Completed', count: counts.completed, dot: 'bg-green-400' },
                  { id: 'overdue', label: 'Overdue', count: counts.overdue, dot: 'bg-red-500' }
                ].map(item => {
                  const active = filterStatuses.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleStatusesFilter(item.id)}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${active ? 'bg-slate-100 text-slate-900 border border-slate-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${item.dot}`} />
                        <span>{item.label}</span>
                      </div>
                      <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{item.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Priorty Level Checkbox List */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest pl-1">Priority tiers</span>
              <div className="space-y-1">
                {[
                  { id: 'critical', label: '⚡ Critical', count: counts.critical, text: 'text-red-600' },
                  { id: 'high', label: '🔴 High', count: counts.high, text: 'text-orange-600' },
                  { id: 'medium', label: '🟡 Medium', count: counts.medium, text: 'text-slate-600' },
                  { id: 'low', label: '🟢 Low', count: counts.low, text: 'text-green-600' }
                ].map(item => {
                  const active = filterPriorities.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => togglePrioritiesFilter(item.id)}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${active ? 'bg-slate-100 text-slate-900 border border-slate-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
                    >
                      <span className={item.text}>{item.label}</span>
                      <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{item.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Timelines horizon selector tabs in vertical container */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest pl-1">Due Horizons</span>
              <div className="grid grid-cols-1 gap-1">
                {[
                  { id: 'all', label: 'All Dates', count: counts.all },
                  { id: 'today', label: 'Due Today', count: counts.dueToday },
                  { id: 'week', label: 'Due This Week', count: counts.dueWeek },
                  { id: 'month', label: 'Due This Month', count: counts.dueMonth }
                ].map(item => {
                  const active = filterDueHorizon === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedDueHorizon(item.id)}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${active ? 'bg-orange-50 border border-orange-200 text-brand-orange' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
                    >
                      <span>{item.label}</span>
                      <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{item.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Department Wise Checklist */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest pl-1">Departments</span>
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {Object.keys(counts.departments).length === 0 ? (
                  <p className="text-[10px] text-slate-400 italic pl-1">No departments registerd</p>
                ) : (
                  Object.entries(counts.departments).map(([dept, count]) => {
                    const active = filterDepartments.includes(dept);
                    return (
                      <div
                        key={dept}
                        onClick={() => toggleDepartmentsFilter(dept)}
                        className={`flex items-center justify-between p-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${active ? 'bg-slate-100 text-slate-900 border border-slate-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
                      >
                        <span className="truncate max-w-40">{dept}</span>
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{count}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Employee Wise list */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest pl-1">Assigned Employees</span>
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {Object.keys(counts.employees).length === 0 ? (
                  <p className="text-[10px] text-slate-400 italic pl-1">None assigned yet</p>
                ) : (
                  Object.entries(counts.employees).map(([empName, count]) => {
                    const active = filterEmployees.includes(empName);
                    return (
                      <div
                        key={empName}
                        onClick={() => toggleEmployeesFilter(empName)}
                        className={`flex items-center justify-between p-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${active ? 'bg-slate-100 text-slate-900 border border-slate-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
                      >
                        <span className="truncate max-w-40">{empName}</span>
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{count}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Ownership Roles */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest pl-1">My Roles Filter</span>
              <div className="space-y-1">
                {[
                  { id: 'all', label: 'All Handlers', count: counts.all },
                  { id: 'assigned-to-me', label: 'Assigned To Me', count: counts.assignedToMe },
                  { id: 'created-by-me', label: 'Created By Me', count: counts.byMe },
                  { id: 'assigned-by-me', label: 'Assigned By Me', count: counts.assignedByMe }
                ].map(item => {
                  const active = filterRole === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedRoleFilter(item.id)}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${active ? 'bg-orange-50 border border-orange-200 text-brand-orange' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
                    >
                      <span>{item.label}</span>
                      <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{item.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>

        {/* Right Side Task Feed */}
        <div className="flex-1 space-y-4">

          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by keywords, assignees, titles, descriptions..."
                className="pl-10 h-11 bg-white border-slate-200 rounded-xl"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="w-full sm:w-48 shrink-0">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-11 bg-white border-slate-200 rounded-xl">
                  <SelectValue placeholder="Sort order" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created-desc">Created (Newest)</SelectItem>
                  <SelectItem value="created-asc">Created (Oldest)</SelectItem>
                  <SelectItem value="due-asc">Deadline (Early First)</SelectItem>
                  <SelectItem value="due-desc">Deadline (Late First)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Active Filtering Chips bar */}
          {(filterStatuses.length > 0 || filterPriorities.length > 0 || filterDepartments.length > 0 || filterEmployees.length > 0 || filterDueHorizon !== 'all' || filterRole !== 'all') && (
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-100/50 p-2 rounded-xl text-xs font-medium text-slate-600 border">
              <span>Active filters:</span>
              {filterStatuses.map(s => (
                <Badge key={s} variant="secondary" className="bg-white gap-1 py-0.5">
                  status: {s}
                  <X className="w-3 h-3 hover:text-red-500 cursor-pointer" onClick={() => toggleStatusesFilter(s)} />
                </Badge>
              ))}
              {filterPriorities.map(p => (
                <Badge key={p} variant="secondary" className="bg-white gap-1 py-0.5">
                  priority: {p}
                  <X className="w-3 h-3 hover:text-red-500 cursor-pointer" onClick={() => togglePrioritiesFilter(p)} />
                </Badge>
              ))}
              {filterDepartments.map(d => (
                <Badge key={d} variant="secondary" className="bg-white gap-1 py-0.5">
                  dept: {d}
                  <X className="w-3 h-3 hover:text-red-500 cursor-pointer" onClick={() => toggleDepartmentsFilter(d)} />
                </Badge>
              ))}
              {filterEmployees.map(e => (
                <Badge key={e} variant="secondary" className="bg-white gap-1 py-0.5">
                  assignee: {e}
                  <X className="w-3 h-3 hover:text-red-500 cursor-pointer" onClick={() => toggleEmployeesFilter(e)} />
                </Badge>
              ))}
              {filterDueHorizon !== 'all' && (
                <Badge variant="secondary" className="bg-white gap-1 py-0.5">
                  due: {filterDueHorizon}
                  <X className="w-3 h-3 hover:text-red-500 cursor-pointer" onClick={() => setSelectedDueHorizon('all')} />
                </Badge>
              )}
              {filterRole !== 'all' && (
                <Badge variant="secondary" className="bg-white gap-1 py-0.5">
                  relation: {filterRole}
                  <X className="w-3 h-3 hover:text-red-500 cursor-pointer" onClick={() => setSelectedRoleFilter('all')} />
                </Badge>
              )}
              <Button variant="ghost" onClick={handleClearFilters} className="h-5 text-[10px] text-red-500 hover:bg-white underline font-bold ml-auto">
                Clear all
              </Button>
            </div>
          )}

          {/* Cards collection wrapper */}
          <div className="grid grid-cols-1 gap-4">
            {sortedTasks.length === 0 && (
              <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-300">
                <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500 font-bold">No tasks registered matching these constraints.</p>
                <p className="text-xs text-slate-400 mt-1">Try to loosen filters or clear all search terms.</p>
              </div>
            )}

            {sortedTasks.map((task) => (
              <Card
                key={task.id}
                className="shadow-xs border-slate-200 hover:border-orange-200 hover:shadow-md transition-all rounded-2xl overflow-hidden group bg-white"
              >
                <CardContent className="p-0">
                  <div className="flex flex-col md:flex-row">

                    {/* Left click-container for opening full details drawer */}
                    <div
                      onClick={() => { setSelectedTask(task); setActiveDetailTab('notes'); }}
                      className="flex-1 p-6 space-y-3 cursor-pointer hover:bg-slate-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`
                          text-[10px] uppercase font-black tracking-widest px-2 py-0.5 border
                          ${getStatusColor(task.status)}
                        `}>
                          {task.status}
                        </Badge>
                        {isOverdue(task.deadline, task.status) && (
                          <Badge className="text-[10px] uppercase font-black tracking-widest px-2 py-0.5 bg-red-600 text-white border-transparent">
                            Overdue
                          </Badge>
                        )}
                        <Badge variant="outline" className={`
                          text-[10px] uppercase font-black tracking-widest px-2 py-0.5
                          ${task.priority === 'high' || task.priority === 'critical' ? 'border-red-200 text-red-600 bg-red-50 font-extrabold' : 'border-slate-200 text-slate-500'}
                        `}>
                          {task.priority || 'medium'}
                        </Badge>
                      </div>

                      <div className="flex items-start justify-between">
                        <h3 className="text-base font-extrabold text-slate-900 group-hover:text-brand-orange transition-colors">
                          {task.title}
                        </h3>
                        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-brand-orange group-hover:translate-x-1 transition-all" />
                      </div>

                      <p className="text-slate-500 text-xs leading-relaxed line-clamp-2 pr-4 font-normal">
                        {task.description}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 border-t border-slate-100 text-slate-500">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-slate-400" />
                          <span className="text-xs font-bold text-slate-700">{task.assigneeName || 'Unassigned'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-slate-400" />
                          <span className="text-xs font-bold text-slate-700">{task.department || 'General'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          <span className="text-xs font-bold text-slate-700">Due: {formatDeadlineDisplay(task.deadline)}</span>
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-[10px] text-slate-400 font-bold">
                            {task.createdAt?.toDate ? format(task.createdAt.toDate(), 'PP') : 'Recently'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Operational direct buttons */}
                    <div className="flex flex-col sm:flex-row md:flex-col items-center justify-center gap-2 p-4 md:p-5 border-t md:border-t-0 md:border-l border-slate-100 bg-slate-50/10 shrink-0 md:w-40 w-full">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button className="w-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs h-9 rounded-xl transition-colors cursor-pointer justify-center">
                          STATUS <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                        </Button>} />
                        <DropdownMenuContent align="end" className="w-44 p-1 rounded-xl shadow-xl z-30">
                          <DropdownMenuItem onClick={() => updateStatus(task.id, 'pending')} className="rounded-lg font-bold text-xs p-2 cursor-pointer">Pending</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateStatus(task.id, 'in-progress')} className="rounded-lg font-bold text-xs p-2 cursor-pointer">In Progress</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateStatus(task.id, 'completed')} className="text-green-600 rounded-lg font-bold text-xs p-2 cursor-pointer">Completed</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateStatus(task.id, 'delayed')} className="text-red-600 rounded-lg font-bold text-xs p-2 cursor-pointer">Delayed</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <Button
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTask(task);
                          setActiveDetailTab('notes');
                        }}
                        className="w-full bg-white hover:bg-orange-50 text-slate-700 hover:text-brand-orange border border-slate-200 hover:border-orange-200 font-extrabold text-xs h-9 rounded-xl transition-all cursor-pointer justify-center gap-1.5 shadow-xs"
                      >
                        <MessageSquare className="w-4 h-4 text-slate-400" /> NOTES
                      </Button>

                      <div className="flex gap-2 w-full justify-between items-center">
                        <Button
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); setEditingTask(task); }}
                          className={`h-8 text-[10px] font-bold text-slate-600 hover:text-sky-600 hover:bg-sky-50 rounded-lg border border-slate-200/80 ${canDeleteTask ? 'flex-1' : 'w-full'}`}
                        >
                          <Edit3 className="w-3 h-3 mr-1" /> Edit
                        </Button>
                        {canDeleteTask && (
                          <Button
                            variant="destructive"
                            onClick={(e) => { e.stopPropagation(); setTaskToDelete(task); }}
                            className="h-8 flex-1 text-[10px] font-black bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all"
                          >
                            <Trash2 className="w-3 h-3 mr-1" /> Delete
                          </Button>
                        )}
                      </div>
                    </div>

                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

        </div>
      </div>

      {/* Complete Task Details popover / modal containing Notes, Mic assistant, Timelines */}
      {selectedTask && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setSelectedTask(null); }}>
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
                    <div className="w-10 h-10 rounded-full bg-brand-orange/10 flex items-center justify-center font-black text-brand-orange text-sm shrink-0">
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
                        // Notify
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
                        // Notify
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
              <Button type="button" variant="ghost" className="rounded-xl font-bold text-xs" onClick={() => setSelectedTask(null)}>
                Dismiss Details
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Editing Task popover */}
      {editingTask && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setEditingTask(null); }}>
          <DialogContent className="max-w-md rounded-xl bg-white p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-extrabold text-slate-900">Edit Task Coordinates</DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Update matching records, assignees, deadlines or scope.
              </DialogDescription>
            </DialogHeader>
            <TaskForm
              task={editingTask}
              profile={profile}
              employees={employees}
              onSuccess={() => {
                setEditingTask(null);
                logTaskActivity(editingTask.id, 'Updated task details');
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Custom Task Deletion Confirmation Dialog Popup */}
      {taskToDelete && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setTaskToDelete(null); }}>
          <DialogContent className="max-w-md rounded-xl bg-white p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-extrabold text-red-600">Delete Task</DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Are you sure you want to delete this task?
              </DialogDescription>
            </DialogHeader>
            <div className="bg-red-50/60 border border-red-100 rounded-xl p-4 my-2 text-xs">
              <p className="font-extrabold text-red-800 mb-1">Warning: Irreversible action</p>
              <p className="font-semibold text-red-700">
                Task Title: <span className="font-black">{taskToDelete?.title}</span>
              </p>
              <p className="text-slate-500 mt-2 font-medium">
                Deleting this task will permanently remove it from Firebase, remove it from dashboard counts, and clear all associated employee listings.
              </p>
            </div>
            <DialogFooter className="mt-4 gap-2 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setTaskToDelete(null)}
                className="rounded-xl h-10 font-bold text-xs"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  executeDeleteTask(taskToDelete.id);
                  setTaskToDelete(null);
                }}
                className="bg-red-600 hover:bg-red-700 text-white font-extrabold px-6 h-10 rounded-xl hover:scale-102 hover:shadow transition-all"
              >
                Confirm Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ==========================================
   TaskForm Component Definition
   ========================================== */
function TaskForm({ task, profile, employees, onSuccess }: { task?: any; profile: any; employees: any[]; onSuccess: () => void }) {
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
        <Button type="submit" disabled={loading} className="bg-brand-orange hover:bg-orange-600 font-extrabold px-8 text-white h-10 rounded-xl">
          {loading ? 'indexing...' : (task?.id ? 'Save Changes' : 'Create Task')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ==========================================
   Notes / Discussions Section Sub-Component
   ========================================== */
function NotesSubSection({ taskId, profile, onLogActivity }: { taskId: string; profile: any; onLogActivity: (m: string) => void }) {
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
        <Button onClick={handlePostNote} disabled={loading} className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs h-11 rounded-xl px-5">
          {loading ? 'Posting...' : 'PUBLISH'}
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

/* ==========================================
   Voice Note recordings list with Mic UI
   ========================================== */
function VoiceSubSection({ taskId, profile, onLogActivity }: { taskId: string; profile: any; onLogActivity: (m: string) => void }) {
  const [voiceNotes, setVoiceNotes] = useState<any[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const timerRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'tasks', taskId, 'voiceNotes'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setVoiceNotes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error('Voice Notes fetch error:', error);
    });
    return unsubscribe;
  }, [taskId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleStartRecord = async () => {
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await handleSaveVoiceMemo(audioBlob);

        // Stop all tracks on the stream
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(250);
      setRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 120) { // Auto-stop at 2 minutes
            handleStopRecord();
            return 120;
          }
          return prev + 1;
        });
      }, 1000);

      toast.info('Speak now, recording task memo...');
    } catch (e: any) {
      console.error('Audio recorder initialization failed:', e);
      toast.error('Could not grant microphone authorization');
    }
  };

  const handleStopRecord = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const handleSaveVoiceMemo = async (audioBlob: Blob) => {
    setIsProcessing(true);
    const toastId = toast.loading('Synchronizing voice, compiling Gemini transcription...');

    try {
      // FileReader to Base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64data = String(reader.result).split(',')[1];

        // Call server transcribing Proxy route
        const resp = await fetch('/api/tasks/voice-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: base64data,
            mimeType: audioBlob.type,
            taskId
          })
        });

        if (!resp.ok) {
          throw new Error('Server Voice-to-Text conversion failure');
        }

        const data = await resp.json();

        // Write record to tasks/{taskId}/voiceNotes
        await addDoc(collection(db, 'tasks', taskId, 'voiceNotes'), {
          userId: auth.currentUser?.uid || '',
          userName: profile?.fullName || auth.currentUser?.displayName || auth.currentUser?.email || 'Anonymous',
          audioUrl: data.audioUrl,
          transcript: data.transcript || "Speech not registered.",
          createdAt: serverTimestamp()
        });

        toast.dismiss(toastId);
        toast.success('Voice memo transcribed and synced successfully!');
        onLogActivity('Added audio voice memo with automated AI transcription');
        setIsProcessing(false);
      };
    } catch (err: any) {
      console.error('Failed saving memo:', err);
      toast.dismiss(toastId);
      toast.error('Voice Assistant was unable to complete transcription.');
      setIsProcessing(false);
    }
  };

  const handleDeleteVoice = async (id: string) => {
    if (!confirm('Are you sure you want to retract this audio attachment?')) return;
    try {
      await deleteDoc(doc(db, 'tasks', taskId, 'voiceNotes', id));
      toast.success('Audio memo removed');
      onLogActivity('Deleted a voice memo attachment');
    } catch (e) {
      toast.error('Retraction failed');
    }
  };

  const formatSec = (total: number) => {
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadAudioClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      toast.error('Only audio files are supported');
      return;
    }

    setIsProcessing(true);
    const toastId = toast.loading('Uploading and transcribing audio with Gemini...');

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = async () => {
        const base64data = String(reader.result).split(',')[1];

        const resp = await fetch('/api/tasks/voice-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: base64data,
            mimeType: file.type || 'audio/wav',
            taskId
          })
        });

        if (!resp.ok) {
          throw new Error('Server Voice-to-Text conversion failure');
        }

        const data = await resp.json();

        await addDoc(collection(db, 'tasks', taskId, 'voiceNotes'), {
          userId: auth.currentUser?.uid || '',
          userName: profile?.fullName || auth.currentUser?.displayName || auth.currentUser?.email || 'Anonymous',
          audioUrl: data.audioUrl,
          transcript: data.transcript || "Silence/No speech detected",
          createdAt: serverTimestamp()
        });

        toast.dismiss(toastId);
        toast.success('Audio file processed and transcribed successfully!');
        onLogActivity(`Uploaded audio memo (${file.name}) with automated AI transcription`);
        setIsProcessing(false);
      };
    } catch (err: any) {
      console.error('Failed processing uploaded file:', err);
      toast.dismiss(toastId);
      toast.error('Unable to complete audio file transcription.');
      setIsProcessing(false);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const currentUid = auth.currentUser?.uid;
  const isAuthorized = (item: any) => {
    return item.userId === currentUid || String(profile?.role).toLowerCase() === 'admin';
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-2 border-b pb-2">
        <Mic className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-black uppercase text-slate-700 tracking-wider">Voice Memo Assist ({voiceNotes.length})</span>
      </div>

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="audio/*"
        className="hidden"
      />

      {/* Interactive Recording Panel Deck */}
      <Card className="bg-slate-50/50 border-slate-200 shadow-sm overflow-hidden border">
        <CardContent className="p-5 flex flex-col items-center justify-center space-y-4">
          {recording ? (
            <div className="flex flex-col items-center space-y-3">
              <div className="relative">
                <span className="absolute inline-flex h-12 w-12 animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white">
                  <Mic className="w-6 h-6 animate-pulse" />
                </span>
              </div>
              <p className="text-xs font-black text-rose-600 tracking-wider uppercase flex items-center gap-1.5">
                <span className="inline-block w-20 text-right">{formatSec(recordingTime)}</span>
                <span className="animate-blink">● RECORDING ACTIVE</span>
              </p>

              {/* Aesthetic CSS wave visualizer bars */}
              <div className="flex items-center gap-1 h-5 pl-2">
                {[1, 2, 3, 4, 5, 4, 3, 2, 1].map((h, i) => (
                  <span
                    key={i}
                    style={{ animationDelay: `${i * 0.1}s`, height: `${h * 4}px` }}
                    className="w-1 bg-rose-500 rounded-full animate-wave"
                  />
                ))}
              </div>

              <Button onClick={handleStopRecord} className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs h-9 rounded-xl px-6 cursor-pointer">
                <Square className="w-3.5 h-3.5 mr-2" /> STOP AND TRANSCRIBE
              </Button>
            </div>
          ) : isProcessing ? (
            <div className="flex flex-col items-center space-y-2 py-3 text-center">
              <Loader2 className="w-10 h-10 text-brand-orange animate-spin mb-1" />
              <p className="text-xs font-black text-slate-700">Analyzing voice waveforms...</p>
              <p className="text-[10px] text-slate-400 font-bold max-w-sm leading-relaxed">
                Gemini is transcribing spoken words. Hold on, indexing audio in Firestore...
              </p>
            </div>
          ) : (
            <div className="w-full flex flex-col sm:flex-row items-center justify-center gap-3 py-3">
              <Button
                onClick={handleStartRecord}
                className="bg-brand-orange hover:bg-orange-600 text-white font-black h-11 px-5 rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2 w-full sm:w-auto justify-center"
              >
                <Mic className="w-4 h-4" /> RECORD VOICE
              </Button>
              <Button
                onClick={handleUploadAudioClick}
                variant="outline"
                className="bg-white hover:bg-slate-50 text-slate-700 border-slate-200 font-bold h-11 px-5 rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2 w-full sm:w-auto justify-center"
              >
                <Upload className="w-4 h-4" /> UPLOAD AUDIO
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chronological memos library list */}
      <div className="space-y-4 max-h-[440px] overflow-y-auto pr-1">
        {voiceNotes.length === 0 ? (
          <div className="text-center py-10 bg-slate-50/30 rounded-2xl border border-dashed border-slate-200">
            <Mic className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400 italic">No task memos or dictations saved.</p>
          </div>
        ) : (
          voiceNotes.map(item => (
            <div key={item.id} className="bg-white p-4 rounded-xl border border-slate-200 relative group/memo shadow-xs">
              <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 mb-2 gap-2 border-b border-slate-50 pb-1.5">
                <span className="text-slate-800 font-extrabold flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-brand-orange" /> {item.userName}
                </span>
                <span className="text-slate-400 font-semibold">
                  {item.createdAt?.toDate ? format(item.createdAt.toDate(), 'PP p') : 'Just now'}
                </span>
              </div>

              {/* Playback player */}
              <div className="bg-slate-50 p-2 rounded-xl border border-slate-100/50">
                <audio src={item.audioUrl} controls className="w-full h-8 max-w-full text-slate-700" />
              </div>

              {/* Transcript block */}
              <div className="mt-3 bg-orange-50/30 p-3 rounded-xl border border-orange-100/40">
                <span className="text-[9px] uppercase font-black text-brand-orange tracking-wider block mb-1">
                  AI Transcribed Transcription Notes
                </span>
                <p className="text-xs text-slate-700 font-semibold leading-relaxed break-words">
                  "{item.transcript}"
                </p>
              </div>

              {isAuthorized(item) && (
                <button
                  onClick={() => handleDeleteVoice(item.id)}
                  className="absolute right-3 top-3 opacity-0 group-memo:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-red-500 cursor-pointer bg-white border shadow-xs"
                  title="Remove memo"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ==========================================
   Cron Timeline logs Sub-Component
   ========================================== */
function TimelineSubSection({ taskId }: { taskId: string }) {
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
              <span className="absolute -left-[20px] top-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-slate-300 ring-4 ring-white group-hover:bg-brand-orange transition-all duration-300" />

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
