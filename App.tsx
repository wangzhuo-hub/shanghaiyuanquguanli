
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dashboard } from './components/Dashboard';
import { Opportunities } from './components/Opportunities';
import { ChannelPRM } from './components/ChannelPRM';
import { Assets } from './components/Assets';
import { Settings } from './components/Settings';
import { Policies } from './components/Policies';
import { DealRecords } from './components/DealRecords';
import { CommissionLedger } from './components/CommissionLedger';
import { LayoutDashboard, Users, Building2, Wallet, Layers, Settings as SettingsIcon, LogOut, Target, ClipboardCheck, ArrowRight, Cloud, RefreshCw, CheckCircle, AlertCircle, Wifi, Database, Save, X, HandCoins, DownloadCloud, Loader2 } from 'lucide-react';
import { MOCK_OPPORTUNITIES, MOCK_CHANNELS, MOCK_COMMISSIONS, MOCK_UNITS, MOCK_ACTIVITIES, MOCK_COMMISSION_RULES, MOCK_USERS } from './services/mockData';
import { Opportunity, Commission, Channel, OpportunityStage, CommissionStatus, Unit, UnitStatus, AppData, Activity, CommissionRule, PolicyChangeLog, Agent, User, UserRole } from './types';
import { pb, saveBackup, loadLatestBackup, updateLatestBackup } from './services/pocketbase';

// 深度合并算法：增强 ID 级去重，并支持级联删除过滤
const mergeAppData = (local: AppData, cloud: AppData): AppData => {
  // 1. 合并双方的删除记录 (Tombstones)
  const localDeleted = new Set(local.deletedIds || []);
  const cloudDeleted = new Set(cloud.deletedIds || []);
  const allDeletedIds = Array.from(new Set([...localDeleted, ...cloudDeleted]));
  const deletionMap = new Set(allDeletedIds);

  // 通用合并函数：基于ID去重，优先保留本地最新数据
  const mergeById = <T extends { id: string }>(localList: T[] = [], cloudList: T[] = []): T[] => {
    const map = new Map<string, T>();
    
    // 云端快照先入图，但需过滤掉已被标记删除的ID
    if (Array.isArray(cloudList)) {
      cloudList.forEach(item => {
        if (item?.id && !deletionMap.has(item.id)) {
           map.set(item.id, JSON.parse(JSON.stringify(item)));
        }
      });
    }
    
    // 本地最新数据覆盖（本地具有最高优先级）
    if (Array.isArray(localList)) {
      localList.forEach(item => {
        if (item?.id) map.set(item.id, JSON.parse(JSON.stringify(item)));
      });
    }
    return Array.from(map.values());
  };

  // 2. 基础数据合并
  const mergedOpportunities = mergeById(local.opportunities, cloud.opportunities);
  
  // 3. 关联数据级联过滤 (Critical Fix: 防止僵尸子数据复活)
  // 如果商机ID在删除列表中，其下属的佣金记录和活动记录也必须强制过滤，即使子记录ID本身未在删除列表中
  const mergedCommissions = mergeById(local.commissions, cloud.commissions).filter(c => !deletionMap.has(c.contractId));
  const mergedActivities = mergeById(local.activities, cloud.activities).filter(a => !deletionMap.has(a.opportunityId));

  // 4. 用户数据合并特殊处理：防止云端空数据覆盖本地有效用户
  const mergedUsers = (cloud.users && cloud.users.length > 0) 
    ? mergeById(local.users, cloud.users) 
    : (local.users && local.users.length > 0 ? local.users : MOCK_USERS);

  return {
    opportunities: mergedOpportunities,
    channels: mergeById(local.channels, cloud.channels),
    commissions: mergedCommissions,
    units: mergeById(local.units, cloud.units),
    commissionRules: mergeById(local.commissionRules, cloud.commissionRules),
    policyHistory: mergeById(local.policyHistory, cloud.policyHistory),
    activities: mergedActivities,
    users: mergedUsers,
    settings: {
      ...cloud.settings,
      ...local.settings,
      annualTargetArea: local.settings?.annualTargetArea || cloud.settings?.annualTargetArea || 30000
    },
    deletedIds: allDeletedIds
  };
};

