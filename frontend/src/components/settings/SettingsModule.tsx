import { useState, useEffect } from 'react';
import { doc, updateDoc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { db, authenticateGoogleDrive, auth } from '@/lib/firebase';
import { getApiUrl, getAuthHeaders } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Bell, Shield, User, Globe, MessageSquare, Activity, KeyRound, AlertTriangle, CheckCircle2, RefreshCw, Layers, Users, Plus, X, ChevronDown, Cpu, Zap, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';

// ─── Default dropdown values ───────────────────────────────────────────────────
const DEFAULT_STAKEHOLDER_OPTIONS = {
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
};

const SETTINGS_DOC = 'settings/stakeholderOptions';

// ─── Helper: editable chip list for one category ──────────────────────────────
function OptionCategory({
  title,
  color,
  items,
  onAdd,
  onRemove
}: {
  title: string;
  color: string;
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const val = input.trim();
    if (!val) return;
    if (items.map(i => i.toLowerCase()).includes(val.toLowerCase())) {
      toast.error(`"${val}" already exists.`);
      return;
    }
    onAdd(val);
    setInput('');
  };

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{title}</h4>
      <div className="flex flex-wrap gap-2 min-h-[36px]">
        {items.map(item => (
          <span
            key={item}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${color}`}
          >
            {item}
            <button
              type="button"
              onClick={() => onRemove(item)}
              className="hover:opacity-70 transition-opacity ml-0.5"
              title={`Remove "${item}"`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {items.length === 0 && (
          <span className="text-xs text-slate-400 italic">No options yet.</span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder={`Add new ${title.toLowerCase().replace(' options', '')}...`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          className="h-9 rounded-xl border-slate-200 bg-slate-50 text-sm"
        />
        <Button
          type="button"
          size="sm"
          onClick={handleAdd}
          className="h-9 px-4 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs shrink-0 flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}

// ─── Stakeholder Options Editor ────────────────────────────────────────────────
function StakeholderOptionsEditor() {
  const [options, setOptions] = useState(DEFAULT_STAKEHOLDER_OPTIONS);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(true);

  // Subscribe to Firestore; seed defaults on first load
  useEffect(() => {
    const ref = doc(db, 'settings', 'stakeholderOptions');
    const unsub = onSnapshot(ref, async (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setOptions({
          stakeholderTypes: data.stakeholderTypes ?? DEFAULT_STAKEHOLDER_OPTIONS.stakeholderTypes,
          departments:      data.departments      ?? DEFAULT_STAKEHOLDER_OPTIONS.departments,
          designations:     data.designations     ?? DEFAULT_STAKEHOLDER_OPTIONS.designations,
          locations:        data.locations        ?? DEFAULT_STAKEHOLDER_OPTIONS.locations,
        });
      } else {
        // First-time: seed defaults
        await setDoc(ref, DEFAULT_STAKEHOLDER_OPTIONS);
      }
    });
    return unsub;
  }, []);

  const saveField = async (field: keyof typeof DEFAULT_STAKEHOLDER_OPTIONS, newList: string[]) => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'stakeholderOptions'), { [field]: newList }, { merge: true });
      toast.success('Options updated successfully.');
    } catch (e: any) {
      toast.error(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = (field: keyof typeof DEFAULT_STAKEHOLDER_OPTIONS, val: string) => {
    const updated = [...options[field], val];
    setOptions(prev => ({ ...prev, [field]: updated }));
    saveField(field, updated);
  };

  const handleRemove = (field: keyof typeof DEFAULT_STAKEHOLDER_OPTIONS, val: string) => {
    const updated = options[field].filter(i => i !== val);
    setOptions(prev => ({ ...prev, [field]: updated }));
    saveField(field, updated);
  };

  const categories: { key: keyof typeof DEFAULT_STAKEHOLDER_OPTIONS; title: string; color: string }[] = [
    { key: 'stakeholderTypes', title: 'Stakeholder Type Options',  color: 'bg-blue-100 text-blue-700' },
    { key: 'departments',      title: 'Department Options',         color: 'bg-violet-100 text-violet-700' },
    { key: 'designations',     title: 'Designation Options',        color: 'bg-amber-100 text-amber-700' },
    { key: 'locations',        title: 'Location / Branch Options',  color: 'bg-emerald-100 text-emerald-700' },
  ];

  return (
    <Card className="shadow-sm border-slate-200 rounded-2xl overflow-hidden bg-white">
      <CardHeader className="border-b border-slate-100">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg font-bold">Stakeholder Form Options</CardTitle>
              <p className="text-xs text-slate-500 mt-0.5 font-normal">
                Manage the dropdown choices shown in the Add / Edit Stakeholder form.
              </p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </CardHeader>

      {open && (
        <CardContent className="p-6 space-y-8">
          {categories.map(cat => (
            <OptionCategory
              key={cat.key}
              title={cat.title}
              color={cat.color}
              items={options[cat.key]}
              onAdd={val => handleAdd(cat.key, val)}
              onRemove={val => handleRemove(cat.key, val)}
            />
          ))}
          {saving && (
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" /> Saving...
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export interface SettingsModuleProps {
  profile: any;
  gdriveState?: {
    connected: boolean;
    isOauthConfigured?: boolean;
    userEmail?: string;
    folderId?: string;
    lastSynced?: string | null;
  };
  onAuthorizeDrive?: () => void;
  onDisconnectDrive?: () => void;
  onProfileUpdate?: (updates: any) => void;
}

export function SettingsModule({ 
  profile,
  gdriveState = { connected: false },
  onAuthorizeDrive = () => {},
  onDisconnectDrive = () => {},
  onProfileUpdate
}: SettingsModuleProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    displayName: profile?.displayName || '',
    department: profile?.department || 'Management'
  });

  const [selectedAiProvider, setSelectedAiProvider] = useState<'openai' | 'gemini'>('openai');
  const [diagnostic, setDiagnostic] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  const handleSaveAiKey = async () => {
    const isOp = selectedAiProvider === 'openai';
    const key = (isOp ? apiKeyInput : geminiKeyInput).trim();
    if (!key) {
      toast.error(`Please enter a valid ${isOp ? 'OpenAI' : 'Google Gemini'} API Key.`);
      return;
    }
    setSavingKey(true);
    try {
      const endpoint = isOp ? '/api/openai/save-key' : '/api/gemini/save-key';
      const url = getApiUrl(endpoint);
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ apiKey: key })
      });

      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {}

      if (res.ok && data.success) {
        toast.success(`${isOp ? 'OpenAI' : 'Google Gemini'} API Key saved successfully!`);
        if (isOp) setApiKeyInput('');
        else setGeminiKeyInput('');
        performDiagnostic(selectedAiProvider);
      } else {
        throw new Error(data.error || `Failed to save ${isOp ? 'OpenAI' : 'Google Gemini'} API Key`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to save API key');
    } finally {
      setSavingKey(false);
    }
  };

  const performDiagnostic = async (provider: 'openai' | 'gemini' = selectedAiProvider) => {
    setTesting(true);
    try {
      const endpoint = provider === 'openai' ? '/api/openai-diagnostic' : '/api/gemini-diagnostic';
      const url = getApiUrl(endpoint);
      const authHeaders = await getAuthHeaders();
      const response = await fetch(url, { headers: authHeaders });
      
      const text = await response.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (parseErr) {
        throw new Error(`Server returned non-JSON response (status: ${response.status})`);
      }

      setDiagnostic(data);
      if (response.ok && data.success) {
        toast.success(`${provider === 'openai' ? 'OpenAI' : 'Google Gemini'} verification test succeeded!`);
      } else if (data.status) {
        toast.error(`${provider === 'openai' ? 'OpenAI' : 'Google Gemini'} Test Status: ${data.status}`);
      } else {
        toast.error(data.error || `Diagnostic check failed (status ${response.status})`);
      }
    } catch (err: any) {
      toast.error(`Could not complete Diagnostic check: ${err.message || err}`);
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    performDiagnostic('openai');
  }, []);

  const [gdrive, setGdrive] = useState<{
    connected: boolean;
    isOauthConfigured?: boolean;
    userEmail?: string;
    folderId?: string;
    folderLink?: string;
    accessToken?: string | null;
    lastSynced?: string | null;
  }>({ connected: false });
  const [folderLinkInput, setFolderLinkInput] = useState('');
  const [validatingFolder, setValidatingFolder] = useState(false);
  const [gdriveLoading, setGdriveLoading] = useState(true);


  // OpenAI API State
  const [openaiData, setOpenaiData] = useState<any>({ connected: false });
  const [openaiLoading, setOpenaiLoading] = useState(true);
  const [savingOpenai, setSavingOpenai] = useState(false);
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');

  const fetchGDriveStatus = async () => {
    try {
      const url = getApiUrl('/api/gdrive/status');
      const authHeaders = await getAuthHeaders();
      const response = await fetch(url, { headers: authHeaders });
      if (response.ok) {
        const text = await response.text();
        let data: any = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) {}
        setGdrive(data);
        if (data.folderLink) {
          setFolderLinkInput(data.folderLink);
        } else if (data.folderId) {
          setFolderLinkInput(`https://drive.google.com/drive/folders/${data.folderId}`);
        } else {
          setFolderLinkInput('https://drive.google.com/drive/folders/1HVFyfSy0vqUEesI_ttEU3_byXDGhs5sl?usp=drive_link');
        }
      }
    } catch (err) {
      console.error('Failed to load Google Drive status:', err);
    } finally {
      setGdriveLoading(false);
    }
  };

  const fetchOpenaiStatus = async () => {
    try {
      const url = getApiUrl('/api/openai/status');
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, { headers: authHeaders });
      if (res.ok) {
        const text = await res.text();
        let data: any = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) {}
        setOpenaiData(data);
      }
    } catch (err) {
      console.error('Failed to load OpenAI status:', err);
    } finally {
      setOpenaiLoading(false);
    }
  };

  const handleSaveOpenaiIntegrationKey = async () => {
    if (!openaiKeyInput.trim()) {
      toast.error('Please enter a valid AI API Key.');
      return;
    }
    setSavingOpenai(true);
    try {
      const url = getApiUrl('/api/gemini/save-key');
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ apiKey: openaiKeyInput.trim() })
      });
      const text = await res.text();
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch (e) {}
      if (res.ok) {
        toast.success(data.message || 'AI API Key saved successfully.');
        setOpenaiKeyInput('');
        fetchOpenaiStatus();
      } else {
        toast.error(data.error || 'Failed to save AI API Key.');
      }
    } catch (err: any) {
      toast.error(`Error saving AI config: ${err.message}`);
    } finally {
      setSavingOpenai(false);
    }
  };

  useEffect(() => {
    fetchGDriveStatus();
    fetchOpenaiStatus();

    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GDRIVE_AUTH_SUCCESS') {
        toast.success("Google Drive successfully authorized!");
        fetchGDriveStatus();
      }
    };
    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
  }, []);

  const handleConnectDrive = async () => {
    try {
      const authResult = await authenticateGoogleDrive();
      if (!authResult) return;

      const url = getApiUrl('/api/gdrive/save-token');
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          accessToken: authResult.accessToken,
          userEmail: authResult.email
        })
      });

      if (res.ok) {
        toast.success("Google Drive successfully authorized!");
        fetchGDriveStatus();
      } else {
        const text = await res.text();
        let err: any = {};
        try { err = text ? JSON.parse(text) : {}; } catch (e) {}
        throw new Error(err.error || "Failed to save Google Drive token.");
      }
    } catch (err: any) {
      toast.error(`Authentication failed: ${err.message}`);
    }
  };

  const handleDisconnectDrive = async () => {
    if (!window.confirm("Are you sure you want to disconnect Google Drive? Recordings will no longer be backed up automatically.")) {
      return;
    }
    try {
      const url = getApiUrl('/api/gdrive/disconnect');
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, { method: 'POST', headers: authHeaders });
      if (res.ok) {
        toast.success("Google Drive disconnected successfully.");
        fetchGDriveStatus();
      } else {
        toast.error("Failed to disconnect Google Drive.");
      }
    } catch (err: any) {
      toast.error(`Disconnect failed: ${err.message}`);
    }
  };

  const handleSaveAndValidateFolder = async () => {
    if (!folderLinkInput.trim()) {
      toast.error("Please provide a valid Google Drive Folder Link.");
      return;
    }
    setValidatingFolder(true);
    try {
      const url = getApiUrl('/api/gdrive/save-folder');
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          folderLink: folderLinkInput.trim(),
          googleAccessToken: gdrive.accessToken || null
        })
      });

      if (!res.ok) {
        const text = await res.text();
        let err: any = {};
        try { err = text ? JSON.parse(text) : {}; } catch (e) {}
        throw new Error(err.error || "Folder validation failed.");
      }

      toast.success("Google Drive Folder Link validated and saved successfully!");
      fetchGDriveStatus();
    } catch (err: any) {
      toast.error(`Folder Link Validation Failed: ${err.message || err}`);
    } finally {
      setValidatingFolder(false);
    }
  };

  const handleSave = async () => {
    if (!profile?.uid) return;
    setLoading(true);
    try {
      if (profile.employeeId) {
        await updateDoc(doc(db, 'employees', profile.employeeId), {
          fullName: formData.displayName,
          department: formData.department,
          updatedAt: new Date()
        });
      } else {
        await setDoc(doc(db, 'users', profile.uid), {
          displayName: formData.displayName,
          department: formData.department,
          updatedAt: new Date()
        }, { merge: true });
      }

      if (auth.currentUser && auth.currentUser.displayName !== formData.displayName) {
        await updateProfile(auth.currentUser, { displayName: formData.displayName }).catch(() => {});
      }

      if (onProfileUpdate) {
        onProfileUpdate({
          displayName: formData.displayName,
          department: formData.department
        });
      }

      toast.success('Profile updated successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, profile.employeeId ? `employees/${profile.employeeId}` : `users/${profile.uid}`);
      toast.error('Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">System Settings</h1>
        <p className="text-slate-500">Manage your profile, account security, and notification preferences.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="space-y-2">
           <Button variant="ghost" className="w-full justify-start gap-3 bg-blue-50 text-blue-700 font-bold h-12 rounded-xl">
              <User className="w-5 h-5 text-blue-600" /> Profile Info
           </Button>
           <Button variant="ghost" className="w-full justify-start gap-3 hover:bg-slate-100 text-slate-600 font-bold h-12 rounded-xl">
              <Bell className="w-5 h-5" /> Notifications
           </Button>
           <Button variant="ghost" className="w-full justify-start gap-3 hover:bg-slate-100 text-slate-600 font-bold h-12 rounded-xl">
              <Shield className="w-5 h-5" /> Security
           </Button>
           <Button variant="ghost" className="w-full justify-start gap-3 hover:bg-slate-100 text-slate-600 font-bold h-12 rounded-xl">
              <MessageSquare className="w-5 h-5" /> AI Preferences
           </Button>
        </div>

        <div className="md:col-span-2 space-y-6">
          <Card className="shadow-sm border-slate-200 rounded-2xl overflow-hidden">
            <CardHeader className="border-b border-slate-50">
              <CardTitle className="text-lg font-bold">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label>Full Name</Label>
                    <Input 
                      value={formData.displayName} 
                      onChange={e => setFormData({...formData, displayName: e.target.value})}
                      className="rounded-xl" 
                    />
                 </div>
                 <div className="space-y-2">
                    <Label>Email</Label>
                    <Input defaultValue={profile?.email} disabled className="rounded-xl bg-slate-50" />
                 </div>
                 <div className="space-y-2">
                    <Label>Role</Label>
                    <Input defaultValue={profile?.role} disabled className="rounded-xl bg-slate-50 capitalize" />
                 </div>
                 <div className="space-y-2">
                    <Label>Department</Label>
                    <Input 
                      value={formData.department} 
                      onChange={e => setFormData({...formData, department: e.target.value})}
                      className="rounded-xl" 
                    />
                 </div>
              </div>
              <Button 
                onClick={handleSave} 
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 rounded-xl shadow-md shadow-blue-500/20"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </Button>
            </CardContent>
          </Card>


          <Card className="shadow-sm border-slate-200 rounded-2xl overflow-hidden">
            <CardHeader className="border-b border-slate-50">
              <CardTitle className="text-lg font-bold">Preferences</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Task Notifications</Label>
                    <p className="text-sm text-slate-500">Receive alerts when tasks are assigned to you.</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between pointer-events-none opacity-50">
                  <div className="space-y-0.5">
                    <Label>Email Digest</Label>
                    <p className="text-sm text-slate-500">Weekly summary of meeting insights and task progress.</p>
                  </div>
                  <Switch />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>AI Auto-Allocation</Label>
                    <p className="text-sm text-slate-500">Let AI automatically assign tasks based on meeting context.</p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-md border-slate-200 rounded-2xl overflow-hidden bg-slate-50/50">
            <CardHeader className="border-b border-slate-100 bg-white">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
                    <Activity className="w-5 h-5 text-blue-600 animate-pulse" />
                    AI Engine Diagnostics & API Key
                  </CardTitle>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configure and test your OpenAI (Whisper & GPT-4o) or Google Gemini credentials.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Provider Selector Tabs */}
                  <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAiProvider('openai');
                        performDiagnostic('openai');
                      }}
                      className={`px-3 py-1.5 rounded-lg transition-all ${
                        selectedAiProvider === 'openai'
                          ? 'bg-white text-blue-600 shadow-xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      OpenAI (Whisper & ChatGPT)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAiProvider('gemini');
                        performDiagnostic('gemini');
                      }}
                      className={`px-3 py-1.5 rounded-lg transition-all ${
                        selectedAiProvider === 'gemini'
                          ? 'bg-white text-blue-600 shadow-xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Google Gemini
                    </button>
                  </div>

                  <Button 
                    onClick={() => performDiagnostic(selectedAiProvider)} 
                    disabled={testing}
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 px-4 h-9 shrink-0 shadow-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testing ? "animate-spin" : ""}`} />
                    {testing ? "Testing..." : "Verify Now"}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-6 bg-white">
              {selectedAiProvider === 'openai' ? (
                /* OpenAI API Key Input */
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-slate-700 block">
                      OpenAI API Key (for Whisper Audio Transcription & GPT-4o MOM Analysis)
                    </Label>
                    <span className="text-[10px] font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                      Active AI Provider
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="sk-... (Paste your OpenAI API Key here)"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      className="text-xs font-mono border-slate-200 bg-white rounded-xl flex-1"
                    />
                    <Button
                      size="sm"
                      disabled={savingKey}
                      onClick={handleSaveAiKey}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl px-5 shrink-0 shadow-sm"
                    >
                      {savingKey ? "Saving..." : "Save Key"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Get your secret key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-blue-600 underline font-semibold">OpenAI Platform (platform.openai.com/api-keys)</a> to power high-fidelity Whisper transcription and GPT-4o task extraction.
                  </p>
                </div>
              ) : (
                /* Gemini API Key Input */
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-slate-700 block">
                      Google Gemini API Key
                    </Label>
                    <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      Alternative Engine
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="AIzaSy... (Paste your Google Gemini API Key here)"
                      value={geminiKeyInput}
                      onChange={(e) => setGeminiKeyInput(e.target.value)}
                      className="text-xs font-mono border-slate-200 bg-white rounded-xl flex-1"
                    />
                    <Button
                      size="sm"
                      disabled={savingKey}
                      onClick={handleSaveAiKey}
                      className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl px-5 shrink-0"
                    >
                      {savingKey ? "Saving..." : "Save Key"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Get your free Gemini API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-600 underline font-semibold">Google AI Studio</a>.
                  </p>
                </div>
              )}

              {/* Connection Status Banner */}
              {testing ? (
                <div className="flex items-center justify-center p-6 bg-slate-50 rounded-xl border border-slate-100 animate-pulse">
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
                    <p className="text-xs font-semibold text-slate-600 font-sans">
                      Testing {selectedAiProvider === 'openai' ? 'OpenAI' : 'Google Gemini'} API endpoint status...
                    </p>
                  </div>
                </div>
              ) : diagnostic ? (
                <div className="space-y-5">
                  <div className={`p-4 rounded-xl border flex gap-3 items-start ${
                    diagnostic.success 
                      ? "bg-emerald-50/70 border-emerald-100 text-emerald-800" 
                      : diagnostic.status === "RESOURCE_EXHAUSTED"
                      ? "bg-amber-50 border-amber-100 text-amber-800"
                      : "bg-rose-50 border-rose-100 text-rose-800"
                  }`}>
                    <div className="mt-0.5 shrink-0">
                      {diagnostic.success ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <AlertTriangle className={`w-5 h-5 ${diagnostic.status === "RESOURCE_EXHAUSTED" ? "text-amber-600" : "text-rose-600"}`} />
                      )}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold font-sans tracking-tight">
                        {diagnostic.success 
                          ? "API is Succeeding & Functional" 
                          : diagnostic.status === "RESOURCE_EXHAUSTED"
                          ? "RESOURCE_EXHAUSTED (Quota Rate Limits Triggered)"
                          : "Verification Failed"}
                      </h4>
                      <p className="text-xs mt-1 opacity-90 leading-relaxed font-sans">
                        {diagnostic.success 
                          ? "Real-time verify ping call returned generated content successfully! Transcription and MOM services can communicate safely with the neural engine." 
                          : diagnostic.explanation}
                      </p>
                    </div>
                  </div>

                  {/* Metadata fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                      <Label className="text-[10px] text-slate-400 font-mono uppercase bg-slate-200/50 px-1.5 py-0.5 rounded shrink-0 w-max flex items-center gap-1">
                        <KeyRound className="w-3 h-3" /> API Key Source
                      </Label>
                      <p className="text-xs font-bold text-slate-800 leading-tight">
                        {diagnostic.keySource}
                      </p>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                      <Label className="text-[10px] text-slate-400 font-mono uppercase bg-slate-200/50 px-1.5 py-0.5 rounded shrink-0 w-max flex items-center gap-1">
                        <Layers className="w-3 h-3" /> Assigned Project ID
                      </Label>
                      <p className="text-xs font-bold text-slate-800 leading-tight">
                        {diagnostic.projectId}
                      </p>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                      <Label className="text-[10px] text-slate-400 font-mono uppercase bg-slate-200/50 px-1.5 py-0.5 rounded shrink-0 w-max flex items-center gap-1">
                        <Globe className="w-3 h-3" /> Test Model Name
                      </Label>
                      <p className="text-xs font-bold text-slate-800 font-mono leading-tight">
                        {diagnostic.modelUsed}
                      </p>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                      <Label className="text-[10px] text-slate-400 font-mono uppercase bg-slate-200/50 px-1.5 py-0.5 rounded shrink-0 w-max flex items-center gap-1">
                        <Shield className="w-3 h-3" /> Masked Credentials
                      </Label>
                      <p className="text-xs font-mono font-bold text-slate-800 leading-tight">
                        {diagnostic.maskedKey}
                      </p>
                    </div>
                  </div>

                  {/* Raw details if failure */}
                  {!diagnostic.success && diagnostic.error && (
                    <div className="mt-2 p-3 bg-slate-900 text-slate-300 rounded-xl text-[11px] font-mono whitespace-pre-wrap leading-relaxed border border-slate-800 max-h-36 overflow-y-auto">
                      <span className="text-rose-400 font-bold">Raw Error Trace:</span>{"\n"}{diagnostic.error}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-6 text-center bg-slate-50 rounded-xl border border-slate-100 whitespace-pre">
                  <p className="text-xs text-slate-500 font-medium">Click "Verify Now" to run structural telemetry tests.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {profile?.role === 'admin' && (
            <Card className="shadow-sm border-slate-200 rounded-2xl overflow-hidden bg-white">
              <CardHeader className="border-b border-slate-50">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Globe className="w-5 h-5 text-blue-600" />
                  Google Drive Cloud Integrations
                </CardTitle>
                <CardDescription>
                  Configure and monitor the company's secure cloud storage and automatic backups used to store voice files and MOM executive reports.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {/* Connection Status panel */}
                <div className="p-5 rounded-2xl border border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-xl mt-0.5 ${gdrive.connected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                      <Layers className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">
                        Google Drive Authorization: {gdrive.connected ? 'Connected' : 'Not Connected'}
                      </h4>
                      {gdrive.connected ? (
                        <p className="text-xs text-slate-500 mt-1">
                          Connected as <span className="font-semibold text-slate-700">{gdrive.userEmail}</span>. All tools and meetings have instant sync access.
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500 mt-1">
                          Enable central company backups by connecting your workspace Google Drive account.
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    {gdrive.connected ? (
                      <Button 
                        id="btn-disconnect-gdrive"
                        variant="outline" 
                        className="text-xs font-bold border-rose-200 text-rose-600 hover:bg-rose-50"
                        onClick={handleDisconnectDrive}
                      >
                        Disconnect Integration
                      </Button>
                    ) : (
                      <Button 
                        id="btn-connect-gdrive"
                        className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold px-5 h-10 shadow-sm shadow-blue-500/20"
                        onClick={handleConnectDrive}
                      >
                        Connect Google Drive
                      </Button>
                    )}
                  </div>
                </div>

                {/* Folder link panel */}
                <div className="space-y-3">
                  <Label htmlFor="gdrive-folder-link" className="text-xs font-bold text-slate-700 block">
                    Google Drive Folder Link for Recording Storage
                  </Label>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Paste the shared Google Drive folder link where records must be kept. Future recordings will upload immediately into this directory.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      id="gdrive-folder-link"
                      type="text"
                      className="text-xs border-slate-200 rounded-xl max-w-2xl text-slate-700 placeholder-slate-400 font-mono"
                      placeholder="https://drive.google.com/drive/folders/..."
                      value={folderLinkInput}
                      onChange={(e) => setFolderLinkInput(e.target.value)}
                    />
                    <Button
                      id="btn-save-gdrive-folder"
                      className="bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs shrink-0 rounded-xl"
                      disabled={validatingFolder}
                      onClick={handleSaveAndValidateFolder}
                    >
                      {validatingFolder ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          Validating...
                        </>
                      ) : (
                        "Save & Validate"
                      )}
                    </Button>
                  </div>
                  {gdrive.folderId && (
                    <div className="text-[11px] text-slate-500 flex items-center gap-1 font-mono">
                      <span>Extracted Active Folder ID:</span>
                      <span className="font-bold text-slate-850">{gdrive.folderId}</span>
                    </div>
                  )}
                </div>

                {/* Subfolder hierarchy illustration */}
                <div className="rounded-xl border border-dashed border-slate-200 p-4 bg-slate-50/30">
                  <span className="text-xs font-bold text-slate-700 block mb-2">Automated Directory Structure:</span>
                  <div className="font-mono text-[10px] text-slate-500 space-y-1">
                    <div className="flex items-center gap-1 text-slate-700">
                      <span>📂 [Configured Root Folder] /</span>
                    </div>
                    <div className="pl-4 flex items-center gap-1 text-slate-700">
                      <span>📂 Meeting Recordings /</span>
                    </div>
                    <div className="pl-8 text-slate-500">📂 YYYY /</div>
                    <div className="pl-12 text-slate-500">📂 MM /</div>
                    <div className="pl-16 text-slate-500">📂 DD /</div>
                    <div className="pl-20 text-indigo-600 font-semibold">🎵 recording_[meeting_id].mp3</div>
                    <div className="pl-20 text-emerald-600 font-semibold">📄 report_[meeting_id].pdf</div>
                  </div>
                </div>

                {/* Diagnostics and Sync Information */}
                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-bold text-emerald-800">Operational Backups Enabled</h4>
                    <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
                      All meetings automatically back up transcripts, audios, and PDF summary sheets synchronously. Last synced: {gdrive.lastSynced ? new Date(gdrive.lastSynced).toLocaleString() : 'Never'}.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Stakeholder Form Options */}
          <StakeholderOptionsEditor />

        </div>
      </div>
    </div>
  );
}


