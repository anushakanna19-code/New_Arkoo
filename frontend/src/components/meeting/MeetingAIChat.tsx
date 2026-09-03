// ─── Meeting AI Chat Component ──────────────────────────────
// Extracted from MeetingModule.tsx — zero behavior changes.
// Provides a chat interface to ask questions about a specific meeting.

import { useState, useEffect, useRef } from 'react';
import { BrainCircuit, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getApiUrl } from '@/lib/api';

export function MeetingAIChat({ meeting }: { meeting: any }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleAsk = async () => {
    if (!input.trim() || loading) return;
    
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch(getApiUrl('/api/ask-meeting'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          meetingData: { 
            mom: meeting.mom, 
            summary: meeting.summary, 
            transcript: meeting.transcript 
          }, 
          question: userMsg 
        }),
      });

      if (!res.ok) throw new Error('AI response failed');
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'ai', content: data.answer }]);
    } catch (error) {
      toast.error('AI assistant is busy. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[500px] bg-slate-50 rounded-3xl border border-slate-200 overflow-hidden shadow-inner">
      <div className="p-6 border-b bg-white flex items-center justify-between">
         <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white">
               <BrainCircuit className="w-4 h-4" />
            </div>
            <div>
               <p className="text-xs font-black text-slate-900 uppercase tracking-widest">Meeting AI Assistant</p>
               <p className="text-[10px] text-blue-600 font-bold uppercase tracking-widest">Active & Informed</p>
            </div>
         </div>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
            <MessageSquare className="w-12 h-12 mb-4 text-slate-400" />
            <p className="text-sm font-bold uppercase tracking-widest text-slate-500">Ask anything about this meeting</p>
            <p className="text-[10px] max-w-xs mt-2 font-medium">Examples: "What were the main blockers mentioned?" or "Did we finalize the budget?"</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`
              max-w-[80%] p-4 rounded-2xl text-sm font-medium leading-relaxed
              ${m.role === 'user' ? 'bg-brand-blue text-white rounded-tr-none shadow-lg shadow-blue-100' : 'bg-white text-slate-700 rounded-tl-none border border-slate-200 shadow-sm'}
            `}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
             <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-slate-200 flex gap-1">
                <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" />
             </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-white border-t border-slate-100 flex gap-2">
        <Input 
          placeholder="Ask AI assistant about the discussion..." 
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAsk()}
          className="rounded-xl border-slate-200 h-11 focus:ring-brand-blue shadow-sm"
        />
        <Button onClick={handleAsk} disabled={loading} className="bg-brand-blue text-white rounded-xl h-11 px-6 shadow-lg shadow-blue-100 hover:bg-blue-700">
          Ask AI
        </Button>
      </div>
    </div>
  );
}
