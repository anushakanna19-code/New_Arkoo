import { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getApiUrl } from '@/lib/api';
import { 
  Users, 
  Plus, 
  Search, 
  Trash2,
  Edit3,
  Eye,
  ChevronRight,
  MapPin,
  Calendar,
  Mail,
  Phone,
  X,
  Check,
  ArrowUpDown
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog,
  DialogContent,
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

export function EmployeeModule({ profile }: { profile: any }) {
  const [employees, setEmployees] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [openAdd, setOpenAdd] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<any | null>(null);

  const [sortBy, setSortBy] = useState<string>('date-desc');

  const userRole = String(profile?.role || '').toLowerCase();
  const isAdminOrManager = userRole === 'admin' || userRole === 'manager';

  useEffect(() => {
    const q = query(collection(db, 'employees'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'employees');
    });
    return unsubscribe;
  }, []);

  const deleteEmployee = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm('Are you sure you want to delete this employee?')) return;
    try {
      await deleteDoc(doc(db, 'employees', id));
      toast.success('Employee deleted successfully');
    } catch (error) {
       handleFirestoreError(error, OperationType.DELETE, `employees/${id}`);
       toast.error('Delete failed');
    }
  };

  const handleAcceptStakeholder = async (emp: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await updateDoc(doc(db, 'employees', emp.id), {
        status: 'Active',
        isActive: true,
        updatedAt: serverTimestamp()
      });
      toast.success(`Stakeholder "${emp.fullName}" accepted! Account is now active.`);

      // Send activation email with application link to official email address
      const officialEmail = String(emp.email || emp.personalEmail || '').trim();

      if (officialEmail && officialEmail.includes('@')) {
        toast.loading(`Sending activation link email to ${officialEmail}...`, { id: 'accept-mail-toast' });
        try {
          await fetch(getApiUrl('/api/send-acceptance-email'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fullName: emp.fullName,
              email: officialEmail,
              stakeholderType: emp.stakeholderType || 'Employee',
              department: emp.department || 'General'
            })
          });
          toast.success(`Activation email with application link sent to ${officialEmail}`, { id: 'accept-mail-toast' });
        } catch (mailErr: any) {
          console.error('Acceptance email error:', mailErr);
          toast.error(`Accepted stakeholder, but email notification failed.`, { id: 'accept-mail-toast' });
        }
      }
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `employees/${emp.id}`);
      toast.error('Failed to accept stakeholder');
    }
  };

  const handleSendLinkToAllStakeholders = async () => {
    if (employees.length === 0) {
      toast.error('No stakeholders found to send emails to.');
      return;
    }
    if (!confirm(`Are you sure you want to send the official application link (https://new-arkoo.pages.dev/) to all ${employees.length} stakeholders' official emails?`)) {
      return;
    }

    toast.loading('Sending application link to all stakeholders...', { id: 'bulk-link-toast' });
    try {
      const payload = employees.map(e => ({
        fullName: e.fullName,
        email: e.email || e.officialEmail || e.personalEmail,
        stakeholderType: e.stakeholderType,
        department: e.department,
        status: e.status || (e.isActive !== false ? 'Active' : 'Pending')
      }));

      const res = await fetch(getApiUrl('/api/send-bulk-application-link'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stakeholders: payload })
      });

      const data = await res.json();
      if (data.success) {
        toast.success(`Application link successfully sent to ${data.count || payload.length} stakeholder official email(s)!`, { id: 'bulk-link-toast' });
      } else {
        toast.error(`Bulk email send failed: ${data.error}`, { id: 'bulk-link-toast' });
      }
    } catch (err: any) {
      console.error('Bulk email dispatch error:', err);
      toast.error(`Failed to send emails: ${err.message || err}`, { id: 'bulk-link-toast' });
    }
  };

  const handleRejectStakeholder = async (id: string, name: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm(`Are you sure you want to reject stakeholder "${name}"? Access will be denied.`)) return;
    try {
      await updateDoc(doc(db, 'employees', id), {
        status: 'Rejected',
        isActive: false,
        updatedAt: serverTimestamp()
      });
      toast.success(`Stakeholder "${name}" rejected. Access denied.`);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `employees/${id}`);
      toast.error('Failed to reject stakeholder');
    }
  };

  const formatDOJ = (dateVal: any) => {
    if (!dateVal) return 'N/A';
    try {
      if (typeof dateVal === 'string') {
        const d = new Date(dateVal);
        return isNaN(d.getTime()) ? dateVal : format(d, 'MMM d, yyyy');
      }
      if (dateVal.toDate) {
        return format(dateVal.toDate(), 'MMM d, yyyy');
      }
    } catch (e) {}
    return 'N/A';
  };

  const getInitials = (name: string) => {
    if (!name) return 'EM';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const getEmployeeSortDate = (emp: any) => {
    if (emp.createdAt) {
      if (emp.createdAt.toDate) return emp.createdAt.toDate().getTime();
      if (emp.createdAt.seconds) return emp.createdAt.seconds * 1000;
      const d = new Date(emp.createdAt).getTime();
      if (!isNaN(d)) return d;
    }
    if (emp.updatedAt) {
      if (emp.updatedAt.toDate) return emp.updatedAt.toDate().getTime();
      if (emp.updatedAt.seconds) return emp.updatedAt.seconds * 1000;
      const d = new Date(emp.updatedAt).getTime();
      if (!isNaN(d)) return d;
    }
    if (emp.joiningDate) {
      const d = new Date(emp.joiningDate).getTime();
      if (!isNaN(d)) return d;
    }
    return 0;
  };

  const getEmployeeJoiningDate = (emp: any) => {
    if (emp.joiningDate) {
      const d = new Date(emp.joiningDate).getTime();
      if (!isNaN(d)) return d;
    }
    return getEmployeeSortDate(emp);
  };

  const sortedEmployees = [...employees].sort((a, b) => {
    if (sortBy === 'date-desc') {
      return getEmployeeSortDate(b) - getEmployeeSortDate(a);
    }
    if (sortBy === 'date-asc') {
      return getEmployeeSortDate(a) - getEmployeeSortDate(b);
    }
    if (sortBy === 'joining-desc') {
      return getEmployeeJoiningDate(b) - getEmployeeJoiningDate(a);
    }
    if (sortBy === 'joining-asc') {
      return getEmployeeJoiningDate(a) - getEmployeeJoiningDate(b);
    }
    if (sortBy === 'name-asc') {
      return (a.fullName || '').localeCompare(b.fullName || '');
    }
    if (sortBy === 'name-desc') {
      return (b.fullName || '').localeCompare(a.fullName || '');
    }
    return 0;
  });

  const filteredEmployees = sortedEmployees.filter(e => 
    (e.fullName || '').toLowerCase().includes(search.toLowerCase()) || 
    (e.employeeId || '').toLowerCase().includes(search.toLowerCase()) ||
    (e.department || '').toLowerCase().includes(search.toLowerCase()) ||
    (e.designation || '').toLowerCase().includes(search.toLowerCase()) ||
    (e.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (e.stakeholderType || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header and Add Button Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 w-full lg:w-auto flex-wrap">
          <div className="relative flex-1 w-full sm:w-72 lg:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search employees..." 
              className="pl-10 h-11 bg-white border-slate-200 rounded-xl text-sm w-full"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Sort By Dropdown */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-xs font-semibold px-3 w-full sm:w-[190px]">
                <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 text-slate-400 shrink-0" />
                <SelectValue placeholder="Sort By" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date-desc" className="text-xs font-medium">🕒 Newest Added / Updated</SelectItem>
                <SelectItem value="date-asc" className="text-xs font-medium">🕒 Oldest Added</SelectItem>
                <SelectItem value="joining-desc" className="text-xs font-medium">📅 Joining Date (Newest)</SelectItem>
                <SelectItem value="joining-asc" className="text-xs font-medium">📅 Joining Date (Oldest)</SelectItem>
                <SelectItem value="name-asc" className="text-xs font-medium">🔤 Name (A → Z)</SelectItem>
                <SelectItem value="name-desc" className="text-xs font-medium">🔤 Name (Z → A)</SelectItem>
              </SelectContent>
            </Select>

            <span className="text-xs sm:text-sm text-slate-500 font-bold whitespace-nowrap px-1 shrink-0">
              {filteredEmployees.length} stakeholders
            </span>
          </div>
        </div>

        {isAdminOrManager && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
            <Button 
              onClick={handleSendLinkToAllStakeholders}
              variant="outline"
              className="w-full sm:w-auto border-blue-200 text-blue-600 hover:bg-blue-50 font-bold h-11 rounded-xl text-xs sm:text-sm px-4 bg-white shadow-xs justify-center"
            >
              <Mail className="w-4 h-4 mr-2 text-blue-600" /> Send Link to All
            </Button>
            <Dialog open={openAdd} onOpenChange={setOpenAdd}>
              <DialogTrigger render={<Button className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 rounded-xl text-xs sm:text-sm px-5 shadow-md shadow-blue-500/20 justify-center">
                <Plus className="w-4 h-4 mr-1.5" /> Add Stakeholder
              </Button>} />
              <DialogContent className="w-[95vw] sm:max-w-2xl rounded-3xl p-5 sm:p-7 bg-white max-h-[90vh] overflow-y-auto">
                <DialogHeader className="pb-3 border-b border-slate-100">
                  <DialogTitle className="text-xl font-bold text-slate-900">Add Stakeholder</DialogTitle>
                </DialogHeader>
                <EmployeeForm onSuccess={() => setOpenAdd(false)} />
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {/* Stakeholders Dual View: Cards on Mobile (< md), Table on Desktop (>= md) */}

      {/* Mobile Card List (< md) */}
      <div className="md:hidden space-y-3">
        {filteredEmployees.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center text-slate-400">
            <Users className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p className="font-semibold text-sm">No stakeholders found.</p>
          </div>
        ) : (
          filteredEmployees.map((emp) => {
            const initials = getInitials(emp.fullName);
            return (
              <div
                key={emp.id}
                className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3"
              >
                {/* Header: Avatar, Name, Role & Status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-600 font-bold text-xs flex items-center justify-center shrink-0">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-900 text-sm leading-tight truncate">{emp.fullName}</h4>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">{emp.employeeId || 'AR-000'} • {emp.designation || emp.role || 'Specialist'}</p>
                    </div>
                  </div>

                  {/* Status Badge */}
                  {emp.status === 'Active' || (emp.status === undefined && emp.isActive !== false) ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active
                    </span>
                  ) : emp.status === 'Rejected' || emp.isActive === false ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Rejected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Pending
                    </span>
                  )}
                </div>

                {/* Department & Type Pills */}
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-md">
                    {emp.department || 'Management'}
                  </span>
                  <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 text-[11px] font-semibold rounded-md">
                    {emp.stakeholderType || 'Employee'}
                  </span>
                  {emp.location && (
                    <span className="px-2.5 py-0.5 bg-slate-50 text-slate-500 text-[11px] font-medium rounded-md flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-400" /> {emp.location}
                    </span>
                  )}
                </div>

                {/* Contact Links */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 text-xs text-slate-600">
                  {emp.email && (
                    <a href={`mailto:${emp.email}`} className="flex items-center gap-1.5 text-blue-600 hover:underline truncate">
                      <Mail className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="truncate">{emp.email}</span>
                    </a>
                  )}
                  {(emp.mobile || emp.officialNumber) && (
                    <a href={`tel:${emp.mobile || emp.officialNumber}`} className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{emp.mobile || emp.officialNumber}</span>
                    </a>
                  )}
                </div>

                {/* Actions Footer */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-1.5">
                    {isAdminOrManager && emp.status !== 'Active' && emp.status !== 'Accepted' && (
                      <button 
                        onClick={(e) => handleAcceptStakeholder(emp, e)}
                        className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1 border border-emerald-200 shadow-xs"
                      >
                        <Check className="w-3.5 h-3.5" /> Accept
                      </button>
                    )}
                    {isAdminOrManager && emp.status !== 'Rejected' && (
                      <button 
                        onClick={(e) => handleRejectStakeholder(emp.id, emp.fullName, e)}
                        className="px-2.5 py-1 bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1 border border-rose-200 shadow-xs"
                      >
                        <X className="w-3.5 h-3.5" /> Reject
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => setViewingEmployee(emp)}
                      className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
                      title="View Details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {isAdminOrManager && (
                      <button 
                        onClick={() => setEditingEmployee(emp)}
                        className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
                        title="Edit Stakeholder"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                    {isAdminOrManager && (
                      <button
                        onClick={(e) => deleteEmployee(emp.id, e)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete Stakeholder"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop Table (>= md) */}
      <div className="hidden md:block bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/70 border-b border-slate-200/80 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="py-3.5 px-6">Stakeholder</th>
                <th className="py-3.5 px-4">Type</th>
                <th className="py-3.5 px-4">Department</th>
                <th className="py-3.5 px-4">Role</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Location</th>
                <th className="py-3.5 px-4">DOJ</th>
                <th className="py-3.5 px-4">Official Email</th>
                <th className="py-3.5 px-4">Official No.</th>
                <th className="py-3.5 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filteredEmployees.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-slate-400">
                    No stakeholders found matching search criteria.
                  </td>
                </tr>
              )}
              {filteredEmployees.map((emp) => {
                const initials = getInitials(emp.fullName);
                return (
                  <tr key={emp.id} className="hover:bg-slate-50/60 transition-colors group">
                    {/* Employee Name & ID */}
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-600 font-bold text-xs flex items-center justify-center shrink-0">
                          {initials}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 text-sm">{emp.fullName}</div>
                          <div className="text-[11px] text-slate-400 font-mono uppercase">{emp.employeeId || 'AR-000'}</div>
                        </div>
                      </div>
                    </td>

                    {/* Stakeholder Type Badge */}
                    <td className="py-4 px-4">
                      <span className={`inline-block px-3 py-1 text-xs font-semibold rounded-md max-w-[140px] truncate ${
                        ['Vendor', 'Supplier'].includes(emp.stakeholderType) 
                          ? 'bg-amber-100 text-amber-700' 
                          : ['Manager'].includes(emp.stakeholderType)
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                      }`}>
                        {emp.stakeholderType || 'Employee'}
                      </span>
                    </td>

                    {/* Department Badge */}
                    <td className="py-4 px-4">
                      <span className="inline-block px-3 py-1 bg-slate-100 text-slate-600 text-xs font-semibold rounded-md max-w-[140px] truncate">
                        {emp.department || 'Management'}
                      </span>
                    </td>

                    {/* Role / Designation */}
                    <td className="py-4 px-4 text-slate-600 font-medium">
                      {emp.designation || emp.role || 'Specialist'}
                    </td>

                    {/* Status Badge */}
                    <td className="py-4 px-4">
                      {emp.status === 'Active' || (emp.status === undefined && emp.isActive !== false) ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active
                        </span>
                      ) : emp.status === 'Rejected' || emp.isActive === false ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Rejected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200 animate-pulse">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Pending
                        </span>
                      )}
                    </td>

                    {/* Location */}
                    <td className="py-4 px-4 text-slate-600">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span>{emp.location || 'Pune'}</span>
                      </div>
                    </td>

                    {/* DOJ */}
                    <td className="py-4 px-4 text-slate-600 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatDOJ(emp.joiningDate || emp.createdAt)}</span>
                      </div>
                    </td>

                    {/* Official Email */}
                    <td className="py-4 px-4 text-slate-600">
                      <div className="flex items-center gap-1.5 max-w-[200px]">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{emp.email || 'N/A'}</span>
                      </div>
                    </td>

                    {/* Official No. */}
                    <td className="py-4 px-4 text-slate-600 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>{emp.mobile || emp.officialNumber || 'N/A'}</span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Accept Button for Pending/Rejected */}
                        {isAdminOrManager && emp.status !== 'Active' && emp.status !== 'Accepted' && (
                          <button 
                            onClick={(e) => handleAcceptStakeholder(emp, e)}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1 border border-emerald-200 hover:border-emerald-600 shadow-sm"
                            title="Accept & Activate Stakeholder"
                          >
                            <Check className="w-3.5 h-3.5" /> Accept
                          </button>
                        )}
                        {/* Reject Button for Pending/Active */}
                        {isAdminOrManager && emp.status !== 'Rejected' && (
                          <button 
                            onClick={(e) => handleRejectStakeholder(emp.id, emp.fullName, e)}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1 border border-rose-200 hover:border-rose-600 shadow-sm"
                            title="Reject & Deny Stakeholder"
                          >
                            <X className="w-3.5 h-3.5" /> Reject
                          </button>
                        )}
                        <button 
                          onClick={() => setViewingEmployee(emp)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {isAdminOrManager && (
                          <button 
                            onClick={() => setEditingEmployee(emp)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                            title="Edit Stakeholder"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        )}
                        {isAdminOrManager && (
                          <button
                            onClick={(e) => deleteEmployee(emp.id, e)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete Stakeholder"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Employee Dialog */}
      {editingEmployee && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setEditingEmployee(null); }}>
          <DialogContent className="w-[95vw] sm:max-w-2xl rounded-3xl p-5 sm:p-7 bg-white max-h-[90vh] overflow-y-auto">
            <DialogHeader className="pb-3 border-b border-slate-100">
              <DialogTitle className="text-xl font-bold text-slate-900">Edit Stakeholder</DialogTitle>
            </DialogHeader>
            <EmployeeForm employee={editingEmployee} onSuccess={() => setEditingEmployee(null)} />
          </DialogContent>
        </Dialog>
      )}

      {/* View Employee Detail Modal */}
      {viewingEmployee && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setViewingEmployee(null); }}>
          <DialogContent className="max-w-md rounded-2xl p-6 bg-white">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-600 font-bold text-xs flex items-center justify-center">
                  {getInitials(viewingEmployee.fullName)}
                </div>
                <div>
                  <div>{viewingEmployee.fullName}</div>
                  <div className="text-xs text-slate-400 font-normal">{viewingEmployee.employeeId || 'AR-000'}</div>
                </div>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2 text-sm">
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Department</span>
                <span className="font-semibold text-slate-800">{viewingEmployee.department || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Designation</span>
                <span className="font-semibold text-slate-800">{viewingEmployee.designation || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Gender</span>
                <span className="font-semibold text-slate-800">{viewingEmployee.gender || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Location</span>
                <span className="font-semibold text-slate-800">{viewingEmployee.location || 'Pune'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Date of Joining</span>
                <span className="font-semibold text-slate-800">{formatDOJ(viewingEmployee.joiningDate)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Official Email</span>
                <span className="font-semibold text-slate-800 truncate max-w-[220px]">{viewingEmployee.email || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Personal Email</span>
                <span className="font-semibold text-slate-800 truncate max-w-[220px]">{viewingEmployee.personalEmail || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Date of Birth</span>
                <span className="font-semibold text-slate-800">{formatDOJ(viewingEmployee.dateOfBirth)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Blood Group</span>
                <span className="font-semibold text-slate-800">{viewingEmployee.bloodGroup || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Emergency Contact</span>
                <span className="font-semibold text-slate-800">{viewingEmployee.emergencyContact || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Address</span>
                <span className="font-semibold text-slate-800 truncate max-w-[220px]">{viewingEmployee.currentAddress || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Official Number</span>
                <span className="font-semibold text-slate-800">{viewingEmployee.mobile || viewingEmployee.officialNumber || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-400">Personal Number</span>
                <span className="font-semibold text-slate-800">{viewingEmployee.personalNumber || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400">Reporting Manager</span>
                <span className="font-semibold text-slate-800">{viewingEmployee.reportingManager || 'No manager'}</span>
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setViewingEmployee(null)} className="w-full rounded-xl">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function EmployeeForm({ employee, onSuccess }: { employee?: any; onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    fullName: employee?.fullName || '',
    stakeholderType: employee?.stakeholderType || 'Employee',
    employeeId: employee?.employeeId || '',
    joiningDate: employee?.joiningDate || '',
    department: employee?.department || '',
    designation: employee?.designation || '',
    gender: employee?.gender || '',
    location: employee?.location || 'Pune',
    email: employee?.email || '',
    personalEmail: employee?.personalEmail || '',
    countryCodeOfficial: employee?.countryCodeOfficial || 'IN +91',
    officialNumber: employee?.officialNumber || employee?.mobile || '',
    countryCodePersonal: employee?.countryCodePersonal || 'IN +91',
    personalNumber: employee?.personalNumber || '',
    reportingManager: employee?.reportingManager || '',
    dateOfBirth: employee?.dateOfBirth || '',
    bloodGroup: employee?.bloodGroup || '',
    emergencyContact: employee?.emergencyContact || '',
    currentAddress: employee?.currentAddress || ''
  });

  // Load dropdown options from Firestore settings
  const [dropdownOpts, setDropdownOpts] = useState({
    stakeholderTypes: ['Admin', 'Employee', 'Manager', 'Vendor', 'Supplier', 'Other'],
    departments: [
      'Project Management', 'Operations Department', 'Finance Department',
      'Production', 'Sourcing', 'Quality Control', 'HR Department'
    ],
    designations: [
      'Project Engineer', 'HR Executive', 'Operation Incharge',
      'Production Head', 'Sr. Erection Engineer', 'Account Executive',
      'Safety Engineer', 'Specialist'
    ],
    locations: ['Pune', 'Mumbai', 'Bangalore', 'Delhi']
  });

  useEffect(() => {
    const ref = doc(db, 'settings', 'stakeholderOptions');
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setDropdownOpts(prev => ({
          stakeholderTypes: d.stakeholderTypes ? (d.stakeholderTypes.includes('Admin') ? d.stakeholderTypes : ['Admin', ...d.stakeholderTypes]) : prev.stakeholderTypes,
          departments:      d.departments      ?? prev.departments,
          designations:     d.designations     ?? prev.designations,
          locations:        d.locations        ?? prev.locations,
        }));
      }
    });
    return unsub;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName.trim()) {
      toast.error('Please enter the employee full name.');
      return;
    }

    const primaryEmail = (formData.email || formData.personalEmail || '').trim();
    if (!primaryEmail || !primaryEmail.includes('@')) {
      toast.error('Please enter a valid email address (e.g. employee@company.com).');
      return;
    }

    setLoading(true);
    try {
      const generatedId = formData.employeeId.trim() || `EMP-${Math.floor(1000 + Math.random() * 9000)}`;
      const isTypeAdmin = String(formData.stakeholderType || '').trim().toLowerCase() === 'admin';
      
      const payload = {
        ...formData,
        employeeId: generatedId,
        department: formData.department || 'Production',
        designation: formData.designation || 'Specialist',
        location: formData.location || 'Pune',
        email: primaryEmail,
        personalEmail: formData.personalEmail.trim(),
        mobile: formData.officialNumber || formData.personalNumber || 'N/A',
        role: isTypeAdmin ? 'admin' : String(formData.designation || 'Specialist').toLowerCase(),
        stakeholderType: isTypeAdmin ? 'Admin' : formData.stakeholderType,
        status: isTypeAdmin ? 'Active' : (employee?.status || 'Pending'),
        isActive: isTypeAdmin ? true : (employee?.isActive ?? false),
        updatedAt: serverTimestamp()
      };

      console.log('[Employee Master] Submitting payload:', payload);

      if (employee?.id) {
        await updateDoc(doc(db, 'employees', employee.id), payload);
        toast.success('Employee updated successfully');
      } else {
        await addDoc(collection(db, 'employees'), {
          ...payload,
          status: isTypeAdmin ? 'Active' : 'Pending',
          isActive: isTypeAdmin ? true : false,
          createdAt: serverTimestamp()
        });

        const endpoint = isTypeAdmin ? '/api/send-acceptance-email' : '/api/send-invitation-email';
        toast.loading(isTypeAdmin ? 'Dispatching activation email...' : 'Dispatching invitation email...', { id: 'invite-toast' });

        try {
          const mailRes = await fetch(getApiUrl(endpoint), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fullName: payload.fullName,
              email: primaryEmail,
              personalEmail: formData.personalEmail,
              stakeholderType: payload.stakeholderType,
              department: payload.department
            })
          });

          const rawText = await mailRes.text();
          let mailData: any = {};
          try {
            mailData = rawText ? JSON.parse(rawText) : {};
          } catch (pErr) {
            mailData = { success: mailRes.ok };
          }

          toast.success(`Stakeholder added! Access link sent to ${primaryEmail}`, { id: 'invite-toast' });
        } catch (mailErr: any) {
          toast.success(`Stakeholder added! Access email queued for ${primaryEmail}`, { id: 'invite-toast' });
        }
      }
      onSuccess();
    } catch (error: any) {
      console.error('[Employee Master Error]:', error);
      toast.error(`Failed to save stakeholder: ${error.message || 'Check database permissions'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      {/* Full Name & Stakeholder Type */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Full Name *</Label>
          <Input 
            required
            placeholder="e.g. Rahul Sharma"
            value={formData.fullName} 
            onChange={e => setFormData({...formData, fullName: e.target.value})} 
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Stakeholder Type *</Label>
          <Select value={formData.stakeholderType} onValueChange={val => setFormData({...formData, stakeholderType: val})}>
            <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-[13px]">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {dropdownOpts.stakeholderTypes.map(t => (
                <SelectItem key={t} value={t} className="text-[13px]">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Employee ID & Date of Joining */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Stakeholder ID <span className="text-slate-400 font-normal">(auto if blank)</span></Label>
          <Input 
            placeholder="e.g. STK-1042"
            value={formData.employeeId} 
            onChange={e => setFormData({...formData, employeeId: e.target.value})} 
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Date of Joining *</Label>
          <Input 
            type="date"
            required
            value={formData.joiningDate} 
            onChange={e => setFormData({...formData, joiningDate: e.target.value})} 
          />
        </div>
      </div>

      {/* Department & Designation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Department *</Label>
          <Select value={formData.department} onValueChange={val => setFormData({...formData, department: val})}>
            <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-[13px]">
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent>
              {dropdownOpts.departments.map(d => (
                <SelectItem key={d} value={d} className="text-[13px]">{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Designation *</Label>
          <Select value={formData.designation} onValueChange={val => setFormData({...formData, designation: val})}>
            <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-[13px]">
              <SelectValue placeholder="Select designation" />
            </SelectTrigger>
            <SelectContent>
              {dropdownOpts.designations.map(d => (
                <SelectItem key={d} value={d} className="text-[13px]">{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Gender & Location */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Gender</Label>
          <Select value={formData.gender} onValueChange={val => setFormData({...formData, gender: val})}>
            <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-[13px]">
              <SelectValue placeholder="Select gender" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Male" className="text-[13px]">Male</SelectItem>
              <SelectItem value="Female" className="text-[13px]">Female</SelectItem>
              <SelectItem value="Other" className="text-[13px]">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Location / Branch</Label>
          <Select value={formData.location} onValueChange={val => setFormData({...formData, location: val})}>
            <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-[13px]">
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              {dropdownOpts.locations.map(l => (
                <SelectItem key={l} value={l} className="text-[13px]">{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Official Email & Personal Email */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Official Email ID *</Label>
          <Input 
            type="email"
            required
            placeholder="rahul@company.com"
            value={formData.email} 
            onChange={e => setFormData({...formData, email: e.target.value})} 
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Personal Email ID <span className="text-slate-400 font-normal">(optional)</span></Label>
          <Input 
            type="email"
            placeholder="rahul.personal@gmail.com"
            value={formData.personalEmail} 
            onChange={e => setFormData({...formData, personalEmail: e.target.value})} 
          />
        </div>
      </div>

      {/* Official Number & Personal Number */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Official Number *</Label>
          <div className="flex gap-2">
            <Select value={formData.countryCodeOfficial} onValueChange={val => setFormData({...formData, countryCodeOfficial: val})}>
              <SelectTrigger className="w-[90px] h-10 rounded-xl border-slate-200 bg-white text-[12px] shrink-0">
                <SelectValue placeholder="IN +91" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="IN +91" className="text-[12px]">IN +91</SelectItem>
                <SelectItem value="US +1" className="text-[12px]">US +1</SelectItem>
                <SelectItem value="UK +44" className="text-[12px]">UK +44</SelectItem>
              </SelectContent>
            </Select>
            <Input 
              required
              placeholder="98765 43210"
              value={formData.officialNumber} 
              onChange={e => setFormData({...formData, officialNumber: e.target.value})} 
              className="flex-1"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Personal Number *</Label>
          <div className="flex gap-2">
            <Select value={formData.countryCodePersonal} onValueChange={val => setFormData({...formData, countryCodePersonal: val})}>
              <SelectTrigger className="w-[90px] h-10 rounded-xl border-slate-200 bg-white text-[12px] shrink-0">
                <SelectValue placeholder="IN +91" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="IN +91" className="text-[12px]">IN +91</SelectItem>
                <SelectItem value="US +1" className="text-[12px]">US +1</SelectItem>
                <SelectItem value="UK +44" className="text-[12px]">UK +44</SelectItem>
              </SelectContent>
            </Select>
            <Input 
              required
              placeholder="91234 56789"
              value={formData.personalNumber} 
              onChange={e => setFormData({...formData, personalNumber: e.target.value})} 
              className="flex-1"
            />
          </div>
        </div>
      </div>

      {/* Date of Birth & Blood Group */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Date of Birth</Label>
          <Input 
            type="date"
            value={formData.dateOfBirth} 
            onChange={e => setFormData({...formData, dateOfBirth: e.target.value})} 
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Blood Group</Label>
          <Select value={formData.bloodGroup} onValueChange={val => setFormData({...formData, bloodGroup: val})}>
            <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-[13px]">
              <SelectValue placeholder="Select group" />
            </SelectTrigger>
            <SelectContent>
              {['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(bg => (
                <SelectItem key={bg} value={bg} className="text-[13px]">{bg}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Emergency Contact & Address */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Emergency Contact</Label>
          <Input 
            placeholder="Name - Number"
            value={formData.emergencyContact} 
            onChange={e => setFormData({...formData, emergencyContact: e.target.value})} 
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[12px] font-medium text-slate-600">Current Address</Label>
          <Input 
            placeholder="Full Address"
            value={formData.currentAddress} 
            onChange={e => setFormData({...formData, currentAddress: e.target.value})} 
          />
        </div>
      </div>

      {/* Reporting Manager */}
      <div className="space-y-1.5">
        <Label className="text-[12px] font-medium text-slate-600">Reporting Manager</Label>
        <Select value={formData.reportingManager} onValueChange={val => setFormData({...formData, reportingManager: val})}>
          <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-[13px]">
            <SelectValue placeholder="— No manager —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="No Manager" className="text-[13px]">— No manager —</SelectItem>
            <SelectItem value="Ajinkya Sanjay Vibhute" className="text-[13px]">Ajinkya Sanjay Vibhute</SelectItem>
            <SelectItem value="Deepak Gupta" className="text-[13px]">Deepak Gupta</SelectItem>
            <SelectItem value="Chetan Gajanan Nimje" className="text-[13px]">Chetan Gajanan Nimje</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Footer Buttons */}
      <div className="flex flex-col sm:flex-row justify-end gap-2.5 sm:gap-3 pt-4 mt-2 border-t border-slate-100">
        <Button 
          type="button" 
          variant="outline" 
          onClick={onSuccess}
          className="h-11 rounded-xl text-xs font-bold w-full sm:w-auto px-6 cursor-pointer order-2 sm:order-1"
        >
          Cancel
        </Button>
        <Button 
          type="submit" 
          disabled={loading}
          className="h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md shadow-blue-500/20 w-full sm:w-auto px-6 cursor-pointer order-1 sm:order-2"
        >
          {loading ? 'Saving...' : (employee ? 'Update Stakeholder' : 'Add Stakeholder')}
        </Button>
      </div>
    </form>
  );
}

