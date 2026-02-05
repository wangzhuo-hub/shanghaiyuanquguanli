
import React, { useState, useEffect, useMemo } from 'react';
import { LayoutDashboard, Building2, Users, PieChart, Settings, Bell, Search, Menu, Sparkles, UserCircle, Download, Upload, X, Check, Filter, Save, RotateCcw, Trash2, Calculator, Database, Lightbulb, Cloud, CloudCog, RefreshCw, AlertCircle, ExternalLink, Link, Info, Loader2, CheckCircle2, XCircle, History, FileClock, ChevronRight, ChevronDown, CloudUpload, LogOut, User, Calendar, ChevronLeft, FileInput, Table as TableIcon, FileText } from 'lucide-react';
import { generateInitialData } from './services/mockData';
import { DashboardData, Building, Tenant, PaymentRecord, UnitStatus, MonthlyTrend, PaymentCycle, RentFreePeriod, BillingDetail, ParkingStatDetail, BudgetAssumption, BudgetAdjustment, BudgetAnalysisData, CloudConfig, AIConfig, CloudBackupMetadata, BudgetScenario, MonthlyInitData, ContractStatus, DepositStatus, InvoiceRecord } from './types';
import { StatsCards } from './components/StatsCards';
import { RecentActivityTable, AnnualMetricComparisonTable, AnnualComparisonData } from './components/Tables';
import { BillingTable } from './components/BillingTable';
import { AssistantPanel } from './components/AssistantPanel';
import { AIAssistantDialog } from './components/AIAssistantDialog';
import { BuildingManager } from './components/BuildingManager';
import { ContractManager } from './components/ContractManager';
import { FinanceManager } from './components/FinanceManager';
import { BudgetManager } from './components/BudgetManager';
import { TenantInsights } from './components/TenantInsights';
import { DashboardAlerts } from './components/DashboardAlerts';
import { checkConnection, saveToCloud, getCloudHistory, fetchCloudBackup, initCloud } from './services/cloudService';
import { generateBudgetedBills, getVirtualTenants } from './services/billingService';

const STORAGE_KEY = 'kingdee_park_data_v1';
const CLOUD_CONFIG_KEY = 'kingdee_park_cloud_config';

// Embedded Supabase Credentials
const SUPABASE_URL = 'https://drbugbbsvnnheuasgvwg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyYnVnYmJzdm5uaGV1YXNndndnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MjI1ODIsImV4cCI6MjA3OTk5ODU4Mn0.fZF27k7dtbzoMK5ZKh_UARPLpy5OxmF9fvVkJMTOIO4';

// 核心计算逻辑：确保这里使用的逻辑与预算表(BudgetManager)完全一致
const calculateBudgetedReceivableInPeriod = (
    tenants: Tenant[],
    periodStart: Date,
    periodEnd: Date,
    selfUseUnitIds: Set<string>,
    assumptions: BudgetAssumption[],
    adjustments: BudgetAdjustment[]
): number => {
    let total = 0;
    // 生成足够长的时间窗口以捕获跨期账单
    const genStart = new Date(periodStart);
    genStart.setFullYear(genStart.getFullYear() - 2); 
    const genEnd = new Date(periodEnd);
    genEnd.setFullYear(genEnd.getFullYear() + 2);

    tenants.forEach(t => {
        const isSelfUse = t.unitIds.some(uid => selfUseUnitIds.has(uid));
        if (isSelfUse) return;

        const bills = generateBudgetedBills(t, assumptions, adjustments, genStart, genEnd);
        
        bills.forEach(b => {
            if (b.date >= periodStart && b.date <= periodEnd) {
                total += b.amount;
            }
        });
    });

    return Math.round(total);
};

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  isOpen: boolean;
  active: boolean;
  onClick: () => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ icon, label, isOpen, active, onClick }) => (
  <button
    onClick={onClick}
    className={`
      relative w-full flex items-center gap-3 px-5 py-2.5 transition-all duration-300 group overflow-hidden
      ${active 
        ? 'bg-sky-50 text-sky-600 border-r-4 border-sky-600' 
        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }
    `}
    title={!isOpen ? label : ''}
  >
    <div className={`
      relative z-10 transition-transform duration-300 flex-shrink-0
      ${active ? 'scale-110' : 'group-hover:scale-110'}
    `}>
      {icon}
    </div>
    
    <span className={`
      relative z-10 text-base font-semibold whitespace-nowrap transition-all duration-300 origin-left
      ${isOpen ? 'opacity-100 translate-x-0 w-auto' : 'opacity-0 -translate-x-4 w-0 overflow-hidden absolute md:static'}
    `}>
      {label}
    </span>
  </button>
);

