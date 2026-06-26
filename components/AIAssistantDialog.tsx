import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Loader2, FileText, Calendar, TrendingUp, Sparkles, Download, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { DashboardData } from '../types';
import { getAiProxyBaseForMessage, getAiProxyChatUrl } from '../config/urls';
import { formatArea, formatCurrency, formatPercent } from '../services/numberFormat';

/** 对 AI 返回的 HTML 做基础 XSS 清洗：移除 script 标签、事件处理器、javascript: 链接 */
const sanitizeHtml = (html: string): string => {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/\bon\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\bon\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\bon\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/data\s*:\s*text\/html/gi, 'blocked:')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '');
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
  isHTML?: boolean;
  id?: string; // 用于导出时定位
}

interface AIAssistantDialogProps {
  isOpen: boolean;
  onClose: () => void;
  dashboardData: DashboardData;
  aiConfig: any;
}

type AiPromptTone = 'blue' | 'amber' | 'rose' | 'slate';

type AiPromptState = {
  title: string;
  message?: string;
  tone?: AiPromptTone;
  confirmText?: string;
  resolve?: () => void;
};

const aiPromptToneClass = (tone: AiPromptTone = 'blue'): string => {
  switch (tone) {
    case 'amber':
      return 'border-amber-200/80 bg-amber-50/82 text-amber-900';
    case 'rose':
      return 'border-rose-200/80 bg-rose-50/82 text-rose-800';
    case 'slate':
      return 'border-slate-200/80 bg-white/82 text-slate-700';
    default:
      return 'border-blue-200/80 bg-blue-50/78 text-blue-800';
  }
};

const AiPromptOverlay: React.FC<{
  prompt: AiPromptState;
  onClose: () => void;
}> = ({ prompt, onClose }) => {
  const toneClass = aiPromptToneClass(prompt.tone || 'blue');
  return (
    <div className="liquid-elevated-backdrop fixed inset-0 z-[70] flex items-end justify-center p-0 md:items-center md:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={prompt.title}
        className="liquid-elevated-panel flex max-h-[82vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] md:rounded-[28px]"
      >
        <div className="liquid-elevated-header flex items-start justify-between gap-3 border-b border-white/60 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`liquid-glass-readable inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${toneClass}`}>
              <AlertCircle size={19} />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-black text-slate-950">{prompt.title}</h3>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">AI 助手提示</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:bg-white/75 hover:text-slate-950"
            aria-label="关闭提示"
          >
            <X size={18} />
          </button>
        </div>
        {prompt.message ? (
          <div className="px-5 py-4">
            <div className={`liquid-glass-readable max-h-[46vh] overflow-auto whitespace-pre-line rounded-2xl border px-4 py-3 text-sm font-semibold leading-relaxed ${toneClass}`}>
              {prompt.message}
            </div>
          </div>
        ) : null}
        <div className="liquid-elevated-footer flex justify-end border-t border-white/60 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:pb-4">
          <button
            type="button"
            onClick={onClose}
            className="liquid-action-strong liquid-pressable rounded-2xl px-5 py-2.5 text-sm font-black text-white"
          >
            {prompt.confirmText || '知道了'}
          </button>
        </div>
      </section>
    </div>
  );
};

