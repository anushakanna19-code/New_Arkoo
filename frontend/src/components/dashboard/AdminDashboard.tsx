import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  getDocs, 
  where,
  orderBy,
  limit,
  onSnapshot
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { 
  Users, 
  Mic, 
  ClipboardList, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  TrendingUp,
  BarChart3,
  FileText,
  Activity,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { motion } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { format } from 'date-fns';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { parseFirestoreDate, formatDeadlineDisplay } from '@/lib/date-utils';

export function AdminDashboard({ profile }: { profile: any }) {
  const [stats, setStats] = useState({
    totalMeetings: 0,
    totalTasks: 0,
    pendingTasks: 0,
    inProgressTasks: 0,
    completedTasks: 0,
    delayedTasks: 0
  });
  const [recentMeetings, setRecentMeetings] = useState<any[]>([]);
  const [deptStats, setDeptStats] = useState<any[]>([]);
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    // Real-time meetings (full stream to get true count and recent 3 slice)
    const mUnsubscribe = onSnapshot(query(collection(db, 'meetings'), orderBy('createdAt', 'desc')), (snap) => {
      const meetings = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      setRecentMeetings(meetings.slice(0, 3));
      
      setStats(prev => ({
        ...prev,
        totalMeetings: snap.size
      }));

      if (meetings.length > 0) {
        setAlerts(prev => {
          const filtered = prev.filter(a => a.type !== 'meeting');
          const latest = meetings[0];
          return [{
            type: 'meeting',
            title: 'MOM Generated',
            subtitle: latest.title,
            detail: `${latest.tasksCount || 0} Action items pushed`,
            color: 'blue'
          }, ...filtered].slice(0, 3);
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'meetings');
    });

    // Real-time tasks with deep dynamic metric aggregation
    const tUnsubscribe = onSnapshot(collection(db, 'tasks'), (snap) => {
      const tasks = snap.docs.map(d => d.data() as any);
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      
      const pending = tasks.filter(t => String(t.status || '').toLowerCase() === 'pending').length;
      const inProgress = tasks.filter(t => {
        const s = String(t.status || '').toLowerCase();
        return s === 'in progress' || s === 'in-progress';
      }).length;
      const completed = tasks.filter(t => String(t.status || '').toLowerCase() === 'completed').length;
      
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // Delayed tasks: explicitly marked as "delayed" or (not completed and past due date)
      const delayed = tasks.filter(t => {
        const s = String(t.status || '').toLowerCase();
        if (s === 'delayed') return true;
        const dDate = parseFirestoreDate(t.deadline);
        if (s !== 'completed' && dDate && dDate < todayStart) return true;
        return false;
      }).length;
      
      setStats(prev => ({
        ...prev,
        totalTasks: snap.size,
        pendingTasks: pending,
        inProgressTasks: inProgress,
        completedTasks: completed,
        delayedTasks: delayed
      }));

      // Set task delay alert if any
      const delayedTask = tasks.find(t => {
        const s = String(t.status || '').toLowerCase();
        const dDate = parseFirestoreDate(t.deadline);
        return s === 'delayed' || (s !== 'completed' && dDate && dDate < todayStart);
      });
      if (delayedTask) {
        setAlerts(prev => {
          const filtered = prev.filter(a => a.type !== 'task');
          return [{
            type: 'task',
            title: 'Task Delayed Alert',
            subtitle: delayedTask.title,
            detail: `Assigned to: ${delayedTask.assigneeName || 'Unassigned'} | Due: ${formatDeadlineDisplay(delayedTask.deadline)}`,
            color: 'amber'
          }, ...filtered].slice(0, 3);
        });
      }

      // Calculate department stats
      const depts = ['Production', 'Sourcing', 'Management', 'Design', 'Quality Control', 'Project', 'Accounts', 'HR'];
      const dStats = depts.map(name => {
        const dTasks = tasks.filter(t => String(t.department || '').toLowerCase() === name.toLowerCase());
        const dCompleted = dTasks.filter(t => String(t.status || '').toLowerCase() === 'completed').length;
        const completion = dTasks.length > 0 ? Math.round((dCompleted / dTasks.length) * 100) : 0;
        return { name, completion, total: dTasks.length, completed: dCompleted };
      });
      setDeptStats(dStats.filter(d => d.completion > 0 || depts.slice(0, 3).includes(d.name)));

      // Generate Weekly Productivity chart from actual task completion data
      const weeklyCounts = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
      
      tasks.forEach(t => {
        if (String(t.status || '').toLowerCase() === 'completed') {
          let dateObj: Date | null = null;
          const completedAt = t.completedAt || t.updatedAt || t.createdAt;
          
          if (completedAt) {
            if (completedAt.toDate && typeof completedAt.toDate === 'function') {
              dateObj = completedAt.toDate();
            } else if (completedAt.seconds) {
              dateObj = new Date(completedAt.seconds * 1000);
            } else {
              dateObj = new Date(completedAt);
            }
          }
          
          if (dateObj && !isNaN(dateObj.getTime())) {
            const dayOfWeek = format(dateObj, 'EEE'); // 'Mon', 'Tue', etc.
            if (dayOfWeek in weeklyCounts) {
              weeklyCounts[dayOfWeek as keyof typeof weeklyCounts]++;
            }
          } else if (t.deadline) {
            const parsedDate = parseFirestoreDate(t.deadline);
            if (parsedDate && !isNaN(parsedDate.getTime())) {
              const dayOfWeek = format(parsedDate, 'EEE');
              if (dayOfWeek in weeklyCounts) {
                weeklyCounts[dayOfWeek as keyof typeof weeklyCounts]++;
              }
            }
          }
        }
      });
      
      const chartData = Object.keys(weeklyCounts).map(day => ({
        name: day,
        tasks: weeklyCounts[day as keyof typeof weeklyCounts]
      }));
      setWeeklyData(chartData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tasks');
    });

    // Real-time employees for simple alerts
    const eUnsubscribe = onSnapshot(query(collection(db, 'employees'), orderBy('createdAt', 'desc'), limit(1)), (snap) => {
      if (!snap.empty) {
        const latest = snap.docs[0].data();
        setAlerts(prev => {
          const filtered = prev.filter(a => a.type !== 'employee');
          return [{
            type: 'employee',
            title: 'New Employee Onboarded',
            subtitle: `${latest.fullName} (${latest.department})`,
            detail: 'Welcome to the team!',
            color: 'green'
          }, ...filtered].slice(0, 3);
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'employees');
    });

    return () => {
      mUnsubscribe();
      tUnsubscribe();
      eUnsubscribe();
    };
  }, []);

  const completionRate = stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0;

  return (
    <div className="space-y-6 pb-10">
      {/* Welcome Section */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight">
            Welcome back, {profile?.displayName || 'Sir'}
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">Here's what's happening across your projects today.</p>
        </div>
        <div className="text-[11px] text-slate-400 font-medium">
          {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <StatCard title="Total Meetings" value={stats.totalMeetings} icon={Mic} color="blue" />
        <StatCard title="Total Tasks" value={stats.totalTasks} icon={ClipboardList} color="slate" />
        <StatCard title="Pending" value={stats.pendingTasks} icon={Clock} color="amber" />
        <StatCard title="In Progress" value={stats.inProgressTasks} icon={Activity} color="indigo" />
        <StatCard title="Completed" value={stats.completedTasks} icon={CheckCircle2} color="emerald" />
        <StatCard title="Delayed" value={stats.delayedTasks} icon={AlertCircle} color="rose" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        {/* Activity Graph */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                </div>
                Weekly Productivity
              </CardTitle>
              <CardDescription>Tasks completed per day of the week</CardDescription>
            </div>
            <span className="text-[11px] font-medium text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">This Week</span>
          </CardHeader>
          <CardContent className="h-[280px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
              <AreaChart data={weeklyData}>
                <defs>
                  <linearGradient id="colorTasks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.08}/>
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="#94A3B8" dy={5} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="#94A3B8" dx={-5} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#fff', 
                    borderRadius: '12px', 
                    border: '1px solid #E2E8F0', 
                    boxShadow: '0 4px 12px rgb(0 0 0 / 0.06)',
                    fontSize: '12px',
                    padding: '8px 12px'
                  }}
                  itemStyle={{ color: '#3B82F6', fontWeight: 600 }}
                />
                <Area type="monotone" dataKey="tasks" stroke="#3B82F6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorTasks)" dot={{ r: 3.5, fill: '#3B82F6', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5, fill: '#3B82F6', stroke: '#fff', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Department Progress */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                <BarChart3 className="w-3.5 h-3.5 text-slate-600" />
              </div>
              Department Efficiency
            </CardTitle>
            <CardDescription>Task completion rate by department</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {deptStats.length === 0 ? (
               <div className="text-center py-10 text-slate-400 text-[13px]">Assign tasks to see statistics.</div>
            ) : deptStats.map((dept) => (
              <div key={dept.name} className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[13px] font-medium text-slate-700">{dept.name}</span>
                  <span className="text-[12px] text-slate-500 font-semibold">{dept.completion}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${dept.completion}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                    className={`h-full rounded-full ${
                      dept.completion > 80 ? 'bg-emerald-500' : 
                      dept.completion > 50 ? 'bg-blue-500' : 
                      dept.completion > 25 ? 'bg-amber-500' : 'bg-slate-300'
                    }`}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        {/* Recent Meetings */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
              </div>
              Recent Meetings
            </CardTitle>
            <button className="text-[12px] font-medium text-blue-600 hover:text-blue-700 transition-colors cursor-pointer flex items-center gap-1">
              View All <ArrowUpRight className="w-3 h-3" />
            </button>
          </CardHeader>
          <CardContent>
             <div className="space-y-2">
                {recentMeetings.length === 0 ? (
                   <div className="text-center py-10 text-slate-400 text-[13px]">No processed meetings found.</div>
                ) : recentMeetings.map(meeting => (
                  <div key={meeting.id} className="flex items-center gap-3.5 px-3 py-3 rounded-xl hover:bg-slate-50/80 transition-colors cursor-pointer group">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      meeting.status === 'completed' ? 'bg-emerald-50 text-emerald-500' : 
                      meeting.status === 'failed' ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-500'
                    }`}>
                      <Mic className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 truncate text-[13px] leading-tight">{meeting.title}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{meeting.duration || '00:00'} • {meeting.department || 'General'}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      meeting.status === 'completed' 
                        ? 'bg-emerald-50 text-emerald-600' 
                        : (meeting.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600')
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        meeting.status === 'completed' ? 'bg-emerald-500' : 
                        meeting.status === 'failed' ? 'bg-red-500' : 'bg-blue-500'
                      }`} />
                      {meeting.status}
                    </span>
                  </div>
                ))}
             </div>
          </CardContent>
        </Card>

        {/* Activity & Alerts */}
        <Card className="bg-white border-slate-200 shadow-xs">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                </div>
                System Alerts
              </CardTitle>
              {alerts.length > 0 && (
                <button 
                  onClick={() => setAlerts([])}
                  className="text-[11px] font-bold text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                  id="clear-alerts-btn"
                >
                  CLEAR
                </button>
              )}
            </div>
            <CardDescription>Live system notifications & updates</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400 text-[13px]">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2 opacity-60" />
                  No recent system alerts.
                </div>
              ) : alerts.map((alert, idx) => (
                <div 
                  key={idx} 
                  className={`p-3 rounded-xl border flex gap-3 transition-all ${
                    alert.color === 'amber' ? 'bg-amber-50/50 border-amber-100 text-amber-900' : 
                    alert.color === 'blue' ? 'bg-blue-50/50 border-blue-100 text-blue-900' : 
                    alert.color === 'green' ? 'bg-emerald-50/50 border-emerald-100 text-emerald-900' : 
                    'bg-slate-50 border-slate-100 text-slate-800'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                    alert.color === 'amber' ? 'bg-amber-500' : 
                    alert.color === 'blue' ? 'bg-blue-500' : 
                    alert.color === 'green' ? 'bg-emerald-500' : 'bg-slate-400'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-slate-900 leading-tight">{alert.title}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate leading-tight">{alert.subtitle}</p>
                    <p className={`text-[11px] mt-1 font-semibold ${
                      alert.color === 'amber' ? 'text-amber-700' : 
                      alert.color === 'blue' ? 'text-blue-700' : 
                      alert.color === 'green' ? 'text-emerald-700' : 'text-slate-600'
                    }`}>{alert.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Completion Rate Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <Card className="sm:col-span-1">
          <CardContent className="p-5 flex flex-col items-center justify-center text-center">
            <div className="relative w-20 h-20 mb-3">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#F1F5F9" strokeWidth="3" />
                <motion.path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#3B82F6"
                  strokeWidth="3"
                  strokeLinecap="round"
                  initial={{ strokeDasharray: "0 100" }}
                  animate={{ strokeDasharray: `${completionRate} 100` }}
                  transition={{ duration: 1.5, ease: 'easeOut' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-slate-800">{completionRate}%</span>
              </div>
            </div>
            <p className="text-[13px] font-semibold text-slate-700">Overall Completion</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{stats.completedTasks} of {stats.totalTasks} tasks</p>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2">
          <CardContent className="p-5">
            <p className="text-[13px] font-semibold text-slate-700 mb-3">Task Distribution</p>
            <div className="space-y-2.5">
              {[
                { label: 'Completed', value: stats.completedTasks, total: stats.totalTasks, color: 'bg-emerald-500' },
                { label: 'In Progress', value: stats.inProgressTasks, total: stats.totalTasks, color: 'bg-blue-500' },
                { label: 'Pending', value: stats.pendingTasks, total: stats.totalTasks, color: 'bg-amber-400' },
                { label: 'Delayed', value: stats.delayedTasks, total: stats.totalTasks, color: 'bg-rose-500' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${item.color} shrink-0`} />
                  <span className="text-[12px] text-slate-600 font-medium w-24">{item.label}</span>
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${item.total > 0 ? (item.value / item.total) * 100 : 0}%` }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                      className={`h-full rounded-full ${item.color}`}
                    />
                  </div>
                  <span className="text-[12px] font-semibold text-slate-700 w-8 text-right">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: any) {
  const colorMap: any = {
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-600',    icon: 'text-blue-500' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   icon: 'text-amber-500' },
    slate:   { bg: 'bg-slate-100',  text: 'text-slate-600',   icon: 'text-slate-500' },
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600',  icon: 'text-indigo-500' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', icon: 'text-emerald-500' },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-600',    icon: 'text-rose-500' },
  };
  const c = colorMap[color] || colorMap.slate;

  return (
    <Card className="group cursor-default">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div className={`w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center`}>
            <Icon className={`w-4 h-4 ${c.icon}`} />
          </div>
          <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-400 transition-colors" />
        </div>
        <span className="text-2xl sm:text-[28px] font-bold text-slate-800 tracking-tight block leading-none">{value}</span>
        <span className="text-[11px] sm:text-[12px] text-slate-500 font-medium mt-1.5 block">{title}</span>
      </CardContent>
    </Card>
  );
}
