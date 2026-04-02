import React, { useState, useRef, useCallback } from 'react';
import { X, Sparkles, Upload, FileText, Image as ImageIcon, FileSpreadsheet, Loader2, Check, Trash2, AlertCircle, CheckCircle, ChevronDown } from 'lucide-react';
import { PaymentRecord, Tenant } from '../types';
import * as XLSX from 'xlsx';
import { getAiProxyChatUrl } from '../config/urls';

// ---- 类型定义 ----
interface RecognizedItem {
  id: string;
  payerName: string;       // AI 识别的付款方名称
  matchedTenantId: string; // 匹配到的系统客户 ID（空=未匹配）
  amount: number;
  date: string;            // YYYY-MM-DD
  type: 'Rent' | 'Deposit' | 'ManagementFee' | 'Other';
  remarks: string;
  confidence: number;      // 匹配置信度 0-1
  selected: boolean;       // 是否选中导入
}

interface AIPaymentRecognitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenants: Tenant[];
  onImport: (records: PaymentRecord[]) => void;
  receivableMonth?: string; // YYYY-MM，用于应收核销场景
}

type InputTab = 'image' | 'text' | 'excel';

// ---- 模糊匹配 ----
function fuzzyMatchTenant(name: string, tenants: Tenant[]): { id: string; confidence: number } {
  if (!name || tenants.length === 0) return { id: '', confidence: 0 };
  const cleaned = name.replace(/[\s（）()【】\[\]]/g, '').toLowerCase();

  let bestId = '';
  let bestScore = 0;

  for (const t of tenants) {
    const tName = t.name.replace(/[\s（）()【】\[\]]/g, '').toLowerCase();
    // 完全包含
    if (tName === cleaned || cleaned === tName) { bestId = t.id; bestScore = 1; break; }
    if (tName.includes(cleaned) || cleaned.includes(tName)) {
      const score = Math.min(cleaned.length, tName.length) / Math.max(cleaned.length, tName.length);
      if (score > bestScore) { bestScore = score; bestId = t.id; }
    }
    // 部分匹配（前几个字相同）
    let common = 0;
    for (let i = 0; i < Math.min(tName.length, cleaned.length); i++) {
      if (tName[i] === cleaned[i]) common++; else break;
    }
    const partialScore = common / Math.max(tName.length, cleaned.length) * 0.8;
    if (partialScore > bestScore) { bestScore = partialScore; bestId = t.id; }
  }

  return { id: bestScore >= 0.3 ? bestId : '', confidence: bestScore };
}

// ---- 推断款项类型 ----
function inferPaymentType(text: string): RecognizedItem['type'] {
  const lower = text.toLowerCase();
  if (lower.includes('押金') || lower.includes('保证金')) return 'Deposit';
  if (lower.includes('物业') || lower.includes('管理费')) return 'ManagementFee';
  if (lower.includes('租金') || lower.includes('租赁') || lower.includes('房租')) return 'Rent';
  return 'Rent'; // 默认租金
}

// ---- AI 代理调用 ----
async function callAIForRecognition(payload: { type: 'image' | 'text' | 'excel'; content: string }): Promise<any[]> {
  const apiUrl = getAiProxyChatUrl();

  let userContent: string;

  if (payload.type === 'image') {
    // 发送 base64 图片让 AI 识别
    userContent = `请识别以下银行流水截图中的收款信息。图片内容（base64）：\n${payload.content}\n\n请提取每一笔交易，返回JSON数组格式：[{"payerName":"付款方名称","amount":金额数字,"date":"YYYY-MM-DD","type":"款项类型","remarks":"备注"}]\n\n款项类型只能是：租金、押金、物业费、其他。金额必须是正数。如果日期不完整请用今天的日期。只返回JSON数组，不要其他文字。`;
  } else if (payload.type === 'text') {
    userContent = `请从以下银行流水文本中提取收款信息：\n\n${payload.content}\n\n请提取每一笔交易，返回JSON数组格式：[{"payerName":"付款方名称","amount":金额数字,"date":"YYYY-MM-DD","type":"款项类型","remarks":"备注"}]\n\n款项类型只能是：租金、押金、物业费、其他。金额必须是正数。如果日期不完整请用今天的日期。只返回JSON数组，不要其他文字。`;
  } else {
    userContent = `请从以下Excel表格数据（JSON格式）中提取收款信息：\n\n${payload.content}\n\n请提取每一笔交易，返回JSON数组格式：[{"payerName":"付款方名称","amount":金额数字,"date":"YYYY-MM-DD","type":"款项类型","remarks":"备注"}]\n\n款项类型只能是：租金、押金、物业费、其他。金额必须是正数。如果日期不完整请用今天的日期。只返回JSON数组，不要其他文字。`;
  }

  const messages: any[] = [
    { role: 'system', content: '你是一个专业的财务数据识别助手。你需要从银行流水数据中提取收款记录。请严格按照要求的JSON格式返回结果。' },
    { role: 'user', content: userContent }
  ];

  // 如果是图片类型，使用 vision 格式
  if (payload.type === 'image') {
    messages[1] = {
      role: 'user',
      content: [
      { type: 'text', text: '请识别这张银行流水截图中的每笔收款信息，返回JSON数组格式：[{"payerName":"付款方名称","amount":金额数字,"date":"YYYY-MM-DD","type":"款项类型","remarks":"备注"}]\n款项类型只能是：租金、押金、物业费、其他。金额必须是正数。只返回JSON数组，不要其他文字。' },
        { type: 'image_url', image_url: { url: payload.content } }
      ]
    };
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'MiniMax-M2.5',
      messages,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`AI API 错误: ${response.status} - ${JSON.stringify(err)}`);
  }

  const result = await response.json();
  const text = result.choices?.[0]?.message?.content || '';

  // 尝试从返回中提取 JSON 数组
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('AI 未返回有效的 JSON 数据');

  return JSON.parse(jsonMatch[0]);
}

