
import React, { useState, useMemo } from 'react';
import { CommissionStatus, Channel, AgentTier, Commission, Opportunity, OpportunityStage, Activity, ActivityType, Agent, User } from '../types';
import { Building, Edit3, Plus, Users as UsersIcon, Trash2, Globe, Target, Wallet, TrendingUp, X, Briefcase, Medal, Search, Clock, CheckCircle2, FileText, AlertCircle, LayoutGrid, Calendar, Edit, DollarSign, UserPlus, Phone, User as UserIcon, MoreVertical, ShieldCheck, AreaChart, Merge, Filter, Footprints, MousePointer2, Shield, Lock, UserCheck } from 'lucide-react';

interface ChannelPRMProps {
  currentUser: User;
  isAdmin: boolean;
  users?: User[]; // 新增：用于人员选择
  channels: Channel[];
  commissions: Commission[];
  opportunities: Opportunity[];
  activities: Activity[];
  onAddChannel: (channel: Channel) => void;
  onUpdateChannel: (channel: Channel) => void;
  onUpdateCommission: (commission: Commission) => void;
  onDeleteChannel?: (id: string) => void;
  onDeleteCommission?: (id: string) => void;
}

export const ChannelPRM: React.FC<ChannelPRMProps> = ({ currentUser, isAdmin, users = [], channels = [], commissions = [], opportunities = [], activities = [], onAddChannel, onUpdateChannel, onUpdateCommission, onDeleteChannel, onDeleteCommission }) => {
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'ADD' | 'EDIT'>('ADD');
  const [isCommEditModalOpen, setIsCommEditModalOpen] = useState(false);
  const [editingCommission, setEditingCommission] = useState<Partial<Commission> | null>(null);
  
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Partial<Agent>>({});
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [selectedMergeChannels, setSelectedMergeChannels] = useState<string[]>([]);

  const [editingForm, setEditingForm] = useState<Partial<Channel>>({ 
    companyName: '', tier: AgentTier.POTENTIAL, baseCommissionRate: 1.0, description: '', agents: [], sharedWithIds: []
  });

  // 关键修复：构建有效用户列表 (Effective Users List)
  // 优先使用 props 传入的 users，如果为空（可能由于渲染时机或状态同步延迟），则尝试从 localStorage 降级读取
  const effectiveUsers = useMemo(() => {
    if (users && users.length > 0) return users;
    try {
        const cached = localStorage.getItem('park_leasing_data');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.users && Array.isArray(parsed.users) && parsed.users.length > 0) {
                return parsed.users as User[];
            }
        }
    } catch (e) {
        console.warn("Failed to load users from cache fallback", e);
    }
    return [];
  }, [users]);

  const getChannelStats = (channelId: string) => {
    const currentYear = new Date().getFullYear();
    const currentMonthStr = new Date().toISOString().slice(0, 7);

    const myOpps = (opportunities || []).filter(o => o.channelId === channelId);
    const myComms = (commissions || []).filter(c => c.channelId === channelId);
    const myVisits = (activities || []).filter(a => a.type === ActivityType.VISIT && myOpps.some(o => o.id === a.opportunityId));
    
    const deals = myOpps.filter(o => o.stage === OpportunityStage.CONTRACT).map(o => {
       const comm = myComms.find(c => c.contractId === o.id);
       return { ...o, commission: comm };
    });

    const yearDeals = deals.filter(d => d.dealParams && new Date(d.dealParams.signDate).getFullYear() === currentYear);
    const ytdArea = yearDeals.reduce((sum, d) => sum + (d.dealParams?.finalArea || 0), 0);
    const ytdVisits = myVisits.filter(a => new Date(a.date).getFullYear() === currentYear).length;

    const monthDeals = deals.filter(d => d.dealParams && d.dealParams.signDate.startsWith(currentMonthStr));
    const mtdArea = monthDeals.reduce((sum, d) => sum + (d.dealParams?.finalArea || 0), 0);
    const mtdVisits = myVisits.filter(a => a.date.startsWith(currentMonthStr)).length;

    const lastVisit = myVisits.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const lastDeal = deals.filter(d=>d.dealParams).sort((a,b) => new Date(b.dealParams!.signDate).getTime() - new Date(a.dealParams!.signDate).getTime())[0];
    
    let latestActionDate = '无动作';
    if (lastVisit && lastDeal) {
      latestActionDate = new Date(lastVisit.date) > new Date(lastDeal.dealParams!.signDate) ? lastVisit.date : lastDeal.dealParams!.signDate;
    } else {
      latestActionDate = lastVisit?.date || lastDeal?.dealParams?.signDate || '暂无跟进';
    }

    const totalSettledComm = myComms.filter(c => c.status === CommissionStatus.PAID).reduce((sum, c) => sum + c.amount, 0);
    const totalUnpaidComm = myComms.filter(c => c.status !== CommissionStatus.PAID).reduce((sum, c) => sum + c.amount, 0);
    
    return { 
      deals, 
      hasRecentDeal: yearDeals.length > 0,
      mtdArea, mtdVisits,
      ytdArea, ytdVisits,
      latestActionDate,
      totalDealsArea: deals.reduce((sum, d) => sum + (d.dealParams?.finalArea || 0), 0),
      totalSettledComm, totalUnpaidComm,
      yearOpps: myOpps.filter(o => new Date(o.createdAt).getFullYear() === currentYear).length
    };
  };

  const getOwnerName = (id?: string) => {
      if (!id) return '未知';
      return effectiveUsers.find(u => u.id === id)?.name || '未知人员';
  };

  const visibleChannels = useMemo(() => {
    let base = isAdmin ? channels : channels.filter(c => 
        c.creatorId === currentUser.id || 
        (c.sharedWithIds && c.sharedWithIds.includes(currentUser.id))
    );
    
    const filtered = searchTerm ? base.filter(c => 
      c.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.agents.some(a => a.name.includes(searchTerm)) ||
      getOwnerName(c.creatorId).includes(searchTerm)
    ) : base;

    return filtered.sort((a, b) => {
       const statsA = getChannelStats(a.id);
       const statsB = getChannelStats(b.id);
       if (statsA.hasRecentDeal && !statsB.hasRecentDeal) return -1;
       if (!statsA.hasRecentDeal && statsB.hasRecentDeal) return 1;
       const tierWeights: { [key: string]: number } = { [AgentTier.GOLD]: 3, [AgentTier.POTENTIAL]: 2, [AgentTier.INEFFICIENT]: 1 };
       if (tierWeights[a.tier] !== tierWeights[b.tier]) return tierWeights[b.tier] - tierWeights[a.tier];
       return statsB.ytdArea - statsA.ytdArea;
    });
  }, [channels, isAdmin, currentUser, searchTerm, opportunities, commissions, effectiveUsers]);

  const handleSaveChannel = () => {
    if (!editingForm.companyName) return alert("请填写公司名称");
    const cleanName = editingForm.companyName.trim();
    if (modalMode === 'ADD') {
        const newChannel: Channel = { 
            id: `CH-${Date.now()}-${Math.floor(Math.random() * 10000)}`, 
            creatorId: editingForm.creatorId || currentUser.id,
            sharedWithIds: editingForm.sharedWithIds || [],
            companyName: cleanName, 
            tier: editingForm.tier || AgentTier.POTENTIAL, 
            baseCommissionRate: 1.0, 
            description: editingForm.description, 
            agents: editingForm.agents || [], 
            totalDealsArea: 0, 
            totalCommissionAmt: 0 
        };
        onAddChannel(newChannel);
    } else {
        onUpdateChannel(JSON.parse(JSON.stringify(editingForm)));
    }
    setIsModalOpen(false);
  };

  const handleSaveAgent = () => {
    if (!selectedChannel || !editingAgent.name || !editingAgent.phone) return alert("请填写姓名和联系方式");
    
    const baseChannel = JSON.parse(JSON.stringify(selectedChannel));
    const updatedAgents = [...(baseChannel.agents || [])];
    
    // 1. 检查同一渠道内是否已存在相同手机号的联系人
    const existingAgentInChannel = updatedAgents.find(
      a => a.phone === editingAgent.phone && a.id !== editingAgent.id
    );
    
    if (existingAgentInChannel) {
      const shouldMerge = confirm(
        `⚠️ 同一渠道内已存在该手机号：\n\n` +
        `现有联系人：${existingAgentInChannel.name} - ${existingAgentInChannel.phone}\n` +
        `新联系人：${editingAgent.name} - ${editingAgent.phone}\n\n` +
        `是否合并为一个联系人？（保留现有联系人，更新其信息）`
      );
      
      if (shouldMerge) {
        // 合并：更新现有联系人的信息
        const index = updatedAgents.findIndex(a => a.id === existingAgentInChannel.id);
        if (index > -1) {
          updatedAgents[index] = {
            ...existingAgentInChannel,
            name: editingAgent.name || existingAgentInChannel.name,
            title: editingAgent.title || existingAgentInChannel.title
          };
        }
        
        const updatedChannel = { ...baseChannel, agents: updatedAgents };
        onUpdateChannel(updatedChannel);
        setSelectedChannel(updatedChannel);
        setIsAgentModalOpen(false);
        return;
      } else {
        // 用户选择不合并，终止保存
        return;
      }
    }
    
    // 2. 检查跨渠道是否存在相同手机号的联系人
    const otherChannelsWithSamePhone: {channel: Channel, agent: Agent}[] = [];
    channels.forEach(channel => {
      if (channel.id !== selectedChannel.id && channel.agents) {
        channel.agents.forEach(agent => {
          if (agent.phone === editingAgent.phone) {
            otherChannelsWithSamePhone.push({ channel, agent });
          }
        });
      }
    });
    
    if (otherChannelsWithSamePhone.length > 0) {
      const channelNames = otherChannelsWithSamePhone
        .map(item => `  • ${item.channel.companyName}: ${item.agent.name} - ${item.agent.phone}`)
        .join('\n');
      
      const shouldContinue = confirm(
        `⚠️ 跨渠道联系人重复提示：\n\n` +
        `该手机号已存在于其他渠道：\n${channelNames}\n\n` +
        `请确认是否是同一人？\n` +
        `- 如果是同一人，建议修改其中一个渠道的联系人信息\n` +
        `- 如果不是同一人，点击“确定”继续添加\n\n` +
        `点击“确定”继续，点击“取消”返回修改`
      );
      
      if (!shouldContinue) {
        // 用户选择取消，终止保存
        return;
      }
    }
    
    // 3. 正常保存逻辑
    if (editingAgent.id) {
        const index = updatedAgents.findIndex(a => a.id === editingAgent.id);
        if (index > -1) updatedAgents[index] = { ...editingAgent } as Agent;
    } else {
        updatedAgents.push({ 
          ...editingAgent, 
          id: `A-${Date.now()}-${Math.floor(Math.random() * 1000)}` 
        } as Agent);
    }
    
    const updatedChannel = { ...baseChannel, agents: updatedAgents };
    
    onUpdateChannel(updatedChannel);
    setSelectedChannel(updatedChannel);
    setIsAgentModalOpen(false);
  };

  const handleDeleteChannelClick = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (confirm(`⚠️ 危险操作确认：\n\n确定从系统中彻底注销渠道合作商 [${name}] 吗？该操作不可撤销。`)) {
        if (onDeleteChannel) onDeleteChannel(id);
        if (selectedChannel?.id === id) setSelectedChannel(null);
    }
  };

  const handleOpenEditModal = (channel: Channel) => {
    setModalMode('EDIT');
    setEditingForm(JSON.parse(JSON.stringify(channel)));
    setIsModalOpen(true);
  };

  const handleOpenAgentModal = (agent?: Agent) => {
    setEditingAgent(agent ? { ...agent } : { name: '', phone: '', title: '' });
    setIsAgentModalOpen(true);
  };

  const toggleSharedUser = (userId: string) => {
      const currentShared = editingForm.sharedWithIds || [];
      if (currentShared.includes(userId)) {
          setEditingForm({...editingForm, sharedWithIds: currentShared.filter(id => id !== userId)});
      } else {
          setEditingForm({...editingForm, sharedWithIds: [...currentShared, userId]});
      }
  };

  // 检测重复渠道（名称相同）
  const duplicateChannels = useMemo(() => {
    const nameMap: Record<string, Channel[]> = {};
    channels.forEach(channel => {
      const normalizedName = channel.companyName.trim().toLowerCase();
      if (!nameMap[normalizedName]) nameMap[normalizedName] = [];
      nameMap[normalizedName].push(channel);
    });
    
    // 只返回有重复的组
    return Object.entries(nameMap)
      .filter(([_, channels]) => channels.length > 1)
      .map(([name, channels]) => ({ name, channels }));
  }, [channels]);

  // 合并渠道
  const handleMergeChannels = () => {
    if (selectedMergeChannels.length < 2) {
      alert('请至少选择两个渠道进行合并');
      return;
    }

    const channelsToMerge = channels.filter(c => selectedMergeChannels.includes(c.id));
    if (channelsToMerge.length < 2) return;

    // 选择第一个作为主渠道
    const primaryChannel = channelsToMerge[0];
    const mergedAgents: Agent[] = [...(primaryChannel.agents || [])];
    
    // 统计信息
    let totalAgentsBeforeMerge = 0;
    let duplicateAgentsRemoved = 0;

    // 合并所有联系人，基于手机号去重
    const phoneMap = new Map<string, Agent>();
    
    // 先添加主渠道的联系人
    mergedAgents.forEach(agent => {
      phoneMap.set(agent.phone, agent);
    });
    
    // 合并其他渠道的联系人
    channelsToMerge.slice(1).forEach(channel => {
      totalAgentsBeforeMerge += channel.agents?.length || 0;
      
      channel.agents?.forEach(agent => {
        if (phoneMap.has(agent.phone)) {
          // 手机号重复，计数但不添加
          duplicateAgentsRemoved++;
        } else {
          // 新联系人，添加到合并列表
          phoneMap.set(agent.phone, agent);
          mergedAgents.push(agent);
        }
      });
    });

    totalAgentsBeforeMerge += primaryChannel.agents?.length || 0;
    const finalAgentCount = phoneMap.size;

    // 更新主渠道
    const updatedPrimaryChannel = {
      ...primaryChannel,
      agents: Array.from(phoneMap.values()),
      description: primaryChannel.description || channelsToMerge.find(c => c.description)?.description || ''
    };

    onUpdateChannel(updatedPrimaryChannel);

    // 删除其他渠道
    channelsToMerge.slice(1).forEach(channel => {
      if (onDeleteChannel) onDeleteChannel(channel.id);
    });

    setIsMergeModalOpen(false);
    setSelectedMergeChannels([]);
    
    // 显示详细的合并结果
    alert(
      `✅ 渠道合并成功！\n\n` +
      `合并渠道数：${channelsToMerge.length} 个\n` +
      `合并前联系人总数：${totalAgentsBeforeMerge} 人\n` +
      `去重后联系人数：${finalAgentCount} 人\n` +
      `自动合并重复联系人：${duplicateAgentsRemoved} 人`
    );
  };

  const currentStats = selectedChannel ? getChannelStats(selectedChannel.id) : null;

  // 渠道看板统计数据
  const dashboardStats = useMemo(() => {
    const currentMonthStr = new Date().toISOString().slice(0, 7);
    
    // 渠道总数
    const totalChannels = visibleChannels.length;
    
    // 每个招商经理关联渠道数
    const channelsByManager: Record<string, number> = {};
    visibleChannels.forEach(channel => {
      const ownerId = channel.creatorId;
      channelsByManager[ownerId] = (channelsByManager[ownerId] || 0) + 1;
    });
    
    // 本月活跃渠道数（有商机活动或成交的渠道）
    const activeChannelIds = new Set<string>();
    
    // 统计本月有商机活动的渠道
    activities.forEach(act => {
      if (act.date.startsWith(currentMonthStr)) {
        const opp = opportunities.find(o => o.id === act.opportunityId);
        if (opp?.channelId) {
          activeChannelIds.add(opp.channelId);
        }
      }
    });
    
    // 统计本月有成交的渠道
    opportunities.forEach(opp => {
      if (opp.channelId && opp.stage === OpportunityStage.CONTRACT && opp.dealParams?.signDate.startsWith(currentMonthStr)) {
        activeChannelIds.add(opp.channelId);
      }
    });
    
    // 过滤出可见的活跃渠道
    const visibleChannelIds = new Set(visibleChannels.map(c => c.id));
    const activeChannelsCount = Array.from(activeChannelIds).filter(id => visibleChannelIds.has(id)).length;
    
    return {
      totalChannels,
      channelsByManager,
      activeChannelsCount
    };
  }, [visibleChannels, opportunities, activities]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] relative gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-3"><Wallet className="text-indigo-600"/> 渠道伙伴 PRM 系统</h1>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1 opacity-60">Partner Performance & Commission Settlement Hub</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && duplicateChannels.length > 0 && (
            <button 
              onClick={() => setIsMergeModalOpen(true)} 
              className="bg-amber-500 text-white px-6 py-3.5 rounded-2xl text-sm font-black shadow-lg shadow-amber-100 hover:bg-amber-600 active:scale-95 transition-all flex items-center gap-2"
            >
              <Merge size={18}/> 合并渠道 ({duplicateChannels.length})
            </button>
          )}
          <button onClick={()=>{setModalMode('ADD'); setEditingForm({ companyName:'', tier:AgentTier.POTENTIAL, agents: [], creatorId: currentUser.id, sharedWithIds: [] }); setIsModalOpen(true);}} className="bg-indigo-600 text-white px-8 py-3.5 rounded-2xl text-sm font-black shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2"><Plus size={18}/> 新增合作商</button>
        </div>
      </div>

      {/* 渠道看板 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-sm font-black text-slate-700 uppercase tracking-widest mb-4 flex items-center gap-2">
          <LayoutGrid size={16} className="text-indigo-600"/> 渠道效能看板
        </h2>
        <div className="grid grid-cols-3 gap-6">
          {/* 渠道总数 */}
          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-6 border-2 border-indigo-100">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-indigo-600 rounded-xl shadow-lg">
                <Building size={24} className="text-white"/>
              </div>
              <div className="text-right">
                <div className="text-3xl font-black text-indigo-900">{dashboardStats.totalChannels}</div>
                <div className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mt-1">渠道总数</div>
              </div>
            </div>
            <div className="text-xs text-indigo-600 font-bold">当前系统内渠道合作商总数</div>
          </div>

          {/* 招商经理分布 */}
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl p-6 border-2 border-emerald-100">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-emerald-600 rounded-xl shadow-lg">
                <UsersIcon size={24} className="text-white"/>
              </div>
              <div className="text-right">
                <div className="text-3xl font-black text-emerald-900">{Object.keys(dashboardStats.channelsByManager).length}</div>
                <div className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mt-1">活跃经理</div>
              </div>
            </div>
            <div className="space-y-1 max-h-16 overflow-y-auto custom-scrollbar">
              {Object.entries(dashboardStats.channelsByManager).map(([managerId, count]) => {
                const manager = effectiveUsers.find(u => u.id === managerId);
                return (
                  <div key={managerId} className="flex justify-between items-center text-xs">
                    <span className="text-emerald-700 font-bold">{manager?.name || '未知'}</span>
                    <span className="text-emerald-900 font-black bg-emerald-100 px-2 py-0.5 rounded-full">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 本月活跃渠道 */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-6 border-2 border-amber-100">
            <div className="flex items-start justify-between mb-3">
              <div className="p-3 bg-amber-600 rounded-xl shadow-lg">
                <TrendingUp size={24} className="text-white"/>
              </div>
              <div className="text-right">
                <div className="text-3xl font-black text-amber-900">{dashboardStats.activeChannelsCount}</div>
                <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest mt-1">活跃渠道</div>
              </div>
            </div>
            <div className="text-xs text-amber-600 font-bold">本月有商机活动或成交的渠道</div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 bg-amber-200 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-amber-600 h-full rounded-full transition-all" 
                  style={{ width: `${dashboardStats.totalChannels > 0 ? (dashboardStats.activeChannelsCount / dashboardStats.totalChannels * 100) : 0}%` }}
                />
              </div>
              <span className="text-[10px] font-black text-amber-700">
                {dashboardStats.totalChannels > 0 ? Math.round(dashboardStats.activeChannelsCount / dashboardStats.totalChannels * 100) : 0}%
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        <div className={`flex flex-col bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden transition-all duration-300 ${selectedChannel ? 'w-[450px]' : 'w-full'}`}>
          <div className="p-5 border-b bg-slate-50/30 flex justify-between items-center">
            <div className="relative flex-1 mr-4">
              <Search className="absolute left-4 top-3.5 text-slate-400" size={16}/>
              <input 
                type="text" 
                placeholder="搜索公司名、负责人或归属人..." 
                className="w-full pl-11 pr-4 py-3 bg-white rounded-2xl text-xs outline-none border border-slate-100 font-bold focus:ring-2 focus:ring-indigo-100 transition-all shadow-inner" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="text-[10px] font-black text-slate-300 uppercase tracking-tighter whitespace-nowrap">聚合效能透视</div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
            {visibleChannels.map(channel => {
              const stats = getChannelStats(channel.id);
              const isSelected = selectedChannel?.id === channel.id;
              const ownerName = getOwnerName(channel.creatorId);

              return (
                <div key={channel.id} onClick={() => setSelectedChannel(channel)} className={`p-6 cursor-pointer hover:bg-slate-50 border-l-4 transition-all group relative ${isSelected ? 'bg-indigo-50/20 border-l-indigo-600' : 'border-l-transparent'}`}>
                  {isAdmin && (
                    <button 
                       onClick={(e) => handleDeleteChannelClick(e, channel.id, channel.companyName)}
                       className="absolute top-6 right-6 p-2 text-rose-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100 z-10"
                    >
                       <Trash2 size={16}/>
                    </button>
                  )}
                  
                  <div className="flex items-start gap-5 mb-4 pr-8">
                    <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg shrink-0 relative overflow-hidden">
                       <Building size={24}/>
                       {stats.hasRecentDeal && <div className="absolute top-0 right-0 w-4 h-4 bg-emerald-500 border-2 border-slate-900 rounded-bl-xl shadow-sm"></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-black text-slate-900 text-sm truncate max-w-[140px]">{channel.companyName}</h3>
                        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border leading-none ${channel.tier === AgentTier.GOLD ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>{channel.tier}级</span>
                        <span className="text-[8px] font-black text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <UserCheck size={8}/> {ownerName}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1"><Clock size={10}/> 最近动态: <span className="font-mono text-slate-600">{stats.latestActionDate}</span></span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-4 bg-white/50 p-3 rounded-2xl border border-slate-100 group-hover:border-indigo-100 transition-all">
                      <div className="space-y-1">
                         <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">本月贡献 (MTD)</p>
                         <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-indigo-600">{stats.mtdArea.toLocaleString()} ㎡</span>
                            <span className="text-[9px] font-bold text-slate-400">/ {stats.mtdVisits} 带看</span>
                         </div>
                      </div>
                      <div className="space-y-1 border-l pl-3">
                         <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">本年贡献 (YTD)</p>
                         <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-700">{stats.ytdArea.toLocaleString()} ㎡</span>
                            <span className="text-[9px] font-bold text-slate-400">/ {stats.ytdVisits} 带看</span>
                         </div>
                      </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {selectedChannel && currentStats ? (
          <div className="flex-1 bg-white rounded-[2rem] border border-slate-200 shadow-sm flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-300">
             <div className="p-10 border-b bg-slate-900 flex justify-between items-center shrink-0 text-white">
                <div className="flex items-center gap-8">
                  <div className="w-24 h-24 bg-indigo-600 rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-indigo-500/20"><Building size={48}/></div>
                  <div>
                    <div className="flex items-center gap-3">
                        <h2 className="text-4xl font-black tracking-tight">{selectedChannel.companyName}</h2>
                        <button onClick={() => handleOpenEditModal(selectedChannel)} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 transition-all"><Edit3 size={18}/></button>
                    </div>
                    <div className="flex items-center gap-4 mt-4">
                       <span className="text-[10px] font-black bg-white/10 px-4 py-1.5 rounded-full uppercase tracking-widest border border-white/5 flex items-center gap-2"><Globe size={12}/> 历史累计成交：{currentStats.totalDealsArea} M²</span>
                       <span className="text-[10px] font-black bg-white/10 px-4 py-1.5 rounded-full uppercase tracking-widest border border-white/5 flex items-center gap-2"><UserIcon size={12}/> 归属：{getOwnerName(selectedChannel.creatorId)}</span>
                       {currentStats.hasRecentDeal && <span className="text-[10px] font-black bg-emerald-500/20 text-emerald-400 px-4 py-1.5 rounded-full uppercase tracking-widest border border-emerald-500/30 flex items-center gap-2 animate-pulse"><CheckCircle2 size={12}/> 活跃战略伙伴</span>}
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelectedChannel(null)} className="p-3 hover:bg-white/10 rounded-full text-slate-400 transition-all"><X size={32}/></button>
             </div>
             
             <div className="flex-1 overflow-y-auto p-12 space-y-10 bg-slate-50/10 custom-scrollbar">
                <div className="grid grid-cols-3 gap-8">
                   <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm group hover:border-emerald-200 transition-all">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">已结清佣金 (Paid)</p>
                      <p className="text-4xl font-black text-emerald-600 tracking-tighter">¥ {currentStats.totalSettledComm.toLocaleString()}</p>
                   </div>
                   <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm group hover:border-amber-200 transition-all">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">待结清佣金 (Unpaid)</p>
                      <p className="text-4xl font-black text-amber-600 tracking-tighter">¥ {currentStats.totalUnpaidComm.toLocaleString()}</p>
                   </div>
                   <div className="bg-indigo-600 p-8 rounded-[2.5rem] shadow-xl text-white">
                      <p className="text-[10px] font-black text-indigo-100 uppercase tracking-widest mb-4">年度贡献商机</p>
                      <p className="text-4xl font-black tracking-tighter">{currentStats.yearOpps} <span className="text-xl">Leads</span></p>
                   </div>
                </div>

                <section className="space-y-6">
                   <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2"><Briefcase size={16} className="text-indigo-600"/> 详细成交及佣金台账</h3>
                   <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
                      <table className="w-full text-left">
                         <thead className="bg-slate-50/80 border-b text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <tr>
                               <th className="px-10 py-6">成交企业</th>
                               <th className="px-10 py-6">签约日期</th>
                               <th className="px-10 py-6">佣金金额</th>
                               <th className="px-10 py-6">财务状态</th>
                               <th className="px-10 py-6 text-right">操作</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-50">
                            {currentStats.deals.map(deal => (
                               <tr key={deal.id} className="group hover:bg-slate-50/50 transition-colors">
                                  <td className="px-10 py-6 font-black text-slate-800 text-sm">{deal.companyName}</td>
                                  <td className="px-10 py-6 text-xs font-bold text-slate-400 font-mono">{deal.dealParams?.signDate}</td>
                                  <td className="px-10 py-6 font-black text-indigo-600 text-sm">¥ {deal.commission?.amount.toLocaleString() || '--'}</td>
                                  <td className="px-10 py-6">
                                     <span className={`px-3 py-1 rounded-xl text-[9px] font-black uppercase border tracking-widest ${deal.commission?.status === CommissionStatus.PAID ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                                        {deal.commission?.status || '待处理'}
                                     </span>
                                  </td>
                                  <td className="px-10 py-6 text-right">
                                     {isAdmin && deal.commission && (
                                        <button onClick={()=>{setEditingCommission({ ...JSON.parse(JSON.stringify(deal.commission)) }); setIsCommEditModalOpen(true);}} className="p-2 text-slate-400 hover:text-indigo-600 transition-all"><MoreVertical size={16}/></button>
                                     )}
                                  </td>
                                </tr>
                            ))}
                         </tbody>
                      </table>
                   </div>
                </section>

                <section className="bg-white rounded-[2.5rem] p-10 border border-slate-100 shadow-sm space-y-8">
                   <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3 text-indigo-600"><UsersIcon size={24}/><h4 className="text-sm font-black uppercase tracking-widest">机构认证联系人</h4></div>
                      <button onClick={() => handleOpenAgentModal()} className="text-indigo-600 font-black text-[10px] flex items-center gap-1.5 hover:bg-indigo-50 px-3 py-1 rounded-lg transition-all"><Plus size={14}/> 新增对接人</button>
                   </div>
                   <div className="grid grid-cols-2 gap-6">
                      {(selectedChannel.agents || []).map(agent => (
                        <div key={agent.id} className="bg-slate-50/50 p-6 rounded-3xl border border-slate-100 flex items-center gap-6 group hover:bg-white transition-all">
                           <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-slate-400 font-black text-xl border-2 border-slate-100 group-hover:text-indigo-600 shrink-0 shadow-sm">{agent.name[0]}</div>
                           <div className="flex-1">
                              <h5 className="font-black text-slate-900 text-sm mb-1">{agent.name}</h5>
                              <p className="text-[10px] text-slate-400 font-bold">{agent.phone} · {agent.title || '渠道顾问'}</p>
                           </div>
                           <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                              <button onClick={() => handleOpenAgentModal(agent)} className="p-1.5 text-slate-400 hover:text-indigo-600"><Edit size={14}/></button>
                           </div>
                        </div>
                      ))}
                   </div>
                </section>
             </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 border-4 border-dashed border-slate-200 rounded-[3rem]">
             <div className="w-24 h-24 bg-white rounded-[2.5rem] flex items-center justify-center text-slate-200 shadow-xl border border-slate-100 mb-8"><Briefcase size={40}/></div>
             <p className="text-slate-400 font-black text-sm uppercase tracking-[0.2em] font-mono">请从左侧列表选择合作渠道档案</p>
             <p className="text-slate-300 text-[10px] font-bold mt-2">支持按照成交额权重进行聚合排序</p>
          </div>
        )}
      </div>

      {isMergeModalOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white p-10 rounded-[3rem] w-full max-w-4xl shadow-2xl animate-in zoom-in-95 duration-200 max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3">
                <Merge size={28} className="text-amber-500"/> 渠道去重合并
              </h2>
              <button onClick={() => setIsMergeModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-all">
                <X size={24}/>
              </button>
            </div>

            <div className="mb-6 p-4 bg-amber-50 border-2 border-amber-200 rounded-2xl">
              <p className="text-sm font-bold text-amber-800 flex items-center gap-2">
                <AlertCircle size={16}/>
                <span>检测到 <span className="text-amber-600 font-black">{duplicateChannels.length}</span> 组名称重复的渠道，选择要合并的渠道，第一个将作为主渠道保留，所有联系人将被合并。</span>
              </p>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6">
              {duplicateChannels.map((group, idx) => (
                <div key={idx} className="border-2 border-slate-200 rounded-2xl p-6 bg-slate-50">
                  <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                    <Building size={20} className="text-indigo-600"/>
                    {group.channels[0].companyName}
                    <span className="text-sm font-bold text-slate-500">(共 {group.channels.length} 个重复)</span>
                  </h3>
                  
                  <div className="space-y-3">
                    {group.channels.map((channel, cidx) => {
                      const isSelected = selectedMergeChannels.includes(channel.id);
                      const stats = getChannelStats(channel.id);
                      
                      return (
                        <div 
                          key={channel.id}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedMergeChannels(prev => prev.filter(id => id !== channel.id));
                            } else {
                              setSelectedMergeChannels(prev => [...prev, channel.id]);
                            }
                          }}
                          className={`p-4 rounded-xl cursor-pointer border-2 transition-all ${
                            isSelected 
                              ? 'bg-amber-100 border-amber-400' 
                              : 'bg-white border-slate-200 hover:border-amber-300'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3 flex-1">
                              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center mt-0.5 transition-all ${
                                isSelected ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'
                              }`}>
                                {isSelected && <CheckCircle2 size={14} className="text-white"/>}
                              </div>
                              
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                  {cidx === 0 && (
                                    <span className="bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase">主渠道</span>
                                  )}
                                  <span className="text-xs font-bold text-slate-600">
                                    ID: {channel.id}
                                  </span>
                                  <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                                    <UserCheck size={12}/> {getOwnerName(channel.creatorId)}
                                  </span>
                                </div>
                                
                                <div className="flex items-center gap-4 text-xs">
                                  <span className="text-slate-600 font-bold">
                                    联系人: <span className="text-slate-900 font-black">{channel.agents?.length || 0}</span> 人
                                  </span>
                                  <span className="text-slate-600 font-bold">
                                    YTD 成交: <span className="text-indigo-600 font-black">{stats.ytdArea}</span> ㎡
                                  </span>
                                  <span className="text-slate-600 font-bold">
                                    最近动态: <span className="font-mono text-slate-800">{stats.latestActionDate}</span>
                                  </span>
                                </div>
                                
                                {channel.agents && channel.agents.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {channel.agents.map(agent => (
                                      <span key={agent.id} className="text-[10px] bg-slate-200 text-slate-700 px-2 py-1 rounded-lg font-bold">
                                        {agent.name} - {agent.phone}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex justify-between items-center pt-6 border-t border-slate-200">
              <div className="text-sm font-bold text-slate-600">
                已选择 <span className="text-amber-600 font-black text-lg">{selectedMergeChannels.length}</span> 个渠道
              </div>
              <div className="flex gap-4">
                <button 
                  onClick={() => setIsMergeModalOpen(false)} 
                  className="px-6 py-3 text-slate-400 font-bold hover:text-slate-800 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={handleMergeChannels}
                  disabled={selectedMergeChannels.length < 2}
                  className="bg-amber-500 text-white px-10 py-3 rounded-2xl font-black shadow-xl shadow-amber-100 hover:bg-amber-600 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Merge size={18}/> 确认合并
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isCommEditModalOpen && editingCommission && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white p-10 rounded-[3rem] w-full max-md shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-10"><h2 className="text-xl font-black text-slate-900 flex items-center gap-3"><DollarSign size={28} className="text-indigo-600"/> 佣金财务修正</h2><button onClick={()=>setIsCommEditModalOpen(false)}><X/></button></div>
                <div className="space-y-8">
                    <div><label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">实结金额 (CNY)</label><input type="number" className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-black outline-none focus:ring-4 focus:ring-indigo-50" value={editingCommission.amount} onChange={e=>setEditingCommission({...editingCommission, amount:Number(e.target.value)})}/></div>
                    <div><label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">支付状态</label><select className="w-full border-2 border-slate-100 rounded-2xl p-4 text-sm font-black bg-white outline-none" value={editingCommission.status} onChange={e=>setEditingCommission({...editingCommission, status:e.target.value as CommissionStatus})}>{Object.values(CommissionStatus).map(s=><option key={s} value={s}>{s}</option>)}</select></div>
                </div>
                <div className="mt-12 flex justify-end gap-4"><button onClick={()=>setIsCommEditModalOpen(false)} className="px-6 py-2 text-slate-400 font-bold">取消</button><button onClick={() => { onUpdateCommission(editingCommission as Commission); setIsCommEditModalOpen(false); }} className="bg-indigo-600 text-white px-10 py-3 rounded-2xl font-black shadow-xl shadow-indigo-100 transition-all active:scale-95">保存变更</button></div>
            </div>
          </div>
      )}

      {isAgentModalOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="bg-white p-10 rounded-[3rem] w-full max-sm shadow-2xl animate-in zoom-in-95 duration-200">
              <h2 className="text-xl font-black text-slate-900 mb-8 flex items-center gap-3"><UserIcon size={24} className="text-indigo-600"/> {editingAgent.id ? '编辑联系人' : '新增联系人'}</h2>
              <div className="space-y-6">
                 <div><label className="block text-[10px] font-black text-slate-400 mb-2">姓名 *</label><input className="w-full border border-slate-200 rounded-2xl p-4 text-sm font-bold" value={editingAgent.name} onChange={e=>setEditingAgent({...editingAgent, name:e.target.value})}/></div>
                 <div><label className="block text-[10px] font-black text-slate-400 mb-2">手机号 *</label><input className="w-full border border-slate-200 rounded-2xl p-4 text-sm font-bold" value={editingAgent.phone} onChange={e=>setEditingAgent({...editingAgent, phone:e.target.value})}/></div>
                 <div><label className="block text-[10px] font-black text-slate-400 mb-2">职位</label><input className="w-full border border-slate-200 rounded-2xl p-4 text-sm font-bold" value={editingAgent.title} onChange={e=>setEditingAgent({...editingAgent, title:e.target.value})}/></div>
              </div>
              <div className="mt-10 flex justify-end gap-3"><button onClick={() => setIsAgentModalOpen(false)} className="px-6 py-3 text-slate-400 font-bold">取消</button><button onClick={handleSaveAgent} className="bg-indigo-600 text-white px-10 py-3 rounded-2xl font-black shadow-xl shadow-indigo-100 transition-all active:scale-95">确认保存</button></div>
           </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white p-12 rounded-[3.5rem] w-full max-w-xl shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col h-[85vh]">
              <h2 className="text-2xl font-black text-slate-900 mb-8 flex items-center gap-3"><PlusCircle size={32} className="text-indigo-600"/> {modalMode === 'ADD' ? '新伙伴入库注册' : '伙伴档案资料维护'}</h2>
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
                 <div><label className="block text-[11px] font-black text-slate-400 mb-2.5 uppercase tracking-widest">合作机构公司全称 *</label><input className="w-full border-2 border-slate-100 rounded-2xl p-4.5 text-sm font-black outline-none focus:ring-4 focus:ring-indigo-50 bg-slate-50/50 focus:bg-white transition-all" value={editingForm.companyName} onChange={e=>setEditingForm({...editingForm, companyName:e.target.value})} placeholder="例如: 仲量联行 (JLL)"/></div>
                 <div><label className="block text-[11px] font-black text-slate-400 mb-2.5 uppercase tracking-widest">分级标签</label><select className="w-full border-2 border-slate-100 rounded-2xl p-4.5 text-sm font-black bg-white outline-none" value={editingForm.tier} onChange={e=>setEditingForm({...editingForm, tier: e.target.value as AgentTier})}>{Object.values(AgentTier).map(t=><option key={t} value={t}>{t}级战略伙伴</option>)}</select></div>
                 <div><label className="block text-[11px] font-black text-slate-400 mb-2.5 uppercase tracking-widest">备注评价</label><textarea className="w-full border-2 border-slate-100 rounded-2xl p-6 text-sm font-medium h-32 outline-none focus:ring-4 focus:ring-indigo-50" value={editingForm.description} onChange={e=>setEditingForm({...editingForm, description:e.target.value})}/></div>
                 
                 {isAdmin && (
                    <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-6">
                        <div className="flex items-center gap-2 text-indigo-600 border-b border-indigo-100 pb-2">
                           <Shield size={14}/>
                           <h4 className="text-[10px] font-black uppercase tracking-widest">渠道归属与权限管理 (Admin Only)</h4>
                        </div>
                        
                        <div>
                           <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest flex items-center gap-1.5"><Target size={12}/> 主负责人 (Owner)</label>
                           <select className="w-full border border-slate-200 rounded-xl p-3 text-xs font-bold bg-white outline-none" value={editingForm.creatorId || ''} onChange={e => setEditingForm({...editingForm, creatorId: e.target.value})}>
                              <option value="" disabled>-- 请选择负责人 --</option>
                              {effectiveUsers.map(u => (
                                <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>
                              ))}
                           </select>
                           {effectiveUsers.length === 0 && <p className="text-[10px] text-rose-500 mt-1 font-bold">⚠️ 系统未检测到可选的用户列表，请检查“系统设置”中的账户配置。</p>}
                        </div>

                        <div>
                           <label className="block text-[10px] font-black text-slate-400 mb-3 uppercase tracking-widest flex items-center gap-1.5"><UsersIcon size={12}/> 协同维护人员 (Co-Maintainers)</label>
                           <div className="grid grid-cols-2 gap-3 max-h-32 overflow-y-auto custom-scrollbar p-1">
                              {effectiveUsers.filter(u => u.id !== editingForm.creatorId && u.id !== 'U-ADMIN').map(u => {
                                 const isChecked = editingForm.sharedWithIds?.includes(u.id);
                                 return (
                                   <div key={u.id} onClick={() => toggleSharedUser(u.id)} className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${isChecked ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
                                      <div className={`w-4 h-4 rounded-md border flex items-center justify-center ${isChecked ? 'bg-white border-white' : 'bg-slate-100 border-slate-300'}`}>
                                         {isChecked && <CheckCircle2 size={10} className="text-indigo-600"/>}
                                      </div>
                                      <span className="text-xs font-bold">{u.name}</span>
                                   </div>
                                 );
                              })}
                           </div>
                        </div>
                    </div>
                 )}
              </div>
              <div className="mt-8 flex justify-end gap-6 pt-6 border-t border-slate-100"><button onClick={()=>setIsModalOpen(false)} className="text-slate-400 font-black text-sm uppercase tracking-widest hover:text-slate-800 transition-colors">取消</button><button onClick={handleSaveChannel} className="bg-indigo-600 text-white px-12 py-4 rounded-[2rem] font-black text-sm shadow-2xl shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95">保存档案信息</button></div>
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
