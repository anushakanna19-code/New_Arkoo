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
  collection, 
  query, 
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
  Video, 
  ShieldCheck, 
  Trash2,
  ChevronRight,
  MoreHorizontal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  DropdownMenu, 
  DropdownMenuTrigger, 
  DropdownMenuContent, 
  DropdownMenuItem 
} from '@/components/ui/dropdown-menu';
import { AdminDashboard } from '@/components/dashboard/AdminDashboard';
import { MeetingModule } from '@/components/meeting/MeetingModule';
import { TaskModule } from '@/components/task/TaskModule';
import { EmployeeModule } from '@/components/employee/EmployeeModule';
import { RoleManagementModule } from '@/components/role/RoleManagementModule';
import { SettingsModule } from '@/components/settings/SettingsModule';
import { RecycleBinModule } from '@/components/recycle/RecycleBinModule';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currTab, setCurrTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const emailLower = String(user.email || '').trim().toLowerCase();

          // 1. System Super Admin Check (configurable via env, fallback to defaults)
          const superAdminEmails = (import.meta.env.VITE_SUPER_ADMIN_EMAILS || 'admin@arkooprebuild.com,anushakanna19@gmail.com')
            .split(',').map((e: string) => e.trim().toLowerCase());
          const isSystemSuperAdmin = superAdminEmails.includes(emailLower);

          if (isSystemSuperAdmin) {
            let savedName = user.displayName || 'System Admin';
            let savedDept = 'Management';
            try {
              const userDoc = await getDoc(doc(db, 'users', user.uid));
              if (userDoc.exists()) {
                const data = userDoc.data();
                if (data.displayName) savedName = data.displayName;
                if (data.department) savedDept = data.department;
              }
            } catch (e) {
              console.error("Failed to fetch admin user doc", e);
            }

            const adminProfile = {
              uid: user.uid,
              email: user.email,
              displayName: savedName,
              role: 'admin',
              stakeholderType: 'Admin',
              department: savedDept,
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
            console.warn(`[Access Denied] User ${user.email} is not in Stakeholders master directory.`);
            await signOut(auth);
            setUser(null);
            setProfile(null);
            setAccessDeniedMessage(`Access Denied: The Google account "${user.email}" has not been added by an Administrator. Self-registration is disabled. Please contact your Admin for an invitation.`);
            setLoading(false);
            return;
          }

          // 3. Check Approval Status
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
          if (superAdminEmails.includes(emailLower) || typeVal === 'admin' || (typeVal === '' && roleVal === 'admin') || roleVal === 'admin') {
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
            isActive: true,
            employeeId: matchedEmp.id
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
    setMobileMenuOpen(false);
    await signOut(auth);
    setProfile(null);
    setUser(null);
    toast.info('Logged out successfully');
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4 px-4 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
          <p className="text-slate-500 font-medium font-sans text-sm">Initializing Arkoo Prebuild Intelligence...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-[#f8f9fb] p-4 sm:p-6">
        <motion.div 
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="max-w-sm w-full bg-white rounded-2xl shadow-card border border-slate-200/60 p-6 sm:p-8 text-center"
        >
          <img src="https://www.arkooprebuild.com/img/logo/logo.png" alt="Arkoo" className="h-16 sm:h-20 mx-auto mb-6 object-contain" />
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 mb-1">Welcome Back</h1>
          <p className="text-[13px] text-slate-500 mb-6">Sign in to access your dashboard</p>

          {accessDeniedMessage && (
            <div className="mb-5 p-3.5 bg-red-50 border border-red-100 rounded-xl text-left text-[12px] text-red-700 leading-relaxed">
              <p className="font-semibold text-red-800 mb-1 flex items-center gap-1.5 text-[12px]">
                Access Restricted
              </p>
              {accessDeniedMessage}
            </div>
          )}

          <Button 
            onClick={handleLogin}
            className="w-full h-11 text-[13px] font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md shadow-blue-500/20 transition-all cursor-pointer"
          >
            <svg className="w-4 h-4 mr-2 shrink-0" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Sign in with Google
          </Button>

          <div className="mt-5 p-3 bg-slate-50/80 rounded-xl border border-slate-100 text-left">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              <span className="font-semibold text-slate-600">Note:</span> Self-registration is disabled. Contact your Administrator for access.
            </p>
          </div>
        </motion.div>
        <p className="text-[11px] text-slate-400 mt-6 text-center">Arkoo Prebuild Pvt. Ltd. © {new Date().getFullYear()}</p>
        <Toaster position="top-right" richColors />
      </div>
    );
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'manager', 'employee', 'vendor', 'supplier', 'other'] },
    { id: 'record-meeting', label: 'Record Meeting', icon: Mic, roles: ['admin', 'manager'] },
    { id: 'meetings', label: 'Meetings', icon: Video, roles: ['admin', 'manager', 'employee', 'vendor', 'supplier'] },
    { id: 'tasks', label: 'Tasks', icon: ClipboardList, roles: ['admin', 'manager', 'employee', 'vendor', 'supplier', 'other'] },
    { id: 'employees', label: 'Stakeholders', icon: Users, roles: ['admin', 'manager', 'employee'] },
    { id: 'role-management', label: 'Role Management', icon: ShieldCheck, roles: ['admin'] },
    { id: 'recycle-bin', label: 'Recycle Bin', icon: Trash2, roles: ['admin'] },
  ];

  const userRole = String(profile?.role || 'employee').toLowerCase();

  const isTabAllowed = (tabId: string) => {
    if (tabId === 'settings') return userRole === 'admin';
    const item = navItems.find(n => n.id === tabId);
    if (!item || !item.roles) return true;
    return item.roles.includes(userRole);
  };

  const allowedNavItems = navItems.filter(item => {
    if (!item.roles) return true;
    return item.roles.includes(userRole);
  });

  const selectTab = (tabId: string) => {
    setCurrTab(tabId);
    setMobileMenuOpen(false);
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
      case 'settings': return <SettingsModule profile={profile} onProfileUpdate={(updates: any) => setProfile({ ...profile, ...updates })} />;
      case 'recycle-bin': return <RecycleBinModule profile={profile} />;
      default: return userRole === 'admin' || userRole === 'manager' ? <AdminDashboard profile={profile} /> : <TaskModule profile={profile} />;
    }
  };

  return (
    <div className="h-screen w-screen flex bg-[#f8f9fb] overflow-hidden font-sans">
      <Toaster position="top-right" richColors />

      {/* ─── Mobile Slide-Over Navigation Drawer ─── */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileMenuOpen(false)}
              className="md:hidden fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 transition-opacity"
            />

            {/* Slide-out Menu Panel */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="md:hidden fixed left-0 top-0 bottom-0 w-[290px] max-w-[85vw] bg-white z-50 flex flex-col shadow-2xl border-r border-slate-200"
            >
              {/* Drawer Header with Logo & Close */}
              <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 bg-slate-50/50 h-20">
                <img 
                  src="https://www.arkooprebuild.com/img/logo/logo.png" 
                  alt="Arkoo" 
                  className="h-12 max-h-12 w-auto max-w-[190px] object-contain object-left" 
                />
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  aria-label="Close Navigation"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* User Identity Card with Integrated Settings */}
              <div className="p-3.5 border-b border-slate-100 bg-slate-50/60">
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs space-y-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="w-10 h-10 border-2 border-blue-100 shrink-0 shadow-xs">
                      <AvatarImage src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName}`} />
                      <AvatarFallback className="bg-blue-50 text-blue-600 text-sm font-bold">{user.displayName?.[0] || 'U'}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold text-slate-900 truncate leading-tight">{user.displayName || 'User'}</p>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">{user.email}</p>
                      <span className="inline-block mt-1 px-2 py-0.5 text-[9px] font-bold uppercase rounded-md bg-blue-50 text-blue-700 border border-blue-100">
                        {profile?.stakeholderType || profile?.role || 'Employee'}
                      </span>
                    </div>
                  </div>

                  {userRole === 'admin' && (
                    <div className="pt-2 border-t border-slate-100">
                      <button
                        onClick={() => selectTab('settings')}
                        className={`w-full flex items-center justify-between px-3 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                          currTab === 'settings'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-xs'
                            : 'text-slate-700 hover:bg-slate-50 hover:text-blue-600 border border-slate-200/80 bg-slate-50/40'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Settings className="w-4 h-4 text-slate-500" />
                          <span>Settings & Preferences</span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Navigation Items */}
              <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-2">Navigation Menu</div>
                {allowedNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => selectTab(item.id)}
                      className={`
                        w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg transition-all cursor-pointer text-left
                        ${isActive 
                          ? 'bg-blue-50 text-blue-700 font-bold shadow-xs' 
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-semibold'
                        }
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                        <span className="text-[13px]">{item.label}</span>
                      </div>
                      {isActive && <ChevronRight className="w-4 h-4 text-blue-600 shrink-0" />}
                    </button>
                  );
                })}
              </nav>

              {/* Drawer Logout Footer */}
              <div className="p-3.5 border-t border-slate-100 bg-slate-50/40 mt-auto">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs rounded-lg transition-colors cursor-pointer border border-red-200/80 shadow-xs"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      
      {/* ─── Desktop Sidebar ─── */}
      <motion.aside 
        initial={false}
        animate={{ width: sidebarOpen ? 260 : 72 }}
        className="hidden md:flex bg-white border-r border-slate-200/60 text-slate-900 flex-col z-40 shrink-0"
      >
        <div className={`px-4 py-3 flex items-center border-b border-slate-100/80 h-20 ${sidebarOpen ? 'justify-start' : 'justify-center'}`}>
          {sidebarOpen ? (
            <div className="flex items-center pl-1">
              <img 
                src="https://www.arkooprebuild.com/img/logo/logo.png" 
                alt="Arkoo" 
                className="h-14 max-h-14 w-auto max-w-[215px] object-contain object-left" 
              />
            </div>
          ) : (
            <div className="flex items-center justify-center w-full">
              <img 
                src="https://www.arkooprebuild.com/img/logo/logo.png" 
                alt="Arkoo" 
                className="h-8 max-h-8 w-auto max-w-[44px] object-contain" 
              />
            </div>
          )}
        </div>

        <nav className="flex-1 px-3 space-y-0.5 mt-5 overflow-y-auto">
          {sidebarOpen && (
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3 px-3">Main Menu</div>
          )}
          {allowedNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = currTab === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => setCurrTab(item.id)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer
                  ${isActive 
                    ? 'bg-blue-50 text-blue-700 font-bold shadow-xs' 
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 font-medium'
                  }
                `}
              >
                <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                {sidebarOpen && <span className="text-[13px]">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="px-3 pb-4 pt-3 border-t border-slate-100">
          <div className="bg-slate-50/70 p-2 rounded-xl border border-slate-100">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar className="w-8 h-8 border-2 border-slate-200/80 shrink-0 shadow-xs">
                  <AvatarImage src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName}`} />
                  <AvatarFallback className="bg-blue-50 text-blue-600 text-xs font-bold">{user.displayName?.[0] || 'U'}</AvatarFallback>
                </Avatar>
                {sidebarOpen && (
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate leading-tight">{user.displayName}</p>
                    <p className="text-[10px] text-slate-400 capitalize font-medium mt-0.5">{profile?.role}</p>
                  </div>
                )}
              </div>
              {sidebarOpen && (
                <div className="flex items-center gap-1 shrink-0">
                  {userRole === 'admin' && (
                    <button 
                      onClick={() => setCurrTab('settings')}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                        currTab === 'settings' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-blue-600 hover:bg-slate-100'
                      }`}
                      title="Settings"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  )}
                  <button 
                    onClick={handleLogout}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.aside>

      {/* ─── Mobile Bottom Nav (Quick Shortcuts + More Drawer Trigger) ─── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 flex items-center justify-around px-1 py-1.5 shadow-lg safe-bottom">
        {/* Top 4 primary role shortcuts */}
        {allowedNavItems.slice(0, 4).map((item) => {
          const Icon = item.icon;
          const isActive = currTab === item.id && !mobileMenuOpen;
          return (
            <button
              key={item.id}
              onClick={() => selectTab(item.id)}
              className={`flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-xl transition-all cursor-pointer min-w-[56px] ${
                isActive ? 'text-blue-600 font-bold' : 'text-slate-400 font-medium hover:text-slate-600'
              }`}
            >
              <div className={`p-1 rounded-lg ${isActive ? 'bg-blue-50' : ''}`}>
                <Icon className="w-4.5 h-4.5" />
              </div>
              <span className="text-[10px] tracking-tight leading-none">{item.label.split(' ')[0]}</span>
            </button>
          );
        })}

        {/* 5th Button: More Drawer Trigger */}
        <button
          onClick={() => setMobileMenuOpen(true)}
          className={`flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-xl transition-all cursor-pointer min-w-[56px] ${
            mobileMenuOpen ? 'text-blue-600 font-bold' : 'text-slate-400 font-medium hover:text-slate-600'
          }`}
          aria-label="Open Full Menu"
        >
          <div className={`p-1 rounded-lg ${mobileMenuOpen ? 'bg-blue-50' : ''}`}>
            <MoreHorizontal className="w-4.5 h-4.5" />
          </div>
          <span className="text-[10px] tracking-tight leading-none">Menu</span>
        </button>
      </div>

      {/* ─── Main Content Canvas ─── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="h-[56px] sm:h-[60px] bg-white border-b border-slate-200/60 flex items-center justify-between px-3 sm:px-6 shrink-0 z-20">
          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Hamburger Button (Works for BOTH mobile drawer & desktop collapse) */}
            <button 
              onClick={() => {
                if (window.innerWidth < 768) {
                  setMobileMenuOpen(true);
                } else {
                  setSidebarOpen(!sidebarOpen);
                }
              }} 
              className="flex p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer shrink-0"
              aria-label="Toggle Navigation"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Mobile Logo Brand */}
            <div className="md:hidden flex items-center gap-2">
              <img 
                src="https://www.arkooprebuild.com/img/logo/logo.png" 
                alt="Arkoo" 
                className="h-8 max-h-8 w-auto max-w-[110px] object-contain object-left" 
              />
              <span className="text-slate-200 font-light">|</span>
            </div>

            <h2 className="text-[14px] sm:text-base font-semibold text-slate-800 truncate max-w-[150px] sm:max-w-xs md:max-w-md">
              {navItems.find(item => item.id === currTab)?.label || currTab.replace('-', ' ')}
            </h2>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex items-center gap-2 bg-slate-50/80 px-3 py-1.5 rounded-xl border border-slate-200/60">
              <span className="text-[11px] text-slate-400 font-medium">Role:</span>
              <span className="text-[11px] font-semibold text-slate-700 capitalize">
                {profile?.stakeholderType || profile?.role || 'Employee'}
              </span>
            </div>

            <div className="relative">
              <button 
                onClick={() => setCurrTab('tasks')}
                className="p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-xl transition-all cursor-pointer"
                title="Notifications"
              >
                <Bell className="w-[18px] h-[18px]" />
              </button>
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full ring-2 ring-white" />
            </div>

            <div 
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden cursor-pointer active:scale-95 transition-transform"
            >
              <Avatar className="w-8 h-8 border-2 border-slate-100 shadow-xs">
                <AvatarImage src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName}`} />
                <AvatarFallback className="bg-blue-50 text-blue-600 text-xs font-semibold">{user.displayName?.[0] || 'U'}</AvatarFallback>
              </Avatar>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger render={
                <button className="hidden md:flex items-center gap-2.5 pl-2 border-l border-slate-200/60 hover:opacity-80 transition-opacity cursor-pointer text-left">
                  <Avatar className="w-8 h-8 border-2 border-slate-100 shadow-xs">
                    <AvatarImage src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName}`} />
                    <AvatarFallback className="bg-blue-50 text-blue-600 text-xs font-semibold">{user.displayName?.[0] || 'U'}</AvatarFallback>
                  </Avatar>
                  <div className="hidden lg:block">
                    <p className="text-[13px] font-semibold text-slate-800 leading-tight">{user.displayName}</p>
                    <p className="text-[10px] text-slate-400 capitalize font-medium">{profile?.role}</p>
                  </div>
                </button>
              } />
              <DropdownMenuContent align="end" className="w-56 p-1.5 rounded-2xl shadow-xl border border-slate-200 bg-white z-50">
                <div className="px-3 py-2 border-b border-slate-100 mb-1">
                  <p className="text-xs font-bold text-slate-900 truncate">{user.displayName}</p>
                  <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
                  <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-blue-50 text-blue-600">
                    {profile?.stakeholderType || profile?.role || 'Employee'}
                  </span>
                </div>
                {userRole === 'admin' && (
                  <DropdownMenuItem 
                    onClick={() => setCurrTab('settings')}
                    className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-blue-600 hover:bg-blue-50 rounded-xl cursor-pointer"
                  >
                    <Settings className="w-4 h-4 text-slate-400" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem 
                  onClick={handleLogout}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-xl cursor-pointer"
                >
                  <LogOut className="w-4 h-4 text-red-500" />
                  <span>Sign Out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Dynamic Content (safe pb-24 on mobile prevents bottom nav overlap) */}
        <div className="flex-1 overflow-auto px-3 py-4 sm:px-6 sm:py-6 pb-24 md:pb-6">
          <AnimatePresence mode="wait">
            <motion.div 
              key={currTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="h-full max-w-[1400px] mx-auto"
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
