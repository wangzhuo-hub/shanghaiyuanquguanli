
import React, { useMemo, useState } from 'react';
import { Commission, CommissionStatus, Channel, Opportunity, UserRole } from '../types';
import { HandCoins, DollarSign, Calculator, Search, Filter, ArrowRight, Building2, User, Clock, CheckCircle2, MoreVertical, X, Save, Download, Calendar } from 'lucide-react';

interface CommissionLedgerProps {
  commissions: Commission[];
  channels: Channel[];
  opportunities: Opportunity[];
  onUpdateCommission: (commission: Commission) => void;
  isAdmin: boolean;
}

export const CommissionLedger: React.FC<CommissionLedgerProps> = ({ commissions, channels, opportunities, onUpdateCommission, isAdmin }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingComm, setEditingComm] = useState<Partial<Commission> | null>(null);

  const unpaidCommissions = useMemo(() => {
    return commissions.filter(c => c.status !== CommissionStatus.PAID);
  }, [commissions]);

  const filteredCommissions = useMemo(() => {
    return unpaidCommissions.filter(c => {
      const opp = opportunities.find(o => o.id === c.contractId);
      const chan = channels.find(ch => ch.id === c.channelId);
      const searchStr = `${opp?.companyName || ''} ${chan?.companyName || ''} ${c.roomNumber}`.toLowerCase();
      return searchStr.includes(searchTerm.toLowerCase());
    }).sort((a, b) => new Date(a.plannedPayoutDate).getTime() - new Date(b.plannedPayoutDate).getTime());
  }, [unpaidCommissions, opportunities, channels, searchTerm]);

  const stats = useMemo(() => {
    const totalAmount = unpaidCommissions.reduce((sum, c) => sum + c.amount, 0);
    const count = unpaidCommissions.length;
    return { totalAmount, count };
  }, [unpaidCommissions]);

  const handleSaveUpdate = () => {
    if (editingComm) {
      onUpdateCommission(editingComm as Commission);
      setIsEditModalOpen(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-3"><HandCoins className="text-indigo-600" /> 待结佣金监控看板</h1>
          <p className="text-slate-500 text-xs mt-1 font-bold uppercase tracking-widest opacity-60">Global Unpaid Commission & Installments Tracker</p>
        </div>
        <div className="flex gap-4">
           <div className="relative">
              <Search className="absolute left-3 top-3 text-slate-400" size={14}/>
              <input 
                type="text" 
                placeholder="搜索企业、渠道或房号..." 
                className="pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-100 transition-all w-64"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="bg-rose-50 p-8 rounded-[2.5rem] border border-rose-100 flex items-center gap-6 group hover:shadow-lg transition-all">
            <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-rose-600 shadow-sm"><DollarSign size={28}/></div>
            <div>
               <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1">当前待付总金额</p>
               <p className="text-3xl font-black text-rose-700 font-mono">¥ {stats.totalAmount.toLocaleString()}</p>
            </div>
         </div>
         <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex items-center gap-6">
            <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400"><Calculator size={28}/></div>
            <div>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">待支付节点总数</p>
               <p className="text-3xl font-black text-slate-900 font-mono">{stats.count} <span className="text-sm font-normal text-slate-400">Nodes</span></p>
            </div>
         </div>
         <div className="bg-indigo-600 p-8 rounded-[2.5rem] shadow-xl text-white relative overflow-hidden">
            <div className="relative z-10">
               <p className="text-[10px] font-black text-indigo-100 uppercase tracking-widest mb-1">结算状态监控</p>
               <p className="text-3xl font-black">分期逻辑正常</p>
            </div>
            <Clock size={100} className="absolute -right-4 -bottom-4 text-white/5 rotate-12" />
         </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-50/50 px-8 py-5 border-b flex justify-between items-center">
            <h3 className="font-black text-slate-800 flex items-center gap-2 text-xs uppercase tracking-widest"><Filter size={14} className="text-indigo-600"/> 待办发放流水明细</h3>
            <span className="text-[10px] font-black bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full border border-indigo-100">自动拆分为分期记录</span>
        </div>
        <table className="w-full text-left">
           <thead className="bg-slate-50 border-b text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <tr>
                 <th className="px-8 py-5">计划发放日期</th>
                 <th className="px-8 py-5">成交客户</th>
                 <th className="px-8 py-5">节点/分期</th>
                 <th className="px-8 py-5">推荐渠道</th>
                 <th className="px-8 py-5">金额 (CNY)</th>
                 <th className="px-8 py-5">财务阶段</th>
                 <th className="px-8 py-5 text-right">操作</th>
              </tr>
           </thead>
           <tbody className="divide-y divide-slate-50">
              {filteredCommissions.map(c => {
                 const opp = opportunities.find(o => o.id === c.contractId);
                 const chan = channels.find(ch => ch.id === c.channelId);
                 const isComingSoon = new Date(c.plannedPayoutDate).getTime() < (new Date().getTime() + 7*86400000);
                 
                 return (
                    <tr key={c.id} className={`group hover:bg-slate-50/50 transition-colors animate-in fade-in slide-in-from-left-2 ${isComingSoon ? 'bg-amber-50/30' : ''}`}>
                       <td className="px-8 py-6">
                          <div className="flex items-center gap-2">
                             <Calendar size={12} className={isComingSoon ? 'text-amber-500' : 'text-slate-300'}/>
                             <span className={`text-xs font-black font-mono ${isComingSoon ? 'text-amber-600' : 'text-slate-400'}`}>{c.plannedPayoutDate}</span>
                          </div>
                       </td>
                       <td className="px-8 py-6">
                          <div className="flex flex-col">
                             <span className="font-black text-slate-800 text-sm">{opp?.companyName || '未知企业'}</span>
                             <span className="text-[10px] text-slate-400 font-bold">{c.roomNumber}</span>
                          </div>
                       </td>
                       <td className="px-8 py-6">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border tracking-tighter ${c.installmentLabel === '一次性' ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
                            {c.installmentLabel}
                          </span>
                       </td>
                       <td className="px-8 py-6">
                          <div className="flex items-center gap-2">
                             <div className="w-6 h-6 rounded-lg bg-slate-900 flex items-center justify-center text-[10px] text-white font-black">{chan?.companyName[0] || '直'}</div>
                             <span className="text-xs font-black text-slate-600 truncate max-w-[120px]">{chan?.companyName || '直接拜访'}</span>
                          </div>
                       </td>
                       <td className="px-8 py-6 font-black text-indigo-600 font-mono text-sm">¥ {c.amount.toLocaleString()}</td>
                       <td className="px-8 py-6">
                          <span className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase border tracking-widest ${
                            c.status === CommissionStatus.APPROVING ? 'bg-amber-50 text-amber-600 border-amber-100' :
                            c.status === CommissionStatus.PAYABLE ? 'bg-indigo-50 text-indigo-600 border-indigo-100 animate-pulse' :
                            'bg-slate-50 text-slate-400 border-slate-100'
                          }`}>
                             {c.status}
                          </span>
                       </td>
                       <td className="px-8 py-6 text-right">
                          {isAdmin && (
                             <button onClick={() => { setEditingComm({ ...c }); setIsEditModalOpen(true); }} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-xl transition-all"><MoreVertical size={16}/></button>
                          )}
                       </td>
                    </tr>
                 );
              })}
           </tbody>
        </table>
        {filteredCommissions.length === 0 && (
           <div className="py-20 flex flex-col items-center justify-center text-slate-300">
              <CheckCircle2 size={64} className="opacity-20 mb-4 text-emerald-500"/>
              <p className="text-xs font-black uppercase tracking-widest italic">当前没有任何待结佣金项，财务极其健康</p>
           </div>
        )}
      </div>

      {isEditModalOpen && editingComm && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white p-10 rounded-[3rem] w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-10">
                   <h2 className="text-xl font-black text-slate-900 flex items-center gap-3"><DollarSign size={28} className="text-indigo-600"/> 财务分期流水变更</h2>
                   <button onClick={()=>setIsEditModalOpen(false)} className="text-slate-400"><X className="text-slate-400"/></button>
                </div>
                <div className="space-y-8">
                    <div>
                       <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">当期实结金额 (CNY)</label>
                       <input type="number" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-black outline-none focus:ring-4 focus:ring-indigo-50" value={editingComm.amount} onChange={e=>setEditingComm({...editingComm, amount:Number(e.target.value)})}/>
                    </div>
                    <div>
                       <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">支付状态</label>
                       <select className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-black bg-white outline-none" value={editingComm.status} onChange={e=>setEditingComm({...editingComm, status:e.target.value as CommissionStatus})}>
                          {Object.values(CommissionStatus).map(s=><option key={s} value={s}>{s}</option>)}
                       </select>
                    </div>
                    <div>
                       <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">计划/实际 支付日期</label>
                       <input type="date" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-black bg-white outline-none" value={editingComm.plannedPayoutDate} onChange={e=>setEditingComm({...editingComm, plannedPayoutDate:e.target.value})} />
                    </div>
                </div>
                <div className="mt-12 flex justify-end gap-4">
                   <button onClick={()=>setIsEditModalOpen(false)} className="px-6 py-2 text-slate-400 font-bold uppercase text-[10px] tracking-widest">取消</button>
                   <button onClick={handleSaveUpdate} className="bg-indigo-600 text-white px-10 py-3 rounded-2xl font-black shadow-xl shadow-indigo-100 flex items-center gap-2">
                      <Save size={16}/> 保存更新记录
                   </button>
                </div>
            </div>
          </div>
      )}
    </div>
  );
};
