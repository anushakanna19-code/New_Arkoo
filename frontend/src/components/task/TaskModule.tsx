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
import { TaskForm } from './TaskForm';
import { TaskDetailDialog } from './TaskDetailDialog';

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
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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
              className={`h-10 px-3.5 rounded-xl border-slate-200 transition-all cursor-pointer relative ${unreadCount > 0 ? 'bg-blue-50/50 border-blue-200' : ''}`}
            >
              <Bell className={`w-4.5 h-4.5 text-slate-700 ${unreadCount > 0 ? 'text-blue-600 animate-wiggle' : ''}`} />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-600 text-[10px] font-black text-white shadow-md animate-pulse">
                  {unreadCount}
                </span>
              )}
            </Button>

            {/* Notifications Panel Box */}
            {showNotifications && (
              <div id="notifications-box" className="absolute right-0 mt-2.5 w-[calc(100vw-2rem)] sm:w-80 lg:w-96 max-w-sm bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-bold text-slate-800">Your Task Alerts ({notifications.length})</span>
                  <div className="flex gap-1.5">
                    {unreadCount > 0 && (
                      <Button variant="ghost" onClick={markAllNotificationsAsRead} className="h-6 text-[10px] text-blue-600 hover:bg-blue-50 font-black px-1.5 rounded">
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
                            : 'bg-blue-50/40 border-blue-100 text-slate-800 font-semibold'
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
              <DialogTrigger render={<Button className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 rounded-xl text-xs sm:text-sm px-5 shadow-md shadow-blue-500/20 transition-all cursor-pointer inline-flex items-center">
                <Plus className="w-4 h-4 mr-2" /> Create Task
              </Button>} />
              <DialogContent className="w-[95vw] max-w-lg rounded-2xl bg-white max-h-[90vh] overflow-y-auto p-5 sm:p-6">
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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-3.5">
        <div
          onClick={handleClearFilters}
          className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all cursor-pointer space-y-1 group"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black text-slate-400 tracking-wider">All Tasks</span>
            <ClipboardList className="w-4 h-4 text-slate-400 group-hover:text-amber-500 transition-colors" />
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-900">{counts.all}</p>
          <p className="text-[10px] text-blue-600 font-bold group-hover:underline">Clear filter</p>
        </div>

        <div
          onClick={() => { setFilterStatuses(['pending']); }}
          className={`p-3.5 sm:p-4 rounded-xl border shadow-xs transition-all cursor-pointer space-y-1 ${filterStatuses.includes('pending') ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200 hover:border-slate-300'}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black text-amber-500 tracking-wider">Pending</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-900">{counts.pending}</p>
          <p className="text-[10px] text-slate-400 font-medium">Ready to init</p>
        </div>

        <div
          onClick={() => { setFilterStatuses(['in-progress']); }}
          className={`p-3.5 sm:p-4 rounded-xl border shadow-xs transition-all cursor-pointer space-y-1 ${filterStatuses.includes('in-progress') || filterStatuses.includes('in Progress') ? 'bg-sky-50 border-sky-300' : 'bg-white border-slate-200 hover:border-slate-300'}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black text-sky-500 tracking-wider">Active</span>
            <Activity className="w-4 h-4 text-sky-500 animate-pulse" />
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-900">{counts.inProgress}</p>
          <p className="text-[10px] text-slate-400 font-medium">In progress</p>
        </div>

        <div
          onClick={() => { setFilterStatuses(['completed']); }}
          className={`p-3.5 sm:p-4 rounded-xl border shadow-xs transition-all cursor-pointer space-y-1 ${filterStatuses.includes('completed') ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200 hover:border-slate-300'}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black text-green-500 tracking-wider">Completed</span>
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-900">{counts.completed}</p>
          <p className="text-[10px] text-slate-400 font-medium">Done</p>
        </div>

        <div
          onClick={() => { setFilterStatuses(['overdue']); }}
          className={`p-3.5 sm:p-4 rounded-xl border shadow-xs transition-all cursor-pointer space-y-1 col-span-2 sm:col-span-1 ${filterStatuses.includes('overdue') ? 'bg-red-50 border-red-300' : 'bg-white border-slate-200 hover:border-slate-300'}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-black text-red-600 tracking-wider">Overdue</span>
            <AlertCircle className="w-4 h-4 text-red-600 animate-bounce" />
          </div>
          <p className="text-xl sm:text-2xl font-black text-red-600">{counts.overdue}</p>
          <p className="text-[10px] text-red-500 font-bold">Needs attention</p>
        </div>
      </div>

      {/* Mobile Filter Toggle Button (< lg) */}
      <div className="lg:hidden">
        <Button
          type="button"
          variant="outline"
          onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
          className="w-full flex items-center justify-between h-11 px-4 bg-white border-slate-200 rounded-xl font-bold text-xs text-slate-700 shadow-xs hover:bg-slate-50 cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-600" />
            <span>Filter Tasks by Status, Priority & Dept</span>
          </div>
          <div className="flex items-center gap-2">
            {(filterStatuses.length + filterPriorities.length + filterDepartments.length + filterEmployees.length + (filterDueHorizon !== 'all' ? 1 : 0) + (filterRole !== 'all' ? 1 : 0)) > 0 && (
              <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-extrabold rounded-full">
                {filterStatuses.length + filterPriorities.length + filterDepartments.length + filterEmployees.length + (filterDueHorizon !== 'all' ? 1 : 0) + (filterRole !== 'all' ? 1 : 0)} Active
              </span>
            )}
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${mobileFiltersOpen ? 'rotate-180' : ''}`} />
          </div>
        </Button>
      </div>

      {/* Main Terminal View Grid split into Sidebar (Filters) and List (Tasks) */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* Advanced Filtering Panel (Collapsible on Mobile, Persistent on Desktop) */}
        <div className={`${mobileFiltersOpen ? 'block' : 'hidden'} lg:block w-full lg:w-64 xl:w-72 shrink-0 space-y-5 bg-white p-5 rounded-2xl border border-slate-200 h-fit shadow-xs`}>
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
                      className={`flex items-center justify-between p-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${active ? 'bg-blue-50 border border-blue-200 text-blue-600' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
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
                      className={`flex items-center justify-between p-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${active ? 'bg-blue-50 border border-blue-200 text-blue-600' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
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
        <div className="flex-1 min-w-0 w-full space-y-4">

          <div className="flex flex-col sm:flex-row gap-3 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by keywords, assignees, titles, descriptions..."
                className="pl-10 h-11 bg-white border-slate-200 rounded-xl text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="w-full sm:w-56 shrink-0">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-11 bg-white border-slate-200 rounded-xl text-xs font-semibold px-3 w-full">
                  <SelectValue placeholder="Sort order" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created-desc" className="text-xs font-medium">🕒 Created (Newest)</SelectItem>
                  <SelectItem value="created-asc" className="text-xs font-medium">🕒 Created (Oldest)</SelectItem>
                  <SelectItem value="due-asc" className="text-xs font-medium">📅 Deadline (Earliest)</SelectItem>
                  <SelectItem value="due-desc" className="text-xs font-medium">📅 Deadline (Latest)</SelectItem>
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
                      className="flex-1 p-6 space-y-3 cursor-pointer hover:bg-slate-50/50 transition-colors min-w-0"
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
                        <h3 className="text-base font-extrabold text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                          {task.title}
                        </h3>
                        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all shrink-0" />
                      </div>

                      <p className="text-slate-500 text-xs leading-relaxed line-clamp-2 pr-4 font-normal">
                        {task.description}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 border-t border-slate-100 text-slate-500">
                        <div className="flex items-center gap-2 min-w-0">
                          <User className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="text-xs font-bold text-slate-700 truncate">{task.assigneeName || 'Unassigned'}</span>
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="text-xs font-bold text-slate-700 truncate">{task.department || 'General'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
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
                    <div className="flex flex-col sm:flex-row md:flex-col items-center justify-center gap-2.5 p-4 md:p-5 border-t md:border-t-0 md:border-l border-slate-100 bg-slate-50/20 shrink-0 md:w-48 lg:w-52 w-full">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs h-9 rounded-xl transition-colors cursor-pointer justify-center shadow-xs">
                          Status <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
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
                        className="w-full bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-600 border border-slate-200 hover:border-blue-200 font-bold text-xs h-9 rounded-xl transition-all cursor-pointer justify-center gap-1.5 shadow-xs"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-slate-400" /> Notes
                      </Button>

                      <div className="flex gap-2 w-full items-center">
                        <Button
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); setEditingTask(task); }}
                          className={`h-9 text-xs font-bold text-slate-700 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-200 rounded-xl border border-slate-200 transition-all ${canDeleteTask ? 'flex-1' : 'w-full'} justify-center`}
                        >
                          <Edit3 className="w-3.5 h-3.5 mr-1" /> Edit
                        </Button>
                        {canDeleteTask && (
                          <Button
                            variant="destructive"
                            onClick={(e) => { e.stopPropagation(); setTaskToDelete(task); }}
                            className="h-9 px-3 text-xs font-bold bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 hover:border-red-600 rounded-xl transition-all justify-center"
                            title="Delete Task"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
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
      <TaskDetailDialog
        selectedTask={selectedTask}
        onClose={() => setSelectedTask(null)}
        profile={profile}
        activeDetailTab={activeDetailTab}
        setActiveDetailTab={setActiveDetailTab}
        logTaskActivity={logTaskActivity}
        createNotification={createNotification}
        getStatusColor={getStatusColor}
      />

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


