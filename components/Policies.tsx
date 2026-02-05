
import React, { useState, useMemo } from 'react';
import { CommissionRule, PolicyChangeLog, PayoutInstallment } from '../types';
import { Plus, Trash2, Edit3, History, Save, Calendar, CheckCircle, Clock, ArrowRight, X, AlertCircle, ToggleLeft, ToggleRight, Power, Layers, Timer, Milestone } from 'lucide-react';

interface PoliciesProps {
  isAdmin: boolean;
  currentRules: CommissionRule[];
  history: PolicyChangeLog[];
  onUpdateRules: (rules: CommissionRule[], log: PolicyChangeLog) => void;
  onUpdateHistory: (history: PolicyChangeLog[]) => void;
}

export const Policies: React.FC<PoliciesProps> = ({ isAdmin, currentRules, history, onUpdateRules, onUpdateHistory }) => {
  const [activeTab, setActiveTab] = useState<'rules' | 'history'>('rules');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Partial<CommissionRule> | null>(null);
  
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [editingHistoryText, setEditingHistoryText] = useState('');

  const handleOpenEdit = (rule?: CommissionRule) => {
    if (!isAdmin) return;
    setEditingRule(rule ? { ...rule } : { 
      id: `R-${Date.now()}`, 
      label: '', 
      minArea: 0, 
      maxArea: 1000, 
      rate: 1.0, 
      startDate: new Date().toISOString().slice(0, 10), 
      endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
      isActive: true,
      payoutType: 'ONETIME',
      installments: []
    });
    setIsEditModalOpen(true);
  };

  const handleSaveRule = () => {
    if (!editingRule || !editingRule.label) return;
    
    // 校验分期比例之和
    if (editingRule.payoutType === 'STAGED') {
      const sum = (editingRule.installments || []).reduce((s, i) => s + i.percentage, 0);
      if (sum !== 100) {
        alert("分期计划总比例必须等于 100%");
        return;
      }
    }

    const rule = editingRule as CommissionRule;
    const isNew = !currentRules.some(r => r.id === rule.id);
    
    const newRules = isNew 
        ? [...currentRules, rule]
        : currentRules.map(r => r.id === rule.id ? rule : r);
    
    const log: PolicyChangeLog = {
        id: `LOG-${Date.now()}`,
        timestamp: new Date().toISOString(),
        ruleId: rule.id,
        ruleLabel: rule.label,
        changeType: isNew ? 'CREATE' : 'UPDATE',
        description: isNew ? `创建新政策: ${rule.label} (${rule.payoutType === 'ONETIME' ? '一次性' : '分期'})` : `更新政策参数: ${rule.label}`,
        newValue: JSON.stringify(rule)
    };

    onUpdateRules(newRules, log);
    setIsEditModalOpen(false);
  };

  const addInstallment = () => {
    const newInst: PayoutInstallment = { id: `inst-${Date.now()}`, percentage: 0, triggerMonth: 0, label: '' };
    setEditingRule(prev => ({
      ...prev!,
      installments: [...(prev!.installments || []), newInst]
    }));
  };

  const removeInstallment = (id: string) => {
    setEditingRule(prev => ({
      ...prev!,
      installments: (prev!.installments || []).filter(i => i.id !== id)
    }));
  };

  const updateInstallment = (id: string, updates: Partial<PayoutInstallment>) => {
    setEditingRule(prev => ({
      ...prev!,
      installments: (prev!.installments || []).map(i => i.id === id ? { ...i, ...updates } : i)
    }));
  };

  const handleToggleActive = (rule: CommissionRule) => {
    if (!isAdmin) return;
    const updatedRule = { ...rule, isActive: !rule.isActive };
    const newRules = currentRules.map(r => r.id === rule.id ? updatedRule : r);
    
    const log: PolicyChangeLog = {
        id: `LOG-${Date.now()}`,
        timestamp: new Date().toISOString(),
        ruleId: rule.id,
        ruleLabel: rule.label,
        changeType: 'UPDATE',
        description: `${updatedRule.isActive ? '启用' : '禁用'}了政策方案: ${rule.label}`,
        previousValue: rule.isActive ? '生效中' : '已失效',
        newValue: updatedRule.isActive ? '生效中' : '已失效'
    };

    onUpdateRules(newRules, log);
  };

  const handleDeleteRule = (id: string) => {
    if (!isAdmin) return;
    const rule = currentRules.find(r => r.id === id);
    if (!rule || !confirm(`确定删除政策 [${rule.label}] 吗？`)) return;
    
    const newRules = currentRules.filter(r => r.id !== id);
    const log: PolicyChangeLog = {
        id: `LOG-${Date.now()}`,
        timestamp: new Date().toISOString(),
        ruleId: id,
        ruleLabel: rule.label,
        changeType: 'DELETE',
        description: `删除了政策: ${rule.label}`
    };
    onUpdateRules(newRules, log);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 uppercase tracking-tight">园区佣金结算政策</h1>
          <p className="text-slate-500 text-sm font-medium mt-1">管理全生命周期的激励方案与历史变动记录</p>
        </div>
        <div className="flex bg-slate-100 rounded-2xl p-1.5 border border-slate-200 shadow-inner">
            <button onClick={() => setActiveTab('rules')} className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${activeTab === 'rules' ? 'bg-white text-indigo-600 shadow-md border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}>当前方案</button>
            <button onClick={() => setActiveTab('history')} className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${activeTab === 'history' ? 'bg-white text-indigo-600 shadow-md border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}>变更记录</button>
        </div>
      </div>

      {activeTab === 'rules' ? (
        <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
            <div className="flex justify-between items-center mb-4">
                <div className="bg-indigo-50/50 border border-indigo-100 text-indigo-800 text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-2xl flex items-center gap-2">
                    <AlertCircle size={14} className="text-indigo-600"/>
                    <span>匹配规则：系统根据成交面积段自动应用对应的生效政策。支持一次性发放及阶梯分期模式。</span>
                </div>
                {isAdmin && (
                    <button onClick={() => handleOpenEdit()} className="bg-indigo-600 text-white px-6 py-3 rounded-2xl text-xs font-black flex items-center gap-2 shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95">
                        <Plus size={16}/> 新增激励方案
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-10">
                {currentRules.map(rule => {
                    const isExpired = new Date(rule.endDate) < new Date();
                    const isActive = rule.isActive;
                    
                    return (
                        <div key={rule.id} className={`bg-white border-2 rounded-[2rem] p-8 shadow-sm transition-all relative overflow-hidden flex flex-col justify-between group ${!isActive ? 'opacity-60 grayscale border-slate-100 bg-slate-50/50' : 'border-slate-100 hover:shadow-2xl hover:shadow-indigo-500/5 hover:-translate-y-1'}`}>
                            {isExpired && isActive && <div className="absolute top-0 right-0 bg-rose-500 text-white text-[9px] px-3 py-1 rounded-bl-2xl font-black uppercase tracking-widest">已过期</div>}
                            {!isActive && <div className="absolute top-0 right-0 bg-slate-400 text-white text-[9px] px-3 py-1 rounded-bl-2xl font-black uppercase tracking-widest">未生效</div>}
                            
                            <div>
                                <div className="flex justify-between items-start mb-6">
                                    <div>
                                      <h3 className="font-black text-slate-900 text-lg tracking-tight">{rule.label}</h3>
                                      <div className="flex items-center gap-2 mt-1">
                                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${rule.payoutType === 'ONETIME' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
                                          {rule.payoutType === 'ONETIME' ? '一次性全额' : '分期发放计划'}
                                        </span>
                                      </div>
                                    </div>
                                    {isAdmin && (
                                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleOpenEdit(rule)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"><Edit3 size={16}/></button>
                                            <button onClick={() => handleDeleteRule(rule.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><Trash2 size={16}/></button>
                                        </div>
                                    )}
                                </div>
                                
                                <div className="space-y-4 mb-8">
                                    <div className="flex items-center gap-3 text-[11px] font-bold">
                                        <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center border border-slate-200"><Calendar size={14}/></div>
                                        <span className="text-slate-500 font-mono">{rule.startDate} 至 {rule.endDate}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-[11px] font-bold">
                                        <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 font-black">㎡</div>
                                        <span className="text-slate-800 font-mono tracking-tight">{rule.minArea} - {rule.maxArea} ㎡</span>
                                    </div>
                                </div>

                                {rule.payoutType === 'STAGED' && (
                                  <div className="mb-8 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">分期节奏预览</p>
                                    <div className="space-y-3">
                                      {(rule.installments || []).map((inst, idx) => (
                                        <div key={inst.id} className="flex items-center justify-between">
                                           <div className="flex items-center gap-2">
                                              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400"></div>
                                              <span className="text-[10px] font-bold text-slate-600">{inst.label || `节点 ${idx+1}`}</span>
                                           </div>
                                           <span className="text-[10px] font-black text-indigo-600">{inst.percentage}% <span className="text-slate-400 font-normal">({inst.triggerMonth === 0 ? '签约即付' : `${inst.triggerMonth}月后`})</span></span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                            </div>

                            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 flex justify-between items-center group-hover:bg-white transition-colors">
                                <div>
                                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1.5">佣金基数比例</p>
                                    <p className="text-3xl font-black text-indigo-600 tracking-tighter">{rule.rate} <span className="text-xs font-bold text-slate-400">个月</span></p>
                                </div>
                                {isAdmin && (
                                    <div className="flex flex-col items-end gap-3">
                                      <button 
                                          onClick={() => handleToggleActive(rule)}
                                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isActive ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-white text-slate-400 border border-slate-200 shadow-sm'}`}
                                      >
                                          <Power size={12}/>
                                          {isActive ? '生效中' : '已失效'}
                                      </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
      ) : (
        <div className="bg-white border-2 border-slate-100 rounded-[2.5rem] flex-1 flex flex-col overflow-hidden shadow-sm">
            <div className="bg-slate-50/80 border-b p-6 flex justify-between items-center">
                <h3 className="font-black text-slate-800 flex items-center gap-3 text-sm uppercase tracking-widest"><History size={20} className="text-indigo-600"/> 政策变更全量日志 (AUDIT LOGS)</h3>
                <span className="text-[10px] font-black bg-white px-3 py-1 rounded-full border text-slate-400">TOTAL: {history.length} RECORDS</span>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                {history.map(log => (
                    <div key={log.id} className="border-l-4 border-indigo-100 pl-6 py-2 group relative">
                        <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono font-bold mb-2">
                            <span className="tracking-tighter">{new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-3 mb-2">
                            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest text-white shadow-sm ${log.changeType === 'CREATE' ? 'bg-emerald-500' : log.changeType === 'EXTEND' ? 'bg-indigo-500' : 'bg-amber-500'}`}>{log.changeType}</span>
                            <span className="font-black text-slate-800 text-sm tracking-tight">方案：{log.ruleLabel}</span>
                        </div>
                        <p className="text-slate-500 text-xs font-medium leading-relaxed max-w-2xl">{log.description}</p>
                    </div>
                ))}
            </div>
        </div>
      )}

      {isEditModalOpen && editingRule && isAdmin && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white p-12 rounded-[3.5rem] w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden flex flex-col h-[90vh]">
                <div className="flex justify-between items-center mb-10 shrink-0">
                    <h3 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-3"><Layers className="text-indigo-600" size={28}/> 激励方案核心配置</h3>
                    <button onClick={() => setIsEditModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"><X size={32}/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-10">
                    <section className="space-y-6">
                      <div className="flex items-center gap-2 text-xs font-black text-slate-900 uppercase tracking-widest border-b pb-2"><Edit3 size={14} className="text-indigo-600"/> 基本面定义</div>
                      <div className="space-y-6">
                          <div>
                              <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">方案官方名称 *</label>
                              <input className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-black outline-none focus:ring-4 focus:ring-indigo-50 focus:border-indigo-500 transition-all" value={editingRule.label} onChange={e=>setEditingRule({...editingRule, label:e.target.value})} placeholder="例如: 2024Q4大户激励特惠"/>
                          </div>
                          <div className="grid grid-cols-2 gap-8">
                              <div>
                                  <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">门槛面积 (㎡)</label>
                                  <input type="number" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-black outline-none focus:ring-4 focus:ring-indigo-50" value={editingRule.minArea} onChange={e=>setEditingRule({...editingRule, minArea:Number(e.target.value)})}/>
                              </div>
                              <div>
                                  <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">封顶面积 (㎡)</label>
                                  <input type="number" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-black outline-none focus:ring-4 focus:ring-indigo-50" value={editingRule.maxArea} onChange={e=>setEditingRule({...editingRule, maxArea:Number(e.target.value)})}/>
                              </div>
                          </div>
                          <div className="grid grid-cols-2 gap-8">
                              <div>
                                  <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">生效起始日</label>
                                  <input type="date" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-black outline-none focus:ring-4 focus:ring-indigo-50" value={editingRule.startDate} onChange={e=>setEditingRule({...editingRule, startDate:e.target.value})}/>
                              </div>
                              <div>
                                  <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">生效截止日</label>
                                  <input type="date" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-black outline-none focus:ring-4 focus:ring-indigo-50" value={editingRule.endDate} onChange={e=>setEditingRule({...editingRule, endDate:e.target.value})}/>
                              </div>
                          </div>
                      </div>
                    </section>

                    <section className="space-y-6">
                        <div className="flex items-center gap-2 text-xs font-black text-slate-900 uppercase tracking-widest border-b pb-2"><HandCoins size={14} className="text-indigo-600"/> 结算与发放节奏</div>
                        
                        <div className="grid grid-cols-2 gap-8">
                           <div>
                              <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">佣金基数 (个月租金)</label>
                              <div className="relative">
                                <input type="number" step="0.1" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-xl font-black text-indigo-600 outline-none focus:ring-4 focus:ring-indigo-50" value={editingRule.rate} onChange={e=>setEditingRule({...editingRule, rate:Number(e.target.value)})}/>
                                <span className="absolute right-6 top-1/2 -translate-y-1/2 text-xs font-black text-slate-300 uppercase">Months</span>
                              </div>
                           </div>
                           <div>
                              <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">发放模式</label>
                              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2 rounded-2xl border-2 border-slate-100">
                                 <button onClick={()=>setEditingRule({...editingRule, payoutType:'ONETIME', installments:[]})} className={`py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${editingRule.payoutType === 'ONETIME' ? 'bg-white text-indigo-600 shadow-sm border border-slate-100' : 'text-slate-400'}`}>一次性发放</button>
                                 <button onClick={()=>setEditingRule({...editingRule, payoutType:'STAGED'})} className={`py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${editingRule.payoutType === 'STAGED' ? 'bg-white text-indigo-600 shadow-sm border border-slate-100' : 'text-slate-400'}`}>多次分期</button>
                              </div>
                           </div>
                        </div>

                        {editingRule.payoutType === 'STAGED' && (
                          <div className="bg-indigo-50/50 p-8 rounded-3xl border border-indigo-100 space-y-6 animate-in slide-in-from-top-4">
                             <div className="flex justify-between items-center">
                                <h4 className="text-[11px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-2"><Timer size={14}/> 分期发放时间轴定义</h4>
                                <button onClick={addInstallment} className="flex items-center gap-1.5 text-[10px] font-black text-indigo-700 bg-white px-3 py-1.5 rounded-lg border border-indigo-100 hover:bg-indigo-700 hover:text-white transition-all"><Plus size={12}/> 添加发放节点</button>
                             </div>
                             
                             <div className="space-y-4">
                                {(editingRule.installments || []).map((inst, idx) => (
                                  <div key={inst.id} className="bg-white p-5 rounded-2xl border border-indigo-100 flex items-center gap-6 shadow-sm group">
                                     <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-black text-xs shrink-0">{idx+1}</div>
                                     <div className="flex-1 grid grid-cols-3 gap-6">
                                        <div>
                                           <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5">节点标签</label>
                                           <input className="w-full border border-slate-100 rounded-lg p-2 text-xs font-bold bg-slate-50 focus:bg-white" value={inst.label} onChange={e=>updateInstallment(inst.id, {label:e.target.value})} placeholder="如：首笔发放在即" />
                                        </div>
                                        <div>
                                           <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5">分配比例 (%)</label>
                                           <div className="relative">
                                              <input type="number" className="w-full border border-slate-100 rounded-lg p-2 text-xs font-black bg-slate-50 focus:bg-white" value={inst.percentage} onChange={e=>updateInstallment(inst.id, {percentage:Number(e.target.value)})} />
                                              <span className="absolute right-2 top-2 text-[10px] font-black text-slate-300">%</span>
                                           </div>
                                        </div>
                                        <div>
                                           <label className="block text-[9px] font-black text-slate-400 uppercase mb-1.5">发放时间 (签约后X月)</label>
                                           <div className="relative">
                                              <input type="number" className="w-full border border-slate-100 rounded-lg p-2 text-xs font-black bg-slate-50 focus:bg-white" value={inst.triggerMonth} onChange={e=>updateInstallment(inst.id, {triggerMonth:Number(e.target.value)})} />
                                              <span className="absolute right-2 top-2 text-[10px] font-black text-slate-300">Mon.</span>
                                           </div>
                                        </div>
                                     </div>
                                     <button onClick={()=>removeInstallment(inst.id)} className="p-2 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 size={16}/></button>
                                  </div>
                                ))}
                             </div>
                             
                             <div className="flex items-center gap-3 p-4 bg-white/40 rounded-2xl border border-dashed border-indigo-200">
                                <Milestone size={18} className="text-indigo-400"/>
                                <p className="text-[10px] font-bold text-indigo-600/60 leading-relaxed">
                                   累计比例合计：<span className={`font-black text-xs ${(editingRule.installments || []).reduce((s,i)=>s+i.percentage, 0) === 100 ? 'text-emerald-600' : 'text-rose-500'}`}>{(editingRule.installments || []).reduce((s,i)=>s+i.percentage, 0)}%</span> / 100% 
                                   <span className="ml-4 opacity-50">发放节点数：{(editingRule.installments || []).length} 个</span>
                                </p>
                             </div>
                          </div>
                        )}
                    </section>
                </div>

                <div className="flex justify-end gap-6 mt-10 pt-8 border-t border-slate-50 shrink-0">
                    <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 font-black text-xs uppercase tracking-widest hover:text-slate-800 transition-colors">放弃修改</button>
                    <button onClick={handleSaveRule} className="bg-indigo-600 text-white px-12 py-4 rounded-[2rem] text-xs font-black uppercase tracking-widest shadow-2xl shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95">发布政策方案</button>
                </div>
            </div>
          </div>
      )}
    </div>
  );
};

const HandCoins = ({ className, size }: { className?: string, size?: number }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 10h2a2 2 0 0 1 0 4h-2"/><path d="m13 14 3 3V10l-3 3"/><path d="M4 14.71V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.29c0-1.12-.45-2.19-1.24-2.98L6.98 7.94c-.79-.79-1.86-1.24-2.98-1.24H4V14.71z"/><path d="M8 10h.01"/><path d="M12 2v4"/><path d="M16 4v2"/><path d="M20 6v2"/>
  </svg>
);