const App: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [cloudConfig, setCloudConfig] = useState<CloudConfig>({ 
      provider: 'pocketbase', // 默认使用 PocketBase
      pocketbaseUrl: 'http://192.168.0.11:9009',
      pocketbaseEmail: '',
      pocketbasePassword: '',
      autoSync: true, 
      projectId: 'park_data_main' 
  });
  
  const [aiConfig, setAiConfig] = useState<AIConfig>({
      provider: 'qwen', // 默认使用千问
      enabled: true,
      qwenApiKey: 'sk-sp-1b86ef09510e4e1683454766f375ad1b',
      qwenBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1', // 默认使用 OpenAI 兼容协议
      openaiApiKey: '',
      openaiBaseUrl: ''
  });
  
  const [isCloudConnected, setIsCloudConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTestingCloud, setIsTestingCloud] = useState(false);
  const [cloudConnectionMsg, setCloudConnectionMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);
  
  const [cloudHistory, setCloudHistory] = useState<CloudBackupMetadata[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [snapshotNote, setSnapshotNote] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isAssistantOpen, setAssistantOpen] = useState(false);
  const [isAIDialogOpen, setAIDialogOpen] = useState(false);
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
  const [targetModalType, setTargetModalType] = useState<'revenue' | 'occupancy'>('revenue');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'buildings' | 'contracts' | 'finance' | 'budget' | 'settings'>('dashboard');
  const [lastSaved, setLastSaved] = useState<string>('');
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedQuarter, setSelectedQuarter] = useState<'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4'>('All');
  const [billingSelectedMonth, setBillingSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [targetForm, setTargetForm] = useState({ revenue: 0, occupancy: 0 });

  const [isInitDataModalOpen, setIsInitDataModalOpen] = useState(false);
  const [initDataYear, setInitDataYear] = useState<number>(2024);
  const [tempInitData, setTempInitData] = useState<MonthlyInitData[]>([]);

  // New state for auto-restore prompt
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [latestBackup, setLatestBackup] = useState<CloudBackupMetadata | null>(null);

  useEffect(() => {
    if (window.innerWidth >= 1024) {
        setSidebarOpen(true);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        const savedConfig = localStorage.getItem(CLOUD_CONFIG_KEY);
        let configToUse = cloudConfig;
        
        if (savedConfig) {
            const parsed = JSON.parse(savedConfig);
            configToUse = { ...parsed, supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY };
            setCloudConfig(configToUse);
        }
        
        // 加载AI配置
        const savedAIConfig = localStorage.getItem('ai_config');
        if (savedAIConfig) {
            try {
                const parsedAI = JSON.parse(savedAIConfig);
                console.log('[App] 加载保存的AI配置:', parsedAI);
                setAiConfig(parsedAI);
            } catch (e) {
                console.error('[App] AI配置加载失败:', e);
            }
        } else {
            console.log('[App] 未找到保存的AI配置，使用默认配置');
        }
        
        // 初始化云服务
        await initCloud(configToUse);

        checkConnection(configToUse).then(async connected => {
             setIsCloudConnected(connected);
             if (connected) {
                 // 获取云端备份历史
                 const res = await fetchCloudHistory(configToUse);
                 if (res.success && res.data) {
                     setCloudHistory(res.data);
                     // 如果有最新备份，静默恢复，不弹窗
                     if (res.data.length > 0) {
                         const latest = res.data[0];
                         setLatestBackup(latest);
                         
                         // 自动静默恢复最新备份
                         console.log('自动恢复最新云端备份:', latest.id);
                         const backupRes = await fetchCloudBackup(configToUse, latest.id);
                         if (backupRes.success && backupRes.data) {
                             const safeData = { ...generateInitialData(), ...backupRes.data };
                             recalculateMetrics(safeData, currentYear, 'All');
                             localStorage.setItem(STORAGE_KEY, JSON.stringify(safeData));
                             console.log('云端备份恢复成功');
                             return; // 直接返回，不再加载本地数据
                         }
                     }
                 }
             }
        });

        // 如果没有云端备份或恢复失败，加载本地数据
        const savedData = localStorage.getItem(STORAGE_KEY);
        let parsedData: DashboardData | null = null;
        if (savedData) parsedData = JSON.parse(savedData);

        if (parsedData) {
          const safeData = { ...generateInitialData(), ...parsedData };
          recalculateMetrics(safeData, currentYear, 'All');
          setLastSaved(new Date().toLocaleTimeString());
        } else {
          const initialData = generateInitialData();
          recalculateMetrics(initialData, currentYear, 'All');
        }
      } catch (e) {
        console.error("Failed to load local data", e);
        const initialData = generateInitialData();
        recalculateMetrics(initialData, currentYear, 'All');
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (data) {
      const timer = setTimeout(async () => {
        try {
            // 保存到本地
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            setLastSaved(new Date().toLocaleTimeString());
            
            // 自动保存到云端（覆盖模式）
            if (isCloudConnected && cloudConfig.provider === 'pocketbase') {
                console.log('自动保存到 PocketBase...');
                const result = await saveToCloud(data, cloudConfig, '自动实时备份');
                if (result.success) {
                    console.log('PocketBase 自动保存成功');
                } else {
                    console.warn('PocketBase 自动保存失败:', result.message);
                }
            }
        } catch (e) {
            console.error("Save failed", e);
        }
      }, 2000); 
      return () => clearTimeout(timer);
    }
  }, [data, isCloudConnected, cloudConfig]);

  useEffect(() => {
      if (data) {
          recalculateMetrics(data);
      }
  }, [billingSelectedMonth]);

  const handleCloudConfigSave = async () => {
      setIsTestingCloud(true);
      setCloudConnectionMsg(null);
      await new Promise(r => setTimeout(r, 600));
      localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfig));
      
      // 初始化云服务
      await initCloud(cloudConfig);
      
      const connected = await checkConnection(cloudConfig);
      setIsCloudConnected(connected);
      setIsTestingCloud(false);
      
      if(connected) {
          setCloudConnectionMsg({type: 'success', text: "连接成功！"});
          fetchCloudHistory(cloudConfig);
      } else {
          setCloudConnectionMsg({type: 'error', text: "连接失败，请检查网络。"});
      }
  };

  const fetchCloudHistory = async (config = cloudConfig) => {
      setIsLoadingHistory(true);
      const res = await getCloudHistory(config);
      setIsLoadingHistory(false);
      if (res.success && res.data) setCloudHistory(res.data);
      return res;
  };

  const openSnapshotModal = () => {
      setSnapshotNote('');
      setIsSnapshotModalOpen(true);
  };

  const confirmCloudSave = async () => {
      if (!data) return;
      if (!operatorName.trim()) {
          alert("请填写操作人员姓名");
          return;
      }
      setIsSyncing(true);
      setIsSnapshotModalOpen(false);
      const timestamp = new Date().toLocaleString();
      const finalNote = `${operatorName} ${timestamp} ${snapshotNote ? `(${snapshotNote})` : ''}`;
      const res = await saveToCloud(data, cloudConfig, finalNote);
      setIsSyncing(false);
      if (res.success) {
          alert("✅ 云端备份成功！");
          fetchCloudHistory();
      } else {
          alert("保存失败: " + res.message);
      }
  };

  const handleSaveBudgetToCloud = async (scenarioName: string, operator: string) => {
      if (!data) return;
      setIsSyncing(true);
      const timestamp = new Date().toLocaleString();
      const finalNote = `[预算方案] ${operator} ${timestamp} - ${scenarioName}`;
      const res = await saveToCloud(data, cloudConfig, finalNote);
      setIsSyncing(false);
      if (res.success) alert("✅ 预算方案已保存至云端！");
      else alert("保存失败: " + res.message);
  };

  const handleQuickCloudSave = async () => {
      if (!isCloudConnected) {
          if (confirm("云端同步连接未建立。是否重试连接？")) {
              setActiveTab('settings');
              handleCloudConfigSave();
          }
          return;
      }
      openSnapshotModal();
  };

  const handleConfirmRestoreLatest = async () => {
      if (!latestBackup) return;
      setIsSyncing(true);
      try {
          const res = await fetchCloudBackup(cloudConfig, latestBackup.id);
          if (res.success && res.data) {
              const safeData = { ...generateInitialData(), ...res.data };
              recalculateMetrics(safeData, selectedYear, selectedQuarter);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(safeData));
              setShowRestorePrompt(false);
              // alert("✅ 系统已同步至最新云端版本");
          } else {
              alert("同步失败: " + res.message);
          }
      } catch (e) {
          console.error(e);
          alert("同步过程中发生错误");
      } finally {
          setIsSyncing(false);
      }
  };

  const handleDownloadCloudBackup = async (backupId: string, note?: string) => {
      setRestoringId(backupId);
      await new Promise(resolve => setTimeout(resolve, 300));
      try {
        const res = await fetchCloudBackup(cloudConfig, backupId);
        if (res.success && res.data) {
            const dataStr = JSON.stringify(res.data, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `cloud_backup_${note ? note.replace(/\s+/g, '_') : 'snapshot'}_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } else alert("下载失败: " + res.message);
      } catch (e) {
          alert("下载过程中发生意外错误");
      } finally {
          setRestoringId(null);
      }
  };

  const handleRestoreCloudBackup = async (backupId: string) => {
      if (!window.confirm("⚠️ 警告：覆盖操作\n\n确定要将此历史备份恢复到当前系统吗？\n当前本地的所有数据将被此备份完全覆盖且无法撤销。\n\n恢复后页面将自动刷新。")) return;
      setRestoringId(backupId);
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
          const res = await fetchCloudBackup(cloudConfig, backupId);
          if (res.success && res.data) {
              const safeData = { ...generateInitialData(), ...res.data };
              localStorage.setItem(STORAGE_KEY, JSON.stringify(safeData));
              alert("✅ 恢复成功！系统正在刷新...");
              window.location.reload();
          } else alert("恢复失败: " + res.message);
      } catch (e) {
          alert("恢复过程中发生未知错误");
      } finally {
          setRestoringId(null);
      }
  };

  const calculateTrends = (
      tenants: Tenant[], 
      virtualTenants: Tenant[], 
      payments: PaymentRecord[], 
      totalLeasableArea: number,
      selfUseUnitIds: Set<string>,
      year: number,
      quarter: 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4',
      assumptions: BudgetAssumption[],
      adjustments: BudgetAdjustment[],
      initializationData: MonthlyInitData[] = [],
      buildings: Building[] = []
  ): MonthlyTrend[] => {
      const trends: MonthlyTrend[] = [];
      const now = new Date();
      const currentSystemYear = now.getFullYear();
      const currentSystemMonth = now.getMonth(); // 0-11

      // Map to quickly check if a building is a 'Site' (and thus excluded from occupancy)
      const buildingMap = new Map(buildings.map(b => [b.id, b]));

      let startMonth = 0; 
      let endMonth = 11; 

      if (quarter === 'Q1') { endMonth = 2; }
      else if (quarter === 'Q2') { startMonth = 3; endMonth = 5; }
      else if (quarter === 'Q3') { startMonth = 6; endMonth = 8; }
      else if (quarter === 'Q4') { startMonth = 9; endMonth = 11; }

      for (let month = startMonth; month <= endMonth; month++) {
          const monthLabel = `${month + 1}月`;
          const initEntry = initializationData.find(d => d.year === year && d.month === (month + 1));

          const startDate = new Date(year, month, 1);
          const endDate = new Date(year, month + 1, 0); 

          // Future Check for Financials
          const isFutureMonth = year > currentSystemYear || (year === currentSystemYear && month > currentSystemMonth);

          let leasedAreaInMonth = 0;
          let totalRentInMonth = 0;
          let physicalTenantAreaForPrice = 0;

          // LOGIC SYNC: Calculate Leased Area using "Signing/Leasing Achievement" (招商口径)
          tenants.forEach(t => {
              // SKIP SITES: Occupancy Rate does not include 'Site' type buildings
              const building = buildingMap.get(t.buildingId);
              if (building && building.type === 'Site') return;

              const isSelfUse = t.unitIds.some(uid => selfUseUnitIds.has(uid));
              if (isSelfUse) return;

              // Use Signing Date as achievements trigger
              const achievedDate = t.signingDate ? new Date(t.signingDate) : new Date(t.leaseStart);
              
              // STRICT OCCUPANCY CHECK: 
              // Must not have terminated before end of this month
              // If Lease Ends naturally in May, they are not occupied in June
              const leaseEnd = t.leaseEnd ? new Date(t.leaseEnd) : new Date('2099-12-31');
              const terminationDate = t.terminationDate ? new Date(t.terminationDate) : null;
              
              // The effective date the tenant leaves (either natural expiry or early termination)
              const effectiveEnd = terminationDate && terminationDate < leaseEnd ? terminationDate : leaseEnd;
              
              // To count for the month:
              // 1. Signed on or before end of month
              // 2. Lease effectively ends AFTER the end of the month (snapshot view)
              // This creates a forecast view where expiring leases drop off
              const isOccupied = achievedDate <= endDate && effectiveEnd > endDate;

              if (isOccupied) {
                   leasedAreaInMonth += t.totalArea;
              }

              // Average Unit Price calculation remains PHYSICAL (rent generating) for accuracy
              const physicalLeaseStart = new Date(t.leaseStart);
              if (physicalLeaseStart <= endDate && effectiveEnd >= startDate) {
                  let price = t.unitPrice;
                  if (!price && t.totalArea > 0) price = (t.monthlyRent / t.totalArea) * 12 / 365;
                  price = price || 0;
                  totalRentInMonth += (price * t.totalArea);
                  physicalTenantAreaForPrice += t.totalArea;
              }
          });

          let occupancyRate = totalLeasableArea > 0 ? Number(((leasedAreaInMonth / totalLeasableArea) * 100).toFixed(1)) : 0;
          let avgUnitPrice = physicalTenantAreaForPrice > 0 ? Number((totalRentInMonth / physicalTenantAreaForPrice).toFixed(2)) : 0;
          
          // UPDATED Logic: Use Reconciled Billing Data for Actuals in Collection Rate
          const monthlyBillingDetails = getBillingDetailsForPeriodInternal(year, month, tenants, virtualTenants, selfUseUnitIds, assumptions, adjustments, payments);
          const monthlyActualBilled = monthlyBillingDetails.reduce((sum, d) => sum + d.amountPaid, 0);
          const monthlyTargetBilled = monthlyBillingDetails.reduce((sum, d) => sum + d.amountDue, 0);

          let revenueTarget = monthlyTargetBilled;
          let revenueCollected: number | null = monthlyActualBilled;
          let collectionRate: number | null = revenueTarget > 0 ? Math.round((revenueCollected / revenueTarget) * 100) : 0;
          
          if (initEntry) {
              occupancyRate = initEntry.occupancyRate;
              revenueCollected = initEntry.revenueCollected;
              if (initEntry.revenueTarget !== undefined) {
                  revenueTarget = initEntry.revenueTarget;
              }
              collectionRate = revenueTarget > 0 ? Math.round((revenueCollected / revenueTarget) * 100) : 0;
          }
          
          // Hide Actuals for Future Months
          if (isFutureMonth) {
              revenueCollected = null;
              collectionRate = null;
          }

          trends.push({ month: monthLabel, occupancyRate, revenueTarget, revenueCollected, avgUnitPrice, collectionRate });
      }
      return trends;
  };

  // Internal helper to avoid closure issues in calculateTrends
  const getBillingDetailsForPeriodInternal = (
      year: number, 
      month: number,
      allTenants: Tenant[],
      virtualTenants: Tenant[],
      selfUseUnitIds: Set<string>,
      assumptions: BudgetAssumption[],
      adjustments: BudgetAdjustment[],
      payments: PaymentRecord[]
  ): BillingDetail[] => {
      const periodStart = new Date(year, month, 1);
      const periodEnd = new Date(year, month + 1, 0);
      const periodPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
      
      const details: BillingDetail[] = [];
      const combinedTenants = [...allTenants, ...virtualTenants];

      combinedTenants.forEach(t => {
        const isSelfUse = t.unitIds.some(uid => selfUseUnitIds.has(uid));
        // Note: For actual collection rate, virtual tenants represent potential income that should be billed
        if (isSelfUse || (t.status === 'Terminated' && !t.id.startsWith('virt_'))) return;

        const amountDue = calculateBudgetedReceivableInPeriod([t], periodStart, periodEnd, selfUseUnitIds, assumptions, adjustments);
        
        // CRITICAL CHANGE: Only include 'Rent' type, exclude DepositToRent and others
        const amountPaid = payments.filter(p => 
            p.tenantId === t.id && 
            p.type === 'Rent' && 
            p.date.startsWith(periodPrefix)
        ).reduce((sum, p) => sum + p.amount, 0);

        if (amountDue > 0 || amountPaid > 0) {
            let status: BillingDetail['status'] = 'Unpaid';
            if (amountPaid >= amountDue && amountDue > 0) status = 'Paid';
            else if (amountPaid > 0 && amountPaid < amountDue) status = 'Partial';
            else if (amountDue === 0 && amountPaid > 0) status = 'Paid';
            details.push({ tenantId: t.id, tenantName: t.name, unitIds: t.unitIds, amountDue, amountPaid, status });
        }
      });
      return details;
  };

  const getBillingDetailsForPeriod = (year: number, month: number): BillingDetail[] => {
      if (!data) return [];
      const selfUseUnitIds = new Set<string>();
      data.buildings.forEach(b => b.units.forEach(u => u.isSelfUse && selfUseUnitIds.add(u.id)));
      const virtualTenants = getVirtualTenants(data.tenants, data.buildings, data.budgetAssumptions || []);
      
      return getBillingDetailsForPeriodInternal(
          year, month, data.tenants, virtualTenants, selfUseUnitIds, 
          data.budgetAssumptions || [], data.budgetAdjustments || [], data.payments
      );
  };

  const recalculateMetrics = (currentData: DashboardData, year: number = selectedYear, quarter: 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4' = selectedQuarter) => {
    const tenants = currentData.tenants || [];
    const buildings = currentData.buildings || [];
    const payments = currentData.payments || [];
    const assumptions = currentData.budgetAssumptions || [];
    const adjustments = currentData.budgetAdjustments || [];
    const initData = currentData.initializationData || [];
    const invoices = currentData.invoices || [];

    const yearlyTargetsMap = currentData.yearlyTargets || {};
    const yearTargets = yearlyTargetsMap[year] || { revenue: 0, occupancy: 0 };

    let periodStart = new Date(year, 0, 1);
    let periodEnd = new Date(year, 11, 31);
    if (quarter === 'Q1') { periodEnd = new Date(year, 2, 31); }
    else if (quarter === 'Q2') { periodStart = new Date(year, 3, 1); periodEnd = new Date(year, 5, 30); }
    else if (quarter === 'Q3') { periodStart = new Date(year, 6, 1); periodEnd = new Date(year, 8, 30); }
    else if (quarter === 'Q4') { periodStart = new Date(year, 9, 1); periodEnd = new Date(year, 11, 31); }

    const selfUseUnitIds = new Set<string>();
    const syncedBuildings = buildings.map(b => ({
        ...b,
        units: b.units.map(u => {
             if (u.isSelfUse) selfUseUnitIds.add(u.id);
             const activeTenant = tenants.find(t => t.buildingId === b.id && t.unitIds.includes(u.id) && (t.status === 'Active' || t.status === 'Expiring' || t.status === 'Pending'));
             let newStatus = u.status;
             if (activeTenant) { newStatus = UnitStatus.Occupied; } 
             else if (u.status === UnitStatus.Occupied && !u.isSelfUse) { newStatus = UnitStatus.Vacant; }
             return { ...u, status: newStatus };
        })
    }));

    // CRITICAL: Filter out "Site" type buildings from Leasable Area calculation
    let totalLeasableArea = 0;
    syncedBuildings.forEach(b => { 
        if (b.type === 'Site') return; // Skip Sites
        b.units.forEach(u => { 
            if (!u.isSelfUse) { totalLeasableArea += u.area; } 
        }); 
    });

    const virtualTenants = getVirtualTenants(tenants, syncedBuildings, assumptions);

    const monthlyTrends = calculateTrends(tenants, virtualTenants, payments, totalLeasableArea, selfUseUnitIds, year, quarter, assumptions, adjustments, initData, buildings);
    const prevYearMonthlyTrends = calculateTrends(tenants, virtualTenants, payments, totalLeasableArea, selfUseUnitIds, year - 1, 'All', assumptions, adjustments, initData, buildings);

    const annualRevenueCollected = monthlyTrends.reduce((sum, t) => sum + (t.revenueCollected || 0), 0);
    const annualRevenueTarget = monthlyTrends.reduce((sum, t) => sum + t.revenueTarget, 0);
    const monthlyRevenueTarget = monthlyTrends.reduce((sum, t) => sum + t.revenueTarget, 0);
    const monthlyRevenueCollected = annualRevenueCollected; 
    
    // NEW LOGIC: Calculate Occupancy Rate based on CURRENT SNAPSHOT (Real-time) to match Building Manager
    const now = new Date();
    let snapshotTotalLeasable = 0;
    let snapshotLeased = 0;

    syncedBuildings.forEach(b => {
        if (b.type === 'Site') return; // Exclude Sites
        b.units.forEach(u => {
            if (!u.isSelfUse) snapshotTotalLeasable += u.area;
        });
    });

    tenants.forEach(t => {
        if (t.status === 'Expired') return;
        const building = buildings.find(b => b.id === t.buildingId);
        if (building && building.type === 'Site') return; // Exclude Sites

        // Logic sync with BuildingManager: Signing Date based, Real-time
        const achievedDate = t.signingDate ? new Date(t.signingDate) : new Date(t.leaseStart);
        const terminated = t.terminationDate ? new Date(t.terminationDate) : null;
        
        const isOccupiedNow = achievedDate <= now && (!terminated || terminated > now);
        
        if (isOccupiedNow) {
            snapshotLeased += t.totalArea;
        }
    });

    const realTimeOccupancyRate = snapshotTotalLeasable > 0 
        ? Number(((snapshotLeased / snapshotTotalLeasable) * 100).toFixed(1)) 
        : 0;
    
    const collectionRate = annualRevenueTarget > 0 ? Math.min(100, Math.round((annualRevenueCollected / annualRevenueTarget) * 100)) : 0;

    // 计算累计欠款：基于月度账单明细中未核销的金额总和，跨年累计
    let accumulatedArrears = 0;
    
    // 1. 获取初始化数据中的2025年累计欠款（2026年1月作为起始年度）
    const init2025 = initData.find(d => d.year === 2025 && d.month === 12); // 使用25年12月的初始化数据
    const initialArrears = init2025?.accumulatedArrears || 0;
    
    // 2. 计算所有2026年及之后的所有月份账单的未核销金额
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth(); // 0-11
    
    // 遍历从2026年1月到当前月份的所有账单
    for (let year = 2026; year <= nowYear; year++) {
        const startMonth = (year === 2026) ? 0 : 0; // 从1月开始
        const endMonth = (year === nowYear) ? nowMonth - 1 : 11; // 当年只到上月，其他年到12月
        
        for (let month = startMonth; month <= endMonth; month++) {
            const billingDetails = getBillingDetailsForPeriodInternal(
                year, month, tenants, virtualTenants, selfUseUnitIds, 
                assumptions, adjustments, payments
            );
            
            // 统计未完全核销的账单（Unpaid 和 Partial）
            billingDetails.forEach(detail => {
                if (detail.status === 'Unpaid') {
                    // 全额未付
                    accumulatedArrears += detail.amountDue;
                } else if (detail.status === 'Partial') {
                    // 部分未付
                    accumulatedArrears += (detail.amountDue - detail.amountPaid);
                }
            });
        }
    }
    
    // 3. 加上初始化欠款（2025年及之前）
    accumulatedArrears += initialArrears;

    let leasedArea = 0;
    tenants.forEach(t => {
        // SKIP SITES from Global Leased Area
        const building = buildings.find(b => b.id === t.buildingId);
        if (building && building.type === 'Site') return;

        const isSelfUse = t.unitIds.some(uid => selfUseUnitIds.has(uid));
        if (isSelfUse) return;
        
        // ACHIEVEMENTS SYNC: Count area based on Signing Date
        const achievedDate = t.signingDate ? new Date(t.signingDate) : new Date(t.leaseStart);
        const terminated = t.terminationDate ? new Date(t.terminationDate) : null;
        
        // Achieved if signed on or before period end, and not terminated before period end
        const isAchieved = achievedDate <= periodEnd && (!terminated || terminated > periodEnd);
        
        if (isAchieved) {
            leasedArea += t.totalArea;
        }
    });

    const recentSignings = tenants.filter(t => { 
        if (t.status === 'Expired') return false; 
        const start = new Date(t.leaseStart); 
        return start >= periodStart && start <= periodEnd; 
    }).slice(0, 10);
    
    const expiringSoon = tenants.filter(t => { 
        if (t.status === 'Expired' || t.status === 'Terminated') return false;
        const end = new Date(t.leaseEnd); 
        return end >= periodStart && end <= periodEnd; 
    });
    
    // Leasing Velocity Calculations - 按月计算（用于招商动能卡片）
    const newSigningsInMonth = tenants.filter(t => 
        t.status !== 'Expired' && 
        t.status !== 'Terminated' &&
        t.signingDate && 
        t.signingDate.startsWith(billingSelectedMonth)
    );
    const newContractsCount = newSigningsInMonth.length;
    const newContractsAreaMonth = newSigningsInMonth.reduce((sum, t) => sum + (t.totalArea || 0), 0);

    // 按年度计算新签面积（用于出租率卡片）
    const currentYear = new Date().getFullYear();
    const newSigningsInYear = tenants.filter(t => 
        t.signingDate && 
        t.signingDate.startsWith(String(selectedYear)) // 按选中的年份统计
    );
    const newContractsArea = newSigningsInYear.reduce((sum, t) => sum + (t.totalArea || 0), 0);

    const terminatedInMonth = tenants.filter(t => 
        t.status === ContractStatus.Terminated &&
        t.terminationDate &&
        t.terminationDate.startsWith(billingSelectedMonth)
    );
    const terminatedContractsCount = terminatedInMonth.length;
    const terminatedContractsArea = terminatedInMonth.reduce((sum, t) => sum + (t.totalArea || 0), 0);
    const netIncreaseArea = newContractsAreaMonth - terminatedContractsArea;

    let billingYear = new Date().getFullYear();
    let billingMonth = new Date().getMonth();
    if (billingSelectedMonth) {
        const parts = billingSelectedMonth.split('-');
        if (parts.length === 2) { billingYear = parseInt(parts[0], 10); billingMonth = parseInt(parts[1], 10) - 1; }
    }
    
    const currentMonthBilling = getBillingDetailsForPeriodInternal(billingYear, billingMonth, tenants, virtualTenants, selfUseUnitIds, assumptions, adjustments, payments);

    const parkingRevenueInPeriod = payments.filter(p => { const pDate = new Date(p.date); return pDate >= periodStart && pDate <= periodEnd && p.type === 'ParkingFee'; }).reduce((sum, p) => sum + p.amount, 0);
    const parkingDetails: ParkingStatDetail[] = []; 
    let totalContractSpaces = 0; let totalActualSpaces = 0;
    tenants.forEach(t => {
         if (t.status === 'Expired' || t.status === 'Terminated') return;
         const contractCount = t.contractParkingSpaces !== undefined ? t.contractParkingSpaces : (t.parkingSpaces || 0);
         const actualCount = t.actualParkingSpaces !== undefined ? t.actualParkingSpaces : (t.parkingSpaces || 0);
         if (contractCount > 0 || actualCount > 0) {
            totalContractSpaces += contractCount; totalActualSpaces += actualCount;
            parkingDetails.push({ tenantId: t.id, tenantName: t.name, contractCount, actualCount });
         }
    });
    
    const parkingStats = { totalContractSpaces, totalActualSpaces, totalMonthlyRevenue: parkingRevenueInPeriod, details: parkingDetails };

    const processedData: DashboardData = {
        ...currentData, 
        buildings: syncedBuildings, 
        tenants: tenants, 
        payments: payments, 
        totalArea: totalLeasableArea, 
        leasedArea, 
        occupancyRate: realTimeOccupancyRate,
        annualRevenueTarget: yearTargets.revenue, 
        annualOccupancyTarget: yearTargets.occupancy, 
        annualRevenueCollected, 
        monthlyRevenueTarget, 
        monthlyRevenueCollected, 
        collectionRate,
        accumulatedArrears, // 新增：累计欠款
        newContractsCount,
        newContractsArea,
        terminatedContractsCount,
        terminatedContractsArea,
        netIncreaseArea,
        recentSignings, 
        expiringSoon, 
        monthlyTrends, 
        prevYearMonthlyTrends, 
        currentMonthBilling, 
        parkingStats,
        budgetAssumptions: assumptions, 
        budgetAdjustments: adjustments, 
        budgetAnalysis: currentData.budgetAnalysis || { occupancy: '', revenue: '' },
        initializationData: initData,
        invoices: invoices
    };

    setData(processedData); 
  };

  const updateBuildings = (newBuildings: Building[]) => {
      if (!data) return;
      const updatedTenants = data.tenants.map(t => {
          let newTotalArea = 0;
          t.unitIds.forEach(uid => { for (const b of newBuildings) { const unit = b.units.find(u => u.id === uid); if (unit) { newTotalArea += unit.area; break; } } });
          newTotalArea = parseFloat(newTotalArea.toFixed(2));
          if (Math.abs(newTotalArea - t.totalArea) < 0.01) return t;
          let price = t.unitPrice;
          if ((price === undefined || price === 0) && t.totalArea > 0) { price = (t.monthlyRent * 12) / (t.totalArea * 365); }
          price = price || 0;
          const newMonthlyRent = Math.round(price * (365 / 12) * newTotalArea);
          return { ...t, totalArea: newTotalArea, monthlyRent: newMonthlyRent, unitPrice: price };
      });
      recalculateMetrics({ ...data, buildings: newBuildings, tenants: updatedTenants });
  };

  const handleBatchUpdate = (updates: Partial<DashboardData>) => {
      if (!data) return;
      const cleanUpdates: Partial<DashboardData> = {};
      (Object.keys(updates) as Array<keyof DashboardData>).forEach(key => { if (updates[key] !== undefined) { cleanUpdates[key] = updates[key] as any; } });
      const mergedData = { ...data, ...cleanUpdates };
      recalculateMetrics(mergedData);
  };

  const handleDeferPayment = (tenantId: string, year?: number, month?: number) => {
      if (!data) return;
      const tenant = data.tenants.find(t => t.id === tenantId);
      if (!tenant) return;
      let targetYear, targetMonth;
      if (year !== undefined && month !== undefined) { targetYear = year; targetMonth = month; } 
      else { const parts = billingSelectedMonth.split('-'); if (parts.length === 2) { targetYear = parseInt(parts[0], 10); targetMonth = parseInt(parts[1], 10) - 1; } else { targetYear = new Date().getFullYear(); targetMonth = new Date().getMonth(); } }
      const periodStart = new Date(targetYear, targetMonth, 1);
      const periodEnd = new Date(targetYear, targetMonth + 1, 0);
      const selfUseUnitIds = new Set<string>();
      data.buildings.forEach(b => b.units.forEach(u => u.isSelfUse && selfUseUnitIds.add(u.id)));
      
      const amountDue = calculateBudgetedReceivableInPeriod([tenant], periodStart, periodEnd, selfUseUnitIds, data.budgetAssumptions || [], data.budgetAdjustments || []);
      
      if (amountDue <= 0) { alert("该月份无应收金额，无法缓缴。"); return; }
      let nextMonth = targetMonth + 1; let nextYear = targetYear;
      if (nextMonth > 11) { nextMonth = 0; nextYear++; }
      const newAdj: BudgetAdjustment = { id: `adj_defer_${Date.now()}`, tenantId: tenant.id, tenantName: tenant.name, originalYear: targetYear, originalMonth: targetMonth, adjustedYear: nextYear, adjustedMonth: nextMonth, amount: amountDue, reason: '申请缓缴 (Defer Payment)' };
      const newAdjustments = [...(data.budgetAdjustments || []), newAdj];
      recalculateMetrics({ ...data, budgetAdjustments: newAdjustments });
      alert(`已申请缓缴！\n客户: ${tenant.name}\n金额: ¥${amountDue.toLocaleString()}\n已延期至: ${nextYear}年${nextMonth+1}月`);
  };

  const updateBudgetScenarios = (newScenarios: BudgetScenario[]) => {
      if (!data) return;
      setData({...data, budgetScenarios: newScenarios});
  };

  const handleRenameScenario = (id: string, newName: string) => {
      if (!data || !data.budgetScenarios) return;
      const updated = data.budgetScenarios.map(s => s.id === id ? {...s, name: newName} : s);
      setData({...data, budgetScenarios: updated});
  };

  const handleActivateScenario = (scenario: BudgetScenario) => {
      if (!data) return;
      const scenarioList = data.budgetScenarios || [];
      const updatedScenarios = scenarioList.map(s => ({
          ...s,
          isActive: s.id === scenario.id 
      }));
      recalculateMetrics({
          ...data,
          budgetScenarios: updatedScenarios,
          budgetAssumptions: scenario.assumptions,
          budgetAdjustments: scenario.adjustments
      });
  };

  const updateTenants = (newTenants: Tenant[]) => { if (!data) return; recalculateMetrics({ ...data, tenants: newTenants }); };
  const updatePayments = (newPayments: PaymentRecord[]) => { if (!data) return; recalculateMetrics({ ...data, payments: newPayments }); };
  const updateBudgetAssumptions = (newAssumptions: BudgetAssumption[]) => { if (!data) return; recalculateMetrics({ ...data, budgetAssumptions: newAssumptions }); };
  const updateBudgetAdjustments = (newAdjustments: BudgetAdjustment[]) => { if (!data) return; recalculateMetrics({ ...data, budgetAdjustments: newAdjustments }); };
  const updateBudgetAnalysis = (newAnalysis: BudgetAnalysisData) => { if (!data) return; recalculateMetrics({ ...data, budgetAnalysis: newAnalysis }); };
  const updateInvoices = (newInvoices: InvoiceRecord[]) => { if (!data) return; recalculateMetrics({ ...data, invoices: newInvoices }); };

  const openTargetModal = (type: 'revenue' | 'occupancy') => { 
      if (!data) return; 
      setTargetModalType(type); 
      setTargetForm({ revenue: data.annualRevenueTarget, occupancy: data.annualOccupancyTarget }); 
      setIsTargetModalOpen(true); 
  };
  
  const saveTargets = () => { 
      if (!data) return; 
      const newTargets = { ...data.yearlyTargets };
      newTargets[selectedYear] = { revenue: Number(targetForm.revenue), occupancy: Number(targetForm.occupancy) };
      recalculateMetrics({ ...data, yearlyTargets: newTargets }); 
      setIsTargetModalOpen(false); 
  };
  
  const handleResetData = () => { if (window.confirm("危险操作！\n\n确定要清空所有本地数据并恢复出厂设置吗？所有录入的合同、财务、楼宇修改记录都将丢失。")) { localStorage.removeItem(STORAGE_KEY); const initial = generateInitialData(); recalculateMetrics(initial, currentYear, 'All'); alert("系统数据已重置。"); } };

  const handleExport = () => { if (!data) return; const exportData = { buildings: data.buildings, tenants: data.tenants, payments: data.payments, yearlyTargets: data.yearlyTargets, initializationData: data.initializationData, invoices: data.invoices }; const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `park_data_${new Date().toISOString().split('T')[0]}.json`; link.click(); };
  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = (e) => { try { const imported = JSON.parse(e.target?.result as string); if (imported.buildings && imported.tenants) { const mergedData = { ...generateInitialData(), ...imported }; setSelectedYear(new Date().getFullYear()); setSelectedQuarter('All'); recalculateMetrics(mergedData, new Date().getFullYear(), 'All'); alert("数据导入成功！"); } else { alert("文件格式不正确 (需要JSON格式)"); } } catch (err) { alert("解析文件失败"); } }; reader.readAsText(file); } };

  const handleYearChange = (year: number) => {
      setSelectedYear(year);
      if (data) recalculateMetrics(data, year, selectedQuarter);
  };
  
  const loadTempInitData = (year: number) => {
      if (!data) return;
      const existing = data.initializationData || [];
      const rows: MonthlyInitData[] = [];
      for (let m = 1; m <= 12; m++) {
          const found = existing.find(d => d.year === year && d.month === m);
          rows.push(found ? { ...found } : { year, month: m, revenueTarget: 0, revenueCollected: 0, occupancyRate: 0 });
      }
      setTempInitData(rows);
  };

  const openInitDataModal = () => {
      if (!data) return;
      setInitDataYear(2023); // Default to earliest year
      loadTempInitData(2023);
      setIsInitDataModalOpen(true);
  };

  const handleInitYearChange = (year: number) => {
      setInitDataYear(year);
      loadTempInitData(year);
  };

  const updateTempInitData = (month: number, field: keyof MonthlyInitData, value: number) => {
      setTempInitData(prev => prev.map(row => row.month === month ? { ...row, [field]: value } : row));
  };

  const saveInitData = () => {
      if (!data) return;
      const otherData = (data.initializationData || []).filter(d => d.year !== initDataYear);
      const newData = [...otherData, ...tempInitData];
      
      const updatedData = { ...data, initializationData: newData };
      setData(updatedData);
      recalculateMetrics(updatedData); 
      setIsInitDataModalOpen(false);
  };

  const annualComparisonData: AnnualComparisonData[] = useMemo(() => {
      if (!data) return [];
      
      // Dynamic Year Generation based on Current System Date
      const currentSystemYear = new Date().getFullYear();
      // CHANGED: Display Current and Previous 2 Years (No Future)
      const years = [currentSystemYear - 2, currentSystemYear - 1, currentSystemYear];
      
      const result: AnnualComparisonData[] = [];

      years.forEach((year, i) => {
          const initRows = data.initializationData?.filter(d => d.year === year) || [];
          
          let yearlyActual = 0;
          for (let m = 1; m <= 12; m++) {
              const initEntry = initRows.find(d => d.month === m);
              if (initEntry) {
                  yearlyActual += initEntry.revenueCollected;
              } else {
                   const monthPrefix = `${year}-${String(m).padStart(2, '0')}`;
                   const monthlyPayments = data.payments
                      .filter(p => p.date.startsWith(monthPrefix) && (p.type === 'Rent' || p.type === 'DepositToRent' || p.type === 'ParkingFee'))
                      .reduce((sum, p) => sum + p.amount, 0);
                   yearlyActual += monthlyPayments;
              }
          }

          let yearlyTarget = data.yearlyTargets?.[year]?.revenue || 0;
          if (yearlyTarget === 0) {
               const initTargetSum = initRows.reduce((sum, r) => sum + (r.revenueTarget || 0), 0);
               if (initTargetSum > 0) yearlyTarget = initTargetSum;
          }

          let occupancy = 0;
          const decInit = initRows.find(d => d.month === 12);
          if (decInit) {
              occupancy = decInit.occupancyRate;
          } else if (year === selectedYear) {
               occupancy = data.occupancyRate;
          } else if (year === selectedYear - 1 && data.prevYearMonthlyTrends && data.prevYearMonthlyTrends.length > 0) {
               occupancy = data.prevYearMonthlyTrends[data.prevYearMonthlyTrends.length - 1].occupancyRate;
          }

          let revenueYoY: number | null = null;
          let occupancyYoY: number | null = null;
          
          if (i > 0) {
              const prev = result[i - 1];
              if (prev.revenueActual > 0) {
                  revenueYoY = ((yearlyActual - prev.revenueActual) / prev.revenueActual) * 100;
              }
              occupancyYoY = occupancy - prev.occupancyRate;
          }

          result.push({
              year,
              revenueTarget: yearlyTarget,
              revenueActual: yearlyActual,
              revenueCompletionRate: yearlyTarget > 0 ? (yearlyActual / yearlyTarget) * 100 : 0,
              revenueYoY,
              occupancyRate: occupancy,
              occupancyYoY
          });
      });
      
      return result;
  }, [data, selectedYear]);

  const invoiceScenario = data?.budgetScenarios?.find(s => s.id === 'invoice_dedicated');
  const invoiceAssumptions = invoiceScenario ? invoiceScenario.assumptions : (data?.budgetAssumptions?.filter(a => a.targetType === 'Existing') || []);
  const invoiceAdjustments = invoiceScenario ? invoiceScenario.adjustments : (data?.budgetAdjustments || []);

  if (!data) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="flex flex-col items-center gap-2"><Loader2 size={32} className="text-blue-500 animate-spin"/><div className="text-slate-400">Loading Dashboard...</div></div></div>;

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
      <div className={`fixed inset-0 bg-black/50 z-30 lg:hidden transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setSidebarOpen(false)} />
      
      <aside className={`fixed inset-y-0 left-0 z-40 bg-white border-r border-slate-200 transition-transform duration-300 flex flex-col h-screen shadow-xl w-64 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-64'}`}>
        <div className="h-16 flex items-center justify-center border-b border-slate-100 bg-white z-10">
            <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                      <span className="text-2xl font-bold italic text-sky-600 tracking-tight leading-none" style={{ fontFamily: 'sans-serif' }}>Kingdee</span>
                      <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded-md leading-none border border-sky-200">V4.0</span>
                  </div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-widest scale-90 origin-left">Software Park</span>
                </div>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="absolute right-4 top-5 text-slate-400 lg:hidden"><X size={20}/></button>
        </div>

        <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto scrollbar-hide">
          <SidebarItem icon={<LayoutDashboard size={22} />} label="工作台" isOpen={true} active={activeTab === 'dashboard'} onClick={() => { setActiveTab('dashboard'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
          <SidebarItem icon={<Building2 size={22} />} label="楼宇资管" isOpen={true} active={activeTab === 'buildings'} onClick={() => { setActiveTab('buildings'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
          <SidebarItem icon={<Users size={22} />} label="客户管理" isOpen={true} active={activeTab === 'contracts'} onClick={() => { setActiveTab('contracts'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
          <SidebarItem icon={<PieChart size={22} />} label="财务报表" isOpen={true} active={activeTab === 'finance'} onClick={() => { setActiveTab('finance'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
          <SidebarItem icon={<Calculator size={22} />} label="预算管理" isOpen={true} active={activeTab === 'budget'} onClick={() => { setActiveTab('budget'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
          <div className="my-2 h-px bg-slate-100 mx-4" />
          <SidebarItem icon={<Settings size={22} />} label="系统与备份" isOpen={true} active={activeTab === 'settings'} onClick={() => { setActiveTab('settings'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
        </nav>
      </aside>

      <main className="flex-1 transition-all duration-300 w-full overflow-hidden flex flex-col lg:pl-64">
        <header className="h-14 lg:h-16 bg-white border-b border-slate-200 sticky top-0 z-20 px-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 hover:bg-slate-100 rounded-lg text-slate-600 lg:hidden"><Menu size={20} /></button>
            <h1 className="text-base lg:text-xl font-bold text-slate-800 truncate">{activeTab === 'dashboard' ? '招商管理看板' : activeTab === 'buildings' ? '楼宇资产管理' : activeTab === 'contracts' ? '客户合同中心' : activeTab === 'finance' ? '财务收款报表' : activeTab === 'budget' ? '招商预算管理' : '系统设置'}</h1>
          </div>
          <div className="flex items-center gap-2">
             {activeTab === 'dashboard' && (
               <button 
                 onClick={() => setAIDialogOpen(true)}
                 className="hidden md:flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg font-medium text-sm"
               >
                 <Sparkles size={16} />
                 <span>AI 智能助手</span>
               </button>
             )}
             <div className={`hidden md:flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${isCloudConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`} title={isCloudConnected ? '已连接到金蝶云数据库' : '仅本地存储模式'}>
                 {isCloudConnected ? <CheckCircle2 size={12} className="text-emerald-500"/> : <Cloud size={12} />}
                 <span>{isCloudConnected ? '云端在线' : '本地模式'}</span>
             </div>
          </div>
        </header>

        <div className="p-3 md:p-6 max-w-7xl mx-auto w-full overflow-hidden">
          {activeTab === 'dashboard' && (
            <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <DashboardAlerts tenants={data.tenants} invoices={data.invoices} />
               <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                   <div className="flex items-center gap-2">
                       <Calendar className="text-blue-500" size={18}/>
                       <span className="font-bold text-slate-700 text-sm md:text-base">统计年度: {selectedYear}</span>
                   </div>
                   <div className="flex items-center bg-slate-50 rounded-lg p-1 border border-slate-200">
                       <button onClick={() => handleYearChange(selectedYear - 1)} className="p-1.5 hover:bg-white hover:shadow-sm rounded transition-all text-slate-600"><ChevronLeft size={16}/></button>
                       <span className="px-3 font-mono font-medium text-slate-800">{selectedYear}</span>
                       <button onClick={() => handleYearChange(selectedYear + 1)} className="p-1.5 hover:bg-white hover:shadow-sm rounded transition-all text-slate-600"><ChevronRight size={16}/></button>
                   </div>
               </div>

               <StatsCards data={data} selectedYear={selectedYear} onEditTargets={openTargetModal} tenants={data.tenants} />
               <AnnualMetricComparisonTable data={annualComparisonData} />
               <RecentActivityTable data={data} />
               <BillingTable data={data} selectedMonth={billingSelectedMonth} onMonthChange={setBillingSelectedMonth} />
            </div>
          )}

          {activeTab === 'buildings' && (<div className="animate-in fade-in zoom-in-50 duration-300"><BuildingManager buildings={data.buildings} tenants={data.tenants} onUpdateBuildings={updateBuildings} /></div>)}
          {activeTab === 'contracts' && (<div className="animate-in fade-in zoom-in-50 duration-300"><ContractManager tenants={data.tenants} buildings={data.buildings} onUpdateTenants={updateTenants} dashboardData={data} payments={data.payments} onUpdatePayments={updatePayments} /></div>)}
          {activeTab === 'finance' && (<div className="animate-in fade-in zoom-in-50 duration-300"><FinanceManager payments={data.payments} tenants={data.tenants} invoices={data.invoices || []} onUpdatePayments={updatePayments} onUpdateTenants={updateTenants} onUpdateInvoices={updateInvoices} onBatchUpdate={handleBatchUpdate} getBillingDetails={getBillingDetailsForPeriod} onDeferPayment={handleDeferPayment} /></div>)}
          {activeTab === 'budget' && (<div className="animate-in fade-in zoom-in-50 duration-300"><BudgetManager buildings={data.buildings} tenants={data.tenants} budgetAssumptions={data.budgetAssumptions} onUpdateAssumptions={updateBudgetAssumptions} budgetAdjustments={data.budgetAdjustments} onUpdateAdjustments={updateBudgetAdjustments} budgetAnalysis={data.budgetAnalysis} onUpdateAnalysis={updateBudgetAnalysis} payments={data.payments} scenarios={data.budgetScenarios || []} onUpdateScenarios={updateBudgetScenarios} onRenameScenario={handleRenameScenario} onActivateScenario={handleActivateScenario} onSaveBudgetToCloud={handleSaveBudgetToCloud} /></div>)}
          {activeTab === 'settings' && (
             <div className="animate-in fade-in zoom-in-50 duration-300 max-w-2xl mx-auto space-y-4">
                 <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                     <div className="p-4 md:p-6 border-b border-slate-200"><h2 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2"><Settings className="text-slate-400" /> 系统设置</h2></div>
                     
                     <div className="p-4 md:p-6 border-b border-slate-200 bg-indigo-50/30">
                         <div className="flex items-center gap-3 mb-4">
                             <div className="p-2 bg-white rounded-lg text-indigo-600 shadow-sm border border-indigo-100"><TableIcon size={24} /></div>
                             <div>
                                 <h3 className="font-bold text-slate-700">系统初始化数据 (2023-2025)</h3>
                                 <div className="text-sm text-slate-500 mt-1">手动录入历史月度应收、实收及出租率数据，用于看板展示。2025年12月支持录入累计欠款。</div>
                             </div>
                         </div>
                         <div className="bg-white p-4 rounded-lg border border-slate-200">
                             <button onClick={openInitDataModal} className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium flex items-center justify-center gap-2">
                                 <FileInput size={16} /> 录入/编辑 初始化数据
                             </button>
                         </div>
                     </div>

                     <div className="p-4 md:p-6 border-b border-slate-200 bg-sky-50/30">
                         <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-white rounded-lg text-sky-600 shadow-sm border border-sky-100"><CloudCog size={24} /></div><div><h3 className="font-bold text-slate-700">云端数据库配置</h3><div className="flex items-center gap-2 text-sm mt-1">{isCloudConnected ? (<span className="flex items-center gap-1 text-emerald-600 font-medium"><CheckCircle2 size={14} /> 已连接至{cloudConfig.provider === 'pocketbase' ? 'PocketBase' : 'Supabase'}数据库</span>) : (<span className="flex items-center gap-1 text-rose-500 font-medium"><AlertCircle size={14} /> 未连接 (请检查网络)</span>)}</div></div></div>
                         <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-4">
                             <div>
                                 <label className="block text-xs font-medium text-slate-500 mb-1">后端提供商</label>
                                 <select 
                                     className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600 outline-none focus:ring-1 focus:ring-sky-200"
                                     value={cloudConfig.provider} 
                                     onChange={e => setCloudConfig({...cloudConfig, provider: e.target.value as 'supabase' | 'pocketbase'})}
                                 >
                                     <option value="supabase">Supabase（当前使用）</option>
                                     <option value="pocketbase">PocketBase（推荐）</option>
                                 </select>
                             </div>
                                                 
                             {cloudConfig.provider === 'pocketbase' && (
                                 <>
                                     <div>
                                         <label className="block text-xs font-medium text-slate-500 mb-1">PocketBase URL</label>
                                         <input 
                                             type="text" 
                                             className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600 outline-none focus:ring-1 focus:ring-sky-200" 
                                             placeholder="http://127.0.0.1:8090"
                                             value={cloudConfig.pocketbaseUrl || ''}
                                             onChange={e => setCloudConfig({...cloudConfig, pocketbaseUrl: e.target.value})}
                                         />
                                     </div>
                                     <div>
                                         <label className="block text-xs font-medium text-slate-500 mb-1">邮箱</label>
                                         <input 
                                             type="email" 
                                             className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600 outline-none focus:ring-1 focus:ring-sky-200" 
                                             placeholder="admin@example.com"
                                             value={cloudConfig.pocketbaseEmail || ''}
                                             onChange={e => setCloudConfig({...cloudConfig, pocketbaseEmail: e.target.value})}
                                         />
                                     </div>
                                     <div>
                                         <label className="block text-xs font-medium text-slate-500 mb-1">密码</label>
                                         <input 
                                             type="password" 
                                             className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600 outline-none focus:ring-1 focus:ring-sky-200" 
                                             placeholder="请输入密码"
                                             value={cloudConfig.pocketbasePassword || ''}
                                             onChange={e => setCloudConfig({...cloudConfig, pocketbasePassword: e.target.value})}
                                         />
                                     </div>
                                 </>
                             )}
                                                 
                             <div>
                                 <label className="block text-xs font-medium text-slate-500 mb-1">项目标识 (Project ID)</label>
                                 <div className="flex gap-2">
                                     <input 
                                         type="text" 
                                         className="flex-1 bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600 outline-none focus:ring-1 focus:ring-sky-200" 
                                         value={cloudConfig.projectId} 
                                         onChange={e => setCloudConfig({...cloudConfig, projectId: e.target.value})} 
                                     />
                                     <button onClick={handleCloudConfigSave} className="bg-sky-500 text-white px-4 py-2 rounded text-sm hover:bg-sky-600 font-medium transition-colors">保存配置</button>
                                 </div>
                             </div>
                         </div>
                     </div>
                     
                     {/* AI API Configuration */}
                     <div className="p-4 md:p-6 border-b border-slate-200 bg-purple-50/30">
                         <div className="flex items-center gap-3 mb-4">
                             <div className="p-2 bg-white rounded-lg text-purple-600 shadow-sm border border-purple-100">
                                 <Sparkles size={24} />
                             </div>
                             <div>
                                 <h3 className="font-bold text-slate-700">AI 助手配置</h3>
                                 <div className="flex items-center gap-2 text-sm mt-1">
                                     {aiConfig.enabled ? (
                                         <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                             <CheckCircle2 size={14} /> 已启用 {aiConfig.provider === 'qwen' ? '千问' : 'OpenAI'}
                                         </span>
                                     ) : (
                                         <span className="flex items-center gap-1 text-slate-400 font-medium">
                                             <AlertCircle size={14} /> 未启用
                                         </span>
                                     )}
                                 </div>
                             </div>
                         </div>
                         <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-4">
                             <div>
                                 <label className="block text-xs font-medium text-slate-500 mb-1">AI 提供商</label>
                                 <select 
                                     className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600 outline-none focus:ring-1 focus:ring-purple-200"
                                     value={aiConfig.provider} 
                                     onChange={e => setAiConfig({...aiConfig, provider: e.target.value as AIConfig['provider']})}
                                 >
                                     <option value="none">不使用 AI</option>
                                     <option value="qwen">千问 (Qwen) - 阿里云 (推荐)</option>
                                     <option value="openai">OpenAI / 其他兼容API</option>
                                 </select>
                             </div>
                     
                             {aiConfig.provider === 'qwen' && (
                                 <>
                                     <div>
                                         <label className="block text-xs font-medium text-slate-500 mb-1">千问 API Key</label>
                                         <input 
                                             type="password" 
                                             className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600 outline-none focus:ring-1 focus:ring-purple-200" 
                                             placeholder="sk-xxxxx"
                                             value={aiConfig.qwenApiKey || ''}
                                             onChange={e => setAiConfig({...aiConfig, qwenApiKey: e.target.value})}
                                         />
                                         <p className="text-xs text-slate-400 mt-1">
                                             获取地址: <a href="https://dashscope.console.aliyun.com/apiKey" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">阿里云百炼</a>
                                         </p>
                                     </div>
                                     <div>
                                         <label className="block text-xs font-medium text-slate-500 mb-1">Base URL</label>
                                         <select 
                                             className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600 outline-none focus:ring-1 focus:ring-purple-200"
                                             value={aiConfig.qwenBaseUrl || ''}
                                             onChange={e => setAiConfig({...aiConfig, qwenBaseUrl: e.target.value})}
                                         >
                                             <option value="https://coding.dashscope.aliyuncs.com/v1">OpenAI 兼容协议 (推荐)</option>
                                             <option value="https://coding.dashscope.aliyuncs.com/apps/anthropic">Anthropic 兼容协议</option>
                                         </select>
                                         <p className="text-xs text-slate-400 mt-1">
                                             选择你的 AI 工具支持的 API 协议
                                         </p>
                                     </div>
                                 </>
                             )}
 
                     
                             {aiConfig.provider === 'openai' && (
                                 <>
                                     <div>
                                         <label className="block text-xs font-medium text-slate-500 mb-1">OpenAI API Key</label>
                                         <input 
                                             type="password" 
                                             className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600 outline-none focus:ring-1 focus:ring-purple-200" 
                                             placeholder="sk-xxxxx"
                                             value={aiConfig.openaiApiKey || ''}
                                             onChange={e => setAiConfig({...aiConfig, openaiApiKey: e.target.value})}
                                         />
                                     </div>
                                     <div>
                                         <label className="block text-xs font-medium text-slate-500 mb-1">Base URL (可选)</label>
                                         <input 
                                             type="text" 
                                             className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600 outline-none focus:ring-1 focus:ring-purple-200" 
                                             placeholder="https://api.openai.com/v1"
                                             value={aiConfig.openaiBaseUrl || ''}
                                             onChange={e => setAiConfig({...aiConfig, openaiBaseUrl: e.target.value})}
                                         />
                                         <p className="text-xs text-slate-400 mt-1">
                                             留空使用默认OpenAI，或填写兼容API地址
                                         </p>
                                     </div>
                                 </>
                             )}
                     
                             {aiConfig.provider !== 'none' && (
                                 <div className="flex items-center justify-between pt-2">
                                     <label className="flex items-center gap-2 cursor-pointer">
                                         <input 
                                             type="checkbox" 
                                             checked={aiConfig.enabled}
                                             onChange={e => setAiConfig({...aiConfig, enabled: e.target.checked})}
                                             className="w-4 h-4 text-purple-600 rounded focus:ring-1 focus:ring-purple-200"
                                         />
                                         <span className="text-sm text-slate-700">启用 AI 助手</span>
                                     </label>
                                     <button 
                                         onClick={() => {
                                             console.log('[App] 保存AI配置:', aiConfig);
                                             localStorage.setItem('ai_config', JSON.stringify(aiConfig));
                                             // 验证保存
                                             const saved = localStorage.getItem('ai_config');
                                             console.log('[App] 验证保存成功:', saved === JSON.stringify(aiConfig));
                                             alert('配置已保存！请刷新页面使配置生效。');
                                         }}
                                         className="bg-purple-500 text-white px-4 py-2 rounded text-sm hover:bg-purple-600 font-medium transition-colors"
                                     >
                                         保存 AI 配置
                                     </button>
                                 </div>
                             )}
                         </div>
                     </div>
                     {isCloudConnected && (
                         <div className="p-4 md:p-6 border-b border-slate-200">
                             <div className="flex justify-between items-center mb-4">
                                 <h3 className="font-bold text-slate-700 flex items-center gap-2"><History size={18} /> 云端备份历史</h3>
                                 <div className="flex gap-2">
                                     <button onClick={() => fetchCloudHistory()} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded" title="刷新"><RefreshCw size={14}/></button>
                                     <button onClick={openSnapshotModal} className="text-xs bg-sky-50 text-sky-600 px-3 py-1.5 rounded-lg font-medium hover:bg-sky-100 transition-colors">新建备份</button>
                                 </div>
                             </div>
                             <div className="bg-slate-50 rounded-lg border border-slate-200 max-h-48 overflow-y-auto">
                                 {isLoadingHistory ? (
                                     <div className="p-4 text-center text-slate-400 text-xs">加载中...</div>
                                 ) : cloudHistory.length === 0 ? (
                                     <div className="p-4 text-center text-slate-400 text-xs">暂无云端备份记录</div>
                                 ) : (
                                     <div className="divide-y divide-slate-100">
                                         {cloudHistory.map(backup => (
                                             <div key={backup.id} className="p-3 flex justify-between items-center hover:bg-white transition-colors">
                                                 <div>
                                                     <div className="text-sm font-medium text-slate-700">{backup.note || '无备注'}</div>
                                                     <div className="text-xs text-slate-400 flex items-center gap-1"><FileClock size={10} /> {new Date(backup.created_at).toLocaleString()}</div>
                                                 </div>
                                                 <div className="flex gap-2">
                                                     <button onClick={() => handleRestoreCloudBackup(backup.id)} disabled={restoringId === backup.id} className="text-xs border border-orange-200 bg-white text-orange-600 px-2 py-1 rounded hover:border-orange-300 hover:bg-orange-50 flex items-center gap-1">{restoringId === backup.id ? <Loader2 size={12} className="animate-spin"/> : <RotateCcw size={12}/>} 恢复</button>
                                                     <button onClick={() => handleDownloadCloudBackup(backup.id, backup.note)} disabled={restoringId === backup.id} className="text-xs border border-slate-200 bg-white text-slate-600 px-2 py-1 rounded hover:border-blue-300 hover:text-blue-600 flex items-center gap-1">{restoringId === backup.id ? <Loader2 size={12} className="animate-spin"/> : <Download size={12}/>} 下载</button>
                                                 </div>
                                             </div>
                                         ))}
                                     </div>
                                 )}
                             </div>
                         </div>
                     )}
                     <div className="p-4 md:p-6 bg-slate-50/50"><h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><Database size={18} /> 本地数据管理</h3><div className="space-y-3"><div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg"><div><div className="text-sm font-medium text-slate-700">导出数据备份 (JSON)</div><div className="text-xs text-slate-400">将当前所有数据导出为本地文件</div></div><button onClick={handleExport} className="px-3 py-1.5 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded text-xs font-medium transition-colors">导出</button></div><div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg"><div><div className="text-sm font-medium text-slate-700">导入数据恢复</div><div className="text-xs text-slate-400">从JSON文件恢复数据 (将覆盖当前数据)</div></div><label className="px-3 py-1.5 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded text-xs font-medium transition-colors cursor-pointer">选择文件<input type="file" className="hidden" accept=".json" onChange={handleImport} /></label></div><div className="flex items-center justify-between p-3 bg-rose-50 border border-rose-100 rounded-lg"><div><div className="text-sm font-medium text-rose-700">重置系统</div><div className="text-xs text-rose-400">清除所有本地数据并恢复默认演示数据</div></div><button onClick={handleResetData} className="px-3 py-1.5 text-rose-600 bg-white border border-rose-200 hover:bg-rose-100 rounded text-xs font-medium transition-colors">重置</button></div></div></div>
                 </div>
                 <div className="text-center text-xs text-slate-400"><p>Kingdee Park Management System v4.0</p><p>© 2024 Kingdee. All rights reserved.</p></div>
             </div>
          )}
        </div>
      </main>

      <AssistantPanel isOpen={isAssistantOpen} onClose={() => setAssistantOpen(false)} data={data} />
            <AIAssistantDialog 
              isOpen={isAIDialogOpen} 
              onClose={() => setAIDialogOpen(false)} 
              dashboardData={data}
              aiConfig={aiConfig}
            />
      
      {isTargetModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-sm p-6 animate-in zoom-in-50 duration-200">
                  <h3 className="text-lg font-bold mb-4 text-slate-800">设定 {selectedYear}年度 {targetModalType === 'revenue' ? '营收' : '出租率'}目标</h3>
                  <div className="space-y-4">
                      {targetModalType === 'revenue' ? (
                          <div><label className="block text-sm text-slate-600 mb-1">年度营收目标 (元)</label><input type="number" className="w-full border rounded-lg p-2 text-lg font-semibold" value={targetForm.revenue} onChange={e => setTargetForm({...targetForm, revenue: Number(e.target.value)})} /></div>
                      ) : (
                          <div><label className="block text-sm text-slate-600 mb-1">年度出租率目标 (%)</label><input type="number" className="w-full border rounded-lg p-2 text-lg font-semibold" value={targetForm.occupancy} onChange={e => setTargetForm({...targetForm, occupancy: Number(e.target.value)})} /></div>
                      )}
                      <div className="flex justify-end gap-2 pt-2"><button onClick={() => setIsTargetModalOpen(false)} className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50">取消</button><button onClick={saveTargets} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">保存</button></div>
                  </div>
              </div>
          </div>
      )}

      {isSnapshotModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-sm p-6 animate-in zoom-in-50 duration-200">
                  <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold text-slate-800">保存到云端</h3><button onClick={() => setIsSnapshotModalOpen(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button></div>
                  <div className="space-y-4">
                      <div><label className="block text-sm font-medium text-slate-700 mb-1">操作人员 (必填) <span className="text-red-500">*</span></label><div className="relative"><User size={14} className="absolute left-3 top-3 text-slate-400"/><input type="text" className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-sky-100 outline-none border-slate-200" placeholder="请输入您的姓名" value={operatorName} onChange={e => setOperatorName(e.target.value)}/></div></div>
                      <div><label className="block text-sm font-medium text-slate-700 mb-1">备份备注 (选填)</label><input type="text" className="w-full border rounded-lg p-2 text-sm border-slate-200" placeholder="例如: 10月份月结后备份" value={snapshotNote} onChange={e => setSnapshotNote(e.target.value)}/></div>
                      <div className="bg-sky-50 p-3 rounded-lg text-xs text-sky-700 flex items-start gap-2"><Info size={14} className="mt-0.5 flex-shrink-0" /><p>保存后，系统将生成带时间戳的历史版本，您可以在“系统与备份”中随时查看或恢复。</p></div>
                      <div className="flex justify-end gap-2 pt-2"><button onClick={() => setIsSnapshotModalOpen(false)} className="px-4 py-2 border rounded text-slate-600 hover:bg-slate-50">取消</button><button onClick={confirmCloudSave} disabled={!operatorName.trim()} className="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">{isSyncing ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />} 确认保存</button></div>
                  </div>
              </div>
          </div>
      )}

      {/* Auto Restore Prompt Modal */}
      {showRestorePrompt && latestBackup && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-600"></div>
                  <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 text-blue-600 rounded-full">
                              <CloudUpload size={24} />
                          </div>
                          <div>
                              <h3 className="text-lg font-bold text-slate-800">发现云端备份</h3>
                              <p className="text-xs text-slate-500">检测到可用的云端数据存档</p>
                          </div>
                      </div>
                      <button onClick={() => setShowRestorePrompt(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors">
                          <X size={20} />
                      </button>
                  </div>
                  
                  <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-100">
                      <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">最新备份信息</span>
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Latest</span>
                      </div>
                      <div className="text-sm font-medium text-slate-800 mb-1">{latestBackup.note || '无备注信息'}</div>
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                          <FileClock size={12} />
                          {new Date(latestBackup.created_at).toLocaleString()}
                      </div>
                  </div>

                  <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                      是否立即将此备份恢复到当前系统？<br/>
                      <span className="text-xs text-orange-500">注意：这将覆盖当前本地的所有临时修改。</span>
                  </p>

                  <div className="flex gap-3">
                      <button 
                          onClick={() => setShowRestorePrompt(false)} 
                          className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors text-sm"
                      >
                          暂不恢复
                      </button>
                      <button 
                          onClick={handleConfirmRestoreLatest} 
                          disabled={isSyncing}
                          className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 text-sm flex items-center justify-center gap-2"
                      >
                          {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                          确认同步恢复
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Init Data Modal */}
      {isInitDataModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl p-6 animate-in zoom-in-50 duration-200 flex flex-col max-h-[90vh]">
                  <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
                      <div className="flex items-center gap-4">
                          <h3 className="text-xl font-bold text-slate-800">系统数据初始化录入</h3>
                          <div className="flex bg-slate-100 rounded-lg p-1">
                              <button onClick={() => handleInitYearChange(2023)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${initDataYear === 2023 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>2023年</button>
                              <button onClick={() => handleInitYearChange(2024)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${initDataYear === 2024 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>2024年</button>
                              <button onClick={() => handleInitYearChange(2025)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${initDataYear === 2025 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>2025年</button>
                          </div>
                      </div>
                      <button onClick={() => setIsInitDataModalOpen(false)}><X size={24} className="text-slate-400 hover:text-slate-600"/></button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto">
                      <table className="w-full text-sm text-left">
                          <thead className="bg-slate-50 text-slate-600 font-bold">
                              <tr>
                                  <th className="p-4 border-b border-slate-200 w-20">月份</th>
                                  <th className="p-4 border-b border-slate-200">月度应收 (Target Revenue)</th>
                                  <th className="p-4 border-b border-slate-200">月度实收 (Actual Revenue)</th>
                                  <th className="p-4 border-b border-slate-200">月末出租率 (%)</th>
                                  {initDataYear === 2025 && (
                                      <th className="p-4 border-b border-slate-200 bg-amber-50">累计欠款 (￥)</th>
                                  )}
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {tempInitData.map((row) => (
                                  <tr key={row.month} className="hover:bg-slate-50">
                                      <td className="p-4 font-bold text-slate-700 text-center">{row.month}月</td>
                                      <td className="p-4">
                                          <div className="relative">
                                              <span className="absolute left-3 top-2.5 text-slate-400 text-xs">¥</span>
                                              <input 
                                                  type="number" 
                                                  className="w-full pl-6 pr-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 outline-none font-mono"
                                                  value={row.revenueTarget || ''}
                                                  onChange={(e) => updateTempInitData(row.month, 'revenueTarget', Number(e.target.value))}
                                                  placeholder="0.00"
                                              />
                                          </div>
                                      </td>
                                      <td className="p-4">
                                          <div className="relative">
                                              <span className="absolute left-3 top-2.5 text-slate-400 text-xs">¥</span>
                                              <input 
                                                  type="number" 
                                                  className="w-full pl-6 pr-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 outline-none font-mono"
                                                  value={row.revenueCollected || ''}
                                                  onChange={(e) => updateTempInitData(row.month, 'revenueCollected', Number(e.target.value))}
                                                  placeholder="0.00"
                                              />
                                          </div>
                                      </td>
                                      <td className="p-4">
                                          <div className="relative">
                                              <input 
                                                  type="number" 
                                                  className="w-full pl-3 pr-8 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 outline-none font-mono"
                                                  value={row.occupancyRate || ''}
                                                  onChange={(e) => updateTempInitData(row.month, 'occupancyRate', Number(e.target.value))}
                                                  placeholder="0.0"
                                                  step="0.1"
                                                  max="100"
                                              />
                                              <span className="absolute right-3 top-2.5 text-slate-400 text-xs">%</span>
                                          </div>
                                      </td>
                                      {initDataYear === 2025 && (
                                          <td className="p-4 bg-amber-50/30">
                                              <div className="relative">
                                                  <span className="absolute left-3 top-2.5 text-amber-600 text-xs">￥</span>
                                                  <input 
                                                      type="number" 
                                                      className="w-full pl-6 pr-3 py-2 border-2 border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-200 outline-none font-mono bg-white"
                                                      value={row.accumulatedArrears || ''}
                                                      onChange={(e) => updateTempInitData(row.month, 'accumulatedArrears', Number(e.target.value))}
                                                      placeholder="只塢12月填写"
                                                      disabled={row.month !== 12}
                                                  />
                                                  {row.month === 12 && (
                                                      <div className="text-xs text-amber-600 mt-1">
                                                          2025年及之前累计欠款
                                                      </div>
                                                  )}
                                              </div>
                                          </td>
                                      )}
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
                  
                  <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between items-center">
                      <div className="text-xs text-slate-500 bg-blue-50 px-3 py-2 rounded-lg flex items-center gap-2">
                          <Info size={14} className="text-blue-500"/>
                          说明：录入的数据将 directly cover the corresponding indicators in the dashboard for that year.
                      </div>
                      <div className="flex gap-3">
                          <button onClick={() => setIsInitDataModalOpen(false)} className="px-6 py-2.5 border rounded-lg text-slate-600 hover:bg-slate-50 font-medium">取消</button>
                          <button onClick={saveInitData} className="px-8 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow-md">保存配置</button>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;