// ---- 主组件 ----
export const AIPaymentRecognitionModal: React.FC<AIPaymentRecognitionModalProps> = ({
  isOpen, onClose, tenants, onImport, receivableMonth
}) => {
  const [activeTab, setActiveTab] = useState<InputTab>('image');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<RecognizedItem[]>([]);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [textInput, setTextInput] = useState('');
  const [excelFileName, setExcelFileName] = useState('');
  const [excelData, setExcelData] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  // 活跃租户列表
  const activeTenants = tenants.filter(t => t.status !== 'Terminated');

  const typeLabel = (t: string) => {
    const map: Record<string, string> = { Rent: '租金', Deposit: '押金', ManagementFee: '物业费', Other: '其他' };
    return map[t] || t;
  };

  const typeFromChinese = (t: string): RecognizedItem['type'] => {
    if (t.includes('押金') || t.includes('保证金')) return 'Deposit';
    if (t.includes('物业') || t.includes('管理费')) return 'ManagementFee';
    if (t.includes('租金') || t.includes('租赁')) return 'Rent';
    return 'Rent';
  };

  // ---- 图片处理 ----
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setImagePreview(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImagePreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  // ---- 粘贴图片 ----
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          setImagePreview(ev.target?.result as string);
          setActiveTab('image');
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  }, []);

  // ---- Excel 处理 ----
  const handleExcelSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExcelFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
        setExcelData(jsonData);
      } catch (err: any) {
        setError(`Excel 解析失败: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ---- AI 识别 ----
  const handleRecognize = async () => {
    setIsLoading(true);
    setError('');
    setResults([]);

    try {
      let payload: { type: InputTab; content: string };

      if (activeTab === 'image') {
        if (!imagePreview) { setError('请先上传或粘贴银行流水截图'); setIsLoading(false); return; }
        payload = { type: 'image', content: imagePreview };
      } else if (activeTab === 'text') {
        if (!textInput.trim()) { setError('请粘贴银行流水文本'); setIsLoading(false); return; }
        payload = { type: 'text', content: textInput };
      } else {
        if (excelData.length === 0) { setError('请先上传 Excel 文件'); setIsLoading(false); return; }
        payload = { type: 'excel', content: JSON.stringify(excelData.slice(0, 50)) }; // 限制行数
      }

      const rawResults = await callAIForRecognition(payload);

      const items: RecognizedItem[] = rawResults.map((r: any, idx: number) => {
        const match = fuzzyMatchTenant(r.payerName || '', activeTenants);
        const aiType = typeFromChinese(r.type || '');
        return {
          id: `ai_${Date.now()}_${idx}`,
          payerName: r.payerName || '未知',
          matchedTenantId: match.id,
          amount: Math.abs(Number(r.amount) || 0),
          date: r.date || new Date().toISOString().split('T')[0],
          type: aiType,
          remarks: r.remarks || '',
          confidence: match.confidence,
          selected: true
        };
      });

      setResults(items);
    } catch (err: any) {
      setError(`AI 识别失败: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ---- 结果编辑 ----
  const updateResult = (id: string, field: string, value: any) => {
    setResults(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      // 如果修改了匹配的客户，重置置信度
      if (field === 'matchedTenantId') updated.confidence = value ? 1 : 0;
      return updated;
    }));
  };

  const removeResult = (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
  };

  const toggleSelect = (id: string) => {
    setResults(prev => prev.map(r => r.id === id ? { ...r, selected: !r.selected } : r));
  };

  const toggleSelectAll = () => {
    const allSelected = results.every(r => r.selected);
    setResults(prev => prev.map(r => ({ ...r, selected: !allSelected })));
  };

  // ---- 导入 ----
  const handleImport = () => {
    const selected = results.filter(r => r.selected && r.matchedTenantId && r.amount > 0);
    if (selected.length === 0) { setError('没有可导入的记录（需匹配客户且金额大于0）'); return; }

    const records: PaymentRecord[] = selected.map(r => {
      const tenant = activeTenants.find(t => t.id === r.matchedTenantId);
      return {
        id: `p${Date.now()}_ai_${r.id.split('_').pop()}`,
        tenantId: r.matchedTenantId,
        tenantName: tenant?.name || r.payerName,
        amount: r.amount,
        type: r.type,
        date: r.date,
        status: 'Received' as const,
        period: r.date.substring(0, 7),
        invoiceStatus: 'Pending' as const,
        remarks: r.remarks ? `[AI识别] ${r.remarks}` : '[AI智能录入]'
      };
    });

    onImport(records);
    onClose();
  };

  const selectedCount = results.filter(r => r.selected).length;
  const matchedCount = results.filter(r => r.selected && r.matchedTenantId).length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" onPaste={handlePaste}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-blue-50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-600 text-white rounded-xl"><Sparkles size={22} /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">AI 智能收款录入</h2>
              <p className="text-xs text-slate-500">支持银行流水截图、文字、Excel 自动识别</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/80 rounded-lg transition-colors text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Input Tabs */}
          <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-fit">
            {([
              { key: 'image' as InputTab, icon: ImageIcon, label: '图片识别' },
              { key: 'text' as InputTab, icon: FileText, label: '文字粘贴' },
              { key: 'excel' as InputTab, icon: FileSpreadsheet, label: 'Excel导入' },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.key ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Input Area */}
          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
            {activeTab === 'image' && (
              <div>
                {!imagePreview ? (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleImageDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-all"
                  >
                    <Upload size={40} className="mx-auto text-slate-400 mb-3" />
                    <p className="text-sm text-slate-600 font-medium">点击上传或拖拽银行流水截图</p>
                    <p className="text-xs text-slate-400 mt-1">也可以直接 Ctrl+V 粘贴截图</p>
                    <p className="text-xs text-slate-400 mt-1">支持 JPG / PNG / WEBP</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative bg-white rounded-lg border border-slate-200 p-2">
                      <img src={imagePreview} alt="银行流水截图" className="max-h-60 mx-auto rounded" />
                      <button
                        onClick={() => { setImagePreview(''); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                        className="absolute top-2 right-2 p-1 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"
                      ><X size={16} /></button>
                    </div>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
              </div>
            )}

            {activeTab === 'text' && (
              <div>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={`粘贴银行流水文本，例如：\n\n2026-03-01  上海管易云计算软件有限公司  租金  73,943.00\n2026-03-05  上海纪世嘉游信息技术有限公司  租金  63,459.00\n2026-03-10  XX物业公司  物业费  55,000.00\n\n支持任意格式的文本，AI会自动识别提取`}
                  className="w-full h-48 p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-none bg-white"
                />
              </div>
            )}

            {activeTab === 'excel' && (
              <div>
                {!excelFileName ? (
                  <div
                    onClick={() => excelInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-all"
                  >
                    <FileSpreadsheet size={40} className="mx-auto text-slate-400 mb-3" />
                    <p className="text-sm text-slate-600 font-medium">点击上传 Excel 银行流水文件</p>
                    <p className="text-xs text-slate-400 mt-1">支持 .xls / .xlsx 格式</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 bg-white rounded-lg border border-slate-200 p-3">
                      <FileSpreadsheet size={20} className="text-emerald-600" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-700">{excelFileName}</p>
                        <p className="text-xs text-slate-400">{excelData.length} 行数据</p>
                      </div>
                      <button
                        onClick={() => { setExcelFileName(''); setExcelData([]); if (excelInputRef.current) excelInputRef.current.value = ''; }}
                        className="p-1 text-red-500 hover:bg-red-50 rounded"
                      ><X size={16} /></button>
                    </div>
                    {excelData.length > 0 && (
                      <div className="overflow-x-auto max-h-40 bg-white rounded border border-slate-200">
                        <table className="text-xs w-full">
                          <thead className="bg-slate-50 sticky top-0">
                            <tr>{Object.keys(excelData[0]).map((k, i) => <th key={i} className="px-2 py-1 text-left text-slate-500 font-medium">{k}</th>)}</tr>
                          </thead>
                          <tbody>
                            {excelData.slice(0, 5).map((row, ri) => (
                              <tr key={ri} className="border-t border-slate-100">
                                {Object.values(row).map((v: any, ci) => <td key={ci} className="px-2 py-1 text-slate-600">{String(v)}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {excelData.length > 5 && <div className="text-center py-1 text-xs text-slate-400">...共 {excelData.length} 行</div>}
                      </div>
                    )}
                  </div>
                )}
                <input ref={excelInputRef} type="file" accept=".xls,.xlsx,.csv" onChange={handleExcelSelect} className="hidden" />
              </div>
            )}
          </div>

          {/* Recognize Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleRecognize}
              disabled={isLoading}
              className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm disabled:opacity-50"
            >
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              {isLoading ? 'AI 识别中...' : 'AI 智能识别'}
            </button>
            {isLoading && <span className="text-xs text-slate-400">正在调用AI分析数据，请稍候...</span>}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {/* Results Table */}
          {results.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <CheckCircle size={16} className="text-emerald-600" />
                  识别结果（{results.length} 笔）
                </h3>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>已选 {selectedCount} 笔</span>
                  <span>已匹配 {matchedCount} 笔</span>
                  <button onClick={toggleSelectAll} className="text-blue-600 hover:underline">
                    {results.every(r => r.selected) ? '取消全选' : '全选'}
                  </button>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2.5 text-left w-8">
                          <input type="checkbox" checked={results.every(r => r.selected)} onChange={toggleSelectAll} className="rounded" />
                        </th>
                        <th className="px-3 py-2.5 text-left text-slate-500 font-medium">付款方（AI识别）</th>
                        <th className="px-3 py-2.5 text-left text-slate-500 font-medium">匹配客户</th>
                        <th className="px-3 py-2.5 text-left text-slate-500 font-medium">金额</th>
                        <th className="px-3 py-2.5 text-left text-slate-500 font-medium">日期</th>
                        <th className="px-3 py-2.5 text-left text-slate-500 font-medium">类型</th>
                        <th className="px-3 py-2.5 text-left text-slate-500 font-medium">备注</th>
                        <th className="px-3 py-2.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {results.map(r => (
                        <tr key={r.id} className={`${r.selected ? '' : 'opacity-50'} hover:bg-slate-50 transition-colors`}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={r.selected} onChange={() => toggleSelect(r.id)} className="rounded" />
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-slate-700 font-medium">{r.payerName}</span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="relative">
                              <select
                                value={r.matchedTenantId}
                                onChange={(e) => updateResult(r.id, 'matchedTenantId', e.target.value)}
                                className={`w-full p-1.5 pr-7 rounded border text-xs appearance-none ${r.matchedTenantId ? (r.confidence >= 0.7 ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50') : 'border-red-300 bg-red-50'}`}
                              >
                                <option value="">-- 请选择客户 --</option>
                                {activeTenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                            {r.matchedTenantId && r.confidence < 0.7 && (
                              <span className="text-[10px] text-amber-600 mt-0.5 block">低置信度匹配，请确认</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              value={r.amount}
                              onChange={(e) => updateResult(r.id, 'amount', Number(e.target.value))}
                              className="w-24 p-1.5 rounded border border-slate-200 text-xs text-right font-mono"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="date"
                              value={r.date}
                              onChange={(e) => updateResult(r.id, 'date', e.target.value)}
                              className="p-1.5 rounded border border-slate-200 text-xs"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={r.type}
                              onChange={(e) => updateResult(r.id, 'type', e.target.value)}
                              className="p-1.5 rounded border border-slate-200 text-xs"
                            >
                              <option value="Rent">租金</option>
                              <option value="Deposit">押金</option>
                              <option value="ManagementFee">物业费</option>
                              <option value="Other">其他</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={r.remarks}
                              onChange={(e) => updateResult(r.id, 'remarks', e.target.value)}
                              className="w-full p-1.5 rounded border border-slate-200 text-xs"
                              placeholder="备注"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={() => removeResult(r.id)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="flex items-center justify-between p-5 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
            <div className="text-sm text-slate-500">
              {matchedCount === selectedCount ? (
                <span className="text-emerald-600 flex items-center gap-1"><CheckCircle size={14} /> 全部已匹配客户</span>
              ) : (
                <span className="text-amber-600 flex items-center gap-1"><AlertCircle size={14} /> {selectedCount - matchedCount} 笔未匹配客户，将跳过</span>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 text-sm">取消</button>
              <button
                onClick={handleImport}
                disabled={matchedCount === 0}
                className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                <Check size={16} />
                导入 {matchedCount} 笔收款
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