const Login: React.FC<{ onLogin: (user: User) => void, users: User[], onSync: () => Promise<void> }> = ({ onLogin, users, onSync }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    try {
      // 首先同步最新数据（包括用户信息）
      await onSync();
      
      // 然后验证登录
      const user = (users || []).find(u => u.username === username && u.password === password);
      if (user) {
        onLogin(user);
      } else {
        setError('用户名或密码错误');
      }
    } catch (e) {
      setError('登录失败，请检查网络');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6 font-sans overflow-hidden">
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat scale-105"
        style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=2070&auto=format&fit=crop")' }}
      >
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"></div>
      </div>

      <div className="relative z-10 bg-white rounded-[3.5rem] shadow-[0_32px_64px_-15px_rgba(0,0,0,0.3)] w-full max-w-[440px] overflow-hidden animate-in fade-in zoom-in-95 duration-700">
        <div className="bg-indigo-600 p-16 text-center text-white relative">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/10 to-transparent pointer-events-none"></div>
          <div className="relative inline-flex mb-8">
             <div className="p-5 bg-white/10 backdrop-blur-md rounded-3xl shadow-xl border border-white/20">
                <Building2 size={56} strokeWidth={1.5} className="text-white drop-shadow-lg"/>
             </div>
          </div>
          <h1 className="text-[2.8rem] font-black tracking-tighter leading-none mb-4 drop-shadow-md">Leasing Cmdr.</h1>
          <p className="text-white/70 text-[10px] font-black uppercase tracking-[0.3em] leading-relaxed">PROFESSIONAL ASSET LOGIC V5.0</p>
        </div>

        <form onSubmit={handleLogin} className="px-14 py-16 space-y-8 relative">
          {error && (
            <div className="p-4 bg-rose-50 text-rose-600 rounded-2xl text-[10px] font-black text-center border border-rose-100 uppercase tracking-widest animate-shake">
              {error}
            </div>
          )}
          
          <div className="space-y-5">
            <div className="relative group">
              <input 
                className="w-full bg-slate-50 border-2 border-slate-100/50 rounded-2xl p-5 text-sm font-bold text-slate-800 placeholder:text-slate-300 outline-none group-hover:border-indigo-100 focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 transition-all duration-300" 
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                placeholder="登录账号" 
              />
            </div>
            <div className="relative group">
              <input 
                type="password" 
                className="w-full bg-slate-50 border-2 border-slate-100/50 rounded-2xl p-5 text-sm font-bold text-slate-800 placeholder:text-slate-300 outline-none group-hover:border-indigo-100 focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 transition-all duration-300" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                placeholder="安全密码" 
              />
            </div>
          </div>

          <div className="space-y-3">
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black text-xs uppercase tracking-widest shadow-[0_20px_40px_-10px_rgba(15,23,42,0.3)] hover:bg-indigo-700 hover:shadow-indigo-200 transition-all duration-300 active:scale-[0.98] flex items-center justify-center gap-3 group disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin"/>
                  正在加载...
                </>
              ) : (
                <>
                  进入管理终端
                  <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('park_leasing_auth');
    return saved ? JSON.parse(saved) : null;
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'assets' | 'opps' | 'deals' | 'commissions' | 'channel' | 'policies' | 'settings'>('dashboard');
  
  const [isCloudSaving, setIsCloudSaving] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<'IDLE' | 'SAVING' | 'MERGING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(localStorage.getItem('last_cloud_sync'));

  // 状态集合 - 关键修复：初始化时强制检查 users 数组是否为空，若为空则回退到 MOCK
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('park_leasing_data');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.users && Array.isArray(parsed.users) && parsed.users.length > 0) {
        return parsed.users;
      }
    }
    return MOCK_USERS;
  });

  const [opportunities, setOpportunities] = useState<Opportunity[]>(() => {
    const saved = localStorage.getItem('park_leasing_data');
    return saved ? JSON.parse(saved).opportunities || MOCK_OPPORTUNITIES : MOCK_OPPORTUNITIES;
  });

  const [channels, setChannels] = useState<Channel[]>(() => {
    const saved = localStorage.getItem('park_leasing_data');
    return saved ? JSON.parse(saved).channels || MOCK_CHANNELS : MOCK_CHANNELS;
  });

  const [commissions, setCommissions] = useState<Commission[]>(() => {
    const saved = localStorage.getItem('park_leasing_data');
    return saved ? JSON.parse(saved).commissions || MOCK_COMMISSIONS : MOCK_COMMISSIONS;
  });

  const [units, setUnits] = useState<Unit[]>(() => {
    const saved = localStorage.getItem('park_leasing_data');
    return saved ? JSON.parse(saved).units || MOCK_UNITS : MOCK_UNITS;
  });

  const [commissionRules, setCommissionRules] = useState<CommissionRule[]>(() => {
    const saved = localStorage.getItem('park_leasing_data');
    return saved && JSON.parse(saved).commissionRules ? JSON.parse(saved).commissionRules : MOCK_COMMISSION_RULES;
  });

  const [policyHistory, setPolicyHistory] = useState<PolicyChangeLog[]>(() => {
    const saved = localStorage.getItem('park_leasing_data');
    return saved && JSON.parse(saved).policyHistory ? JSON.parse(saved).policyHistory : [];
  });

  const [annualTarget, setAnnualTarget] = useState<number>(() => {
    const saved = localStorage.getItem('park_leasing_data');
    return saved && JSON.parse(saved).settings ? JSON.parse(saved).settings.annualTargetArea : 30000;
  });
  
  const [activities, setActivities] = useState<Activity[]>(() => {
    const saved = localStorage.getItem('park_leasing_data');
    return saved && JSON.parse(saved).activities ? JSON.parse(saved).activities : MOCK_ACTIVITIES;
  });

  // 新增：删除标记ID集合，防止云端数据在聚合时复活已删除项目
  const [deletedIds, setDeletedIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('park_leasing_data');
    return saved && JSON.parse(saved).deletedIds ? JSON.parse(saved).deletedIds : [];
  });

  // 使用 Ref 实时跟踪数据，供异步同步逻辑使用，彻底解决闭包过期问题
  const dataRef = useRef<AppData>({ opportunities, channels, commissions, units, commissionRules, policyHistory, activities, users, settings: { annualTargetArea: annualTarget }, deletedIds });
  
  // 自动同步定时器
  const autoSyncTimerRef = useRef<NodeJS.Timeout>();
  
  useEffect(() => {
    dataRef.current = { opportunities, channels, commissions, units, commissionRules, policyHistory, activities, users, settings: { annualTargetArea: annualTarget }, deletedIds };
    localStorage.setItem('park_leasing_data', JSON.stringify(dataRef.current));
    
    // 数据变化时，防抖后自动同步到PocketBase
    if (currentUser && autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current);
    }
    
    if (currentUser) {
      // 1秒防抖，实时保存
      autoSyncTimerRef.current = setTimeout(async () => {
        try {
          await updateLatestBackup(dataRef.current);
          const now = new Date().toLocaleString();
          setLastSyncDate(now);
          localStorage.setItem('last_cloud_sync', now);
        } catch (error) {
          console.error('自动保存失败:', error);
        }
      }, 1000); // 从3秒改为1秒，更实时
    }
    
    return () => {
      if (autoSyncTimerRef.current) {
        clearTimeout(autoSyncTimerRef.current);
      }
    };
  }, [opportunities, channels, commissions, units, commissionRules, policyHistory, annualTarget, activities, users, deletedIds, currentUser]);

  useEffect(() => {
    if (currentUser) localStorage.setItem('park_leasing_auth', JSON.stringify(currentUser));
    else localStorage.removeItem('park_leasing_auth');
  }, [currentUser]);

  const handleRestoreData = useCallback((data: AppData) => {
    setOpportunities(data.opportunities || []);
    setChannels(data.channels || []);
    setCommissions(data.commissions || []);
    setUnits(data.units || []);
    setCommissionRules(data.commissionRules || []);
    setPolicyHistory(data.policyHistory || []);
    setActivities(data.activities || []);
    // 关键修复：防止恢复空用户列表。如果快照中没有用户数据，保留现有数据或回退到 Mock
    setUsers(prev => (data.users && data.users.length > 0) ? data.users : (prev.length > 0 ? prev : MOCK_USERS));
    setAnnualTarget(data.settings?.annualTargetArea || 30000);
    setDeletedIds(data.deletedIds || []); // 恢复删除记录
  }, []);

  const handleFetchLatestBackup = async (isMerge = false) => {
    setIsCloudSaving(true);
    setCloudStatus('SAVING');
    try {
      const backup = await loadLatestBackup();
      if (!backup) {
        throw new Error('未找到备份数据');
      }
      
      const cloudData = backup.data as AppData;
      // 登录时直接加载云端数据，不再合并
      handleRestoreData(cloudData);
      
      const now = new Date().toLocaleString();
      setLastSyncDate(now);
      localStorage.setItem('last_cloud_sync', now);
      setCloudStatus('SUCCESS');
      setTimeout(() => setCloudStatus('IDLE'), 2000);
    } catch (err: any) {
      console.error('Cloud Fetch Error:', err);
      setCloudStatus('ERROR');
    } finally {
      setIsCloudSaving(false);
    }
  };

  // 新增：手动刷新数据函数
  const handleRefreshData = async () => {
    setIsCloudSaving(true);
    setCloudStatus('SAVING');
    try {
      const backup = await loadLatestBackup();
      if (!backup) {
        alert('未找到云端备份数据');
        return;
      }
      
      handleRestoreData(backup.data as AppData);
      const now = new Date().toLocaleString();
      setLastSyncDate(now);
      localStorage.setItem('last_cloud_sync', now);
      setCloudStatus('SUCCESS');
      setTimeout(() => setCloudStatus('IDLE'), 2000);
      alert('✅ 数据已从云端刷新');
    } catch (err: any) {
      console.error('Refresh Error:', err);
      setCloudStatus('ERROR');
      alert('刷新失败: ' + err.message);
    } finally {
      setIsCloudSaving(false);
    }
  };

  const handleAddCommission = (opp: Opportunity) => {
    if (!opp.dealParams) return;
    
    const signDate = opp.dealParams.signDate;
    const finalArea = opp.dealParams.finalArea;
    const matchedRule = commissionRules.find(r => 
      r.isActive && 
      finalArea >= r.minArea && 
      finalArea <= r.maxArea &&
      signDate >= r.startDate &&
      signDate <= r.endDate
    );

    const commissionRate = matchedRule ? matchedRule.rate : 1.0;
    const totalAmount = opp.dealParams.monthlyRent * commissionRate;
    const newCommissions: Commission[] = [];

    if (matchedRule && matchedRule.payoutType === 'STAGED' && matchedRule.installments.length > 0) {
      matchedRule.installments.forEach((inst, idx) => {
        const plannedDate = new Date(signDate);
        plannedDate.setMonth(plannedDate.getMonth() + inst.triggerMonth);
        
        newCommissions.push({
          id: `COMM-${Date.now()}-${idx}`,
          contractId: opp.id,
          roomNumber: (opp.dealParams!.unitIds || []).join(','),
          signDate: signDate,
          plannedPayoutDate: plannedDate.toISOString().slice(0, 10),
          channelId: opp.channelId || 'DIRECT',
          amount: totalAmount * (inst.percentage / 100),
          area: finalArea,
          status: CommissionStatus.PENDING,
          rateUsed: commissionRate,
          installmentLabel: `${idx + 1}/${matchedRule.installments.length}`,
          paymentProofUploaded: false
        });
      });
    } else {
      newCommissions.push({
        id: `COMM-${Date.now()}`,
        contractId: opp.id,
        roomNumber: (opp.dealParams.unitIds || []).join(','),
        signDate: signDate,
        plannedPayoutDate: signDate,
        channelId: opp.channelId || 'DIRECT',
        amount: totalAmount,
        area: finalArea,
        status: CommissionStatus.PENDING,
        rateUsed: commissionRate,
        installmentLabel: '一次性',
        paymentProofUploaded: false
      });
    }
    
    setCommissions(prev => [...newCommissions, ...prev]);
  };

  const onLoginSuccess = (user: User) => {
    setCurrentUser(user);
    // 登录后自动加载数据已在Login组件内完成，不需要额外处理
  };

  // 直接退出，后台自动同步
  const handleLogout = () => {
    // 不需要手动同步，因为有自动同步机制
    setCurrentUser(null);
    setActiveTab('dashboard');
  };

  const handleUpdateOppStage = (oppId: string, stage: OpportunityStage, lossReason?: string) => {
    setOpportunities(prev => prev.map(o => o.id === oppId ? { ...o, stage, lossReason, lossDate: stage === OpportunityStage.CLOSED_LOST ? new Date().toISOString().slice(0, 10) : o.lossDate } : o));
  };

  const handleAddOpportunity = (opp: Opportunity) => setOpportunities(prev => [opp, ...prev]);
  const handleUpdateOpportunityDetails = (opp: Opportunity) => setOpportunities(prev => prev.map(o => o.id === opp.id ? opp : o));
  
  // 删除逻辑升级：级联记录删除ID，防止子记录僵尸复活
  const handleDeleteOpportunity = (id: string) => {
    // 查找关联的子数据ID，一并加入删除列表
    const relatedCommIds = commissions.filter(c => c.contractId === id).map(c => c.id);
    const relatedActIds = activities.filter(a => a.opportunityId === id).map(a => a.id);
    
    setDeletedIds(prev => [...prev, id, ...relatedCommIds, ...relatedActIds]);
    
    setOpportunities(prev => prev.filter(o => o.id !== id));
    setActivities(prev => prev.filter(a => a.opportunityId !== id));
    setCommissions(prev => prev.filter(c => c.contractId !== id));
  };

  const handleAddActivity = (act: Activity) => setActivities(prev => [act, ...prev]);
  
  const handleDeleteActivity = (id: string) => {
    setDeletedIds(prev => [...prev, id]);
    setActivities(prev => prev.filter(a => a.id !== id));
  };

  const handleUnitStatusChange = (unitId: string, status: UnitStatus, tenantName: string) => setUnits(prev => prev.map(u => u.id === unitId ? { ...u, status, tenantName } : u));
  
  const handleDeleteChannel = (id: string) => {
    setDeletedIds(prev => [...prev, id]);
    setChannels(prev => prev.filter(c => c.id !== id));
  };

  // 关键修复：将 handleFetchLatestBackup 传递给 Login 组件，用于登录前同步
  if (!currentUser) {
      return (
        <Login 
          onLogin={onLoginSuccess} 
          users={users} 
          onSync={async () => { await handleFetchLatestBackup(false); }} 
        />
      );
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      <aside className="w-20 lg:w-64 bg-slate-900 flex flex-col items-center lg:items-stretch p-6 gap-10 shrink-0 relative z-20 shadow-2xl">
        <div className="flex items-center gap-3 px-2">
           <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg"><Building2 size={24}/></div>
           <h1 className="hidden lg:block text-white font-black text-xl tracking-tighter">Leasing Cmdr.</h1>
        </div>
        <nav className="flex-1 flex flex-col gap-2 overflow-y-auto custom-scrollbar">
           {[
             { id: 'dashboard', icon: LayoutDashboard, label: '总控大屏' },
             { id: 'assets', icon: Building2, label: '资产销控' },
             { id: 'opps', icon: Users, label: '商机管理' },
             { id: 'deals', icon: ClipboardCheck, label: '成交台账' },
             { id: 'commissions', icon: HandCoins, label: '佣金结算' },
             { id: 'channel', icon: Wallet, label: '渠道 PRM' },
             { id: 'policies', icon: Layers, label: '政策配置' },
             { id: 'settings', icon: SettingsIcon, label: '系统设置' },
           ].map(item => (
             <button key={item.id} onClick={() => setActiveTab(item.id as any)} className={`flex items-center gap-4 p-4 rounded-2xl transition-all shrink-0 ${activeTab === item.id ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
               <item.icon size={20}/><span className="hidden lg:block text-xs font-black uppercase tracking-widest text-left">{item.label}</span>
             </button>
           ))}
        </nav>
        <button onClick={handleLogout} className="flex items-center gap-4 p-4 rounded-2xl text-rose-400 hover:bg-rose-500/10 transition-all mt-auto shrink-0">
           <LogOut size={20}/><span className="hidden lg:block text-xs font-black uppercase tracking-widest">安全退出</span>
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 relative">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-10 shrink-0 sticky top-0 z-30 shadow-sm backdrop-blur-md bg-white/90">
            <div className="flex flex-col">
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">{activeTab.toUpperCase()} TERMINAL</h2>
                <div className="flex items-center gap-2 mt-1">
                    <div className={`w-1.5 h-1.5 rounded-full ${cloudStatus === 'ERROR' ? 'bg-rose-500' : 'bg-emerald-500'}`}></div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                      {cloudStatus === 'MERGING' ? '聚合云端最新数据...' : 
                       cloudStatus === 'SAVING' ? '提交聚合快照...' : 
                       lastSyncDate ? `上次云同步: ${lastSyncDate}` : '云端就绪'}
                    </span>
                </div>
            </div>
            <div className="flex items-center gap-4">
                <div className={`flex items-center gap-3 px-4 py-2 rounded-2xl border transition-all ${cloudStatus === 'SAVING' || cloudStatus === 'MERGING' ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-100'}`}>
                    <Cloud size={14} className="text-slate-400"/>
                    <button onClick={handleRefreshData} disabled={isCloudSaving} className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 ${
                      isCloudSaving ? 'text-slate-300' : 'text-indigo-600 hover:text-indigo-700'
                    }`}>
                      <RefreshCw size={12} className={isCloudSaving ? 'animate-spin' : ''}/> 刷新数据
                    </button>
                </div>
            </div>
        </header>

        <main className="flex-1 p-8 overflow-y-auto custom-scrollbar relative">
           {activeTab === 'dashboard' && <Dashboard opportunities={opportunities} units={units} activities={activities} agents={[]} commissions={commissions} annualTarget={annualTarget} onUpdateTarget={setAnnualTarget} currentData={dataRef.current} />}
           {activeTab === 'assets' && (
             <Assets 
               isAdmin={currentUser.role === UserRole.ADMIN} 
               units={units}
               opportunities={opportunities}
               activities={activities}
               onAddUnit={u => setUnits(prev => [u, ...prev])} 
               onUpdateUnit={u => setUnits(prev => prev.map(un => un.id === u.id ? u : un))} 
               onDeleteUnit={id => {
                 setDeletedIds(prev => [...prev, id]);
                 setUnits(prev => prev.filter(u => u.id !== id));
               }} 
               onSyncUnits={(u) => setUnits(u)} 
             />
           )}
           {activeTab === 'opps' && (
             <Opportunities 
               currentUser={currentUser} users={users} opportunities={opportunities} agents={[]} channels={channels} units={units} activities={activities} annualTarget={annualTarget} onUpdateTarget={setAnnualTarget}
               onAddActivity={handleAddActivity} onUpdateActivity={act => setActivities(prev => prev.map(a => a.id === act.id ? act : a))} onDeleteActivity={handleDeleteActivity}
               onAddOpportunity={handleAddOpportunity} onDeleteOpportunity={handleDeleteOpportunity} onAddCommission={handleAddCommission} onUpdateOpportunityStage={handleUpdateOppStage} onUpdateOpportunityDetails={handleUpdateOpportunityDetails}
               onUnitStatusChange={handleUnitStatusChange}
             />
           )}
           {activeTab === 'deals' && <DealRecords opportunities={opportunities} units={units} users={users} activities={activities} />}
           {activeTab === 'commissions' && <CommissionLedger commissions={commissions} channels={channels} opportunities={opportunities} onUpdateCommission={c => setCommissions(prev => prev.map(cm => cm.id === c.id ? c : cm))} isAdmin={currentUser.role === UserRole.ADMIN} />}
           {activeTab === 'channel' && <ChannelPRM currentUser={currentUser} isAdmin={currentUser.role === UserRole.ADMIN} users={users} channels={channels} commissions={commissions} opportunities={opportunities} activities={activities} onAddChannel={c => setChannels(prev => [c, ...prev])} onUpdateChannel={c => setChannels(prev => prev.map(ch => ch.id === c.id ? c : ch))} onUpdateCommission={c => setCommissions(prev => prev.map(cm => cm.id === c.id ? c : cm))} onDeleteChannel={handleDeleteChannel} />}
           {activeTab === 'policies' && <Policies isAdmin={currentUser.role === UserRole.ADMIN} currentRules={commissionRules} history={policyHistory} onUpdateRules={(r, l) => { setCommissionRules(r); setPolicyHistory(prev => [l, ...prev]); }} onUpdateHistory={setPolicyHistory} />}
           {activeTab === 'settings' && <Settings isAdmin={currentUser.role === UserRole.ADMIN} users={users} onUpdateUsers={setUsers} currentData={dataRef.current} onRestoreData={handleRestoreData} />}
        </main>
      </div>
    </div>
  );
};

export default App;