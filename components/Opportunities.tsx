import React, { useState, useMemo, useEffect } from 'react';
import { Opportunity, Activity, ActivityType, OpportunityStage, Agent, Unit, UnitStatus, OpportunitySource, OpportunityIntent, DealParameters, User, UserRole, Channel, RentFreePeriod, DealLog } from '../types';
// 已移除 PlusCircle 导入，以解决与底部自定义组件的命名冲突
import { Search, X, Briefcase, Calendar, CheckCircle, Edit3, Building2, Ban, History, Plus, DollarSign, BarChart3, ChevronDown, ChevronUp, Award, Clock, Users as UsersIcon, Link, UserPlus, Trash2, TrendingUp, Calculator, Layers, MessageSquareText, FileText, ExternalLink, MapPin, RefreshCw, Undo2, AlertCircle, ShieldAlert, UserCheck, Save, ArrowRight, Target, ClipboardCheck, Info, Pin, PinOff, Percent, UserCircle, Gift, Shield, User as UserIcon, Timer, Footprints } from 'lucide-react';

interface OpportunitiesProps {
  currentUser: User;
  users: User[];
  opportunities: Opportunity[];
  agents: Agent[];
  channels: Channel[];
  units: Unit[];
  activities: Activity[];
  annualTarget: number;
  onUpdateTarget: (target: number) => void;
  onAddActivity: (activity: Activity) => void;
  onUpdateActivity: (activity: Activity) => void;
  onDeleteActivity: (id: string) => void;
  onAddOpportunity: (opp: Opportunity) => void;
  onDeleteOpportunity: (id: string) => void;
  onAddCommission: (opp: Opportunity) => void;
  onUpdateOpportunityStage: (oppId: string, stage: OpportunityStage, lossReason?: string) => void;
  onUpdateOpportunityDetails: (opp: Opportunity) => void;
  onUnitStatusChange: (unitId: string, status: UnitStatus, tenantName: string) => void;
  onUpdateUserTargets?: (userId: string, annual: number, monthly: number, visits?: number) => void;
}

