import React, { useState, useRef, useCallback } from 'react';
import { X, Sparkles, Upload, FileText, Image as ImageIcon, FileSpreadsheet, Loader2, Check, AlertCircle, CheckCircle, Building as BuildingIcon } from 'lucide-react';
import { Tenant, Building, ContractStatus, DepositStatus, UnitStatus, PaymentCycle } from '../types';
import * as XLSX from 'xlsx';
import { getAiProxyChatUrl } from '../config/urls';
import { formatArea } from '../services/numberFormat';

// ---- AI 识别结果 ----
interface RecognizedContract {
  name?: string;           // 企业名称
  industry?: string;       // 行业
  buildingName?: string;   // 楼宇名称（AI识别，需匹配）
  unitNames?: string[];    // 房号列表（AI识别，需匹配）
  signingDate?: string;    // 签约日期
  moveInDate?: string;     // 入驻时间
  leaseStart?: string;     // 起租日期
  leaseEnd?: string;       // 合同结束日期
  unitPrice?: number;      // 日单价 (元/㎡/天)
  monthlyRent?: number;    // 月租金
  totalArea?: number;      // 面积
  paymentCycle?: string;   // 支付频率
  depositAmount?: number;  // 押金
  contactName?: string;    // 联系人
  contactInfo?: string;    // 联系方式
  legalRepName?: string;   // 法人
  foundingDate?: string;   // 成立日期
  specialRequirements?: string; // 备注
  rentFreeStart?: string;  // 免租开始
  rentFreeEnd?: string;    // 免租结束
  rentFreeDesc?: string;   // 免租说明
}

interface AIContractRecognitionModalProps {
  isOpen: boolean;
  onClose: () => void;
  buildings: Building[];
  onImport: (tenantData: Partial<Tenant>) => void;
}

type InputTab = 'image' | 'text' | 'excel';

