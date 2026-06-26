
import React, { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Sparkles, Loader2 } from 'lucide-react';
import { ChatMessage, DashboardData } from '../types';
import { analyzeDashboard } from '../services/geminiService';

interface AssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  data: DashboardData;
}

export const AssistantPanel: React.FC<AssistantPanelProps> = ({ isOpen, onClose, data }) => {
  const quickPrompts = [
    '分析本月的回款风险',
    '生成下季度招商策略建议',
    '找出需要优先跟进的客户',
  ];
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: '你好！我是上海金蝶软件园的智能招商助手。我已经读取了当前的园区运营数据。你可以问我关于出租率趋势、回款风险或招商策略的问题。',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const responseText = await analyzeDashboard(data, input);

    const aiMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'model',
      text: responseText,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, aiMsg]);
    setIsLoading(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="liquid-drawer-backdrop fixed inset-0 z-50 flex items-end justify-center p-2 sm:p-3 md:items-stretch md:justify-end md:p-0">
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-panel-title"
        className="liquid-drawer-panel flex h-[min(88vh,760px)] max-h-[calc(100vh-1rem)] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[30px] border-t border-white/75 md:h-full md:max-h-none md:w-[440px] md:rounded-none md:border-t-0"
      >
        {/* Header */}
        <div className="liquid-elevated-header flex shrink-0 items-start justify-between gap-3 border-b border-white/60 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="liquid-icon-well flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] text-blue-700 shadow-sm">
              <Bot className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div id="assistant-panel-title" className="truncate text-base font-black text-slate-950">智能招商助手</div>
                <span className="rounded-full border border-sky-200/80 bg-sky-50/80 px-2.5 py-1 text-xs font-black text-blue-700">
                  实时
                </span>
              </div>
              <div className="mt-1 max-w-[260px] text-xs font-semibold leading-5 text-slate-500">
                已读取当前园区运营数据，可分析出租率、回款风险与招商策略。
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭智能招商助手"
            className="liquid-glass-control liquid-pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/75 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Chat Area */}
        <div className="flex-1 space-y-4 overflow-y-auto bg-[radial-gradient(circle_at_20%_0%,rgba(219,234,254,0.34),transparent_34%),radial-gradient(circle_at_80%_18%,rgba(186,230,253,0.22),transparent_30%)] px-4 py-4 sm:px-5">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[88%] rounded-[24px] px-4 py-3 text-sm font-semibold leading-relaxed shadow-sm ${
                  msg.role === 'user'
                    ? 'rounded-br-md bg-blue-600 text-white shadow-blue-900/10'
                    : 'liquid-glass-readable rounded-bl-md text-slate-700'
                }`}
              >
                {msg.text.split('\n').map((line, i) => (
                  <p key={i} className={i > 0 ? 'mt-2' : ''}>{line}</p>
                ))}
                <div className={`mt-2 text-xs font-bold ${
                  msg.role === 'user' ? 'text-blue-50/95' : 'text-slate-500'
                }`}>
                  {msg.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div role="status" className="liquid-glass-readable flex items-center gap-2 rounded-[22px] rounded-bl-md px-4 py-3 text-sm font-semibold text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin text-blue-700" />
                正在分析数据...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="liquid-elevated-footer shrink-0 border-t border-white/60 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-5">
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="询问关于出租率、回款或租户的问题..."
              className="liquid-elevated-field min-h-[58px] max-h-[132px] w-full resize-none rounded-[22px] py-3.5 pl-4 pr-14 text-base font-semibold text-slate-900 outline-none placeholder:text-slate-500 focus-visible:ring-4 focus-visible:ring-blue-500/10 md:text-sm"
              rows={1}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              aria-label="发送问题"
              className="liquid-action-strong liquid-pressable absolute bottom-2 right-2 flex h-11 w-11 items-center justify-center rounded-[18px] text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setInput(prompt)}
                className="liquid-glass-control liquid-pressable flex min-h-10 items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-black text-blue-700 transition hover:bg-white/75 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80 sm:justify-start"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="truncate">{prompt.replace(/^分析|生成|找出/, '')}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
};
