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
  Activity
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
            color: 'orange'
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
            color: 'blue'
          }, ...filtered].slice(0, 3);
        });
      }

      // Calculate department stats
      const depts = ['Production', 'Sourcing', 'Management', 'Design', 'Quality Control', 'Project', 'Accounts', 'HR'];
      const dStats = depts.map(name => {
        const dTasks = tasks.filter(t => String(t.department || '').toLowerCase() === name.toLowerCase());
        const dCompleted = dTasks.filter(t => String(t.status || '').toLowerCase() === 'completed').length;
        const completion = dTasks.length > 0 ? Math.round((dCompleted / dTasks.length) * 100) : 0;
        return { name, completion };
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
            color: 'slate'
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

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Welcome back, {profile?.displayName || 'Sir'}</h1>
        <p className="text-slate-500">Here's what's happening across Arkoo Prebuild Pvt. Ltd. projects today.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-5">
        <StatCard title="Total Meetings" value={stats.totalMeetings} icon={Mic} color="blue" />
        <StatCard title="Total Tasks" value={stats.totalTasks} icon={ClipboardList} color="slate" />
        <StatCard title="Pending" value={stats.pendingTasks} icon={Clock} color="orange" />
        <StatCard title="In Progress" value={stats.inProgressTasks} icon={Activity} color="purple" />
        <StatCard title="Completed" value={stats.completedTasks} icon={CheckCircle2} color="green" />
        <StatCard title="Delayed / Past Due" value={stats.delayedTasks} icon={AlertCircle} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Activity Graph */}
        <Card className="lg:col-span-2 shadow-sm border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2 m-0">
              <TrendingUp className="w-5 h-5 text-brand-orange" />
              Weekly Productivity
            </CardTitle>
            <CardDescription className="text-slate-500 text-xs">Number of tasks completed per day</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyData}>
                <defs>
                  <linearGradient id="colorTasks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F97316" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#F97316" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} stroke="#64748B" />
                <YAxis fontSize={12} tickLine={false} axisLine={false} stroke="#64748B" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ color: '#F97316', fontWeight: 600 }}
                />
                <Area type="monotone" dataKey="tasks" stroke="#F97316" strokeWidth={3} fillOpacity={1} fill="url(#colorTasks)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Department Progress */}
        <Card className="shadow-sm border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2 m-0">
              <BarChart3 className="w-5 h-5 text-brand-blue" />
              Department Efficiency
            </CardTitle>
            <CardDescription className="text-slate-500 text-xs">Completion rate by department</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {deptStats.length === 0 ? (
               <div className="text-center py-10 text-slate-400 text-sm italic">Assign tasks to see statistics.</div>
            ) : deptStats.map((dept) => (
              <div key={dept.name} className="space-y-1">
                <div className="flex justify-between items-center text-xs font-semibold">
                  <span className="text-slate-700">{dept.name}</span>
                  <span className="text-slate-500 font-bold">{dept.completion}%</span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${dept.completion}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                    className={`h-full rounded-full ${dept.completion > 80 ? 'bg-emerald-500' : dept.completion > 50 ? 'bg-brand-blue' : 'bg-brand-orange'}`}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Meetings */}
        <Card className="shadow-sm border-slate-200 bg-white animate-fade-in">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-bold flex items-center gap-2 m-0">
              <Clock className="w-5 h-5 text-brand-blue" />
              Recent Meetings
            </CardTitle>
            <Button variant="outline" size="sm" className="rounded-lg h-9 font-bold text-xs">View All</Button>
          </CardHeader>
          <CardContent>
             <div className="space-y-4">
                {recentMeetings.length === 0 ? (
                   <div className="text-center py-10 text-slate-400 text-sm italic">No processed meetings found.</div>
                ) : recentMeetings.map(meeting => (
                  <div key={meeting.id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${meeting.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-blue/10 text-brand-blue'}`}>
                      <Mic className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 truncate text-sm m-0 leading-tight">{meeting.title}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 font-medium">{meeting.duration || '00:00'} • {meeting.department || 'General'}</p>
                    </div>
                    <div className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                      meeting.status === 'completed' 
                        ? 'bg-emerald-50 text-emerald-600' 
                        : (meeting.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600')
                    }`}>
                      {meeting.status}
                    </div>
                  </div>
                ))}
             </div>
          </CardContent>
        </Card>

        {/* Activity alerts */}
        <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <h4 className="font-bold text-sm flex items-center gap-2 m-0 text-white tracking-wider">
                <AlertCircle className="w-4 h-4 text-orange-500" />
                AI SYSTEM ALERTS
              </h4>
              {alerts.length > 0 && (
                <button 
                  onClick={() => setAlerts([])}
                  className="text-[9px] font-black tracking-widest text-slate-500 hover:text-white transition-colors"
                  id="clear-alerts-btn"
                >
                  CLEAR ALL
                </button>
              )}
            </div>
            <div className="space-y-5 flex-1">
              {alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 opacity-30 italic text-xs text-slate-300">
                  No recent system alerts.
                </div>
              ) : alerts.map((alert, idx) => (
                <div key={idx} className={`flex gap-3 border-l-2 pl-4 py-0.5 ${
                  alert.color === 'orange' ? 'border-orange-500' : 
                  alert.color === 'blue' ? 'border-blue-500' : 'border-slate-700'
                }`}>
                  <div>
                    <p className="text-xs font-black text-white leading-none m-0">{alert.title}</p>
                    <p className="text-[10px] text-slate-400 mt-1 truncate max-w-[280px] leading-tight mb-0">{alert.subtitle}</p>
                    <p className={`text-[10px] mt-1 italic font-bold mb-0 ${
                      alert.color === 'orange' ? 'text-brand-orange' : 
                      alert.color === 'blue' ? 'text-blue-400' : 'text-slate-400'
                    }`}>{alert.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Button variant="ghost" className="w-full mt-6 bg-slate-800/40 hover:bg-slate-800 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-white h-10 rounded-xl border-none">
            View All Activity
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: any) {
  const colors: any = {
    blue: 'text-blue-600 border-l-blue-600',
    orange: 'text-orange-600 border-l-orange-600',
    slate: 'text-slate-600 border-l-slate-600',
    purple: 'text-indigo-600 border-l-indigo-600',
    green: 'text-emerald-600 border-l-emerald-600',
    red: 'text-rose-600 border-l-rose-600'
  };
  const activeColorClass = colors[color] || 'text-slate-600 border-l-slate-600';

  return (
    <Card className={`shadow-sm border-slate-200 border-l-4 ${activeColorClass} rounded-xl overflow-hidden transform hover:scale-[1.02] transition-all bg-white`}>
      <CardContent className="p-4 flex flex-row items-center justify-between h-20">
        <div>
          <span className="text-slate-400 text-[9px] font-black uppercase tracking-wide mb-1 block">{title}</span>
          <span className="text-xl font-black text-slate-800 tracking-tight">{value}</span>
        </div>
        <div className={`p-2 rounded-xl bg-slate-50 shrink-0 ${activeColorClass.split(' ')[0]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </CardContent>
    </Card>
  );
}