// ---- AI 代理调用 ----
async function callAIForContractRecognition(payload: { type: InputTab; content: string }): Promise<RecognizedContract> {
  const apiUrl = getAiProxyChatUrl();

  const fieldDescription = `请从中提取以下合同信息，返回JSON对象：
{
  "name": "企业名称（全称）",
  "industry": "所属行业",
  "buildingName": "楼宇名称（如1号楼、2号楼）",
  "unitNames": ["房号列表，如301, 302, 303"],
  "signingDate": "签约日期 YYYY-MM-DD",
  "moveInDate": "入驻时间/实际入驻日期 YYYY-MM-DD",
  "leaseStart": "起租日期 YYYY-MM-DD",
  "leaseEnd": "合同结束日期 YYYY-MM-DD",
  "unitPrice": 日单价数字（元/㎡/天），
  "monthlyRent": 月租金数字,
  "totalArea": 面积数字（㎡），
  "paymentCycle": "支付频率：HalfMonthly/Monthly/BiMonthly/Quarterly/SemiAnnual/Annual/Custom",
  "depositAmount": 押金金额数字,
  "contactName": "联系人/对接人姓名",
  "contactInfo": "联系电话",
  "legalRepName": "法定代表人",
  "foundingDate": "企业成立日期 YYYY-MM-DD",
  "specialRequirements": "特殊条款/备注",
  "rentFreeStart": "免租期开始日期 YYYY-MM-DD",
  "rentFreeEnd": "免租期结束日期 YYYY-MM-DD",
  "rentFreeDesc": "免租说明"
}
如果某个字段信息不存在，设为null。金额必须是纯数字。日期格式统一为YYYY-MM-DD。只返回一个JSON对象，不要其他文字。`;

  let userContent: string;

  if (payload.type === 'image') {
    userContent = `请识别以下合同/协议文档截图中的租赁合同信息。\n\n${fieldDescription}`;
  } else if (payload.type === 'text') {
    userContent = `请从以下合同/协议文本中提取租赁合同信息：\n\n${payload.content}\n\n${fieldDescription}`;
  } else {
    userContent = `请从以下Excel表格数据（JSON格式）中提取租赁合同信息：\n\n${payload.content}\n\n${fieldDescription}`;
  }

  const messages: any[] = [
    { role: 'system', content: '你是一个专业的商业地产合同信息提取助手。你需要从合同文档中准确提取租赁相关的关键信息。请严格按照要求的JSON格式返回结果。' },
    { role: 'user', content: userContent }
  ];

  // 图片 vision 格式
  if (payload.type === 'image') {
    messages[1] = {
      role: 'user',
      content: [
        { type: 'text', text: `请识别这张合同/协议文档中的租赁合同信息。\n\n${fieldDescription}` },
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

  // 提取 JSON 对象
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI 未返回有效的 JSON 数据');

  return JSON.parse(jsonMatch[0]);
}

// ---- 楼宇/房号匹配 ----
function matchBuilding(name: string | undefined, buildings: Building[]): string {
  if (!name) return '';
  const cleaned = name.replace(/[\s号楼栋幢]/g, '').toLowerCase();
  for (const b of buildings) {
    const bName = b.name.replace(/[\s号楼栋幢]/g, '').toLowerCase();
    if (bName === cleaned || bName.includes(cleaned) || cleaned.includes(bName)) return b.id;
  }
  // 数字匹配：如 "1" 匹配 "1号楼"
  const numMatch = cleaned.match(/\d+/);
  if (numMatch) {
    for (const b of buildings) {
      if (b.name.includes(numMatch[0])) return b.id;
    }
  }
  return '';
}

function matchUnits(names: string[] | undefined, building: Building | undefined): string[] {
  if (!names || !building) return [];
  const matched: string[] = [];
  for (const name of names) {
    const cleaned = name.replace(/[\s室号房]/g, '').toLowerCase();
    for (const u of building.units) {
      const uName = u.name.replace(/[\s室号房]/g, '').toLowerCase();
      if (uName === cleaned || uName.includes(cleaned) || cleaned.includes(uName)) {
        if (!matched.includes(u.id)) matched.push(u.id);
        break;
      }
    }
  }
  return matched;
}

function inferPaymentCycle(text: string | undefined): PaymentCycle {
  if (!text) return 'Quarterly';
  if (text === 'HalfMonthly' || text.includes('半月') || text.includes('15天') || text.includes('十五天')) return 'HalfMonthly';
  if (text === 'BiMonthly' || text.includes('两月') || text.includes('双月') || text.includes('2月') || text.includes('二月')) return 'BiMonthly';
  if (text === 'Monthly' || text.includes('月付') || text.includes('每月')) return 'Monthly';
  if (text === 'SemiAnnual' || text.includes('半年') || text.includes('半年付')) return 'SemiAnnual';
  if (text === 'Annual' || text.includes('年付') || text.includes('每年')) return 'Annual';
  if (text === 'Custom' || text.includes('自定义')) return 'Custom';
  return 'Quarterly';
}

function getPaymentCycleMonths(cycle: PaymentCycle): number {
  if (cycle === 'HalfMonthly') return 0.5;
  if (cycle === 'Monthly') return 1;
  if (cycle === 'BiMonthly') return 2;
  if (cycle === 'Quarterly') return 3;
  if (cycle === 'SemiAnnual') return 6;
  if (cycle === 'Annual') return 12;
  return 3;
}

// ---- 主组件 ----
export const AIContractRecognitionModal: React.FC<AIContractRecognitionModalProps> = ({
  isOpen, onClose, buildings, onImport
}) => {
  const [activeTab, setActiveTab] = useState<InputTab>('image');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [recognized, setRecognized] = useState<RecognizedContract | null>(null);
  const [editData, setEditData] = useState<RecognizedContract>({});
  const [matchedBuildingId, setMatchedBuildingId] = useState('');
  const [matchedUnitIds, setMatchedUnitIds] = useState<string[]>([]);
  const [imagePreview, setImagePreview] = useState('');
  const [textInput, setTextInput] = useState('');
  const [excelFileName, setExcelFileName] = useState('');
  const [excelData, setExcelData] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  // ---- 图片处理 ----
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => { setImagePreview(ev.target?.result as string); setActiveTab('image'); };
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
    setRecognized(null);

    try {
      let payload: { type: InputTab; content: string };

      if (activeTab === 'image') {
        if (!imagePreview) { setError('请先上传或粘贴合同截图'); setIsLoading(false); return; }
        payload = { type: 'image', content: imagePreview };
      } else if (activeTab === 'text') {
        if (!textInput.trim()) { setError('请粘贴合同文本'); setIsLoading(false); return; }
        payload = { type: 'text', content: textInput };
      } else {
        if (excelData.length === 0) { setError('请先上传 Excel 文件'); setIsLoading(false); return; }
        payload = { type: 'excel', content: JSON.stringify(excelData.slice(0, 30)) };
      }

      const result = await callAIForContractRecognition(payload);
      setRecognized(result);
      setEditData(result);

      // 自动匹配楼宇和房号
      const bId = matchBuilding(result.buildingName, buildings);
      setMatchedBuildingId(bId);
      if (bId) {
        const building = buildings.find(b => b.id === bId);
        const uIds = matchUnits(result.unitNames, building);
        setMatchedUnitIds(uIds);
      }
    } catch (err: any) {
      setError(`AI 识别失败: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ---- 导入 ----
  const handleImport = () => {
    const cycle = inferPaymentCycle(editData.paymentCycle);
    const cycleMonths = getPaymentCycleMonths(cycle);

    const building = buildings.find(b => b.id === matchedBuildingId);
    const totalArea = editData.totalArea || matchedUnitIds.reduce((sum, uid) => {
      const unit = building?.units.find(u => u.id === uid);
      return sum + (unit?.area || 0);
    }, 0);

    const tenantData: Partial<Tenant> = {
      name: editData.name || '',
      industry: editData.industry || undefined,
      buildingId: matchedBuildingId || undefined,
      unitIds: matchedUnitIds.length > 0 ? matchedUnitIds : undefined,
      totalArea: totalArea || undefined,
      signingDate: editData.signingDate || new Date().toISOString().split('T')[0],
      leaseStart: editData.leaseStart || undefined,
      leaseEnd: editData.leaseEnd || undefined,
      moveInDate: editData.moveInDate || undefined,
      unitPrice: editData.unitPrice || undefined,
      monthlyRent: editData.monthlyRent || undefined,
      paymentCycle: cycle,
      paymentCycleMonths: cycleMonths,
      firstPaymentMonths: cycleMonths,
      depositAmount: editData.depositAmount || 0,
      depositStatus: DepositStatus.Unpaid,
      status: ContractStatus.Active,
      contactName: editData.contactName || undefined,
      contactInfo: editData.contactInfo || undefined,
      legalRepName: editData.legalRepName || undefined,
      foundingDate: editData.foundingDate || undefined,
      specialRequirements: editData.specialRequirements || undefined,
      rentFreePeriods: (editData.rentFreeStart && editData.rentFreeEnd)
        ? [{ start: editData.rentFreeStart, end: editData.rentFreeEnd, description: editData.rentFreeDesc || '免租期' }]
        : [],
      isRisk: false,
    };

    // 如果有单价和面积但没有月租，自动计算
    if (tenantData.unitPrice && tenantData.totalArea && !tenantData.monthlyRent) {
      tenantData.monthlyRent = Math.round(tenantData.unitPrice * (365 / 12) * tenantData.totalArea * 100) / 100;
    }

    onImport(tenantData);
    onClose();
  };

  // 重新匹配楼宇时更新房号
  const handleBuildingChange = (bId: string) => {
    setMatchedBuildingId(bId);
    if (bId && editData.unitNames) {
      const building = buildings.find(b => b.id === bId);
      setMatchedUnitIds(matchUnits(editData.unitNames, building));
    } else {
      setMatchedUnitIds([]);
    }
  };

  if (!isOpen) return null;

  const selectedBuilding = buildings.find(b => b.id === matchedBuildingId);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" onPaste={handlePaste}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 text-white rounded-xl"><Sparkles size={22} /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">AI 智能合同录入</h2>
              <p className="text-xs text-slate-500">支持合同截图、文字信息、Excel 自动识别</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/80 rounded-lg transition-colors text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Input Tabs */}
          <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-fit">
            {([
              { key: 'image' as InputTab, icon: ImageIcon, label: '合同截图' },
              { key: 'text' as InputTab, icon: FileText, label: '文字信息' },
              { key: 'excel' as InputTab, icon: FileSpreadsheet, label: 'Excel导入' },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.key ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
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
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleImageDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all"
                  >
                    <Upload size={40} className="mx-auto text-slate-400 mb-3" />
                    <p className="text-sm text-slate-600 font-medium">点击上传或拖拽合同/协议截图</p>
                    <p className="text-xs text-slate-400 mt-1">也可以直接 Ctrl+V 粘贴截图</p>
                    <p className="text-xs text-slate-400 mt-1">支持 JPG / PNG / WEBP</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative bg-white rounded-lg border border-slate-200 p-2">
                      <img src={imagePreview} alt="合同截图" className="max-h-60 mx-auto rounded" />
                      <button onClick={() => { setImagePreview(''); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                        className="absolute top-2 right-2 p-1 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"><X size={16} /></button>
                    </div>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
              </div>
            )}

            {activeTab === 'text' && (
              <textarea
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                placeholder={`粘贴合同信息，例如：\n\n客户名称：上海XX科技有限公司\n租赁位置：1号楼 305-308\n合同期：2026-04-01 至 2029-03-31\n面积：120㎡\n单价：2.80元/㎡/天\n月租金：10,220元\n支付方式：季付\n押金：30,660元\n免租期：2026-04-01至2026-05-31 装修免租\n\nAI 会自动识别并提取关键信息`}
                className="w-full h-48 p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none bg-white"
              />
            )}

            {activeTab === 'excel' && (
              <div>
                {!excelFileName ? (
                  <div onClick={() => excelInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all">
                    <FileSpreadsheet size={40} className="mx-auto text-slate-400 mb-3" />
                    <p className="text-sm text-slate-600 font-medium">点击上传合同信息 Excel</p>
                    <p className="text-xs text-slate-400 mt-1">支持 .xls / .xlsx 格式</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 bg-white rounded-lg border border-slate-200 p-3">
                      <FileSpreadsheet size={20} className="text-blue-600" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-700">{excelFileName}</p>
                        <p className="text-xs text-slate-400">{excelData.length} 行数据</p>
                      </div>
                      <button onClick={() => { setExcelFileName(''); setExcelData([]); if (excelInputRef.current) excelInputRef.current.value = ''; }}
                        className="p-1 text-red-500 hover:bg-red-50 rounded"><X size={16} /></button>
                    </div>
                  </div>
                )}
                <input ref={excelInputRef} type="file" accept=".xls,.xlsx,.csv" onChange={handleExcelSelect} className="hidden" />
              </div>
            )}
          </div>

          {/* Recognize Button */}
          <div className="flex items-center gap-3">
            <button onClick={handleRecognize} disabled={isLoading}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm disabled:opacity-50">
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              {isLoading ? 'AI 识别中...' : 'AI 智能识别'}
            </button>
            {isLoading && <span className="text-xs text-slate-400">正在调用AI分析合同信息，请稍候...</span>}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
              <AlertCircle size={16} />{error}
            </div>
          )}

          {/* Recognized Results - Editable Form */}
          {recognized && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <CheckCircle size={16} className="text-blue-600" /> AI 识别结果 — 请确认并修改
              </h3>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
                {/* 基本信息 */}
                <div>
                  <div className="text-xs font-bold text-blue-600 mb-3 uppercase tracking-wider">核心签约信息</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">企业名称</label>
                      <input value={editData.name || ''} onChange={e => setEditData({ ...editData, name: e.target.value })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">所属楼宇</label>
                      <select value={matchedBuildingId} onChange={e => handleBuildingChange(e.target.value)}
                        className={`w-full p-2 border rounded-lg text-sm ${matchedBuildingId ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
                        <option value="">-- 请选择楼宇 --</option>
                        {buildings.map(b => <option key={b.id} value={b.id}>{b.name}{b.type === 'Site' ? ' (场地)' : ''}</option>)}
                      </select>
                      {editData.buildingName && !matchedBuildingId && (
                        <span className="text-[10px] text-amber-600 mt-0.5 block">AI识别"{editData.buildingName}"未匹配，请手动选择</span>
                      )}
                    </div>
                  </div>

                  {/* 房号匹配 */}
                  {selectedBuilding && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        租赁房号
                        {editData.unitNames && editData.unitNames.length > 0 && (
                          <span className="text-blue-500 ml-2">AI识别: {editData.unitNames.join(', ')}</span>
                        )}
                      </label>
                      <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5 bg-slate-50 p-2 rounded-lg border border-slate-200 max-h-32 overflow-y-auto font-mono text-xs">
                        {selectedBuilding.units
                          .filter(u => !u.isSelfUse && (u.status === UnitStatus.Vacant || matchedUnitIds.includes(u.id)))
                          .map(u => (
                            <button key={u.id}
                              onClick={() => {
                                setMatchedUnitIds(prev =>
                                  prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]
                                );
                              }}
                              className={`px-1.5 py-1.5 rounded border transition-all text-center ${matchedUnitIds.includes(u.id) ? 'bg-blue-600 text-white border-blue-600 font-bold' : 'bg-white border-slate-200 hover:border-blue-400'}`}>
                              <div>{u.name}</div>
                              <div className="opacity-70 font-normal text-[10px]">{formatArea(u.area)}</div>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 合同日期 */}
                <div>
                  <div className="text-xs font-bold text-blue-600 mb-3 uppercase tracking-wider">合同期限</div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">签约日期</label>
                      <input type="date" value={editData.signingDate || ''} onChange={e => setEditData({ ...editData, signingDate: e.target.value })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">起租日期</label>
                      <input type="date" value={editData.leaseStart || ''} onChange={e => setEditData({ ...editData, leaseStart: e.target.value })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">结束日期</label>
                      <input type="date" value={editData.leaseEnd || ''} onChange={e => setEditData({ ...editData, leaseEnd: e.target.value })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-emerald-600 mb-1">入驻时间</label>
                      <input type="date" value={editData.moveInDate || ''} onChange={e => setEditData({ ...editData, moveInDate: e.target.value })}
                        className="w-full p-2 border border-emerald-300 rounded-lg text-sm bg-emerald-50/50" />
                    </div>
                  </div>
                </div>

                {/* 租金 */}
                <div>
                  <div className="text-xs font-bold text-emerald-600 mb-3 uppercase tracking-wider">租金与支付</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">面积 (㎡)</label>
                      <input type="number" value={editData.totalArea || ''} onChange={e => setEditData({ ...editData, totalArea: Number(e.target.value) })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">日单价 (元/㎡/天)</label>
                      <input type="number" step="0.01" value={editData.unitPrice || ''} onChange={e => setEditData({ ...editData, unitPrice: Number(e.target.value) })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">月租金 (元)</label>
                      <input type="number" value={editData.monthlyRent || ''} onChange={e => setEditData({ ...editData, monthlyRent: Number(e.target.value) })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">支付频率</label>
                      <select value={editData.paymentCycle || 'Quarterly'} onChange={e => setEditData({ ...editData, paymentCycle: e.target.value })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm">
                        <option value="HalfMonthly">半月付</option>
                        <option value="Monthly">月付</option>
                        <option value="BiMonthly">两月付</option>
                        <option value="Quarterly">季付</option>
                        <option value="SemiAnnual">半年付</option>
                        <option value="Annual">年付</option>
                        <option value="Custom">自定义</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">押金金额 (元)</label>
                      <input type="number" value={editData.depositAmount || ''} onChange={e => setEditData({ ...editData, depositAmount: Number(e.target.value) })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">行业</label>
                      <input value={editData.industry || ''} onChange={e => setEditData({ ...editData, industry: e.target.value })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                  </div>
                </div>

                {/* 免租期 */}
                {(editData.rentFreeStart || editData.rentFreeEnd) && (
                  <div>
                    <div className="text-xs font-bold text-indigo-600 mb-3 uppercase tracking-wider">免租期</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">开始日期</label>
                        <input type="date" value={editData.rentFreeStart || ''} onChange={e => setEditData({ ...editData, rentFreeStart: e.target.value })}
                          className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">结束日期</label>
                        <input type="date" value={editData.rentFreeEnd || ''} onChange={e => setEditData({ ...editData, rentFreeEnd: e.target.value })}
                          className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">说明</label>
                        <input value={editData.rentFreeDesc || ''} onChange={e => setEditData({ ...editData, rentFreeDesc: e.target.value })}
                          className="w-full p-2 border border-slate-200 rounded-lg text-sm" placeholder="如：装修免租" />
                      </div>
                    </div>
                  </div>
                )}

                {/* 联系人 */}
                <div>
                  <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">联系人信息</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">联系人</label>
                      <input value={editData.contactName || ''} onChange={e => setEditData({ ...editData, contactName: e.target.value })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">联系电话</label>
                      <input value={editData.contactInfo || ''} onChange={e => setEditData({ ...editData, contactInfo: e.target.value })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">法人</label>
                      <input value={editData.legalRepName || ''} onChange={e => setEditData({ ...editData, legalRepName: e.target.value })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">成立日期</label>
                      <input type="date" value={editData.foundingDate || ''} onChange={e => setEditData({ ...editData, foundingDate: e.target.value })}
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {recognized && (
          <div className="flex items-center justify-between p-5 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
            <div className="text-sm text-slate-500">
              {editData.name ? (
                <span className="text-blue-600 flex items-center gap-1"><CheckCircle size={14} /> {editData.name}</span>
              ) : (
                <span className="text-amber-600 flex items-center gap-1"><AlertCircle size={14} /> 请至少填写企业名称</span>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 text-sm">取消</button>
              <button onClick={handleImport} disabled={!editData.name}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2 shadow-sm disabled:opacity-50">
                <Check size={16} /> 填入表单并编辑
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
