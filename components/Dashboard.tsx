
import React, { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts';
import { Opportunity, Agent, Commission, OpportunityStage, OpportunitySource, Activity, ActivityType, Unit, Channel, CommissionStatus, AppData } from '../types';
import { PieChart as PieChartIcon, Ban, TrendingUp, Medal, Users, Building2, LayoutDashboard, Clock, AlertCircle, Filter, MousePointer2, Calendar, Target, Hash, Inbox, Eye, Flame, Sparkles, X, FileText, Send } from 'lucide-react';
import { calculateUnitHeatStats } from '../services/unitHeatAnalytics';
import { generateWeeklyReport, generateMonthlyReport, generateQuarterlyReport, generateAnnualReport, chatWithAI } from '../services/qwenAI';

interface DashboardProps {
  opportunities: Opportunity[];
  agents: Agent[];
  commissions: Commission[];
  activities: Activity[];
  annualTarget: number;
  onUpdateTarget: (target: number) => void;
  units: Unit[];
  currentData: AppData;
}

const COLORS = ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff'];
const AREA_COLORS = ['#fbbf24', '#818cf8', '#6366f1'];

export const Dashboard: React.FC<DashboardProps> = ({ opportunities = [], units = [], activities = [], agents = [], commissions = [], annualTarget, currentData }) => {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const [viewYear, setViewYear] = useState(currentYear);
  
  // AI助手状态
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'weekly' | 'monthly' | 'quarterly' | 'annual' | 'chat'>('chat');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{role: 'user' | 'assistant', content: string}>>([]);

  // 核心优化：构建合法轨迹集合（仅包含当前存在的商机产生的记录）
  const validActivities = useMemo(() => {
    const validOppIds = new Set(opportunities.map(o => o.id));
    return activities.filter(a => validOppIds.has(a.opportunityId));
  }, [activities, opportunities]);

  // 1. 商机来源占比 (Donut)
  const sourceData = useMemo(() => {
    return Object.values(OpportunitySource).map(source => ({
      name: source,
      value: opportunities.filter(o => o.source === source).length
    })).filter(d => d.value > 0);
  }, [opportunities]);

  // 2. 客户需求面积段占比 (Donut)
  const areaSegmentData = useMemo(() => {
    const segments = [
      { name: '< 300㎡', value: opportunities.filter(o => o.requiredArea < 300).length },
      { name: '300-800㎡', value: opportunities.filter(o => o.requiredArea >= 300 && o.requiredArea <= 800).length },
      { name: '> 800㎡', value: opportunities.filter(o => o.requiredArea > 800).length },
    ];
    return segments.filter(s => s.value > 0);
  }, [opportunities]);

  // 3. 近期商机流失复盘 (List)
  const recentLostOpps = useMemo(() => {
    return opportunities
      .filter(o => o.stage === OpportunityStage.CLOSED_LOST)
      .sort((a, b) => {
        const dateA = a.lossDate ? new Date(a.lossDate).getTime() : 0;
        const dateB = b.lossDate ? new Date(b.lossDate).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 4);
  }, [opportunities]);

  // 4. 新增：房源关注度排行
  const unitHeatRanking = useMemo(() => {
    return calculateUnitHeatStats(units, opportunities, validActivities).slice(0, 10);
  }, [units, opportunities, validActivities]);

  // 4. 本年商机/带看走势（使用 validActivities）
  const trendData = useMemo(() => {
    const data = [];
    for (let m = 0; m < 12; m++) {
      const monthOpps = opportunities.filter(o => {
        const d = new Date(o.createdAt);
        return d.getMonth() === m && d.getFullYear() === viewYear;
      }).length;
      const monthVisits = validActivities.filter(a => {
        const d = new Date(a.date);
        return d.getMonth() === m && d.getFullYear() === viewYear && a.type === ActivityType.VISIT;
      }).length;
      data.push({
        name: `${m + 1}月`,
        opps: monthOpps,
        visits: monthVisits
      });
    }
    return data;
  }, [opportunities, validActivities, viewYear]);

  // 5. 空置房源看板（使用 validActivities）
  const vacantUnitsStats = useMemo(() => {
    return units.filter(u => u.status === '待租').map(u => {
      const vacantDays = u.vacantSince ? Math.floor((Date.now() - new Date(u.vacantSince).getTime()) / 86400000) : 0;
      const visits = validActivities.filter(a => a.type === ActivityType.VISIT && opportunities.find(o => o.id === a.opportunityId)?.targetUnitId === u.id).length;
      return { ...u, vacantDays, visits };
    }).sort((a, b) => b.visits - a.visits);
  }, [units, validActivities, opportunities]);

  const totalVacantArea = useMemo(() => vacantUnitsStats.reduce((sum, u) => sum + u.area, 0), [vacantUnitsStats]);

  // 6. 年度/月度数据计算
  const yearlyArea = opportunities
    .filter(o => o.stage === OpportunityStage.CONTRACT && o.dealParams && new Date(o.dealParams.signDate).getFullYear() === viewYear)
    .reduce((s, o) => s + (o.dealParams?.finalArea || 0), 0);

  const yearOppsCount = opportunities.filter(o => new Date(o.createdAt).getFullYear() === viewYear).length;
  const monthOppsCount = opportunities.filter(o => {
    const d = new Date(o.createdAt);
    return d.getMonth() === currentMonth && d.getFullYear() === viewYear;
  }).length;

  // AI报告生成
  const handleGenerateReport = async (type: 'weekly' | 'monthly' | 'quarterly' | 'annual') => {
    setAiLoading(true);
    setAiReport('');
    setActiveTab(type);
    
    try {
      let report = '';
      switch (type) {
        case 'weekly':
          report = await generateWeeklyReport(currentData);
          break;
        case 'monthly':
          report = await generateMonthlyReport(currentData);
          break;
        case 'quarterly':
          report = await generateQuarterlyReport(currentData);
          break;
        case 'annual':
          report = await generateAnnualReport(currentData);
          break;
      }
      setAiReport(report);
    } catch (error: any) {
      alert('生成报告失败: ' + error.message);
    } finally {
      setAiLoading(false);
    }
  };

  // AI对话
  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    
    const userMessage = chatInput;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
    setAiLoading(true);
    
    try {
      const response = await chatWithAI(userMessage, currentData);
      setChatHistory(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (error: any) {
      alert('AI回复失败: ' + error.message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2"><LayoutDashboard className="text-indigo-600" /> 园区运营总控大屏</h1>
          <p className="text-slate-500 text-xs mt-1 font-medium tracking-tight">Analytical Insights & Strategic Decision Support - {viewYear}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setIsAIModalOpen(true);
              setActiveTab('chat');
              setChatHistory([]);
            }}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 py-2.5 rounded-xl text-sm font-black flex items-center gap-2 shadow-lg shadow-indigo-200 hover:shadow-xl hover:scale-105 transition-all active:scale-95"
          >
            <Sparkles size={18}/> AI 智能助手
          </button>
          <div className="flex gap-1 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 shadow-inner">
             {[currentYear, currentYear - 1, currentYear - 2].map(y => (
               <button 
                 key={y} 
                 onClick={() => setViewYear(y)}
                 className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${viewYear === y ? 'bg-white text-indigo-600 shadow-md border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}
               >
                 {y}年
               </button>
             ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-indigo-600 text-white p-8 rounded-[2.5rem] shadow-xl shadow-indigo-100 relative overflow-hidden group transition-all hover:scale-[1.01]">
          <div className="relative z-10 flex flex-col justify-between h-full">
            <div>
               <h3 className="text-indigo-100 font-black text-[10px] uppercase tracking-widest mb-4">年度累计签约去化 ({viewYear})</h3>
               <div className="flex items-baseline gap-2 mb-8">
                 <span className="text-5xl font-black tracking-tighter">{yearlyArea.toLocaleString()} <span className="text-lg font-normal">m²</span></span>
               </div>
            </div>
            <div className="space-y-3">
               <div className="w-full bg-white/20 rounded-full h-3">
                 <div className="bg-white h-3 rounded-full transition-all duration-1000 shadow-sm" style={{ width: `${Math.min((yearlyArea / (annualTarget || 1)) * 100, 100)}%` }}></div>
               </div>
               <div className="flex justify-between text-[10px] font-black uppercase">
                  <span>目标: {annualTarget.toLocaleString()} m²</span>
                  <span>{((yearlyArea / (annualTarget || 1)) * 100).toFixed(1)}% 完成</span>
               </div>
            </div>
          </div>
          <Building2 size={120} className="absolute -right-8 -bottom-8 text-white/5 rotate-12" />
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <h3 className="text-slate-500 font-black text-[10px] uppercase tracking-widest mb-6 flex items-center gap-2"><Users size={14} className="text-indigo-600"/> 商机总量监控 (LEAD MONITORING)</h3>
          <div className="grid grid-cols-2 gap-6">
             <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 group">
                <p className="text-[10px] text-slate-400 font-black uppercase mb-1">年度累计</p>
                <p className="text-3xl font-black text-slate-900 group-hover:text-indigo-600 transition-colors">{yearOppsCount}</p>
             </div>
             <div className="p-6 bg-indigo-50/50 rounded-3xl border border-indigo-100 group">
                <p className="text-[10px] text-indigo-500 font-black uppercase mb-1">本月新增</p>
                <p className="text-3xl font-black text-indigo-900 group-hover:text-indigo-600 transition-colors">{monthOppsCount}</p>
             </div>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <h3 className="text-slate-500 font-black text-[10px] uppercase tracking-widest mb-6 flex items-center gap-2"><MousePointer2 size={14} className="text-rose-500"/> 带看与转化分析 (VISITS)</h3>
          <div className="grid grid-cols-2 gap-6">
             <div className="p-6 bg-emerald-50/50 rounded-3xl border border-emerald-100 group">
                <p className="text-[10px] text-emerald-600 font-black uppercase mb-1">年度带看总数</p>
                <p className="text-3xl font-black text-emerald-900 group-hover:text-emerald-600 transition-colors">
                  {validActivities.filter(a => a.type === ActivityType.VISIT && new Date(a.date).getFullYear() === viewYear).length}
                </p>
             </div>
             <div className="p-6 bg-rose-50 rounded-3xl border border-rose-100 group">
                <p className="text-[10px] text-rose-500 font-black uppercase mb-1">年度流失商机</p>
                <p className="text-3xl font-black text-rose-900 group-hover:text-rose-600 transition-colors">{opportunities.filter(o=>o.stage === OpportunityStage.CLOSED_LOST && new Date(o.createdAt).getFullYear()===viewYear).length}</p>
             </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
          <div className="flex justify-between items-center mb-10">
            <div>
              <h3 className="font-black text-slate-800 text-sm flex items-center gap-2 uppercase tracking-widest"><TrendingUp size={16} className="text-indigo-600" /> {viewYear} 招商效能走势图 (Monthly Comparison)</h3>
            </div>
            <div className="flex items-center gap-6">
               <div className="flex items-center gap-2 text-[10px] font-black uppercase text-indigo-600">
                  <div className="w-3 h-3 bg-indigo-500 rounded-full shadow-sm shadow-indigo-200"></div> 商机入库
               </div>
               <div className="flex items-center gap-2 text-[10px] font-black uppercase text-emerald-500">
                  <div className="w-3 h-3 bg-emerald-400 rounded-full shadow-sm shadow-emerald-200"></div> 客户带看
               </div>
            </div>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 700 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 700 }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', fontWeight: 'bold' }} 
                  cursor={{ stroke: '#e2e8f0', strokeWidth: 2 }}
                />
                <Line type="monotone" dataKey="opps" stroke="#6366f1" strokeWidth={4} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="visits" stroke="#10b981" strokeWidth={4} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm flex flex-col">
          <h3 className="font-black text-slate-800 text-sm flex items-center gap-2 uppercase tracking-widest mb-6"><Building2 size={16} className="text-indigo-600"/> 待租房源实时分布</h3>
          <div className="mb-6 bg-slate-900 rounded-3xl p-6 text-white shadow-xl">
             <p className="text-[10px] font-black opacity-60 uppercase tracking-widest mb-1">园区待租总面积</p>
             <p className="text-3xl font-black tracking-tight">{totalVacantArea.toLocaleString()} <span className="text-xs font-normal opacity-60">m²</span></p>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[350px] custom-scrollbar">
            {vacantUnitsStats.map(u => (
              <div key={u.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-200 transition-all group hover:bg-white hover:shadow-lg">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-black text-slate-900">{u.building}-{u.roomNo}</span>
                  <span className="text-[10px] text-slate-500 font-mono font-bold">{u.area}㎡</span>
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-slate-200/50">
                  <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 bg-white px-2 py-1 rounded-lg border border-slate-100"><Clock size={10}/> {u.vacantDays}天</div>
                  <div className="flex items-center gap-1.5 text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg"><Users size={10}/> {u.visits}次</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm flex flex-col h-[450px]">
          <h3 className="font-black text-slate-800 text-sm flex items-center gap-2 uppercase tracking-widest mb-8"><PieChartIcon size={16} className="text-indigo-600"/> 商机来源渠道占比</h3>
          <div className="flex-1 min-h-0">
             <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sourceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={95}
                    paddingAngle={6}
                    dataKey="value"
                  >
                    {sourceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontWeight: 'bold' }} />
                  <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', paddingTop: '20px' }} />
                </PieChart>
             </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm flex flex-col h-[450px]">
          <h3 className="font-black text-slate-800 text-sm flex items-center gap-2 uppercase tracking-widest mb-8"><Filter size={16} className="text-indigo-600"/> 客户需求面积段占比</h3>
          <div className="flex-1 min-h-0">
             <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={areaSegmentData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={95}
                    paddingAngle={6}
                    dataKey="value"
                  >
                    {areaSegmentData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={AREA_COLORS[index % AREA_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontWeight: 'bold' }} />
                  <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', paddingTop: '20px' }} />
                </PieChart>
             </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm flex flex-col h-[450px]">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-2 uppercase tracking-widest"><Ban size={16} className="text-rose-500"/> 近期商机流失复盘</h3>
            <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-3 py-1 rounded-full uppercase">Review</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar">
             {recentLostOpps.length > 0 ? recentLostOpps.map(opp => (
                <div key={opp.id} className="p-5 bg-slate-50/50 rounded-2xl border border-slate-100 hover:bg-white hover:shadow-lg transition-all group border-l-4 border-l-rose-100">
                   <div className="flex justify-between items-start mb-2">
                      <h4 className="text-sm font-black text-slate-800 truncate pr-4">{opp.companyName}</h4>
                      <span className="text-[9px] font-black bg-rose-50 text-rose-500 px-2 py-0.5 rounded uppercase tracking-tighter shrink-0 border border-rose-100">流失归档</span>
                   </div>
                   <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold mt-3 border-t border-slate-100 pt-3">
                      <div className="flex items-center gap-1.5"><Target size={10} className="text-slate-300"/> {opp.leasingManager}</div>
                      <div className="font-mono">{opp.lossDate || opp.createdAt.slice(0, 10)}</div>
                   </div>
                   {opp.lossReason && (
                      <p className="text-[10px] text-slate-500 mt-2 italic line-clamp-1 opacity-70">复盘原因：{opp.lossReason}</p>
                   )}
                </div>
             )) : (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-30">
                   <Inbox size={48} className="text-slate-300" />
                   <p className="text-xs font-black uppercase tracking-widest">暂无流失商机复盘数据</p>
                </div>
             )}
          </div>
        </div>

        {/* 新增：房源关注度排行榜 */}
        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm flex flex-col h-[450px]">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-2 uppercase tracking-widest">
              <Flame size={16} className="text-orange-500"/> 房源关注度排行
            </h3>
            <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-3 py-1 rounded-full uppercase">Top 10</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
             {unitHeatRanking.length > 0 ? unitHeatRanking.map((stat, index) => {
               const heat = stat.opportunityCount * 2 + stat.visitCount;
               const maxHeat = unitHeatRanking[0] ? (unitHeatRanking[0].opportunityCount * 2 + unitHeatRanking[0].visitCount) : 1;
               const heatPercent = (heat / maxHeat) * 100;
               
               return (
                 <div key={stat.unitId} className="p-4 bg-gradient-to-r from-orange-50/50 to-transparent rounded-2xl border border-orange-100 hover:from-orange-50 hover:shadow-lg transition-all group">
                   <div className="flex items-center gap-4">
                     <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black ${ 
                       index === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-white shadow-lg' :
                       index === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow-md' :
                       index === 2 ? 'bg-gradient-to-br from-amber-600 to-amber-700 text-white shadow-md' :
                       'bg-slate-100 text-slate-500'
                     }`}>
                       {index + 1}
                     </div>
                     
                     <div className="flex-1 min-w-0">
                       <div className="flex items-center gap-2 mb-1">
                         <h4 className="text-sm font-black text-slate-800">{stat.building}-{stat.roomNo}</h4>
                         <span className="text-[10px] text-slate-400 font-bold">{stat.area}m²</span>
                       </div>
                       
                       <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                         <div 
                           className="h-full bg-gradient-to-r from-orange-400 to-rose-500 rounded-full transition-all duration-500"
                           style={{ width: `${heatPercent}%` }}
                         />
                       </div>
                       
                       <div className="flex items-center gap-4 mt-2">
                         <div className="flex items-center gap-1 text-[10px] font-bold text-indigo-600">
                           <Target size={10}/>
                           {stat.opportunityCount} 商机
                         </div>
                         <div className="flex items-center gap-1 text-[10px] font-bold text-purple-600">
                           <Eye size={10}/>
                           {stat.visitCount} 带看
                         </div>
                       </div>
                       
                       {stat.topConcerns.length > 0 && (
                         <div className="flex flex-wrap gap-1 mt-2">
                           {stat.topConcerns.slice(0, 3).map((concern, idx) => (
                             <span key={idx} className="text-[8px] px-1.5 py-0.5 bg-white text-orange-700 rounded font-bold border border-orange-200">
                               {concern.keyword} ({concern.count})
                             </span>
                           ))}
                         </div>
                       )}
                     </div>
                   </div>
                 </div>
               );
             }) : (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-30">
                   <Inbox size={48} className="text-slate-300" />
                   <p className="text-xs font-black uppercase tracking-widest">暂无房源热度数据</p>
                </div>
             )}          </div>
        </div>
      </div>

      {/* AI智能助手弹窗 */}
      {isAIModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
            {/* 头部 */}
            <div className="p-6 border-b flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl">
                  <Sparkles size={24} className="text-white"/>
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">AI 智能助手</h2>
                  <p className="text-xs text-slate-500 font-medium">国区级数据分析与报告生成</p>
                </div>
              </div>
              <button onClick={() => setIsAIModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-lg transition-all">
                <X size={24} className="text-slate-400"/>
              </button>
            </div>

            {/* Tabs */}
            <div className="px-6 pt-4 flex gap-2 border-b shrink-0 overflow-x-auto">
              <button
                onClick={() => {
                  setActiveTab('chat');
                  setChatHistory([]);
                }}
                className={`px-4 py-2.5 rounded-t-xl text-sm font-black transition-all whitespace-nowrap ${
                  activeTab === 'chat' 
                    ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                💬 智能问答
              </button>
              <button
                onClick={() => handleGenerateReport('monthly')}
                className={`px-4 py-2.5 rounded-t-xl text-sm font-black transition-all whitespace-nowrap ${
                  activeTab === 'monthly' 
                    ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                📄 本月经营报告
              </button>
              <button
                onClick={() => handleGenerateReport('quarterly')}
                className={`px-4 py-2.5 rounded-t-xl text-sm font-black transition-all whitespace-nowrap ${
                  activeTab === 'quarterly' 
                    ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                📈 本季度经营报告
              </button>
              <button
                onClick={() => handleGenerateReport('annual')}
                className={`px-4 py-2.5 rounded-t-xl text-sm font-black transition-all whitespace-nowrap ${
                  activeTab === 'annual' 
                    ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                📊 本年度经营报告
              </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'chat' ? (
                <div className="space-y-4">
                  {chatHistory.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center py-20 text-center">
                      <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl flex items-center justify-center mb-6 shadow-lg">
                        <Sparkles size={40} className="text-white"/>
                      </div>
                      <h3 className="text-xl font-black text-slate-900 mb-2">您好！我是您的招商智能助手</h3>
                      <p className="text-slate-500 text-sm mb-6 max-w-md">我可以帮您分析招商区域数据、评估商机质量、分析渠道合作效能、提供业务改进建议。</p>
                      <div className="grid grid-cols-2 gap-3 max-w-2xl">
                        <button
                          onClick={() => {
                            setChatInput('分析一下当前的商机质量和转化情况');
                          }}
                          className="p-4 bg-slate-50 rounded-xl text-left hover:bg-slate-100 transition-all border border-slate-200"
                        >
                          <p className="text-sm font-bold text-slate-700">📊 分析商机质量和转化情况</p>
                        </button>
                        <button
                          onClick={() => {
                            setChatInput('评估当前带看效率及改进建议');
                          }}
                          className="p-4 bg-slate-50 rounded-xl text-left hover:bg-slate-100 transition-all border border-slate-200"
                        >
                          <p className="text-sm font-bold text-slate-700">👁️ 评估带看效率及改进建议</p>
                        </button>
                        <button
                          onClick={() => {
                            setChatInput('分析渠道商合作效能');
                          }}
                          className="p-4 bg-slate-50 rounded-xl text-left hover:bg-slate-100 transition-all border border-slate-200"
                        >
                          <p className="text-sm font-bold text-slate-700">🤝 分析渠道商合作效能</p>
                        </button>
                        <button
                          onClick={() => {
                            setChatInput('提供本月招商工作改进建议');
                          }}
                          className="p-4 bg-slate-50 rounded-xl text-left hover:bg-slate-100 transition-all border border-slate-200"
                        >
                          <p className="text-sm font-bold text-slate-700">💡 提供招商工作改进建议</p>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[500px] overflow-y-auto">
                      {chatHistory.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`flex ${
                            msg.role === 'user' ? 'justify-end' : 'justify-start'
                          }`}
                        >
                          <div
                            className={`max-w-[80%] p-4 rounded-2xl ${
                              msg.role === 'user'
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 text-slate-900'
                            }`}
                          >
                            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      ))}
                      {aiLoading && (
                        <div className="flex justify-start">
                          <div className="bg-slate-100 p-4 rounded-2xl">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                              <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                              <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {aiLoading ? (
                    <div className="flex flex-col items-center justify-center h-full py-20">
                      <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                      <p className="text-slate-600 font-bold">正在生成报告，请稍候...</p>
                      <p className="text-xs text-slate-400 mt-2">通常需要 10-30 秒</p>
                    </div>
                  ) : aiReport ? (
                    <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: aiReport }} />
                  ) : (
                    <div className="text-center py-20 text-slate-400">
                      暂无报告内容
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 底部输入框（仅在chat模式显示） */}
            {activeTab === 'chat' && (
              <div className="p-6 border-t shrink-0">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendChat()}
                    placeholder="请问有什么可以帮助您的？例如：本月出租率如何？"
                    className="flex-1 border border-slate-200 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    disabled={aiLoading}
                  />
                  <button
                    onClick={handleSendChat}
                    disabled={aiLoading || !chatInput.trim()}
                    className="bg-indigo-600 text-white px-6 py-4 rounded-xl font-black text-sm flex items-center gap-2 hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send size={18}/> 发送
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