export const AIAssistantDialog: React.FC<AIAssistantDialogProps> = ({
  isOpen,
  onClose,
  dashboardData,
  aiConfig
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '您好！我是金蝶园区智能助手，可以帮您：\n\n• 📊 分析园区经营数据\n• 💰 评估财务指标完成情况\n• 📈 生成经营报告（本月/本季度/本年度）\n• 💡 提供招商策略建议\n\n请问有什么可以帮助您的？',
      id: 'welcome'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState<AiPromptState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const showAiNotice = React.useCallback((prompt: Omit<AiPromptState, 'resolve'>) => (
    new Promise<void>((resolve) => {
      setAiPrompt({
        confirmText: '知道了',
        tone: 'blue',
        ...prompt,
        resolve,
      });
    })
  ), []);

  const closeAiPrompt = React.useCallback(() => {
    setAiPrompt((current) => {
      current?.resolve?.();
      return null;
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      // 调用AI API
      const response = await callAI(userMessage, dashboardData, aiConfig);
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: response.content,
        isHTML: response.isHTML 
      }]);
    } catch (error: any) {
      console.error('AI调用异常:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `抱歉，AI服务暂时不可用。错误: ${error?.message || '未知错误'}` 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickReport = async (period: '本月' | '本季度' | '本年度') => {
    const reportId = `report-${Date.now()}`;
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: `生成${period}经营报告` 
    }]);
    setIsLoading(true);

    try {
      const report = await generateReport(period, dashboardData, aiConfig);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: report,
        isHTML: true,
        id: reportId  // 设置 ID 用于导出
      }]);
    } catch (error) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: '报告生成失败，请稍后再试。' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 导出为图片
  const exportAsImage = async (messageId: string) => {
    const element = document.getElementById(messageId);
    if (!element) {
      await showAiNotice({
        title: '找不到报告内容',
        message: '当前报告内容还未渲染完成或已被移除，请重新生成报告后再导出。',
        tone: 'amber',
      });
      return;
    }

    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(element, {
        scale: 2, // 高清度
        useCORS: true,
        backgroundColor: '#ffffff'
      });

      const link = document.createElement('a');
      link.download = `金蝶园区经营报告-${new Date().toLocaleDateString()}.png`;
      link.href = canvas.toDataURL();
      link.click();
    } catch (error) {
      console.error('导出图片失败:', error);
      await showAiNotice({
        title: '导出图片失败',
        message: '导出失败，请重试。',
        tone: 'rose',
      });
    }
  };

  // 导出为PDF
  const exportAsPDF = async (messageId: string) => {
    const element = document.getElementById(messageId);
    if (!element) {
      await showAiNotice({
        title: '找不到报告内容',
        message: '当前报告内容还未渲染完成或已被移除，请重新生成报告后再导出。',
        tone: 'amber',
      });
      return;
    }

    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const imgWidth = 190; // A4 宽度 - 边距
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 10, 10, imgWidth, imgHeight);
      pdf.save(`金蝶园区经营报告-${new Date().toLocaleDateString()}.pdf`);
    } catch (error) {
      console.error('导出PDF失败:', error);
      await showAiNotice({
        title: '导出 PDF 失败',
        message: '导出失败，请重试。',
        tone: 'rose',
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="liquid-elevated-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 animate-in fade-in duration-200 sm:p-4">
      <div className="liquid-elevated-panel flex h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col rounded-[28px] animate-in zoom-in-95 duration-200 sm:h-[600px]">
        {/* Header */}
        <div className="liquid-elevated-header flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="liquid-action-strong flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-950 sm:text-xl">AI 智能助手</h2>
              <p className="text-xs font-semibold text-slate-500">园区经营数据分析与报告生成</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="liquid-glass-control liquid-pressable shrink-0 rounded-full p-2 text-slate-500 hover:text-slate-800"
            aria-label="关闭 AI 智能助手"
          >
            <X size={20} />
          </button>
        </div>

        {/* Quick Actions */}
        <div className="liquid-glass-toolbar px-4 py-3">
          <div className="flex gap-2 flex-wrap">
            <button 
              onClick={() => handleQuickReport('本月')}
              disabled={isLoading}
              className="liquid-glass-control liquid-pressable inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-slate-700 disabled:pointer-events-none disabled:opacity-50"
            >
              <FileText size={16} className="text-blue-600" />
              本月经营报告
            </button>
            <button 
              onClick={() => handleQuickReport('本季度')}
              disabled={isLoading}
              className="liquid-glass-control liquid-pressable inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-slate-700 disabled:pointer-events-none disabled:opacity-50"
            >
              <Calendar size={16} className="text-cyan-700" />
              本季度经营报告
            </button>
            <button 
              onClick={() => handleQuickReport('本年度')}
              disabled={isLoading}
              className="liquid-glass-control liquid-pressable inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-slate-700 disabled:pointer-events-none disabled:opacity-50"
            >
              <TrendingUp size={16} className="text-blue-700" />
              本年度经营报告
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
          {messages.map((msg, idx) => (
            <div 
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className="flex max-w-[88%] flex-col gap-2 sm:max-w-[80%]">
                <div 
                  id={msg.id} // 添加 ID 用于导出
                  className={`rounded-2xl px-4 py-3 ${
                    msg.role === 'user' 
                      ? 'liquid-action-strong text-white'
                      : 'liquid-glass-readable text-slate-800'
                  }`}
                >
                  {msg.isHTML ? (
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(msg.content) }}
                    />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
                
                {/* 导出按钮（只在HTML报告时显示） */}
                {msg.isHTML && msg.id && msg.role === 'assistant' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => exportAsImage(msg.id!)}
                      className="liquid-glass-control liquid-pressable flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-slate-700"
                    >
                      <ImageIcon size={14} />
                      导出为图片
                    </button>
                    <button
                      onClick={() => exportAsPDF(msg.id!)}
                      className="liquid-glass-control liquid-pressable flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-slate-700"
                    >
                      <Download size={14} />
                      导出为PDF
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="liquid-glass-readable flex items-center gap-2 rounded-2xl px-4 py-3">
                <Loader2 size={16} className="animate-spin text-blue-600" />
                <span className="text-sm text-slate-600">AI 正在思考中...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="liquid-elevated-footer px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="输入您的问题，例如：本月出租率完成情况如何？"
              className="liquid-elevated-field min-h-11 flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus-visible:ring-4 focus-visible:ring-blue-500/15"
              disabled={isLoading}
            />
            <button
              onClick={handleSendMessage}
              disabled={isLoading || !inputValue.trim()}
              className="liquid-action-strong liquid-pressable flex min-h-11 items-center justify-center gap-2 rounded-2xl px-6 py-3 font-bold disabled:pointer-events-none disabled:opacity-50"
            >
              <Send size={18} />
              发送
            </button>
          </div>
        </div>
      </div>
      {aiPrompt ? (
        <AiPromptOverlay prompt={aiPrompt} onClose={closeAiPrompt} />
      ) : null}
    </div>
  );
};

// AI调用函数
async function callAI(query: string, data: DashboardData, aiConfig: any): Promise<{ content: string; isHTML: boolean }> {
  if (!aiConfig.enabled || aiConfig.provider === 'none') {
    return { 
      content: '请先在"系统与备份"中配置AI服务。', 
      isHTML: false 
    };
  }

  // 构建上下文
  const context = buildContext(data);
  const prompt = `${context}\n\n用户问题：${query}\n\n请以专业、简洁的方式回答。`;

  // 调用千问API
  if (aiConfig.provider === 'qwen') {
    return await callQwenAPI(prompt, aiConfig);
  }

  return { content: '当前仅支持千问AI。', isHTML: false };
}

// 生成报告函数
async function generateReport(period: string, data: DashboardData, aiConfig: any): Promise<string> {
  if (!aiConfig.enabled || aiConfig.provider === 'none') {
    return '<p>请先在"系统与备份"中配置AI服务。</p>';
  }

  const context = buildContext(data);
  const prompt = `${context}\n\n请生成${period}的园区经营报告，要求：
1. HTML格式，图文并茂
2. 包含以下内容：
   - 核心指标完成情况（出租率、收款、收缴率）
   - 将上面提供的【当年月度完成率】表格转换为美观的HTML表格，并分析趋势
   - 收缴率的口径是“当月完成率”，即当月实际收入/当月预算收入
   - 同比/环比数据分析
   - 重点问题与风险预警
   - 下周期策略建议
3. 使用表格、图标等元素，专业美观
4. 注意：不要使用“累计收缴率”这个概念，只用“当月完成率”和“累计达成率”`;


  if (aiConfig.provider === 'qwen') {
    const result = await callQwenAPI(prompt, aiConfig);
    return result.content;
  }

  return '<p>当前仅支持千问AI。</p>';
}

// 构建数据上下文
function buildContext(data: DashboardData): string {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1; // 1-12
  const activeTenants = data.tenants.filter((t) => !t.terminationDate);

  const totalLeasableArea = data.totalArea || 0;
  const rentedArea = data.leasedArea || 0;
  const occupancyRate = data.occupancyRate || 0;

  // 构建当年月度完成率表格（参照预算执行表）
  let monthlyTable = '\n\n【当年月度完成率】\n';
  monthlyTable += '月份 | 预算收入 | 实际收入 | 当月完成率 | 累计达成率\n';
  monthlyTable += '--- | --- | --- | --- | ---\n';
  
  // 仅显示截止当月的数据 (month 是字符串类型，如 "1", "2", ...)
  const relevantTrends = data.monthlyTrends
    .filter(t => parseInt(t.month) <= currentMonth)
    .sort((a, b) => parseInt(a.month) - parseInt(b.month));
  
  relevantTrends.forEach(trend => {
    const monthNum = parseInt(trend.month);
    const budget = trend.revenueTarget ? formatCurrency(trend.revenueTarget) : '-';
    const actual = trend.revenueCollected !== null ? formatCurrency(trend.revenueCollected) : '-';
    const monthlyRate = trend.collectionRate !== null ? formatPercent(trend.collectionRate) : '-';
    
    // 计算累计达成率（当月及以前）
    const cumulativeTarget = relevantTrends
      .filter(t => parseInt(t.month) <= monthNum)
      .reduce((sum, t) => sum + (t.revenueTarget || 0), 0);
    const cumulativeActual = relevantTrends
      .filter(t => parseInt(t.month) <= monthNum)
      .reduce((sum, t) => sum + (t.revenueCollected || 0), 0);
    const cumulativeRate = cumulativeTarget > 0 ? (cumulativeActual / cumulativeTarget) * 100 : 0;
    
    monthlyTable += `${monthNum}月 | ${budget} | ${actual} | ${monthlyRate} | ${formatPercent(cumulativeRate)}\n`;
  });

  return `【园区数据概况】
- 总面积（可出租）：${formatArea(totalLeasableArea)}
- 已租面积：${formatArea(rentedArea)}
- 出租率：${formatPercent(occupancyRate)}
- 在租客户数：${activeTenants.length}家
- 年度营收目标：${formatCurrency(data.annualRevenueTarget)}
- 年度已收：${formatCurrency(data.annualRevenueCollected)}
- 出租率目标：${formatPercent(data.annualOccupancyTarget)}
- 当月收缴率：${formatPercent(data.collectionRate)}${monthlyTable}`;
}

// 调用千问API
async function callQwenAPI(prompt: string, aiConfig: any): Promise<{ content: string; isHTML: boolean }> {
  try {
    const apiUrl = getAiProxyChatUrl();
    const hostname = window.location.hostname;

    console.log('[AI API] 调用参数:', {
      hostname,
      apiUrl,
      model: 'qwen3-max-2026-01-23'
    });
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen3-max-2026-01-23', // Coding Plan 支持的模型
        messages: [
          {
            role: 'system',
            content: '你是金蝶软件园的专业运营顾问，擅长数据分析和经营决策建议。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7
      })
    });

    console.log('[AI API] 响应状态:', response.status, response.statusText);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[AI API] 错误响应:', errorData);
      throw new Error(`API Error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    console.log('[AI API] 成功响应:', { 
      model: result.model, 
      hasContent: !!result.choices?.[0]?.message?.content,
      tokens: result.usage?.total_tokens 
    });
    
    const content = result.choices?.[0]?.message?.content || '无法获取回复';
    const isHTML = content.includes('<') && content.includes('>');

    return { content, isHTML };
  } catch (error: any) {
    console.error('[AI API] 调用异常:', error);
    const proxyUrl = getAiProxyBaseForMessage();
    return { 
      content: `AI服务调用失败：${error.message}\n\n说明：请确保 AI 代理可用（${proxyUrl}，路径 /api/chat）`, 
      isHTML: false 
    };
  }
}
