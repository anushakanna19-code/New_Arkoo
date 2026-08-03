import { useState } from 'react';
import { 
  Shield, 
  ShieldCheck, 
  Plus, 
  Edit3, 
  Users, 
  Lock, 
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger, 
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export interface PermissionItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface RoleData {
  id: string;
  name: string;
  isSystem: boolean;
  icon: any;
  permissions: PermissionItem[];
}

const DEFAULT_PERMISSIONS: PermissionItem[] = [
  { id: 'dashboard', name: 'Dashboard', description: 'Access the admin analytics dashboard', enabled: true },
  { id: 'meetings', name: 'Meetings', description: 'View and manage meetings', enabled: true },
  { id: 'record-meeting', name: 'Record Meeting', description: 'Record and upload new meetings', enabled: true },
  { id: 'tasks', name: 'Tasks', description: 'View and manage tasks', enabled: true },
  { id: 'employees', name: 'Employees', description: 'Access employee directory and profiles', enabled: true },
  { id: 'settings', name: 'Settings', description: 'Access account and app settings', enabled: true },
  { id: 'recycle-bin', name: 'Recycle Bin', description: 'Access soft-deleted items', enabled: true },
  { id: 'role-management', name: 'Role Management', description: 'Create and manage roles and permissions', enabled: true },
];

export function RoleManagementModule({ profile }: { profile: any }) {
  const [roles, setRoles] = useState<RoleData[]>([
    {
      id: 'admin',
      name: 'Admin',
      isSystem: true,
      icon: ShieldCheck,
      permissions: DEFAULT_PERMISSIONS.map(p => ({ ...p, enabled: true }))
    },
    {
      id: 'employee',
      name: 'Employee',
      isSystem: true,
      icon: Users,
      permissions: DEFAULT_PERMISSIONS.map(p => ({
        ...p,
        enabled: ['meetings', 'record-meeting', 'tasks'].includes(p.id)
      }))
    },
    {
      id: 'project-manager',
      name: 'Project Manager',
      isSystem: false,
      icon: Shield,
      permissions: DEFAULT_PERMISSIONS.map(p => ({
        ...p,
        enabled: ['dashboard', 'meetings', 'record-meeting', 'tasks', 'employees'].includes(p.id)
      }))
    }
  ]);

  const [openNewRole, setOpenNewRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  
  // States for Editing Role
  const [editingRole, setEditingRole] = useState<RoleData | null>(null);
  const [editRoleName, setEditRoleName] = useState('');

  // States for Double Verification Deletion
  const [deleteStage1Role, setDeleteStage1Role] = useState<RoleData | null>(null);
  const [deleteStage2Role, setDeleteStage2Role] = useState<RoleData | null>(null);
  const [confirmDeleteText, setConfirmDeleteText] = useState('');

  const togglePermission = (roleId: string, permId: string) => {
    setRoles(prev => prev.map(role => {
      if (role.id === roleId) {
        return {
          ...role,
          permissions: role.permissions.map(perm => {
            if (perm.id === permId) {
              return { ...perm, enabled: !perm.enabled };
            }
            return perm;
          })
        };
      }
      return role;
    }));
    toast.success('Permission updated');
  };

  const handleCreateRole = () => {
    if (!newRoleName.trim()) {
      toast.error('Please enter a role name');
      return;
    }

    const newRole: RoleData = {
      id: newRoleName.toLowerCase().replace(/\s+/g, '-'),
      name: newRoleName.trim(),
      isSystem: false,
      icon: Shield,
      permissions: DEFAULT_PERMISSIONS.map(p => ({ ...p, enabled: false }))
    };

    setRoles(prev => [...prev, newRole]);
    setNewRoleName('');
    setOpenNewRole(false);
    toast.success(`Role "${newRole.name}" created successfully`);
  };

  const handleUpdateRoleName = () => {
    if (!editingRole) return;
    if (!editRoleName.trim()) {
      toast.error('Role name cannot be empty');
      return;
    }

    setRoles(prev => prev.map(r => r.id === editingRole.id ? { ...r, name: editRoleName.trim() } : r));
    setEditingRole(null);
    toast.success('Role name updated successfully');
  };

  // Step 1: Initial Delete Trigger
  const startDeleteVerification = (role: RoleData) => {
    setDeleteStage1Role(role);
  };

  // Step 2: Proceed from Initial Confirmation to Double Verification Code Entry
  const proceedToStage2Delete = () => {
    if (!deleteStage1Role) return;
    const roleToDel = deleteStage1Role;
    setDeleteStage1Role(null);
    setDeleteStage2Role(roleToDel);
    setConfirmDeleteText('');
  };

  // Step 3: Final Verification Execution
  const executeFinalDelete = () => {
    if (!deleteStage2Role) return;
    if (confirmDeleteText.trim() !== deleteStage2Role.name) {
      toast.error(`Confirmation text must exactly match "${deleteStage2Role.name}"`);
      return;
    }

    setRoles(prev => prev.filter(r => r.id !== deleteStage2Role.id));
    toast.success(`Role "${deleteStage2Role.name}" has been permanently deleted`);
    setDeleteStage2Role(null);
    setConfirmDeleteText('');
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-brand-orange" />
            Role Management
          </h2>
          <p className="text-slate-500 text-sm">
            Define roles and control what each role can access in Arkoo.
          </p>
        </div>

        <Dialog open={openNewRole} onOpenChange={setOpenNewRole}>
          <DialogTrigger>
            <Button className="bg-brand-orange hover:bg-orange-600 text-white font-bold h-11 rounded-xl text-sm px-6 shadow-md shadow-orange-500/20 cursor-pointer">
              <Plus className="w-4 h-4 mr-2" /> + New Role
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md rounded-2xl p-6 bg-white">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold text-slate-900">Create New Role</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Role Name *</Label>
                <Input 
                  placeholder="e.g. Project Engineer, Operation Incharge, HR Executive"
                  value={newRoleName}
                  onChange={e => setNewRoleName(e.target.value)}
                  className="h-11 rounded-xl border-slate-200"
                />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={() => setOpenNewRole(false)} className="rounded-xl">Cancel</Button>
              <Button onClick={handleCreateRole} className="bg-brand-orange hover:bg-orange-600 text-white font-bold rounded-xl px-6">
                Create Role
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Role Cards List */}
      <div className="space-y-6">
        {roles.map((role) => {
          const enabledCount = role.permissions.filter(p => p.enabled).length;
          const RoleIcon = role.icon;

          return (
            <Card key={role.id} className="border border-slate-200/80 shadow-sm rounded-2xl bg-white overflow-hidden">
              <CardContent className="p-6 space-y-6">
                {/* Role Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-100/80 text-brand-orange flex items-center justify-center">
                      <RoleIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-900">{role.name}</h3>
                        {role.isSystem && (
                          <Badge className="bg-slate-100 text-slate-500 hover:bg-slate-100 text-[10px] font-semibold px-2 py-0.5 rounded-full border-none flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" /> System
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 font-medium">
                        {enabledCount} of {role.permissions.length} permissions enabled
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        setEditingRole(role);
                        setEditRoleName(role.name);
                      }}
                      className="h-9 px-4 text-xs font-semibold text-slate-600 border-slate-200 rounded-lg hover:bg-slate-50"
                    >
                      <Edit3 className="w-3.5 h-3.5 mr-1.5 text-slate-400" /> Edit
                    </Button>

                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => startDeleteVerification(role)}
                      className="h-9 px-3 text-xs font-semibold text-red-600 border-red-200 hover:bg-red-50 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                    </Button>
                  </div>
                </div>

                {/* Permissions Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {role.permissions.map((perm) => (
                    <div 
                      key={perm.id} 
                      className={`
                        p-4 rounded-xl border transition-all flex items-center justify-between gap-4
                        ${perm.enabled ? 'bg-orange-50/40 border-orange-200/60' : 'bg-slate-50/40 border-slate-200/60'}
                      `}
                    >
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <div className={`text-sm font-bold ${perm.enabled ? 'text-slate-800' : 'text-slate-400'}`}>
                          {perm.name}
                        </div>
                        <div className={`text-xs truncate ${perm.enabled ? 'text-slate-500' : 'text-slate-400'}`}>
                          {perm.description}
                        </div>
                      </div>

                      <Switch 
                        checked={perm.enabled}
                        onCheckedChange={() => togglePermission(role.id, perm.id)}
                        className="data-[state=checked]:bg-brand-orange"
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Edit Role Dialog */}
      {editingRole && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setEditingRole(null); }}>
          <DialogContent className="max-w-md rounded-2xl p-6 bg-white">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold text-slate-900">Edit Role Title</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Role Name</Label>
                <Input 
                  value={editRoleName}
                  onChange={e => setEditRoleName(e.target.value)}
                  className="h-11 rounded-xl border-slate-200"
                />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={() => setEditingRole(null)} className="rounded-xl">Cancel</Button>
              <Button onClick={handleUpdateRoleName} className="bg-brand-orange hover:bg-orange-600 text-white font-bold rounded-xl px-6">
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* DOUBLE VERIFICATION DIALOG - STEP 1: Initial Warning */}
      {deleteStage1Role && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setDeleteStage1Role(null); }}>
          <DialogContent className="max-w-md rounded-2xl p-6 bg-white">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-red-600 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                Step 1 of 2: Delete Role Warning
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-600 pt-2">
                Are you sure you want to delete the <span className="font-bold text-slate-900">"{deleteStage1Role.name}"</span> role? Employees assigned to this role will lose access to restricted features.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-6 flex gap-2">
              <Button variant="outline" onClick={() => setDeleteStage1Role(null)} className="flex-1 rounded-xl">Cancel</Button>
              <Button onClick={proceedToStage2Delete} variant="destructive" className="flex-1 rounded-xl font-bold">
                Proceed to Verification →
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* DOUBLE VERIFICATION DIALOG - STEP 2: Text Confirmation */}
      {deleteStage2Role && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setDeleteStage2Role(null); }}>
          <DialogContent className="max-w-md rounded-2xl p-6 bg-white">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-red-600 flex items-center gap-2">
                <Shield className="w-5 h-5 text-red-500" />
                Step 2 of 2: Double Verification
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-600 pt-2">
                To confirm permanent deletion, please type the role name <span className="font-mono font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">{deleteStage2Role.name}</span> below:
              </DialogDescription>
            </DialogHeader>

            <div className="pt-2">
              <Input 
                placeholder={`Type "${deleteStage2Role.name}" to confirm`}
                value={confirmDeleteText}
                onChange={e => setConfirmDeleteText(e.target.value)}
                className="h-11 rounded-xl border-red-200 focus:border-red-500 focus:ring-red-500 text-sm font-medium"
              />
            </div>

            <DialogFooter className="mt-6 flex gap-2">
              <Button variant="outline" onClick={() => setDeleteStage2Role(null)} className="flex-1 rounded-xl">Cancel</Button>
              <Button 
                onClick={executeFinalDelete} 
                disabled={confirmDeleteText.trim() !== deleteStage2Role.name}
                variant="destructive" 
                className="flex-1 rounded-xl font-bold disabled:opacity-40"
              >
                Permanently Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