export const Opportunities: React.FC<OpportunitiesProps> = ({ 
  currentUser, users = [], opportunities = [], agents = [], units = [], activities = [], annualTarget, onUpdateTarget, channels = [],
  onAddActivity, onUpdateActivity, onDeleteActivity,
  onAddOpportunity, onDeleteOpportunity, onAddCommission, onUpdateOpportunityStage, onUpdateOpportunityDetails, onUnitStatusChange, onUpdateUserTargets 
}) => {
  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);
  const [viewMode, setViewMode] = useState<'ACTIVE' | 'LOST'>('ACTIVE');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDashboardVisible, setIsDashboardVisible] = useState(false);
  const [isManagerPanelVisible, setIsManagerPanelVisible] = useState(false);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [isLostModalOpen, setIsLostModalOpen] = useState(false);
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
  const [isEditOppModalOpen, setIsEditOppModalOpen] = useState(false);
  const [lossReason, setLossReason] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  
  const [transferTargetManager, setTransferTargetManager] = useState('');

  const [newOppForm, setNewOppForm] = useState<Partial<Opportunity>>({
    companyName: '', industry: '', requiredArea: 0, budget: 0, moveInDate: '', source: OpportunitySource.SELF_HUNT, intent: OpportunityIntent.MEDIUM, leasingManager: currentUser.name, targetUnitId: '', channelId: '', agentId: '', agentName: ''
  });

  const [editOppForm, setEditOppForm] = useState<Partial<Opportunity>>({});

  const [tempTarget, setTempTarget] = useState(annualTarget);

  const [signForm, setSignForm] = useState<Partial<DealParameters>>({
    buildingName: '', unitIds: [], finalArea: 0, signDate: new Date().toISOString().slice(0, 10), leaseStartDate: new Date().toISOString().slice(0, 10), leaseEndDate: '', finalPrice: 0, monthlyRent: 0, paymentCycleMonths: 3, firstPaymentCount: 3, firstPaymentDate: new Date().toISOString().slice(0, 10), isRentFreeDeferred: false, rentFreePeriods: [], depositAmount: '', depositStatus: '待缴', remarks: '', isHighRisk: false, industry: '', establishedDate: '', legalRepresentative: ''
  });
  
  const [newActType, setNewActType] = useState<ActivityType>(ActivityType.VISIT);
  const [newActDesc, setNewActDesc] = useState('');
  const [channelSearchText, setChannelSearchText] = useState('');
  const [referralSearchText, setReferralSearchText] = useState('');

  const isAdmin = currentUser.role === UserRole.ADMIN;

  // 根据权限和搜索文本过滤渠道
  const filteredChannels = useMemo(() => {
    // 权限过滤：管理员看所有，普通用户只看自己创建的
    const permissionFiltered = isAdmin 
      ? channels 
      : channels.filter(c => c.creatorId === currentUser.id);
      
    // 搜索过滤
    if (!channelSearchText.trim()) return permissionFiltered;
      
    const searchLower = channelSearchText.toLowerCase();
    return permissionFiltered.filter(c => {
      // 搜索公司名称
      if (c.companyName.toLowerCase().includes(searchLower)) return true;
        
      // 搜索联系人姓名和电话
      if (c.agents && c.agents.length > 0) {
        return c.agents.some(agent => 
          agent.name?.toLowerCase().includes(searchLower) ||
          agent.phone?.toLowerCase().includes(searchLower)
        );
      }
        
      return false;
    });
  }, [channels, currentUser.id, isAdmin, channelSearchText]);
  
  // 过滤转介绍房源（已出租）
  const filteredReferralUnits = useMemo(() => {
    const occupiedUnits = units.filter(u => u.status === UnitStatus.OCCUPIED);
      
    if (!referralSearchText.trim()) return occupiedUnits;
      
    const searchLower = referralSearchText.toLowerCase();
    return occupiedUnits.filter(u => {
      // 搜索楼栋号
      if (u.building.toLowerCase().includes(searchLower)) return true;
      // 搜索房间号
      if (u.roomNo.toLowerCase().includes(searchLower)) return true;
      // 搜索租户名称
      if (u.tenantName && u.tenantName.toLowerCase().includes(searchLower)) return true;
        
      return false;
    });
  }, [units, referralSearchText]);

  // 关键优化：全局过滤有效轨迹记录（排除已删除商机残留的脏数据）
  const validActivities = useMemo(() => {
    const activeOppIds = new Set(opportunities.map(o => o.id));
    return activities.filter(a => activeOppIds.has(a.opportunityId));
  }, [activities, opportunities]);

  useEffect(() => {
    const area = signForm.finalArea || 0;
    const price = signForm.finalPrice || 0;
    const monthly = Math.round(area * price * 30.42);
    setSignForm(prev => ({ ...prev, monthlyRent: monthly }));
  }, [signForm.finalArea, signForm.finalPrice]);

  const handleCreateOpportunity = () => {
    if (!newOppForm.companyName || !newOppForm.requiredArea) return alert("企业名称及需求面积为必填项");
    
    let agentInfo = { name: '', phone: '' };
    if (newOppForm.channelId && newOppForm.agentId) {
        const chan = channels.find(c => c.id === newOppForm.channelId);
        const ag = chan?.agents.find(a => a.id === newOppForm.agentId);
        if (ag) agentInfo = { name: ag.name, phone: ag.phone };
    }

    const newOpp: Opportunity = { 
        ...newOppForm as Opportunity, 
        id: `OPP-${Date.now()}`, 
        creatorId: currentUser.id, 
        stage: OpportunityStage.LEAD, 
        agentName: agentInfo.name, 
        agentPhone: agentInfo.phone, 
        tags: [], 
        createdAt: new Date().toISOString(), 
        isPinned: false 
    };
    
    onAddOpportunity(newOpp);
    setIsAddModalOpen(false);
    setNewOppForm({
        companyName: '', industry: '', requiredArea: 0, budget: 0, moveInDate: '', source: OpportunitySource.SELF_HUNT, intent: OpportunityIntent.MEDIUM, leasingManager: currentUser.name, targetUnitId: '', channelId: '', agentId: '', agentName: ''
    });
  };

  const handleTogglePin = (e: React.MouseEvent, opp: Opportunity) => {
    e.stopPropagation();
    onUpdateOpportunityDetails({ ...opp, isPinned: !opp.isPinned });
  };

  const handleSignConfirm = () => {
    if (!selectedOpp || !signForm.finalArea || !signForm.buildingName) return alert("请完善落位建筑及房源信息");
    let updatedOpp: Opportunity;
    if (isEditMode) {
      updatedOpp = { ...selectedOpp, dealParams: signForm as DealParameters };
    } else {
      updatedOpp = { ...selectedOpp, stage: OpportunityStage.CONTRACT, dealParams: signForm as DealParameters };
      onAddCommission(updatedOpp);
      signForm.unitIds?.forEach(id => onUnitStatusChange(id, UnitStatus.OCCUPIED, selectedOpp.companyName));
    }
    onUpdateOpportunityDetails(updatedOpp);
    setIsSignModalOpen(false);
    setSelectedOpp(updatedOpp);
  };

  const handleConfirmLost = () => {
    if (!selectedOpp || !lossReason) return alert("请填写流失原因");
    onUpdateOpportunityStage(selectedOpp.id, OpportunityStage.CLOSED_LOST, lossReason);
    setIsLostModalOpen(false);
    setSelectedOpp(null);
    setLossReason('');
  };

  const handleDeleteOppClick = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (confirm(`⚠️ 危险操作确认：\n\n确定永久删除商机 [${name}] 吗？该操作将同时移除所有关联的跟进轨迹，且不可撤销。`)) {
      onDeleteOpportunity(id);
      if (selectedOpp?.id === id) setSelectedOpp(null);
    }
  };

  const handleReactivateAndTransfer = () => {
    if (!selectedOpp || !transferTargetManager) return alert("请选择接收该商机的招商经理");
    
    const updatedOpp: Opportunity = {
      ...selectedOpp,
      stage: OpportunityStage.LEAD, 
      leasingManager: transferTargetManager,
      lossReason: undefined,
      lossDate: undefined
    };

    onUpdateOpportunityDetails(updatedOpp);
    
    onAddActivity({
      id: `ACT-${Date.now()}`,
      opportunityId: selectedOpp.id,
      creatorId: currentUser.id,
      date: new Date().toISOString().slice(0, 10),
      type: ActivityType.CALL,
      hostName: currentUser.name,
      description: `系统操作：管理员将已流失商机重新激活，并流转给招商经理 [${transferTargetManager}] 负责跟进。`
    });

    alert(`✅ 商机已成功激活并指派给 ${transferTargetManager}`);
    setSelectedOpp(null); 
    setTransferTargetManager('');
  };

  const openSignModal = (edit: boolean = false) => {
    setIsEditMode(edit);
    if (edit && selectedOpp?.dealParams) {
        setSignForm({ ...selectedOpp.dealParams });
    } else {
        setSignForm({ 
            buildingName: '', unitIds: [], finalArea: 0, signDate: new Date().toISOString().slice(0, 10), leaseStartDate: new Date().toISOString().slice(0, 10), 
            leaseEndDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
            finalPrice: 0, monthlyRent: 0, paymentCycleMonths: 3, firstPaymentCount: 3, firstPaymentDate: new Date().toISOString().slice(0, 10),
            isRentFreeDeferred: false, rentFreePeriods: [], depositAmount: '', depositStatus: '待缴', remarks: '', isHighRisk: false 
        });
    }
    setIsSignModalOpen(true);
  };

  const openEditOppModal = () => {
    if (!selectedOpp) return;
    setEditOppForm({
      ...selectedOpp,
      relatedUnitIds: selectedOpp.relatedUnitIds || []
    });
    setIsEditOppModalOpen(true);
  };

  const handleUpdateOpportunity = () => {
    if (!selectedOpp || !editOppForm.companyName) return alert('企业名称不能为空');
    
    const updatedOpp: Opportunity = {
      ...selectedOpp,
      ...editOppForm,
      relatedUnitIds: editOppForm.relatedUnitIds || []
    } as Opportunity;
    
    onUpdateOpportunityDetails(updatedOpp);
    setSelectedOpp(updatedOpp);
    setIsEditOppModalOpen(false);
    setEditOppForm({});
  };

  const addRentFreeRow = () => {
    const newPeriod: RentFreePeriod = { id: `RF-${Date.now()}`, startDate: '', endDate: '' };
    setSignForm(prev => ({ ...prev, rentFreePeriods: [...(prev.rentFreePeriods || []), newPeriod] }));
  };

  const getRoomDisplayNames = (unitIds: string[]) => {
    if (!unitIds || unitIds.length === 0) return '未指派房源';
    return unitIds.map(id => {
      let unit = units.find(u => u.id === id);
      if (!unit) unit = units.find(u => u.roomNo === id);
      if (unit) return unit.roomNo;
      return id.split('-').pop()?.toUpperCase() || id;
    }).join(', ');
  };

  const userPerformances = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const currentMonthStr = new Date().toISOString().slice(0, 7);
    return (users || []).filter(u => u.role === UserRole.USER).map(user => {
        const myOpps = opportunities.filter(o => o.leasingManager === user.name);
        const ytdOpps = myOpps.filter(o => new Date(o.createdAt).getFullYear() === currentYear).length;
        const activeOpps = myOpps.filter(o => o.stage !== OpportunityStage.CLOSED_LOST && o.stage !== OpportunityStage.CONTRACT).length;
        const lostOpps = myOpps.filter(o => o.stage === OpportunityStage.CLOSED_LOST && new Date(o.createdAt).getFullYear() === currentYear).length;
        // 使用 validActivities 进行过滤
        const myActs = validActivities.filter(a => a.hostName === user.name && a.type === ActivityType.VISIT);
        const ytdVisits = myActs.filter(a => new Date(a.date).getFullYear() === currentYear).length;
        const monthlyVisits = myActs.filter(a => a.date.startsWith(currentMonthStr)).length;
        const lossRate = ytdOpps > 0 ? (lostOpps / ytdOpps) * 100 : 0;
        return { user, ytdOpps, ytdVisits, activeOpps, monthlyVisits, lostOpps, lossRate };
    });
  }, [users, opportunities, validActivities]);

  const sortedOpportunities = useMemo(() => {
    const accessibleOpps = isAdmin ? opportunities : opportunities.filter(o => o.leasingManager === currentUser.name || o.creatorId === currentUser.id);
    const filtered = accessibleOpps.filter(o => viewMode === 'ACTIVE' ? o.stage !== OpportunityStage.CLOSED_LOST : o.stage === OpportunityStage.CLOSED_LOST);
    return filtered.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [opportunities, viewMode, isAdmin, currentUser]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-6 relative">
      <div className="bg-white rounded-[2rem] shadow-sm overflow-hidden shrink-0 border border-slate-200">
         <div onClick={() => setIsDashboardVisible(!isDashboardVisible)} className="px-6 py-4 flex justify-between items-center cursor-pointer hover:bg-slate-50 border-b border-slate-100">
            <div className="flex items-center gap-2">
               <div className="p-1.5 bg-indigo-600 rounded-lg text-white shadow-lg shadow-indigo-100"><BarChart3 size={16}/></div>
               <h3 className="font-black text-slate-900 text-[11px] tracking-widest uppercase">全园招商效能全景看板</h3>
            </div>
            {isDashboardVisible ? <ChevronUp className="text-slate-400" size={16}/> : <ChevronDown className="text-slate-400" size={16}/>}
         </div>
         {isDashboardVisible && (
           <div className="p-5 animate-in slide-in-from-top-4 duration-500">
              <div className="grid grid-cols-4 gap-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 mb-1.5 uppercase tracking-widest">年度签约总面积</p>
                  <p className="text-xl font-black text-slate-900">{opportunities.filter(o=>o.stage === OpportunityStage.CONTRACT).reduce((s,o)=>s+(o.dealParams?.finalArea || 0), 0).toLocaleString()} <span className="text-xs font-normal">m²</span></p>
                </div>
                <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                  <p className="text-[9px] font-black text-indigo-600 mb-1.5 uppercase tracking-widest">存量活跃商机</p>
                  <p className="text-xl font-black text-indigo-700">{opportunities.filter(o=>o.stage !== OpportunityStage.CONTRACT && o.stage !== OpportunityStage.CLOSED_LOST).length} 个</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 mb-1.5 uppercase tracking-widest">本月新带看</p>
                  <p className="text-xl font-black text-slate-900">
                    {validActivities.filter(a => a.type === ActivityType.VISIT && a.date.startsWith(new Date().toISOString().slice(0, 7))).length} 次
                  </p>
                </div>
                <div className={`p-4 rounded-2xl border transition-all ${isAdmin ? 'bg-emerald-50 border-emerald-100 cursor-pointer hover:bg-emerald-100' : 'bg-slate-50 border-slate-100'}`} onClick={() => isAdmin && setIsTargetModalOpen(true)}>
                  <div className="flex justify-between items-start">
                    <p className="text-[9px] font-black text-emerald-600 mb-1.5 uppercase tracking-widest">年度总目标</p>
                    {isAdmin && <Edit3 size={12} className="text-emerald-400" />}
                  </div>
                  <p className="text-xl font-black text-emerald-700">{annualTarget.toLocaleString()} <span className="text-xs font-normal opacity-60">m²</span></p>
                </div>
              </div>
           </div>
         )}
      </div>

      <div className="bg-white rounded-[2rem] shadow-sm overflow-hidden shrink-0 border border-slate-200">
         <div onClick={() => setIsManagerPanelVisible(!isManagerPanelVisible)} className="px-6 py-4 flex justify-between items-center cursor-pointer hover:bg-slate-50 border-b border-slate-100">
            <div className="flex items-center gap-2">
               <div className="p-1.5 bg-slate-900 rounded-lg text-white shadow-lg shadow-slate-100"><UsersIcon size={16}/></div>
               <h3 className="font-black text-slate-900 text-[11px] tracking-widest uppercase">招商经理效能看板</h3>
            </div>
            {isManagerPanelVisible ? <ChevronUp className="text-slate-400" size={16}/> : <ChevronDown className="text-slate-400" size={16}/>}
         </div>
         {isManagerPanelVisible && (
           <div className="p-5 animate-in slide-in-from-top-4 duration-500">
             <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
               {userPerformances.map(perf => (
            <div key={perf.user.id} className="min-w-[340px] bg-white rounded-[2rem] border border-slate-200 p-6 flex flex-col gap-6 shadow-sm hover:shadow-md transition-all">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-slate-900 flex items-center justify-center text-white text-xs font-black uppercase">{perf.user.name[0]}</div>
                        <div>
                            <h4 className="font-black text-slate-900 text-sm tracking-tight">{perf.user.name}</h4>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Leasing Manager</p>
                        </div>
                    </div>
                    <div className="px-2 py-1 bg-indigo-50 rounded-lg text-indigo-600 text-[10px] font-black uppercase border border-indigo-100 tracking-tighter">本年累计</div>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-50 pt-5">
                    <div className="space-y-1">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">商机数 / 带看</p>
                        <p className="text-lg font-black text-slate-800 font-mono tracking-tighter">{perf.ytdOpps} <span className="text-slate-300 font-normal">/</span> {perf.ytdVisits}</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">当前活跃商机</p>
                        <p className="text-lg font-black text-indigo-700 font-mono tracking-tighter">{perf.activeOpps} <span className="text-xs font-black opacity-60 tracking-tighter uppercase">Focus</span></p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">本月带看强度</p>
                        <p className="text-lg font-black text-slate-800 font-mono tracking-tighter">{perf.monthlyVisits} 次</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest">流失率 (YTD)</p>
                        <p className="text-lg font-black text-rose-600 font-mono tracking-tighter">{perf.lossRate.toFixed(1)}% <span className="text-xs opacity-40">({perf.lostOpps})</span></p>
                    </div>
                </div>
            </div>
          ))}
          {userPerformances.length === 0 && (
              <div className="w-full py-8 bg-slate-50/50 rounded-[2rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300">
                  <UserCircle size={32} className="opacity-20 mb-2"/>
                  <p className="text-[10px] font-black uppercase tracking-widest">未发现招商专员账户</p>
              </div>
          )}
             </div>
           </div>
         )}
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        <div className={`flex flex-col bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden transition-all duration-300 ${selectedOpp ? 'w-80' : 'w-full'}`}>
          <div className="flex border-b font-black text-[10px] uppercase tracking-widest">
              <button onClick={() => setViewMode('ACTIVE')} className={`flex-1 py-5 ${viewMode === 'ACTIVE' ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}>招商中</button>
              <button onClick={() => setViewMode('LOST')} className={`flex-1 py-5 ${viewMode === 'LOST' ? 'bg-rose-50 text-rose-600 border-b-2 border-rose-600' : 'text-slate-400'}`}>流失库</button>
          </div>
          <div className="p-4 border-b flex gap-3 bg-slate-50/30">
             <div className="relative flex-1"><Search className="absolute left-3 top-3 text-slate-400" size={14}/><input type="text" placeholder="搜索企业..." className="w-full pl-9 pr-4 py-2.5 bg-white rounded-2xl text-xs outline-none font-bold focus:ring-2 focus:ring-indigo-100 transition-all border border-slate-100" /></div>
             <button onClick={() => setIsAddModalOpen(true)} className="bg-indigo-600 text-white px-5 py-2 rounded-2xl text-xs font-black shadow-lg shadow-indigo-100 active:scale-95 transition-all"><Plus size={16}/></button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
            {sortedOpportunities.map(opp => {
                const oppActivities = validActivities.filter(a => a.opportunityId === opp.id);
                const followCount = oppActivities.length;
                const lastActDate = oppActivities.length > 0 
                  ? oppActivities.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date 
                  : opp.createdAt.slice(0, 10);
                
                const startDate = new Date(opp.createdAt);
                const endDate = opp.stage === OpportunityStage.CLOSED_LOST && opp.lossDate ? new Date(opp.lossDate) : new Date();
                const durationDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
                const isOverdue = !opp.lossDate && opp.stage !== OpportunityStage.CONTRACT && (new Date().getTime() - new Date(lastActDate).getTime()) > 7 * 86400000;

                return (
                    <div key={opp.id} onClick={() => setSelectedOpp(opp)} className={`p-6 cursor-pointer hover:bg-indigo-50/30 border-l-4 transition-all group relative ${selectedOpp?.id === opp.id ? 'bg-indigo-50/40 border-l-indigo-600' : opp.isPinned ? 'bg-amber-50/30 border-l-amber-500' : 'border-l-transparent'}`}>
                       <div className="absolute top-4 right-4 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all z-10">
                         <button 
                            onClick={(e) => handleTogglePin(e, opp)}
                            className={`p-2 rounded-xl transition-all ${opp.isPinned ? 'text-amber-600 bg-amber-50 shadow-sm' : 'text-slate-300 hover:text-indigo-600 hover:bg-indigo-50'}`}
                            title={opp.isPinned ? '取消置顶' : '置顶跟进'}
                         >
                            {opp.isPinned ? <Pin size={16} fill="currentColor"/> : <Pin size={16}/>}
                         </button>
                         {isAdmin && (
                           <button 
                              onClick={(e) => handleDeleteOppClick(e, opp.id, opp.companyName)}
                              className="p-2 text-rose-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                           >
                              <Trash2 size={16}/>
                           </button>
                         )}
                       </div>
                       
                       <div className="flex justify-between items-start mb-2 pr-20">
                          <div className="flex flex-col gap-1 min-w-0">
                            <h3 className="font-black text-slate-900 truncate text-base flex items-center gap-2">
                               {opp.companyName}
                               {opp.isPinned && <span className="bg-amber-100 text-amber-700 text-[8px] px-1.5 py-0.5 rounded font-black uppercase border border-amber-200 animate-pulse shrink-0">Focus</span>}
                            </h3>
                          </div>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter shrink-0 ${opp.stage === OpportunityStage.CLOSED_LOST ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'}`}>
                             存续 {durationDays}天
                          </span>
                       </div>
                       
                       <div className="flex gap-4 text-xs font-bold text-slate-400 mb-4 items-center">
                          <span className="bg-slate-100 px-2 py-0.5 rounded text-indigo-600 font-mono tracking-tighter">{opp.requiredArea}㎡</span>
                          <span className="flex items-center gap-1"><UserIcon size={10} className="text-slate-300"/> {opp.leasingManager}</span>
                       </div>

                       <div className="grid grid-cols-2 gap-y-2 border-t border-slate-50 pt-3 opacity-80 group-hover:opacity-100 transition-opacity">
                          <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                             <Calendar size={12} className="text-indigo-400"/> {opp.createdAt.slice(0, 10)}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest justify-end">
                             <Footprints size={12} className="text-emerald-400"/> 跟进 {followCount}次
                          </div>
                          <div className="col-span-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest mt-1">
                             <RefreshCw size={12} className={`${isOverdue ? 'text-rose-500 animate-spin-slow' : 'text-slate-300'}`}/> 
                             <span className={isOverdue ? 'text-rose-600' : 'text-slate-400'}>最后更新: {lastActDate}</span>
                          </div>
                       </div>
                    </div>
                );
            })}
          </div>
        </div>

        {selectedOpp ? (
          <div className="flex-1 bg-white rounded-[2rem] border border-slate-200 shadow-sm flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-300">
             <div className={`p-8 border-b text-white ${selectedOpp.stage === OpportunityStage.CLOSED_LOST ? 'bg-slate-700' : 'bg-slate-900'}`}>
                <div className="flex justify-between items-center">
                   <div className="flex items-center gap-6">
                      <div className="w-16 h-16 rounded-3xl bg-indigo-600 flex items-center justify-center text-white"><Briefcase size={32}/></div>
                      <div>
                         <h1 className="text-2xl font-black tracking-tight">{selectedOpp.companyName}</h1>
                         <div className="flex items-center gap-3 mt-1.5 opacity-60">
                            <span className="text-[10px] font-black bg-white/10 px-3 py-1 rounded-full uppercase">{selectedOpp.stage}阶段</span>
                            {selectedOpp.agentName && <span className="text-[10px] font-black flex items-center gap-1"><UserCircle size={12}/> 中介：{selectedOpp.agentName}</span>}
                         </div>
                         
                         {/* 关联房源显示（醒目版） */}
                         {selectedOpp.relatedUnitIds && selectedOpp.relatedUnitIds.length > 0 && (
                           <div className="flex items-center gap-2 mt-3">
                             <Building2 size={14} className="text-emerald-400"/>
                             <div className="flex flex-wrap gap-1.5">
                               {selectedOpp.relatedUnitIds.map(unitId => {
                                 const unit = units.find(u => u.id === unitId);
                                 if (!unit) return null;
                                 return (
                                   <span key={unitId} className="text-[11px] px-2.5 py-1 bg-emerald-500 text-white rounded-lg font-black shadow-lg">
                                     {unit.building}-{unit.roomNo}
                                   </span>
                                 );
                               })}
                             </div>
                           </div>
                         )}
                      </div>
                   </div>
                   <div className="flex items-center gap-3">
                      {/* 编辑商机按钮 */}
                      {selectedOpp.stage !== OpportunityStage.CLOSED_LOST && (
                        <button 
                          onClick={openEditOppModal} 
                          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold text-xs transition-all flex items-center gap-2 border border-white/20"
                        >
                          <Edit3 size={14}/> 编辑
                        </button>
                      )}
                      {selectedOpp.stage !== OpportunityStage.CONTRACT && selectedOpp.stage !== OpportunityStage.CLOSED_LOST && (
                        <>
                          <button onClick={() => openSignModal()} className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-sm shadow-xl hover:shadow-2xl transition-all flex items-center gap-2">
                            <Award size={20}/> 确认成交
                          </button>
                          <button onClick={() => setIsLostModalOpen(true)} className="px-6 py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-2xl font-black text-sm shadow-xl hover:shadow-2xl transition-all flex items-center gap-2">
                            <Ban size={20}/> 标记流失
                          </button>
                        </>
                      )}
                      <button onClick={() => setSelectedOpp(null)} className="p-2 hover:bg-white/10 rounded-full text-slate-400"><X size={28}/></button>
                   </div>
                </div>
            </div>

            <div className="flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar">
                   {selectedOpp.stage === OpportunityStage.CONTRACT && selectedOpp.dealParams && (
                      <div className="bg-emerald-50/50 border border-emerald-100 rounded-[2.5rem] p-10 shadow-sm relative">
                         <div className="flex justify-between items-start mb-8">
                            <h3 className="text-xl font-black text-emerald-900 flex items-center gap-3 uppercase tracking-widest"><ClipboardCheck size={24}/> 租赁成交快报</h3>
                            <button onClick={() => openSignModal(true)} className="bg-white text-emerald-600 border border-emerald-100 p-2 rounded-xl shadow-sm"><Edit3 size={16}/></button>
                         </div>
                         <div className="grid grid-cols-3 gap-10">
                            <div>
                                <p className="text-[10px] text-emerald-600/60 font-black mb-2 uppercase tracking-widest">房源落位</p>
                                <p className="text-lg font-black text-emerald-800">
                                  {selectedOpp.dealParams.buildingName} : {getRoomDisplayNames(selectedOpp.dealParams.unitIds)}
                                </p>
                            </div>
                            <div><p className="text-[10px] text-emerald-600/60 font-black mb-2">成交单价</p><p className="text-lg font-black text-emerald-800">¥ {selectedOpp.dealParams.finalPrice}</p></div>
                            <div><p className="text-[10px] text-emerald-600/60 font-black mb-2">中介经办人</p><p className="text-lg font-black text-slate-800">{selectedOpp.agentName || '自拓无中介'}</p></div>
                         </div>
                      </div>
                   )}

                   {/* 商机更新轨迹输入区 - 横向布局 */}
                   {selectedOpp.stage !== OpportunityStage.CLOSED_LOST && (
                     <div className="w-full">
                       <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-[2rem] p-6 border-2 border-indigo-100 shadow-lg">
                         <label className="block text-base font-black text-indigo-900 mb-4 uppercase tracking-wider flex items-center gap-2">
                           <MessageSquareText size={20} className="text-indigo-600"/> 📝 商机更新轨迹
                         </label>
                         
                         <div className="flex gap-4">
                           {/* 活动类型按钮组 - 竖向 */}
                           <div className="flex flex-col gap-2 shrink-0">
                             {Object.values(ActivityType).map(type => (
                               <button
                                 key={type}
                                 onClick={() => setNewActType(type)}
                                 className={`px-5 py-3 rounded-xl font-black text-base transition-all whitespace-nowrap ${
                                   newActType === type 
                                     ? 'bg-indigo-600 text-white shadow-lg scale-105' 
                                     : 'bg-white text-slate-600 border-2 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                                 }`}
                               >
                                 {type === ActivityType.VISIT && '👁️'}
                                 {type === ActivityType.CALL && '📞'}
                                 {type === ActivityType.QUOTATION && '💰'}
                                 {type === ActivityType.NEGOTIATION && '🤝'}
                                 {type === ActivityType.SIGNING && '✍️'}
                                 {' '}{type}
                               </button>
                             ))}
                           </div>
                           
                           {/* 右侧区域：输入框 + 按钮 */}
                           <div className="flex-1 flex flex-col gap-4">
                             {/* 输入框 */}
                             <textarea 
                               className="w-full border-2 border-indigo-200 rounded-xl p-4 text-base outline-none font-medium bg-white shadow-sm focus:ring-4 focus:ring-indigo-100 transition-all resize-none" 
                               placeholder="请详细记录洽谈过程、客户反馈、重点关注事项等...

例如：
• 客户对350平米房源比较感兴趣
• 认为价格略高，希望有优惠
• 预计下周二带领导到场看房"
                               value={newActDesc} 
                               onChange={e=>setNewActDesc(e.target.value)}
                               rows={8}
                             />
                             
                             {/* 保存按钮 - 居中 */}
                             <div className="flex justify-center">
                               <button 
                                 onClick={()=>{ 
                                   if(!newActDesc.trim()) return; 
                                   onAddActivity({ 
                                     id:`ACT-${Date.now()}`, 
                                     opportunityId:selectedOpp.id, 
                                     creatorId:currentUser.id, 
                                     date:new Date().toISOString().slice(0,10), 
                                     type:newActType, 
                                     hostName:currentUser.name, 
                                     description:newActDesc 
                                   }); 
                                   setNewActDesc(''); 
                                 }} 
                                 className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-12 py-4 rounded-xl text-base font-black shadow-xl hover:shadow-2xl hover:scale-105 transition-all flex items-center justify-center gap-3"
                               >
                                 <Save size={20}/>
                                 <span>保存并更新轨迹</span>
                               </button>
                             </div>
                           </div>
                         </div>
                       </div>
                     </div>
                   )}

                   <div className="space-y-8">
                      <h3 className="font-black text-slate-800 text-xs flex items-center gap-2 uppercase tracking-widest border-b pb-4"><History size={16} className="text-indigo-600"/> 业务跟进脉络</h3>
                      <div className="space-y-8 border-l-2 border-slate-100 ml-3 pl-8 pb-10">
                        {activities.filter(a => a.opportunityId === selectedOpp.id).sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime()).map(act => (
                          <div key={act.id} className="relative bg-white p-6 rounded-[1.5rem] border border-slate-100 shadow-sm">
                             <div className="absolute -left-[43px] top-6 w-4 h-4 bg-indigo-600 rounded-full border-4 border-white shadow shadow-indigo-100"></div>
                             <div className="flex justify-between text-[10px] mb-3 font-mono">
                                <span className={`font-black uppercase px-2 py-0.5 rounded ${act.type === ActivityType.VISIT ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-500'}`}>{act.type}</span>
                                <span className="text-slate-400 font-bold">{act.date} · {act.hostName}</span>
                             </div>
                             <p className="text-sm text-slate-700 font-bold leading-relaxed">{act.description}</p>
                          </div>
                        ))}
                      </div>
                   </div>
                </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 border-4 border-dashed border-slate-200 rounded-[3rem]">
             <Briefcase size={64} className="text-slate-200 mb-6 opacity-30"/>
             <p className="text-slate-400 font-black text-sm uppercase tracking-widest font-mono">请从侧边列表选择意向客户档案</p>
          </div>
        )}
      </div>

      {isTargetModalOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
           <div className="bg-white p-10 rounded-[3rem] w-full max-sm shadow-2xl animate-in zoom-in-95">
              <h3 className="text-xl font-black text-slate-900 mb-6 flex items-center gap-3"><Target className="text-emerald-500" size={24}/> 年度招商总目标</h3>
              <div className="space-y-6">
                 <div>
                    <label className="block text-[11px] font-black text-slate-400 mb-2 uppercase tracking-widest">设定目标去化面积 (m²)</label>
                    <input type="number" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-xl font-black outline-none focus:ring-4 focus:ring-indigo-50" value={tempTarget} onChange={e=>setTempTarget(Number(e.target.value))}/>
                 </div>
                 <div className="flex gap-3">
                    <button onClick={()=>setIsTargetModalOpen(false)} className="flex-1 py-4 text-slate-400 font-bold">取消</button>
                    <button onClick={()=>{ onUpdateTarget(tempTarget); setIsTargetModalOpen(false); }} className="flex-2 px-10 py-4 bg-slate-900 text-white rounded-2xl font-black shadow-xl">确认更新目标</button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
           <div className="bg-white p-10 rounded-[3rem] w-full max-w-2xl shadow-2xl animate-in zoom-in-95 flex flex-col h-[85vh] overflow-hidden">
              <div className="flex justify-between items-center mb-8 shrink-0">
                 <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3"><UserPlus className="text-indigo-600" size={28}/> 新客户入库录入</h2>
                 <button onClick={()=>setIsAddModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full"><X/></button>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
                 <div className="grid grid-cols-2 gap-8">
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-2 uppercase tracking-widest">企业名称 *</label>
                        <input className="w-full border border-slate-200 rounded-2xl p-4 text-sm font-bold bg-slate-50 focus:bg-white outline-none focus:ring-4 focus:ring-indigo-50 transition-all" value={newOppForm.companyName} onChange={e=>setNewOppForm({...newOppForm, companyName:e.target.value})} placeholder="例如：上海某某科技有限公司"/>
                    </div>
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-2 uppercase tracking-widest">所属行业</label>
                        <input className="w-full border border-slate-200 rounded-2xl p-4 text-sm font-bold bg-slate-50 focus:bg-white outline-none focus:ring-4 focus:ring-indigo-50 transition-all" value={newOppForm.industry} onChange={e=>setNewOppForm({...newOppForm, industry:e.target.value})} placeholder="例如：人工智能 / 医疗器械"/>
                    </div>
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-2 uppercase tracking-widest">需求面积 (m²) *</label>
                        <input type="number" className="w-full border border-slate-200 rounded-2xl p-4 text-sm font-bold bg-slate-50 focus:bg-white outline-none focus:ring-4 focus:ring-indigo-50 transition-all" value={newOppForm.requiredArea || ''} onChange={e=>setNewOppForm({...newOppForm, requiredArea:Number(e.target.value)})}/>
                    </div>
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-2 uppercase tracking-widest">预计入驻日期</label>
                        <input type="date" className="w-full border border-slate-200 rounded-2xl p-4 text-sm font-bold bg-slate-50 focus:bg-white outline-none focus:ring-4 focus:ring-indigo-50 transition-all" value={newOppForm.moveInDate} onChange={e=>setNewOppForm({...newOppForm, moveInDate:e.target.value})}/>
                    </div>
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-2 uppercase tracking-widest">商机来源</label>
                        <div className="grid grid-cols-3 gap-3">
                          {Object.values(OpportunitySource).map(source => (
                            <button
                              key={source}
                              type="button"
                              onClick={() => setNewOppForm({...newOppForm, source: source})}
                              className={`px-3 py-2.5 rounded-xl font-bold text-xs transition-all leading-tight min-h-[44px] flex items-center justify-center ${
                                newOppForm.source === source
                                  ? 'bg-indigo-600 text-white shadow-lg scale-105'
                                  : 'bg-white text-slate-700 hover:bg-slate-50 border-2 border-slate-300 hover:border-indigo-300'
                              }`}
                            >
                              {source}
                            </button>
                          ))}
                        </div>
                    </div>
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-2 uppercase tracking-widest">意向等级</label>
                        <div className="grid grid-cols-3 gap-3">
                          {Object.values(OpportunityIntent).map(intent => (
                            <button
                              key={intent}
                              type="button"
                              onClick={() => setNewOppForm({...newOppForm, intent: intent})}
                              className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all ${
                                newOppForm.intent === intent
                                  ? 'bg-emerald-600 text-white shadow-lg scale-105'
                                  : 'bg-white text-slate-700 hover:bg-slate-50 border-2 border-slate-300 hover:border-emerald-300'
                              }`}
                            >
                              {intent}
                            </button>
                          ))}
                        </div>
                    </div>
                 </div>

                 {/* 園区客户转介绍 - 关联房号 */}
                 {newOppForm.source === OpportunitySource.REFERRAL && (
                    <div className="bg-purple-50 p-6 rounded-3xl space-y-4 animate-in slide-in-from-top-2">
                        <h4 className="text-[11px] font-black text-purple-600 uppercase tracking-widest flex items-center gap-2">
                          <Building2 size={14}/> 关联转介绍房源
                        </h4>
                        
                        {/* 搜索输入框 */}
                        <div className="relative">
                          <label className="block text-[10px] font-black text-purple-400 mb-2">🔍 搜索转介绍房源（楼栋/房号/租户）</label>
                          <input 
                            type="text" 
                            className="w-full border-2 border-purple-200 rounded-xl p-3 text-sm font-medium outline-none focus:border-purple-400 bg-white"
                            placeholder="输入关键字搜索..."
                            value={referralSearchText}
                            onChange={e => setReferralSearchText(e.target.value)}
                          />
                          
                          {/* 智能提示：显示匹配的房源 */}
                          {referralSearchText.trim() && filteredReferralUnits.length > 0 && (
                            <div className="absolute z-50 w-full mt-2 bg-white rounded-xl border-2 border-purple-200 shadow-2xl max-h-64 overflow-y-auto">
                              <div className="p-3 bg-purple-50 border-b border-purple-100">
                                <p className="text-xs font-black text-purple-600 flex items-center gap-2">
                                  <AlertCircle size={14}/> 找到 {filteredReferralUnits.length} 个相关房源
                                </p>
                              </div>
                              <div className="divide-y divide-slate-100">
                                {filteredReferralUnits.slice(0, 5).map(unit => (
                                  <div 
                                    key={unit.id} 
                                    onClick={() => {
                                      setNewOppForm({...newOppForm, referralClientId: unit.id});
                                      setReferralSearchText('');
                                    }}
                                    className="p-3 hover:bg-purple-50 cursor-pointer transition-all group"
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex-1">
                                        <div className="text-sm font-black text-slate-900 group-hover:text-purple-600">
                                          {unit.building}-{unit.roomNo}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-1">
                                          租户: {unit.tenantName || '未知'} | 面积: {unit.area} ㎡
                                        </div>
                                      </div>
                                      <div className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-lg font-bold">
                                        点击选择
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        
                        {/* 下拉选择框（保留作为备选） */}
                        <div>
                          <label className="block text-[10px] font-black text-purple-400 mb-2">选择转介绍房源（已入驻客户）</label>
                          <select 
                            className="w-full border-2 border-purple-200 rounded-xl p-3 text-sm font-bold bg-white outline-none focus:border-purple-400"
                            value={newOppForm.referralClientId || ''}
                            onChange={e => setNewOppForm({...newOppForm, referralClientId: e.target.value})}
                          >
                            <option value="">选择转介绍房源...</option>
                            {filteredReferralUnits.map(u => (
                              <option key={u.id} value={u.id}>
                                {u.building}-{u.roomNo} ({u.tenantName})
                              </option>
                            ))}
                          </select>
                          <p className="text-[10px] text-purple-500 mt-2 flex items-center gap-1">
                            <Info size={10}/> 仅显示已出租房源 ({filteredReferralUnits.length} 个)
                          </p>
                        </div>
                    </div>
                 )}

                 {newOppForm.source === OpportunitySource.CHANNEL && (
                    <div className="bg-indigo-50 p-6 rounded-3xl space-y-6 animate-in slide-in-from-top-2">
                        <h4 className="text-[11px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-2"><Link size={14}/> 渠道及联系人关联</h4>
                        
                        {/* 渠道搜索框 */}
                        <div className="relative">
                          <label className="block text-[10px] font-black text-indigo-400 mb-2">🔍 搜索渠道（名称/联系人/电话）</label>
                          <input 
                            type="text" 
                            className="w-full border-2 border-indigo-200 rounded-xl p-3 text-sm font-medium outline-none focus:border-indigo-400 bg-white"
                            placeholder="输入关键字搜索渠道..."
                            value={channelSearchText}
                            onChange={e => setChannelSearchText(e.target.value)}
                          />
                          
                          {/* 智能提示：显示匹配的渠道 */}
                          {channelSearchText.trim() && filteredChannels.length > 0 && (
                            <div className="absolute z-50 w-full mt-2 bg-white rounded-xl border-2 border-indigo-200 shadow-2xl max-h-64 overflow-y-auto">
                              <div className="p-3 bg-indigo-50 border-b border-indigo-100">
                                <p className="text-xs font-black text-indigo-600 flex items-center gap-2">
                                  <AlertCircle size={14}/> 找到 {filteredChannels.length} 个相关渠道
                                </p>
                              </div>
                              <div className="divide-y divide-slate-100">
                                {filteredChannels.slice(0, 5).map(channel => (
                                  <div 
                                    key={channel.id} 
                                    onClick={() => {
                                      setNewOppForm({...newOppForm, channelId: channel.id, agentId: ''});
                                      setChannelSearchText('');
                                    }}
                                    className="p-3 hover:bg-indigo-50 cursor-pointer transition-all group"
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex-1">
                                        <div className="text-sm font-black text-slate-900 group-hover:text-indigo-600">{channel.companyName}</div>
                                        <div className="text-xs text-slate-500 mt-1">
                                          {channel.agents && channel.agents.length > 0 && (
                                            <>
                                              联系人: {channel.agents.map(a => a.name).filter(Boolean).join(', ')}
                                              {channel.agents.some(a => a.phone) && (
                                                <> | {channel.agents.find(a => a.phone)?.phone}</>
                                              )}
                                            </>
                                          )}
                                          {(!channel.agents || channel.agents.length === 0) && '暂无联系人'}
                                        </div>
                                      </div>
                                      <div className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded-lg font-bold">
                                        点击选择
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {!isAdmin && (
                            <p className="text-[10px] text-indigo-500 mt-1 flex items-center gap-1">
                              <Info size={10}/> 当前仅显示您创建的渠道（管理员可见所有）
                            </p>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="block text-[10px] font-black text-indigo-400 mb-2">合作商机构 ({filteredChannels.length})</label>
                                <select className="w-full border border-indigo-100 rounded-xl p-3 text-sm font-bold bg-white" value={newOppForm.channelId} onChange={e=>setNewOppForm({...newOppForm, channelId:e.target.value, agentId:''})}>
                                   <option value="">选择渠道商...</option>
                                   {filteredChannels.map(c=><option key={c.id} value={c.id}>{c.companyName}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-indigo-400 mb-2">对接经办人</label>
                                <select className="w-full border border-indigo-100 rounded-xl p-3 text-sm font-bold bg-white" value={newOppForm.agentId} onChange={e=>setNewOppForm({...newOppForm, agentId:e.target.value})}>
                                   <option value="">选择对接人...</option>
                                   {channels.find(c=>c.id === newOppForm.channelId)?.agents.map(a=><option key={a.id} value={a.id}>{a.name} ({a.phone})</option>)}
                                </select>
                            </div>
                        </div>
                    </div>
                 )}
              </div>

              <div className="mt-8 flex justify-end gap-4 shrink-0 pt-6 border-t">
                 <button onClick={()=>setIsAddModalOpen(false)} className="px-8 py-3 text-slate-400 font-bold">放弃</button>
                 <button onClick={handleCreateOpportunity} className="bg-indigo-600 text-white px-12 py-3 rounded-2xl font-black shadow-xl shadow-indigo-100 active:scale-95 transition-all">创建商机档案</button>
              </div>
           </div>
        </div>
      )}

      {isLostModalOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white p-10 rounded-[3rem] w-full max-w-md shadow-2xl animate-in zoom-in-95">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-xl font-black text-slate-900 flex items-center gap-3"><Ban className="text-rose-500" size={24}/> 流失原因归档</h3>
                <button onClick={()=>setIsLostModalOpen(false)}><X className="text-slate-400"/></button>
              </div>
              <p className="text-xs font-bold text-slate-500 mb-6">请注明该意向客户流失的具体业务细节，以便后期进行全园招商复盘分析。</p>
              <textarea className="w-full border-2 border-slate-100 rounded-2xl p-5 text-sm font-medium h-40 focus:ring-4 focus:ring-rose-50 outline-none" placeholder="例如：客户因价格因素最终选择了张江科学城..." value={lossReason} onChange={e=>setLossReason(e.target.value)}/>
              <div className="mt-8 flex gap-4">
                <button onClick={()=>setIsLostModalOpen(false)} className="flex-1 py-4 text-slate-400 font-black text-xs uppercase">取消</button>
                <button onClick={handleConfirmLost} className="flex-2 px-10 py-4 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase shadow-xl shadow-rose-100">确认移入流失库</button>
              </div>
           </div>
        </div>
      )}

      {/* 编辑商机 Modal */}
      {isEditOppModalOpen && selectedOpp && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-5xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-in zoom-in-95">
            <div className="px-10 py-6 border-b flex justify-between items-center shrink-0 bg-white">
              <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3">
                <Edit3 size={24} className="text-indigo-600"/> 编辑商机信息
              </h2>
              <button onClick={() => setIsEditOppModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full"><X size={24}/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-10 space-y-6 custom-scrollbar">
              {/* 基本信息 */}
              <div className="space-y-4">
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <Briefcase size={18} className="text-indigo-600"/> 基本信息
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-slate-600 mb-2">企业名称 *</label>
                    <input 
                      className="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-medium outline-none focus:border-indigo-400" 
                      value={editOppForm.companyName || ''} 
                      onChange={e => setEditOppForm({...editOppForm, companyName: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-600 mb-2">行业</label>
                    <input 
                      className="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-medium outline-none focus:border-indigo-400" 
                      value={editOppForm.industry || ''} 
                      onChange={e => setEditOppForm({...editOppForm, industry: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-600 mb-2">需求面积（㎡）</label>
                    <input 
                      type="number" 
                      className="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-medium outline-none focus:border-indigo-400" 
                      value={editOppForm.requiredArea || 0} 
                      onChange={e => setEditOppForm({...editOppForm, requiredArea: Number(e.target.value)})}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-600 mb-2">预算（元/㎡/天）</label>
                    <input 
                      type="number" 
                      className="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-medium outline-none focus:border-indigo-400" 
                      value={editOppForm.budget || 0} 
                      onChange={e => setEditOppForm({...editOppForm, budget: Number(e.target.value)})}
                    />
                  </div>
                </div>
              </div>

              {/* 关联房源 */}
              <div className="space-y-4">
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <Building2 size={18} className="text-emerald-600"/> 关联房源
                </h3>
                <div className="border-2 border-slate-200 rounded-2xl p-6 bg-slate-50">
                  <div className="mb-4">
                    <h4 className="text-sm font-black text-emerald-600 mb-3 flex items-center gap-2">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full"/> 待租房源
                    </h4>
                    <div className="max-h-48 overflow-y-auto space-y-2 custom-scrollbar">
                      {units.filter(u => u.status === UnitStatus.VACANT).map(unit => {
                        const isSelected = editOppForm.relatedUnitIds?.includes(unit.id);
                        return (
                          <label key={unit.id} className="flex items-center gap-3 p-3 bg-white rounded-xl hover:bg-emerald-50 cursor-pointer border-2 border-transparent hover:border-emerald-200 transition-all">
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={(e) => {
                                const current = editOppForm.relatedUnitIds || [];
                                if (e.target.checked) {
                                  setEditOppForm({...editOppForm, relatedUnitIds: [...current, unit.id]});
                                } else {
                                  setEditOppForm({...editOppForm, relatedUnitIds: current.filter(id => id !== unit.id)});
                                }
                              }}
                              className="w-4 h-4"
                            />
                            <span className="text-sm font-bold text-slate-700">{unit.building}-{unit.roomNo}</span>
                            <span className="text-xs text-slate-400">{unit.area}㎡</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-black text-slate-400 mb-3 flex items-center gap-2">
                      <div className="w-2 h-2 bg-slate-400 rounded-full"/> 已出租房源（只读）
                    </h4>
                    <div className="max-h-48 overflow-y-auto space-y-2 custom-scrollbar opacity-60">
                      {units.filter(u => u.status === UnitStatus.OCCUPIED).map(unit => (
                        <div key={unit.id} className="flex items-center gap-3 p-3 bg-slate-100 rounded-xl">
                          <input type="checkbox" disabled className="w-4 h-4" />
                          <span className="text-sm font-bold text-slate-500">{unit.building}-{unit.roomNo}</span>
                          <span className="text-xs text-slate-400">{unit.area}㎡</span>
                          <span className="text-[10px] px-2 py-0.5 bg-slate-300 text-slate-600 rounded-full font-bold">已租</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-10 py-6 border-t flex gap-4 shrink-0 bg-white">
              <button onClick={() => setIsEditOppModalOpen(false)} className="flex-1 py-4 text-slate-400 font-black text-xs uppercase">取消</button>
              <button onClick={handleUpdateOpportunity} className="flex-2 px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase shadow-xl shadow-indigo-100">保存修改</button>
            </div>
          </div>
        </div>
      )}

      {isSignModalOpen && selectedOpp && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
           <div className="bg-white rounded-[2rem] w-full max-w-5xl shadow-2xl flex flex-col h-[92vh] overflow-hidden animate-in zoom-in-95">
              <div className="px-10 py-6 border-b flex justify-between items-center shrink-0 bg-white">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600"><UsersIcon size={20}/></div>
                    <h3 className="text-xl font-black text-slate-800">新增租赁签约</h3>
                </div>
                <button onClick={()=>setIsSignModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400"><X size={28}/></button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar bg-[#f8fafc]/30">
                 <section className="bg-white border border-slate-100 rounded-2xl p-8 shadow-sm space-y-8">
                    <div className="flex items-center gap-2.5 text-indigo-600 border-b border-slate-50 pb-4"><FileText size={18}/><h4 className="text-sm font-black tracking-tight">核心签约信息</h4></div>
                    <div className="grid grid-cols-2 gap-x-12 gap-y-6">
                       <div className="col-span-1">
                          <label className="block text-[11px] font-black text-slate-500 mb-2">企业名称 *</label>
                          <input className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold bg-slate-50/30" value={selectedOpp.companyName} readOnly/>
                       </div>
                       <div className="col-span-1">
                          <label className="block text-[11px] font-black text-slate-500 mb-2">所属楼宇 *</label>
                          <select className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold bg-white" value={signForm.buildingName} onChange={e=>setSignForm({...signForm, buildingName:e.target.value})}>
                            <option value="">选择楼宇...</option>
                            {Array.from(new Set(units.map(u=>u.building))).map(b=><option key={b} value={b}>{b}</option>)}
                          </select>
                       </div>
                       <div className="col-span-2">
                          <label className="block text-[11px] font-black text-slate-500 mb-2">租赁单元 *</label>
                          <div className="p-4 border border-slate-200 rounded-xl bg-slate-50/30 flex flex-wrap gap-2.5">
                             {units.filter(u => u.building === signForm.buildingName && (u.status === UnitStatus.VACANT || signForm.unitIds?.includes(u.id))).map(u => (
                               <button key={u.id} onClick={() => {
                                    const ids = signForm.unitIds || [];
                                    const newIds = ids.includes(u.id) ? ids.filter(i=>i!==u.id) : [...ids, u.id];
                                    const newArea = units.filter(un=>newIds.includes(un.id)).reduce((s,un)=>s+un.area, 0);
                                    setSignForm({...signForm, unitIds: newIds, finalArea: Number(newArea.toFixed(2))});
                                 }} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border ${signForm.unitIds?.includes(u.id) ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-100' : 'bg-white border-slate-200 text-slate-500'}`}>{u.roomNo} ({u.area}㎡)</button>
                             ))}
                             {(!signForm.buildingName || units.filter(u=>u.building===signForm.buildingName).length === 0) && <span className="text-xs text-slate-400 py-1 font-medium italic">请先选择所属楼宇以加载空置房源...</span>}
                          </div>
                       </div>
                       <div className="grid grid-cols-3 col-span-2 gap-6">
                          <div>
                            <label className="block text-[11px] font-black text-slate-500 mb-2">签约日期 *</label>
                            <input type="date" className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold" value={signForm.signDate} onChange={e=>setSignForm({...signForm, signDate:e.target.value})}/>
                          </div>
                          <div>
                            <label className="block text-[11px] font-black text-slate-500 mb-2">起租日期 *</label>
                            <input type="date" className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold" value={signForm.leaseStartDate} onChange={e=>setSignForm({...signForm, leaseStartDate:e.target.value})}/>
                          </div>
                          <div>
                            <label className="block text-[11px] font-black text-slate-500 mb-2">结束日期 *</label>
                            <input type="date" className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold" value={signForm.leaseEndDate} onChange={e=>setSignForm({...signForm, leaseEndDate:e.target.value})}/>
                          </div>
                       </div>
                    </div>
                 </section>

                 <section className="bg-white border border-slate-100 rounded-2xl p-8 shadow-sm space-y-8">
                    <div className="flex items-center gap-2.5 text-emerald-600 border-b border-slate-50 pb-4"><DollarSign size={18}/><h4 className="text-sm font-black tracking-tight">租金单价与支付</h4></div>
                    <div className="grid grid-cols-3 gap-8">
                       <div>
                          <label className="block text-[11px] font-black text-slate-500 mb-2">日租金单价 (元/㎡/天)</label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">¥</span>
                            <input type="number" step="0.01" className="w-full border border-slate-200 rounded-xl p-3.5 pl-8 text-sm font-black" value={signForm.finalPrice || ''} onChange={e=>setSignForm({...signForm, finalPrice:Number(e.target.value)})}/>
                          </div>
                       </div>
                       <div>
                          <label className="block text-[11px] font-black text-slate-500 mb-2">月租金总额 (预估)</label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">¥</span>
                            <input type="number" className="w-full border border-slate-200 rounded-xl p-3.5 pl-8 text-sm font-black bg-slate-50/50" value={signForm.monthlyRent} readOnly/>
                          </div>
                       </div>
                       <div>
                          <label className="block text-[11px] font-black text-slate-500 mb-2">支付频率</label>
                          <select className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold" value={signForm.paymentCycleMonths} onChange={e=>setSignForm({...signForm, paymentCycleMonths:Number(e.target.value)})}>
                            <option value={1}>月付</option>
                            <option value={3}>季付</option>
                            <option value={6}>半年付</option>
                            <option value={12}>年付</option>
                          </select>
                       </div>
                       <div>
                          <label className="block text-[11px] font-black text-slate-500 mb-2">首期支付日</label>
                          <input type="date" className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold" value={signForm.firstPaymentDate} onChange={e=>setSignForm({...signForm, firstPaymentDate:e.target.value})}/>
                       </div>
                       <div>
                          <label className="block text-[11px] font-black text-slate-500 mb-2">押金金额</label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">¥</span>
                            <input type="number" className="w-full border border-slate-200 rounded-xl p-3.5 pl-8 text-sm font-black" value={signForm.depositAmount} onChange={e=>setSignForm({...signForm, depositAmount:e.target.value})}/>
                          </div>
                       </div>
                       <div>
                          <label className="block text-[11px] font-black text-slate-500 mb-2">押金状态</label>
                          <select className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold" value={signForm.depositStatus} onChange={e=>setSignForm({...signForm, depositStatus:e.target.value})}>
                            <option value="待缴">待缴</option>
                            <option value="已缴">已缴</option>
                            <option value="部分缴清">部分缴清</option>
                          </select>
                       </div>
                    </div>
                 </section>

                 <section className="bg-white border border-slate-100 rounded-2xl p-8 shadow-sm space-y-6">
                    <div className="flex justify-between items-center border-b border-slate-50 pb-4">
                       <div className="flex items-center gap-2.5 text-indigo-600"><Gift size={18}/><h4 className="text-sm font-black tracking-tight">免租期设定</h4></div>
                       <button onClick={addRentFreeRow} className="bg-indigo-50 text-indigo-600 px-4 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-1.5 hover:bg-indigo-100 transition-all"><Plus size={14}/> 添加免租段</button>
                    </div>
                    {signForm.rentFreePeriods?.length === 0 ? (
                      <div className="py-12 flex flex-col items-center justify-center border-2 border-dashed border-slate-100 rounded-2xl text-slate-300">
                         <p className="text-xs font-bold italic tracking-wider">暂未设定免租期</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                         {signForm.rentFreePeriods?.map((rf, idx) => (
                           <div key={rf.id} className="flex items-center gap-6 p-4 bg-slate-50 rounded-xl group animate-in slide-in-from-left-2">
                              <span className="w-8 h-8 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center shrink-0">{idx+1}</span>
                              <div className="flex-1 grid grid-cols-2 gap-4">
                                 <input type="date" className="w-full border border-slate-200 rounded-lg p-2.5 text-xs font-bold" value={rf.startDate} onChange={e => {
                                    const newList = [...(signForm.rentFreePeriods || [])];
                                    newList[idx].startDate = e.target.value;
                                    setSignForm({...signForm, rentFreePeriods: newList});
                                 }}/>
                                 <input type="date" className="w-full border border-slate-200 rounded-lg p-2.5 text-xs font-bold" value={rf.endDate} onChange={e => {
                                    const newList = [...(signForm.rentFreePeriods || [])];
                                    newList[idx].endDate = e.target.value;
                                    setSignForm({...signForm, rentFreePeriods: newList});
                                 }}/>
                              </div>
                              <button onClick={() => setSignForm({...signForm, rentFreePeriods: signForm.rentFreePeriods?.filter(p => p.id !== rf.id)})} className="p-2 text-rose-300 hover:text-rose-600 transition-colors"><Trash2 size={16}/></button>
                           </div>
                         ))}
                      </div>
                    )}
                 </section>

                 <section className="bg-white border border-slate-100 rounded-2xl p-8 shadow-sm space-y-10">
                    <div className="flex items-center gap-2.5 text-rose-600 border-b border-slate-50 pb-4"><Shield size={18}/><h4 className="text-sm font-black tracking-tight">客户背景与风险管理</h4></div>
                    <div className="grid grid-cols-2 gap-x-12 gap-y-8">
                       <div className="space-y-6">
                          <div>
                            <label className="block text-[11px] font-black text-slate-500 mb-2">所属行业</label>
                            <input className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold" value={signForm.industry} onChange={e=>setSignForm({...signForm, industry:e.target.value})} placeholder="例如：人工智能 / 医疗器械"/>
                          </div>
                          <div>
                            <label className="block text-[11px] font-black text-slate-500 mb-2">企业成立日期</label>
                            <input type="date" className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold" value={signForm.establishedDate} onChange={e=>setSignForm({...signForm, establishedDate:e.target.value})}/>
                          </div>
                          <div>
                            <label className="block text-[11px] font-black text-slate-500 mb-2">企业法人</label>
                            <input className="w-full border border-slate-200 rounded-xl p-3.5 text-sm font-bold" value={signForm.legalRepresentative} onChange={e=>setSignForm({...signForm, legalRepresentative:e.target.value})}/>
                          </div>
                       </div>
                       <div className="space-y-6 flex flex-col">
                          <div className={`p-6 rounded-2xl border transition-all flex items-start gap-4 ${signForm.isHighRisk ? 'bg-rose-50 border-rose-200 shadow-lg shadow-rose-100/30' : 'bg-slate-50 border-slate-100'}`}>
                             <input type="checkbox" className="mt-1 w-5 h-5 rounded-lg border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer" checked={signForm.isHighRisk} onChange={e=>setSignForm({...signForm, isHighRisk:e.target.checked})}/>
                             <div>
                                <h5 className={`text-sm font-black mb-1 ${signForm.isHighRisk ? 'text-rose-700' : 'text-slate-700'}`}>高风险客户监控</h5>
                                <p className="text-[10px] text-slate-400 font-bold leading-relaxed">勾选后将在看板重点标记，建议加强租金催缴频率。</p>
                             </div>
                             {signForm.isHighRisk && <ShieldAlert className="text-rose-600 ml-auto shrink-0" size={24}/>}
                          </div>
                          <div className="flex-1 flex flex-col">
                             <label className="block text-[11px] font-black text-slate-500 mb-2">特殊要求 / 备注信息</label>
                             <textarea className="w-full border border-slate-200 rounded-xl p-5 text-xs font-medium flex-1 resize-none focus:ring-4 focus:ring-slate-50 outline-none" placeholder="记录任何非标合同条款、装修要求、特殊配套需求等..." value={signForm.remarks} onChange={e=>setSignForm({...signForm, remarks:e.target.value})}/>
                          </div>
                       </div>
                    </div>
                 </section>
              </div>
              
              <div className="p-8 border-t bg-slate-50 flex justify-end gap-4 shrink-0">
                <button onClick={()=>setIsSignModalOpen(false)} className="px-10 py-4 text-slate-400 font-black text-sm uppercase tracking-widest hover:text-slate-600 transition-colors">取消</button>
                <button onClick={handleSignConfirm} className="bg-indigo-600 text-white px-16 py-4 rounded-xl font-black text-sm shadow-2xl shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95 flex items-center gap-3">
                    <Save size={18}/> 保存并退出
                </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

const PlusCircle = ({ className, size }: { className?: string, size?: number }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/>
  </svg>
);