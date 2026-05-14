
import React, { useState, useEffect, useMemo } from 'react';
import { LayoutDashboard, Building2, Users, PieChart, Settings, Bell, Search, Menu, Sparkles, UserCircle, Download, Upload, X, Check, Filter, Save, RotateCcw, Trash2, Calculator, Database, Lightbulb, Cloud, CloudCog, RefreshCw, AlertCircle, ExternalLink, Link, Info, Loader2, CheckCircle2, XCircle, History, FileClock, ChevronRight, ChevronDown, CloudUpload, LogOut, User, Calendar, ChevronLeft, FileInput, Table as TableIcon, FileText, Pencil, UserCog } from 'lucide-react';
import { generateInitialData } from './services/mockData';
import { DashboardData, Building, Tenant, PaymentRecord, UnitStatus, MonthlyTrend, PaymentCycle, RentFreePeriod, BillingDetail, ParkingStatDetail, BudgetAssumption, BudgetAdjustment, BudgetAnalysisData, CloudConfig, AIConfig, CloudBackupMetadata, BudgetScenario, MonthlyInitData, ContractStatus, DepositStatus, InvoiceRecord, AuthUser, ParkInfo, UserRole } from './types';
import { StatsCards } from './components/StatsCards';
import { RecentActivityTable, AnnualMetricComparisonTable, AnnualComparisonData } from './components/Tables';
import { BillingTable } from './components/BillingTable';
import { AssistantPanel } from './components/AssistantPanel';
import { AIAssistantDialog } from './components/AIAssistantDialog';
import { BuildingManager } from './components/BuildingManager';
import { ContractManager } from './components/ContractManager';
import { FinanceManager } from './components/FinanceManager';
import { BudgetManager } from './components/BudgetManager';
import { TenantBudgetNameLinkTool } from './components/TenantMergeTool';
import { TenantInsights } from './components/TenantInsights';
import { DashboardAlerts } from './components/DashboardAlerts';
import { ConflictDialog } from './components/ConflictDialog';
import {
    checkConnection,
    getCloudHistory,
    fetchCloudBackup,
    initCloud,
    SaveToCloudResult,
    scheduleUpsertIntegrationFullSnapshot,
    saveIncrementalToCloud,
    bumpCloudSaveVersion,
    forceOverwriteCloudRecord,
    loginCloudUser,
    logoutCloudUser,
    getCurrentCloudUser,
    fetchAuthorizedParks,
    fetchManagedCloudUsers,
    createManagedCloudUser,
    updateManagedCloudUserEnabled,
    updateManagedCloudUser,
    deleteManagedCloudUser,
    deleteCloudSignupRequest,
    fetchPublicCloudParks,
    submitCloudSignupRequest,
    fetchCloudSignupRequests,
    approveCloudSignupRequest,
    fetchCloudKpiSnapshot,
    upsertCloudKpiSnapshot,
} from './services/cloudService';
import type { KpiSnapshotSummary, RecordMeta, IncrementalConflict } from './services/cloudService';
import type { ManagedUserAccount } from './services/cloudService';
import type { SignupRequestRecord } from './services/cloudService';
import { buildIntegrationFullSnapshotV1 } from './services/integrationSnapshot';
import { FAR_FUTURE_DATE, generateBudgetedBills, getVirtualTenants } from './services/billingService';
import {
    DEFER_BILLING_NOTE_PREFIX,
    removeDeferBillingNoteByKey,
    applyBillingPeriodDeferNotes,
    partitionPaymentsRemovingAutoReceivableWriteOffs,
    parseSpecialBusinessReceivablesFromNotes,
    removeDeferBillingNotesFromNotes,
    rentCollectionRemarkKey,
    specialBusinessArDisplayTenantId,
} from './services/receivableListHelpers';
import type { DeferBillingNote } from './services/receivableListHelpers';
import {
    buildBillingDetailsForPeriod as buildBillingDetailsForPeriodService,
    calculateDashboardMetrics as calculateDashboardMetricsService,
    normalizeScenarioForReceivable as normalizeScenarioForReceivableService,
    buildKpiSummaryFromProcessedData,
    normalizeKpiSummaryWithMonthlyTrends,
    type DashboardQuarter,
} from './services/dashboardMetrics';
import { formatArea, formatCurrency, formatPercent, formatWan } from './services/numberFormat';
import { DEFAULT_CLOUD_CONFIG, mergeStoredCloudConfig } from './config/deploymentDefaults';
import { DirtyTrackerProvider } from './services/dirtyTrackerContext';
import { DirtyTracker } from './services/dirtyTracker';
import {
    dashboardDataToPbRecords,
    diffPbRecords,
    payloadCount,
    type PbRecordMap,
} from './services/dataDiff';
import {
    createDashboardBackupEnvelope,
    formatBackupSummary,
    parseDashboardBackup,
    sanitizeImportedDashboardData,
    validateBackupTarget,
} from './services/backupArchive';
import {
    mergeBudgetTotalsIntoInitData,
    normalizeEffectiveBudgetTableFromBackup,
    readImportedBudgetTable,
    writeImportedBudgetTable,
} from './services/budgetTableImport';

const STORAGE_KEY = 'kingdee_park_data_v1';
// 标准化交付：升级存储 key，避免历史环境把旧的内网 URL 自动带入新部署
const CLOUD_CONFIG_KEY = 'kingdee_park_cloud_config_v2';
const getParkStorageKey = (projectId: string) => `${STORAGE_KEY}:${projectId || 'unknown'}`;
const hasMeaningfulDashboardPayload = (d: DashboardData): boolean =>
    (d.buildings?.length ?? 0) > 0 ||
    (d.tenants?.length ?? 0) > 0 ||
    (d.payments?.length ?? 0) > 0 ||
    (d.budgetScenarios?.length ?? 0) > 0 ||
    (d.invoices?.length ?? 0) > 0 ||
    (d.initializationData?.length ?? 0) > 0 ||
    (d.budgetAssumptions?.length ?? 0) > 0;

type AdminParkMetric = {
    projectId: string;
    name: string;
    annualInitialBudget: number;         // 年初预算（Excel导入月度汇总）
    annualContractReceivable: number;    // 实际合同应收（纯合同滚动，与预算表「全年合同应收」同口径）
    annualRevenueTarget: number;         // 预算目标（导入Excel或含空置滚动）
    annualRevenueCollected: number;
    annualGoalCompletion: number;        // 完成率 = 实收 / 实际合同应收
    annualBudgetTarget: number;          // 预算收款
    annualBudgetCompletion: number;      // 预算执行率 = 实收 / 预算收款
    budgetDeviation: number;             // 预算偏差 = (合同应收 - 年初预算) / 年初预算
    occupancyRate: number;
    annualOccupancyTarget: number;
    tenantCount: number;
    totalArea: number;
};

type NewManagedUserForm = {
    email: string;
    name: string;
    password: string;
    projectId: string;
    role: 'park_user' | 'park_admin' | 'group_admin';
    enabled: boolean;
};

type SignupForm = {
    applicantName: string;
    email: string;
    password: string;
    requestedProjectIds: string[];
};

// 核心计算逻辑：确保这里使用的逻辑与预算表(BudgetManager)完全一致

/**
 * 把「特殊业态收入录入」的月度金额注入应收明细（与 services/dashboardMetrics.ts 中口径保持一致）。
 * - 显示行使用 `sbiz_ar_${tenantId}__${period}` 作为 tenantId，防止与系统账单/手工应收冲突；
 * - amountPaid 同时识别真实 tenantId 与 sbiz 显示 tenantId 的关联收款。
 */









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
        ? 'bg-sky-50 text-sky-700 font-medium border-r-4 border-sky-600'
        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all duration-200'
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

/** 与侧栏 `lg:` 断点一致：窄屏仅保留工作台 / 合同录入 / 收款核销 */
function useMobileNavLayout(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return narrow;
}

