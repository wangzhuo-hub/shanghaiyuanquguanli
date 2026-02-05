
import React, { useMemo, useState, useEffect } from 'react';
import { Opportunity, OpportunityStage, User, UserRole, Activity, ActivityType, Unit } from '../types';
import { ClipboardCheck, Calendar, Building2, TrendingUp, DollarSign, AreaChart, ChevronRight, Download, Calculator, Search, User as UserIcon, Award, Percent, Target } from 'lucide-react';

interface DealRecordsProps {
  opportunities: Opportunity[];
  units: Unit[];
  users: User[];
  activities: Activity[];
}

export const DealRecords: React.FC<DealRecordsProps> = ({ opportunities, units = [], users = [], activities = [] }) => {
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [searchTerm, setSearchTerm] = useState('');

  const deals = useMemo(() => {
    return opportunities
      .filter(o => o.stage === OpportunityStage.CONTRACT && o.dealParams && o.dealParams.signDate)
      .sort((a, b) => {
        const timeB = new Date(b.dealParams!.signDate).getTime();
        const timeA = new Date(a.dealParams!.signDate).getTime();
        return timeB - timeA;
      });
  }, [opportunities]);

  const availableYears = useMemo(() => {
    const y = deals.map(d => new Date(d.dealParams!.signDate).getFullYear());
    return Array.from(new Set(y)).sort((a, b) => (b as number) - (a as number));
  }, [deals]);

  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, selectedYear]);

  const yearlyStats = useMemo(() => {
    const yearDeals = deals.filter(d => new Date(d.dealParams!.signDate).getFullYear() === selectedYear);
    const totalArea = yearDeals.reduce((sum, d) => sum + (d.dealParams?.finalArea || 0), 0);
    const totalAnnualRent = yearDeals.reduce((sum, d) => sum + ((d.dealParams?.monthlyRent || 0) * 12), 0);
    return { count: yearDeals.length, totalArea, totalAnnualRent };
  }, [deals, selectedYear]);

  const userDealPerformances = useMemo(() => {
    return (users || []).filter(u => u.role === UserRole.USER).map(user => {
        const myYearDeals = deals.filter(d => d.leasingManager === user.name && new Date(d.dealParams!.signDate).getFullYear() === selectedYear);
        const dealsCount = myYearDeals.length;
        const dealsArea = myYearDeals.reduce((sum, d) => sum + (d.dealParams?.finalArea || 0), 0);
        
        const myYearOppsTotal = opportunities.filter(o => o.leasingManager === user.name && new Date(o.createdAt).getFullYear() === selectedYear).length;
        const conversionRate = myYearOppsTotal > 0 ? (dealsCount / myYearOppsTotal) * 100 : 0;

        return { user, dealsCount, dealsArea, conversionRate };
    });
  }, [users, deals, opportunities, selectedYear]);

  /**
   * 高级房号解析逻辑：
   * 1. 优先匹配 ID
   * 2. 匹配失败时尝试 roomNo 模糊匹配
   * 3. 最终失败时清理 ID 前缀（例如处理 b1-304 这种漏掉的编号）
   */
  const getRoomDisplayNames = (unitIds: string[]) => {
    if (!unitIds || unitIds.length === 0) return '未指派房源';
    return unitIds.map(id => {
      // 深度匹配：ID 或直接房号
      let unit = units.find(u => u.id === id);
      if (!unit) unit = units.find(u => u.roomNo === id);
      
      if (unit) return unit.roomNo;

      // 降级清理逻辑：剥离类似 U1-B1-304 的系统路径前缀
      const cleaned = id.split('-').pop();
      return cleaned ? cleaned.toUpperCase() : id;
    }).join(', ');
  };

  const monthlyGrouped = useMemo(() => {
    const filtered = deals.filter(d => {
      const dealDate = new Date(d.dealParams!.signDate);
      const yearMatch = dealDate.getFullYear() === selectedYear;
      const searchMatch = d.companyName.toLowerCase().includes(searchTerm.toLowerCase());
      return yearMatch && searchMatch;
    });

    const groups: { [key: string]: Opportunity[] } = {};
    filtered.forEach(d => {
      const month = new Date(d.dealParams!.signDate).getMonth() + 1;
      const key = `${month}月`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });

    return Object.entries(groups).sort((a, b) => {
        const mA = parseInt(a[0]);
        const mB = parseInt(b[0]);
        return mB - mA;
    });
  }, [deals, selectedYear, searchTerm]);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-3"><ClipboardCheck className="text-indigo-600" /> 园区成交资产台账</h1>
          <p className="text-slate-500 text-xs mt-1 font-bold uppercase tracking-widest opacity-60">Historical Deal Records & Annual Yield Analysis</p>
        </div>
        <div className="flex gap-4">
           <div className="relative">
              <Search className="absolute left-3 top-3 text-slate-400" size={14}/>
              <input 
                type="text" 
                placeholder="搜索成交企业..." 
                className="pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-100 transition-all w-64"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
           </div>
           <select 
             className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-indigo-100 outline-none cursor-pointer hover:bg-slate-800 transition-colors"
             value={selectedYear}
             onChange={e => setSelectedYear(parseInt(e.target.value))}
           >
             {availableYears.length > 0 ? availableYears.map(y => <option key={y} value={y}>{y}年度</option>) : <option value={new Date().getFullYear()}>{new Date().getFullYear()}年度</option>}
           </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex items-center gap-6">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600"><Calculator size={28}/></div>
            <div>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">年度签约总宗数</p>
               <p className="text-3xl font-black text-slate-900 font-mono">{yearlyStats.count} <span className="text-sm font-normal text-slate-400">宗</span></p>
            </div>
         </div>
         <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex items-center gap-6">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600"><AreaChart size={28}/></div>
            <div>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">年度累计去化面积</p>
               <p className="text-3xl font-black text-slate-900 font-mono">{yearlyStats.totalArea.toLocaleString()} <span className="text-sm font-normal text-slate-400">m²</span></p>
            </div>
         </div>
         <div className="bg-indigo-600 p-8 rounded-[2.5rem] shadow-xl shadow-indigo-100 flex items-center gap-6 text-white relative overflow-hidden border border-indigo-500">
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-white relative z-10"><DollarSign size={28}/></div>
            <div className="relative z-10">
               <p className="text-[10px] font-black text-indigo-100 uppercase tracking-widest mb-1">年度租金资产收益</p>
               <p className="text-3xl font-black font-mono">¥ {yearlyStats.totalAnnualRent.toLocaleString()}</p>
            </div>
            <TrendingUp size={100} className="absolute -right-4 -bottom-4 text-white/5 rotate-12" />
         </div>
      </div>

      {/* 招商经理年度签约及转化卡片组 */}
      <div className="flex gap-4 overflow-x-auto pb-4 px-1 custom-scrollbar">
          {userDealPerformances.map(perf => (
            <div key={perf.user.id} className={`min-w-[340px] bg-white rounded-[2rem] border p-8 flex flex-col gap-6 transition-all ${perf.conversionRate > 10 ? 'border-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.05)] bg-emerald-50/5' : 'border-slate-200 shadow-sm'}`}>
                <div className="flex justify-between items-start">
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-sm shadow-lg ${perf.conversionRate > 10 ? 'bg-emerald-600' : 'bg-slate-900'}`}>{perf.user.name[0]}</div>
                        <div>
                            <h4 className="font-black text-slate-900 text-lg tracking-tight">{perf.user.name}</h4>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Leasing Elite</span>
                                {perf.conversionRate > 10 && <Award size={10} className="text-emerald-500"/>}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">签约宗数</span>
                        <span className="text-2xl font-black text-slate-900 font-mono tracking-tighter">{perf.dealsCount}</span>
                    </div>
                </div>
                
                <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-100">
                    <div className="space-y-1">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">累计成交面积</p>
                        <p className="text-xl font-black text-slate-800 font-mono tracking-tighter">{perf.dealsArea.toLocaleString()} <span className="text-xs font-normal opacity-40">m²</span></p>
                    </div>
                    <div className="space-y-1">
                        <p className={`text-[9px] font-black uppercase tracking-widest ${perf.conversionRate > 10 ? 'text-emerald-600' : 'text-indigo-600'}`}>商机转化率</p>
                        <div className="flex items-baseline gap-1">
                            <Percent size={14} className={perf.conversionRate > 10 ? 'text-emerald-500' : 'text-indigo-500'}/>
                            <p className={`text-xl font-black font-mono tracking-tighter ${perf.conversionRate > 10 ? 'text-emerald-700' : 'text-indigo-700'}`}>{perf.conversionRate.toFixed(1)}%</p>
                        </div>
                    </div>
                </div>
            </div>
          ))}
      </div>

      <div className="space-y-12">
        {monthlyGrouped.map(([month, monthDeals]) => (
          <section key={month} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex items-center gap-4 mb-6">
                <div className="h-px flex-1 bg-slate-100"></div>
                <h3 className="bg-slate-100 text-slate-500 px-6 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em]">{month} 成交明细</h3>
                <div className="h-px flex-1 bg-slate-100"></div>
             </div>
             
             <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                   <thead className="bg-slate-50 border-b text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      <tr>
                         <th className="px-8 py-5">签约日期</th>
                         <th className="px-8 py-5">成交企业</th>
                         <th className="px-8 py-5">房源落位</th>
                         <th className="px-8 py-5">面积 (m²)</th>
                         <th className="px-8 py-5">成交单价</th>
                         <th className="px-8 py-5 text-right">年度收益 (CNY)</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-50">
                      {monthDeals.map(deal => (
                         <tr key={deal.id} className="group hover:bg-slate-50/50 transition-colors">
                            <td className="px-8 py-6 text-xs font-bold text-slate-400 font-mono">{deal.dealParams?.signDate || '-'}</td>
                            <td className="px-8 py-6 font-black text-slate-800 text-sm">{deal.companyName}</td>
                            <td className="px-8 py-6">
                               <div className="flex items-center gap-2">
                                  <Building2 size={12} className="text-indigo-400"/>
                                  <span className="text-xs font-bold text-slate-500">
                                    {deal.dealParams?.buildingName} : <span className="text-slate-900 font-black">{getRoomDisplayNames(deal.dealParams?.unitIds || [])}</span>
                                  </span>
                               </div>
                            </td>
                            <td className="px-8 py-6 font-black text-slate-700 font-mono">{deal.dealParams?.finalArea}</td>
                            <td className="px-8 py-6">
                               <div className="text-xs font-bold text-indigo-600">¥ {deal.dealParams?.finalPrice} <span className="text-[10px] text-slate-300 font-normal">/㎡/天</span></div>
                            </td>
                            <td className="px-8 py-6 text-right font-black text-slate-900 font-mono">
                               ¥ {((deal.dealParams?.monthlyRent || 0) * 12).toLocaleString()}
                            </td>
                         </tr>
                      ))}
                   </tbody>
                </table>
             </div>
          </section>
        ))}

        {monthlyGrouped.length === 0 && (
           <div className="py-20 flex flex-col items-center justify-center text-slate-300">
              <ClipboardCheck size={64} className="opacity-20 mb-4"/>
              <p className="text-xs font-black uppercase tracking-widest italic">该年度尚未录入成交落位记录</p>
           </div>
        )}
      </div>
    </div>
  );
};
