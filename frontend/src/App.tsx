import { useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider,
  signOut,
  User
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc,
  addDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Toaster, toast } from 'sonner';
import { 
  LayoutDashboard, 
  Mic, 
  ClipboardList, 
  Users, 
  Settings, 
  LogOut,
  Bell,
  Menu,
  X,
  FileText,
  TrendingUp,
  Clock,
  CheckCircle2,
  Video,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AdminDashboard } from '@/components/dashboard/AdminDashboard';
import { MeetingModule } from '@/components/meeting/MeetingModule';
import { TaskModule } from '@/components/task/TaskModule';
import { EmployeeModule } from '@/components/employee/EmployeeModule';
import { RoleManagementModule } from '@/components/role/RoleManagementModule';
import { SettingsModule } from '@/components/settings/SettingsModule';
import { RecycleBinModule } from '@/components/recycle/RecycleBinModule';

import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currTab, setCurrTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const emailLower = String(user.email || '').trim().toLowerCase();

          // 1. System Super Admin Check (dedicated system admin addresses)
          const isSystemSuperAdmin = emailLower === 'admin@arkooprebuild.com' || emailLower === 'anushakanna19@gmail.com';

          if (isSystemSuperAdmin) {
            const adminProfile = {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName || 'System Admin',
              role: 'admin',
              stakeholderType: 'Admin',
              department: 'Management',
              isActive: true
            };
            setUser(user);
            setProfile(adminProfile);
            setAccessDeniedMessage(null);
            setLoading(false);
            return;
          }

          // 2. Admin-Controlled Verification: Search Firestore Employees Master Collection
          const q = query(collection(db, 'employees'));
          const snap = await getDocs(q);
          let matchedEmp: any = null;

          snap.forEach(doc => {
            const d = doc.data();
            const offEmail = String(d.email || '').trim().toLowerCase();
            const perEmail = String(d.personalEmail || '').trim().toLowerCase();
            if (offEmail === emailLower || perEmail === emailLower) {
              matchedEmp = { id: doc.id, ...d };
            }
          });

          if (!matchedEmp) {
            // Self-registration is disabled! Deny access.
            console.warn(`[Access Denied] User ${user.email} is not in Stakeholders master directory.`);
            await signOut(auth);
            setUser(null);
            setProfile(null);
            setAccessDeniedMessage(`Access Denied: The Google account "${user.email}" has not been added by an Administrator. Self-registration is disabled. Please contact your Admin for an invitation.`);
            setLoading(false);
            return;
          }

          // 3. Check Approval Status (Pending / Rejected / Active)
          const empStatus = matchedEmp.status ? String(matchedEmp.status).toLowerCase() : (matchedEmp.isActive === false ? 'rejected' : 'active');

          if (empStatus === 'pending') {
            console.warn(`[Access Pending] User ${user.email} is currently pending Admin approval.`);
            await signOut(auth);
            setUser(null);
            setProfile(null);
            setAccessDeniedMessage(`Access Pending: Your stakeholder account ("${user.email}") is currently pending approval by the Administrator. You will be able to log in once your request is accepted.`);
            setLoading(false);
            return;
          }

          if (empStatus === 'rejected' || matchedEmp.isActive === false) {
            console.warn(`[Access Denied] User ${user.email} stakeholder account is rejected.`);
            await signOut(auth);
            setUser(null);
            setProfile(null);
            setAccessDeniedMessage(`Access Denied: Your stakeholder account ("${user.email}") has been denied access by the Administrator.`);
            setLoading(false);
            return;
          }

          // 4. User matched and approved -> Assign RBAC Role
          const typeVal = String(matchedEmp.stakeholderType || '').trim().toLowerCase();
          const roleVal = String(matchedEmp.role || '').trim().toLowerCase();

          let userRole = 'employee';
          if (emailLower === 'anushakanna19@gmail.com' || typeVal === 'admin' || (typeVal === '' && roleVal === 'admin') || roleVal === 'admin') {
            userRole = 'admin';
          } else if (typeVal === 'manager' || (typeVal === '' && roleVal === 'manager')) {
            userRole = 'manager';
          } else if (typeVal === 'vendor' || (typeVal === '' && roleVal === 'vendor')) {
            userRole = 'vendor';
          } else if (typeVal === 'supplier' || (typeVal === '' && roleVal === 'supplier')) {
            userRole = 'supplier';
          } else {
            userRole = 'employee';
          }

          const userProfile = {
            uid: user.uid,
            email: user.email,
            displayName: matchedEmp.fullName || user.displayName || 'User',
            role: userRole,
            department: matchedEmp.department || 'General',
            stakeholderType: matchedEmp.stakeholderType || 'Employee',
            isActive: true
          };

          setUser(user);
          setProfile(userProfile);
          setAccessDeniedMessage(null);

          // Set default tab by role
          if (userRole === 'admin' || userRole === 'manager') {
            setCurrTab('dashboard');
          } else {
            setCurrTab('tasks');
          }

        } catch (error: any) {
          console.error('Auth flow error:', error);
          toast.error('Authentication verification failed.');
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleLogin = async () => {
    setAccessDeniedMessage(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      toast.error('Login failed: ' + error.message);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setProfile(null);
    setUser(null);
    toast.info('Logged out successfully');
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-orange" />
          <p className="text-slate-500 font-medium font-sans">Initializing Arkoo Prebuild Intelligence...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-8 text-center"
        >
          <div className="w-16 h-16 bg-orange-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Mic className="w-8 h-8 text-orange-500" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Arkoo Prebuild</h1>
          <p className="text-slate-500 text-sm mb-6">Pvt. Ltd. | Admin-Controlled Access & RBAC</p>

          {accessDeniedMessage && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-left text-xs text-red-700 leading-relaxed font-medium">
              <p className="font-bold text-red-800 mb-1 flex items-center gap-1.5">
                🛑 Access Restricted
              </p>
              {accessDeniedMessage}
            </div>
          )}

          <Button 
            onClick={handleLogin}
            className="w-full h-12 text-base font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-xl shadow-lg shadow-orange-500/20 transition-all cursor-pointer"
          >
            Sign in with Google
          </Button>

          <div className="mt-6 p-3 bg-slate-50 rounded-xl border border-slate-100 text-left">
            <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Notice</p>
            <p className="text-[11px] text-slate-500 leading-normal">
              Self-registration is disabled. Access is strictly controlled by your Administrator. Added stakeholders receive an invitation email upon approval.
            </p>
          </div>
        </motion.div>
        <Toaster position="top-right" />
      </div>
    );
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'manager', 'employee', 'vendor', 'supplier', 'other'] },
    { id: 'meetings', label: 'Meetings', icon: Video, roles: ['admin', 'manager', 'employee', 'vendor', 'supplier'] },
    { id: 'record-meeting', label: 'Record Meeting', icon: Mic, roles: ['admin', 'manager'] },
    { id: 'tasks', label: 'Tasks', icon: ClipboardList, roles: ['admin', 'manager', 'employee', 'vendor', 'supplier', 'other'] },
    { id: 'employees', label: 'Stakeholders', icon: Users, roles: ['admin', 'manager', 'employee'] },
    { id: 'role-management', label: 'Role Management', icon: ShieldCheck, roles: ['admin'] },
    { id: 'settings', label: 'Settings', icon: Settings, roles: ['admin'] },
    { id: 'recycle-bin', label: 'Recycle Bin', icon: Trash2, roles: ['admin'] },
  ];

  const userRole = String(profile?.role || 'employee').toLowerCase();

  const isTabAllowed = (tabId: string) => {
    const item = navItems.find(n => n.id === tabId);
    if (!item || !item.roles) return true;
    return item.roles.includes(userRole);
  };

  const renderContent = () => {
    const targetTab = isTabAllowed(currTab) ? currTab : (userRole === 'admin' || userRole === 'manager' ? 'dashboard' : 'tasks');

    switch (targetTab) {
      case 'dashboard': return <AdminDashboard profile={profile} />;
      case 'meetings': return <MeetingModule profile={profile} initialView="list" />;
      case 'record-meeting': return (
        <MeetingModule 
          profile={profile} 
          initialView="record" 
          onProcessingFinished={() => setCurrTab('meetings')} 
        />
      );
      case 'tasks': return <TaskModule profile={profile} />;
      case 'employees': return <EmployeeModule profile={profile} />;
      case 'role-management': return <RoleManagementModule profile={profile} />;
      case 'settings': return <SettingsModule profile={profile} />;
      case 'recycle-bin': return <RecycleBinModule profile={profile} />;
      default: return userRole === 'admin' || userRole === 'manager' ? <AdminDashboard profile={profile} /> : <TaskModule profile={profile} />;
    }
  };

  return (
    <div className="h-screen w-screen flex bg-slate-50 overflow-hidden font-sans">
      <Toaster position="top-right" />
      
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: sidebarOpen ? 256 : 80 }}
        className="bg-white border-r border-slate-200 text-slate-900 flex flex-col z-50 shrink-0 shadow-sm"
      >
        <div className="p-6 h-16 flex items-center gap-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center shrink-0 text-white font-bold text-sm shadow-md">
            A
          </div>
          {sidebarOpen && (
            <span className="font-bold text-xl tracking-tight text-slate-800">
              ARKOO <span className="text-orange-500">PREBUILD</span>
            </span>
          )}
        </div>

        <nav className="flex-1 px-3 space-y-1 mt-6">
          {sidebarOpen && (
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-3">Main Menu</div>
          )}
          {navItems.map((item) => {
            if ((item as any).roles && !(item as any).roles.includes(profile?.role)) return null;
            const Icon = item.icon;
            const isActive = currTab === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => setCurrTab(item.id)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all
                  ${isActive ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-600 hover:bg-slate-50 font-medium'}
                `}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                {sidebarOpen && <span className="text-sm">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className={`flex items-center gap-3 p-1 rounded-xl`}>
            <Avatar className="w-8 h-8 border border-slate-200">
              <AvatarImage src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName}`} />
              <AvatarFallback>{user.displayName?.[0] || 'U'}</AvatarFallback>
            </Avatar>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-800 truncate">{user.displayName}</p>
                <p className="text-[10px] text-slate-400 uppercase font-black">{profile?.role}</p>
              </div>
            )}
            {sidebarOpen && (
              <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
              {sidebarOpen ? <Menu className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <h2 className="text-lg font-bold text-slate-800 capitalize">
              {navItems.find(item => item.id === currTab)?.label || currTab.replace('-', ' ')}
            </h2>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Approved Stakeholder Type Indicator */}
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200/80">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Stakeholder:</span>
              <span className="text-xs font-black text-slate-800 uppercase tracking-wide">
                {profile?.stakeholderType || profile?.role || 'Employee'}
              </span>
            </div>

            <div className="relative">
              <button className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
                <Bell className="w-5 h-5" />
              </button>
              <span className="absolute top-2 right-2 w-2 h-2 bg-brand-orange rounded-full" />
            </div>
          </div>
        </header>

        {/* Dynamic Content */}
        <div className="flex-1 overflow-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div 
              key={currTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
