import React, { useState, useEffect, useRef } from 'react';
import {
  Bot, Send, Trash2, Sparkles, RefreshCw,
  ShieldAlert, ShieldCheck, TrendingUp, AlertCircle, HelpCircle
} from 'lucide-react';
import { api } from '../api';
import { ChatMessage } from '../types';

export const AIChatView: React.FC = () => {
  const [sessionId, setSessionId] = useState<string>(() => {
    return localStorage.getItem('ipopro_chat_session') || `session_${Date.now()}`;
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMeta, setContextMeta] = useState<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    localStorage.setItem('ipopro_chat_session', sessionId);
    loadHistory();
    loadContext();
  }, [sessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const loadHistory = async () => {
    try {
      const res = await api.getChatHistory(sessionId);
      if (res && res.messages) {
        setMessages(res.messages);
      }
    } catch (e: any) {
      console.warn('Could not load chat history:', e);
    }
  };

  const loadContext = async () => {
    try {
      const ctx = await api.getChatContext();
      setContextMeta(ctx);
    } catch (e: any) {
      console.warn('Could not load context:', e);
    }
  };

  const handleSend = async (messageText?: string) => {
    const text = (messageText || inputValue).trim();
    if (!text || isLoading) return;

    setError(null);
    setInputValue('');
    setIsLoading(true);

    // Optimistic user message
    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      session_id: sessionId,
      sender: 'USER',
      content: text,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const resp = await api.sendChatMessage(text, sessionId);
      setMessages(prev => [...prev, resp]);
    } catch (err: any) {
      setError(err.message || 'Failed to communicate with portfolio assistant.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = async () => {
    if (!confirm('Clear this chat conversation?')) return;
    try {
      await api.clearChatHistory(sessionId);
      setMessages([]);
      const newId = `session_${Date.now()}`;
      setSessionId(newId);
    } catch (err: any) {
      setError(err.message || 'Failed to clear chat.');
    }
  };

  const suggestedPrompts = [
    'Summarize my consolidated portfolio valuation & P&L',
    'Diagnose Angel One AB1050 connection error',
    'Explain FIFO cost basis and unrealized return calculation',
    'What IPOs are currently tracked in the system?',
    'Review my recent paper trading orders'
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] max-w-5xl mx-auto space-y-4">
      {/* Header Banner */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center text-white shadow-md shadow-brand-600/20">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">IPOPro Portfolio & Financial Assistant</h2>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Authorized Context
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Grounded in verified Angel One Demat holdings, IPO registers, and risk telemetry.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadContext}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs transition-colors"
            title="Refresh Context"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleClearHistory}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-slate-600 text-xs font-medium transition-colors flex items-center gap-1.5"
            title="Clear Conversation"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear History</span>
          </button>
        </div>
      </div>

      {/* Main Conversation Stream */}
      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-y-auto space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center max-w-lg mx-auto space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">How can I assist your portfolio today?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Ask about current asset allocation, Angel One connection diagnostics, IPO allotment verification, or paper trading mechanics.
              </p>
            </div>

            {/* Quick Prompt Suggestions */}
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              {suggestedPrompts.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(p)}
                  className="px-3 py-1.5 bg-slate-50 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 text-slate-700 rounded-lg text-xs font-medium border border-slate-200 transition-all text-left"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => {
            const isUser = m.sender === 'USER';
            return (
              <div
                key={m.id || idx}
                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div className={`max-w-2xl rounded-xl p-3.5 text-xs space-y-1.5 ${
                  isUser
                    ? 'bg-brand-600 text-white rounded-br-none shadow-sm'
                    : 'bg-slate-50 text-slate-800 border border-slate-200 rounded-bl-none'
                }`}>
                  <div className="whitespace-pre-wrap leading-relaxed font-sans">{m.content}</div>
                  <div className={`text-[10px] flex items-center justify-between pt-1 ${
                    isUser ? 'text-brand-200' : 'text-slate-400 border-t border-slate-200/60 mt-1'
                  }`}>
                    <span>{new Date(m.created_at).toLocaleTimeString('en-IN', { hour12: false })}</span>
                    {!isUser && m.context_meta?.total_valuation !== undefined && (
                      <span className="font-mono">Valuation: ₹{Number(m.context_meta.total_valuation).toLocaleString('en-IN')}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {isLoading && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white flex-shrink-0 mt-0.5">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-500 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand-600 animate-ping" />
              <span>Analyzing portfolio records & synthesizing response...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={isLoading}
          placeholder="Ask a question about your portfolio, Angel One connection health, or IPO tracking..."
          className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 outline-none focus:ring-1 focus:ring-brand-500 font-sans"
        />
        <button
          onClick={() => handleSend()}
          disabled={isLoading || !inputValue.trim()}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send</span>
        </button>
      </div>
    </div>
  );
};