const App: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [cloudConfig, setCloudConfig] = useState<CloudConfig>(() => ({
      ...DEFAULT_CLOUD_CONFIG,
  }));
  
  const [aiConfig, setAiConfig] = useState<AIConfig>({
      provider: 'none',
      enabled: false,
      qwenApiKey: '',
      qwenBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
      openaiApiKey: '',
      openaiBaseUrl: ''
  });
  
  const [isCloudConnected, setIsCloudConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTestingCloud, setIsTestingCloud] = useState(false);
  const [cloudConnectionMsg, setCloudConnectionMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authorizedParks, setAuthorizedParks] = useState<ParkInfo[]>([]);
  const [loginForm, setLoginForm] = useState({
      email: '',
      password: '',
  });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [publicParks, setPublicParks] = useState<ParkInfo[]>([]);
  const [isLoadingPublicParks, setIsLoadingPublicParks] = useState(false);
  const [signupForm, setSignupForm] = useState<SignupForm>({
      applicantName: '',
      email: '',
      password: '',
      requestedProjectIds: [],
  });
  const [isSubmittingSignup, setIsSubmittingSignup] = useState(false);
  const [signupMsg, setSignupMsg] = useState<string | null>(null);
  const [adminParkMetrics, setAdminParkMetrics] = useState<AdminParkMetric[]>([]);
  const [isLoadingAdminSummary, setIsLoadingAdminSummary] = useState(false);
  
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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'buildings' | 'contracts' | 'finance' | 'budget' | 'initData' | 'settings'>('dashboard');
  const mobileNavLayout = useMobileNavLayout();
  const [lastSaved, setLastSaved] = useState<string>('');
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedQuarter, setSelectedQuarter] = useState<'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4'>('All');
  const [billingSelectedMonth, setBillingSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [targetForm, setTargetForm] = useState({ revenue: 0, occupancy: 0, initialBudget: 0 });

  const [isInitDataModalOpen, setIsInitDataModalOpen] = useState(false);
  const [initDataYear, setInitDataYear] = useState<number>(2024);
  const [tempInitData, setTempInitData] = useState<MonthlyInitData[]>([]);
  const [managedUsers, setManagedUsers] = useState<ManagedUserAccount[]>([]);
  const [isLoadingManagedUsers, setIsLoadingManagedUsers] = useState(false);
  const [managedUsersError, setManagedUsersError] = useState<string | null>(null);
  const [userManageTarget, setUserManageTarget] = useState<ManagedUserAccount | null>(null);
  const [userManageSaving, setUserManageSaving] = useState(false);
  const [userManageForm, setUserManageForm] = useState<{
      name: string;
      role: UserRole;
      projectId: string;
      allowedParkIds: string[];
      password: string;
      enabled: boolean;
  }>({
      name: '',
      role: 'park_user',
      projectId: '',
      allowedParkIds: [],
      password: '',
      enabled: true,
  });
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [signupRequests, setSignupRequests] = useState<SignupRequestRecord[]>([]);
  const [isLoadingSignupRequests, setIsLoadingSignupRequests] = useState(false);
  const [signupRequestsError, setSignupRequestsError] = useState<string | null>(null);
  const [newUserForm, setNewUserForm] = useState<NewManagedUserForm>({
      email: '',
      name: '',
      password: '',
      projectId: '',
      role: 'park_user',
      enabled: false,
  });

  // New state for auto-restore prompt
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [latestBackup, setLatestBackup] = useState<CloudBackupMetadata | null>(null);

  // ---- 增量保存相关 state ----
  // recordMeta：行级乐观锁基准，由 fetchCloudBackup 返回。每次保存成功后需重新拉取刷新。
  const [recordMeta, setRecordMeta] = useState<RecordMeta>({});
  // 单例 DirtyTracker：业务组件可以通过 Context 拿到它登记 create/update/delete
  // （目前业务组件还没主动登记；保存时通过 baselineSnapshotRef 自动 diff 兜底）
  const dirtyTrackerRef = React.useRef<DirtyTracker>(new DirtyTracker());
  /**
   * 保存基线快照：上次「从云端加载」时的 PocketBase 行级 record map。
   * 保存时与当前 data 做 diff，自动产生 creates/updates/deletes 的 DirtyPayload，
   * 实现「不需要业务组件主动登记 dirty」就能聚合增量保存。
   */
  const baselineSnapshotRef = React.useRef<PbRecordMap | null>(null);
  const isKpiPreviewRef = React.useRef(false);
  // 保存时收到的冲突清单；交给 ConflictDialog 处理
  const [pendingConflicts, setPendingConflicts] = useState<IncrementalConflict[]>([]);

  useEffect(() => {
    if (window.innerWidth >= 1024) {
        setSidebarOpen(true);
    }
  }, []);

  useEffect(() => {
    const bootstrapYear = new Date().getFullYear();
    const loadData = async () => {
      try {
        let configToUse = mergeStoredCloudConfig(localStorage.getItem(CLOUD_CONFIG_KEY));
        
        const savedAIConfig = sessionStorage.getItem('ai_config');
        if (savedAIConfig) {
            try {
                const parsedAI = JSON.parse(savedAIConfig);
                setAiConfig(parsedAI);
            } catch (e) {
                console.error('[App] AI配置加载失败:', e);
            }
        }
        // 启动时自动连接后端；连通时始终从 PocketBase 拉取一次结构化数据（后端优先），保证局域网各端一致
        await initCloud(configToUse);
        const currentUser = getCurrentCloudUser();
        if (currentUser?.enabled && currentUser.projectId) {
            setAuthUser(currentUser);
            let parks: ParkInfo[] = [];
            try {
                const parksRes = await fetchAuthorizedParks();
                if (parksRes.success) {
                    parks = parksRes.parks;
                    setAuthorizedParks(parksRes.parks);
                }
            } catch (e) {
                console.error('[App] 加载园区列表失败:', e);
            }
            const selectedProjectId = resolveInitialProjectId(currentUser, parks, configToUse.projectId);
            configToUse = { ...configToUse, projectId: selectedProjectId };
        }
        setCloudConfig(configToUse);

        const connected = await checkConnection(configToUse);
        setIsCloudConnected(connected);

        const savedData = localStorage.getItem(getParkStorageKey(configToUse.projectId));
        let parsedData: DashboardData | null = null;
        if (savedData) parsedData = JSON.parse(savedData);

        let cloudBaselineData: DashboardData | null = null;
        let cloudBaselineMeta: RecordMeta | undefined;
        let hasKpiPreview = false;

        if (connected) {
          try {
            const snapshotRes = await fetchCloudKpiSnapshot(configToUse, bootstrapYear);
            if (snapshotRes.success && snapshotRes.snapshot && !parsedData) {
              isKpiPreviewRef.current = true;
              hasKpiPreview = true;
              setData(buildDashboardDataFromKpiSnapshot(snapshotRes.snapshot));
            }
            const latestRes = await fetchCloudBackup(configToUse, configToUse.projectId || '');
            if (latestRes.success && latestRes.data) {
              const safeCloudData = { ...generateInitialData(), ...latestRes.data };
              cloudBaselineData = safeCloudData;
              cloudBaselineMeta = latestRes.recordMeta;
              if (hasMeaningfulDashboardPayload(safeCloudData)) {
                recalculateMetrics(safeCloudData, bootstrapYear, 'All');
                captureBaselineFromCloud(safeCloudData, latestRes.recordMeta, configToUse.projectId);
                localStorage.setItem(getParkStorageKey(configToUse.projectId), JSON.stringify(safeCloudData));
                setLastSaved(new Date().toLocaleTimeString());
                try {
                  const historyRes = await getCloudHistory(configToUse);
                  if (historyRes.success && historyRes.data && historyRes.data.length > 0) {
                    setCloudHistory(historyRes.data);
                    setLatestBackup(historyRes.data[0]);
                  }
                } catch (e) {
                  console.error('[App] 加载备份历史失败:', e);
                }
                return;
              }
            }
          } catch (cloudLoadError) {
            console.error('[App] 启动时拉取云端最新数据失败:', cloudLoadError);
          }
        }

        if (parsedData) {
          const safeData = { ...generateInitialData(), ...parsedData };
          if (cloudBaselineData) captureBaselineFromCloud(cloudBaselineData, cloudBaselineMeta, configToUse.projectId);
          recalculateMetrics(safeData, bootstrapYear, 'All');
          setLastSaved(new Date().toLocaleTimeString());
        } else if (!hasKpiPreview) {
          const initialData = generateInitialData();
          recalculateMetrics(initialData, bootstrapYear, 'All');
        }
      } catch (e) {
        console.error("Failed to load data", e);
        const initialData = generateInitialData();
        recalculateMetrics(initialData, bootstrapYear, 'All');
      }
    };
    loadData();
  }, []);

  // 防抖写入本地缓存 + 自动同步到 PocketBase
  // ⚠️ 跨园区竞态防护（曾经导致北京 pb_tenants 被深圳数据整批覆盖）：
  //   1. switchProject 是 async — setCloudConfig 后 await fetchCloudBackup 期间 React 会渲染一次，
  //      此时 cloudConfig.projectId = 新园区，但 data 还是旧园区。本 effect 会用旧 data + 新 projectId
  //      起一个 2 秒定时器；若 fetchCloudBackup > 2s，定时器先到，旧数据会被以 "新 projectId" 跨园区写入。
  //   2. 用 currentProjectIdRef 在定时器内做"projectId 仍然是 effect 启动时那个"的快速校验；
  //      不一致就放弃本次写入（switchProject 会触发下一轮带正确 data 的 effect）。
  //   3. baselineSnapshotRef.current = null 表示 switchProject 正在拉数据（baseline 尚未捕获），
  //      此时既不写 localStorage 也不写云端，避免污染目标园区本地缓存。
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentProjectIdRef = React.useRef<string>(cloudConfig.projectId || '');
  React.useEffect(() => {
    currentProjectIdRef.current = cloudConfig.projectId || '';
  }, [cloudConfig.projectId]);
  useEffect(() => {
    if (!data) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const projectIdAtEffectStart = cloudConfig.projectId;
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
          if (isKpiPreviewRef.current) return;
          // 园区切换中（baseline 还没拉回来）— 这一刻 data 一定是上一园区的，绝不能写本园区。
          if (!baselineSnapshotRef.current) return;
          // 园区在 2 秒间被切走了（setCloudConfig 触发 effect 但 data 还没刷到目标园区）。
          if (currentProjectIdRef.current !== projectIdAtEffectStart) return;
          localStorage.setItem(getParkStorageKey(projectIdAtEffectStart), JSON.stringify(data));
          setLastSaved(new Date().toLocaleTimeString());
          if (isCloudConnected) {
              const nextSnapshot = dashboardDataToPbRecords(data, projectIdAtEffectStart || '');
              const payload = diffPbRecords(baselineSnapshotRef.current, nextSnapshot, recordMeta);
              const summary = payloadCount(payload);
              if (summary.total > 0) {
                  // 二次防御：写云之前再核对一次 projectId，避开 await 期间被切走的极端情况。
                  if (currentProjectIdRef.current !== projectIdAtEffectStart) return;
                  const res = await saveIncrementalToCloud(payload, cloudConfig, recordMeta);
                  if (res.errors.length > 0) console.warn('[auto-save] 部分失败:', res.errors);
                  if (res.conflicts.length > 0) console.warn('[auto-save] 冲突，将在下次手动保存时处理:', res.conflicts.length);
                  if (res.errors.length === 0 && res.conflicts.length === 0) {
                      // 三次防御：刷新基线之前再确认 projectId 没变，防止把当前园区基线刷成上一园区。
                      if (currentProjectIdRef.current === projectIdAtEffectStart) {
                          await refreshAfterSave(data);
                      }
                  }
              }
          }
      } catch (e) {
          console.error("Auto-save failed", e);
      }
    }, 2000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [data, cloudConfig.projectId]);

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

  const loadAuthorizedParks = async () => {
      const parksRes = await fetchAuthorizedParks();
      if (parksRes.success) setAuthorizedParks(parksRes.parks);
      return parksRes;
  };

  const isGlobalAdmin = (user: AuthUser | null = authUser) =>
      user?.role === 'platform_admin' || user?.role === 'group_admin';
  const isPlatformAdmin = (user: AuthUser | null = authUser) =>
      user?.role === 'platform_admin';
  const canAccessSystemSettings = isGlobalAdmin();

  const resolveInitialProjectId = (user: AuthUser, parks: ParkInfo[], storedProjectId?: string) => {
      const activeParkIds = parks.filter(park => park.enabled).map(park => park.projectId);
      const allowed = user.role === 'platform_admin'
          ? activeParkIds
          : user.allowedProjectIds.length
            ? user.allowedProjectIds
            : [user.projectId];
      if (storedProjectId && allowed.includes(storedProjectId)) return storedProjectId;
      return user.projectId || allowed[0] || storedProjectId || DEFAULT_CLOUD_CONFIG.projectId;
  };

  const switchProject = async (projectId: string) => {
      const targetProjectId = projectId.trim();
      if (!targetProjectId || targetProjectId === cloudConfig.projectId) return;
      if (authUser && !isGlobalAdmin(authUser) && !authUser.allowedProjectIds.includes(targetProjectId)) {
          alert('当前账号未被授权访问该园区。');
          return;
      }

      const nextConfig = { ...cloudConfig, projectId: targetProjectId };
      setIsSyncing(true);
      setCloudConfig(nextConfig);
      localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(nextConfig));
      setRecordMeta({});
      baselineSnapshotRef.current = null;
      dirtyTrackerRef.current.reset();
      setPendingConflicts([]);
      try {
          const cached = localStorage.getItem(getParkStorageKey(targetProjectId));
          const res = await fetchCloudBackup(nextConfig, targetProjectId);
          if (res.success && res.data) {
              const safeData = { ...generateInitialData(), ...res.data };
              captureBaselineFromCloud(safeData, res.recordMeta, targetProjectId);
              if (hasMeaningfulDashboardPayload(safeData)) {
                  recalculateMetrics(safeData, selectedYear, selectedQuarter);
                  localStorage.setItem(getParkStorageKey(targetProjectId), JSON.stringify(safeData));
              } else if (cached) {
                  recalculateMetrics({ ...generateInitialData(), ...JSON.parse(cached) }, selectedYear, selectedQuarter);
              } else {
                  recalculateMetrics(safeData, selectedYear, selectedQuarter);
              }
          } else if (cached) {
              const safeData = { ...generateInitialData(), ...JSON.parse(cached) };
              recalculateMetrics(safeData, selectedYear, selectedQuarter);
          } else {
              recalculateMetrics(generateInitialData(), selectedYear, selectedQuarter);
          }
          await fetchCloudHistory(nextConfig);
      } catch (e) {
          console.error('[App] 切换园区失败:', e);
          alert('切换园区失败，请检查网络或权限。');
      } finally {
          setIsSyncing(false);
      }
  };

  const loadManagedUsers = async () => {
      if (!isPlatformAdmin()) return;
      setIsLoadingManagedUsers(true);
      setManagedUsersError(null);
      const res = await fetchManagedCloudUsers();
      if (res.success) {
          setManagedUsers(res.users);
          if (!newUserForm.projectId) {
              setNewUserForm(prev => ({ ...prev, projectId: cloudConfig.projectId || authUser?.projectId || '' }));
          }
      } else {
          setManagedUsersError(res.message || '登录人员列表加载失败');
      }
      setIsLoadingManagedUsers(false);
  };

  const loadSignupRequests = async () => {
      if (!isPlatformAdmin()) return;
      setIsLoadingSignupRequests(true);
      setSignupRequestsError(null);
      const res = await fetchCloudSignupRequests();
      if (res.success) {
          setSignupRequests(res.requests);
      } else {
          setSignupRequestsError(res.message || '注册申请加载失败');
      }
      setIsLoadingSignupRequests(false);
  };

  const loadPublicParkOptions = async () => {
      setIsLoadingPublicParks(true);
      const res = await fetchPublicCloudParks();
      if (res.success) {
          setPublicParks(res.parks);
      } else {
          setPublicParks([]);
      }
      setIsLoadingPublicParks(false);
  };

  const handleLogin = async (event?: React.FormEvent) => {
      event?.preventDefault();
      setIsLoggingIn(true);
      setLoginError(null);
      const nextConfig = {
          ...cloudConfig,
          pocketbaseUrl: cloudConfig.pocketbaseUrl || DEFAULT_CLOUD_CONFIG.pocketbaseUrl || '/api/pb',
          pocketbaseEmail: '',
          pocketbasePassword: '',
      };
      const res = await loginCloudUser(nextConfig, loginForm.email, loginForm.password);
      if (!res.success || !res.user) {
          setLoginError(res.message);
          setIsLoggingIn(false);
          return;
      }
      const parksRes = await fetchAuthorizedParks();
      if (parksRes.success) setAuthorizedParks(parksRes.parks);
      const projectId = resolveInitialProjectId(res.user, parksRes.success ? parksRes.parks : [], cloudConfig.projectId);
      const authedConfig = { ...nextConfig, projectId };
      setAuthUser(res.user);
      setCloudConfig(authedConfig);
      localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(authedConfig));
      const connected = await checkConnection(authedConfig);
      setIsCloudConnected(connected);
      setIsLoggingIn(false);
      setIsSyncing(true);
      try {
          const res = await fetchCloudBackup(authedConfig, projectId);
          if (res.success && res.data) {
              const safeData = { ...generateInitialData(), ...res.data };
              captureBaselineFromCloud(safeData, res.recordMeta, projectId);
              if (hasMeaningfulDashboardPayload(safeData)) {
                  recalculateMetrics(safeData, selectedYear, selectedQuarter);
                  localStorage.setItem(getParkStorageKey(projectId), JSON.stringify(safeData));
              } else {
                  const cached = localStorage.getItem(getParkStorageKey(projectId));
                  if (cached) {
                      recalculateMetrics({ ...generateInitialData(), ...JSON.parse(cached) }, selectedYear, selectedQuarter);
                  } else {
                      recalculateMetrics(safeData, selectedYear, selectedQuarter);
                  }
              }
              await fetchCloudHistory(authedConfig);
          } else {
              const cached = localStorage.getItem(getParkStorageKey(projectId));
              if (cached) {
                  recalculateMetrics({ ...generateInitialData(), ...JSON.parse(cached) }, selectedYear, selectedQuarter);
              } else {
                  recalculateMetrics(generateInitialData(), selectedYear, selectedQuarter);
              }
          }
      } finally {
          setIsSyncing(false);
      }
  };

  const handleSignupSubmit = async (event?: React.FormEvent) => {
      event?.preventDefault();
      setSignupMsg(null);
      const applicantName = signupForm.applicantName.trim();
      const email = signupForm.email.trim();
      const password = signupForm.password.trim();
      if (!applicantName || !email || !password || signupForm.requestedProjectIds.length === 0) {
          setSignupMsg('请填写姓名、账号、密码并至少选择一个园区。');
          return;
      }
      setIsSubmittingSignup(true);
      const res = await submitCloudSignupRequest(email, password, signupForm.requestedProjectIds, applicantName);
      setIsSubmittingSignup(false);
      setSignupMsg(res.message);
      if (res.success) {
          setSignupForm({ applicantName: '', email: '', password: '', requestedProjectIds: [] });
          setAuthMode('login');
      }
  };

  /** 已通过注册审批的申请，按申请园区归类（一人多园区则在多个园区下各显示一条） */
  const approvedSignupByPark = useMemo(() => {
      const approved = signupRequests.filter((r) => r.status === 'approved');
      const byPark = new Map<string, SignupRequestRecord[]>();
      for (const req of approved) {
          for (const pid of req.requestedProjectIds) {
              if (!byPark.has(pid)) byPark.set(pid, []);
              byPark.get(pid)!.push(req);
          }
      }
      for (const list of byPark.values()) {
          list.sort((a, b) => String(b.approvedAt || '').localeCompare(String(a.approvedAt || '')));
      }
      const parkOrder: string[] = [];
      for (const p of authorizedParks) {
          if (byPark.has(p.projectId)) parkOrder.push(p.projectId);
      }
      for (const pid of Array.from(byPark.keys()).sort()) {
          if (!parkOrder.includes(pid)) parkOrder.push(pid);
      }
      return { byPark, parkOrder };
  }, [signupRequests, authorizedParks]);

  const handleLogout = () => {
      logoutCloudUser();
      setAuthUser(null);
      setAuthorizedParks([]);
      setRecordMeta({});
      baselineSnapshotRef.current = null;
      dirtyTrackerRef.current.reset();
      setPendingConflicts([]);
  };

  const fetchCloudHistory = async (config = cloudConfig) => {
      setIsLoadingHistory(true);
      const res = await getCloudHistory(config);
      setIsLoadingHistory(false);
      if (res.success && res.data) setCloudHistory(res.data);
      return res;
  };

  /** 保存成功后把本地记录的云端版本号与服务器对齐 */
  const applyCloudSaveSuccess = (current: DashboardData, res: SaveToCloudResult) => {
      if (typeof res.newVersion === 'number' && Number.isFinite(res.newVersion)) {
          recalculateMetrics({ ...current, cloudSaveVersion: res.newVersion });
      } else {
          recalculateMetrics(current);
      }
  };

  /** 版本冲突：提示用户并可选从 PocketBase 重新拉取 */
  const handleCloudSaveConflict = async (): Promise<boolean> => {
      if (
          !window.confirm(
              '云端数据已被他人更新（或您在其他窗口已保存过）。\n\n若继续保留当前界面上的编辑，请先不要保存；建议点击「确定」放弃当前未同步的修改，并从服务器加载最新数据。\n\n确定要加载最新数据吗？'
          )
      ) {
          return false;
      }
      const res = await fetchCloudBackup(cloudConfig, cloudConfig.projectId || '');
      if (res.success && res.data) {
          const safeData = { ...generateInitialData(), ...res.data };
          recalculateMetrics(safeData, selectedYear, selectedQuarter);
          captureBaselineFromCloud(safeData, res.recordMeta);
          alert('已加载服务器上的最新数据，版本号已更新。您可在此基础上继续编辑。');
          return true;
      }
      alert('加载最新数据失败：' + (res.message || '未知错误'));
      return false;
  };

  const openSnapshotModal = () => {
      setSnapshotNote('');
      setIsSnapshotModalOpen(true);
  };

  /**
   * 「云端加载完成」后的统一收尾：
   *   - 更新 recordMeta（行级乐观锁基准）
   *   - 用刚加载的 data 生成 baseline 快照（用于下次保存的自动 diff）
   *   - 清空 dirtyTracker（避免上一轮残留登记）
   *
   * 调用方：fetchCloudBackup 成功后；以及保存成功后再次 fetch 后。
   */
  const captureBaselineFromCloud = (cloudData: DashboardData, meta?: RecordMeta, projectId = cloudConfig.projectId) => {
      if (meta) setRecordMeta(meta);
      try {
          baselineSnapshotRef.current = dashboardDataToPbRecords(
              cloudData,
              projectId || ''
          );
      } catch (e) {
          console.warn('[captureBaselineFromCloud] 生成 baseline 失败，后续保存将要求先刷新云端数据', e);
          baselineSnapshotRef.current = null;
      }
      dirtyTrackerRef.current.reset();
  };

  /**
   * 保存成功后：拉取最新云端数据 → 刷新 baseline 快照 + recordMeta；触发集成快照同步。
   * 重新拉取的目的是拿到「服务端权威」的最新值（包括他人在我们保存期间又写入的字段），
   * 这样下一次 diff 不会把别人的改动当成我们的 dirty。
   */
  const refreshAfterSave = async (currentData: DashboardData | null) => {
      // 保存后重新计算完整指标（确保 quickMode 场景下快照数据完整）
      const snapshotProjectId = (cloudConfig.projectId || '').trim();
      if (snapshotProjectId && currentData) {
          try {
              // 始终用完整模式重算，避免 quickMode 导致 monthlyTrends 为空
              const { processedData: fullMetrics, fullYearMonthlyTrends: fullTrends } =
                  calculateDashboardMetricsService(currentData, {
                      year: selectedYear,
                      quarter: 'All',
                      billingSelectedMonth,
                      quickMode: false,
                  });
              const monthlyTrends = fullMetrics.monthlyTrends || [];
              const fullSnapshot = buildIntegrationFullSnapshotV1(fullMetrics, fullTrends, {
                  statsYear: selectedYear,
                  projectId: snapshotProjectId,
              });
              scheduleUpsertIntegrationFullSnapshot(snapshotProjectId, fullSnapshot);
              await upsertCloudKpiSnapshot(cloudConfig, {
                  year: selectedYear,
                  summary: buildKpiSummaryFromProcessedData(fullMetrics, selectedYear),
                  monthlyTrends,
                  dataVersion: fullMetrics.cloudSaveVersion || 0,
                  calculatedAt: new Date().toISOString(),
              });
          } catch (e) {
              console.warn('[refreshAfterSave] 快照构建失败（可忽略）', e);
          }
      }

      // 异步拉取服务端最新数据更新 baseline（不阻塞 UI）
      fetchCloudBackup(cloudConfig, cloudConfig.projectId || '').then(res => {
          if (res.success && res.data) {
              const safeData = { ...generateInitialData(), ...res.data };
              captureBaselineFromCloud(safeData, res.recordMeta);
          } else if (res.recordMeta) {
              setRecordMeta(res.recordMeta);
              dirtyTrackerRef.current.reset();
          }
      }).catch(e => {
          console.warn('[refreshAfterSave] 后台拉取最新数据失败（可忽略）', e);
      });

      // 通知服务端重算 KPI 快照（Gateway compute/refresh），使 OpenClaw 等外部系统看到与前端一致的数据
      triggerServerComputeRefresh(cloudConfig, selectedYear);
  };

  /** 通知集成网关重新计算并回写 KPI 快照（fire-and-forget，不阻塞保存流程） */
  const triggerServerComputeRefresh = (config: CloudConfig, year: number) => {
      const baseUrl = config.pocketbaseUrl || '';
      if (!baseUrl) return;
      // 集成网关默认与 PocketBase 同主部署，端口 8787
      const gatewayUrl = baseUrl.replace(/\/api\/pb$/, '').replace(/:\d+/, '') + ':8787';
      const body = JSON.stringify({ project_id: config.projectId, year });
      fetch(`${gatewayUrl}/api/integration/compute/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
      }).then(() => {
          // 成功：静默
      }).catch(() => {
          // 网关不可用时静默失败，不影响前端正常使用
      });
  };

  /**
   * 统一的「保存到云端」入口。
   *
   * 保存策略：
   *   - 正常业务保存只允许自动 diff(baseline, current) 生成 DirtyPayload → 增量保存。
   *   - baseline 缺失时先即时读取当前园区云端快照建立基线；读取失败才拒绝保存。
   *
   * baseline 在每次 fetchCloudBackup / 保存成功后由 captureBaselineFromCloud 刷新。
   *
   * 返回值：
   *   - { ok: true } 表示已成功（或部分成功），调用方可弹出"保存成功"提示
   *   - { ok: false, conflict: true } 表示有冲突等待用户决策；本函数已 setPendingConflicts
   *   - { ok: false, message } 表示彻底失败
   */
  const runCloudSave = async (
      currentData: DashboardData,
      note: string
  ): Promise<{ ok: boolean; conflict?: boolean; conflictCount?: number; message?: string; newVersion?: number }> => {
      let baseline = baselineSnapshotRef.current;
      let baseRecordMeta = recordMeta;

      if (!baseline) {
          try {
              const baselineRes = await fetchCloudBackup(cloudConfig, cloudConfig.projectId || '');
              if (!baselineRes.success || !baselineRes.data) {
                  return {
                      ok: false,
                      message: `当前页面缺少云端基线，且无法读取后端数据，已阻止全量覆盖保存。请确认 PocketBase 连接正常后重试。${baselineRes.message ? `\n\n后端返回：${baselineRes.message}` : ''}`,
                  };
              }
              const cloudBaseline = { ...generateInitialData(), ...baselineRes.data };
              baseline = dashboardDataToPbRecords(cloudBaseline, cloudConfig.projectId || '');
              baseRecordMeta = baselineRes.recordMeta || {};
              baselineSnapshotRef.current = baseline;
              setRecordMeta(baseRecordMeta);
              dirtyTrackerRef.current.reset();
          } catch (baselineError: any) {
              return {
                  ok: false,
                  message: `当前页面缺少云端基线，且读取后端数据失败，已阻止全量覆盖保存。请确认 PocketBase 连接正常后重试。\n\n错误：${baselineError?.message || '未知错误'}`,
              };
          }
      }

      // ---- 增量保存（自动 diff baseline ↔ current）----
      const nextSnapshot = dashboardDataToPbRecords(currentData, cloudConfig.projectId || '');
      // 如果业务组件以后接入了 dirtyTracker，可以把它的 payload 与 diff 结果合并；
      // 当前阶段以 diff 为唯一来源，避免双重登记导致重复请求。
      const payload = diffPbRecords(baseline, nextSnapshot, baseRecordMeta);
      const summary = payloadCount(payload);

      if (summary.total === 0) {
          // 没有任何改动 —— 不打扰服务器，直接成功
          console.log('[runCloudSave] 无改动，跳过保存');
          return { ok: true, message: '无改动，无需保存' };
      }

      console.log(
          `[runCloudSave] 增量保存：creates=${summary.creates} updates=${summary.updates} deletes=${summary.deletes}`,
          payload
      );

      const res = await saveIncrementalToCloud(payload, cloudConfig, baseRecordMeta);
      if (res.errors.length > 0) {
          console.warn('[runCloudSave] 增量保存出现 errors（不阻塞 conflicts 流程）', res.errors);
      }
      if (res.conflicts.length > 0) {
          setPendingConflicts(res.conflicts);
          // 即便有冲突，已成功落库的部分也要把 baseline 刷新
          await refreshAfterSave(currentData);
          return {
              ok: false,
              conflict: true,
              conflictCount: res.conflicts.length,
              message: res.message,
          };
      }
      // 全部成功 —— bump 一下 dashboard_data_version 用于审计
      try {
          const v = await bumpCloudSaveVersion(cloudConfig);
          if (typeof v === 'number') {
              applyCloudSaveSuccess(currentData, { success: true, message: '', newVersion: v });
          }
      } catch (e) {
          console.warn('[App] 版本号递增失败（非关键）:', e);
      }
      await refreshAfterSave(currentData);
      return { ok: res.errors.length === 0, message: res.message };
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
      const res = await runCloudSave(data, finalNote);
      setIsSyncing(false);
      if (res.ok) {
          alert("✅ 云端备份成功！");
          fetchCloudHistory();
      } else if (res.conflict) {
          // 增量保存的冲突已经被 runCloudSave 写入 pendingConflicts；
          // 旧整包覆写的 conflict 仍走原弹窗
          if ((res.conflictCount || 0) === 0) {
              await handleCloudSaveConflict();
          } else {
              alert(`检测到 ${res.conflictCount} 条冲突，请在冲突弹窗中处理。`);
          }
      } else {
          alert("保存失败: " + (res.message || '未知错误'));
      }
  };

  const handleSaveBudgetToCloud = async (scenarioName: string, operator: string) => {
      if (!data) return;
      setIsSyncing(true);
      const timestamp = new Date().toLocaleString();
      const finalNote = `[预算方案] ${operator} ${timestamp} - ${scenarioName}`;
      const res = await runCloudSave(data, finalNote);
      setIsSyncing(false);
      if (res.ok) {
          alert("✅ 预算方案已保存至云端！");
      } else if (res.conflict) {
          if ((res.conflictCount || 0) === 0) {
              await handleCloudSaveConflict();
          } else {
              alert(`检测到 ${res.conflictCount} 条冲突，请在冲突弹窗中处理。`);
          }
      } else {
          alert("保存失败: " + (res.message || '未知错误'));
      }
  };

  const handleQuickCloudSave = async () => {
      if (!isCloudConnected) {
          if (confirm("后端未连接。是否前往系统设置？")) {
              setActiveTab(canAccessSystemSettings ? 'settings' : 'initData');
              handleCloudConfigSave();
          }
          return;
      }
      openSnapshotModal();
  };

  /** 将当前数据写入 PocketBase（无中间云端层） */
  const handleSaveToBackend = async () => {
      if (!data) return;
      if (!isCloudConnected) {
          alert('未连接 PocketBase。请到「系统与备份」填写地址并点击「保存配置」。');
          setActiveTab(canAccessSystemSettings ? 'settings' : 'initData');
          return;
      }
      setIsSyncing(true);
      try {
          const res = await runCloudSave(data, '手动保存');
          if (res.ok) {
              setLastSaved(new Date().toLocaleTimeString());
              await fetchCloudHistory();
          } else if (res.conflict) {
              if ((res.conflictCount || 0) === 0) {
                  await handleCloudSaveConflict();
              }
              // pendingConflicts 已设置时由 ConflictDialog（步骤 4）接管
          } else {
              alert('保存失败：' + (res.message || '未知错误'));
          }
      } finally {
          setIsSyncing(false);
      }
  };

  /**
   * 强制把本地某条记录覆盖到服务端（用户在 ConflictDialog 选择「用我的值」时调用）。
   * 步骤 4 的 ConflictDialog 会调用本回调；这里集中处理重试逻辑。
   */
  const handleResolveConflict = async (
      decisions: Array<{
          conflict: IncrementalConflict;
          action: 'mine' | 'theirs' | 'skip';
      }>
  ): Promise<void> => {
      const overwrites = decisions.filter((d) => d.action === 'mine');
      const acceptServer = decisions.filter((d) => d.action === 'theirs');
      const overwriteFailures: string[] = [];

      // 「用我的值」 → forceOverwrite
      for (const d of overwrites) {
          if (!d.conflict.localChanges) {
              // delete 类型的"用我的值" → 仍然要执行删除（暂未单独实现强制 delete API）
              console.warn('[handleResolveConflict] 强制删除尚未实现，跳过', d.conflict);
              continue;
          }
          const overwriteRes = await forceOverwriteCloudRecord(
              cloudConfig,
              d.conflict.collection,
              d.conflict.originalId,
              d.conflict.localChanges
          );
          if (!overwriteRes.success) {
              const label =
                  d.conflict.collection === 'pb_billing_period_notes'
                      ? '账期备注'
                      : d.conflict.collection;
              overwriteFailures.push(
                  `${label}/${d.conflict.originalId}: ${overwriteRes.message || '未知错误'}`
              );
          }
      }
      // 「用服务端值」 → 不需要写入服务端，但本地需要刷新数据
      void acceptServer;

      if (overwriteFailures.length > 0) {
          alert(
              `以下冲突未能成功覆盖到服务端，本地数据已保留，请稍后重试：\n\n${overwriteFailures.join('\n')}`
          );
          return;
      }

      // 用户处理完所有冲突 → 清空冲突列表 + 重新拉取
      setPendingConflicts([]);
      const res = await fetchCloudBackup(cloudConfig, cloudConfig.projectId || '');
      if (res.success && res.data) {
          const safeData = { ...generateInitialData(), ...res.data };
          recalculateMetrics(safeData, selectedYear, selectedQuarter);
          captureBaselineFromCloud(safeData, res.recordMeta);
      }
  };

  const handleConfirmRestoreLatest = async () => {
      if (!latestBackup) return;
      setIsSyncing(true);
      try {
          const res = await fetchCloudBackup(cloudConfig, latestBackup.id);
          if (res.success && res.data) {
              const safeData = { ...generateInitialData(), ...res.data };
              recalculateMetrics(safeData, selectedYear, selectedQuarter);
              captureBaselineFromCloud(safeData, res.recordMeta);
              localStorage.setItem(getParkStorageKey(cloudConfig.projectId), JSON.stringify(safeData));
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
            const dataStr = JSON.stringify(createDashboardBackupEnvelope(res.data, {
                projectId: cloudConfig.projectId,
                parkName: getCurrentParkName(),
                exportedBy: authUser?.email,
            }), null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `cloud_backup_${cloudConfig.projectId}_${note ? note.replace(/\s+/g, '_') : 'snapshot'}_${new Date().toISOString().split('T')[0]}.json`;
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
              localStorage.setItem(getParkStorageKey(cloudConfig.projectId), JSON.stringify(safeData));
              alert("✅ 恢复成功！系统正在刷新...");
              window.location.reload();
          } else alert("恢复失败: " + res.message);
      } catch (e) {
          alert("恢复过程中发生未知错误");
      } finally {
          setRestoringId(null);
      }
  };


  // Internal helper to avoid closure issues in calculateTrends




  const recalculateMetrics = (currentData: DashboardData, year: number = selectedYear, quarter: DashboardQuarter = selectedQuarter) => {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const isDashboard = activeTab === 'dashboard';
    const { processedData } = calculateDashboardMetricsService(currentData, {
        year,
        quarter,
        billingSelectedMonth,
        quickMode: !isDashboard,
    });
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    if (elapsed > 80) {
        console.info(`[metrics] recalculate ${Math.round(elapsed)}ms`, {
            tenants: currentData.tenants?.length || 0,
            payments: currentData.payments?.length || 0,
            buildings: currentData.buildings?.length || 0,
        });
    }
    isKpiPreviewRef.current = false;
    setData(processedData);
    return processedData;
  };

  const reconcileTenantAreasWithBuildings = (newBuildings: Building[], tenants: Tenant[]): Tenant[] =>
      tenants.map(t => {
          let newTotalArea = 0;
          t.unitIds.forEach(uid => { for (const b of newBuildings) { const unit = b.units.find(u => u.id === uid); if (unit) { newTotalArea += unit.area; break; } } });
          newTotalArea = parseFloat(newTotalArea.toFixed(2));
          if (Math.abs(newTotalArea - t.totalArea) < 0.01) return t;
          let price = t.unitPrice;
          if ((price === undefined || price === 0) && t.totalArea > 0) { price = (t.monthlyRent * 12) / (t.totalArea * 365); }
          price = price || 0;
          const newMonthlyRent = Math.round(price * (365 / 12) * newTotalArea * 100) / 100;
          return { ...t, totalArea: newTotalArea, monthlyRent: newMonthlyRent, unitPrice: price };
      });

  const updateBuildings = (newBuildings: Building[]) => {
      if (!data) return;
      recalculateMetrics({ ...data, buildings: newBuildings, tenants: reconcileTenantAreasWithBuildings(newBuildings, data.tenants) });
  };

  /** 同时提交楼宇与租户（例如单元跨楼迁移后同步 unitIds / buildingId） */
  const commitBuildingsTenants = (newBuildings: Building[], newTenants: Tenant[]) => {
      if (!data) return;
      recalculateMetrics({ ...data, buildings: newBuildings, tenants: reconcileTenantAreasWithBuildings(newBuildings, newTenants) });
  };

  const handleBatchUpdate = (updates: Partial<DashboardData>) => {
      if (!data) return;
      const cleanUpdates: Partial<DashboardData> = {};
      (Object.keys(updates) as Array<keyof DashboardData>).forEach(key => { if (updates[key] !== undefined) { cleanUpdates[key] = updates[key] as any; } });
      const mergedData = { ...data, ...cleanUpdates };
      recalculateMetrics(mergedData);
  };

  /** 租金账期跟进备注（工作台账单明细 + 财务报表应收核销共用） */
  const updateRentCollectionRemark = (tenantId: string, periodYYYYMM: string, text: string) => {
      if (!data) return;
      const key = rentCollectionRemarkKey(tenantId, periodYYYYMM);
      const next = { ...(data.billingPeriodNotes || {}) };
      if (!text.trim()) delete next[key];
      else next[key] = text;
      recalculateMetrics({ ...data, billingPeriodNotes: next });
  };

  const handleDeferPayment = (tenantId: string, fromYear: number, fromMonth: number, toYear: number, toMonth: number) => {
      if (!data) return;
      const tenant = data.tenants.find((t) => t.id === tenantId);
      if (!tenant) return;
      if (fromYear === toYear && fromMonth === toMonth) {
          alert('目标账期不能与原账期相同。');
          return;
      }

      const details = buildBillingDetailsForPeriodService(fromYear, fromMonth, data);
      const row = details.find((d) => d.tenantId === tenantId);
      const amountToDefer = Math.max(0, (row?.amountDue ?? 0) - (row?.amountPaid ?? 0));

      if (amountToDefer <= 0) {
          alert('该月份无可缓缴应收（已结清、已暂缓或待收余额为 0）。');
          return;
      }
      const key = `${DEFER_BILLING_NOTE_PREFIX}${tenantId}_${fromYear}_${fromMonth}_${toYear}_${toMonth}_${Date.now()}`;
      const note: DeferBillingNote = {
          tenantId,
          fromYear,
          fromMonth,
          toYear,
          toMonth,
          amount: amountToDefer,
      };
      const newNotes = { ...(data.billingPeriodNotes || {}), [key]: JSON.stringify(note) };
      recalculateMetrics({ ...data, billingPeriodNotes: newNotes });
      const fromLabel = `${fromYear}-${String(fromMonth + 1).padStart(2, '0')}`;
      const toLabel = `${toYear}-${String(toMonth + 1).padStart(2, '0')}`;
      alert(
          `已申请缓缴（仅影响应收/执行视图，不修改预算表基准）。\n客户: ${tenant.name}\n金额: ${formatCurrency(amountToDefer)}\n原账期: ${fromLabel}\n调整至: ${toLabel}`
      );
  };

  /** 撤销单条缓缴（调入行消失，金额回到原账期应收） */
  const handleRevokeDeferBillingNote = (noteKey: string) => {
      if (!data) return;
      const cur = data.billingPeriodNotes?.[noteKey];
      let summary = '';
      try {
          const j = JSON.parse(cur || '{}') as { tenantId?: string; fromYear?: number; fromMonth?: number; toYear?: number; toMonth?: number; amount?: number };
          if (j?.tenantId != null && Number.isFinite(j.fromYear) && Number.isFinite(j.fromMonth)) {
              const fromL = `${j.fromYear}-${String((j.fromMonth ?? 0) + 1).padStart(2, '0')}`;
              const toL =
                  Number.isFinite(j.toYear) && Number.isFinite(j.toMonth)
                      ? `${j.toYear}-${String((j.toMonth ?? 0) + 1).padStart(2, '0')}`
                      : '';
              summary = `\n原账期: ${fromL}${toL ? `\n调入: ${toL}` : ''}\n金额: ${typeof j.amount === 'number' ? formatCurrency(j.amount) : '—'}`;
          }
      } catch (e) {
          console.warn('[App] 支付转移明细解析失败:', e);
      }
      if (
          !window.confirm(
              `确定撤销该笔缓缴？调入账期行将删除，金额回到原账期（不影响收款明细已有流水；若曾核销本调入行，请核对关联账期）。${summary}`,
          )
      ) {
          return;
      }
      const { next, removed } = removeDeferBillingNoteByKey(data.billingPeriodNotes, noteKey);
      if (!removed) {
          alert('未找到对应的缓缴记录，可能已被撤销或键无效。');
          return;
      }
      recalculateMetrics({ ...data, billingPeriodNotes: next });
  };

  /** 应收核销：一键撤回全部缓缴 + 本界面生成的核销流水（不误删收款明细手工记账） */
  const handleResetReceivableApplications = () => {
      if (!data) return;
      const { next: nextNotes, removed: deferRemoved } = removeDeferBillingNotesFromNotes(data.billingPeriodNotes || {});
      const { kept: nextPayments, removedCount: payRemoved } = partitionPaymentsRemovingAutoReceivableWriteOffs(
          data.payments || [],
      );
      if (deferRemoved === 0 && payRemoved === 0) {
          alert(
              '当前没有可撤回的缓缴记录，也没有通过「应收核销」收款或批量核销生成的租金流水（「收款明细」中的手工记账不受影响）。',
          );
          return;
      }
      if (
          !window.confirm(
              `确定一键撤回以下操作？此操作不可撤销。\n\n` +
                  `· 清除全部缓缴申请：${deferRemoved} 条（所有账期）\n` +
                  `· 删除应收核销自动生成的收款流水：${payRemoved} 笔（单笔收款、批量核销）\n\n` +
                  `不含「收款明细」手工录入的流水；跟进备注、预算与合同数据不会改变。`,
          )
      ) {
          return;
      }
      recalculateMetrics({ ...data, billingPeriodNotes: nextNotes, payments: nextPayments });
  };

  const updateBudgetScenarios = (newScenarios: BudgetScenario[]) => {
      if (!data) return;
      // 必须走重算：应收专用方案、工作台账单、财务报表与本页根级 budgetAssumptions 均依赖 normalize + 生效方案假设
      recalculateMetrics({
          ...data,
          budgetScenarios: newScenarios,
      });
  };

  const handleRenameScenario = (id: string, newName: string) => {
      if (!data || !data.budgetScenarios) return;
      const updated = data.budgetScenarios.map(s => s.id === id ? {...s, name: newName} : s);
      setData({
          ...data,
          budgetScenarios: normalizeScenarioForReceivableService(updated, data.tenants || [], data.buildings || []),
      });
  };

  const handleActivateScenario = (scenario: BudgetScenario) => {
      if (!data) return;
      const scenarioList = data.budgetScenarios || [];
      const updatedScenarios = scenarioList.map(s => ({
          ...s,
          isActive: s.budgetYear === scenario.budgetYear ? s.id === scenario.id : s.isActive
      }));
      recalculateMetrics({
          ...data,
          budgetScenarios: normalizeScenarioForReceivableService(updatedScenarios, data.tenants || [], data.buildings || []),
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
      const existingTarget = (data.yearlyTargets || {})[selectedYear] || { revenue: 0, occupancy: 0, initialBudget: 0 };
      setTargetForm({
          revenue: existingTarget.revenue || data.annualRevenueTarget,
          occupancy: existingTarget.occupancy || data.annualOccupancyTarget,
          initialBudget: existingTarget.initialBudget || 0,
      });
      setIsTargetModalOpen(true);
  };

  const saveTargets = () => {
      if (!data) return;
      const newTargets = { ...data.yearlyTargets };
      newTargets[selectedYear] = { revenue: Number(targetForm.revenue), occupancy: Number(targetForm.occupancy), initialBudget: Number(targetForm.initialBudget) };
      recalculateMetrics({ ...data, yearlyTargets: newTargets }); 
      setIsTargetModalOpen(false); 
  };
  
  const handleResetData = () => { if (window.confirm("危险操作！\n\n确定要清空当前园区的本地缓存并恢复出厂设置吗？所有未保存至后端的本地修改都将丢失。")) { localStorage.removeItem(getParkStorageKey(cloudConfig.projectId)); const initial = generateInitialData(); recalculateMetrics(initial, currentYear, 'All'); alert("当前园区本地缓存已重置。"); } };

  const getCurrentParkName = () => {
      return authorizedParks.find(park => park.projectId === cloudConfig.projectId)?.name || cloudConfig.projectId;
  };

  const handleExport = () => {
      if (!data) return;
      const projectId = (cloudConfig.projectId || '').trim();
      if (!projectId) {
          alert('当前未选择园区，不能导出备份。');
          return;
      }
      const exportData = createDashboardBackupEnvelope(data, {
          projectId,
          parkName: getCurrentParkName(),
          exportedBy: authUser?.email,
      });
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `park_data_${projectId}_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      const targetProjectId = (cloudConfig.projectId || '').trim();
      const allowedProjectIds = authUser?.allowedProjectIds?.length ? authUser.allowedProjectIds : [targetProjectId];
      const reader = new FileReader();
      reader.onload = async (e) => {
          try {
              const raw = JSON.parse(e.target?.result as string);
              const parsed = parseDashboardBackup(raw);
              const validation = validateBackupTarget(parsed, targetProjectId, allowedProjectIds);
              if (!validation.ok) {
                  alert(validation.message);
                  return;
              }

              const warnings = validation.warnings.length ? `\n\n风险提示：\n${validation.warnings.join('\n')}` : '';
              const sourceProject = parsed.projectId || '旧格式未声明';
              const confirmText = [
                  `目标园区：${getCurrentParkName()} (${targetProjectId})`,
                  `文件园区：${sourceProject}`,
                  parsed.exportedAt ? `导出时间：${new Date(parsed.exportedAt).toLocaleString()}` : '',
                  parsed.exportedBy ? `导出人员：${parsed.exportedBy}` : '',
                  '',
                  '数据摘要：',
                  formatBackupSummary(parsed.summary),
                  warnings,
                  '',
                  '确认后仅会恢复到当前园区的本地状态；如需写入后端，请再点击右上角「保存」。',
                  '是否继续？',
              ].filter(Boolean).join('\n');

              if (!window.confirm(confirmText)) return;

              // 预算方案的 baseDataSnapshot 是预算生成时点快照，旧版预算表依赖它复原静态口径。
              const sanitizedData = sanitizeImportedDashboardData(parsed.data || {});
              const rawObj = (raw && typeof raw === 'object') ? (raw as any) : {};
              const rawPayload = rawObj.backup_type === 'park_dashboard_backup' && rawObj.data && typeof rawObj.data === 'object'
                  ? rawObj.data
                  : rawObj;
              const effectiveBudgetTablesRaw = Array.isArray(rawPayload.effectiveBudgetTables)
                  ? rawPayload.effectiveBudgetTables
                  : [];

              let mergedData = { ...generateInitialData(), ...sanitizedData } as DashboardData;
              const restoredBudgetYears: number[] = [];
              if (effectiveBudgetTablesRaw.length > 0) {
                  let nextInitData = mergedData.initializationData || [];
                  let nextNotes = mergedData.billingPeriodNotes || {};
                  for (const table of effectiveBudgetTablesRaw) {
                      const restored = normalizeEffectiveBudgetTableFromBackup(table);
                      if (!restored) continue;
                      nextInitData = mergeBudgetTotalsIntoInitData(nextInitData, restored.year, restored.snapshot.monthlyTotals);
                      nextNotes = writeImportedBudgetTable(nextNotes, restored.year, restored.snapshot);
                      restoredBudgetYears.push(restored.year);
                  }
                  mergedData = {
                      ...mergedData,
                      initializationData: nextInitData,
                      billingPeriodNotes: nextNotes,
                  };
              }
              setSelectedYear(new Date().getFullYear());
              setSelectedQuarter('All');
              setRecordMeta({});
              baselineSnapshotRef.current = null;
              dirtyTrackerRef.current.reset();
              setPendingConflicts([]);
              localStorage.setItem(getParkStorageKey(targetProjectId), JSON.stringify(mergedData));
              let canSaveIncrementally = false;
              try {
                  const baselineRes = await fetchCloudBackup({ ...cloudConfig, projectId: targetProjectId }, targetProjectId);
                  if (baselineRes.success && baselineRes.data) {
                      const cloudBaseline = { ...generateInitialData(), ...baselineRes.data };
                      captureBaselineFromCloud(cloudBaseline, baselineRes.recordMeta, targetProjectId);
                      canSaveIncrementally = true;
                  }
              } catch (baselineError) {
                  console.warn('[handleImport] 导入后读取云端 baseline 失败', baselineError);
              }
              recalculateMetrics(mergedData, new Date().getFullYear(), 'All');
              const budgetRestoreNote = restoredBudgetYears.length > 0
                  ? `\n\n已按备份内 effectiveBudgetTables 回填预算执行目标：${Array.from(new Set(restoredBudgetYears)).sort((a, b) => a - b).join('、')} 年。`
                  : '';
              alert(canSaveIncrementally
                  ? `数据已恢复到当前园区本地状态，并已建立云端增量保存基线。请检查无误后点击右上角「保存」写入后端。${budgetRestoreNote}`
                  : `数据已恢复到当前园区本地状态，但暂未读取到云端保存基线。请先确认后端连接正常，再刷新/重新登录后保存。${budgetRestoreNote}`
              );
          } catch (err: any) {
              alert(`解析或校验备份失败：${err?.message || '未知错误'}`);
          }
      };
      reader.readAsText(file);
  };

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
      const y = new Date().getFullYear();
      const defaultYear = y >= 2023 && y <= 2026 ? y : 2026;
      setInitDataYear(defaultYear);
      loadTempInitData(defaultYear);
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
      // 同步月度年初预算合计到 yearlyTargets（看板「年初预算」列与后端 yearly 行一致）
      const monthInitialTotal = tempInitData.reduce((sum, r) => sum + (r.initialBudget || 0), 0);
      const newTargets = { ...data.yearlyTargets };
      const existing = newTargets[initDataYear] || { revenue: 0, occupancy: 0 };
      newTargets[initDataYear] = { ...existing, initialBudget: monthInitialTotal };
      const updatedData = { ...data, initializationData: newData, yearlyTargets: newTargets };
      setData(updatedData);
      recalculateMetrics(updatedData);
      setIsInitDataModalOpen(false);
  };

  const handleCreateManagedUser = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isPlatformAdmin()) {
          alert('仅平台管理员可新增登录人员。');
          return;
      }
      if (!newUserForm.email.trim() || !newUserForm.password.trim() || !newUserForm.projectId.trim()) {
          alert('请填写邮箱、初始密码和默认园区。');
          return;
      }
      setIsCreatingUser(true);
      const res = await createManagedCloudUser({
          email: newUserForm.email,
          password: newUserForm.password,
          name: newUserForm.name,
          role: newUserForm.role,
          projectId: newUserForm.projectId,
          allowedProjectIds: [newUserForm.projectId],
          enabled: newUserForm.enabled,
      });
      setIsCreatingUser(false);
      if (!res.success) {
          alert(`新增失败：${res.message || '未知错误'}`);
          return;
      }
      setNewUserForm(prev => ({
          ...prev,
          email: '',
          name: '',
          password: '',
          role: 'park_user',
      }));
      await loadManagedUsers();
      alert(newUserForm.enabled ? '登录人员已新增并启用。' : '登录人员已新增，等待管理员审批启用。');
  };

  const handleApproveManagedUser = async (user: ManagedUserAccount, enabled: boolean) => {
      if (!isPlatformAdmin()) {
          alert('仅平台管理员可审批登录人员。');
          return;
      }
      const res = await updateManagedCloudUserEnabled(user.id, enabled);
      if (!res.success) {
          alert(`操作失败：${res.message || '未知错误'}`);
          return;
      }
      await loadManagedUsers();
  };

  const handleApproveSignupRequest = async (req: SignupRequestRecord) => {
      if (!isPlatformAdmin()) {
          alert('仅平台管理员可审批注册申请。');
          return;
      }
      const res = await approveCloudSignupRequest(req.id);
      if (!res.success) {
          alert(`审批失败：${res.message || '未知错误'}`);
          return;
      }
      await Promise.all([loadSignupRequests(), loadManagedUsers()]);
      alert('审批完成，已创建可登录账号。');
  };

  const openUserManageModal = (u: ManagedUserAccount) => {
      setUserManageTarget(u);
      const pid = u.projectId || u.allowedProjectIds[0] || '';
      const allowed = u.allowedProjectIds.length ? [...u.allowedProjectIds] : pid ? [pid] : [];
      setUserManageForm({
          name: u.name || '',
          role: u.role,
          projectId: pid,
          allowedParkIds: allowed,
          password: '',
          enabled: u.enabled,
      });
  };

  const toggleUserManagePark = (projectId: string, checked: boolean) => {
      setUserManageForm((prev) => {
          const set = new Set(prev.allowedParkIds);
          if (checked) set.add(projectId);
          else set.delete(projectId);
          return { ...prev, allowedParkIds: Array.from(set) };
      });
  };

  const handleSaveUserManageModal = async () => {
      if (!userManageTarget || !isPlatformAdmin()) return;
      const pid = userManageForm.projectId.trim();
      if (!pid) {
          alert('请填写默认园区 project_id');
          return;
      }
      setUserManageSaving(true);
      const allowed = Array.from(new Set([pid, ...userManageForm.allowedParkIds.map((x) => x.trim()).filter(Boolean)]));
      const res = await updateManagedCloudUser({
          userId: userManageTarget.id,
          name: userManageForm.name.trim() || undefined,
          role: userManageForm.role,
          projectId: pid,
          allowedProjectIds: allowed,
          enabled: userManageForm.enabled,
          password: userManageForm.password.trim() || undefined,
      });
      setUserManageSaving(false);
      if (!res.success) {
          alert(res.message || '保存失败');
          return;
      }
      setUserManageTarget(null);
      await Promise.all([loadManagedUsers(), loadSignupRequests()]);
      alert('已保存');
  };

  const handleDeleteUserManageModal = async () => {
      if (!userManageTarget || !isPlatformAdmin()) return;
      if (!window.confirm(`确定删除登录账号「${userManageTarget.email}」？此操作不可恢复。`)) return;
      setUserManageSaving(true);
      const res = await deleteManagedCloudUser(userManageTarget.id, authUser?.id);
      setUserManageSaving(false);
      if (!res.success) {
          alert(res.message || '删除失败');
          return;
      }
      setUserManageTarget(null);
      await Promise.all([loadManagedUsers(), loadSignupRequests()]);
      alert(res.message || '已删除账号');
  };

  const handleDeleteSignupRequest = async (req: SignupRequestRecord) => {
      if (!isPlatformAdmin()) {
          alert('仅平台管理员可清理审批记录。');
          return;
      }
      if (!window.confirm(`确认清理审批记录「${req.email}」？\n注意：此操作仅删除审批/申请记录，不影响已创建账号的登录状态。`)) {
          return;
      }
      const res = await deleteCloudSignupRequest(req.id);
      if (!res.success) {
          alert(res.message || '清理失败');
          return;
      }
      await loadSignupRequests();
      alert(res.message || '已清理审批记录');
  };

  const formatPct = formatPercent;

  const buildDashboardDataFromKpiSnapshot = (snapshot: { summary: KpiSnapshotSummary; monthlyTrends?: MonthlyTrend[]; dataVersion?: number }): DashboardData => {
      const summary = normalizeKpiSummaryWithMonthlyTrends(snapshot.summary, snapshot.monthlyTrends || []);
      return {
          ...generateInitialData(),
          annualRevenueTarget: summary.annualRevenueTarget,
          annualRevenueCollected: summary.annualRevenueCollected,
          annualOccupancyTarget: summary.annualOccupancyTarget,
          occupancyRate: summary.occupancyRate,
          totalArea: summary.totalArea,
          monthlyRevenueTarget: summary.annualBudgetTarget,
          monthlyRevenueCollected: summary.annualRevenueCollected,
          collectionRate: summary.annualBudgetCompletion,
          monthlyTrends: snapshot.monthlyTrends || [],
          cloudSaveVersion: snapshot.dataVersion || 0,
      };
  };

  const buildParkMetric = (park: ParkInfo, rawData: DashboardData): AdminParkMetric => {
      const { processedData } = calculateDashboardMetricsService(rawData, {
          year: selectedYear,
          quarter: 'All',
          billingSelectedMonth,
      });
      const summary = buildKpiSummaryFromProcessedData(processedData, selectedYear);
      const annualInitialBudget = summary.annualInitialBudget || 0;
      // 合同应收优先取新字段，旧快照回退到 annualRevenueTarget
      const annualContractReceivable = summary.annualContractReceivable || summary.annualRevenueTarget || 0;
      return {
          projectId: park.projectId,
          name: park.name || park.projectId,
          ...summary,
          annualInitialBudget,
          annualContractReceivable,
          budgetDeviation: annualInitialBudget > 0
              ? ((annualContractReceivable - annualInitialBudget) / annualInitialBudget) * 100
              : 0,
      };
  };

  const buildParkMetricFromSnapshot = (park: ParkInfo, summary: KpiSnapshotSummary): AdminParkMetric => {
      const annualInitialBudget = summary.annualInitialBudget || 0;
      // 合同应收优先取新字段，旧快照回退到 annualRevenueTarget
      const annualContractReceivable = summary.annualContractReceivable || summary.annualRevenueTarget || 0;
      return {
          projectId: park.projectId,
          name: park.name || park.projectId,
          ...summary,
          annualInitialBudget,
          annualContractReceivable,
          budgetDeviation: annualInitialBudget > 0
              ? ((annualContractReceivable - annualInitialBudget) / annualInitialBudget) * 100
              : 0,
      };
  };

  useEffect(() => {
      if (!authUser || !isGlobalAdmin(authUser) || authorizedParks.length === 0) {
          setAdminParkMetrics([]);
          return;
      }
      let cancelled = false;
      const loadAdminSummary = async () => {
          setIsLoadingAdminSummary(true);
          try {
              const parks = authorizedParks.filter(park => park.enabled);
              const metrics: AdminParkMetric[] = [];
              for (const park of parks) {
                  // 所有园区统一数据源：优先 PocketBase KPI 快照，回落至全量备份，再回落 localStorage。
                  // 不再对「当前园区」特殊处理——避免汇总口径随当前园区切换而变化。
                  const config = { ...cloudConfig, projectId: park.projectId };
                  const snapshotRes = await fetchCloudKpiSnapshot(config, selectedYear);
                  if (snapshotRes.success && snapshotRes.snapshot) {
                      const snap = snapshotRes.snapshot;
                      metrics.push(
                          buildParkMetricFromSnapshot(
                              park,
                              normalizeKpiSummaryWithMonthlyTrends(snap.summary, snap.monthlyTrends || [])
                          )
                      );
                      continue;
                  }

                  const res = await fetchCloudBackup(config, park.projectId);
                  const cloudData = res.success && res.data
                      ? { ...generateInitialData(), ...res.data }
                      : null;
                  if (cloudData && hasMeaningfulDashboardPayload(cloudData)) {
                      metrics.push(buildParkMetric(park, cloudData));
                      continue;
                  }

                  const cached = localStorage.getItem(getParkStorageKey(park.projectId));
                  const cachedData = cached
                      ? { ...generateInitialData(), ...JSON.parse(cached) }
                      : null;
                  if (cachedData && hasMeaningfulDashboardPayload(cachedData)) {
                      metrics.push(buildParkMetric(park, cachedData));
                  }
              }
              if (!cancelled) setAdminParkMetrics(metrics);
          } catch (e) {
              console.warn('[adminSummary] 加载管理员园区汇总失败', e);
              if (!cancelled) setAdminParkMetrics([]);
          } finally {
              if (!cancelled) setIsLoadingAdminSummary(false);
          }
      };
      const timer = window.setTimeout(loadAdminSummary, 120);
      return () => {
          cancelled = true;
          window.clearTimeout(timer);
      };
  }, [authUser, authorizedParks, cloudConfig.pocketbaseUrl, selectedYear, cloudConfig.projectId]);

  useEffect(() => {
      if (!canAccessSystemSettings && activeTab === 'settings') {
          setActiveTab('dashboard');
      }
  }, [canAccessSystemSettings, activeTab]);

  useEffect(() => {
      if (!mobileNavLayout) return;
      if (
          activeTab === 'buildings' ||
          activeTab === 'budget' ||
          activeTab === 'initData' ||
          activeTab === 'settings'
      ) {
          setActiveTab('dashboard');
      }
  }, [mobileNavLayout, activeTab]);

  useEffect(() => {
      if (activeTab === 'settings' && isPlatformAdmin()) {
          loadManagedUsers();
          loadSignupRequests();
      }
  }, [activeTab, authUser?.id, cloudConfig.projectId]);

  useEffect(() => {
      if (!authUser) {
          loadPublicParkOptions();
      }
  }, [authUser, cloudConfig.pocketbaseUrl]);

  const adminSummaryTotals = useMemo(() => {
      const totals = adminParkMetrics.reduce((acc, item) => {
          acc.annualInitialBudget += item.annualInitialBudget;
          acc.annualContractReceivable += item.annualContractReceivable;
          acc.annualRevenueTarget += item.annualRevenueTarget;
          acc.annualRevenueCollected += item.annualRevenueCollected;
          acc.annualBudgetTarget += item.annualBudgetTarget;
          acc.tenantCount += item.tenantCount;
          acc.totalArea += item.totalArea;
          acc.occupancyWeightedArea += item.totalArea * item.occupancyRate;
          acc.occupancyTargetWeightedArea += item.totalArea * item.annualOccupancyTarget;
          return acc;
      }, {
          annualInitialBudget: 0,
          annualContractReceivable: 0,
          annualRevenueTarget: 0,
          annualRevenueCollected: 0,
          annualBudgetTarget: 0,
          tenantCount: 0,
          totalArea: 0,
          occupancyWeightedArea: 0,
          occupancyTargetWeightedArea: 0,
      });
      return {
          ...totals,
          annualGoalCompletion: totals.annualContractReceivable > 0
              ? Math.min(100, (totals.annualRevenueCollected / totals.annualContractReceivable) * 100)
              : 0,
          annualBudgetCompletion: totals.annualBudgetTarget > 0
              ? Math.min(100, (totals.annualRevenueCollected / totals.annualBudgetTarget) * 100)
              : 0,
          budgetDeviation: totals.annualInitialBudget > 0
              ? ((totals.annualContractReceivable - totals.annualInitialBudget) / totals.annualInitialBudget) * 100
              : 0,
          occupancyRate: totals.totalArea > 0 ? totals.occupancyWeightedArea / totals.totalArea : 0,
          annualOccupancyTarget: totals.totalArea > 0 ? totals.occupancyTargetWeightedArea / totals.totalArea : 0,
      };
  }, [adminParkMetrics]);

  const annualComparisonData: AnnualComparisonData[] = useMemo(() => {
      if (!data) return [];
      
      // Dynamic Year Generation based on Current System Date
      const currentSystemYear = new Date().getFullYear();
      // CHANGED: Display Current and Previous 2 Years (No Future)
      const years = [currentSystemYear - 2, currentSystemYear - 1, currentSystemYear];
      
      const result: AnnualComparisonData[] = [];

      years.forEach((year, i) => {
          const initRows = data.initializationData?.filter(d => d.year === year) || [];
          const useInitAsSource = year >= 2023 && year <= 2025;
          
          let yearlyActual = 0;
          if (useInitAsSource) {
              yearlyActual = initRows.reduce((sum, r) => sum + (r.revenueCollected || 0), 0);
          } else {
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
          }

          let yearlyTarget = 0;
          if (useInitAsSource) {
              yearlyTarget = initRows.reduce((sum, r) => sum + (r.revenueTarget || 0), 0);
          } else {
              yearlyTarget = data.yearlyTargets?.[year]?.revenue || 0;
              if (yearlyTarget === 0) {
                  const initTargetSum = initRows.reduce((sum, r) => sum + (r.revenueTarget || 0), 0);
                  if (initTargetSum > 0) yearlyTarget = initTargetSum;
              }
          }

          let occupancy = 0;
          if (useInitAsSource) {
              const latestInit = [...initRows].sort((a, b) => b.month - a.month)[0];
              occupancy = latestInit?.occupancyRate || 0;
          } else {
              const decInit = initRows.find(d => d.month === 12);
              if (decInit) {
                  occupancy = decInit.occupancyRate;
              } else if (year === selectedYear) {
                  occupancy = data.occupancyRate;
              } else if (year === selectedYear - 1 && data.prevYearMonthlyTrends && data.prevYearMonthlyTrends.length > 0) {
                  occupancy = data.prevYearMonthlyTrends[data.prevYearMonthlyTrends.length - 1].occupancyRate;
              }
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

  if (!data) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="flex flex-col items-center gap-2"><Loader2 size={32} className="text-blue-500 animate-spin"/><div className="text-slate-400">Loading Dashboard...</div></div></div>;

  if (!authUser) {
      return (
          <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
              <form onSubmit={authMode === 'login' ? handleLogin : handleSignupSubmit} className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-5">
                  <div>
                      <h1 className="text-xl font-bold text-slate-800 text-center">金蝶招商管理系统</h1>
                  </div>

                  <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1">
                      <button type="button" onClick={() => { setAuthMode('login'); setSignupMsg(null); }} className={`py-1.5 rounded text-sm font-medium ${authMode === 'login' ? 'bg-white shadow-sm text-sky-700' : 'text-slate-500'}`}>登录</button>
                      <button type="button" onClick={() => { setAuthMode('register'); setLoginError(null); }} className={`py-1.5 rounded text-sm font-medium ${authMode === 'register' ? 'bg-white shadow-sm text-sky-700' : 'text-slate-500'}`}>注册申请</button>
                  </div>

                  <div className="space-y-3">
                      <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">邮箱</label>
                          <input
                              type="email"
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-300"
                              value={authMode === 'login' ? loginForm.email : signupForm.email}
                              onChange={e => authMode === 'login' ? setLoginForm({ ...loginForm, email: e.target.value }) : setSignupForm(prev => ({ ...prev, email: e.target.value }))}
                              placeholder="user@example.com"
                          />
                      </div>
                      {authMode === 'register' && (
                          <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1">姓名</label>
                              <input
                                  type="text"
                                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-300"
                                  value={signupForm.applicantName}
                                  onChange={(e) => setSignupForm((prev) => ({ ...prev, applicantName: e.target.value }))}
                                  placeholder="真实姓名"
                                  autoComplete="name"
                              />
                          </div>
                      )}
                      <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">密码</label>
                          <input
                              type="password"
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-300"
                              value={authMode === 'login' ? loginForm.password : signupForm.password}
                              onChange={e => authMode === 'login' ? setLoginForm({ ...loginForm, password: e.target.value }) : setSignupForm(prev => ({ ...prev, password: e.target.value }))}
                              placeholder="请输入密码"
                          />
                      </div>
                      {authMode === 'register' && (
                          <div>
                              <div className="block text-xs font-medium text-slate-500 mb-2">申请园区（可多选）</div>
                              <div className="max-h-36 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1">
                                  {isLoadingPublicParks ? (
                                      <div className="text-xs text-slate-500 px-2 py-1">正在加载园区...</div>
                                  ) : publicParks.length === 0 ? (
                                      <div className="text-xs text-slate-500 px-2 py-1">暂无可选园区，请联系管理员</div>
                                  ) : (
                                      publicParks.map(park => {
                                          const checked = signupForm.requestedProjectIds.includes(park.projectId);
                                          return (
                                              <label key={park.projectId} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white text-sm text-slate-700">
                                                  <input
                                                      type="checkbox"
                                                      checked={checked}
                                                      onChange={(e) => {
                                                          const nextIds = e.target.checked
                                                              ? Array.from(new Set([...signupForm.requestedProjectIds, park.projectId]))
                                                              : signupForm.requestedProjectIds.filter(pid => pid !== park.projectId);
                                                          setSignupForm(prev => ({ ...prev, requestedProjectIds: nextIds }));
                                                      }}
                                                  />
                                                  <span>{park.name} ({park.projectId})</span>
                                              </label>
                                          );
                                      })
                                  )}
                              </div>
                          </div>
                      )}
                  </div>

                  {loginError && (
                      <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                          {loginError}
                      </div>
                  )}
                  {signupMsg && (
                      <div className={`text-sm rounded-lg px-3 py-2 border ${signupMsg.includes('失败') || signupMsg.includes('请') ? 'text-rose-600 bg-rose-50 border-rose-100' : 'text-emerald-700 bg-emerald-50 border-emerald-100'}`}>
                          {signupMsg}
                      </div>
                  )}

                  <button
                      type="submit"
                      disabled={authMode === 'login' ? isLoggingIn : isSubmittingSignup}
                      className="w-full bg-sky-600 text-white rounded-lg py-2.5 font-medium hover:bg-sky-700 disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                      {(authMode === 'login' ? isLoggingIn : isSubmittingSignup) ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}
                      {authMode === 'login' ? '登录并加载园区数据' : '提交注册申请'}
                  </button>
              </form>
          </div>
      );
  }

  return (
    <DirtyTrackerProvider recordMeta={recordMeta} tracker={dirtyTrackerRef.current}>
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
          {mobileNavLayout ? (
            <>
              <SidebarItem icon={<Users size={22} />} label="合同录入" isOpen={true} active={activeTab === 'contracts'} onClick={() => { setActiveTab('contracts'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<PieChart size={22} />} label="收款核销" isOpen={true} active={activeTab === 'finance'} onClick={() => { setActiveTab('finance'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
            </>
          ) : (
            <>
              <SidebarItem icon={<Building2 size={22} />} label="楼宇资管" isOpen={true} active={activeTab === 'buildings'} onClick={() => { setActiveTab('buildings'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<Users size={22} />} label="客户管理" isOpen={true} active={activeTab === 'contracts'} onClick={() => { setActiveTab('contracts'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<PieChart size={22} />} label="财务报表" isOpen={true} active={activeTab === 'finance'} onClick={() => { setActiveTab('finance'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<Calculator size={22} />} label="预算管理" isOpen={true} active={activeTab === 'budget'} onClick={() => { setActiveTab('budget'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <SidebarItem icon={<TableIcon size={22} />} label="初始化数据" isOpen={true} active={activeTab === 'initData'} onClick={() => { setActiveTab('initData'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              <div className="my-2 h-px bg-slate-100 mx-4" />
              {canAccessSystemSettings && (
                <SidebarItem icon={<Settings size={22} />} label="系统与备份" isOpen={true} active={activeTab === 'settings'} onClick={() => { setActiveTab('settings'); if(window.innerWidth < 1024) setSidebarOpen(false); }} />
              )}
            </>
          )}
        </nav>
      </aside>

      <main className="flex-1 transition-all duration-300 w-full min-w-0 flex flex-col lg:pl-64">
        <header className="min-h-14 lg:min-h-16 bg-white border-b border-slate-200 sticky top-0 z-20 px-3 sm:px-4 py-2 lg:py-0 flex items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 hover:bg-slate-100 rounded-lg text-slate-600 lg:hidden shrink-0"><Menu size={20} /></button>
            <h1 className="text-sm sm:text-base lg:text-xl font-bold text-slate-800 truncate min-w-0">{activeTab === 'dashboard' ? '金蝶地产——招商管理系统' : activeTab === 'buildings' ? '楼宇资产管理' : activeTab === 'contracts' ? (mobileNavLayout ? '合同录入' : '客户合同中心') : activeTab === 'finance' ? (mobileNavLayout ? '收款核销' : '财务收款报表') : activeTab === 'budget' ? '招商预算管理' : activeTab === 'initData' ? '初始化数据' : '系统设置'}</h1>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap justify-end">
             <div className="hidden md:flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                 <User size={14} className="text-slate-400" />
                 <span className="text-slate-600 max-w-[120px] truncate">{authUser.email}</span>
             </div>
             {isGlobalAdmin() && authorizedParks.length > 1 ? (
               <div className="hidden sm:flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1" title="切换授权园区">
                 {authorizedParks.map(park => (
                   <button
                     key={park.projectId}
                     type="button"
                     onClick={() => switchProject(park.projectId)}
                     disabled={isSyncing || park.projectId === cloudConfig.projectId}
                     className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                       park.projectId === cloudConfig.projectId
                         ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-500'
                         : 'text-slate-600 hover:bg-white hover:text-sky-700'
                     } disabled:cursor-default`}
                   >
                     {park.name}
                   </button>
                 ))}
               </div>
             ) : (
               <span className="hidden sm:inline-flex text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                 {authorizedParks.find(park => park.projectId === cloudConfig.projectId)?.name || cloudConfig.projectId}
               </span>
             )}
             <button
               type="button"
               onClick={handleSaveToBackend}
               disabled={!data || isSyncing}
               className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
               title={lastSaved ? `上次本地缓存 ${lastSaved}` : '保存到 PocketBase'}
             >
               {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
               <span className="hidden sm:inline">保存</span>
             </button>
             {activeTab === 'dashboard' && (
               <button 
                 onClick={() => setAIDialogOpen(true)}
                 className="hidden md:flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg font-medium text-sm"
               >
                 <Sparkles size={16} />
                 <span>AI 智能助手</span>
               </button>
             )}
             <div className={`hidden md:flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${isCloudConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`} title={isCloudConnected ? '已连接 PocketBase 后端' : '未连接后端，仅本地缓存'}>
                 {isCloudConnected ? <CheckCircle2 size={12} className="text-emerald-500"/> : <Cloud size={12} />}
                 <span>{isCloudConnected ? '后端在线' : '仅本地'}</span>
             </div>
             <button
               type="button"
               onClick={handleLogout}
               className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg"
               title="退出登录"
             >
               <LogOut size={16} />
             </button>
          </div>
        </header>

        <div className="p-3 md:p-6 max-w-7xl mx-auto w-full min-w-0">
          {activeTab === 'dashboard' && (
            <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
               {isGlobalAdmin() && (
                 <div className="bg-slate-900 text-white rounded-2xl shadow-xl overflow-hidden border border-slate-800">
                   <div className="px-4 md:px-6 py-4 border-b border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                     <div>
                       <div className="text-xs text-sky-200 font-semibold tracking-wide">管理员视图</div>
                       <h2 className="text-lg md:text-xl font-bold mt-1">所有园区经营汇总</h2>
                     </div>
                     <div className="text-xs text-slate-300">
                       {isLoadingAdminSummary ? '正在汇总各园区数据...' : `统计年度 ${selectedYear} · ${adminParkMetrics.length} 个园区`}
                     </div>
                   </div>
                   <div className="p-4 md:p-6 space-y-4">
                     <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3">
                       <div className="bg-white/10 rounded-xl p-3 border border-white/10 min-w-0">
                         <div className="text-xs text-slate-300">年初预算</div>
                         <div className="text-xl font-bold mt-1">{formatWan(adminSummaryTotals.annualInitialBudget, 0)}</div>
                         <div className="text-xs text-slate-400 mt-1">年度计划值</div>
                       </div>
                       <div className="bg-white/10 rounded-xl p-3 border border-white/10 min-w-0">
                         <div className="text-xs text-slate-300">实际合同应收</div>
                         <div className="text-xl font-bold mt-1">{formatWan(adminSummaryTotals.annualContractReceivable, 0)}</div>
                         <div className="text-xs text-slate-400 mt-1">实收 {formatWan(adminSummaryTotals.annualRevenueCollected, 0)}</div>
                       </div>
                       <div className="bg-white/10 rounded-xl p-3 border border-white/10 min-w-0">
                         <div className="text-xs text-slate-300">完成率</div>
                         <div className="text-xl font-bold mt-1 text-emerald-300">{formatPct(adminSummaryTotals.annualGoalCompletion, 0)}</div>
                         <div className="text-xs text-slate-400 mt-1">实收/合同应收</div>
                       </div>
                       <div className="bg-white/10 rounded-xl p-3 border border-white/10 min-w-0">
                         <div className="text-xs text-slate-300">预算偏差</div>
                         <div className={`text-xl font-bold mt-1 ${adminSummaryTotals.budgetDeviation >= 0 ? 'text-sky-300' : 'text-red-300'}`}>
                           {adminSummaryTotals.annualInitialBudget > 0 ? formatPct(adminSummaryTotals.budgetDeviation, 0) : '—'}
                         </div>
                         <div className="text-xs text-slate-400 mt-1">合同应收vs年初预算</div>
                       </div>
                       <div className="bg-white/10 rounded-xl p-3 border border-white/10 min-w-0">
                         <div className="text-xs text-slate-300">综合出租率</div>
                         <div className="text-xl font-bold mt-1 text-amber-300">{formatPct(adminSummaryTotals.occupancyRate, 0)}</div>
                         <div className="text-xs text-slate-400 mt-1">目标 {formatPct(adminSummaryTotals.annualOccupancyTarget, 0)}</div>
                       </div>
                     </div>
                     {adminParkMetrics.length > 0 && (
                       <div className="overflow-x-auto rounded-xl border border-white/10">
                         <table className="w-full text-xs md:text-sm">
                           <thead className="bg-white/10 text-slate-200">
                             <tr>
                               <th className="text-left px-3 py-2">园区</th>
                               <th className="text-right px-3 py-2">年初预算</th>
                               <th className="text-right px-3 py-2">实际合同应收</th>
                               <th className="text-right px-3 py-2">实收</th>
                               <th className="text-right px-3 py-2">完成率</th>
                               <th className="text-right px-3 py-2">预算偏差</th>
                               <th className="text-right px-3 py-2">出租率</th>
                             </tr>
                           </thead>
                           <tbody className="divide-y divide-white/10">
                             {adminParkMetrics.map(item => (
                               <tr key={item.projectId} className={item.projectId === cloudConfig.projectId ? 'bg-sky-500/10' : ''}>
                                 <td className="px-3 py-2 font-medium">{item.name}</td>
                                 <td className="px-3 py-2 text-right tabular-nums">{item.annualInitialBudget > 0 ? formatWan(item.annualInitialBudget, 0) : '—'}</td>
                                 <td className="px-3 py-2 text-right tabular-nums">{formatWan(item.annualContractReceivable, 0)}</td>
                                 <td className="px-3 py-2 text-right tabular-nums">{formatWan(item.annualRevenueCollected, 0)}</td>
                                 <td className="px-3 py-2 text-right tabular-nums">{formatPct(item.annualGoalCompletion, 0)}</td>
                                 <td className={`px-3 py-2 text-right tabular-nums ${item.budgetDeviation >= 0 ? 'text-sky-400' : 'text-red-400'}`}>
                                   {item.annualInitialBudget > 0 ? formatPct(item.budgetDeviation, 0) : '—'}
                                 </td>
                                 <td className="px-3 py-2 text-right tabular-nums">{formatPct(item.occupancyRate, 0)}</td>
                               </tr>
                             ))}
                           </tbody>
                         </table>
                       </div>
                     )}
                   </div>
                 </div>
               )}
               <DashboardAlerts tenants={data.tenants} invoices={data.invoices} />
               <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm min-w-0">
                   <div className="flex items-center gap-2 min-w-0">
                       <Calendar className="text-blue-500 shrink-0" size={18}/>
                       <span className="font-bold text-slate-700 text-sm md:text-base truncate">统计年度: {selectedYear}</span>
                   </div>
                   <div className="flex items-center justify-center sm:justify-end bg-slate-50 rounded-lg p-1 border border-slate-200 shrink-0 self-stretch sm:self-auto">
                       <button onClick={() => handleYearChange(selectedYear - 1)} className="p-1.5 hover:bg-white hover:shadow-sm rounded transition-all text-slate-600"><ChevronLeft size={16}/></button>
                       <span className="px-3 font-mono font-medium text-slate-800">{selectedYear}</span>
                       <button onClick={() => handleYearChange(selectedYear + 1)} className="p-1.5 hover:bg-white hover:shadow-sm rounded transition-all text-slate-600"><ChevronRight size={16}/></button>
                   </div>
               </div>

               <StatsCards data={data} selectedYear={selectedYear} onEditTargets={openTargetModal} tenants={data.tenants} />
               <AnnualMetricComparisonTable data={annualComparisonData} />
               <RecentActivityTable data={data} />
               <BillingTable
                  data={data}
                  selectedMonth={billingSelectedMonth}
                  onMonthChange={setBillingSelectedMonth}
                  onUpdateRentRemark={updateRentCollectionRemark}
               />
            </div>
          )}

          {activeTab === 'buildings' && (<div className="animate-in fade-in zoom-in-50 duration-300"><BuildingManager buildings={data.buildings} tenants={data.tenants} onUpdateBuildings={updateBuildings} onCommitBuildingsTenants={commitBuildingsTenants} /></div>)}
          {activeTab === 'contracts' && (<div className="animate-in fade-in zoom-in-50 duration-300"><ContractManager tenants={data.tenants} buildings={data.buildings} onUpdateTenants={updateTenants} dashboardData={data} payments={data.payments} onUpdatePayments={updatePayments} budgetAdjustments={data.budgetAdjustments} onUpdateAdjustments={updateBudgetAdjustments} mobileEntryMode={mobileNavLayout} /></div>)}
          {activeTab === 'finance' && (
              <div className="animate-in fade-in zoom-in-50 duration-300">
                  <FinanceManager
                      payments={data.payments}
                      tenants={data.tenants}
                      invoices={data.invoices || []}
                      billingPeriodNotes={data.billingPeriodNotes || {}}
                      onUpdatePayments={updatePayments}
                      onUpdateTenants={updateTenants}
                      onUpdateInvoices={updateInvoices}
                      onBatchUpdate={handleBatchUpdate}
                      getBillingDetails={(year: number, month: number) => buildBillingDetailsForPeriodService(year, month, data)}
                      onDeferPayment={handleDeferPayment}
                      onRevokeDeferBillingNote={handleRevokeDeferBillingNote}
                      onResetReceivableApplications={handleResetReceivableApplications}
                      onUpdateRentRemark={updateRentCollectionRemark}
                      buildings={data.buildings}
                      budgetAssumptions={data.budgetAssumptions}
                      budgetAdjustments={data.budgetAdjustments}
                      mobileReceivableOnly={mobileNavLayout}
                  />
              </div>
          )}
          {activeTab === 'budget' && (<div className="animate-in fade-in zoom-in-50 duration-300"><BudgetManager buildings={data.buildings} tenants={data.tenants} budgetAssumptions={data.budgetAssumptions} onUpdateAssumptions={updateBudgetAssumptions} budgetAdjustments={data.budgetAdjustments} onUpdateAdjustments={updateBudgetAdjustments} budgetAnalysis={data.budgetAnalysis} onUpdateAnalysis={updateBudgetAnalysis} payments={data.payments} scenarios={data.budgetScenarios || []} onUpdateScenarios={updateBudgetScenarios} onRenameScenario={handleRenameScenario} onActivateScenario={handleActivateScenario} onSaveBudgetToCloud={handleSaveBudgetToCloud} initializationData={data.initializationData} billingPeriodNotes={data.billingPeriodNotes} onBatchUpdate={handleBatchUpdate} /></div>)}
          {activeTab === 'initData' && (
            <div className="animate-in fade-in zoom-in-50 duration-300 max-w-2xl mx-auto space-y-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 md:p-6 border-b border-slate-200"><h2 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2"><TableIcon className="text-indigo-500" /> 初始化数据</h2></div>
                    <div className="p-4 md:p-6 border-b border-slate-200 bg-indigo-50/30">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-white rounded-lg text-indigo-600 shadow-sm border border-indigo-100"><TableIcon size={24} /></div>
                            <div>
                                <h3 className="font-bold text-slate-700">系统初始化数据 (2023-2026)</h3>
                                <div className="text-sm text-slate-500 mt-1">手动录入历史月度应收、实收及出租率数据，用于看板展示；当某月「月度应收」大于 0 时，首页「预算执行」该月预算收款优先取此值，为 0 时回退到预算表/生效方案。2025年12月支持录入累计欠款。</div>
                            </div>
                        </div>
                        <div className="bg-white p-4 rounded-lg border border-slate-200">
                            <button onClick={openInitDataModal} className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium flex items-center justify-center gap-2">
                                <FileInput size={16} /> 录入/编辑 初始化数据
                            </button>
                        </div>
                    </div>
                    <TenantBudgetNameLinkTool
                        tenants={data.tenants}
                        billingPeriodNotes={data.billingPeriodNotes}
                        onBatchUpdate={handleBatchUpdate}
                    />
                </div>
            </div>
          )}
          {activeTab === 'settings' && (
             <div className="animate-in fade-in zoom-in-50 duration-300 max-w-2xl mx-auto space-y-4">
                 <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                     <div className="p-4 md:p-6 border-b border-slate-200"><h2 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2"><Settings className="text-slate-400" /> 系统设置</h2></div>

                     <div className="p-4 md:p-6 border-b border-slate-200 bg-sky-50/30">
                       <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-white rounded-lg text-sky-600 shadow-sm border border-sky-100"><CloudCog size={24} /></div><div><h3 className="font-bold text-slate-700">PocketBase 后端</h3><div className="flex items-center gap-2 text-sm mt-1 text-slate-600">当前以登录账号绑定园区访问后端；可通过 Tailscale IP、MagicDNS 或反向代理域名连接中心 PocketBase。</div><div className="flex items-center gap-2 text-sm mt-2">{isCloudConnected ? (<span className="flex items-center gap-1 text-emerald-600 font-medium"><CheckCircle2 size={14} /> 已连接</span>) : (<span className="flex items-center gap-1 text-rose-500 font-medium"><AlertCircle size={14} /> 未连接</span>)}</div></div></div>
                        <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-4">
                            <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                                <div className="text-xs font-medium text-slate-500">后端连接</div>
                                <div className="text-sm text-slate-700 mt-1">{cloudConfig.pocketbaseUrl || DEFAULT_CLOUD_CONFIG.pocketbaseUrl || '/api/pb'}</div>
                                <p className="text-xs text-slate-400 mt-1">连接地址由部署配置统一维护，用户登录时无需填写。</p>
                            </div>
                             <div>
                                 <label className="block text-xs font-medium text-slate-500 mb-1">当前园区</label>
                                 <div className="flex gap-2">
                                     {isGlobalAdmin() ? <select
                                        className="flex-1 bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600 outline-none focus:ring-1 focus:ring-sky-200"
                                        value={cloudConfig.projectId}
                                        onChange={e => switchProject(e.target.value)}
                                        disabled={authorizedParks.length <= 1}
                                     >
                                        {(authorizedParks.length ? authorizedParks : [{ projectId: cloudConfig.projectId, name: cloudConfig.projectId, enabled: true } as ParkInfo]).map(park => (
                                            <option key={park.projectId} value={park.projectId}>{park.name} ({park.projectId})</option>
                                        ))}
                                     </select> : <div className="flex-1 bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-600">{authorizedParks.find(park => park.projectId === cloudConfig.projectId)?.name || cloudConfig.projectId}</div>}
                                     <button onClick={handleCloudConfigSave} className="bg-sky-500 text-white px-4 py-2 rounded text-sm hover:bg-sky-600 font-medium transition-colors">保存配置</button>
                                 </div>
                                 <p className="text-xs text-slate-400 mt-1">{isGlobalAdmin() ? '管理员可在授权园区间切换。' : '普通用户登录后自动进入已分配园区。'}</p>
                             </div>
                         </div>
                     </div>

                    <div className="p-4 md:p-6 border-b border-slate-200 bg-emerald-50/40">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-white rounded-lg text-emerald-600 shadow-sm border border-emerald-100"><Users size={24} /></div>
                            <div>
                                <h3 className="font-bold text-slate-700">登录人员管理（管理员）</h3>
                                <div className="text-sm text-slate-500 mt-1">管理员可新增登录人员，并审批待启用账号。</div>
                            </div>
                        </div>
                        {!isPlatformAdmin() ? (
                            <div className="bg-white border border-amber-100 text-amber-700 rounded-lg px-4 py-3 text-sm">
                                当前账号为管理员但非平台管理员，仅可查看系统设置，不可维护登录人员。
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <form onSubmit={handleCreateManagedUser} className="bg-white p-4 rounded-lg border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <input
                                        className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm"
                                        placeholder="登录邮箱"
                                        value={newUserForm.email}
                                        onChange={e => setNewUserForm(prev => ({ ...prev, email: e.target.value }))}
                                    />
                                    <input
                                        className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm"
                                        placeholder="姓名（可选）"
                                        value={newUserForm.name}
                                        onChange={e => setNewUserForm(prev => ({ ...prev, name: e.target.value }))}
                                    />
                                    <input
                                        type="password"
                                        className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm"
                                        placeholder="初始密码"
                                        value={newUserForm.password}
                                        onChange={e => setNewUserForm(prev => ({ ...prev, password: e.target.value }))}
                                    />
                                    <select
                                        className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm"
                                        value={newUserForm.role}
                                        onChange={e => setNewUserForm(prev => ({ ...prev, role: e.target.value as 'park_user' | 'park_admin' | 'group_admin' }))}
                                    >
                                        <option value="park_user">普通用户（park_user）</option>
                                        <option value="park_admin">园区管理员（park_admin）</option>
                                        <option value="group_admin">集团管理员（group_admin）</option>
                                    </select>
                                    <input
                                        className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm"
                                        placeholder="默认园区 project_id"
                                        value={newUserForm.projectId}
                                        onChange={e => setNewUserForm(prev => ({ ...prev, projectId: e.target.value }))}
                                    />
                                    <label className="flex items-center gap-2 text-sm text-slate-600">
                                        <input
                                            type="checkbox"
                                            checked={newUserForm.enabled}
                                            onChange={e => setNewUserForm(prev => ({ ...prev, enabled: e.target.checked }))}
                                        />
                                        新增后直接启用（不勾选则待审批）
                                    </label>
                                    <div className="md:col-span-2 flex justify-end gap-2">
                                        <button type="button" onClick={loadManagedUsers} className="px-4 py-2 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm">刷新列表</button>
                                        <button type="submit" disabled={isCreatingUser} className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 text-sm disabled:opacity-60">
                                            {isCreatingUser ? '提交中...' : '新增登录人员'}
                                        </button>
                                    </div>
                                </form>

                                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                                        <div className="text-sm font-semibold text-slate-700">待审批账号</div>
                                        <div className="text-xs text-slate-400">{managedUsers.filter(u => !u.enabled).length} 条</div>
                                    </div>
                                    <div className="max-h-64 overflow-y-auto">
                                        {isLoadingManagedUsers ? (
                                            <div className="px-4 py-3 text-sm text-slate-500">正在加载登录人员...</div>
                                        ) : managedUsersError ? (
                                            <div className="px-4 py-3 text-sm text-rose-600">{managedUsersError}</div>
                                        ) : managedUsers.filter(u => !u.enabled).length === 0 ? (
                                            <div className="px-4 py-3 text-sm text-slate-500">暂无待审批账号</div>
                                        ) : (
                                            managedUsers.filter(u => !u.enabled).map(u => (
                                                <div key={u.id} className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="font-medium text-sm text-slate-700 truncate">{u.email}</div>
                                                        <div className="text-xs text-slate-500 mt-1">{u.name || '未填写姓名'} · {u.projectId || '未绑定园区'} · {u.role}</div>
                                                    </div>
                                                    <button onClick={() => handleApproveManagedUser(u, true)} className="px-3 py-1.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700">审批通过</button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                                        <div className="text-sm font-semibold text-slate-700">已启用登录账号</div>
                                        <div className="text-xs text-slate-400">
                                            {managedUsers.filter((u) => u.enabled).length} 个
                                        </div>
                                    </div>
                                    <div className="max-h-72 overflow-y-auto">
                                        {isLoadingManagedUsers ? (
                                            <div className="px-4 py-3 text-sm text-slate-500">正在加载...</div>
                                        ) : managedUsers.filter((u) => u.enabled).length === 0 ? (
                                            <div className="px-4 py-3 text-sm text-slate-500">暂无已启用账号</div>
                                        ) : (
                                            managedUsers
                                                .filter((u) => u.enabled)
                                                .map((u) => (
                                                    <div
                                                        key={u.id}
                                                        className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2"
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="font-medium text-sm text-slate-800 truncate">
                                                                {u.email}
                                                            </div>
                                                            <div className="text-xs text-slate-500 mt-0.5">
                                                                {u.name || '未填姓名'} · {u.role} · 默认{' '}
                                                                {u.projectId || '—'} · 可访问{' '}
                                                                {u.allowedProjectIds.length
                                                                    ? u.allowedProjectIds.join('、')
                                                                    : '—'}
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-wrap gap-1.5 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => openUserManageModal(u)}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
                                                            >
                                                                <Pencil size={12} /> 编辑
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => openUserManageModal(u)}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                                            >
                                                                <UserCog size={12} /> 权限
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    if (
                                                                        !window.confirm(
                                                                            `确定删除登录账号「${u.email}」？\n该账号将无法登录，关联的「已审批通过」申请记录也会一并清理。`
                                                                        )
                                                                    ) {
                                                                        return;
                                                                    }
                                                                    void (async () => {
                                                                        const res = await deleteManagedCloudUser(
                                                                            u.id,
                                                                            authUser?.id
                                                                        );
                                                                        if (!res.success) {
                                                                            alert(res.message || '删除失败');
                                                                            return;
                                                                        }
                                                                        await Promise.all([
                                                                            loadManagedUsers(),
                                                                            loadSignupRequests(),
                                                                        ]);
                                                                        alert(res.message || '已删除账号');
                                                                    })();
                                                                }}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-rose-200 text-rose-700 hover:bg-rose-50"
                                                            >
                                                                <Trash2 size={12} /> 删除
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))
                                        )}
                                    </div>
                                </div>

                                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                                        <div className="text-sm font-semibold text-slate-700">注册申请审批（姓名/邮箱/密码/园区）</div>
                                        <div className="text-xs text-slate-400">{signupRequests.filter(r => r.status === 'pending').length} 条待审批</div>
                                    </div>
                                    <div className="max-h-72 overflow-y-auto">
                                        {isLoadingSignupRequests ? (
                                            <div className="px-4 py-3 text-sm text-slate-500">正在加载注册申请...</div>
                                        ) : signupRequestsError ? (
                                            <div className="px-4 py-3 text-sm text-rose-600">{signupRequestsError}</div>
                                        ) : signupRequests.filter(r => r.status === 'pending').length === 0 ? (
                                            <div className="px-4 py-3 text-sm text-slate-500">暂无待审批注册申请</div>
                                        ) : (
                                            signupRequests.filter(r => r.status === 'pending').map(req => (
                                                <div key={req.id} className="px-4 py-3 border-t border-slate-100 space-y-2">
                                                    <div className="text-sm font-semibold text-slate-700">{req.applicantName || '（未填姓名）'}</div>
                                                    <div className="text-xs text-slate-600">邮箱：{req.email}</div>
                                                    <div className="text-xs text-slate-600">密码：{req.password || '（未填写）'}</div>
                                                    <div className="text-xs text-slate-600">申请园区：{req.requestedProjectIds.length ? req.requestedProjectIds.join('、') : '无'}</div>
                                                    <div className="flex justify-end">
                                                        <button onClick={() => handleApproveSignupRequest(req)} className="px-3 py-1.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700">审批通过并创建账号</button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                    <div className="px-4 py-3 border-b border-slate-100">
                                        <div className="text-sm font-semibold text-slate-700">已审批通过的人员清单</div>
                                        <div className="text-xs text-slate-400 mt-0.5">按申请园区分别列出（同一人在多个园区申请则各园区各显示一条）</div>
                                    </div>
                                    <div className="max-h-96 overflow-y-auto">
                                        {isLoadingSignupRequests ? (
                                            <div className="px-4 py-3 text-sm text-slate-500">正在加载...</div>
                                        ) : signupRequestsError ? (
                                            <div className="px-4 py-3 text-sm text-rose-600">{signupRequestsError}</div>
                                        ) : approvedSignupByPark.parkOrder.length === 0 ? (
                                            <div className="px-4 py-3 text-sm text-slate-500">暂无通过线上注册审批的人员</div>
                                        ) : (
                                            approvedSignupByPark.parkOrder.map((projectId) => {
                                                  const parkTitle =
                                                      authorizedParks.find((p) => p.projectId === projectId)?.name || projectId;
                                                  const rows = approvedSignupByPark.byPark.get(projectId) || [];
                                                  return (
                                                      <div key={projectId} className="border-t border-slate-200 first:border-t-0">
                                                          <div className="px-4 py-2 bg-slate-50 text-sm font-medium text-slate-800">
                                                              {parkTitle}
                                                              <span className="text-slate-400 font-normal ml-1">({projectId})</span>
                                                          </div>
                                                          {rows.map((req) => {
                                                              const linked =
                                                                  req.approvedUserId
                                                                      ? managedUsers.find((x) => x.id === req.approvedUserId)
                                                                      : managedUsers.find(
                                                                            (x) =>
                                                                                x.email.trim().toLowerCase() ===
                                                                                req.email.trim().toLowerCase()
                                                                        );
                                                              const orphan = !linked;
                                                              return (
                                                                  <div
                                                                      key={`${req.id}-${projectId}`}
                                                                      className="px-4 py-2.5 border-t border-slate-100 text-sm"
                                                                  >
                                                                      <div className="font-medium text-slate-800">
                                                                          {req.applicantName || '（未填姓名）'}
                                                                      </div>
                                                                      <div className="text-xs text-slate-600 mt-0.5">
                                                                          邮箱：{req.email}
                                                                      </div>
                                                                      <div className="text-xs text-slate-500 mt-0.5">
                                                                          审批时间：
                                                                          {req.approvedAt
                                                                              ? new Date(req.approvedAt).toLocaleString()
                                                                              : '—'}
                                                                      </div>
                                                                      <div className="flex flex-wrap gap-1.5 mt-2 justify-end">
                                                                          {linked && (
                                                                              <>
                                                                                  <button
                                                                                      type="button"
                                                                                      onClick={() => openUserManageModal(linked)}
                                                                                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
                                                                                  >
                                                                                      <Pencil size={11} /> 编辑
                                                                                  </button>
                                                                                  <button
                                                                                      type="button"
                                                                                      onClick={() => openUserManageModal(linked)}
                                                                                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                                                                  >
                                                                                      <UserCog size={11} /> 权限
                                                                                  </button>
                                                                                  <button
                                                                                      type="button"
                                                                                      onClick={() => {
                                                                                          if (
                                                                                              !window.confirm(
                                                                                                  `确定删除登录账号「${linked.email}」？\n关联的审批/申请记录也将一并清理。`
                                                                                              )
                                                                                          ) {
                                                                                              return;
                                                                                          }
                                                                                          void (async () => {
                                                                                              const res =
                                                                                                  await deleteManagedCloudUser(
                                                                                                      linked.id,
                                                                                                      authUser?.id
                                                                                                  );
                                                                                              if (!res.success) {
                                                                                                  alert(res.message || '删除失败');
                                                                                                  return;
                                                                                              }
                                                                                              await Promise.all([
                                                                                                  loadManagedUsers(),
                                                                                                  loadSignupRequests(),
                                                                                              ]);
                                                                                              alert(res.message || '已删除账号');
                                                                                          })();
                                                                                      }}
                                                                                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-rose-200 text-rose-700 hover:bg-rose-50"
                                                                                  >
                                                                                      <Trash2 size={11} /> 删除账号
                                                                                  </button>
                                                                              </>
                                                                          )}
                                                                          <button
                                                                              type="button"
                                                                              onClick={() => void handleDeleteSignupRequest(req)}
                                                                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-amber-200 text-amber-700 hover:bg-amber-50"
                                                                              title="仅清理审批/申请记录，不影响已创建账号"
                                                                          >
                                                                              <Trash2 size={11} /> 清理审批记录
                                                                          </button>
                                                                      </div>
                                                                      {orphan && (
                                                                          <div className="text-[11px] text-amber-600 mt-2">
                                                                              已绑定用户 ID 但 users 表中已无该记录（账号已被删除或未授权可见）。可点击「清理审批记录」移除该条孤立条目。
                                                                          </div>
                                                                      )}
                                                                  </div>
                                                              );
                                                          })}
                                                      </div>
                                                  );
                                              })
                                        )}
                                    </div>
                                </div>

                                {userManageTarget && (
                                    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40">
                                        <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <h4 className="font-bold text-slate-800 text-sm">管理登录账号</h4>
                                                    <p className="text-xs text-slate-500 mt-0.5 break-all">{userManageTarget.email}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    aria-label="关闭"
                                                    className="p-1 rounded hover:bg-slate-100 text-slate-500"
                                                    onClick={() => setUserManageTarget(null)}
                                                >
                                                    <X size={18} />
                                                </button>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 mb-1">姓名</label>
                                                <input
                                                    className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm"
                                                    value={userManageForm.name}
                                                    onChange={(e) =>
                                                        setUserManageForm((p) => ({ ...p, name: e.target.value }))
                                                    }
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 mb-1">角色</label>
                                                <select
                                                    className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm"
                                                    value={userManageForm.role}
                                                    onChange={(e) =>
                                                        setUserManageForm((p) => ({
                                                            ...p,
                                                            role: e.target.value as UserRole,
                                                        }))
                                                    }
                                                >
                                                    <option value="park_user">普通用户（park_user）</option>
                                                    <option value="park_admin">园区管理员（park_admin）</option>
                                                    <option value="group_admin">集团管理员（group_admin）</option>
                                                    <option value="platform_admin">平台管理员（platform_admin）</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 mb-1">
                                                    默认园区 project_id
                                                </label>
                                                <input
                                                    className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm font-mono"
                                                    value={userManageForm.projectId}
                                                    onChange={(e) =>
                                                        setUserManageForm((p) => ({ ...p, projectId: e.target.value }))
                                                    }
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 mb-1">
                                                    可访问园区（含默认园区）
                                                </label>
                                                <div className="space-y-2 border border-slate-100 rounded-lg p-3 bg-slate-50/80 max-h-40 overflow-y-auto">
                                                    {(authorizedParks.length ? authorizedParks : []).map((park) => (
                                                        <label
                                                            key={park.projectId}
                                                            className="flex items-center gap-2 text-sm text-slate-700"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={userManageForm.allowedParkIds.includes(
                                                                    park.projectId
                                                                )}
                                                                onChange={(e) =>
                                                                    toggleUserManagePark(park.projectId, e.target.checked)
                                                                }
                                                            />
                                                            <span>
                                                                {park.name}{' '}
                                                                <span className="text-slate-400">({park.projectId})</span>
                                                            </span>
                                                        </label>
                                                    ))}
                                                    {authorizedParks.length === 0 && (
                                                        <p className="text-xs text-amber-600">
                                                            当前未加载园区目录，可直接保存默认园区；完整多选需先能拉取 pb_parks。
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <label className="flex items-center gap-2 text-sm text-slate-600">
                                                <input
                                                    type="checkbox"
                                                    checked={userManageForm.enabled}
                                                    onChange={(e) =>
                                                        setUserManageForm((p) => ({ ...p, enabled: e.target.checked }))
                                                    }
                                                />
                                                账号已启用（可登录）
                                            </label>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 mb-1">
                                                    新密码（留空表示不修改，至少 8 位）
                                                </label>
                                                <input
                                                    type="password"
                                                    className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm"
                                                    value={userManageForm.password}
                                                    onChange={(e) =>
                                                        setUserManageForm((p) => ({ ...p, password: e.target.value }))
                                                    }
                                                    placeholder="不修改请留空"
                                                    autoComplete="new-password"
                                                />
                                            </div>
                                            <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-slate-100">
                                                <button
                                                    type="button"
                                                    className="px-3 py-2 text-sm rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                                                    onClick={() => setUserManageTarget(null)}
                                                >
                                                    取消
                                                </button>
                                                <button
                                                    type="button"
                                                    className="px-3 py-2 text-sm rounded border border-rose-200 text-rose-700 hover:bg-rose-50"
                                                    disabled={userManageSaving}
                                                    onClick={() => void handleDeleteUserManageModal()}
                                                >
                                                    删除账号
                                                </button>
                                                <button
                                                    type="button"
                                                    className="px-3 py-2 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                                                    disabled={userManageSaving}
                                                    onClick={() => void handleSaveUserManageModal()}
                                                >
                                                    {userManageSaving ? '保存中…' : '保存'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
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
                                             sessionStorage.setItem('ai_config', JSON.stringify(aiConfig));
                                             // 验证保存
                                             const saved = sessionStorage.getItem('ai_config');
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
                     <div className="p-4 md:p-6 bg-slate-50/50"><h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><Database size={18} /> 本地数据管理</h3><div className="space-y-3"><div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg"><div><div className="text-sm font-medium text-slate-700">导出当前园区备份 (JSON)</div><div className="text-xs text-slate-400">导出文件会写入 project_id={cloudConfig.projectId}，用于后续隔离恢复</div></div><button onClick={handleExport} className="px-3 py-1.5 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded text-xs font-medium transition-colors">导出</button></div><div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg"><div><div className="text-sm font-medium text-slate-700">导入到当前园区</div><div className="text-xs text-slate-400">上传前校验备份 project_id；旧格式文件需要确认目标园区，只恢复到 {cloudConfig.projectId}</div></div><label className="px-3 py-1.5 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded text-xs font-medium transition-colors cursor-pointer">选择文件<input type="file" className="hidden" accept=".json" onChange={handleImport} /></label></div><div className="flex items-center justify-between p-3 bg-rose-50 border border-rose-100 rounded-lg"><div><div className="text-sm font-medium text-rose-700">重置当前园区本地缓存</div><div className="text-xs text-rose-400">只清除当前园区浏览器缓存，不影响其他园区与后端</div></div><button onClick={handleResetData} className="px-3 py-1.5 text-rose-600 bg-white border border-rose-200 hover:bg-rose-100 rounded text-xs font-medium transition-colors">重置</button></div></div></div>
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
                      <div className="space-y-2">
                        <div>
                          <label className="block text-sm text-slate-600 mb-1">年初预算 (元)</label>
                          <div className="flex gap-2">
                            <input type="number" className="flex-1 border rounded-lg p-2 text-lg font-semibold" value={targetForm.initialBudget || ''} placeholder="可手填或从预算方案导入" onChange={e => setTargetForm({...targetForm, initialBudget: Number(e.target.value)})} />
                            <button
                              onClick={() => {
                                if (!data) return;
                                const activeScenario = (data.budgetScenarios || []).find(s => s.isActive && (s.budgetYear || new Date().getFullYear()) === selectedYear);
                                if (!activeScenario) { alert(`未找到 ${selectedYear} 年的生效预算方案，请先在预算管理中激活方案。`); return; }
                                // 使用预算方案快照中的租户/楼宇数据（与仪表盘口径一致）
                                const snapshotTenants = activeScenario.baseDataSnapshot?.tenants || data.tenants || [];
                                const snapshotBuildings = activeScenario.baseDataSnapshot?.buildings || data.buildings || [];
                                const assumptions = activeScenario.assumptions || [];
                                const adjustments = activeScenario.adjustments || [];
                                const virtualTenants = getVirtualTenants(snapshotTenants, snapshotBuildings, assumptions);
                                const allTenants = [...snapshotTenants, ...virtualTenants];
                                let total = 0;
                                const yearStart = new Date(selectedYear, 0, 1);
                                const yearEnd = new Date(selectedYear, 11, 31);
                                allTenants.forEach(t => {
                                  if (t.isSpecialBusiness) return;
                                  const bills = generateBudgetedBills(t, assumptions, adjustments, new Date(selectedYear - 1, 0, 1), new Date(selectedYear + 1, 11, 31));
                                  bills.forEach(b => {
                                    if (b.date >= yearStart && b.date <= yearEnd) total += b.amount;
                                  });
                                });
                                setTargetForm(prev => ({ ...prev, initialBudget: Math.round(total) }));
                              }}
                              className="px-3 py-2 bg-sky-100 text-sky-700 rounded-lg text-sm hover:bg-sky-200 whitespace-nowrap"
                              title="从当年生效预算方案自动汇总全年应收"
                            >
                              从预算方案导入
                            </button>
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            导入将汇总当年生效预算方案中全部租户（含虚拟租户）的全年预计应收
                          </div>
                        </div>
                      </div>
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
                      <div className="flex items-center gap-4 flex-wrap">
                          <h3 className="text-xl font-bold text-slate-800">系统数据初始化录入</h3>
                          <div className="flex bg-slate-100 rounded-lg p-1">
                              <button onClick={() => handleInitYearChange(2023)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${initDataYear === 2023 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>2023年</button>
                              <button onClick={() => handleInitYearChange(2024)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${initDataYear === 2024 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>2024年</button>
                              <button onClick={() => handleInitYearChange(2025)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${initDataYear === 2025 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>2025年</button>
                              <button onClick={() => handleInitYearChange(2026)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${initDataYear === 2026 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>2026年</button>
                          </div>
                          <button
                              onClick={() => {
                                  if (!data) return;
                                  const activeScenario = (data.budgetScenarios || []).find(s => s.isActive && (s.budgetYear || new Date().getFullYear()) === initDataYear);
                                  if (!activeScenario) { alert(`未找到 ${initDataYear} 年的生效预算方案，请先在预算管理中激活方案。`); return; }
                                  // 使用预算方案快照中的租户/楼宇数据（与仪表盘口径一致）
                                  const snapshotTenants = activeScenario.baseDataSnapshot?.tenants || data.tenants || [];
                                  const snapshotBuildings = activeScenario.baseDataSnapshot?.buildings || data.buildings || [];
                                  const assumptions = activeScenario.assumptions || [];
                                  const adjustments = activeScenario.adjustments || [];
                                  const virtualTenants = getVirtualTenants(snapshotTenants, snapshotBuildings, assumptions);
                                  const allTenants = [...snapshotTenants, ...virtualTenants];
                                  // 按月汇总，填入 tempInitData
                                  const updated = tempInitData.map(row => ({ ...row }));
                                  for (let m = 1; m <= 12; m++) {
                                      const monthStart = new Date(initDataYear, m - 1, 1);
                                      const monthEnd = new Date(initDataYear, m, 0);
                                      let monthTotal = 0;
                                      allTenants.forEach(t => {
                                          if (t.isSpecialBusiness) return;
                                          const bills = generateBudgetedBills(t, assumptions, adjustments, new Date(initDataYear - 1, 0, 1), new Date(initDataYear + 1, 11, 31));
                                          bills.forEach(b => {
                                              if (b.date >= monthStart && b.date <= monthEnd) monthTotal += b.amount;
                                          });
                                      });
                                      const entry = updated.find(r => r.month === m);
                                      if (entry) entry.initialBudget = Math.round(monthTotal);
                                  }
                                  setTempInitData(updated);
                              }}
                              className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-xs hover:bg-amber-200 whitespace-nowrap font-medium"
                          >
                              从生效预算方案导入年初预算
                          </button>
                      </div>
                      <button onClick={() => setIsInitDataModalOpen(false)}><X size={24} className="text-slate-400 hover:text-slate-600"/></button>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                      <table className="w-full text-sm text-left">
                          <thead className="bg-slate-50 text-slate-600 font-bold">
                              <tr>
                                  <th className="p-4 border-b border-slate-200 w-20">月份</th>
                                  <th className="p-4 border-b border-slate-200 bg-amber-50/50">年初预算 (￥)</th>
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
                                      <td className="p-4 bg-amber-50/20">
                                          <div className="relative">
                                              <span className="absolute left-3 top-2.5 text-amber-500 text-xs">¥</span>
                                              <input
                                                  type="number"
                                                  className="w-full pl-6 pr-3 py-2 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-100 outline-none font-mono"
                                                  value={row.initialBudget || ''}
                                                  onChange={(e) => updateTempInitData(row.month, 'initialBudget', Number(e.target.value))}
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

      <ConflictDialog
        open={pendingConflicts.length > 0}
        conflicts={pendingConflicts}
        onClose={() => setPendingConflicts([])}
        onResolve={async (decisions) => {
            await handleResolveConflict(decisions);
        }}
      />
    </div>
    </DirtyTrackerProvider>
  );
};

export default App;
