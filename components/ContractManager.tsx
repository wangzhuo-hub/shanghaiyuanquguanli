
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Tenant,
  Building,
  BudgetAssumption,
  BudgetAdjustment,
  ContractStatus,
  DepositStatus,
  RentFreePeriod,
  RentFreeDeductionMode,
  FixedRentReduction,
  UnitStatus,
  DashboardData,
  PaymentRecord,
  LeaseUnitTerm,
  AuthUser,
  CloudConfig,
} from '../types';
// Added missing UserMinus and Sparkles imports
import { Search, Plus, FileText, Filter, XCircle, AlertTriangle, AlertCircle, Calendar, DollarSign, Edit2, X, Trash2, Users, Save, Building as BuildingIcon, UserCheck, UserPlus, UserMinus, UserX, Info, ShieldAlert, WalletIcon, ArrowLeft, ArrowLeftRight, Trash, TrendingUp, TrendingDown, PieChart, Activity, BarChart3, Clock, LayoutDashboard, ArrowUpRight, ArrowDownRight, Sparkles, Briefcase, User, Smartphone, Gift, MapPin, Receipt, CreditCard, ChevronLeft, ChevronRight, RotateCcw, LayoutGrid, Rows3, Download, Upload } from 'lucide-react';
import {
    type BudgetedBill,
} from '../services/billingService';
import { createBudgetedBillCache, type BillGenerationCache } from '../services/billGenerationCache';
import {
    buildVacancyBudgetAlignmentNote,
    computeEarlyTerminationFreeRentClawbackAmount,
    parseDateLocal,
    resolveRentUnitPriceForDisplay,
} from '../services/billingLightweight';
import {
    fetchCloudBudgetedBillsPreview,
    fetchCloudBudgetedBillsPreviewBatch,
    fetchCloudContractAnalysisMetrics,
} from '../services/cloudComputeClient';
import {
    shouldRunLocalBudgetedBillPreviewFallback,
    shouldRunLocalContractAnalysisMetricsFallback,
} from '../services/computeFallbackPolicy';
import { indexBudgetedBillPreviewBatchResult } from '../services/budgetedBillPreviewBatch';
import { VirtualizedTable } from './VirtualizedTable';
import { formatArea, formatCurrency, formatPercent } from '../services/numberFormat';
import { paymentCycleLabelMap } from '../services/sharedUtils';
import { isManagementFeeBillingEnabled } from '../services/parkBillingConfig';
import { canViewRentPricing } from '../services/receivablePermissions';
import { buildRenewalContractDraft } from '../services/contractRenewal';
import {
    generateManagementFeeBills,
    getManagementFeeCardStatus,
    resolveLeaseOccupancyDate,
    resolveManagementFeeMonthly,
    shouldGenerateManagementFeeBills,
    toManagementFeeMonthlyUnitPrice,
} from '../services/managementFeeBillingService';
import { excelSerialDateToYMD, readFirstSheetRows, writeXlsxRows, writeXlsxWorkbook } from '../services/xlsxLoader';
import { EMPTY_TENANT_ASSET_LOOKUP, buildTenantAssetLookup, resolveTenantAssetDisplay } from '../services/tenantAssetDisplay';
import type { ContractAnalysisMetrics } from '../services/contractAnalysisMetrics';
import { buildExpiringContractView, filterContractListTenants, shouldBuildContractAssetLookup } from '../services/contractListFilters';

const ContractDashboardTrendCharts = React.lazy(() =>
    import('./ContractAnalysisCharts').then((m) => ({ default: m.ContractDashboardTrendCharts }))
);
const ContractAreaChangeChart = React.lazy(() =>
    import('./ContractAnalysisCharts').then((m) => ({ default: m.ContractAreaChangeChart }))
);
const ContractTerminationTypeChart = React.lazy(() =>
    import('./ContractAnalysisCharts').then((m) => ({ default: m.ContractTerminationTypeChart }))
);
const SourceAnalysisDashboard = React.lazy(() =>
    import('./SourceAnalysisDashboard').then((m) => ({ default: m.SourceAnalysisDashboard }))
);
const AIContractRecognitionModal = React.lazy(() =>
    import('./AIContractRecognitionModal').then((m) => ({ default: m.AIContractRecognitionModal }))
);
const NameChangeDialog = React.lazy(() =>
    import('./NameChangeDialog').then((m) => ({ default: m.NameChangeDialog }))
);
const PaymentCycleChangeDialog = React.lazy(() =>
    import('./PaymentCycleChangeDialog').then((m) => ({ default: m.PaymentCycleChangeDialog }))
);

interface ContractManagerProps {
  tenants: Tenant[];
  buildings: Building[];
  onUpdateTenants: (tenants: Tenant[]) => void;
  dashboardData?: DashboardData; // 新增：用于图表数据
  payments?: PaymentRecord[]; // 新增：用于关联实际收款
  onUpdatePayments?: (payments: PaymentRecord[]) => void; // 新增：用于更新收款记录
  budgetAdjustments?: BudgetAdjustment[];
  onUpdateAdjustments?: (newAdjustments: BudgetAdjustment[]) => void;
  /** 手机窄屏：隐藏经营分析，默认进入在租列表便于录入合同 */
  mobileEntryMode?: boolean;
  /** 手机管理员：仅查询合同，不显示新签、导入、续签、退租等办理入口 */
  mobileQueryOnly?: boolean;
  authUser?: AuthUser | null;
  projectId?: string;
  cloudConfig?: CloudConfig;
  serverComputeEnabled?: boolean;
  mobileFocusTenantId?: string;
  mobileFocusTenantName?: string;
  mobileFocusRequestId?: number;
}

type ContractDesktopRow =
  | { kind: 'building'; key: string; buildingName: string; count: number }
  | { kind: 'floor'; key: string; floorLabel: string; count: number }
  | { kind: 'year'; key: string; year: number; count: number }
  | { kind: 'tenant'; key: string; tenant: Tenant };

type ContractPerfData = ContractAnalysisMetrics;

const contractStatusTextMap: Record<ContractStatus, string> = {
  [ContractStatus.Active]: '履约中',
  [ContractStatus.Expiring]: '即将到期',
  [ContractStatus.Terminated]: '已退租',
  [ContractStatus.Pending]: '签约中',
  [ContractStatus.Expired]: '已到期',
};

const MOBILE_CONTRACT_CARD_VISIBILITY_STYLE = {
  contentVisibility: 'auto',
  containIntrinsicSize: '0 168px',
} as React.CSSProperties;

const ContractMobileEmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}> = ({ icon, title, detail, action }) => (
  <div className="liquid-mobile-empty-state mx-3 my-4 rounded-[24px] px-4 py-7 text-center">
    <div className="liquid-icon-well mx-auto flex h-12 w-12 items-center justify-center rounded-[20px] text-blue-700">
      {icon}
    </div>
    <div className="mt-3 text-base font-black text-slate-950">{title}</div>
    <p className="mx-auto mt-1 max-w-xs text-sm font-semibold leading-5 text-slate-500">{detail}</p>
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);

const EMPTY_CONTRACT_PERF_DATA: ContractPerfData = {
  metrics: {
    signedCount: 0,
    signedArea: 0,
    terminatedCount: 0,
    terminatedArea: 0,
    netArea: 0,
  },
  mom: { area: 0, count: 0 },
  yoy: { area: 0, count: 0 },
  reasons: [],
  earlyRate: 0,
  trend: [],
  terminationStats: {
    all: 0,
    year: 0,
    quarter: 0,
    month: 0,
    earlyCount: 0,
    normalCount: 0,
  },
  terminationTypeData: [],
};

/** 在租明细可发起续签：履约中 / 即将到期 / 签约中（续签链上的新合同常为 Pending） */
const canRenewContract = (t: Tenant) =>
  t.status === ContractStatus.Active ||
  t.status === ContractStatus.Expiring ||
  t.status === ContractStatus.Pending;

const paymentCycleMonthMap: Record<Tenant['paymentCycle'], number> = {
  HalfMonthly: 0.5,
  Monthly: 1,
  BiMonthly: 2,
  Quarterly: 3,
  SemiAnnual: 6,
  Annual: 12,
  Custom: 3,
};

const renderManagementFeeTags = (t: Tenant, projectIdFallback?: string) => {
    const m = getManagementFeeCardStatus(t, projectIdFallback);
    if (!m.parkEnabled) return null;
    if (m.collecting) {
        return (
            <span
                className="inline-flex items-center gap-0.5 rounded-full border border-cyan-200/80 bg-cyan-50/85 px-1.5 py-0.5 text-xs font-black text-cyan-700 lg:text-[10px]"
                title={
                    m.monthlyUnitPrice
                        ? `物业费 ${m.monthlyUnitPrice} 元/月/㎡，月物业费约 ${m.monthlyAmount.toLocaleString()} 元`
                        : `月物业费约 ${m.monthlyAmount.toLocaleString()} 元`
                }
            >
                <WalletIcon size={10} /> 收取物业费
            </span>
        );
    }
    if (m.exempt) {
        return (
            <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-600 lg:text-[10px]">
                全免物业费
            </span>
        );
    }
    if (m.disabled) {
        return (
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-bold text-slate-500 lg:text-[10px]">
                不收物业费
            </span>
        );
    }
    if (m.needsSetup) {
        return (
            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-bold text-amber-800 lg:text-[10px]">
                需配置物业费
            </span>
        );
    }
    return null;
};

const renderManagementFeeCardFields = (t: Tenant, projectIdFallback?: string) => {
    const m = getManagementFeeCardStatus(t, projectIdFallback);
    if (!m.parkEnabled || (!m.collecting && !m.needsSetup)) return null;
    return (
        <>
            <div>
                <div className="text-[10px] text-slate-400 font-medium">物业费单价</div>
                <div className="text-cyan-700 font-bold tabular-nums">
                    {m.monthlyUnitPrice != null && m.monthlyUnitPrice > 0 ? (
                        <>
                            ¥{m.monthlyUnitPrice.toFixed(2)}
                            <span className="text-[10px] font-normal text-slate-400 ml-0.5">/㎡·月</span>
                        </>
                    ) : (
                        <span className="text-amber-700 text-[11px] font-medium">待填写</span>
                    )}
                </div>
            </div>
            <div>
                <div className="text-[10px] text-slate-400 font-medium">月物业费</div>
                <div className="text-cyan-800 font-bold tabular-nums">
                    {m.monthlyAmount > 0 ? `¥${m.monthlyAmount.toLocaleString()}` : '—'}
                </div>
            </div>
        </>
    );
};

type ContractPromptTone = 'blue' | 'cyan' | 'amber' | 'rose' | 'slate';

type ContractPromptState = {
  kind: 'notice' | 'confirm';
  title: string;
  message?: string;
  tone?: ContractPromptTone;
  confirmText?: string;
  cancelText?: string;
  resolve?: (result?: boolean) => void;
};

const contractPromptGhostButtonClass = 'liquid-glass-control liquid-pressable inline-flex min-h-10 items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-black text-slate-600 disabled:pointer-events-none disabled:opacity-45';

const contractPromptToneClass = (tone: ContractPromptTone = 'blue'): string => {
  switch (tone) {
    case 'cyan':
      return 'border-cyan-200/80 bg-cyan-50/78 text-cyan-800';
    case 'amber':
      return 'border-amber-200/80 bg-amber-50/82 text-amber-900';
    case 'rose':
      return 'border-rose-200/80 bg-rose-50/82 text-rose-800';
    case 'slate':
      return 'border-slate-200/80 bg-white/82 text-slate-700';
    default:
      return 'border-blue-200/80 bg-blue-50/78 text-blue-800';
  }
};

const ContractPromptOverlay: React.FC<{
  prompt: ContractPromptState;
  onClose: (result?: boolean) => void;
}> = ({ prompt, onClose }) => {
  const toneClass = contractPromptToneClass(prompt.tone || 'blue');
  const dismissPrompt = React.useCallback(() => {
    onClose(prompt.kind === 'confirm' ? false : true);
  }, [onClose, prompt.kind]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      dismissPrompt();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dismissPrompt]);

  return (
    <div className="liquid-elevated-backdrop fixed inset-0 z-[90] flex items-end justify-center p-0 md:items-center md:p-4" onClick={dismissPrompt}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="contract-prompt-title"
        className="liquid-elevated-panel flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] md:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="liquid-elevated-header flex items-start justify-between gap-3 border-b border-white/60 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`liquid-glass-readable inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${toneClass}`}>
              <AlertCircle size={19} />
            </span>
            <div className="min-w-0">
              <h3 id="contract-prompt-title" className="text-base font-black text-slate-950">{prompt.title}</h3>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">
                {prompt.kind === 'confirm' ? '请确认后继续' : '系统提示'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissPrompt}
            className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:bg-white/75 hover:text-slate-950"
            aria-label="关闭提示"
          >
            <X size={18} />
          </button>
        </div>
        {prompt.message ? (
          <div className="px-5 py-4">
            <div className={`liquid-glass-readable max-h-[52vh] overflow-auto whitespace-pre-line rounded-2xl border px-4 py-3 text-sm font-semibold leading-relaxed ${toneClass}`}>
              {prompt.message}
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2 border-t border-white/60 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:flex md:justify-end md:pb-4">
          {prompt.kind === 'confirm' ? (
            <button type="button" onClick={() => onClose(false)} className={contractPromptGhostButtonClass}>
              {prompt.cancelText || '取消'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onClose(true)}
            className={`${prompt.kind === 'confirm' ? '' : 'col-span-2 '}liquid-action-strong liquid-pressable rounded-2xl px-5 py-2.5 text-sm font-black text-white`}
          >
            {prompt.confirmText || (prompt.kind === 'confirm' ? '确认' : '知道了')}
          </button>
        </div>
      </section>
    </div>
  );
};

export const ContractManager: React.FC<ContractManagerProps> = ({ tenants, buildings, onUpdateTenants, dashboardData, payments = [], onUpdatePayments, budgetAdjustments = [], onUpdateAdjustments, mobileEntryMode = false, mobileQueryOnly = false, authUser = null, projectId: projectIdProp, cloudConfig, serverComputeEnabled = false, mobileFocusTenantId, mobileFocusTenantName, mobileFocusRequestId }) => {
  const isMobileQueryOnly = mobileEntryMode && mobileQueryOnly;
  const viewRentPricing = canViewRentPricing(authUser);
  const [contractPrompt, setContractPrompt] = useState<ContractPromptState | null>(null);
  const showContractNotice = React.useCallback((prompt: Omit<ContractPromptState, 'kind' | 'resolve'>) => (
    new Promise<void>((resolve) => {
      setContractPrompt({
        kind: 'notice',
        confirmText: '知道了',
        tone: 'blue',
        ...prompt,
        resolve: () => resolve(),
      });
    })
  ), []);
  const showContractConfirm = React.useCallback((prompt: Omit<ContractPromptState, 'kind' | 'resolve'>) => (
    new Promise<boolean>((resolve) => {
      setContractPrompt({
        kind: 'confirm',
        confirmText: '确认',
        cancelText: '取消',
        tone: 'amber',
        ...prompt,
        resolve: (result) => resolve(result === true),
      });
    })
  ), []);
  const closeContractPrompt = React.useCallback((result?: boolean) => {
    setContractPrompt((current) => {
      current?.resolve?.(result);
      return null;
    });
  }, []);
  const mgmtFeeParkEnabled = isManagementFeeBillingEnabled(projectIdProp || tenants[0]?.projectId);
  const currentCalendarYear = new Date().getFullYear();
  const billCacheRef = useRef<BillGenerationCache | null>(null);
  const getLocalBillCache = React.useCallback(async (): Promise<BillGenerationCache> => {
    if (billCacheRef.current) return billCacheRef.current;
    const { generateBudgetedBills } = await import('../services/billingService');
    const cache = createBudgetedBillCache({ maxEntries: 360, generateBudgetedBills });
    billCacheRef.current = cache;
    return cache;
  }, []);
  const getCachedBudgetedBills = React.useCallback(async (
    tenant: Tenant,
    assumptions: BudgetAssumption[],
    adjustments: BudgetAdjustment[],
    start: Date,
    end: Date,
    scopeHint: string,
  ) => {
    const cache = await getLocalBillCache();
    return cache.get({ tenant, assumptions, adjustments, start, end, scopeHint });
  }, [getLocalBillCache]);
  const [activeTab, setActiveTab] = useState<'List' | 'Terminated' | 'Analysis' | 'SourceAnalysis' | 'Expiring'>(() =>
    mobileEntryMode ? 'List' : 'Analysis'
  );
  const [analysisPeriod, setAnalysisPeriod] = useState<'Year' | 'Quarter' | 'Month'>('Year');
  const shouldBuildAssetLookup = shouldBuildContractAssetLookup(activeTab);
  const tenantAssetLookup = useMemo(
    () => (shouldBuildAssetLookup ? buildTenantAssetLookup(buildings) : EMPTY_TENANT_ASSET_LOOKUP),
    [buildings, shouldBuildAssetLookup],
  );
  const buildingById = tenantAssetLookup.buildingById;
  const unitNameById = tenantAssetLookup.unitNameById;
  const unitFloorById = tenantAssetLookup.unitFloorById;

  useEffect(() => {
    if (!mobileEntryMode) return;
    if (activeTab === 'Analysis' || activeTab === 'SourceAnalysis') setActiveTab('List');
  }, [mobileEntryMode, activeTab]);

  // 本年度到期客户 — 按季度分组
  const thisYear = new Date().getFullYear();
  const expiringContractView = useMemo(
    () => buildExpiringContractView(tenants, {
      year: thisYear,
      now: new Date(),
      includeGroups: activeTab === 'Expiring',
    }),
    [activeTab, tenants, thisYear],
  );
  const expiringTenantSummary = expiringContractView.summary;
  const expiringByQuarter = expiringContractView.byQuarter;

  const getExpiryUrgency = (leaseEnd: string): 'overdue' | 'thisMonth' | 'nextMonth' | 'later' => {
    const now = new Date();
    const end = new Date(leaseEnd);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    if (end < now) return 'overdue';
    if (end >= thisMonthStart && end < nextMonthStart) return 'thisMonth';
    if (end >= nextMonthStart && end <= nextMonthEnd) return 'nextMonth';
    return 'later';
  };

  
  const [isEditing, setIsEditing] = useState(false);
  const [currentTenant, setCurrentTenant] = useState<Partial<Tenant>>({});
  const [rentInputMode, setRentInputMode] = useState<'byUnitPrice' | 'direct'>('direct');
  const [renewingFromId, setRenewingFromId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBuilding, setFilterBuilding] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPaymentCycle, setFilterPaymentCycle] = useState('all');
  const [showAdjForm, setShowAdjForm] = useState(false);
  const [adjForm, setAdjForm] = useState({
    origMonth: 1,
    targetMonth: 1,
    origBillKey: '',
    targetBillKey: '',
    amount: 0,
    reason: '',
  });
  const adjPreviewContext = useMemo(() => {
    if (!showAdjForm || !currentTenant.leaseStart || !currentTenant.leaseEnd || !currentTenant.monthlyRent || currentTenant.monthlyRent <= 0) {
      return null;
    }
    const inheritedProjectId =
      currentTenant.projectId || tenants.find((t) => (t.projectId || '').trim())?.projectId || '';
    const tenantForPreview = {
      ...currentTenant,
      id: currentTenant.id || 'adj-preview',
      name: currentTenant.name || '预览',
      buildingId: currentTenant.buildingId || '',
      unitIds: currentTenant.unitIds || [],
      totalArea: currentTenant.totalArea || 0,
      leaseStart: currentTenant.leaseStart!,
      leaseEnd: currentTenant.leaseEnd!,
      monthlyRent: currentTenant.monthlyRent!,
      paymentCycle: currentTenant.paymentCycle || 'Quarterly',
      depositAmount: currentTenant.depositAmount ?? 0,
      depositStatus: currentTenant.depositStatus || DepositStatus.Unpaid,
      status: currentTenant.status || ContractStatus.Active,
      rentFreePeriods: currentTenant.rentFreePeriods || [],
      rentReductions: currentTenant.rentReductions || [],
      freeRentHandling: currentTenant.freeRentHandling || 'Deduct',
      firstReceivableAmount: currentTenant.firstReceivableAmount,
      firstReceivableStartDate: currentTenant.firstReceivableStartDate,
      firstReceivableEndDate: currentTenant.firstReceivableEndDate,
      paymentPeriodAdjustments: currentTenant.paymentPeriodAdjustments || [],
      paymentPeriodShiftMonths: currentTenant.paymentPeriodShiftMonths,
      projectId: inheritedProjectId,
    } as Tenant;
    return {
      tenantForPreview,
      previewStart: parseDateLocal(currentTenant.leaseStart),
      previewEnd: parseDateLocal(currentTenant.leaseEnd),
    };
  }, [showAdjForm, currentTenant, tenants]);
  const [adjPreviewState, setAdjPreviewState] = useState<{ loading: boolean; bills: BudgetedBill[]; error?: string }>({
    loading: false,
    bills: [],
  });

  useEffect(() => {
    if (!adjPreviewContext) {
      setAdjPreviewState({ loading: false, bills: [] });
      return;
    }

    const localPreview = async () => ({
      loading: false,
      bills: await getCachedBudgetedBills(
        adjPreviewContext.tenantForPreview,
        [],
        [],
        adjPreviewContext.previewStart,
        adjPreviewContext.previewEnd,
        `contract-manager:adjustment-preview:${adjPreviewContext.tenantForPreview.id}`,
      ),
    });

    const canUseServer = serverComputeEnabled && !!cloudConfig;
    let cancelled = false;
    if (!canUseServer || !cloudConfig) {
      if (!shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: false })) {
        setAdjPreviewState({
          loading: false,
          bills: [],
          error: '后台收款日列表计算不可用，未执行前端本地重算。',
        });
        return;
      }
      setAdjPreviewState((prev) => ({ ...prev, loading: true, error: undefined }));
      localPreview()
        .then((state) => {
          if (!cancelled) setAdjPreviewState(state);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setAdjPreviewState({
              loading: false,
              bills: [],
              error: error instanceof Error ? error.message : '本地收款日列表计算模块加载失败。',
            });
          }
        });
      return () => {
        cancelled = true;
      };
    }

    setAdjPreviewState((prev) => ({ ...prev, loading: true, error: undefined }));
    fetchCloudBudgetedBillsPreview(cloudConfig, {
      tenant: adjPreviewContext.tenantForPreview,
      assumptions: [],
      adjustments: [],
      startDate: adjPreviewContext.previewStart,
      endDate: adjPreviewContext.previewEnd,
    }).then((result) => {
      if (cancelled) return;
      if (result.success && result.bills) {
        setAdjPreviewState({ loading: false, bills: result.bills });
        return;
      }
      if (shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: true })) {
        localPreview().then((state) => {
          if (!cancelled) setAdjPreviewState(state);
        });
        return;
      }
      setAdjPreviewState({
        loading: false,
        bills: [],
        error: result.message || '后台收款日列表计算失败，未执行前端本地重算。',
      });
    }).catch((error: unknown) => {
      if (!cancelled) {
        if (shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: true })) {
          localPreview().then((state) => {
            if (!cancelled) setAdjPreviewState(state);
          });
          return;
        }
        setAdjPreviewState({
          loading: false,
          bills: [],
          error: error instanceof Error ? error.message : '后台收款日列表计算失败，未执行前端本地重算。',
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [adjPreviewContext, authUser?.enabled, cloudConfig, getCachedBudgetedBills]);
  const adjPreviewBills = adjPreviewState.bills;
  const [batchSelectedContractIds, setBatchSelectedContractIds] = useState<Set<string>>(() => new Set());
  const [tabletPreviewTenantId, setTabletPreviewTenantId] = useState<string | null>(null);
  useEffect(() => {
    if (!mobileEntryMode || !mobileFocusTenantId) return;
    const focusedTenant = tenants.find((tenant) => tenant.id === mobileFocusTenantId);
    const nextSearch = (focusedTenant?.name || mobileFocusTenantName || '').trim();
    setActiveTab(focusedTenant?.status === ContractStatus.Terminated ? 'Terminated' : 'List');
    setSearchTerm(nextSearch);
    setFilterBuilding('all');
    setFilterStatus('all');
    setFilterPaymentCycle('all');
    setTabletPreviewTenantId(mobileFocusTenantId);
  }, [mobileEntryMode, mobileFocusRequestId, mobileFocusTenantId, mobileFocusTenantName, tenants]);
  /**
   * 在租明细布局：'Card'（卡片，按楼栋→楼层；含账期 ◀▶ 微调按钮，默认）
   * 或 'Table'（表格，原列表样式）。本地保存到 localStorage。
   */
  const [listLayoutMode, setListLayoutMode] = useState<'Card' | 'Table'>(() => {
    if (typeof window === 'undefined') return 'Card';
    const saved = window.localStorage.getItem('contractListLayoutMode');
    return saved === 'Table' ? 'Table' : 'Card';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('contractListLayoutMode', listLayoutMode);
  }, [listLayoutMode]);
  // 应收明细预览：是否叠加预算假设/调整（与「预算管理 → 预算表」口径对齐）
  const [previewApplyBudget, setPreviewApplyBudget] = useState<boolean>(true);
  const receivablePreviewContext = useMemo(() => {
    if (!currentTenant.leaseStart || !currentTenant.leaseEnd || !currentTenant.monthlyRent || currentTenant.monthlyRent <= 0) {
      return null;
    }

    const inheritedProjectId =
      currentTenant.projectId ||
      tenants.find((t) => (t.projectId || '').trim())?.projectId ||
      '';
    const tenantForPreview: Tenant = {
      ...currentTenant,
      id: currentTenant.id || 'preview',
      name: currentTenant.name || '预览',
      buildingId: currentTenant.buildingId || '',
      unitIds: currentTenant.unitIds || [],
      totalArea: currentTenant.totalArea || 0,
      leaseStart: currentTenant.leaseStart,
      leaseEnd: currentTenant.leaseEnd,
      monthlyRent: currentTenant.monthlyRent,
      paymentCycle: currentTenant.paymentCycle || 'Quarterly',
      depositAmount: currentTenant.depositAmount || 0,
      depositStatus: currentTenant.depositStatus || DepositStatus.Unpaid,
      status: currentTenant.status || ContractStatus.Active,
      rentFreePeriods: currentTenant.rentFreePeriods || [],
      rentReductions: currentTenant.rentReductions || [],
      freeRentHandling: currentTenant.freeRentHandling || 'Deduct',
      firstReceivableAmount: currentTenant.firstReceivableAmount,
      firstReceivableStartDate: currentTenant.firstReceivableStartDate,
      firstReceivableEndDate: currentTenant.firstReceivableEndDate,
      paymentPeriodAdjustments: currentTenant.paymentPeriodAdjustments || [],
      paymentPeriodShiftMonths: currentTenant.paymentPeriodShiftMonths,
      projectId: inheritedProjectId,
    } as Tenant;
    const allAssumptions = ((dashboardData as DashboardData | undefined)?.budgetAssumptions || []) as BudgetAssumption[];
    const allAdjustments = ((dashboardData as DashboardData | undefined)?.budgetAdjustments || []) as BudgetAdjustment[];
    const vacancyBudgetAssumptions =
      (currentTenant.unitIds?.length ?? 0) > 0
        ? allAssumptions.filter((a) => a.targetType === 'Vacancy' && currentTenant.unitIds!.includes(a.targetId))
        : [];
    const existingTenantAssumptions = currentTenant.id
      ? allAssumptions.filter((a) => a.targetId === currentTenant.id && a.targetType === 'Existing')
      : [];
    const tenantAdjustments = currentTenant.id
      ? allAdjustments.filter((a) => a.tenantId === currentTenant.id)
      : [];
    const assumptionsForPreview = [
      ...vacancyBudgetAssumptions,
      ...(previewApplyBudget ? existingTenantAssumptions : []),
    ];
    const adjustmentsForPreview = previewApplyBudget ? tenantAdjustments : [];

    return {
      inheritedProjectId,
      tenantForPreview,
      previewStart: new Date(currentTenant.leaseStart),
      previewEnd: new Date(currentTenant.leaseEnd),
      allAssumptions,
      vacancyBudgetAssumptions,
      existingTenantAssumptions,
      tenantAdjustments,
      hasExistingBudgetItems: existingTenantAssumptions.length > 0 || tenantAdjustments.length > 0,
      hasVacancyBudgetItems: vacancyBudgetAssumptions.length > 0,
      assumptionsForPreview,
      adjustmentsForPreview,
      showBillingDiffOverlay: assumptionsForPreview.length > 0 || adjustmentsForPreview.length > 0,
      willApplyBudget: previewApplyBudget && (existingTenantAssumptions.length > 0 || tenantAdjustments.length > 0),
    };
  }, [currentTenant, dashboardData, previewApplyBudget, tenants]);
  const [receivablePreviewState, setReceivablePreviewState] = useState<{
    loading: boolean;
    bills: BudgetedBill[];
    rawBills: BudgetedBill[];
    error?: string;
  }>({ loading: false, bills: [], rawBills: [] });

  useEffect(() => {
    if (!receivablePreviewContext) {
      setReceivablePreviewState({ loading: false, bills: [], rawBills: [] });
      return;
    }

    const localPreview = async () => {
      const bills = await getCachedBudgetedBills(
        receivablePreviewContext.tenantForPreview,
        receivablePreviewContext.assumptionsForPreview,
        receivablePreviewContext.adjustmentsForPreview,
        receivablePreviewContext.previewStart,
        receivablePreviewContext.previewEnd,
        `contract-manager:receivable-preview:${receivablePreviewContext.tenantForPreview.id}:budget:${previewApplyBudget ? 'on' : 'off'}`,
      );
      const rawBills = receivablePreviewContext.showBillingDiffOverlay
        ? await getCachedBudgetedBills(
            receivablePreviewContext.tenantForPreview,
            [],
            [],
            receivablePreviewContext.previewStart,
            receivablePreviewContext.previewEnd,
            `contract-manager:receivable-preview:${receivablePreviewContext.tenantForPreview.id}:raw`,
          )
        : bills;
      return { loading: false, bills, rawBills };
    };

    const canUseServer = serverComputeEnabled && !!cloudConfig;
    let cancelled = false;
    if (!canUseServer || !cloudConfig) {
      if (!shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: false })) {
        setReceivablePreviewState({
          loading: false,
          bills: [],
          rawBills: [],
          error: '后台应收账单预览计算不可用，未执行前端本地重算。',
        });
        return;
      }
      setReceivablePreviewState((prev) => ({ ...prev, loading: true, error: undefined }));
      localPreview()
        .then((state) => {
          if (!cancelled) setReceivablePreviewState(state);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setReceivablePreviewState({
              loading: false,
              bills: [],
              rawBills: [],
              error: error instanceof Error ? error.message : '本地应收账单预览模块加载失败。',
            });
          }
        });
      return () => {
        cancelled = true;
      };
    }

    setReceivablePreviewState((prev) => ({ ...prev, loading: true, error: undefined }));
    const batchItems = [
      {
        id: 'budget',
        tenant: receivablePreviewContext.tenantForPreview,
        assumptions: receivablePreviewContext.assumptionsForPreview,
        adjustments: receivablePreviewContext.adjustmentsForPreview,
        startDate: receivablePreviewContext.previewStart,
        endDate: receivablePreviewContext.previewEnd,
      },
      ...(receivablePreviewContext.showBillingDiffOverlay
        ? [{
            id: 'raw',
            tenant: receivablePreviewContext.tenantForPreview,
            assumptions: [],
            adjustments: [],
            startDate: receivablePreviewContext.previewStart,
            endDate: receivablePreviewContext.previewEnd,
          }]
        : []),
    ];

    fetchCloudBudgetedBillsPreviewBatch(cloudConfig, { items: batchItems }).then((result) => {
      if (cancelled) return;
      const lookup = indexBudgetedBillPreviewBatchResult(
        result,
        receivablePreviewContext.showBillingDiffOverlay ? ['budget', 'raw'] : ['budget'],
      );
      if (lookup.ok) {
        const budgetBills = lookup.billsById.get('budget') || [];
        const rawBills = lookup.billsById.get('raw') || budgetBills;
        setReceivablePreviewState({
          loading: false,
          bills: budgetBills,
          rawBills,
        });
        return;
      }
      if (shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: true })) {
        localPreview().then((state) => {
          if (!cancelled) setReceivablePreviewState(state);
        });
        return;
      }
      setReceivablePreviewState({
        loading: false,
        bills: [],
        rawBills: [],
        error:
          lookup.message ||
          '后台批量应收账单预览计算失败，未执行前端本地重算。',
      });
    }).catch((error: unknown) => {
      if (!cancelled) {
        if (shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: true })) {
          localPreview().then((state) => {
            if (!cancelled) setReceivablePreviewState(state);
          });
          return;
        }
        setReceivablePreviewState({
          loading: false,
          bills: [],
          rawBills: [],
          error: error instanceof Error ? error.message : '后台应收账单预览计算失败，未执行前端本地重算。',
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authUser?.enabled, cloudConfig, getCachedBudgetedBills, previewApplyBudget, receivablePreviewContext]);
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [terminateId, setTerminateId] = useState<string | null>(null);
  const [terminateData, setTerminateData] = useState<{
      date: string;
      type: 'Normal' | 'Early';
      reason: string;
      frClawbackOverride: string;
      depositDeduction: string;
      otherAdjustment: string;
      selectedUnitIds: string[];
  }>({ date: '', type: 'Normal', reason: '', frClawbackOverride: '', depositDeduction: '', otherAdjustment: '', selectedUnitIds: [] });

  // 名称变更 & 付款周期变更 对话框
  const [showNameChange, setShowNameChange] = useState(false);
  const [nameChangeTenantId, setNameChangeTenantId] = useState<string | null>(null);
  const [showCycleChange, setShowCycleChange] = useState(false);

  const canBatchSelectTenant = (t: Tenant) =>
      !isMobileQueryOnly && !String(t.id || '').startsWith('virt_') && !String(t.name || '').includes('(预算)');

  const toggleBatchContractSelect = (id: string) => {
      setBatchSelectedContractIds((prev) => {
          const n = new Set(prev);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
      });
  };

  const handleBatchDeleteContracts = async () => {
      if (isMobileQueryOnly) return;
      if (!viewRentPricing) {
          await showContractNotice({
              title: '无合同删除权限',
              message: '当前账号无合同删除权限。',
              tone: 'amber',
          });
          return;
      }
      if (batchSelectedContractIds.size === 0) return;
      const confirmed = await showContractConfirm({
          title: '批量删除合同',
          message: `确定删除选中的 ${batchSelectedContractIds.size} 份合同？此操作不可恢复。`,
          tone: 'rose',
          confirmText: '删除',
      });
      if (!confirmed) return;
      const rm = batchSelectedContractIds;
      onUpdateTenants(tenants.filter((t) => !rm.has(t.id)));
      setBatchSelectedContractIds(new Set());
      if (currentTenant.id && rm.has(currentTenant.id)) {
          setIsEditing(false);
          setCurrentTenant({});
      }
  };

  const beginNewContract = () => {
      if (isMobileQueryOnly) return;
      setCurrentTenant({
          signingDate: new Date().toISOString().split('T')[0],
          status: ContractStatus.Active,
          depositStatus: DepositStatus.Unpaid,
          rentFreePeriods: [],
          paymentCycle: 'Quarterly',
          paymentCycleMonths: 3,
          firstPaymentMonths: 3,
      });
      setRenewingFromId(null);
      setFormErrors({});
      setIsEditing(true);
  };

  // 批量导入/导出 & AI 识别导入
  const [showAIContractImport, setShowAIContractImport] = useState(false);
  const [importSummary, setImportSummary] = useState<null | { total: number; success: number; updated: number; created: number; failed: number }>(null);
  const [importErrors, setImportErrors] = useState<Array<{ row: number; reason: string; data: Record<string, any> }>>([]);
  const [showImportResult, setShowImportResult] = useState(false);

  const closeImportResultModal = () => {
    setShowImportResult(false);
  };

  useEffect(() => {
    if (!showImportResult) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeImportResultModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showImportResult]);
  
  // 初始化录入状态
  const [showInitPaymentModal, setShowInitPaymentModal] = useState(false);
  const [initPaymentData, setInitPaymentData] = useState({
    amount: '',
    date: '',
    remarks: '2026年1月前历史数据'
  });

  const closeInitPaymentModal = () => {
    setShowInitPaymentModal(false);
    setInitPaymentData({ amount: '', date: '', remarks: '2026年1月前历史数据' });
  };

  useEffect(() => {
    if (!showInitPaymentModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeInitPaymentModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showInitPaymentModal]);

  const handleDeleteCurrentTenant = async () => {
    const tenantId = currentTenant.id;
    if (!tenantId) return;
    const confirmed = await showContractConfirm({
      title: '删除合同记录',
      message: `确定删除「${currentTenant.name || '当前合同'}」？此操作不可恢复。`,
      tone: 'rose',
      confirmText: '删除',
    });
    if (!confirmed) return;
    onUpdateTenants(tenants.filter(t => t.id !== tenantId));
    setIsEditing(false);
    setCurrentTenant({});
    setRenewingFromId(null);
    setFormErrors({});
  };

  const handleConfirmInitPayment = async () => {
    if (!initPaymentData.amount || !initPaymentData.date) {
      await showContractNotice({
        title: '请填写完整信息',
        message: '累计已收金额和数据截止日期均为必填项。',
        tone: 'amber',
      });
      return;
    }

    if (new Date(initPaymentData.date) >= new Date('2026-01-01')) {
      await showContractNotice({
        title: '数据截止日期不合法',
        message: '数据截止日期必须为 2025-12-31 或之前。',
        tone: 'amber',
      });
      return;
    }

    if (onUpdatePayments && currentTenant.id) {
      const newPayment: PaymentRecord = {
        id: `init-${Date.now()}`,
        tenantId: currentTenant.id,
        tenantName: currentTenant.name!,
        amount: parseFloat(initPaymentData.amount),
        type: 'Rent',
        date: initPaymentData.date,
        status: 'Received',
        remarks: initPaymentData.remarks
      };
      onUpdatePayments([...payments, newPayment]);
      setShowInitPaymentModal(false);
      setInitPaymentData({ amount: '', date: '', remarks: '2026年1月前历史数据' });
      await showContractNotice({
        title: '初始化数据已录入',
        message: '该客户 2026 年 1 月前的历史收款数据已录入。',
        tone: 'blue',
      });
    }
  };

  // --- High-Performance Analysis Engine ---
  const canUseContractAnalysisServer =
    activeTab === 'Analysis' &&
    serverComputeEnabled &&
    !!cloudConfig;
  const [contractAnalysisServerState, setContractAnalysisServerState] = useState<{
    loading: boolean;
    data?: ContractPerfData;
    error?: string;
  }>({ loading: false });
  const [localContractAnalysisState, setLocalContractAnalysisState] = useState<{
    loading: boolean;
    data?: ContractPerfData;
    error?: string;
  }>({ loading: false, data: EMPTY_CONTRACT_PERF_DATA });

  useEffect(() => {
    if (activeTab !== 'Analysis' || canUseContractAnalysisServer) {
      setLocalContractAnalysisState({ loading: false, data: EMPTY_CONTRACT_PERF_DATA });
      return;
    }
    if (!shouldRunLocalContractAnalysisMetricsFallback({
      canUseServer: canUseContractAnalysisServer,
      serverAttempted: false,
    })) {
      setLocalContractAnalysisState({
        loading: false,
        data: EMPTY_CONTRACT_PERF_DATA,
        error: '后台合同经营分析计算不可用，未执行前端本地重算。',
      });
      return;
    }

    let cancelled = false;
    setLocalContractAnalysisState((prev) => ({
      ...prev,
      loading: true,
      error: undefined,
    }));
    import('../services/contractAnalysisMetrics')
      .then(({ buildContractAnalysisMetrics }) => {
        if (cancelled) return;
        setLocalContractAnalysisState({
          loading: false,
          data: buildContractAnalysisMetrics(tenants, analysisPeriod),
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLocalContractAnalysisState({
          loading: false,
          data: EMPTY_CONTRACT_PERF_DATA,
          error: error instanceof Error ? error.message : '本地合同经营分析模块加载失败。',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, analysisPeriod, canUseContractAnalysisServer, tenants]);

  useEffect(() => {
    if (activeTab !== 'Analysis' || !canUseContractAnalysisServer || !cloudConfig) {
      setContractAnalysisServerState({ loading: false });
      return;
    }

    let cancelled = false;
    setContractAnalysisServerState({ loading: true });
    fetchCloudContractAnalysisMetrics(cloudConfig, {
      tenants,
      period: analysisPeriod,
      referenceDate: new Date(),
    }).then((result) => {
      if (cancelled) return;
      if (result.success && result.metrics) {
        setContractAnalysisServerState({ loading: false, data: result.metrics });
        return;
      }
      if (shouldRunLocalContractAnalysisMetricsFallback({ canUseServer: canUseContractAnalysisServer, serverAttempted: true })) {
        import('../services/contractAnalysisMetrics')
          .then(({ buildContractAnalysisMetrics }) => {
            if (!cancelled) {
              setContractAnalysisServerState({
                loading: false,
                data: buildContractAnalysisMetrics(tenants, analysisPeriod),
              });
            }
          })
          .catch((error: unknown) => {
            if (!cancelled) {
              setContractAnalysisServerState({
                loading: false,
                error: error instanceof Error ? error.message : '本地合同经营分析模块加载失败。',
              });
            }
          });
        return;
      }
      setContractAnalysisServerState({
        loading: false,
        error: result.message || '后台合同分析计算失败，未执行前端本地重算。',
      });
    }).catch((error: unknown) => {
      if (cancelled) return;
      if (shouldRunLocalContractAnalysisMetricsFallback({ canUseServer: canUseContractAnalysisServer, serverAttempted: true })) {
        import('../services/contractAnalysisMetrics')
          .then(({ buildContractAnalysisMetrics }) => {
            if (!cancelled) {
              setContractAnalysisServerState({
                loading: false,
                data: buildContractAnalysisMetrics(tenants, analysisPeriod),
              });
            }
          })
          .catch((localError: unknown) => {
            if (!cancelled) {
              setContractAnalysisServerState({
                loading: false,
                error: localError instanceof Error ? localError.message : '本地合同经营分析模块加载失败。',
              });
            }
          });
        return;
      }
      setContractAnalysisServerState({
        loading: false,
        error: error instanceof Error ? error.message : '后台合同分析计算失败，未执行前端本地重算。',
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, analysisPeriod, canUseContractAnalysisServer, cloudConfig, tenants]);

  const perfData: ContractPerfData =
    activeTab !== 'Analysis'
      ? EMPTY_CONTRACT_PERF_DATA
      : contractAnalysisServerState.data || localContractAnalysisState.data || EMPTY_CONTRACT_PERF_DATA;
  const contractAnalysisLoading =
    activeTab === 'Analysis' && (contractAnalysisServerState.loading || localContractAnalysisState.loading);
  const contractAnalysisError =
    activeTab === 'Analysis' ? contractAnalysisServerState.error || localContractAnalysisState.error : undefined;

  // --- Actions ---
  const handleSave = async () => {
    if (isMobileQueryOnly) {
      setIsEditing(false);
      setCurrentTenant({});
      setRenewingFromId(null);
      setFormErrors({});
      return;
    }
    const errors: Record<string, boolean> = {};
    const missingFields = [];
    if (!currentTenant.name) { errors.name = true; missingFields.push('企业名称'); }
    if (!currentTenant.buildingId) { errors.buildingId = true; missingFields.push('所属楼宇'); }
    if (!currentTenant.unitIds || currentTenant.unitIds.length === 0) { errors.unitIds = true; missingFields.push('租赁单元/房号'); }
    if (!currentTenant.signingDate) { errors.signingDate = true; missingFields.push('签约日期'); }
    if (!currentTenant.leaseStart) { errors.leaseStart = true; missingFields.push('起租日期'); }
    if (!currentTenant.leaseEnd) { errors.leaseEnd = true; missingFields.push('结束日期'); }
    
    setFormErrors(errors);
    if (missingFields.length > 0) {
      await showContractNotice({
        title: '无法保存合同',
        message: `请填写以下必填项：\n${missingFields.join('、')}`,
        tone: 'amber',
      });
      return;
    }

    const syncedUnitTerms = syncUnitTermsForSelection(currentTenant, currentTenant.unitIds || []);
    const tenantWithUnitTerms = syncedUnitTerms.length > 0
      ? applyUnitTermsSummary(currentTenant, syncedUnitTerms)
      : currentTenant;

    // 新建客户时继承当前园区的 projectId（从已有合同推断），确保计费引擎能根据园区
    // 选用「应收当月 / 前一月」等账期规则，避免新合同的应收推算与保存到 PocketBase
    // 后再次加载结果不一致。
    const inheritedProjectId =
      currentTenant.projectId ||
      tenants.find((t) => (t.projectId || '').trim())?.projectId ||
      '';

    const newTenant = {
      ...tenantWithUnitTerms,
      id: currentTenant.id || `t${Date.now()}`,
      status: currentTenant.status || ContractStatus.Active,
      rentFreePeriods: currentTenant.rentFreePeriods || [],
      depositAmount: currentTenant.depositAmount || 0,
      depositStatus: currentTenant.depositStatus || DepositStatus.Unpaid,
      paymentCycle: currentTenant.paymentCycle || 'Quarterly',
      projectId: inheritedProjectId,
    } as Tenant;

    let updatedTenants = [...tenants];
    if (renewingFromId) {
        updatedTenants.push(newTenant);
    } else if (currentTenant.id && tenants.some(t => t.id === currentTenant.id)) {
       updatedTenants = updatedTenants.map(t => t.id === currentTenant.id ? newTenant : t);
    } else { updatedTenants.push(newTenant); }
    onUpdateTenants(updatedTenants); setIsEditing(false); setCurrentTenant({}); setRenewingFromId(null); setFormErrors({});
  };

  // 退租回退
  const handleRollback = async (tenantId: string) => {
    if (isMobileQueryOnly) return;
    const t = tenants.find(x => x.id === tenantId);
    if (!t) return;

    // 部分退租回退：合并回父合同
    if (t.parentContractId) {
      const parent = tenants.find(x => x.id === t.parentContractId);
      if (!parent) {
        await showContractNotice({
          title: '无法回退退租记录',
          message: '未找到原合同，无法回退。',
          tone: 'rose',
        });
        return;
      }
      const confirmed = await showContractConfirm({
        title: '合并部分退租房源',
        message:
          `确定将「${t.name}」的部分退租房源合并回原合同吗？\n\n` +
          `退租房源：${(t.unitIds || []).join('、')}\n` +
          `合并后原合同恢复包含全部房源，此退租记录将被删除。`,
        tone: 'amber',
        confirmText: '合并回退',
      });
      if (!confirmed) return;

      const mergedUnitIds = [...new Set([...(parent.unitIds || []), ...(t.unitIds || [])])];
      const mergedUnitTerms = [
        ...(parent.unitTerms || []),
        ...(t.unitTerms || []).filter(ut => !(parent.unitTerms || []).some(pt => pt.unitId === ut.unitId)),
      ];

      const updated = tenants.map(x => {
        if (x.id === parent.id) {
          return {
            ...parent,
            unitIds: mergedUnitIds,
            totalArea: Number(((parent.totalArea || 0) + (t.totalArea || 0)).toFixed(2)),
            monthlyRent: (parent.monthlyRent || 0) + (t.monthlyRent || 0),
            depositAmount: (parent.depositAmount || 0) + (t.depositAmount || 0),
            unitTerms: mergedUnitTerms,
            paymentTerms: mergedUnitTerms,
          };
        }
        return x;
      }).filter(x => x.id !== tenantId);

      onUpdateTenants(updated);
      return;
    }

    // 整单退租回退（原有逻辑）
    const confirmed = await showContractConfirm({
      title: '回退退租状态',
      message: `确定将「${t.name}」回退为履约中状态吗？\n\n此操作将清除退租日期、退租类型、退租原因及提前退租结算数据。`,
      tone: 'amber',
      confirmText: '回退',
    });
    if (!confirmed) return;
    const updated = tenants.map(x =>
      x.id === tenantId
        ? {
            ...x,
            status: ContractStatus.Active,
            terminationDate: undefined,
            terminationType: undefined,
            terminationReason: undefined,
            earlyTerminationFreeRentClawbackOverride: undefined,
            earlyTerminationDepositDeduction: undefined,
            earlyTerminationOtherAdjustment: undefined,
          }
        : x
    );
    onUpdateTenants(updated);
  };

  const handleEdit = (tenant: Tenant) => {
    const derivedPrice = tenant.unitPrice || (tenant.totalArea ? Number((tenant.monthlyRent / tenant.totalArea * 12 / 365).toFixed(2)) : 0);
    setCurrentTenant({ ...tenant, unitPrice: derivedPrice, unitTerms: tenant.unitTerms || tenant.paymentTerms || [] });
    setRentInputMode(tenant.unitPriceMode != null ? 'byUnitPrice' : 'direct');
    setRenewingFromId(null); setFormErrors({}); setIsEditing(true);
  };

  // 名称变更
  const handleNameChange = (tenant: Tenant) => {
    if (isMobileQueryOnly) return;
    setNameChangeTenantId(tenant.id);
    setShowNameChange(true);
  };
  const handleNameChangeConfirm = (newName: string, record: import('../types').NameChangeRecord) => {
    if (isMobileQueryOnly) return;
    const updated = tenants.map(t =>
      t.id === nameChangeTenantId
        ? { ...t, name: newName, nameHistory: [...(t.nameHistory || []), record] }
        : t
    );
    onUpdateTenants(updated);
    setShowNameChange(false);
    setNameChangeTenantId(null);
  };

  // 付款周期变更
  const handleCycleChangeConfirm = (change: import('../types').PaymentCycleChange) => {
    if (isMobileQueryOnly) return;
    if (!currentTenant.id) return;
    const updated = tenants.map(t =>
      t.id === currentTenant.id
        ? {
            ...t,
            paymentCycle: change.toCycle,
            paymentCycleMonths: change.toCycleMonths,
            paymentCycleChanges: [...(t.paymentCycleChanges || []), change],
          }
        : t
    );
    onUpdateTenants(updated);
    setCurrentTenant(prev => ({
      ...prev,
      paymentCycle: change.toCycle,
      paymentCycleMonths: change.toCycleMonths,
      paymentCycleChanges: [...(prev.paymentCycleChanges || []), change],
    }));
    setShowCycleChange(false);
  };

  /**
   * 在卡片上直接整体平移合同账期 ±N 个月（写入 `paymentPeriodShiftMonths`）。
   * 与「详情 → 账期调整（存量调优）」弹窗中 ◀▶ 按钮等价：
   *   正数 = 后移（推迟收款），负数 = 前移（提前收款）。
   * 不会触碰合同其他字段，保留 `paymentPeriodAdjustments`（单月调整）记录。
   */
  const handleShiftPaymentPeriod = (tenantId: string, delta: number) => {
    if (isMobileQueryOnly) return;
    if (!delta) return;
    const updated = tenants.map((t) =>
      t.id === tenantId
        ? { ...t, paymentPeriodShiftMonths: (t.paymentPeriodShiftMonths || 0) + delta }
        : t,
    );
    onUpdateTenants(updated);
  };

  /** 清除合同的整体账期偏移（保留单月级 `paymentPeriodAdjustments`）。 */
  const handleClearPaymentPeriodShift = (tenantId: string) => {
    if (isMobileQueryOnly) return;
    const updated = tenants.map((t) =>
      t.id === tenantId ? { ...t, paymentPeriodShiftMonths: 0 } : t,
    );
    onUpdateTenants(updated);
  };

  const handleRenewal = (tenant: Tenant) => {
    if (isMobileQueryOnly) return;
    setCurrentTenant(buildRenewalContractDraft(tenant));
    setRenewingFromId(tenant.id);
    setFormErrors({});
    setIsEditing(true);
  };

  const findSelectedUnit = (unitId: string, buildingId = currentTenant.buildingId) => {
      return buildings.find(b => b.id === buildingId)?.units.find(u => u.id === unitId);
  };

  const calculateMonthlyRentFromUnitPrice = (unitPrice: number | undefined, area: number, mode?: 'daily' | 'monthly') => {
      if (mode === 'monthly') return Number(((unitPrice || 0) * area).toFixed(2));
      return Number(((unitPrice || 0) * (365 / 12) * area).toFixed(2));
  };

  const summarizeUnitTerms = (terms: LeaseUnitTerm[]) => {
      const totalArea = Number(terms.reduce((sum, term) => sum + (term.area || 0), 0).toFixed(2));
      const monthlyRent = Number(terms.reduce((sum, term) => sum + (term.monthlyRent || 0), 0).toFixed(2));
      const unitPrice = totalArea > 0 ? Number((monthlyRent / totalArea * 12 / 365).toFixed(2)) : 0;
      return { totalArea, monthlyRent, unitPrice };
  };

  const syncUnitTermsForSelection = (tenant: Partial<Tenant>, unitIds: string[]): LeaseUnitTerm[] => {
      const existingTerms = Array.isArray(tenant.unitTerms) && tenant.unitTerms.length > 0
          ? tenant.unitTerms
          : (Array.isArray(tenant.paymentTerms) ? tenant.paymentTerms : []);
      return unitIds.map((unitId) => {
          const existing = existingTerms.find(term => term.unitId === unitId);
          const unit = findSelectedUnit(unitId, tenant.buildingId || currentTenant.buildingId);
          const area = Number((existing?.area ?? unit?.area ?? 0).toFixed(2));
          const unitPrice = existing?.unitPrice ?? tenant.unitPrice ?? 0;
          return {
              unitId,
              unitName: existing?.unitName || unit?.name || unitId,
              area,
              unitPrice,
              monthlyRent: existing?.monthlyRent ?? calculateMonthlyRentFromUnitPrice(unitPrice, area),
              rentFreePeriods: existing?.rentFreePeriods || [],
          };
      });
  };

  const applyUnitTermsSummary = (tenant: Partial<Tenant>, terms: LeaseUnitTerm[]) => {
      const summary = summarizeUnitTerms(terms);
      return {
          ...tenant,
          unitTerms: terms,
          paymentTerms: terms,
          totalArea: summary.totalArea,
          monthlyRent: summary.monthlyRent,
          unitPrice: summary.unitPrice,
      };
  };

  const initiateTermination = (id: string) => {
    if (isMobileQueryOnly) return;
    const tenant = tenants.find(t => t.id === id);
    const allUnitIds = tenant?.unitIds || [];
    setTerminateId(id);
    setTerminateData({
      date: new Date().toISOString().split('T')[0],
      type: 'Normal',
      reason: '',
      frClawbackOverride: '',
      depositDeduction: '',
      otherAdjustment: '',
      selectedUnitIds: [...allUnitIds],
    });
    setShowTerminateModal(true);
  };

  const closeTerminateModal = () => {
    setShowTerminateModal(false);
    setTerminateId(null);
  };

  useEffect(() => {
    if (!showTerminateModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeTerminateModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTerminateModal]);

  const toggleUnit = (unitId: string) => {
      const currentIds = currentTenant.unitIds || [];
      const newIds = currentIds.includes(unitId) ? currentIds.filter(id => id !== unitId) : [...currentIds, unitId];
      const unitTerms = syncUnitTermsForSelection(currentTenant, newIds);
      setCurrentTenant(applyUnitTermsSummary({ ...currentTenant, unitIds: newIds }, unitTerms));
  };

  const updateUnitTerm = (unitId: string, updater: (term: LeaseUnitTerm) => LeaseUnitTerm) => {
      const unitTerms = syncUnitTermsForSelection(currentTenant, currentTenant.unitIds || []).map(term => (
          term.unitId === unitId ? updater(term) : term
      ));
      setCurrentTenant(applyUnitTermsSummary(currentTenant, unitTerms));
  };

  const addUnitRentFree = (unitId: string) => {
      updateUnitTerm(unitId, term => ({
          ...term,
          rentFreePeriods: [...(term.rentFreePeriods || []), { start: '', end: '', description: '' }],
      }));
  };

  const updateUnitRentFree = (unitId: string, index: number, field: keyof RentFreePeriod, value: string) => {
      updateUnitTerm(unitId, term => {
          const rentFreePeriods = [...(term.rentFreePeriods || [])];
          rentFreePeriods[index] = { ...rentFreePeriods[index], [field]: value };
          return { ...term, rentFreePeriods };
      });
  };

  const removeUnitRentFree = (unitId: string, index: number) => {
      updateUnitTerm(unitId, term => ({
          ...term,
          rentFreePeriods: (term.rentFreePeriods || []).filter((_, i) => i !== index),
      }));
  };

  const addRentFree = () => {
    const rf = currentTenant.rentFreePeriods || [];
    setCurrentTenant({
      ...currentTenant,
      rentFreePeriods: [...rf, { start: '', end: '', description: '', deductionMode: 'monthly' }],
    });
  };

  const updateRentFree = (index: number, field: keyof RentFreePeriod, value: string | number) => {
    const rf = [...(currentTenant.rentFreePeriods || [])];
    rf[index] = { ...rf[index], [field]: value };
    setCurrentTenant({ ...currentTenant, rentFreePeriods: rf });
  };

  const removeRentFree = (index: number) => {
    const rf = currentTenant.rentFreePeriods?.filter((_, i) => i !== index);
    setCurrentTenant({ ...currentTenant, rentFreePeriods: rf });
  };

  const addFixedRentReduction = () => {
    const list = currentTenant.rentReductions || [];
    const row: FixedRentReduction = {
      id: `frr_${Date.now()}`,
      start: '',
      end: '',
      reductionAmount: 0,
      reason: '',
    };
    setCurrentTenant({ ...currentTenant, rentReductions: [...list, row] });
  };

  const updateFixedRentReduction = (
    index: number,
    field: keyof FixedRentReduction,
    value: string | number,
  ) => {
    const list = [...(currentTenant.rentReductions || [])];
    list[index] = { ...list[index], [field]: value };
    setCurrentTenant({ ...currentTenant, rentReductions: list });
  };

  const removeFixedRentReduction = (index: number) => {
    const list = (currentTenant.rentReductions || []).filter((_, i) => i !== index);
    setCurrentTenant({ ...currentTenant, rentReductions: list });
  };

  const tenantAmountDeltaAdjustments = useMemo(
    () =>
      (budgetAdjustments || []).filter(
        (a) =>
          a.tenantId === currentTenant.id &&
          (a.adjustmentKind === 'amount_delta' || (a.originalYear === -1 && a.originalMonth === -1)),
      ),
    [budgetAdjustments, currentTenant.id],
  );

  const [showAmountDeltaForm, setShowAmountDeltaForm] = useState(false);
  const [amountDeltaForm, setAmountDeltaForm] = useState({
    adjustedYear: new Date().getFullYear(),
    adjustedMonth: 0,
    amount: 0,
    reason: '',
  });

  const handleAddAmountDelta = async () => {
    if (!onUpdateAdjustments || !currentTenant.id) {
      await showContractNotice({
        title: '无法保存预算金额调整',
        message: '当前环境无法保存预算金额调整。',
        tone: 'rose',
      });
      return;
    }
    if (!amountDeltaForm.reason.trim()) {
      await showContractNotice({
        title: '请填写调整原因',
        message: '保存预算金额调整前需要填写调整原因。',
        tone: 'amber',
      });
      return;
    }
    if (amountDeltaForm.amount === 0) {
      await showContractNotice({
        title: '调整金额不能为 0',
        message: '请输入正数或负数金额，用于标记本合同的预算金额调整。',
        tone: 'amber',
      });
      return;
    }
    const adj: BudgetAdjustment = {
      id: `cad_${Date.now()}`,
      tenantId: currentTenant.id,
      tenantName: currentTenant.name || '',
      originalYear: -1,
      originalMonth: -1,
      adjustedYear: amountDeltaForm.adjustedYear,
      adjustedMonth: amountDeltaForm.adjustedMonth,
      amount: amountDeltaForm.amount,
      reason: amountDeltaForm.reason.trim(),
      adjustmentKind: 'amount_delta',
    };
    onUpdateAdjustments([...(budgetAdjustments || []).filter((a) => a.id !== adj.id), adj]);
    setShowAmountDeltaForm(false);
    setAmountDeltaForm({
      adjustedYear: new Date().getFullYear(),
      adjustedMonth: 0,
      amount: 0,
      reason: '',
    });
  };

  const handleRemoveAmountDelta = (id: string) => {
    if (!onUpdateAdjustments) return;
    onUpdateAdjustments((budgetAdjustments || []).filter((a) => a.id !== id));
  };

  const filteredTenants = useMemo(() => {
    return filterContractListTenants(tenants, {
        activeTab,
        searchTerm,
        filterBuilding,
        filterStatus,
        filterPaymentCycle,
    });
  }, [tenants, searchTerm, filterBuilding, filterStatus, filterPaymentCycle, activeTab]);

  const tenantAssetDisplayById = useMemo(() => {
      const map = new Map<string, ReturnType<typeof resolveTenantAssetDisplay>>();
      for (const tenant of filteredTenants) {
          map.set(
              tenant.id,
              resolveTenantAssetDisplay(tenant, tenantAssetLookup, {
                  unitSeparator: ', ',
                  unknownBuildingName: '',
              }),
          );
      }
      return map;
  }, [filteredTenants, tenantAssetLookup]);

  const contractStatusCounts = useMemo(() => {
      let active = 0;
      let terminated = 0;
      for (const tenant of tenants) {
          if (tenant.status === ContractStatus.Terminated) {
              terminated += 1;
          } else if (tenant.status !== ContractStatus.Expired) {
              active += 1;
          }
      }
      return { active, terminated };
  }, [tenants]);
  const activeContractCount = contractStatusCounts.active;
  const terminatedContractCount = contractStatusCounts.terminated;
  const filteredContractCount = filteredTenants.length;
  const mobileCurrentTabCount =
      activeTab === 'List'
          ? filteredContractCount
          : activeTab === 'Terminated'
            ? terminatedContractCount
            : activeTab === 'Expiring'
              ? expiringTenantSummary.count
              : activeContractCount;

  const normalizeDate = (input: any): string => {
      const s = String(input ?? '').trim();
      if (!s) return '';
      // Excel 序列号日期
      if (typeof input === 'number' && Number.isFinite(input) && input > 20000 && input < 60000) {
          const ymd = excelSerialDateToYMD(input);
          if (ymd) return ymd;
      }
      // 兼容 YYYY/M/D
      const m = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
      if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
      // 已是 YYYY-MM-DD 或其它，原样返回
      return s;
  };

  const parseNumber = (input: any): number | undefined => {
      if (input === null || input === undefined) return undefined;
      if (typeof input === 'number' && Number.isFinite(input)) return input;
      const s = String(input).replace(/[,\s￥¥]/g, '').trim();
      if (!s) return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
  };

  const matchBuildingByName = (name: any): string => {
      const raw = String(name ?? '').trim();
      if (!raw) return '';
      const cleaned = raw.replace(/[\s号楼栋幢]/g, '').toLowerCase();
      for (const b of buildings) {
          const bName = String(b.name || '').replace(/[\s号楼栋幢]/g, '').toLowerCase();
          if (bName === cleaned || bName.includes(cleaned) || cleaned.includes(bName)) return b.id;
      }
      const num = cleaned.match(/\d+/)?.[0];
      if (num) {
          const hit = buildings.find((b) => String(b.name || '').includes(num));
          if (hit) return hit.id;
      }
      return '';
  };

  const matchUnitIdsByNames = (buildingId: string, unitNames: string[]): string[] => {
      const b = buildings.find((x) => x.id === buildingId);
      if (!b) return [];
      const out: string[] = [];
      unitNames.forEach((name) => {
          const cleaned = String(name || '').replace(/[\s室号房]/g, '').toLowerCase();
          if (!cleaned) return;
          const hit = b.units.find((u) => {
              const uName = String(u.name || '').replace(/[\s室号房]/g, '').toLowerCase();
              return uName === cleaned || uName.includes(cleaned) || cleaned.includes(uName);
          });
          if (hit && !out.includes(hit.id)) out.push(hit.id);
      });
      return out;
  };

  const inferPaymentCycle = (text: any): Tenant['paymentCycle'] => {
      const s = String(text ?? '').trim();
      if (!s) return 'Quarterly';
      if (s === 'HalfMonthly' || s.includes('半月') || s.includes('15天') || s.includes('十五天')) return 'HalfMonthly';
      if (s === 'BiMonthly' || s.includes('两月') || s.includes('双月') || s.includes('2月') || s.includes('二月')) return 'BiMonthly';
      if (s === 'Monthly' || s.includes('月')) return 'Monthly';
      if (s === 'SemiAnnual' || s.includes('半年')) return 'SemiAnnual';
      if (s === 'Annual' || s.includes('年')) return 'Annual';
      if (s === 'Quarterly' || s.includes('季')) return 'Quarterly';
      if (s === 'Custom' || s.includes('自定义')) return 'Custom';
      return 'Quarterly';
  };

  /** 是否为"用户填了内容"：区分未填(空字符串/undefined/null) vs 显式 0/false */
  const hasValue = (v: any): boolean => {
      if (v === undefined || v === null) return false;
      if (typeof v === 'string') return v.trim() !== '';
      return true;
  };

  /** 把中文/英文合同状态归一为 ContractStatus 枚举值 */
  const normalizeContractStatus = (v: any): ContractStatus | undefined => {
      const s = String(v ?? '').trim().toLowerCase();
      if (!s) return undefined;
      const map: Record<string, ContractStatus> = {
          'active': ContractStatus.Active,
          '履约中': ContractStatus.Active,
          '在租': ContractStatus.Active,
          '正常': ContractStatus.Active,
          'expiring': ContractStatus.Expiring,
          '即将到期': ContractStatus.Expiring,
          '到期': ContractStatus.Expiring,
          'terminated': ContractStatus.Terminated,
          '已退租': ContractStatus.Terminated,
          '退租': ContractStatus.Terminated,
          'pending': ContractStatus.Pending,
          '签约中': ContractStatus.Pending,
          '待签': ContractStatus.Pending,
          'expired': ContractStatus.Expired,
          '已到期': ContractStatus.Expired,
          '历史': ContractStatus.Expired,
      };
      if (map[s]) return map[s];
      const cap = s.charAt(0).toUpperCase() + s.slice(1);
      if ((Object.values(ContractStatus) as string[]).includes(cap)) {
          return cap as ContractStatus;
      }
      return undefined;
  };

  const parseTerminationTypeCell = (v: any): 'Normal' | 'Early' | undefined => {
      const s = String(v ?? '').trim();
      if (!s) return undefined;
      const low = s.toLowerCase();
      if (low === 'early' || s.includes('提前') || s.includes('违约')) return 'Early';
      if (low === 'normal' || s.includes('正常')) return 'Normal';
      return 'Normal';
  };

  /** 把中文/英文免租处理方式归一 */
  const normalizeFreeRentHandling = (v: any): 'Defer' | 'Deduct' | undefined => {
      const s = String(v ?? '').trim().toLowerCase();
      if (!s) return undefined;
      if (['defer', '顺延', '账期顺延', '延期'].includes(s)) return 'Defer';
      if (['deduct', '扣除', '当期扣除', '抵扣'].includes(s)) return 'Deduct';
      return undefined;
  };

  const downloadXlsx = (filename: string, rows: any[], sheetName = 'Sheet1') => {
      void writeXlsxRows(filename, rows, sheetName);
  };

  const downloadWorkbookMultiSheet = (filename: string, sheets: { name: string; rows: any[] }[]) => {
      void writeXlsxWorkbook(filename, sheets);
  };

  const handleExportTenants = () => {
      const exportRows = filteredTenants.map((t) => {
          const asset = resolveTenantAssetDisplay(t, tenantAssetLookup, {
              unitSeparator: ',',
              unknownBuildingName: '',
          });
          const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
          const displayPrice = rentDisplay.unitPrice;
          const isMonthlyMode = rentDisplay.mode === 'monthly';
          const exportRow: any = {
              original_id: t.id,
              企业名称: t.name,
              招商客户经理中介名称: t.sourceAgentName || '',
              所属行业: t.industry || '',
              所属资产: asset.buildingName,
              房号: asset.unitNames,
              签约日期: t.signingDate || '',
              实际入驻日期: t.moveInDate || '',
              起租日期: t.leaseStart,
              结束日期: t.leaseEnd,
              单价: Number(displayPrice.toFixed(2)),
              单价单位: isMonthlyMode ? '元/㎡/月' : '元/㎡/天',
              月租金: t.monthlyRent || 0,
              面积: t.totalArea || 0,
              房源租金明细: JSON.stringify(t.unitTerms || t.paymentTerms || []),
              支付频率: t.paymentCycle || 'Quarterly',
              支付周期月数: t.paymentCycleMonths ?? '',
              首次收款日期: t.firstPaymentDate || '',
              押金: t.depositAmount || 0,
              免租处理方式: t.freeRentHandling || '',
              合同状态: t.status || '',
              退租日期: t.terminationDate || '',
              退租类型: t.terminationType || '',
              退租原因: t.terminationReason || '',
              联系人: t.contactName || '',
              联系方式: t.contactInfo || '',
              法人: t.legalRepName || '',
              成立日期: t.foundingDate || '',
              备注: t.specialRequirements || '',
          };

          // 添加分段免租期信息
          (t.rentFreePeriods || []).forEach((rf, index) => {
              const idx = index + 1;
              exportRow[`免租开始${idx}`] = rf.start || '';
              exportRow[`免租结束${idx}`] = rf.end || '';
              exportRow[`免租说明${idx}`] = rf.description || '';
          });

          return exportRow;
      });
      const fname = `客户合同导出_${activeTab === 'Terminated' ? '历史退租' : '在租明细'}_${new Date().toISOString().slice(0,10)}.xlsx`;
      downloadXlsx(fname, exportRows, 'contracts');
  };

  const handleDownloadTemplate = () => {
      const exampleBuilding = buildings[0];
      const exampleUnit = exampleBuilding?.units?.[0];
      const rows = [
          {
              original_id: '',
              企业名称: '示例：上海XX科技有限公司',
              招商客户经理中介名称: '张三（自拓）',
              所属行业: 'AI/软件',
              所属资产: exampleBuilding?.name || '1号楼',
              房号: exampleUnit?.name ? String(exampleUnit.name) : '305-308',
              签约日期: new Date().toISOString().slice(0, 10),
              实际入驻日期: '',
              起租日期: new Date().toISOString().slice(0, 10),
              结束日期: '',
              日单价: 2.8,
              月租金: '',
              面积: '',
              支付频率: 'Quarterly',
              支付周期月数: 3,
              首次收款日期: '',
              押金: 0,
              免租处理方式: 'Defer',
              免租开始1: '',
              免租结束1: '',
              免租说明1: '',
              免租开始2: '',
              免租结束2: '',
              免租说明2: '',
              合同状态: 'Active',
              退租日期: '',
              退租类型: '',
              退租原因: '',
              联系人: '',
              联系方式: '',
              法人: '',
              成立日期: '',
              备注: '',
          },
          {
              original_id: '',
              企业名称: '示例：已退租客户（历史合同）',
              招商客户经理中介名称: '某某中介',
              所属行业: '',
              所属资产: exampleBuilding?.name || '1号楼',
              房号: exampleUnit?.name ? String(exampleUnit.name) : '101',
              签约日期: '',
              实际入驻日期: '',
              起租日期: '2023-01-01',
              结束日期: '2026-12-31',
              日单价: 2.5,
              月租金: 50000,
              面积: 200,
              支付频率: 'Quarterly',
              支付周期月数: 3,
              首次收款日期: '2022-12-01',
              押金: 100000,
              免租处理方式: 'Deduct',
              免租开始1: '',
              免租结束1: '',
              免租说明1: '',
              免租开始2: '',
              免租结束2: '',
              免租说明2: '',
              合同状态: 'Terminated',
              退租日期: '2025-06-30',
              退租类型: 'Early',
              退租原因: '业务收缩搬迁',
              联系人: '',
              联系方式: '',
              法人: '',
              成立日期: '',
              备注: '导入后出现在「历史退租」；应收由系统按租期与月租金生成',
          },
      ];
      const readme = [
          { 章节: '一、通用', 说明: '首行为列名。original_id 非空时按该 ID 更新已有合同；为空则按「企业名称+起租日期」尝试匹配，否则新增。' },
          { 章节: '', 说明: '' },
          { 章节: '二、必填（新增）', 说明: '企业名称、所属资产、房号、起租日期、结束日期。在租合同另需签约日期。' },
          { 章节: '', 说明: '' },
          { 章节: '三、已退租 / 历史合同', 说明: '合同状态填 Terminated 或 已退租；必须填写退租日期。签约日期可留空，系统用起租日期代替。退租类型：Normal/正常 或 Early/提前。' },
          { 章节: '', 说明: '' },
          { 章节: '四、应收与报表', 说明: '保存后，系统按合同起止、月租金、免租设定生成各月应收；在「工作台应收」「预算执行」等视图中体现。已退租客户仅在仍有未核销应收的月份出现在应收明细。' },
          { 章节: '', 说明: '' },
          { 章节: '五、楼宇资管 Excel', 说明: '若从「楼宇资管」批量导入，可在同一行填写合同企业名称等列同步写入合同（见楼宇模板「填写说明」）。' },
      ];
      downloadWorkbookMultiSheet('客户合同导入模板.xlsx', [
          { name: '客户合同', rows },
          { name: '填写说明', rows: readme },
      ]);
  };

  const handleBatchImportFile = async (file: File) => {
      try {
          console.log('开始处理批量导入文件:', file.name);
          const buf = await file.arrayBuffer();
          const json = await readFirstSheetRows<Record<string, any>>(buf);
          console.log('解析到的数据行数:', json.length);

          const errors: Array<{ row: number; reason: string; data: Record<string, any> }> = [];
          let updated = 0;
          let created = 0;

          const updatedTenants = [...tenants];

          const findExistingIndex = (row: Record<string, any>, name: string): number => {
              // 1. original_id 精确匹配（最高优先级）
              const oid = String(row.original_id || row['original_id'] || '').trim();
              if (oid) {
                  const i = updatedTenants.findIndex((t) => t.id === oid);
                  if (i >= 0) return i;
              }
              const leaseStart = normalizeDate(row['起租日期'] || row.leaseStart);
              if (!name || !leaseStart) return -1;

              const buildingNameRaw = row['所属资产'] ?? row['楼宇'] ?? row['楼宇名称'] ?? row.buildingName;
              const buildingName = hasValue(buildingNameRaw) ? String(buildingNameRaw).trim() : '';
              const resolvedBuildingId = buildingName
                  ? (matchBuildingByName(buildingNameRaw) || String(row.buildingId || '').trim())
                  : '';

              // 2. 企业名称 + 楼宇 + 房号(任一) + 起租日期（最严格，四个维度）
              const unitNamesRaw = String(row['房号'] ?? row['租赁单元'] ?? row.unitNames ?? '').trim();
              if (buildingName && resolvedBuildingId && unitNamesRaw) {
                  const unitNames = unitNamesRaw.split(/[,，、;\s]+/).map((s: string) => s.trim()).filter(Boolean);
                  if (unitNames.length > 0) {
                      const matchedUnitIds = matchUnitIdsByNames(resolvedBuildingId, unitNames);
                      if (matchedUnitIds.length > 0) {
                          const i = updatedTenants.findIndex(
                              (t) => t.name === name
                                  && t.buildingId === resolvedBuildingId
                                  && t.unitIds.some(uid => matchedUnitIds.includes(uid))
                                  && String(t.leaseStart || '') === leaseStart
                          );
                          if (i >= 0) return i;
                      }
                  }
              }

              // 3. 企业名称 + 楼宇 + 起租日期（如果提供了楼宇但未提供房号）
              if (buildingName && resolvedBuildingId) {
                  const i = updatedTenants.findIndex(
                      (t) => t.name === name && t.buildingId === resolvedBuildingId && String(t.leaseStart || '') === leaseStart
                  );
                  if (i >= 0) return i;
              }

              // 4. 企业名称 + 起租日期 + 结束日期（兜底，有结束日期更精确）
              const leaseEnd = normalizeDate(row['结束日期'] ?? row['到期日期'] ?? row.leaseEnd);
              if (leaseEnd) {
                  const i = updatedTenants.findIndex(
                      (t) => t.name === name && String(t.leaseStart || '') === leaseStart && String(t.leaseEnd || '') === leaseEnd
                  );
                  if (i >= 0) return i;
              }

              // 5. 企业名称 + 起租日期（最简兜底，保持兼容性）
              return updatedTenants.findIndex(
                  (t) => t.name === name && String(t.leaseStart || '') === leaseStart
              );
          };

          json.forEach((row, idx) => {
              const rowNo = idx + 2; // header=1
              const name = String(row['企业名称'] || row.name || '').trim();
              if (!name) {
                  errors.push({ row: rowNo, reason: '缺少必填字段：企业名称', data: row });
                  return;
              }

              // 先尝试匹配已存在记录（决定后续按"新增"还是"局部更新"处理）
              const existingIndex = findExistingIndex(row, name);
              const existing = existingIndex >= 0 ? updatedTenants[existingIndex] : undefined;

              // ----- 资产/房号匹配（仅当用户在 Excel 中填写时才校验/覆盖）-----
              const buildingNameRaw = row['所属资产'] ?? row['楼宇'] ?? row['楼宇名称'] ?? row.buildingName;
              const buildingNameProvided = hasValue(buildingNameRaw);
              let resolvedBuildingId: string | undefined;
              if (buildingNameProvided) {
                  const matched = matchBuildingByName(buildingNameRaw) || String(row.buildingId || '').trim();
                  if (!matched) {
                      errors.push({
                          row: rowNo,
                          reason: `无法匹配所属资产：${String(buildingNameRaw ?? '').trim() || '空'}`,
                          data: row,
                      });
                      return;
                  }
                  resolvedBuildingId = matched;
              } else if (existing) {
                  resolvedBuildingId = existing.buildingId;
              }

              const unitNamesRaw = String(row['房号'] ?? row['租赁单元'] ?? row.unitNames ?? '').trim();
              const unitNamesProvided = hasValue(unitNamesRaw);
              let resolvedUnitIds: string[] | undefined;
              if (unitNamesProvided) {
                  if (!resolvedBuildingId) {
                      errors.push({ row: rowNo, reason: '填写了房号但未指定所属资产', data: row });
                      return;
                  }
                  const unitNames = unitNamesRaw
                      .split(/[,，、;\s]+/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                  const ids = matchUnitIdsByNames(resolvedBuildingId, unitNames);
                  if (unitNames.length > 0 && ids.length === 0) {
                      errors.push({ row: rowNo, reason: `无法匹配房号：${unitNamesRaw}`, data: row });
                      return;
                  }
                  resolvedUnitIds = ids;
              } else if (existing) {
                  resolvedUnitIds = existing.unitIds;
              }

              // ----- 日期字段（仅当用户填写时才覆盖；新建时必填）-----
              const signingDate = hasValue(row['签约日期'] ?? row.signingDate)
                  ? normalizeDate(row['签约日期'] ?? row.signingDate)
                  : existing?.signingDate;
              const leaseStart = hasValue(row['起租日期'] ?? row.leaseStart)
                  ? normalizeDate(row['起租日期'] ?? row.leaseStart)
                  : existing?.leaseStart;
              const leaseEnd = hasValue(row['结束日期'] ?? row['到期日期'] ?? row.leaseEnd)
                  ? normalizeDate(row['结束日期'] ?? row['到期日期'] ?? row.leaseEnd)
                  : existing?.leaseEnd;
              const moveInDate = hasValue(row['实际入驻日期'] ?? row.moveInDate)
                  ? normalizeDate(row['实际入驻日期'] ?? row.moveInDate)
                  : existing?.moveInDate;

              // ----- 数值字段 -----
              const unitPriceRaw = row['日单价'] ?? row.unitPrice;
              const monthlyRentRaw = row['月租金'] ?? row.monthlyRent;
              const totalAreaRaw = row['面积'] ?? row.totalArea;
              const depositAmountRaw = row['押金'] ?? row.depositAmount;
              const paymentCycleMonthsRaw = row['支付周期月数'] ?? row.paymentCycleMonths;
              const firstPaymentDateRaw = row['首次收款日期'] ?? row.firstPaymentDate;
              const paymentCycleRaw = row['支付频率'] ?? row.paymentCycle;
              const freeRentHandlingRaw = row['免租处理方式'] ?? row.freeRentHandling;
              const statusRaw = row['合同状态'] ?? row.status;

              // ----- 分段免租期（仅当本行有任意免租字段时才覆盖现有列表）-----
              let rentFreePeriods: RentFreePeriod[] | undefined;
              const collectedRfp: RentFreePeriod[] = [];
              const rfStart = normalizeDate(row['免租开始'] ?? row.rentFreeStart);
              const rfEnd = normalizeDate(row['免租结束'] ?? row.rentFreeEnd);
              const rfDesc = String(row['免租说明'] ?? row.rentFreeDesc ?? '').trim();
              let rfpKeyTouched =
                  hasValue(row['免租开始']) ||
                  hasValue(row['免租结束']) ||
                  hasValue(row['免租说明']);
              if (rfStart && rfEnd) {
                  collectedRfp.push({ start: rfStart, end: rfEnd, description: rfDesc || '免租期' });
              }
              for (let i = 1; i <= 10; i++) {
                  const sKey = `免租开始${i}`;
                  const eKey = `免租结束${i}`;
                  const dKey = `免租说明${i}`;
                  if (hasValue(row[sKey]) || hasValue(row[eKey]) || hasValue(row[dKey])) {
                      rfpKeyTouched = true;
                  }
                  const start = normalizeDate(row[sKey]);
                  const end = normalizeDate(row[eKey]);
                  const desc = String(row[dKey] ?? '').trim();
                  if (start && end) {
                      collectedRfp.push({ start, end, description: desc || `免租期${i}` });
                  }
              }
              if (rfpKeyTouched) {
                  rentFreePeriods = collectedRfp;
              }

              // ----- 校验（仅在新建时校验关键日期）-----
              const terminationDateEarly = hasValue(row['退租日期'] ?? row.terminationDate)
                  ? normalizeDate(row['退租日期'] ?? row.terminationDate)
                  : '';
              const statusFromRowEarly = hasValue(statusRaw) ? normalizeContractStatus(statusRaw) : undefined;
              const importingTerminatedEarly =
                  statusFromRowEarly === ContractStatus.Terminated || !!terminationDateEarly;

              if (!existing) {
                  if (!resolvedBuildingId) {
                      errors.push({ row: rowNo, reason: '新增合同必须填写：所属资产', data: row });
                      return;
                  }
                  if (!leaseStart || !leaseEnd) {
                      errors.push({ row: rowNo, reason: '新增合同必须填写：起租日期与结束日期', data: row });
                      return;
                  }
                  if (!importingTerminatedEarly && !signingDate) {
                      errors.push({ row: rowNo, reason: '新增在租合同必须填写：签约日期（已退租导入可留空签约日期，将用起租日）', data: row });
                      return;
                  }
                  if (importingTerminatedEarly && !terminationDateEarly) {
                      errors.push({
                          row: rowNo,
                          reason: '已退租/历史合同导入必须填写：退租日期（或合同状态为 Terminated/已退租 且填写退租日期）',
                          data: row,
                      });
                      return;
                  }
              }

              // ----- 计算辅助值（用于 totalArea / monthlyRent 兜底）-----
              const totalAreaParsed = parseNumber(totalAreaRaw);
              const unitPriceParsed = parseNumber(unitPriceRaw);
              const monthlyRentParsed = parseNumber(monthlyRentRaw);

              const fallbackAreaFromUnits = (resolvedUnitIds || []).reduce((sum, uid) => {
                  const b = buildings.find((x) => x.id === resolvedBuildingId);
                  const u = b?.units.find((x) => x.id === uid);
                  return sum + (u?.area || 0);
              }, 0);

              // ----- 组装 patch（仅包含用户填写或新建必须的字段）-----
              const patch: Partial<Tenant> = { name };

              if (hasValue(row.rootId) || hasValue(row['root_id'])) {
                  const rid = String(row.rootId || row['root_id'] || '').trim();
                  patch.rootId = rid || undefined;
              }
              if (hasValue(row['所属行业'] ?? row.industry)) {
                  patch.industry = String(row['所属行业'] ?? row.industry).trim() || undefined;
              }
              if (hasValue(row['招商客户经理中介名称'] ?? row['招商客户经理/中介名称'] ?? row.sourceAgentName)) {
                  patch.sourceAgentName = String(
                      row['招商客户经理中介名称'] ?? row['招商客户经理/中介名称'] ?? row.sourceAgentName
                  ).trim() || undefined;
              }
              if (hasValue(row['联系方式'] ?? row.contactInfo)) {
                  patch.contactInfo = String(row['联系方式'] ?? row.contactInfo).trim() || undefined;
              }
              if (hasValue(row['联系人'] ?? row.contactName)) {
                  patch.contactName = String(row['联系人'] ?? row.contactName).trim() || undefined;
              }
              if (hasValue(row['法人'] ?? row.legalRepName)) {
                  patch.legalRepName = String(row['法人'] ?? row.legalRepName).trim() || undefined;
              }
              if (hasValue(row['成立日期'] ?? row.foundingDate)) {
                  patch.foundingDate = normalizeDate(row['成立日期'] ?? row.foundingDate) || undefined;
              }
              if (hasValue(row['备注'] ?? row.specialRequirements)) {
                  patch.specialRequirements = String(row['备注'] ?? row.specialRequirements).trim() || undefined;
              }

              if (resolvedBuildingId) patch.buildingId = resolvedBuildingId;
              if (resolvedUnitIds) patch.unitIds = resolvedUnitIds;

              if (signingDate !== undefined) patch.signingDate = signingDate;
              if (leaseStart !== undefined) patch.leaseStart = leaseStart;
              if (leaseEnd !== undefined) patch.leaseEnd = leaseEnd;
              if (moveInDate !== undefined) patch.moveInDate = moveInDate || undefined;

              // 面积：用户填写优先；否则若用户调整了房号，按新房号求和；否则保留旧值
              if (typeof totalAreaParsed === 'number' && totalAreaParsed > 0) {
                  patch.totalArea = Number(totalAreaParsed.toFixed(2));
              } else if (unitNamesProvided && fallbackAreaFromUnits > 0) {
                  patch.totalArea = Number(fallbackAreaFromUnits.toFixed(2));
              }

              // 单价：仅当用户显式填写时才覆盖
              if (typeof unitPriceParsed === 'number' && unitPriceParsed > 0) {
                  patch.unitPrice = Number(unitPriceParsed.toFixed(2));
              }

              // 月租金：用户显式填写优先；否则若用户填写了单价/面积可由其推算；否则保留旧值
              if (typeof monthlyRentParsed === 'number' && monthlyRentParsed > 0) {
                  patch.monthlyRent = Math.round(monthlyRentParsed * 100) / 100;
              } else if (
                  typeof unitPriceParsed === 'number' && unitPriceParsed > 0 &&
                  (typeof totalAreaParsed === 'number' && totalAreaParsed > 0)
              ) {
                  patch.monthlyRent = Math.round(unitPriceParsed * (365 / 12) * totalAreaParsed * 100) / 100;
              }

              if (hasValue(paymentCycleRaw)) patch.paymentCycle = inferPaymentCycle(paymentCycleRaw);
              const pcm = parseNumber(paymentCycleMonthsRaw);
              if (typeof pcm === 'number' && pcm > 0) {
                  patch.paymentCycleMonths = Number(pcm.toFixed(2));
                  if (!existing?.firstPaymentMonths) {
                      patch.firstPaymentMonths = Number(pcm.toFixed(2));
                  }
              }
              if (hasValue(firstPaymentDateRaw)) {
                  patch.firstPaymentDate = normalizeDate(firstPaymentDateRaw) || undefined;
              }

              if (hasValue(freeRentHandlingRaw)) {
                  patch.freeRentHandling = normalizeFreeRentHandling(freeRentHandlingRaw);
              }
              const depositAmountParsed = parseNumber(depositAmountRaw);
              if (typeof depositAmountParsed === 'number' && depositAmountParsed >= 0) {
                  patch.depositAmount = Math.round(depositAmountParsed);
              }
              if (hasValue(statusRaw)) {
                  const st = normalizeContractStatus(statusRaw);
                  if (st) patch.status = st;
              }
              if (hasValue(row['退租日期'] ?? row.terminationDate)) {
                  patch.terminationDate =
                      normalizeDate(row['退租日期'] ?? row.terminationDate) || undefined;
                  if (!hasValue(statusRaw)) patch.status = ContractStatus.Terminated;
              }
              if (hasValue(row['退租类型'] ?? row.terminationType)) {
                  patch.terminationType = parseTerminationTypeCell(row['退租类型'] ?? row.terminationType);
              }
              if (hasValue(row['退租原因'] ?? row.terminationReason)) {
                  patch.terminationReason = String(row['退租原因'] ?? row.terminationReason).trim();
              }
              if (rentFreePeriods !== undefined) patch.rentFreePeriods = rentFreePeriods;

              if (existing) {
                  // 更新：仅覆盖用户实际填写的字段，其余保留旧值
                  updatedTenants[existingIndex] = {
                      ...existing,
                      ...patch,
                      id: existing.id, // 始终保留原 ID
                  };
                  updated += 1;
              } else {
                  // 新建：补齐必须字段及默认值
                  const signingResolved = signingDate || leaseStart!;
                  const newTenant: Tenant = {
                      id: String(row.original_id || row['original_id'] || '').trim() || `t${Date.now()}_${idx}`,
                      rootId: patch.rootId,
                      name,
                      industry: patch.industry,
                      sourceAgentName: patch.sourceAgentName,
                      contactInfo: patch.contactInfo,
                      contactName: patch.contactName,
                      legalRepName: patch.legalRepName,
                      foundingDate: patch.foundingDate,
                      buildingId: resolvedBuildingId!,
                      unitIds: resolvedUnitIds || [],
                      totalArea: Number((patch.totalArea ?? fallbackAreaFromUnits ?? 0).toFixed(2)),
                      signingDate: signingResolved,
                      moveInDate: patch.moveInDate,
                      leaseStart: leaseStart!,
                      leaseEnd: leaseEnd!,
                      unitPrice: patch.unitPrice,
                      monthlyRent: patch.monthlyRent ?? 0,
                      rentFreePeriods: patch.rentFreePeriods ?? [],
                      paymentCycle: patch.paymentCycle ?? 'Quarterly',
                      paymentCycleMonths: patch.paymentCycleMonths,
                      firstPaymentDate: patch.firstPaymentDate ?? signingResolved,
                      firstPaymentMonths: patch.firstPaymentMonths ?? patch.paymentCycleMonths,
                      freeRentHandling: patch.freeRentHandling,
                      depositAmount: patch.depositAmount ?? 0,
                      depositStatus: DepositStatus.Unpaid,
                      status: patch.status ?? ContractStatus.Active,
                      terminationDate: patch.terminationDate,
                      terminationType: patch.terminationType,
                      terminationReason: patch.terminationReason || '',
                      specialRequirements: patch.specialRequirements,
                      isRisk: false,
                      keyMoments: [],
                  };
                  updatedTenants.push(newTenant);
                  created += 1;
              }
          });

          setImportErrors(errors);
          setImportSummary({
              total: json.length,
              success: json.length - errors.length,
              updated,
              created,
              failed: errors.length,
          });
          setShowImportResult(true);

          if (json.length - errors.length > 0) {
              onUpdateTenants(updatedTenants);
          }
      } catch (error) {
          console.error('批量导入失败:', error);
          await showContractNotice({
              title: '批量导入失败',
              message: error instanceof Error ? error.message : '未知错误',
              tone: 'rose',
          });
      }
  };

  const handleImportErrorsExport = () => {
      if (importErrors.length === 0) return;
      const rows = importErrors.map((e) => ({
          行号: e.row,
          原因: e.reason,
          ...e.data,
      }));
      downloadXlsx(`客户合同导入失败明细_${new Date().toISOString().slice(0,10)}.xlsx`, rows, 'errors');
  };

  const sortedYears = useMemo(() => {
      if (activeTab !== 'Terminated') return [];
      const groups: Record<number, Tenant[]> = {};
      filteredTenants.forEach(t => { 
          const dateRef = activeTab === 'Terminated' ? (t.terminationDate || t.leaseEnd) : t.leaseStart;
          const year = new Date(dateRef).getFullYear(); 
          if(!groups[year]) groups[year] = []; 
          groups[year].push(t); 
      });
      return Object.keys(groups).map(Number).sort((a,b) => b-a).map(year => ({ year, tenants: groups[year] }));
  }, [filteredTenants, activeTab]);

  const buildingFloorGroups = useMemo(() => {
      if (activeTab !== 'List') return [];
      const grouped = new Map<string, { buildingId: string; buildingName: string; floors: Map<string, Tenant[]> }>();

      filteredTenants.forEach((t) => {
          const building = buildingById.get(t.buildingId);
          const buildingId = t.buildingId || 'unknown';
          const buildingName = building?.name || '未知楼栋';
          if (!grouped.has(buildingId)) {
              grouped.set(buildingId, { buildingId, buildingName, floors: new Map<string, Tenant[]>() });
          }
          const unitFloors = new Set<number>();
          t.unitIds.forEach((uid) => {
              const f = unitFloorById.get(uid);
              if (typeof f === 'number') unitFloors.add(f);
          });
          const floorLabel =
              unitFloors.size === 0
                  ? '未标注楼层'
                  : unitFloors.size === 1
                    ? `${Array.from(unitFloors)[0]}层`
                    : '多楼层';
          const floorMap = grouped.get(buildingId)!.floors;
          if (!floorMap.has(floorLabel)) floorMap.set(floorLabel, []);
          floorMap.get(floorLabel)!.push(t);
      });

      return Array.from(grouped.values())
          .sort((a, b) => a.buildingName.localeCompare(b.buildingName, 'zh-CN'))
          .map((g) => {
              const floors = Array.from(g.floors.entries())
                  .sort((a, b) => {
                      const aNum = parseInt(a[0], 10);
                      const bNum = parseInt(b[0], 10);
                      if (Number.isNaN(aNum) && Number.isNaN(bNum)) return a[0].localeCompare(b[0], 'zh-CN');
                      if (Number.isNaN(aNum)) return 1;
                      if (Number.isNaN(bNum)) return -1;
                      return aNum - bNum;
                  })
                  .map(([floorLabel, tenants]) => ({
                      floorLabel,
                      tenants: tenants.sort((x, y) => new Date(y.leaseStart).getTime() - new Date(x.leaseStart).getTime()),
                  }));
              return { ...g, floors };
          });
  }, [activeTab, filteredTenants, buildingById, unitFloorById]);

  const tabletPreviewTenants = useMemo(() => {
      if (activeTab === 'List') {
          return buildingFloorGroups.flatMap((group) =>
              group.floors.flatMap((floor) => floor.tenants),
          );
      }
      if (activeTab === 'Terminated') {
          return sortedYears.flatMap((group) => group.tenants);
      }
      return [];
  }, [activeTab, buildingFloorGroups, sortedYears]);

  const tabletPreviewTenant = useMemo(() => {
      if (tabletPreviewTenants.length === 0) return null;
      return tabletPreviewTenants.find((tenant) => tenant.id === tabletPreviewTenantId) || tabletPreviewTenants[0];
  }, [tabletPreviewTenantId, tabletPreviewTenants]);

  useEffect(() => {
      if (tabletPreviewTenants.length === 0) {
          if (tabletPreviewTenantId !== null) setTabletPreviewTenantId(null);
          return;
      }
      if (!tabletPreviewTenantId || !tabletPreviewTenants.some((tenant) => tenant.id === tabletPreviewTenantId)) {
          setTabletPreviewTenantId(tabletPreviewTenants[0].id);
      }
  }, [tabletPreviewTenantId, tabletPreviewTenants]);

  const contractDesktopRows = useMemo<ContractDesktopRow[]>(() => {
      if (mobileEntryMode || (activeTab === 'List' && listLayoutMode === 'Card')) return [];
      const rows: ContractDesktopRow[] = [];
      if (activeTab === 'List') {
          for (const group of buildingFloorGroups) {
              const count = group.floors.reduce((acc, f) => acc + f.tenants.length, 0);
              rows.push({
                  kind: 'building',
                  key: `building:${group.buildingId}`,
                  buildingName: group.buildingName,
                  count,
              });
              for (const floor of group.floors) {
                  rows.push({
                      kind: 'floor',
                      key: `floor:${group.buildingId}:${floor.floorLabel}`,
                      floorLabel: floor.floorLabel,
                      count: floor.tenants.length,
                  });
                  for (const tenant of floor.tenants) {
                      rows.push({ kind: 'tenant', key: `tenant:${tenant.id}`, tenant });
                  }
              }
          }
          return rows;
      }
      for (const group of sortedYears) {
          rows.push({
              kind: 'year',
              key: `year:${group.year}`,
              year: group.year,
              count: group.tenants.length,
          });
          for (const tenant of group.tenants) {
              rows.push({ kind: 'tenant', key: `tenant:${tenant.id}`, tenant });
          }
      }
      return rows;
  }, [activeTab, buildingFloorGroups, listLayoutMode, mobileEntryMode, sortedYears]);

  const contractDesktopTenantCount = filteredTenants.length;
  const useVirtualContractRows = contractDesktopTenantCount > 80;

  const renderTabletContractPreview = (tenant: Tenant | null) => {
      if (!tenant) {
          return (
              <div className="liquid-contract-tablet-preview rounded-[26px] p-5 text-center">
                  <div className="liquid-icon-well mx-auto flex h-12 w-12 items-center justify-center rounded-[20px] text-blue-700">
                      <FileText size={22} />
                  </div>
                  <div className="mt-3 text-sm font-black text-slate-800">选择一份合同</div>
                  <p className="mx-auto mt-1 max-w-[14rem] text-xs font-semibold leading-5 text-slate-500">
                      平板横屏下可在左侧浏览列表，右侧快速核对关键字段。
                  </p>
              </div>
          );
      }

      const asset = tenantAssetDisplayById.get(tenant.id);
      const rentDisplay = resolveRentUnitPriceForDisplay(tenant, projectIdProp);
      const managementFee = getManagementFeeCardStatus(tenant, projectIdProp);
      const isTerminated = tenant.status === ContractStatus.Terminated;
      const periodShift = tenant.paymentPeriodShiftMonths || 0;
      const periodAdjustmentCount = (tenant.paymentPeriodAdjustments || []).length;
      const periodAdjustmentText =
          periodShift !== 0 || periodAdjustmentCount > 0
              ? `${periodShift !== 0 ? `整体${periodShift > 0 ? '后移' : '前移'} ${Math.abs(periodShift)} 月` : '原账期'}${periodAdjustmentCount > 0 ? ` · ${periodAdjustmentCount} 笔单月调整` : ''}`
              : '原账期';

      return (
          <aside className="liquid-contract-tablet-preview rounded-[26px] p-4">
              <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                      <div className="text-xs font-black text-slate-500">
                          {isTerminated ? '历史退租合同' : '合同快速预览'}
                      </div>
                      <h3 className="mt-1 break-anywhere text-lg font-black leading-tight text-slate-950">
                          {tenant.name}
                      </h3>
                  </div>
                  <span className={`liquid-contract-tablet-status shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${isTerminated ? 'text-rose-700' : 'text-blue-700'}`}>
                      {contractStatusTextMap[tenant.status] || tenant.status}
                  </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="liquid-contract-tablet-metric rounded-2xl px-3 py-2">
                      <div className="text-xs font-black text-slate-500">租赁面积</div>
                      <div className="mt-1 text-base font-black tabular-nums text-slate-950">{formatArea(tenant.totalArea || 0)}</div>
                  </div>
                  <div className="liquid-contract-tablet-metric rounded-2xl px-3 py-2">
                      <div className="text-xs font-black text-slate-500">{rentDisplay.label}</div>
                      <div className="mt-1 text-base font-black tabular-nums text-blue-700">{formatCurrency(rentDisplay.unitPrice)}</div>
                  </div>
                  {viewRentPricing && (
                      <div className="liquid-contract-tablet-metric rounded-2xl px-3 py-2">
                          <div className="text-xs font-black text-slate-500">月租金</div>
                          <div className="mt-1 text-base font-black tabular-nums text-slate-950">{formatCurrency(tenant.monthlyRent || 0)}</div>
                      </div>
                  )}
                  <div className="liquid-contract-tablet-metric rounded-2xl px-3 py-2">
                      <div className="text-xs font-black text-slate-500">付款周期</div>
                      <div className="mt-1 text-sm font-black text-slate-900">{paymentCycleLabelMap[tenant.paymentCycle] || tenant.paymentCycle}</div>
                  </div>
              </div>

              <div className="mt-4 space-y-2 text-xs font-semibold text-slate-600">
                  <div className="liquid-contract-tablet-row rounded-2xl px-3 py-2">
                      <MapPin size={13} className="shrink-0 text-blue-600" />
                      <span className="min-w-0 flex-1 truncate">{asset?.buildingName || '未绑定楼宇'}</span>
                      <span className="liquid-contract-mobile-chip max-w-[8rem] truncate px-1.5 py-0.5 font-black">{asset?.unitNames || '-'}</span>
                  </div>
                  <div className="liquid-contract-tablet-row rounded-2xl px-3 py-2">
                      <Calendar size={13} className="shrink-0 text-blue-600" />
                      <span className="tabular-nums">{tenant.leaseStart || '-'}</span>
                      <span className="text-slate-300">至</span>
                      <span className="tabular-nums">{tenant.leaseEnd || '-'}</span>
                  </div>
                  <div className="liquid-contract-tablet-row rounded-2xl px-3 py-2">
                      <Clock size={13} className="shrink-0 text-cyan-700" />
                      <span>实际入驻</span>
                      <span className="ml-auto font-black text-slate-900">{tenant.moveInDate || '同起租'}</span>
                  </div>
                  <div className="liquid-contract-tablet-row rounded-2xl px-3 py-2">
                      <ArrowLeftRight size={13} className="shrink-0 text-amber-600" />
                      <span>账期</span>
                      <span className="ml-auto max-w-[11rem] truncate font-black text-slate-900">{periodAdjustmentText}</span>
                  </div>
                  {managementFee.parkEnabled && (managementFee.collecting || managementFee.needsSetup) && (
                      <div className="liquid-contract-tablet-row rounded-2xl px-3 py-2">
                          <Receipt size={13} className="shrink-0 text-cyan-700" />
                          <span>物业费</span>
                          <span className="ml-auto font-black text-cyan-800">
                              {managementFee.monthlyUnitPrice
                                  ? `¥${managementFee.monthlyUnitPrice.toFixed(2)}/㎡·月`
                                  : managementFee.monthlyAmount > 0
                                    ? formatCurrency(managementFee.monthlyAmount)
                                    : '待配置'}
                          </span>
                      </div>
                  )}
                  {tenant.sourceAgentName && (
                      <div className="liquid-contract-tablet-row rounded-2xl px-3 py-2">
                          <Briefcase size={13} className="shrink-0 text-slate-500" />
                          <span className="min-w-0 truncate">来源：{tenant.sourceAgentName}</span>
                      </div>
                  )}
                  {isTerminated && (
                      <div className="liquid-contract-tablet-row rounded-2xl px-3 py-2">
                          <UserMinus size={13} className="shrink-0 text-rose-600" />
                          <span>退租日</span>
                          <span className="ml-auto font-black text-rose-700">{tenant.terminationDate || tenant.leaseEnd || '-'}</span>
                      </div>
                  )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                      type="button"
                      onClick={() => handleEdit(tenant)}
	                      className="liquid-mobile-inline-action-strong mobile-pressable min-h-11 rounded-full px-3 text-sm font-black"
                  >
                      查看详情
                  </button>
                  {!isMobileQueryOnly && !isTerminated && canRenewContract(tenant) && (
                      <button
                          type="button"
                          onClick={() => handleRenewal(tenant)}
	                          className="liquid-mobile-inline-action mobile-pressable min-h-11 rounded-full px-3 text-sm font-black text-blue-700"
                      >
                          续签
                      </button>
                  )}
                  {!isMobileQueryOnly && !isTerminated && (
                      <button
                          type="button"
                          onClick={() => initiateTermination(tenant.id)}
	                          className="liquid-mobile-inline-action mobile-pressable min-h-11 rounded-full px-3 text-sm font-black text-amber-700"
                      >
                          退租
                      </button>
                  )}
                  {!isMobileQueryOnly && isTerminated && (
                      <button
                          type="button"
                          onClick={() => handleRollback(tenant.id)}
	                          className="liquid-mobile-inline-action mobile-pressable min-h-11 rounded-full px-3 text-sm font-black text-blue-700"
                      >
                          回退
                      </button>
                  )}
              </div>
          </aside>
      );
  };

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

  const renewalHistory = useMemo(() => {
      const root = currentTenant.rootId || currentTenant.id;
      if (!root) return [];

      const chain = tenants.filter((t) => (t.rootId || t.id) === root);
      const hasDraft =
          currentTenant.id &&
          (renewingFromId || currentTenant.rootId) &&
          !chain.some((t) => t.id === currentTenant.id) &&
          currentTenant.leaseStart &&
          currentTenant.leaseEnd;

      if (hasDraft) {
          chain.push({
              ...(currentTenant as Tenant),
              id: currentTenant.id!,
              name: currentTenant.name || '当前编辑合同',
              buildingId: currentTenant.buildingId || '',
              unitIds: currentTenant.unitIds || [],
              totalArea: currentTenant.totalArea || 0,
              leaseStart: currentTenant.leaseStart!,
              leaseEnd: currentTenant.leaseEnd!,
              monthlyRent: currentTenant.monthlyRent || 0,
              paymentCycle: currentTenant.paymentCycle || 'Quarterly',
              firstPaymentDate: currentTenant.firstPaymentDate || currentTenant.leaseStart!,
              rentFreePeriods: currentTenant.rentFreePeriods || [],
              depositAmount: currentTenant.depositAmount || 0,
              depositStatus: currentTenant.depositStatus || DepositStatus.Unpaid,
              status: currentTenant.status || ContractStatus.Pending,
          });
      }

      return chain
          .sort((a, b) => new Date(a.leaseStart).getTime() - new Date(b.leaseStart).getTime())
          .map((item) => ({
              ...item,
              isCurrentEditing: item.id === currentTenant.id,
          }));
  }, [currentTenant, renewingFromId, tenants]);

  if (isEditing) {
     const targetBuilding = buildings.find(b => b.id === currentTenant.buildingId);
     // Filter units that are NOT self-use AND (are Vacant OR already belong to this tenant)
     const availableUnits = (targetBuilding?.units || []).filter(u => !u.isSelfUse && (u.status === UnitStatus.Vacant || currentTenant.unitIds?.includes(u.id)));
     const selectedUnitTerms = syncUnitTermsForSelection(currentTenant, currentTenant.unitIds || []);

     return (
         <div className="ios-liquid-app fixed inset-0 z-50 overflow-y-auto p-0 animate-in zoom-in-50 duration-200 md:p-6">
             <div className="liquid-contract-editor liquid-elevated-panel mx-auto flex min-h-full max-w-6xl flex-col border border-white/70 shadow-2xl md:min-h-[calc(100vh-48px)] md:rounded-[28px]">
                <div className="liquid-elevated-header sticky top-0 z-20 flex items-center justify-between border-b border-white/60 px-4 py-3 md:rounded-t-[28px] md:px-6 md:py-4">
                    <div className="flex min-w-0 items-center gap-2 md:gap-3">
                        <div className="liquid-icon-well flex h-10 w-10 items-center justify-center rounded-2xl text-blue-700"><Users size={20}/></div>
                        <div className="min-w-0">
                            <h2 className="truncate text-base font-black text-slate-950 md:text-xl">
                                {isMobileQueryOnly ? '客户合同详情' : currentTenant.id ? (renewingFromId ? '合同续签' : '客户合同详情') : '新增租赁签约'}
                            </h2>
                            <div className="mt-0.5 truncate text-[11px] font-bold text-slate-500 md:hidden">
                                {currentTenant.name || '待录入客户'} · {currentTenant.totalArea ? formatArea(currentTenant.totalArea) : '未选房源'}
                            </div>
                        </div>
                    </div>
                    <button onClick={() => { setIsEditing(false); setRenewingFromId(null); setFormErrors({}); }} className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 transition-colors hover:text-slate-900"><X size={20}/></button>
                </div>

                <div className="flex-1 space-y-3 p-3 pb-28 md:space-y-8 md:p-8 md:pb-8">
                    {/* 1. Core Info Section */}
                    <section className="space-y-4 p-4 md:p-6">
                        <div className="contract-section-heading mb-2"><FileText size={18}/> <span>核心签约信息</span></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">企业名称 <span className="text-red-500">*</span></label><div className="flex gap-2"><input type="text" className={`flex-1 border p-2.5 rounded-lg text-sm ${formErrors.name ? 'border-red-500 bg-red-50' : 'border-slate-300'}`} value={currentTenant.name || ''} onChange={e => setCurrentTenant({...currentTenant, name: e.target.value})} />{!isMobileQueryOnly && currentTenant.id && <button type="button" onClick={() => handleNameChange(currentTenant as Tenant)} className="contract-soft-action liquid-pressable whitespace-nowrap rounded-2xl px-3 py-2 text-xs font-black">变更名称</button>}</div></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">招商客户经理/中介名称</label><input type="text" placeholder="例如：张三（自拓）/ XX中介公司" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.sourceAgentName || ''} onChange={e => setCurrentTenant({...currentTenant, sourceAgentName: e.target.value})} /><p className="text-[10px] text-slate-400 mt-1">用于追踪客户来源，便于后期分析各来源客户的稳定性</p></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">所属资产 <span className="text-red-500">*</span></label><select className={`w-full border p-2.5 rounded-lg text-sm ${formErrors.buildingId ? 'border-red-500 bg-red-50' : 'border-slate-300'}`} value={currentTenant.buildingId || ''} onChange={e => setCurrentTenant({...currentTenant, buildingId: e.target.value, unitIds: [], unitTerms: [], paymentTerms: [], totalArea: 0, monthlyRent: 0})}>
                                <option value="">选择资产...</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name} {b.type === 'Site' ? '(场地)' : ''}</option>)}
                            </select></div>
                            
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium mb-2 text-slate-600">租赁单元 / 地块 <span className="text-red-500">*</span></label>
                                {targetBuilding && targetBuilding.units.length === 0 ? (
                                    <div className="contract-alert-panel flex items-start gap-3 p-4">
                                        <AlertCircle className="text-amber-500 mt-0.5 flex-shrink-0" size={18} />
                                        <div>
                                            <div className="text-amber-700 font-bold text-sm mb-1">该资产下暂无租赁单元/地块</div>
                                            <div className="text-amber-600 text-xs">
                                                请先前往 <span className="font-bold bg-amber-100 px-1 rounded">楼宇资管</span> 页面，为该资产添加可租赁的单元或地块信息，然后才能进行签约。
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="contract-unit-grid grid max-h-36 grid-cols-3 gap-2 overflow-y-auto rounded-2xl p-2 font-mono sm:grid-cols-6 md:max-h-48 md:grid-cols-8 md:p-3">
                                        {availableUnits.length > 0 ? availableUnits.map(u => (
                                            <button key={u.id} onClick={() => toggleUnit(u.id)} data-selected={currentTenant.unitIds?.includes(u.id) ? 'true' : 'false'} className="contract-unit-chip liquid-pressable rounded-2xl px-2 py-2 text-xs font-black transition-all hover:border-blue-300"><div>{u.name}</div><div className="opacity-70 font-normal">{formatArea(u.area)}</div></button>
                                        )) : (
                                            <div className="contract-empty-state col-span-full rounded-2xl py-4 text-center text-xs italic">
                                                {currentTenant.buildingId ? '该资产下暂无空置单元' : '请先选择左侧所属资产'}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {selectedUnitTerms.length > 0 && (
                                <div className="contract-inline-panel md:col-span-2 space-y-3 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-bold text-blue-700">房源租金明细</div>
                                            <div className="text-xs text-blue-500 mt-0.5">可分别设置每个房源的单价、月租金和专属免租期，合同月租金会自动汇总。</div>
                                        </div>
                                        <div className="text-right text-xs text-blue-700">
                                            <div>合计面积：<span className="font-bold">{formatArea(currentTenant.totalArea || 0)}</span></div>
                                            <div>合计月租：<span className="font-bold">{formatCurrency(currentTenant.monthlyRent || 0)}</span></div>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        {selectedUnitTerms.map(term => (
                                            <div key={term.unitId} className="contract-inline-panel space-y-3 p-4">
                                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                                                    <div>
                                                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">房源</label>
                                                        <div className="font-bold text-slate-800 text-sm">{term.unitName || term.unitId}</div>
                                                        <div className="text-xs text-slate-400">{formatArea(term.area || 0)}</div>
                                                    </div>
                                                    <div>
                                                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">{currentTenant.unitPriceMode === 'monthly' ? '月单价' : '日单价'}</label>
                                                        <input
                                                            type="number"
                                                            inputMode="decimal"
                                                            enterKeyHint="done"
                                                            step="0.01"
                                                            className="w-full border border-slate-300 p-2 rounded-lg text-sm"
                                                            value={term.unitPrice || ''}
                                                            onChange={e => {
                                                                const unitPrice = Number(e.target.value) || 0;
                                                                updateUnitTerm(term.unitId, current => ({
                                                                    ...current,
                                                                    unitPrice,
                                                                    monthlyRent: calculateMonthlyRentFromUnitPrice(unitPrice, current.area || 0, currentTenant.unitPriceMode),
                                                                }));
                                                            }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">月租金</label>
                                                        <input
                                                            type="number"
                                                            inputMode="decimal"
                                                            enterKeyHint="done"
                                                            step="0.01"
                                                            className="w-full border border-slate-300 p-2 rounded-lg text-sm"
                                                            value={term.monthlyRent || ''}
                                                            onChange={e => {
                                                                const monthlyRent = Number(e.target.value) || 0;
                                                                const unitPrice = term.area > 0 ? Number((monthlyRent / term.area * 12 / 365).toFixed(2)) : 0;
                                                                updateUnitTerm(term.unitId, current => ({ ...current, monthlyRent, unitPrice }));
                                                            }}
                                                        />
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => addUnitRentFree(term.unitId)}
                                                        className="contract-soft-action liquid-pressable flex items-center justify-center gap-1 rounded-2xl px-3 py-2 text-xs font-black"
                                                    >
                                                        <Plus size={14} /> 添加该房源免租期
                                                    </button>
                                                </div>
                                                {(term.rentFreePeriods || []).length > 0 && (
                                                    <div className="space-y-2 pt-2 border-t border-slate-100">
                                                        {(term.rentFreePeriods || []).map((rf, idx) => (
                                                            <div key={`${term.unitId}-${idx}`} className="contract-inline-panel grid grid-cols-1 items-end gap-2 rounded-2xl p-3 md:grid-cols-12">
                                                                <div className="md:col-span-3">
                                                                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">开始日期</label>
                                                                    <input type="date" className="w-full border p-2 rounded-lg text-sm" value={rf.start} onChange={e => updateUnitRentFree(term.unitId, idx, 'start', e.target.value)} />
                                                                </div>
                                                                <div className="md:col-span-3">
                                                                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">结束日期</label>
                                                                    <input type="date" className="w-full border p-2 rounded-lg text-sm" value={rf.end} onChange={e => updateUnitRentFree(term.unitId, idx, 'end', e.target.value)} />
                                                                </div>
                                                                <div className="md:col-span-5">
                                                                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">说明备注</label>
                                                                    <input type="text" className="w-full border p-2 rounded-lg text-sm" value={rf.description} onChange={e => updateUnitRentFree(term.unitId, idx, 'description', e.target.value)} placeholder="如：该房源装修免租" />
                                                                </div>
                                                                <div className="md:col-span-1 flex md:justify-end">
                                                                    <button type="button" onClick={() => removeUnitRentFree(term.unitId, idx)} className="liquid-pressable rounded-2xl p-2 text-rose-500 hover:bg-rose-50/80"><Trash2 size={16}/></button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:col-span-2">
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">签约日期 <span className="text-red-500">*</span></label><input type="date" className={`w-full border p-2.5 rounded-lg text-sm ${formErrors.signingDate ? 'border-red-500' : 'border-slate-300'}`} value={currentTenant.signingDate || ''} onChange={e => setCurrentTenant({...currentTenant, signingDate: e.target.value})} /></div>
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">起租日期 <span className="text-red-500">*</span></label><input type="date" className={`w-full border p-2.5 rounded-lg text-sm ${formErrors.leaseStart ? 'border-red-500' : 'border-slate-300'}`} value={currentTenant.leaseStart || ''} onChange={e => setCurrentTenant({...currentTenant, leaseStart: e.target.value})} /></div>
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">结束日期 <span className="text-red-500">*</span></label><input type="date" className={`w-full border p-2.5 rounded-lg text-sm ${formErrors.leaseEnd ? 'border-red-500' : 'border-slate-300'}`} value={currentTenant.leaseEnd || ''} onChange={e => setCurrentTenant({...currentTenant, leaseEnd: e.target.value})} /></div>
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">实际入驻日期</label><input type="date" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.moveInDate || ''} onChange={e => setCurrentTenant({...currentTenant, moveInDate: e.target.value || undefined})} /><p className="text-[10px] text-slate-400 mt-1">用于入园周年等关键时刻；不填则按起租日</p></div>
                            </div>
                        </div>
                    </section>

                    {renewalHistory.length > 1 && (
                        <section className="space-y-4 p-4 md:p-6">
                            <div className="contract-section-heading mb-2 text-cyan-700"><Clock size={18}/> <span>历史签约记录</span></div>
                            <div className="contract-compact-table overflow-x-auto rounded-2xl">
                                <table className="w-full text-sm min-w-[720px]">
                                    <thead className="bg-slate-50 text-slate-500">
                                        <tr>
                                            <th className="px-4 py-2 text-left">期次</th>
                                            <th className="px-4 py-2 text-left">签约日期</th>
                                            <th className="px-4 py-2 text-left">租期</th>
                                            <th className="px-4 py-2 text-left">合同单价</th>
                                            <th className="px-4 py-2 text-left">状态</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {renewalHistory.map((h, idx) => {
                                            const unitPrice = h.unitPrice || (h.totalArea ? (h.monthlyRent / h.totalArea * 12 / 365) : 0);
                                            return (
                                                <tr key={h.id} className={h.isCurrentEditing ? 'bg-blue-50/50' : ''}>
                                                    <td className="px-4 py-2 text-slate-700 font-medium">
                                                        第{idx + 1}期
                                                        {h.isCurrentEditing && <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">当前编辑</span>}
                                                    </td>
                                                    <td className="px-4 py-2 text-slate-600">{h.signingDate || '-'}</td>
                                                    <td className="px-4 py-2 text-slate-600">{h.leaseStart} ~ {h.leaseEnd}</td>
                                                    <td className="px-4 py-2 text-blue-600 font-bold">{formatCurrency(unitPrice)}</td>
                                                    <td className="px-4 py-2">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${h.status === ContractStatus.Active ? 'bg-blue-100 text-blue-700' : h.status === ContractStatus.Terminated ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                                            {h.status === ContractStatus.Terminated && h.terminationType === 'Early' ? '提前退租' : contractStatusTextMap[h.status]}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-xs text-slate-400">同一客户续签链按租期顺序展示，用于核对历史合同演进。</p>
                        </section>
                    )}

                    {viewRentPricing && (
                    <>
                    {/* 2. Rent & Payments */}
                    <section className="space-y-4 p-4 md:p-6">
                        <div className="contract-section-heading mb-2"><DollarSign size={18}/> <span>租金与支付</span></div>

                        {/* 租金输入模式：按单价运算 / 直接填月租金 */}
                        <div className="liquid-glass-control flex w-fit items-center gap-1 rounded-full p-1">
                            <button type="button"
                                onClick={() => {
                                    const mode = currentTenant.unitPriceMode || 'daily';
                                    const area = currentTenant.totalArea || 0;
                                    const curRent = currentTenant.monthlyRent || 0;
                                    const price = currentTenant.unitPrice || (area > 0 ? Number((curRent / area * (mode === 'monthly' ? 1 : 12/365)).toFixed(2)) : 0);
                                    const rent = calculateMonthlyRentFromUnitPrice(price, area, mode);
                                    setCurrentTenant({...currentTenant, unitPrice: price || undefined, monthlyRent: rent, unitPriceMode: mode});
                                    setRentInputMode('byUnitPrice');
                                }}
                                className={`liquid-pressable rounded-full px-3 py-1.5 text-xs font-black transition-colors ${rentInputMode === 'byUnitPrice' ? 'liquid-action-strong' : 'text-slate-500 hover:text-slate-700'}`}>
                                按单价运算
                            </button>
                            <button type="button"
                                onClick={() => {
                                    setCurrentTenant({...currentTenant, unitPrice: undefined, unitPriceMode: undefined});
                                    setRentInputMode('direct');
                                }}
                                className={`liquid-pressable rounded-full px-3 py-1.5 text-xs font-black transition-colors ${rentInputMode === 'direct' ? 'liquid-action-strong' : 'text-slate-500 hover:text-slate-700'}`}>
                                直接填月租金
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {rentInputMode === 'byUnitPrice' ? (
                                // 按单价运算模式
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="text-sm font-medium text-slate-600">
                                            租金单价 ({(currentTenant.unitPriceMode || 'daily') === 'monthly' ? '元/㎡/月' : '元/㎡/天'})
                                        </label>
                                        <button type="button"
                                            onClick={() => {
                                                const newMode = (currentTenant.unitPriceMode || 'daily') === 'monthly' ? 'daily' : 'monthly';
                                                const curPrice = currentTenant.unitPrice || 0;
                                                const newPrice = newMode === 'daily'
                                                    ? Number((curPrice * 12 / 365).toFixed(2))
                                                    : Number((curPrice * 365 / 12).toFixed(2));
                                                setCurrentTenant({ ...currentTenant, unitPriceMode: newMode, unitPrice: newPrice });
                                            }}
                                            className="contract-subtle-action liquid-pressable rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors">
                                            切换为{(currentTenant.unitPriceMode || 'daily') === 'monthly' ? '元/㎡/天' : '元/㎡/月'}
                                        </button>
                                    </div>
                                    <div className="relative"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">¥</span>
                                        <input type="number" inputMode="decimal" enterKeyHint="done" step="0.01" className="w-full border border-slate-300 pl-7 pr-3 py-2.5 rounded-lg text-sm font-mono"
                                            value={currentTenant.unitPrice || ''} onChange={e => {
                                                const price = Number(e.target.value);
                                                const mode = currentTenant.unitPriceMode || 'daily';
                                                const existingTerms = syncUnitTermsForSelection(currentTenant, currentTenant.unitIds || []);
                                                if (existingTerms.length > 0) {
                                                    const unitTerms = existingTerms.map(term => ({
                                                        ...term, unitPrice: price,
                                                        monthlyRent: calculateMonthlyRentFromUnitPrice(price, term.area || 0, mode),
                                                    }));
                                                    setCurrentTenant(applyUnitTermsSummary({ ...currentTenant, unitPrice: price }, unitTerms));
                                                    return;
                                                }
                                                const rent = calculateMonthlyRentFromUnitPrice(price, currentTenant.totalArea || 0, mode);
                                                setCurrentTenant({...currentTenant, unitPrice: price, monthlyRent: rent});
                                            }} />
                                    </div>
                                </div>
                            ) : (
                                // 直接填月租金模式
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-slate-600">月租金总额</label>
                                    <div className="relative"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">¥</span>
                                        <input type="number" inputMode="decimal" enterKeyHint="done" className="w-full border border-slate-300 pl-7 pr-3 py-2.5 rounded-lg text-sm font-bold"
                                            value={currentTenant.monthlyRent || ''}
                                            onChange={e => setCurrentTenant({...currentTenant, monthlyRent: Number(e.target.value), unitPrice: undefined, unitPriceMode: undefined})} />
                                    </div>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium mb-1.5 text-slate-600">
                                    {rentInputMode === 'byUnitPrice' ? '月租金（自动计算）' : '月租金'}
                                </label>
                                <div className="relative"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">¥</span>
                                    <input type="number"
                                        inputMode="decimal"
                                        enterKeyHint="done"
                                        className={`w-full border border-slate-300 pl-7 pr-3 py-2.5 rounded-lg text-sm font-bold ${rentInputMode === 'byUnitPrice' ? 'bg-slate-50' : ''}`}
                                        value={currentTenant.monthlyRent || ''}
                                        readOnly={rentInputMode === 'byUnitPrice'}
                                        onChange={e => setCurrentTenant({...currentTenant, monthlyRent: Number(e.target.value)})} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1.5 text-slate-600">支付频率 {!isMobileQueryOnly && currentTenant.id && <button type="button" onClick={() => setShowCycleChange(true)} className="ml-2 text-xs text-amber-600 hover:text-amber-700 underline">变更周期</button>}</label>
                                <select
                                    className="w-full border border-slate-300 p-2.5 rounded-lg text-sm"
                                    value={currentTenant.paymentCycle || 'Quarterly'}
                                    onChange={e => {
                                        const cycle = e.target.value as Tenant['paymentCycle'];
                                        const months = cycle === 'Custom'
                                            ? (currentTenant.paymentCycleMonths && currentTenant.paymentCycleMonths > 0 ? currentTenant.paymentCycleMonths : 3)
                                            : paymentCycleMonthMap[cycle];
                                        
                                        setCurrentTenant({
                                            ...currentTenant, 
                                            paymentCycle: cycle, 
                                            paymentCycleMonths: months,
                                            firstPaymentMonths: months 
                                        });
                                    }}
                                >
                                    {Object.entries(paymentCycleLabelMap).map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </select>
                            </div>
                            {currentTenant.paymentCycle === 'Custom' && (
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-slate-600">自定义付款周期（月）</label>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        enterKeyHint="done"
                                        min="0.5"
                                        step="0.5"
                                        className="w-full border border-slate-300 p-2.5 rounded-lg text-sm"
                                        value={currentTenant.paymentCycleMonths || ''}
                                        onChange={e => {
                                            const months = Math.max(0.5, Number(e.target.value) || 0.5);
                                            setCurrentTenant({
                                                ...currentTenant,
                                                paymentCycleMonths: months,
                                                firstPaymentMonths: months,
                                            });
                                        }}
                                        placeholder="例如：1.5、2、4"
                                    />
                                    <p className="mt-1 text-xs text-slate-400">支持 0.5 个月为最小单位。</p>
                                </div>
                            )}
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">首期支付日</label><input type="date" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.firstPaymentDate || ''} onChange={e => setCurrentTenant({...currentTenant, firstPaymentDate: e.target.value})} /></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">首期应收自定义（元，可选）</label><input type="number" inputMode="decimal" enterKeyHint="done" step="0.01" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm font-mono" placeholder="不填则按系统计费" value={currentTenant.firstReceivableAmount ?? ''} onChange={e => setCurrentTenant({ ...currentTenant, firstReceivableAmount: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">首期覆盖起（可选）</label><input type="date" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.firstReceivableStartDate || ''} onChange={e => setCurrentTenant({ ...currentTenant, firstReceivableStartDate: e.target.value || undefined })} /></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">首期覆盖止（可选）</label><input type="date" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.firstReceivableEndDate || ''} onChange={e => setCurrentTenant({ ...currentTenant, firstReceivableEndDate: e.target.value || undefined })} /></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">押金金额</label><div className="relative"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">¥</span><input type="number" inputMode="decimal" enterKeyHint="done" className="w-full border border-slate-300 pl-7 pr-3 py-2.5 rounded-lg text-sm" value={currentTenant.depositAmount || ''} onChange={e => setCurrentTenant({...currentTenant, depositAmount: Number(e.target.value)})} /></div></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">押金状态</label><select className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.depositStatus || DepositStatus.Unpaid} onChange={e => setCurrentTenant({...currentTenant, depositStatus: e.target.value as any})}>
                                <option value={DepositStatus.Unpaid}>待缴</option><option value={DepositStatus.Paid}>已收</option><option value={DepositStatus.Refunded}>已退</option>
                            </select></div>
                        </div>
                    </section>

                    {!viewRentPricing && mgmtFeeParkEnabled && (
                            <p className="contract-inline-panel rounded-2xl px-4 py-3 text-sm text-cyan-800">
                            当前为物业人员视图：租金、押金等招商价格已隐藏，请维护物业费条款与收款核销。
                        </p>
                    )}
                    {(mgmtFeeParkEnabled || isManagementFeeBillingEnabled(currentTenant.projectId)) && (
                    <section className="space-y-4 p-4 md:p-6">
                            <div className="space-y-4">
                                <div className="contract-section-heading text-sm text-cyan-700">物业费条款</div>
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={currentTenant.managementFeeEnabled !== false} onChange={(e) => setCurrentTenant({ ...currentTenant, managementFeeEnabled: e.target.checked })} />
                                    收取物业费
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={!!currentTenant.managementFeeExempt} onChange={(e) => setCurrentTenant({ ...currentTenant, managementFeeExempt: e.target.checked })} />
                                    全租期免物业费
                                </label>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-slate-600">
                                        物业费单价（元/月/㎡）
                                    </label>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        enterKeyHint="done"
                                        step="0.01"
                                        min="0"
                                        placeholder="例如 15"
                                        className="w-full max-w-xs border border-slate-300 p-2.5 rounded-lg text-sm"
                                        value={
                                            toManagementFeeMonthlyUnitPrice(
                                                currentTenant.managementFeeUnitPrice,
                                                currentTenant.managementFeeUnitPriceMode,
                                            ) ?? ''
                                        }
                                        onChange={(e) =>
                                            setCurrentTenant({
                                                ...currentTenant,
                                                managementFeeUnitPrice:
                                                    e.target.value === '' ? undefined : Number(e.target.value),
                                                managementFeeUnitPriceMode: 'monthly',
                                                managementFeeMonthlyAmount: undefined,
                                            })
                                        }
                                    />
                                    <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                                        签约面积 {formatArea(currentTenant.totalArea || 0)} · 月物业费 = 单价 × 面积 ={' '}
                                        <span className="font-medium text-cyan-800">
                                            {formatCurrency(resolveManagementFeeMonthly(currentTenant as Tenant))}
                                        </span>
                                    </p>
                                </div>
                                <div className="border-t border-slate-100 pt-4 space-y-3">
                                    <div className="text-sm font-medium text-slate-700">物业费起算时间</div>
                                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="mt-0.5"
                                            checked={currentTenant.managementFeeStartWithOccupancy !== false}
                                            onChange={(e) => {
                                                const withOccupancy = e.target.checked;
                                                setCurrentTenant({
                                                    ...currentTenant,
                                                    managementFeeStartWithOccupancy: withOccupancy,
                                                    ...(withOccupancy ? { managementFeeStartDate: undefined } : {}),
                                                });
                                            }}
                                        />
                                        <span>
                                            同招商租赁合同入驻时间
                                            <span className="block text-xs text-slate-500 font-normal">
                                                以实际入驻日为准，未填则按起租日
                                            </span>
                                        </span>
                                    </label>
                                    {currentTenant.managementFeeStartWithOccupancy !== false ? (
                                        <p className="contract-inline-panel rounded-2xl px-3 py-2 text-sm text-cyan-800">
                                            起算日：
                                            {resolveLeaseOccupancyDate(currentTenant as Tenant) || '请先填写起租日或实际入驻日期'}
                                            {currentTenant.moveInDate?.trim()
                                                ? '（实际入驻日）'
                                                : currentTenant.leaseStart
                                                  ? '（起租日）'
                                                  : ''}
                                        </p>
                                    ) : (
                                        <div>
                                            <label className="block text-sm font-medium mb-1.5 text-slate-600">
                                                自定义起算日
                                            </label>
                                            <input
                                                type="date"
                                                className="w-full max-w-xs border border-slate-300 p-2.5 rounded-lg text-sm"
                                                value={currentTenant.managementFeeStartDate || ''}
                                                onChange={(e) =>
                                                    setCurrentTenant({
                                                        ...currentTenant,
                                                        managementFeeStartWithOccupancy: false,
                                                        managementFeeStartDate: e.target.value || undefined,
                                                    })
                                                }
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                    </section>
                    )}

                    {currentTenant.status === ContractStatus.Terminated &&
                        currentTenant.terminationType === 'Early' &&
                        currentTenant.terminationDate && (
                            <section className="contract-alert-panel space-y-4 p-4 md:p-6">
                                <div className="flex items-center gap-2 text-amber-800 font-black">
                                    <Receipt size={18} /> <span>提前退租最后一期结算</span>
                                </div>
                                <p className="text-xs text-amber-900/80 leading-relaxed">
                                    <strong>本期租金</strong>仍按付款周期出现在<strong>原收款日</strong>（预览表中带覆盖周期的常规行）；<strong>免租扣回、押金扣款、其它调整</strong>单独生成一笔<strong>退租日当天</strong>的「提前退租结算」行，避免与季付/半月付提前收款节奏混淆。
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1.5 text-slate-700">免租扣回覆盖（元，可选）</label>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            enterKeyHint="done"
                                            className="w-full border border-slate-300 p-2.5 rounded-lg text-sm"
                                            placeholder="留空则按公式自动"
                                            value={currentTenant.earlyTerminationFreeRentClawbackOverride ?? ''}
                                            onChange={(e) =>
                                                setCurrentTenant({
                                                    ...currentTenant,
                                                    earlyTerminationFreeRentClawbackOverride:
                                                        e.target.value === '' ? undefined : Number(e.target.value),
                                                })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1.5 text-slate-700">押金扣款（元）</label>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            enterKeyHint="done"
                                            min={0}
                                            className="w-full border border-slate-300 p-2.5 rounded-lg text-sm"
                                            value={currentTenant.earlyTerminationDepositDeduction ?? ''}
                                            onChange={(e) =>
                                                setCurrentTenant({
                                                    ...currentTenant,
                                                    earlyTerminationDepositDeduction:
                                                        e.target.value === '' ? undefined : Number(e.target.value),
                                                })
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1.5 text-slate-700">最后应收调整（元）</label>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            enterKeyHint="done"
                                            className="w-full border border-slate-300 p-2.5 rounded-lg text-sm"
                                            placeholder="正数加收，负数抵扣（如水电、物业）"
                                            value={currentTenant.earlyTerminationOtherAdjustment ?? ''}
                                            onChange={(e) =>
                                                setCurrentTenant({
                                                    ...currentTenant,
                                                    earlyTerminationOtherAdjustment:
                                                        e.target.value === '' ? undefined : Number(e.target.value),
                                                })
                                            }
                                        />
                                    </div>
                                </div>
                                <div className="contract-inline-panel rounded-2xl p-2 font-mono text-xs text-slate-600">
                                    公式试算免租扣回：¥
                                    {computeEarlyTerminationFreeRentClawbackAmount(currentTenant as Tenant).toLocaleString()}
                                </div>
                            </section>
                        )}

                    {/* 3. Rent Free Periods */}
                    <section className="space-y-4 p-4 md:p-6">
                         <div className="flex justify-between items-center mb-2">
                             <div className="contract-section-heading"><Gift size={18}/> <span>免租期设定</span></div>
                             <button onClick={addRentFree} className="contract-soft-action liquid-pressable flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black transition-colors"><Plus size={14}/> 添加免租段</button>
                         </div>
                         <div className="space-y-3">
                             {currentTenant.rentFreePeriods?.map((rf, idx) => (
                                 <div key={idx} className="contract-inline-panel relative grid grid-cols-1 gap-3 rounded-2xl p-4 md:grid-cols-12">
                                     <div className="md:col-span-2"><label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">开始日期</label><input type="date" className="w-full border p-2 rounded-lg text-sm" value={rf.start} onChange={e => updateRentFree(idx, 'start', e.target.value)} /></div>
                                     <div className="md:col-span-2"><label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">结束日期</label><input type="date" className="w-full border p-2 rounded-lg text-sm" value={rf.end} onChange={e => updateRentFree(idx, 'end', e.target.value)} /></div>
                                     <div className="md:col-span-2">
                                         <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">扣减口径</label>
                                         <select
                                             className="w-full border p-2 rounded-lg text-sm bg-white"
                                             value={rf.deductionMode || 'monthly'}
                                             onChange={e => updateRentFree(idx, 'deductionMode', e.target.value as RentFreeDeductionMode)}
                                         >
                                             <option value="monthly">按月租折算</option>
                                             <option value="fixed">固定金额</option>
                                         </select>
                                     </div>
                                     <div className="md:col-span-2">
                                         <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">固定减免(元)</label>
                                         <input
                                             type="number"
                                             inputMode="decimal"
                                             enterKeyHint="done"
                                             step="0.01"
                                             disabled={(rf.deductionMode || 'monthly') !== 'fixed'}
                                             className="w-full border p-2 rounded-lg text-sm font-mono disabled:bg-slate-100"
                                             value={rf.deductionAmount ?? ''}
                                             onChange={e =>
                                                 updateRentFree(
                                                     idx,
                                                     'deductionAmount',
                                                     e.target.value === '' ? 0 : Number(e.target.value),
                                                 )
                                             }
                                         />
                                     </div>
                                     <div className="md:col-span-3"><label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">说明备注</label><input type="text" placeholder="如：装修免租" className="w-full border p-2 rounded-lg text-sm" value={rf.description} onChange={e => updateRentFree(idx, 'description', e.target.value)} /></div>
                                     <div className="md:col-span-1 flex items-end justify-center"><button onClick={() => removeRentFree(idx)} className="liquid-pressable rounded-2xl p-2 text-rose-500 hover:bg-rose-50"><Trash2 size={18}/></button></div>
                                 </div>
                             ))}
                             {(!currentTenant.rentFreePeriods || currentTenant.rentFreePeriods.length === 0) && <div className="contract-empty-state rounded-2xl py-6 text-center text-sm italic">暂未设定免租期</div>}
                         </div>
                         
                         {/* 免租期处理方式 */}
                         {currentTenant.rentFreePeriods && currentTenant.rentFreePeriods.length > 0 && (
                             <div className="mt-4 border-t border-white/70 pt-4">
                                 <label className="block text-sm font-black mb-3 text-slate-800">
                                     <span className="text-blue-700">口径</span> 免租期处理方式
                                 </label>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                     <button
                                         type="button"
                                         onClick={() => setCurrentTenant({...currentTenant, freeRentHandling: 'Defer'})}
                                         data-active={currentTenant.freeRentHandling === 'Defer' ? 'true' : 'false'}
                                         className="contract-option-card liquid-pressable p-4 text-left transition-all"
                                     >
                                         <div className="flex items-center gap-2 mb-2">
                                             <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                                 currentTenant.freeRentHandling === 'Defer' 
                                                     ? 'border-blue-500 bg-blue-500'
                                                     : 'border-slate-300'
                                             }`}>
                                                 {currentTenant.freeRentHandling === 'Defer' && (
                                                     <div className="w-2 h-2 bg-white rounded-full" />
                                                 )}
                                             </div>
                                             <span className="font-black text-slate-800">账期顺延</span>
                                         </div>
                                         <p className="text-xs text-slate-600 leading-relaxed">
                                             免租期月份不产生账单，收款时间整体顺延。<br/>
                                             <span className="text-blue-700">例：1-3月免租，原12月收Q1租金 → 改为3月收Q2租金</span>
                                         </p>
                                     </button>
                                     
                                     <button
                                         type="button"
                                         onClick={() => setCurrentTenant({...currentTenant, freeRentHandling: 'Deduct'})}
                                         data-active={currentTenant.freeRentHandling === 'Deduct' ? 'true' : 'false'}
                                         className="contract-option-card liquid-pressable p-4 text-left transition-all"
                                     >
                                         <div className="flex items-center gap-2 mb-2">
                                             <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                                 currentTenant.freeRentHandling === 'Deduct' 
                                                     ? 'border-cyan-600 bg-cyan-600'
                                                     : 'border-slate-300'
                                             }`}>
                                                 {currentTenant.freeRentHandling === 'Deduct' && (
                                                     <div className="w-2 h-2 bg-white rounded-full" />
                                                 )}
                                             </div>
                                             <span className="font-black text-slate-800">当期账单扣除</span>
                                         </div>
                                         <p className="text-xs text-slate-600 leading-relaxed">
                                             在当期账单中扣除免租期月数，收款时间不变但金额减少。<br/>
                                             <span className="text-blue-700">例：1月免租，原12月收Q1(3个月) → 改为12月收只收取2个月(2-3月)</span>
                                         </p>
                                     </button>
                                 </div>
                             </div>
                         )}
                    </section>

                    {/* 固定金额减免（补充协议等） */}
                    <section className="space-y-4 p-4 md:p-6">
                        <div className="flex justify-between items-center">
                            <div className="contract-section-heading text-cyan-700">
                                <Receipt size={18} />
                                <span>固定金额减免</span>
                            </div>
                            <button
                                type="button"
                                onClick={addFixedRentReduction}
                                className="contract-soft-action liquid-pressable flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black"
                            >
                                <Plus size={14} /> 添加减免段
                            </button>
                        </div>
                        <p className="text-xs text-cyan-800/80 leading-relaxed">
                            用于「上半年应缴 130,670、减免 66,282.16、实缴 64,387.84」类约定：在覆盖期内按账单比例扣减{' '}
                            <strong>减免金额</strong>，不按整月×月租计算。请勿与整段免租重复录入同一区间。
                        </p>
                        <div className="space-y-3">
                            {(currentTenant.rentReductions || []).map((rr, idx) => (
                                <div
                                    key={rr.id}
                                    className="contract-inline-panel grid grid-cols-1 gap-3 rounded-2xl p-4 md:grid-cols-12"
                                >
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-bold text-slate-500 mb-1">覆盖起</label>
                                        <input
                                            type="date"
                                            className="w-full border p-2 rounded-lg text-sm"
                                            value={rr.start}
                                            onChange={e => updateFixedRentReduction(idx, 'start', e.target.value)}
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-bold text-slate-500 mb-1">覆盖止</label>
                                        <input
                                            type="date"
                                            className="w-full border p-2 rounded-lg text-sm"
                                            value={rr.end}
                                            onChange={e => updateFixedRentReduction(idx, 'end', e.target.value)}
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-bold text-slate-500 mb-1">协议应缴(可选)</label>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            enterKeyHint="done"
                                            step="0.01"
                                            className="w-full border p-2 rounded-lg text-sm font-mono"
                                            value={rr.grossAmount ?? ''}
                                            onChange={e =>
                                                updateFixedRentReduction(
                                                    idx,
                                                    'grossAmount',
                                                    e.target.value === '' ? 0 : Number(e.target.value),
                                                )
                                            }
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-bold text-slate-500 mb-1">减免金额</label>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            enterKeyHint="done"
                                            step="0.01"
                                            className="w-full border p-2 rounded-lg text-sm font-mono"
                                            value={rr.reductionAmount || ''}
                                            onChange={e =>
                                                updateFixedRentReduction(
                                                    idx,
                                                    'reductionAmount',
                                                    e.target.value === '' ? 0 : Number(e.target.value),
                                                )
                                            }
                                        />
                                    </div>
                                    <div className="md:col-span-3">
                                        <label className="block text-[10px] font-bold text-slate-500 mb-1">原因</label>
                                        <input
                                            type="text"
                                            className="w-full border p-2 rounded-lg text-sm"
                                            placeholder="如：补充协议2025.4.29-733"
                                            value={rr.reason || ''}
                                            onChange={e => updateFixedRentReduction(idx, 'reason', e.target.value)}
                                        />
                                    </div>
                                    <div className="md:col-span-1 flex items-end justify-center">
                                        <button
                                            type="button"
                                            onClick={() => removeFixedRentReduction(idx)}
                                            className="liquid-pressable rounded-2xl p-2 text-rose-500 hover:bg-rose-50"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {(!currentTenant.rentReductions || currentTenant.rentReductions.length === 0) && (
                                <div className="contract-empty-state rounded-2xl py-4 text-center text-sm italic">
                                    暂无固定金额减免
                                </div>
                            )}
                        </div>
                    </section>

                    {/* 按月金额调整（amount_delta，叠加预算方案） */}
                    {currentTenant.id && onUpdateAdjustments && (
                        <section className="space-y-3 p-4 md:p-6">
                            <div className="flex justify-between items-center">
                                <div className="contract-section-heading text-sm text-cyan-700">
                                    <ArrowLeftRight size={16} />
                                    按月金额调整（预算层）
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowAmountDeltaForm(!showAmountDeltaForm)}
                                    className="contract-soft-action liquid-pressable rounded-full px-3 py-1.5 text-xs font-black"
                                >
                                    {showAmountDeltaForm ? '取消' : '+ 新增调整'}
                                </button>
                            </div>
                            <p className="text-xs text-blue-800/80">
                                在指定<strong>收款日所在月</strong>对账单金额加减（不挪账期）。保存园区数据后写入预算调整，预览时请勾选「叠加存量调优」。
                            </p>
                            {showAmountDeltaForm && (
                                <div className="contract-inline-panel grid grid-cols-2 gap-3 rounded-2xl p-3 md:grid-cols-5">
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-1">年份</label>
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            enterKeyHint="done"
                                            className="w-full border p-2 rounded text-sm"
                                            value={amountDeltaForm.adjustedYear}
                                            onChange={e =>
                                                setAmountDeltaForm((f) => ({
                                                    ...f,
                                                    adjustedYear: Number(e.target.value),
                                                }))
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-1">月份</label>
                                        <select
                                            className="w-full border p-2 rounded text-sm"
                                            value={amountDeltaForm.adjustedMonth}
                                            onChange={e =>
                                                setAmountDeltaForm((f) => ({
                                                    ...f,
                                                    adjustedMonth: Number(e.target.value),
                                                }))
                                            }
                                        >
                                            {Array.from({ length: 12 }, (_, m) => (
                                                <option key={m} value={m}>
                                                    {m + 1}月
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-1">金额(元)</label>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            enterKeyHint="done"
                                            step="0.01"
                                            className="w-full border p-2 rounded text-sm font-mono"
                                            value={amountDeltaForm.amount || ''}
                                            onChange={e =>
                                                setAmountDeltaForm((f) => ({
                                                    ...f,
                                                    amount: e.target.value === '' ? 0 : Number(e.target.value),
                                                }))
                                            }
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-bold text-slate-500 mb-1">原因</label>
                                        <input
                                            type="text"
                                            className="w-full border p-2 rounded text-sm"
                                            value={amountDeltaForm.reason}
                                            onChange={e =>
                                                setAmountDeltaForm((f) => ({ ...f, reason: e.target.value }))
                                            }
                                        />
                                    </div>
                                    <div className="col-span-full flex justify-end">
                                        <button
                                            type="button"
                                            onClick={handleAddAmountDelta}
                                            className="liquid-action-strong liquid-pressable rounded-full px-4 py-2 text-xs font-black"
                                        >
                                            添加
                                        </button>
                                    </div>
                                </div>
                            )}
                            {tenantAmountDeltaAdjustments.length > 0 ? (
                                <ul className="space-y-2 text-xs">
                                    {tenantAmountDeltaAdjustments.map((a) => (
                                        <li
                                            key={a.id}
                                            className="contract-inline-panel flex items-center justify-between gap-2 rounded-2xl p-2"
                                        >
                                            <span>
                                                {a.adjustedYear}年{a.adjustedMonth + 1}月{' '}
                                                <strong className={a.amount >= 0 ? 'text-blue-700' : 'text-rose-700'}>
                                                    {a.amount >= 0 ? '+' : ''}
                                                    {formatCurrency(a.amount)}
                                                </strong>
                                                {a.reason ? ` · ${a.reason}` : ''}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveAmountDelta(a.id)}
                                                className="liquid-pressable rounded-full p-1 text-rose-500 hover:text-rose-700"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div className="contract-empty-state rounded-2xl px-3 py-3 text-xs italic">暂无按月金额调整</div>
                            )}
                        </section>
                    )}

                    <section className="space-y-4 p-4 md:p-6">
                         {/* 账单明细预览 */}
                        {currentTenant.leaseStart && currentTenant.leaseEnd &&
                         currentTenant.monthlyRent && currentTenant.monthlyRent > 0 && (
	                             <div className="mt-4 border-t border-white/70 pt-4">
	                                 {(() => {
	                                     if (!receivablePreviewContext) return null;
	                                     const {
	                                         inheritedProjectId,
	                                         tenantForPreview,
	                                         previewStart,
	                                         previewEnd,
	                                         allAssumptions,
	                                         existingTenantAssumptions,
	                                         tenantAdjustments,
	                                         hasExistingBudgetItems,
	                                         hasVacancyBudgetItems,
	                                         showBillingDiffOverlay,
	                                         willApplyBudget,
	                                     } = receivablePreviewContext;
	                                     const bills = receivablePreviewState.bills;

	                                     const showMgmtPreview =
	                                         isManagementFeeBillingEnabled(inheritedProjectId) &&
	                                         shouldGenerateManagementFeeBills(tenantForPreview);
	                                     const mgmtBills = showMgmtPreview
	                                         ? generateManagementFeeBills(tenantForPreview, previewStart, previewEnd)
	                                         : [];

	                                     if (receivablePreviewState.loading) {
	                                         return (
	                                             <div className="text-center py-4 text-slate-400 text-sm">
	                                                 后台正在计算账单预览...
	                                             </div>
	                                         );
	                                     }
                                         if (receivablePreviewState.error) {
                                             return (
                                                 <div className="contract-alert-panel flex items-start gap-2 px-3 py-2 text-xs text-amber-900">
                                                     <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                                     <span>{receivablePreviewState.error}</span>
                                                 </div>
                                             );
                                         }

	                                     // 同时生成「纯合同口径」用于对照（有预算层时计算）
	                                     const billsRaw = showBillingDiffOverlay ? receivablePreviewState.rawBills : bills;
	                                     const vacancyBudgetNote = buildVacancyBudgetAlignmentNote(
	                                         {
	                                             unitIds: currentTenant.unitIds || [],
                                             leaseStart: currentTenant.leaseStart,
                                         },
                                         allAssumptions,
                                     );
                                     const rawDateAmtSet = new Set(
                                         billsRaw.map(b => `${b.date.getFullYear()}-${b.date.getMonth()}-${b.date.getDate()}|${b.amount.toFixed(2)}`)
                                     );
                                     const rawDateSet = new Set(
                                         billsRaw.map(b => `${b.date.getFullYear()}-${b.date.getMonth()}-${b.date.getDate()}`)
                                     );

                                     if (bills.length === 0 && mgmtBills.length === 0) {
                                         return (
                                             <div className="text-center py-4 text-slate-400 text-sm">
                                                 无法生成账单预览，请检查合同信息
                                             </div>
                                         );
                                     }

                                     const billDateKey = (d: Date) =>
                                         `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                                     type ReceivablePreviewRow = {
                                         date: Date;
                                         rentAmount: number;
                                         mgmtAmount: number;
                                         rentCoverageStart?: Date;
                                         rentCoverageEnd?: Date;
                                         mgmtCoverageStart?: Date;
                                         mgmtCoverageEnd?: Date;
                                         rentBill?: (typeof bills)[number];
                                     };
                                     const previewRowMap = new Map<string, ReceivablePreviewRow>();
                                     for (const bill of bills) {
                                         const k = billDateKey(bill.date);
                                         const row = previewRowMap.get(k) || {
                                             date: bill.date,
                                             rentAmount: 0,
                                             mgmtAmount: 0,
                                         };
                                         row.rentAmount += bill.amount;
                                         row.rentBill = bill;
                                         row.rentCoverageStart = bill.coverageStart || row.rentCoverageStart;
                                         row.rentCoverageEnd = bill.coverageEnd || row.rentCoverageEnd;
                                         previewRowMap.set(k, row);
                                     }
                                     for (const bill of mgmtBills) {
                                         const k = billDateKey(bill.date);
                                         const row = previewRowMap.get(k) || {
                                             date: bill.date,
                                             rentAmount: 0,
                                             mgmtAmount: 0,
                                         };
                                         row.mgmtAmount += bill.amount;
                                         row.mgmtCoverageStart = bill.coverageStart || row.mgmtCoverageStart;
                                         row.mgmtCoverageEnd = bill.coverageEnd || row.mgmtCoverageEnd;
                                         previewRowMap.set(k, row);
                                     }
                                     const previewRows = Array.from(previewRowMap.values()).sort(
                                         (a, b) => a.date.getTime() - b.date.getTime(),
                                     );

                                     const firstCustomBillIdx = (() => {
                                         const amt = currentTenant.firstReceivableAmount;
                                         if (amt == null || amt <= 0 || bills.length === 0) return -1;
                                         let best = 0;
                                         for (let i = 1; i < bills.length; i++) {
                                             if (bills[i].date.getTime() < bills[best].date.getTime()) best = i;
                                         }
                                         const targetKey = billDateKey(bills[best].date);
                                         return previewRows.findIndex((r) => billDateKey(r.date) === targetKey);
                                     })();
                                     
                                     // 计算财务汇总
                                     const totalRentReceivable = bills.reduce((sum, bill) => sum + bill.amount, 0);
                                     const totalMgmtReceivable = mgmtBills.reduce((sum, bill) => sum + bill.amount, 0);
                                     const totalReceivable = totalRentReceivable + totalMgmtReceivable;
                                     
                                     // 关联实际收款（根据 tenantId 匹配）
                                     const tenantPayments = payments.filter(p => p.tenantId === currentTenant.id);
                                     const totalPaid = tenantPayments.reduce((sum, p) => sum + p.amount, 0);
                                     
                                     // 计算合同总月数
                                     const leaseStartDate = new Date(currentTenant.leaseStart!);
                                     const leaseEndDate = new Date(currentTenant.leaseEnd!);
                                     const totalMonths = (leaseEndDate.getFullYear() - leaseStartDate.getFullYear()) * 12 + 
                                                         (leaseEndDate.getMonth() - leaseStartDate.getMonth()) + 1;
                                     
                                     // 月均收款（基于实际收款）
                                     const avgMonthlyPayment = totalMonths > 0 ? totalPaid / totalMonths : 0;
                                     
                                     // 实际月租金单价（元/天/㎡）
                                     // 公式：应收总额 / 合同月数 / 面积 / 30天
                                     const actualDailyPrice = currentTenant.totalArea && currentTenant.totalArea > 0 && totalMonths > 0
                                         ? totalRentReceivable / totalMonths / currentTenant.totalArea / 30
                                         : 0;
                                     
                                     return (
                                         <div className="space-y-4">
                                             {/* 财务汇总卡片 */}
                                             <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                                                 <div className="contract-stat-card p-4">
                                                     <div className="flex items-center gap-2 mb-2">
                                                         <Receipt size={16} className="text-blue-600" />
                                                         <span className="text-xs font-bold text-blue-700">应收总额</span>
                                                     </div>
                                                    <div className="text-2xl font-bold text-blue-900">{formatCurrency(totalReceivable)}</div>
                                                     <div className="text-xs text-blue-600 mt-1">
                                                         合同期内共{previewRows.length}期
                                                         {showMgmtPreview && totalMgmtReceivable > 0 ? (
                                                             <span className="block text-cyan-700 mt-0.5">
                                                                 租金 {formatCurrency(totalRentReceivable)} + 物业费{' '}
                                                                 {formatCurrency(totalMgmtReceivable)}
                                                             </span>
                                                         ) : null}
                                                     </div>
                                                 </div>
                                                 
                                                 <div className="contract-stat-card p-4">
                                                     <div className="flex items-center justify-between mb-2">
                                                         <div className="flex items-center gap-2">
                                                             <CreditCard size={16} className="text-cyan-700" />
                                                             <span className="text-xs font-bold text-cyan-700">已收总额</span>
                                                         </div>
                                                         {(() => {
                                                             // 检查是否有初始化数据（判断是否有 2026-01-01 前的数据）
                                                             const hasInitData = tenantPayments.some(p => new Date(p.date) < new Date('2026-01-01'));
                                                             if (hasInitData) {
                                                                 return (
                                                                     <span className="contract-subtle-action rounded-full px-2 py-0.5 text-xs font-bold">
                                                                         含初始化
                                                                     </span>
                                                                 );
                                                             } else if (!isMobileQueryOnly) {
                                                                 return (
                                                                     <button
                                                                         onClick={() => setShowInitPaymentModal(true)}
                                                                         className="contract-soft-action liquid-pressable flex items-center gap-1 rounded-full px-2 py-1 text-xs font-black"
                                                                     >
                                                                         <Plus size={12} />
                                                                         初始化
                                                                     </button>
                                                                 );
                                                             }
                                                             return null;
                                                         })()}
                                                     </div>
                                                    <div className="text-2xl font-bold text-cyan-900">{formatCurrency(totalPaid)}</div>
                                                     <div className="text-xs text-cyan-700 mt-1">实际收款{tenantPayments.length}笔</div>
                                                 </div>
                                                 
                                                 <div className="contract-stat-card p-4">
                                                     <div className="flex items-center gap-2 mb-2">
                                                         <TrendingUp size={16} className="text-blue-600" />
                                                         <span className="text-xs font-bold text-blue-700">月均收款</span>
                                                     </div>
                                                    <div className="text-2xl font-bold text-blue-900">{formatCurrency(avgMonthlyPayment)}</div>
                                                     <div className="text-xs text-blue-600 mt-1">合同共{totalMonths}个月</div>
                                                 </div>
                                                 
                                                <div className="contract-stat-card p-4">
                                                     <div className="flex items-center gap-2 mb-2">
                                                         <DollarSign size={16} className="text-amber-600" />
                                                         <span className="text-xs font-bold text-amber-700">实际单价</span>
                                                     </div>
                                                    <div className="text-2xl font-bold text-amber-900">{formatCurrency(actualDailyPrice)}</div>
                                                     <div className="text-xs text-amber-600 mt-1">元/天/㎡</div>
                                                 </div>
                                             </div>
                                             
                                             {/* 账单明细表格 */}
                                             <div>
                                                 <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                                                     <div className="flex flex-wrap items-center gap-2">
                                                         <Receipt size={18} className="text-blue-600" />
                                                         <span className="text-sm font-bold text-slate-800">应收款明细预览</span>
                                                         <span className="text-xs text-slate-500">（合同期内共{previewRows.length}期）</span>
                                                         {showMgmtPreview && (
                                                             <span className="contract-subtle-action rounded-full px-2 py-0.5 text-[10px] font-bold text-cyan-800">
                                                                 含物业费
                                                             </span>
                                                         )}
                                                         {willApplyBudget && (
                                                             <span className="contract-subtle-action inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-blue-700">
                                                                 <Sparkles size={10}/> 已叠加存量调优假设/调整
                                                             </span>
                                                         )}
                                                         {hasVacancyBudgetItems && (
                                                             <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                                                                 <Sparkles size={10}/> 空置去化预算已参与推算
                                                             </span>
                                                         )}
                                                         {!showBillingDiffOverlay && (
                                                             <span className="contract-subtle-action rounded-full px-2 py-0.5 text-[10px] font-bold">
                                                                 纯合同口径
                                                             </span>
                                                         )}
                                                     </div>
                                                     {hasExistingBudgetItems && (
                                                         <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                                                             <input
                                                                 type="checkbox"
                                                                 className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                                 checked={previewApplyBudget}
                                                                 onChange={(e) => setPreviewApplyBudget(e.target.checked)}
                                                             />
                                                             <span>叠加预算管理中的存量假设/调整（与「预算表」口径一致）</span>
                                                         </label>
                                                     )}
                                                 </div>

                                                 {/* 叠加项摘要提示 */}
                                                 {hasVacancyBudgetItems && vacancyBudgetNote && (
                                                     <div className="mb-3 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-900">
                                                         <Info size={14} className="text-rose-600 shrink-0 mt-0.5" />
                                                         <span>{vacancyBudgetNote}</span>
                                                     </div>
                                                 )}
                                                 {willApplyBudget &&
                                                     (() => {
                                                         const items: { tag: string; color: string; text: string }[] = [];
                                                         existingTenantAssumptions.forEach((a: any) => {
                                                             if (a.priceAdjustment) {
                                                                 items.push({
                                                                     tag: '调价',
                                                                     color: 'amber',
                                                                     text: `自 ${a.priceAdjustment.startDate} 起单价改为 ¥${a.priceAdjustment.newUnitPrice}/天/㎡`,
                                                                 });
                                                             }
                                                             if (a.billingCycleShiftMonths && a.billingCycleShiftMonths !== 0) {
                                                                 items.push({
                                                                     tag: '账期偏移',
                                                                     color: 'blue',
                                                                     text: `所有收款日期整体${a.billingCycleShiftMonths > 0 ? '推后' : '提前'} ${Math.abs(a.billingCycleShiftMonths)} 个月`,
                                                                 });
                                                             }
                                                             if (a.paymentShift?.isActive) {
                                                                 items.push({
                                                                     tag: '付款转移',
                                                                     color: 'cyan',
                                                                     text: `${a.paymentShift.fromYear}年${a.paymentShift.fromMonth + 1}月 → ${a.paymentShift.toYear}年${a.paymentShift.toMonth + 1}月，金额 ¥${a.paymentShift.amount.toLocaleString()}`,
                                                                 });
                                                             }
                                                         });
                                                         tenantAdjustments.forEach((adj: any) => {
                                                             const isAmt =
                                                                 adj.adjustmentKind === 'amount_delta' ||
                                                                 (adj.originalYear === -1 && adj.originalMonth === -1);
                                                             if (isAmt) {
                                                                 items.push({
                                                                     tag: '金额调整',
                                                                     color: 'cyan',
                                                                     text: `${adj.adjustedYear}年${adj.adjustedMonth + 1}月 ${adj.amount >= 0 ? '+' : ''}¥${adj.amount.toLocaleString()}${adj.reason ? `（${adj.reason}）` : ''}`,
                                                                 });
                                                             } else {
                                                                 items.push({
                                                                     tag: '账期调整',
                                                                     color: 'blue',
                                                                     text: `${adj.originalYear}年${adj.originalMonth + 1}月 → ${adj.adjustedYear}年${adj.adjustedMonth + 1}月${adj.reason ? `（${adj.reason}）` : ''}`,
                                                                 });
                                                             }
                                                         });
                                                         if (items.length === 0) return null;
                                                         const colorMap: Record<string, string> = {
                                                             amber: 'border-amber-200/80 bg-amber-50/88 text-amber-800',
                                                             blue: 'border-blue-200/80 bg-blue-50/88 text-blue-800',
                                                             cyan: 'border-cyan-200/80 bg-cyan-50/88 text-cyan-800',
                                                             rose: 'border-rose-200/80 bg-rose-50/88 text-rose-700',
                                                         };
                                                         return (
                                                             <div className="contract-inline-panel mb-3 rounded-2xl p-3">
                                                                 <div className="flex items-center gap-2 mb-2">
                                                                     <Info size={14} className="text-blue-600" />
                                                                     <span className="text-xs font-bold text-blue-800">
                                                                         本预览已叠加 {items.length} 项存量调优设置（与「预算管理 → 预算表」当年口径一致）
                                                                     </span>
                                                                 </div>
                                                                 <ul className="space-y-1">
                                                                     {items.map((it, i) => (
                                                                         <li key={i} className="text-xs flex items-start gap-2">
                                                                             <span
                                                                                 className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold flex-shrink-0 ${colorMap[it.color]}`}
                                                                             >
                                                                                 {it.tag}
                                                                             </span>
                                                                             <span className="text-slate-700">{it.text}</span>
                                                                         </li>
                                                                     ))}
                                                                 </ul>
                                                             </div>
                                                         );
                                                     })()}
                                                 {!previewApplyBudget && hasExistingBudgetItems && (
                                                     <div className="contract-inline-panel mb-3 flex items-center gap-2 rounded-2xl p-2 text-xs text-slate-600">
                                                         <Info size={12} className="text-slate-500" />
                                                         <span>
                                                             存量调优未勾选叠加：该客户有{' '}
                                                             <strong className="text-slate-800">
                                                                 {existingTenantAssumptions.length + tenantAdjustments.length}
                                                             </strong>{' '}
                                                             项存量假设/调整未计入下方预览；空置去化预算仍会自动参与推算（若房源上有预算卡片）。
                                                         </span>
                                                     </div>
                                                 )}
                                                 <div className="contract-compact-table max-h-96 overflow-x-auto overflow-y-auto rounded-2xl">
                                                     <table className="w-full min-w-[760px] text-xs">
                                                         <thead className="liquid-contract-sticky sticky top-0 z-10 border-b border-white/70">
                                                             <tr>
                                                                 <th className="px-3 py-2.5 text-left font-black text-slate-600">期次</th>
                                                                 <th className="px-3 py-2.5 text-left font-black text-slate-600">收款日期</th>
                                                                 {showMgmtPreview ? (
                                                                     <>
                                                                         <th className="px-3 py-2.5 text-right font-black text-slate-600">租金</th>
                                                                         <th className="px-3 py-2.5 text-right font-black text-cyan-700">物业费</th>
                                                                         <th className="px-3 py-2.5 text-right font-black text-slate-800">合计</th>
                                                                     </>
                                                                 ) : (
                                                                     <>
                                                                         <th className="px-3 py-2.5 text-right font-black text-slate-600">应缴</th>
                                                                         <th className="px-3 py-2.5 text-right font-black text-slate-600">减免</th>
                                                                         <th className="px-3 py-2.5 text-right font-black text-slate-800">实缴</th>
                                                                     </>
                                                                 )}
                                                                 <th className="px-3 py-2.5 text-left font-black text-slate-600">覆盖周期</th>
                                                             </tr>
                                                         </thead>
                                                         <tbody className="divide-y divide-slate-200/60">
                                                     {previewRows.map((row, idx) => {
                                                        const billDate = row.date;
                                                        const bill = row.rentBill;
                                                        const formatDate = (d: Date) =>
                                                            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                                        const rowTotal = row.rentAmount + row.mgmtAmount;
                                                        const rentGross =
                                                            bill?.grossAmount != null ? bill.grossAmount : row.rentAmount;
                                                        const rentDeduction = Math.max(0, rentGross - row.rentAmount);
                                                        const coverageParts: string[] = [];
                                                        if (row.rentAmount > 0 && row.rentCoverageStart && row.rentCoverageEnd) {
                                                            coverageParts.push(
                                                                `租金 ${formatDate(row.rentCoverageStart)} ~ ${formatDate(row.rentCoverageEnd)}`,
                                                            );
                                                        }
                                                        if (row.mgmtAmount > 0 && row.mgmtCoverageStart && row.mgmtCoverageEnd) {
                                                            coverageParts.push(
                                                                `物业费 ${formatDate(row.mgmtCoverageStart)} ~ ${formatDate(row.mgmtCoverageEnd)}`,
                                                            );
                                                        }
                                                        const coverageText =
                                                            coverageParts.length > 0
                                                                ? coverageParts.join('；')
                                                                : `${formatDate(row.rentCoverageStart || billDate)} ~ ${formatDate(row.rentCoverageEnd || billDate)}`;

                                                         const dateKey = billDateKey(billDate);
                                                         const dateAmtKey = bill
                                                             ? `${dateKey}|${bill.amount.toFixed(2)}`
                                                             : '';
                                                         const isBudgetNew =
                                                             !!bill &&
                                                             showBillingDiffOverlay &&
                                                             !rawDateSet.has(dateKey);
                                                         const isBudgetChanged =
                                                             !!bill &&
                                                             showBillingDiffOverlay &&
                                                             !isBudgetNew &&
                                                             !rawDateAmtSet.has(dateAmtKey);

                                                         return (
                                                             <tr key={idx} className={`transition-colors hover:bg-blue-50/42 ${isBudgetNew ? 'bg-blue-50/52' : isBudgetChanged ? 'bg-amber-50/52' : ''}`}>
                                                                 <td className="px-3 py-2 text-slate-600">
                                                                     第{idx + 1}期
                                                                     {idx === firstCustomBillIdx && (currentTenant.firstReceivableAmount ?? 0) > 0 && (
                                                                         <span className="ml-1 inline-flex items-center rounded-full border border-amber-200/80 bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-900">首期自定义</span>
                                                                     )}
                                                                     {bill?.earlyTerminationExtraDetail && (
                                                                         <span
                                                                             className="ml-1 inline-flex items-center rounded-full border border-amber-200/80 bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-900"
                                                                             title="免租扣回、押金扣款、其它调整（不含当期租金）"
                                                                         >
                                                                             提前退租结算
                                                                         </span>
                                                                     )}
                                                                     {row.mgmtAmount > 0 && row.rentAmount <= 0 && (
                                                                         <span className="ml-1 inline-flex items-center rounded-full border border-cyan-200/80 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-black text-cyan-800">
                                                                             物业费
                                                                         </span>
                                                                     )}
                                                                     {isBudgetNew && (
                                                                         <span className="ml-1 inline-flex items-center rounded-full border border-blue-200/80 bg-blue-50 px-1.5 py-0.5 text-[10px] font-black text-blue-800" title="此账期由预算假设/调整新增">预算新增</span>
                                                                     )}
                                                                     {isBudgetChanged && (
                                                                         <span className="ml-1 inline-flex items-center rounded-full border border-amber-200/80 bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-800" title="此账期金额因预算调整发生变化">金额已调整</span>
                                                                     )}
                                                                 </td>
                                                                 <td className="px-3 py-2 font-bold text-blue-600">{formatDate(billDate)}</td>
                                                                 {showMgmtPreview ? (
                                                                     <>
                                                                         <td className="px-3 py-2 text-right text-slate-700">
                                                                             {row.rentAmount > 0 ? formatCurrency(row.rentAmount) : '—'}
                                                                         </td>
                                                                         <td className="px-3 py-2 text-right font-medium text-cyan-700">
                                                                             {row.mgmtAmount > 0 ? formatCurrency(row.mgmtAmount) : '—'}
                                                                         </td>
                                                                         <td className="px-3 py-2 text-right font-bold text-blue-700">
                                                                             {formatCurrency(rowTotal)}
                                                                         </td>
                                                                     </>
                                                                 ) : (
                                                                     <>
                                                                         <td className="px-3 py-2 text-right text-slate-600">
                                                                             {row.rentAmount > 0 ? formatCurrency(rentGross) : '—'}
                                                                         </td>
                                                                         <td className="px-3 py-2 text-right text-rose-600">
                                                                             {rentDeduction > 0.005
                                                                                 ? `-${formatCurrency(rentDeduction)}`
                                                                                 : '—'}
                                                                         </td>
                                                                         <td className="px-3 py-2 text-right font-bold text-blue-700">
                                                                             {formatCurrency(rowTotal)}
                                                                         </td>
                                                                     </>
                                                                 )}
                                                                 <td className="px-3 py-2 text-slate-500">{coverageText}</td>
                                                             </tr>
                                                         );
                                                     })}
                                                         </tbody>
                                                     </table>
                                                     <p className="contract-note mt-2 rounded-2xl px-3 py-2 text-xs">
                                                         <span className="font-black text-amber-700">提示：</span>
                                                         收款日期为当期款项的收取时间；覆盖周期分别标注租金与物业费（若同日收款则合并为一行）。「财务报表 → 应收核销」按月筛选时：<strong className="text-slate-700">当期扣除</strong>模式按<strong className="text-slate-700">收款日期</strong>所在自然月归集；<strong className="text-slate-700">账期顺延</strong>（Defer）模式按<strong className="text-slate-700">覆盖期首月</strong>归集（与预算表、合同概要一致）。整笔应收仅在归属月出现一笔。
                                                         {(currentTenant.rentFreePeriods?.length || 0) > 0 && currentTenant.freeRentHandling === 'Defer' && '免租期采用账期顺延模式，收款时间会自动顺延。'}
                                                         {(currentTenant.rentFreePeriods?.length || 0) > 0 && currentTenant.freeRentHandling === 'Deduct' && '免租期采用当期扣除模式，应收金额会相应减少。'}
                                                         {showBillingDiffOverlay && (
                                                             <>
                                                                 {' '}
                                                                 <span className="text-blue-700">蓝色行</span>
                                                                 表示相对纯合同口径<strong>新增</strong>的账期；
                                                                 <span className="text-amber-700">琥珀色行</span>
                                                                 表示同收款日<strong>金额发生变化</strong>（含空置去化单价/免租与存量调优叠加）。若某账期被「调出」到其它月份，原账期会从本表消失（与「预算表」一致）。
                                                             </>
                                                         )}
                                                     </p>
                                                 </div>
                                             </div>
                                         </div>
                                     );
                                 })()}
                             </div>
                         )}
                    </section>

                    </>
                    )}

                    {/* 4. Business Insights & Risk */}
                    <section className="space-y-4 p-4 md:p-6">
                        <div className="contract-section-heading mb-2 text-rose-600"><Briefcase size={18}/> <span>客户背景与风险管理</span></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">所属行业</label><input type="text" placeholder="例如：人工智能 / 医疗器械" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.industry || ''} onChange={e => setCurrentTenant({...currentTenant, industry: e.target.value})} /></div>
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">企业成立日期</label><input type="date" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.foundingDate || ''} onChange={e => setCurrentTenant({...currentTenant, foundingDate: e.target.value})} /></div>
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">企业法人</label><input type="text" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.legalRepName || ''} onChange={e => setCurrentTenant({...currentTenant, legalRepName: e.target.value})} /></div>
                            </div>
                            <div className="space-y-4">
                                <div className="contract-check-card flex items-center gap-3 rounded-2xl p-4">
                                    <input id="risk_flag" type="checkbox" className="w-5 h-5 text-rose-600 border-rose-300 rounded focus:ring-rose-500" checked={currentTenant.isRisk || false} onChange={e => setCurrentTenant({...currentTenant, isRisk: e.target.checked})} />
                                    <label htmlFor="risk_flag" className="flex-1 cursor-pointer">
                                        <div className="font-bold text-rose-700 text-sm">高风险客户监控</div>
                                        <div className="text-xs text-rose-600/70">勾选后将在看板重点标记，建议加强租金催缴。</div>
                                    </label>
                                    <ShieldAlert className="text-rose-500" size={24}/>
                                </div>
                                <div className="contract-check-card flex items-center gap-3 rounded-2xl p-4">
                                    <input
                                        id="special_business_flag"
                                        type="checkbox"
                                        className="w-5 h-5 text-amber-600 border-amber-300 rounded focus:ring-amber-500"
                                        checked={currentTenant.isSpecialBusiness || false}
                                        onChange={(e) => setCurrentTenant({ ...currentTenant, isSpecialBusiness: e.target.checked })}
                                    />
                                    <label htmlFor="special_business_flag" className="flex-1 cursor-pointer">
                                        <div className="font-bold text-amber-700 text-sm">特殊业态客户（按经营分成等结算）</div>
                                        <div className="text-xs text-amber-600/80">勾选后系统不再依据合同自动生成应收，需在「财务报表 → 特殊业态收入录入」按月手工录入应收金额。</div>
                                    </label>
                                    <Sparkles className="text-amber-500" size={24} />
                                </div>
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">特殊要求 / 备注信息</label><textarea className="w-full border border-slate-300 p-2.5 rounded-lg text-sm min-h-[100px]" placeholder="记录任何非标合同条款、装修要求、特殊配套需求等..." value={currentTenant.specialRequirements || ''} onChange={e => setCurrentTenant({...currentTenant, specialRequirements: e.target.value})} /></div>
                            </div>
                        </div>
                    </section>
                </div>

                {/* 账期调整（存量调优） */}
                {currentTenant.id && (
                    <section className="mx-3 mb-3 space-y-3 border-t border-white/70 px-4 py-4 md:mx-8 md:mb-8 md:px-6 md:py-5">
                        {(() => {
                            // 二次防御：过滤掉缺失关键字段的非法条目（OpenClaw 误填可能造成），避免渲染时 .toLocaleString() 崩溃。
                            const tenantAdjs = (currentTenant.paymentPeriodAdjustments || []).filter(
                                (adj: any) =>
                                    adj &&
                                    typeof adj.originalYear === 'number' &&
                                    typeof adj.originalMonth === 'number' &&
                                    typeof adj.adjustedYear === 'number' &&
                                    typeof adj.adjustedMonth === 'number' &&
                                    typeof adj.amount === 'number',
                            );
                            const fmtBillDate = (d: Date) =>
                                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                            const origList = adjPreviewBills
                                .filter((b) => b.date.getMonth() + 1 === adjForm.origMonth)
                                .sort((a, b) => a.date.getTime() - b.date.getTime());
                            const targetList = adjPreviewBills
                                .filter((b) => b.date.getMonth() + 1 === adjForm.targetMonth)
                                .sort((a, b) => a.date.getTime() - b.date.getTime());
                            const origSelectValue =
                                adjForm.origBillKey && origList.some((b) => String(b.date.getTime()) === adjForm.origBillKey)
                                    ? adjForm.origBillKey
                                    : origList[0]
                                      ? String(origList[0].date.getTime())
                                      : '';
                            const targetSelectValue =
                                adjForm.targetBillKey && targetList.some((b) => String(b.date.getTime()) === adjForm.targetBillKey)
                                    ? adjForm.targetBillKey
                                    : targetList[0]
                                      ? String(targetList[0].date.getTime())
                                      : '';
                            const handleAddAdj = async () => {
                                if (!adjForm.amount || !adjForm.reason.trim()) {
                                    await showContractNotice({
                                        title: '请填写金额和原因',
                                        message: '添加账期调整前需要填写调整金额和调整原因。',
                                        tone: 'amber',
                                    });
                                    return;
                                }
                                if (adjPreviewBills.length === 0) {
                                    await showContractNotice({
                                        title: '无法推算收款计划',
                                        message: '当前无法推算收款计划，请检查起租日、止租日与月租金。',
                                        tone: 'rose',
                                    });
                                    return;
                                }
                                const origBill =
                                    origList.find((b) => String(b.date.getTime()) === adjForm.origBillKey) ?? origList[0];
                                const targetBill =
                                    targetList.find((b) => String(b.date.getTime()) === adjForm.targetBillKey) ?? targetList[0];
                                if (!origBill) {
                                    await showContractNotice({
                                        title: '未找到原账期收款日',
                                        message: '未找到「原账期月份」下的收款日，请更换筛选或检查合同。',
                                        tone: 'amber',
                                    });
                                    return;
                                }
                                if (!targetBill) {
                                    await showContractNotice({
                                        title: '未找到目标收款日',
                                        message: '未找到「目标月份」下的收款日，请更换筛选。',
                                        tone: 'amber',
                                    });
                                    return;
                                }
                                if (origBill.date.getTime() === targetBill.date.getTime()) {
                                    await showContractNotice({
                                        title: '请选择不同收款日',
                                        message: '原收款日与目标收款日不能为同一天。',
                                        tone: 'amber',
                                    });
                                    return;
                                }
                                const newAdj: import('../types').PaymentPeriodAdjustment = {
                                    id: `ppa_${Date.now()}`,
                                    originalYear: origBill.date.getFullYear(),
                                    originalMonth: origBill.date.getMonth(),
                                    adjustedYear: targetBill.date.getFullYear(),
                                    adjustedMonth: targetBill.date.getMonth(),
                                    amount: adjForm.amount,
                                    reason: adjForm.reason,
                                };
                                setCurrentTenant((prev) => ({
                                    ...prev,
                                    paymentPeriodAdjustments: [...(prev.paymentPeriodAdjustments || []), newAdj],
                                }));
                                setShowAdjForm(false);
                                setAdjForm({
                                    origMonth: 1,
                                    targetMonth: 1,
                                    origBillKey: '',
                                    targetBillKey: '',
                                    amount: 0,
                                    reason: '',
                                });
                            };
                            const handleDeleteAdj = (id: string) => {
                                setCurrentTenant(prev => ({
                                    ...prev,
                                    paymentPeriodAdjustments: (prev.paymentPeriodAdjustments || []).filter(a => a.id !== id),
                                }));
                            };
                            return (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="contract-section-heading text-sm text-blue-700">
                                            <ArrowLeftRight size={16} /> 账期调整（存量调优）
                                        </h3>
                                        <div className="flex items-center gap-3">
                                            {/* 整体偏移 */}
                                            <div className="flex items-center gap-1 text-xs">
                                                <span className="text-slate-500">整体偏移:</span>
                                                {!isMobileQueryOnly && (
                                                    <button
                                                        onClick={() => setCurrentTenant(prev => ({ ...prev, paymentPeriodShiftMonths: (prev.paymentPeriodShiftMonths || 0) - 1 }))}
                                                        className="contract-subtle-action liquid-pressable h-7 w-7 rounded-full text-sm font-black text-amber-700"
                                                    >−</button>
                                                )}
                                                <span className="font-mono font-bold w-6 text-center">{(currentTenant.paymentPeriodShiftMonths || 0) > 0 ? '+' : ''}{currentTenant.paymentPeriodShiftMonths || 0}</span>
                                                {!isMobileQueryOnly && (
                                                    <button
                                                        onClick={() => setCurrentTenant(prev => ({ ...prev, paymentPeriodShiftMonths: (prev.paymentPeriodShiftMonths || 0) + 1 }))}
                                                        className="contract-subtle-action liquid-pressable h-7 w-7 rounded-full text-sm font-black text-amber-700"
                                                    >+</button>
                                                )}
                                                <span className="text-slate-400">月</span>
                                            </div>
                                            {!isMobileQueryOnly && (
                                                <button onClick={() => setShowAdjForm(!showAdjForm)} className="contract-soft-action liquid-pressable rounded-full px-3 py-1.5 text-xs font-black">
                                                    {showAdjForm ? '取消' : '+ 单月调整'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {(currentTenant.paymentPeriodShiftMonths || 0) !== 0 && (
                                        <p className="contract-alert-panel rounded-2xl px-3 py-2 text-xs text-amber-800">
                                            整体{currentTenant.paymentPeriodShiftMonths! > 0 ? '后移' : '前移'} {Math.abs(currentTenant.paymentPeriodShiftMonths!)} 个月：所有收款日期统一{currentTenant.paymentPeriodShiftMonths! > 0 ? '推迟' : '提前'}，适用于合同整体调整场景
                                        </p>
                                    )}
                                    {tenantAdjs.length > 0 && (
                                        <div className="space-y-1.5">
                                            {tenantAdjs.map(adj => (
                                                <div key={adj.id} className="contract-inline-panel flex items-center gap-2 rounded-2xl px-3 py-2 text-xs">
                                                    <span className="font-bold text-blue-600">账期调整</span>
                                                    <span className="text-slate-500">
                                                        {adj.originalYear}年{adj.originalMonth + 1}月
                                                        {' → '}
                                                        {adj.adjustedYear}年{adj.adjustedMonth + 1}月 ¥{adj.amount.toLocaleString()}
                                                    </span>
                                                    <span className="text-slate-400">— {adj.reason}</span>
                                                    <button onClick={() => handleDeleteAdj(adj.id)} className="ml-auto text-rose-400 hover:text-rose-600"><X size={14} /></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {showAdjForm && (
                                        <div className="contract-inline-panel rounded-2xl p-3 space-y-2">
	                                            {adjPreviewState.loading ? (
	                                                <p className="text-xs text-amber-800">
	                                                    后台正在计算收款日列表...
	                                                </p>
	                                            ) : adjPreviewState.error ? (
	                                                <p className="contract-alert-panel flex items-start gap-2 px-2 py-1.5 text-xs text-amber-900">
	                                                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
	                                                    <span>{adjPreviewState.error}</span>
	                                                </p>
	                                            ) : adjPreviewBills.length === 0 ? (
	                                                <p className="text-xs text-amber-800">
	                                                    请填写起租日、止租日与月租金后，再添加账期调整（系统需先推算收款日列表）。
	                                                </p>
                                            ) : (
                                                <>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div>
                                                            <label className="text-xs text-slate-500">原账期月份（筛选）</label>
                                                            <select
                                                                value={adjForm.origMonth}
                                                                onChange={(e) =>
                                                                    setAdjForm({
                                                                        ...adjForm,
                                                                        origMonth: Number(e.target.value),
                                                                        origBillKey: '',
                                                                    })
                                                                }
                                                                className="w-full border rounded px-2 py-1 text-xs"
                                                            >
                                                                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                                                    <option key={m} value={m}>
                                                                        {m}月
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="text-xs text-slate-500">目标月份（筛选）</label>
                                                            <select
                                                                value={adjForm.targetMonth}
                                                                onChange={(e) =>
                                                                    setAdjForm({
                                                                        ...adjForm,
                                                                        targetMonth: Number(e.target.value),
                                                                        targetBillKey: '',
                                                                    })
                                                                }
                                                                className="w-full border rounded px-2 py-1 text-xs"
                                                            >
                                                                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                                                    <option key={m} value={m}>
                                                                        {m}月
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-slate-500">原收款日</label>
                                                        <select
                                                            value={origSelectValue}
                                                            onChange={(e) => setAdjForm({ ...adjForm, origBillKey: e.target.value })}
                                                            className="w-full border rounded px-2 py-1 text-xs"
                                                            disabled={origList.length === 0}
                                                        >
                                                            {origList.length === 0 ? (
                                                                <option value="">该月份无收款记录</option>
                                                            ) : (
                                                                origList.map((b) => (
                                                                    <option key={b.date.getTime()} value={String(b.date.getTime())}>
                                                                        {fmtBillDate(b.date)} ¥{b.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                    </option>
                                                                ))
                                                            )}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-slate-500">目标收款日</label>
                                                        <select
                                                            value={targetSelectValue}
                                                            onChange={(e) => setAdjForm({ ...adjForm, targetBillKey: e.target.value })}
                                                            className="w-full border rounded px-2 py-1 text-xs"
                                                            disabled={targetList.length === 0}
                                                        >
                                                            {targetList.length === 0 ? (
                                                                <option value="">该月份无收款记录</option>
                                                            ) : (
                                                                targetList.map((b) => (
                                                                    <option key={b.date.getTime()} value={String(b.date.getTime())}>
                                                                        {fmtBillDate(b.date)} ¥{b.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                    </option>
                                                                ))
                                                            )}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-slate-500">调整金额 (元)</label>
                                                        <input
                                                            type="number"
                                                            inputMode="decimal"
                                                            enterKeyHint="done"
                                                            className="w-full border rounded px-2 py-1 text-xs"
                                                            value={adjForm.amount || ''}
                                                            onChange={(e) => setAdjForm({ ...adjForm, amount: Number(e.target.value) })}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-slate-500">调整原因</label>
                                                        <input
                                                            type="text"
                                                            className="w-full border rounded px-2 py-1 text-xs"
                                                            placeholder="例：第11期延后至次月收款"
                                                            value={adjForm.reason}
                                                            onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                                                        />
                                                    </div>
                                                </>
                                            )}
                                            <button
	                                                type="button"
	                                                onClick={handleAddAdj}
	                                                disabled={adjPreviewState.loading || adjPreviewBills.length === 0}
	                                                className="liquid-action-strong liquid-pressable w-full rounded-2xl py-2 text-xs font-black disabled:pointer-events-none disabled:opacity-40"
	                                            >
                                                确认添加
                                            </button>
                                        </div>
                                    )}
                                    {tenantAdjs.length === 0 && !showAdjForm && (
                                        <p className="contract-empty-state rounded-2xl px-3 py-2 text-xs">暂无账期调整，点击上方按钮添加。</p>
                                    )}
                                </div>
                            );
                        })()}
                    </section>
                )}

                <div className="liquid-elevated-footer sticky bottom-0 z-20 border-t border-white/60 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] md:flex md:items-center md:justify-between md:rounded-b-[28px] md:px-8 md:py-6">
                    {isMobileQueryOnly ? (
                        <div className="ml-auto w-full md:w-auto">
                            <button onClick={() => { setIsEditing(false); setRenewingFromId(null); setFormErrors({}); }} className="liquid-action-strong liquid-pressable w-full rounded-2xl px-4 py-3 text-sm font-black md:w-auto md:px-10">关闭</button>
                        </div>
                    ) : (
                        <>
                            <div className="hidden md:block">{currentTenant.id && viewRentPricing && <button onClick={handleDeleteCurrentTenant} className="liquid-pressable flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-black text-rose-600 hover:bg-rose-50/80"><Trash2 size={18}/> 删除记录</button>}</div>
                            <div className="grid grid-cols-[1fr_2fr] gap-2 md:flex md:gap-3">
                                <button onClick={() => { setIsEditing(false); setRenewingFromId(null); setFormErrors({}); }} className="liquid-glass-control liquid-pressable rounded-2xl px-4 py-2.5 text-sm font-black text-slate-600 md:px-6">取消</button>
                                <button onClick={handleSave} className="liquid-action-strong liquid-pressable flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black shadow-lg md:px-10"><Save size={18}/> 保存并退出</button>
                            </div>
                            {currentTenant.id && viewRentPricing && (
                                <button onClick={handleDeleteCurrentTenant} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-black text-rose-600 md:hidden"><Trash2 size={15}/> 删除记录</button>
                            )}
                        </>
                    )}
                </div>
             </div>
             
             {/* 初始化录入弹窗（渲染在合同详情页面内） */}
             {showInitPaymentModal && (
                 <div className="liquid-elevated-backdrop fixed inset-0 z-[9999] flex items-end justify-center p-3 sm:p-4 md:items-center" onClick={closeInitPaymentModal}>
                    <section
                       role="dialog"
                       aria-modal="true"
                       aria-labelledby="contract-init-payment-modal-title"
                       className="liquid-contract-init-panel flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-[28px] animate-in zoom-in-50 duration-200"
                       onClick={(event) => event.stopPropagation()}
                    >
                       <div className="liquid-elevated-header flex items-start justify-between gap-3 border-b border-white/65 px-4 py-4 sm:px-5">
                           <div className="flex min-w-0 items-start gap-3">
                               <span className="liquid-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-blue-700">
                                   <CreditCard size={20} />
                               </span>
                               <div className="min-w-0">
                                   <h3 id="contract-init-payment-modal-title" className="text-lg font-black leading-tight text-slate-950">初始化历史收款</h3>
                                   <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                                       {currentTenant.name || '当前客户'} · 2026 年 1 月前
                                   </p>
                               </div>
                           </div>
                           <button
                               type="button"
                               onClick={closeInitPaymentModal}
                               className="liquid-glass-control liquid-pressable inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-slate-900"
                               aria-label="关闭初始化收款录入"
                           >
                               <X size={18} />
                           </button>
                       </div>
                       <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
                           <div className="liquid-contract-init-note rounded-2xl p-3 text-xs font-semibold leading-relaxed text-blue-800">
                               <div className="flex items-start gap-2">
                                   <Info size={14} className="mt-0.5 flex-shrink-0" />
                                   <div>
                                       <div className="mb-1 font-black">功能说明</div>
                                       <div>用于录入该客户在 <strong>2026 年 1 月之前</strong> 的历史收款数据。请填写截至 2025 年 12 月 31 日的累计已收金额。</div>
                                   </div>
                               </div>
                           </div>

                           <div>
                               <label className="mb-1.5 block text-xs font-black text-slate-500">
                                   累计已收金额 <span className="text-rose-500">*</span>
                               </label>
                               <input
                                   type="number"
                                   inputMode="decimal"
                                   enterKeyHint="done"
                                   value={initPaymentData.amount}
                                   onChange={e => setInitPaymentData({...initPaymentData, amount: e.target.value})}
                                   placeholder="请输入金额"
                                   className="liquid-contract-init-field w-full rounded-2xl px-3.5 py-3 text-base font-black tabular-nums text-slate-950 outline-none focus:ring-4 focus:ring-blue-500/10"
                               />
                           </div>

                           <div>
                               <label className="mb-1.5 block text-xs font-black text-slate-500">
                                   数据截止日期 <span className="text-rose-500">*</span>
                               </label>
                               <input
                                   type="date"
                                   value={initPaymentData.date}
                                   onChange={e => setInitPaymentData({...initPaymentData, date: e.target.value})}
                                   max="2025-12-31"
                                   className="liquid-contract-init-field w-full rounded-2xl px-3.5 py-3 text-base font-black tabular-nums text-slate-950 outline-none focus:ring-4 focus:ring-blue-500/10"
                               />
                               <div className="mt-1.5 text-xs font-semibold text-slate-500">必须为 2025-12-31 或之前</div>
                           </div>

                           <div>
                               <label className="mb-1.5 block text-xs font-black text-slate-500">
                                   备注
                               </label>
                               <textarea
                                   value={initPaymentData.remarks}
                                   onChange={e => setInitPaymentData({...initPaymentData, remarks: e.target.value})}
                                   placeholder="可输入备注信息"
                                   rows={3}
                                   className="liquid-contract-init-field w-full resize-none rounded-2xl px-3.5 py-3 text-sm font-semibold leading-relaxed text-slate-900 outline-none focus:ring-4 focus:ring-blue-500/10"
                               />
                           </div>
                       </div>
                       <div className="liquid-elevated-footer grid grid-cols-2 gap-2 border-t border-white/65 px-4 py-4 sm:flex sm:justify-end sm:px-5">
                           <button
                               type="button"
                               onClick={closeInitPaymentModal}
                               className="liquid-glass-control liquid-pressable rounded-full px-4 py-2.5 text-sm font-black text-slate-600"
                           >
                               取消
                           </button>
                           <button
                               type="button"
                               onClick={handleConfirmInitPayment}
                               className="liquid-action-strong liquid-pressable rounded-full px-5 py-2.5 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50"
                               disabled={!onUpdatePayments}
                           >
                               确认录入
                           </button>
                       </div>
                    </section>
                 </div>
             )}

             {/* 名称变更弹窗 — 编辑页 */}
             {showNameChange && nameChangeTenantId && (() => {
               const t = tenants.find(x => x.id === nameChangeTenantId);
               if (!t) return null;
               return (
                 <React.Suspense fallback={null}>
                   <NameChangeDialog tenant={t} onConfirm={handleNameChangeConfirm} onClose={() => { setShowNameChange(false); setNameChangeTenantId(null); }} />
                 </React.Suspense>
               );
             })()}

             {/* 付款周期变更弹窗 — 编辑页 */}
             {showCycleChange && currentTenant.id && (
               <React.Suspense fallback={null}>
                 <PaymentCycleChangeDialog
                   tenant={currentTenant as Tenant}
                   cloudConfig={cloudConfig}
                   serverComputeEnabled={serverComputeEnabled}
                   onConfirm={handleCycleChangeConfirm}
                   onClose={() => setShowCycleChange(false)}
                 />
               </React.Suspense>
             )}
         </div>
     )
  }

  return (
    <div className="space-y-6">
      {mobileEntryMode && (
        <section className="liquid-mobile-card lg:hidden overflow-hidden rounded-[24px]">
          <div className="liquid-mobile-hero px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-slate-950">{isMobileQueryOnly ? '合同查询' : '快速办理'}</div>
                <div className="mt-0.5 text-xs font-semibold text-slate-500">
                  在租 {activeContractCount} 份 · 待到期 {expiringTenantSummary.count} 家
                </div>
              </div>
              <span className="liquid-mobile-control rounded-full px-2 py-0.5 text-xs font-black text-blue-700">
                {mobileCurrentTabCount} 条
              </span>
            </div>
            {!isMobileQueryOnly && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={beginNewContract}
                  className="liquid-action-strong mobile-pressable inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-black text-white shadow-sm"
                >
                  <Plus size={16} />
                  新签客户
                </button>
                <button
                  type="button"
                  onClick={() => setShowAIContractImport(true)}
                  className="liquid-mobile-readable mobile-pressable inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-black text-slate-900 shadow-sm"
                >
                  <Sparkles size={16} />
                  AI导入
                </button>
              </div>
            )}
            <label className="liquid-mobile-readable mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-slate-900">
              <Search size={15} className="shrink-0 text-slate-500" />
              <input
                type="search"
                enterKeyHint="search"
                value={searchTerm}
                onChange={(event) => {
                  if (activeTab !== 'List') setActiveTab('List');
                  setSearchTerm(event.target.value);
                }}
                placeholder="搜索企业名称"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-500"
              />
            </label>
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-200/70">
            <button
              type="button"
              onClick={() => setActiveTab('List')}
              className={`mobile-pressable px-3 py-2.5 text-left ${activeTab === 'List' ? 'liquid-mobile-stat-active' : 'liquid-mobile-stat-idle'}`}
            >
              <div className="text-[10px] font-semibold text-slate-500">在租</div>
              <div className={`mt-0.5 text-lg font-black tabular-nums ${activeTab === 'List' ? 'text-blue-700' : 'text-slate-900'}`}>
                {activeContractCount}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('Expiring')}
              className={`mobile-pressable px-3 py-2.5 text-left ${activeTab === 'Expiring' ? 'liquid-mobile-stat-warn' : 'liquid-mobile-stat-idle'}`}
            >
              <div className="text-[10px] font-semibold text-slate-500">到期</div>
              <div className={`mt-0.5 text-lg font-black tabular-nums ${activeTab === 'Expiring' ? 'text-amber-700' : 'text-slate-900'}`}>
                {expiringTenantSummary.count}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('Terminated')}
              className={`mobile-pressable px-3 py-2.5 text-left ${activeTab === 'Terminated' ? 'liquid-mobile-stat-danger' : 'liquid-mobile-stat-idle'}`}
            >
              <div className="text-[10px] font-semibold text-slate-500">历史</div>
              <div className={`mt-0.5 text-lg font-black tabular-nums ${activeTab === 'Terminated' ? 'text-rose-700' : 'text-slate-900'}`}>
                {terminatedContractCount}
              </div>
            </button>
          </div>
        </section>
      )}
      {/* ... keeping Analysis/List/Terminated navigation logic from previous version ... */}
      <div className={`liquid-glass-toolbar rounded-[26px] p-2.5 md:p-3 justify-between items-center gap-3 ${mobileEntryMode ? 'hidden lg:flex lg:flex-row lg:items-center' : 'flex flex-col sm:flex-row'}`}>
           <h2 className="text-lg md:text-xl font-black text-slate-950 flex items-center gap-2.5 w-full sm:w-auto">
             <span className="liquid-icon-well inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-blue-700">
               <LayoutDashboard size={22}/>
             </span>
             <span>{isMobileQueryOnly ? '合同查询' : mobileEntryMode ? '合同录入' : '客户合同中心'}</span>
             <span className="hidden rounded-full border border-white/70 bg-white/58 px-2.5 py-1 text-[11px] font-bold text-slate-500 shadow-sm xl:inline-flex">
               {activeTab === 'Terminated' ? `${terminatedContractCount} 条历史` : `${activeContractCount} 份在租`}
             </span>
           </h2>
           <div className={`liquid-glass-control flex rounded-full p-1 w-full sm:w-auto ${mobileEntryMode ? 'justify-stretch' : ''}`}>
               {!mobileEntryMode && (
               <>
               <button type="button" onClick={() => setActiveTab('Analysis')} className={`flex-1 sm:flex-none px-4 sm:px-5 py-1.5 rounded-full text-sm font-bold transition-all ${activeTab === 'Analysis' ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20' : 'text-slate-500 hover:bg-white/62 hover:text-slate-900'}`}>经营分析</button>
               <button type="button" onClick={() => setActiveTab('SourceAnalysis')} className={`flex-1 sm:flex-none px-4 sm:px-5 py-1.5 rounded-full text-sm font-bold transition-all ${activeTab === 'SourceAnalysis' ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20' : 'text-slate-500 hover:bg-white/62 hover:text-slate-900'}`}>来源分析</button>
               </>
               )}
               <button type="button" onClick={() => setActiveTab('List')} className={`flex-1 sm:flex-none px-4 sm:px-5 py-1.5 rounded-full text-sm font-bold transition-all ${activeTab === 'List' ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20' : 'text-slate-500 hover:bg-white/62 hover:text-slate-900'}`}>在租明细</button>
               <button type="button" onClick={() => setActiveTab('Terminated')} className={`flex-1 sm:flex-none px-4 sm:px-5 py-1.5 rounded-full text-sm font-bold transition-all ${activeTab === 'Terminated' ? 'bg-rose-500 text-white shadow-sm shadow-rose-500/20' : 'text-slate-500 hover:bg-white/62 hover:text-slate-900'}`}>历史退租</button>
           </div>
      </div>

      {activeTab === 'Analysis' && (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Period Selector & Top KPIs */}
            <div className="flex flex-col lg:flex-row gap-6">
                <div className="lg:w-1/4 space-y-4">
                    <div className="liquid-contract-analysis-card p-4">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-3">统计维度选择</label>
                        <div className="liquid-glass-control grid grid-cols-3 gap-1 rounded-full p-1">
                            {(['Year', 'Quarter', 'Month'] as const).map(p => (
                                <button key={p} onClick={() => setAnalysisPeriod(p)} className={`rounded-full py-1.5 text-xs font-bold transition-all ${analysisPeriod === p ? 'liquid-action-strong shadow-md' : 'text-slate-500 hover:bg-white/70 hover:text-slate-900'}`}>
                                    {p === 'Year' ? '本年度' : p === 'Quarter' ? '本季度' : '本月'}
                                </button>
                            ))}
                        </div>
                        {contractAnalysisLoading && (
                            <div className="mt-2 text-[11px] font-medium text-slate-400">
                                {canUseContractAnalysisServer ? '后台计算中...' : '本地分析模块加载中...'}
                            </div>
                        )}
                        {contractAnalysisError && (
                            <div className="mt-2 rounded-2xl border border-rose-200/70 bg-rose-50/80 px-2.5 py-1.5 text-[11px] font-bold text-rose-700">
                                {contractAnalysisError}
                            </div>
                        )}
                    </div>
                    
                    <div className="liquid-contract-analysis-hero rounded-[24px] p-5">
                         <div className="flex justify-between items-start mb-4">
                             <div className="liquid-icon-well flex h-10 w-10 items-center justify-center rounded-2xl text-blue-700"><TrendingUp size={20}/></div>
                             <span className="liquid-glass-control rounded-full px-2.5 py-1 text-[10px] font-black text-blue-700">NET GROWTH</span>
                         </div>
                         <div className="text-xs font-bold text-slate-500">期间净去化面积</div>
                         <div className="text-3xl font-black mt-1 tabular-nums text-slate-950">{perfData.metrics.netArea > 0 ? '+' : ''}{formatArea(perfData.metrics.netArea)}</div>
                         <div className="mt-4 pt-4 border-t border-white/70 flex justify-between items-center text-[10px] font-bold text-slate-600">
                             <div className="flex items-center gap-1"><ArrowUpRight size={12} className="text-blue-600"/> 新签 {formatArea(perfData.metrics.signedArea)}</div>
                             <div className="flex items-center gap-1"><ArrowDownRight size={12} className="text-rose-300"/> 退租 {formatArea(perfData.metrics.terminatedArea)}</div>
                         </div>
                    </div>
                </div>

                <div className="lg:w-3/4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* New Signings KPI */}
                    <div className="liquid-contract-analysis-card flex flex-col justify-between p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">新签业绩 Signings</p><h3 className="text-3xl font-black text-slate-800 mt-1">{formatArea(perfData.metrics.signedArea)}</h3></div>
                            <div className="liquid-icon-well flex h-12 w-12 items-center justify-center rounded-2xl text-blue-700"><UserPlus size={24}/></div>
                        </div>
                        <div className="flex items-center gap-6 mt-4">
                            <div className="space-y-1">
                                <div className="text-[10px] font-bold text-slate-400">同比 (YoY)</div>
                                <div className={`flex items-center gap-1 font-black text-sm ${perfData.yoy.area >= 0 ? 'text-blue-700' : 'text-rose-500'}`}>
                                    {perfData.yoy.area >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>}
                                    {formatPercent(Math.abs(perfData.yoy.area))}
                                </div>
                            </div>
                            <div className="w-px h-8 bg-white/70"></div>
                            <div className="space-y-1">
                                <div className="text-[10px] font-bold text-slate-400">环比 (MoM)</div>
                                <div className={`flex items-center gap-1 font-black text-sm ${perfData.mom.area >= 0 ? 'text-cyan-700' : 'text-rose-500'}`}>
                                    {perfData.mom.area >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>}
                                    {formatPercent(Math.abs(perfData.mom.area))}
                                </div>
                            </div>
                            <div className="ml-auto text-right">
                                <div className="text-[10px] font-bold text-slate-400">成交数</div>
                                <div className="text-sm font-black text-slate-700">{perfData.metrics.signedCount} <span className="text-[10px] font-normal">家</span></div>
                            </div>
                        </div>
                    </div>

                    {/* Terminations KPI */}
                    <div className="liquid-contract-analysis-card flex flex-col justify-between p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">退租流失 Churn</p><h3 className="text-3xl font-black text-slate-800 mt-1">{formatArea(perfData.metrics.terminatedArea)}</h3></div>
                            <div className="liquid-icon-well flex h-12 w-12 items-center justify-center rounded-2xl text-rose-600"><UserMinus size={24}/></div>
                        </div>
                        <div className="flex items-center gap-4 mt-4">
                            <div className="liquid-contract-mini-card flex-1 px-3 py-2">
                                <div className="text-[10px] font-bold text-rose-400 mb-1">提前退租占比</div>
                                <div className="flex items-end gap-2">
                                    <span className="text-xl font-black text-rose-700">{formatPercent(perfData.earlyRate)}</span>
                                    <div className="flex-1 bg-rose-200 h-1.5 rounded-full mb-1.5 overflow-hidden"><div className="bg-rose-600 h-full" style={{width: `${perfData.earlyRate}%`}}></div></div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] font-bold text-slate-400">退租数</div>
                                <div className="text-sm font-black text-slate-700">{perfData.metrics.terminatedCount} <span className="text-[10px] font-normal">家</span></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 新增：年度趋势图表 */}
            {dashboardData && (
                <React.Suspense fallback={<div className="liquid-contract-analysis-card h-48 p-6 text-sm text-slate-400">图表加载中...</div>}>
                    <ContractDashboardTrendCharts data={dashboardData} />
                </React.Suspense>
            )}

            {/* Trends Chart */}
            <div className="liquid-contract-analysis-card p-6">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-2">
                        <div className="liquid-icon-well flex h-10 w-10 items-center justify-center rounded-2xl text-blue-700"><BarChart3 size={20}/></div>
                        <div><h3 className="font-bold text-slate-800">租赁面积变动趋势 (近12个月)</h3><p className="text-xs text-slate-500 mt-0.5">展示各月新签面积与退租面积的博弈及净增长</p></div>
                    </div>
                </div>
                <div className="h-[320px] w-full">
                    <React.Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-400">图表加载中...</div>}>
                        <ContractAreaChangeChart data={perfData.trend} />
                    </React.Suspense>
                </div>
            </div>

            {/* Churn Reasons Distribution */}
            <div className="liquid-contract-analysis-card p-6">
                <div className="flex items-center gap-2 mb-6">
                    <div className="liquid-icon-well flex h-10 w-10 items-center justify-center rounded-2xl text-rose-600"><PieChart size={20}/></div>
                    <h3 className="font-bold text-slate-800">退租分析</h3>
                </div>
                
                {/* 退租数量统计卡片 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="liquid-contract-mini-card p-4">
                        <div className="text-xs text-slate-500 mb-1">本年退租</div>
                        <div className="text-2xl font-bold text-slate-800">{perfData.terminationStats.year}</div>
                        <div className="text-xs text-slate-500 mt-1">家企业</div>
                    </div>
                    
                    <div className="liquid-contract-mini-card p-4">
                        <div className="text-xs text-amber-600 mb-1">本季度退租</div>
                        <div className="text-2xl font-bold text-amber-800">{perfData.terminationStats.quarter}</div>
                        <div className="text-xs text-amber-600 mt-1">家企业</div>
                    </div>
                    
                    <div className="liquid-contract-mini-card p-4">
                        <div className="text-xs text-rose-600 mb-1">本月退租</div>
                        <div className="text-2xl font-bold text-rose-800">{perfData.terminationStats.month}</div>
                        <div className="text-xs text-rose-600 mt-1">家企业</div>
                    </div>
                    
                    <div className="liquid-contract-mini-card p-4">
                        <div className="text-xs text-rose-600 mb-1">提前退租率</div>
                        <div className="text-2xl font-bold text-red-800">{formatPercent(perfData.earlyRate)}</div>
                        <div className="text-xs text-rose-600 mt-1">{perfData.terminationStats.earlyCount}/{perfData.terminationStats.all} 家</div>
                    </div>
                </div>
                
                {/* 退租原因分布图表 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 退租类型饼图 */}
                    <div>
                        <h4 className="text-sm font-bold text-slate-700 mb-3">退租类型分布</h4>
                        <div className="h-[200px] flex items-center">
                            {perfData.terminationTypeData.length > 0 ? (
                                <React.Suspense fallback={<div className="flex h-full w-full items-center justify-center text-sm text-slate-400">图表加载中...</div>}>
                                    <ContractTerminationTypeChart data={perfData.terminationTypeData} />
                                </React.Suspense>
                            ) : (
                                <p className="text-center text-slate-400 py-10 w-full">暂无退租记录</p>
                            )}
                        </div>
                    </div>
                    
                    {/* 退租原因排行 */}
                    <div>
                        <h4 className="text-sm font-bold text-slate-700 mb-3">退租原因TOP5</h4>
                        <div className="space-y-2">
                            {perfData.reasons.slice(0, 5).map((r, i) => {
                                const percentage = perfData.terminationStats.all > 0 
                                    ? ((r.value / perfData.terminationStats.all) * 100).toFixed(1)
                                    : 0;
                                return (
                                    <div key={i} className="relative">
                                        <div className="flex items-center justify-between text-xs mb-1">
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-5 rounded flex items-center justify-center bg-slate-100 text-slate-600 font-bold">
                                                    {i + 1}
                                                </div>
                                                <span className="text-slate-700 font-medium truncate max-w-[120px]">{r.name}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-slate-800">{r.value} 家</span>
                                                <span className="text-slate-500">({formatPercent(Number(percentage))})</span>
                                            </div>
                                        </div>
                                        <div className="w-full bg-slate-100 rounded-full h-2">
                                            <div 
                                                className="bg-gradient-to-r from-rose-400 to-rose-600 h-2 rounded-full transition-all"
                                                style={{width: `${percentage}%`}}
                                            ></div>
                                        </div>
                                    </div>
                                );
                            })}
                            {perfData.reasons.length === 0 && (
                                <p className="text-center text-slate-400 py-10">暂无退租记录</p>
                            )}
                            {perfData.reasons.length > 5 && (
                                <div className="text-xs text-slate-400 text-center pt-2">
                                    还有 {perfData.reasons.length - 5} 个其他原因...
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}

      {activeTab === 'SourceAnalysis' && (
        <React.Suspense fallback={
          <div className="liquid-analysis-chart flex min-h-[220px] items-center justify-center rounded-[24px] p-6">
            <div className="flex flex-col items-center text-center">
              <span className="liquid-icon-well flex h-12 w-12 items-center justify-center rounded-[18px] text-blue-700">
                <Activity size={20} className="animate-pulse" />
              </span>
              <p className="mt-3 text-sm font-black text-slate-700">来源分析加载中</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">正在准备图表与明细</p>
            </div>
          </div>
        }>
          <SourceAnalysisDashboard
            tenants={tenants}
            cloudConfig={cloudConfig}
            serverComputeEnabled={serverComputeEnabled}
            onEditTenant={handleEdit}
          />
        </React.Suspense>
      )}

      {(activeTab === 'List' || activeTab === 'Terminated') && (
          <>
            <div className={`liquid-contract-toolbar mb-4 rounded-[24px] p-3 sm:p-4 ${mobileEntryMode ? 'hidden lg:block' : ''}`}>
                {/* 第一行：筛选（小屏可横向滑动，避免与操作区抢高） */}
                <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:pb-0">
                    <div className="liquid-glass-readable flex min-w-0 shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm sm:min-w-[10rem]">
                        <Filter size={15} className="shrink-0 text-blue-500" aria-hidden />
                        <select
                            value={filterBuilding}
                            onChange={(e) => setFilterBuilding(e.target.value)}
                            aria-label="按楼宇筛选"
                            className="min-w-[6.5rem] max-w-[11rem] flex-1 cursor-pointer truncate bg-transparent text-sm font-medium text-slate-700 focus:outline-none sm:max-w-[14rem]"
                        >
                            <option value="all">所有楼宇</option>
                            {buildings.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    {activeTab === 'List' && (
                        <div className="liquid-glass-readable flex min-w-0 shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm sm:min-w-[8.5rem]">
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                aria-label="按合同状态筛选"
                                className="min-w-[6.5rem] max-w-[10rem] flex-1 cursor-pointer truncate bg-transparent text-sm font-medium text-slate-700 focus:outline-none"
                            >
                                <option value="all">合同状态</option>
                                <option value={ContractStatus.Active}>履约中</option>
                                <option value={ContractStatus.Expiring}>即将到期</option>
                                <option value="risk">⚠️ 高风险</option>
                                <option value="special">✨ 特殊业态</option>
                            </select>
                        </div>
                    )}
                    <div className="liquid-glass-readable flex min-w-0 shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm sm:min-w-[8.5rem]">
                        <select
                            value={filterPaymentCycle}
                            onChange={(e) => setFilterPaymentCycle(e.target.value)}
                            aria-label="按付款方式筛选"
                            className="min-w-[6.5rem] max-w-[9.5rem] flex-1 cursor-pointer truncate bg-transparent text-sm font-medium text-slate-700 focus:outline-none"
                        >
                            <option value="all">付款方式</option>
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

                {/* 第二行：搜索 + 批量/视图 + 主操作 */}
                <div className="mt-3 flex flex-col gap-3 lg:mt-3.5 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
                    <div className="liquid-glass-readable relative min-w-0 w-full rounded-full lg:max-w-md lg:flex-1">
                        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-500" aria-hidden />
                        <input
                            type="search"
                            enterKeyHint="search"
                            placeholder="搜索企业名称…"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full rounded-full bg-transparent py-2.5 pl-9 pr-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-500 focus:ring-0"
                        />
                    </div>

                    {activeTab === 'List' ? (
                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:shrink-0 lg:gap-3">
                            <div
                                className="liquid-glass-control flex flex-wrap items-center gap-1.5 rounded-[20px] p-1 sm:justify-end"
                                role="group"
                                aria-label="批量与导入"
                            >
                                {!isMobileQueryOnly && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={handleBatchDeleteContracts}
                                            disabled={!viewRentPricing || batchSelectedContractIds.size === 0}
                                            className="inline-flex items-center gap-1 rounded-full border border-transparent px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50/80 disabled:pointer-events-none disabled:opacity-40 sm:px-3 sm:text-sm"
                                            title="删除已勾选的可删合同"
                                        >
                                            <Trash2 size={14} className="shrink-0 opacity-80" aria-hidden />
                                            <span>删除</span>
                                            <span className="tabular-nums text-rose-600/90">({batchSelectedContractIds.size})</span>
                                        </button>
                                        <span className="hidden h-5 w-px bg-slate-300/80 sm:inline" aria-hidden />
                                    </>
                                )}
                                <button
                                    type="button"
                                    onClick={handleExportTenants}
                                    className="inline-flex items-center gap-1 rounded-full border border-transparent px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white/76 sm:px-3 sm:text-sm"
                                    title="导出当前筛选结果"
                                >
                                    <Download size={14} className="shrink-0 text-slate-500" aria-hidden />
                                    导出
                                </button>
                                {!isMobileQueryOnly && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={handleDownloadTemplate}
                                            className="inline-flex items-center gap-1 rounded-full border border-transparent px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white/76 sm:px-3 sm:text-sm"
                                            title="下载导入模板"
                                        >
                                            模板
                                        </button>
                                        <label
                                            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-transparent px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white/76 sm:px-3 sm:text-sm"
                                            title="批量导入（Excel）"
                                        >
                                            <Upload size={14} className="shrink-0 text-slate-500" aria-hidden />
                                            导入
                                            <input
                                                type="file"
                                                accept=".xlsx,.xls,.csv"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const f = e.target.files?.[0];
                                                    if (!f) return;
                                                    void handleBatchImportFile(f);
                                                    e.target.value = '';
                                                }}
                                            />
                                        </label>
                                    </>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                <div
                                    className="liquid-glass-control inline-flex items-center rounded-full p-1"
                                    title="切换在租明细布局"
                                >
                                    <button
                                        type="button"
                                        onClick={() => setListLayoutMode('Card')}
                                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-bold transition-colors sm:px-3 ${
                                            listLayoutMode === 'Card'
                                                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                                                : 'text-slate-500 hover:bg-white/62 hover:text-slate-900'
                                        }`}
                                        title="卡片视图：按楼栋→楼层分组，含账期 ◀▶ 微调"
                                    >
                                        <LayoutGrid size={14} aria-hidden /> 卡片
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setListLayoutMode('Table')}
                                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-bold transition-colors sm:px-3 ${
                                            listLayoutMode === 'Table'
                                                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                                                : 'text-slate-500 hover:bg-white/62 hover:text-slate-900'
                                        }`}
                                        title="表格视图：紧凑列表"
                                    >
                                        <Rows3 size={14} aria-hidden /> 表格
                                    </button>
                                </div>
                                {!isMobileQueryOnly && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => setShowAIContractImport(true)}
                                            className="liquid-action liquid-pressable inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold shadow-sm sm:px-4 sm:text-sm"
                                            title="上传截图/文本/Excel，由 AI 识别并生成合同草稿"
                                        >
                                            <Sparkles size={15} className="shrink-0" aria-hidden />
                                            <span className="sm:hidden">AI导入</span>
                                            <span className="hidden sm:inline">AI识别导入</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={beginNewContract}
                                            className="liquid-action-strong liquid-pressable inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold shadow-sm sm:flex-initial sm:px-4 sm:text-sm"
                                        >
                                            <Plus size={16} className="shrink-0" aria-hidden />
                                            新签客户
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            {/* ========================================================================
                卡片式布局：仅当 activeTab='List' 且用户选择 'Card' 时启用。
                按 楼栋（building） → 楼层（floor） → 客户卡片 三层分组渲染；
                每张卡片右下角带 ◀ ▶ 按钮，可直接整体平移合同账期 ±1 个月
                （写入 tenant.paymentPeriodShiftMonths，与「详情 → 账期调整」等价）。
            ======================================================================== */}
            {activeTab === 'List' && listLayoutMode === 'Card' ? (
                buildingFloorGroups.length === 0 ? (
                    <div className="liquid-contract-list rounded-[24px] p-12 text-center text-slate-500 text-sm">
                        暂无在租客户
                    </div>
                ) : (
                    <div className="space-y-5">
                        {buildingFloorGroups.map((group) => {
                            const totalCount = group.floors.reduce((acc, f) => acc + f.tenants.length, 0);
                            return (
                                <section
                                    key={group.buildingId}
                                    className="liquid-contract-list rounded-[24px] overflow-hidden"
                                >
                                    <header className="border-b border-white/70 bg-white/54 px-4 md:px-5 py-3 flex items-center gap-2">
                                        <span className="liquid-icon-well inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-blue-700">
                                            <BuildingIcon size={16} />
                                        </span>
                                        <h3 className="font-black text-slate-900 text-sm md:text-base">
                                            {group.buildingName}
                                        </h3>
                                        <span className="ml-auto rounded-full border border-white/70 bg-white/62 px-2.5 py-1 text-[11px] font-bold tabular-nums text-blue-700 shadow-sm">
                                            {totalCount} 家
                                        </span>
                                    </header>
                                    {group.floors.map((fg) => (
                                        <div key={`${group.buildingId}_${fg.floorLabel}`}>
                                            <div className="liquid-contract-sticky px-4 md:px-5 py-2 border-b border-white/70 flex items-center gap-2 sticky top-0 z-[1]">
                                                <span className="text-xs font-bold text-slate-700">
                                                    {fg.floorLabel}
                                                </span>
                                                <span className="text-[10px] text-slate-400">·</span>
                                                <span className="text-[10px] text-slate-500 font-medium">
                                                    {fg.tenants.length} 家
                                                </span>
                                            </div>
                                            <div className="p-3 md:p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                                                {fg.tenants.map((t) => {
                                                    const asset = tenantAssetDisplayById.get(t.id);
                                                    const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
                                                    const displayPrice = rentDisplay.unitPrice;
                                                    // 北京：同时显示天单价和月租金
                                                    const showBoth = t.projectId === 'beijing_park';
                                                    const contractYear = Number(
                                                        (t.signingDate || t.leaseStart || '').slice(0, 4),
                                                    );
                                                    const isThisYearContract = contractYear === currentCalendarYear;
                                                    const isRenewalContract = Boolean(t.rootId);
                                                    const periodShift = t.paymentPeriodShiftMonths || 0;
                                                    const monthlyAdjCount = (t.paymentPeriodAdjustments || []).length;
                                                    const hasShift = periodShift !== 0;
                                                    const hasAdjustment = hasShift || monthlyAdjCount > 0;
                                                    return (
                                                        <article
                                                            key={t.id}
                                                            className={`liquid-contract-card liquid-pressable relative flex flex-col border rounded-2xl transition-all overflow-hidden ${
                                                                hasAdjustment
                                                                    ? 'border-amber-200 ring-1 ring-amber-100'
                                                                    : t.isRisk
                                                                      ? 'border-rose-200 ring-1 ring-rose-100'
                                                                      : 'border-slate-200'
                                                            }`}
                                                        >
                                                            {/* 头部：选择框 + 客户名 + 状态标签 */}
                                                            <div className="px-3.5 pt-3 pb-2 border-b border-white/70">
                                                                <div className="flex items-start gap-2">
                                                                    {canBatchSelectTenant(t) ? (
                                                                        <input
                                                                            type="checkbox"
                                                                            className="mt-1 rounded border-slate-300 shrink-0"
                                                                            checked={batchSelectedContractIds.has(t.id)}
                                                                            onChange={() => toggleBatchContractSelect(t.id)}
                                                                            title="加入批量删除选区"
                                                                        />
                                                                    ) : (
                                                                        <span className="mt-1 w-4 h-4 inline-flex items-center justify-center text-slate-300 text-[10px] shrink-0" title="虚拟/预算占位合同不可批量删除">
                                                                            —
                                                                        </span>
                                                                    )}
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                                            <h4
                                                                                className="font-bold text-slate-800 text-sm leading-tight break-anywhere"
                                                                                title={t.name}
                                                                            >
                                                                                {t.name}
                                                                            </h4>
                                                                            {t.isRisk && (
                                                                                <ShieldAlert
                                                                                    size={14}
                                                                                    className="text-rose-500 shrink-0"
                                                                                    aria-label="高风险"
                                                                                />
                                                                            )}
                                                                        </div>
                                                                        <div className="mt-1.5 flex flex-wrap gap-1">
                                                                            {isThisYearContract && (
                                                                                <span
                                                                                    className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${
                                                                                        isRenewalContract
                                                                                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                                                            : 'bg-cyan-50 text-cyan-700 border-cyan-200'
                                                                                    }`}
                                                                                >
                                                                                    {isRenewalContract ? '本年续租' : '本年新签'}
                                                                                </span>
                                                                            )}
                                                                            {t.isSpecialBusiness && (
                                                                                <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-0.5">
                                                                                    <Sparkles size={10} /> 特殊业态
                                                                                </span>
                                                                            )}
                                                                            {!!(t.rentFreePeriods && t.rentFreePeriods.length > 0) && t.freeRentHandling === 'Defer' && (
                                                                                <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-bold">
                                                                                    账期顺延
                                                                                </span>
                                                                            )}
                                                                            {!!(t.rentFreePeriods && t.rentFreePeriods.length > 0) && t.freeRentHandling === 'Deduct' && (
                                                                                <span className="text-[10px] bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded font-bold">
                                                                                    当期扣除
                                                                                </span>
                                                                            )}
                                                                            {renderManagementFeeTags(t, projectIdProp)}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* 主体：位置 + 关键合同信息 */}
                                                            <div className="px-3.5 py-3 space-y-2 text-xs flex-1">
                                                                <div className="flex items-center gap-1.5 text-slate-700">
                                                                    <MapPin size={12} className="text-slate-400 shrink-0" />
                                                                    <span className="font-medium">{asset?.buildingName}</span>
                                                                    <span className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-mono text-slate-700 ring-1 ring-slate-200/70" title={asset?.unitNames}>
                                                                        {asset?.unitNames}
                                                                    </span>
                                                                </div>
                                                                {t.sourceAgentName && (
                                                                    <div className="flex items-center gap-1.5 text-slate-600">
                                                                        <Briefcase size={12} className="text-slate-400 shrink-0" />
                                                                        <span className="text-[11px]">来源：<span className="font-medium text-slate-700">{t.sourceAgentName}</span></span>
                                                                    </div>
                                                                )}
                                                                <div className="grid grid-cols-2 gap-x-2 gap-y-2">
                                                                    <div>
                                                                        <div className="text-[10px] text-slate-400 font-medium">起租日期</div>
                                                                        <div className="text-slate-800 font-bold tabular-nums">{t.leaseStart || '—'}</div>
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-[10px] text-slate-400 font-medium">实际入驻</div>
                                                                        <div className="text-slate-700 font-medium tabular-nums">
                                                                            {t.moveInDate || <span className="text-slate-400">同起租</span>}
                                                                        </div>
                                                                    </div>
                                                                    <div className="col-span-2">
                                                                        <div className="text-[10px] text-slate-400 font-medium">合同期</div>
                                                                        <div className="text-slate-700 tabular-nums text-[11px]">
                                                                            {t.leaseStart} <span className="text-slate-400 mx-0.5">~</span> {t.leaseEnd}
                                                                        </div>
                                                                    </div>
                                                                    {viewRentPricing && (
                                                                        <div>
                                                                            <div className="text-[10px] text-slate-400 font-medium">{rentDisplay.label}</div>
                                                                            <div className="text-blue-600 font-bold tabular-nums">
                                                                                ¥{Number(displayPrice).toFixed(2)}
                                                                                <span className="text-[10px] font-normal text-slate-400 ml-0.5">/㎡·{rentDisplay.suffix}</span>
                                                                            </div>
                                                                            {showBoth && (
                                                                                <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                                                                                    月租 ¥{(t.monthlyRent || 0).toLocaleString()}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    <div>
                                                                        <div className="text-[10px] text-slate-400 font-medium">付款周期</div>
                                                                        <div className="text-slate-800 font-medium">
                                                                            {paymentCycleLabelMap[t.paymentCycle] || t.paymentCycle}
                                                                        </div>
                                                                    </div>
                                                                    {renderManagementFeeCardFields(t, projectIdProp)}
                                                                </div>
                                                            </div>

                                                            {/* 账期调整：状态显示 + ◀▶ 一键平移 */}
                                                            {t.status !== ContractStatus.Terminated && (
                                                                <div
                                                                    className={`px-3.5 py-2 border-t flex items-center justify-between gap-2 ${
                                                                        hasAdjustment
                                                                            ? 'bg-amber-50/70 border-amber-100'
                                                                            : 'bg-white/44 border-white/70'
                                                                    }`}
                                                                >
                                                                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                                                        <ArrowLeftRight
                                                                            size={11}
                                                                            className={hasAdjustment ? 'text-amber-600' : 'text-slate-400'}
                                                                        />
                                                                        <span className={`text-[10px] font-bold uppercase tracking-wide ${hasAdjustment ? 'text-amber-700' : 'text-slate-500'}`}>
                                                                            账期
                                                                        </span>
                                                                        <span
                                                                            className={`text-[11px] font-bold tabular-nums ${
                                                                                hasShift ? 'text-amber-700' : 'text-slate-600'
                                                                            }`}
                                                                            title={
                                                                                hasShift
                                                                                    ? `所有收款日期整体${periodShift > 0 ? '后移' : '前移'} ${Math.abs(periodShift)} 个月`
                                                                                    : '点击 ◀▶ 整体平移合同账期 ±1 个月'
                                                                            }
                                                                        >
                                                                            {hasShift
                                                                                ? `${periodShift > 0 ? '后移' : '前移'} ${Math.abs(periodShift)} 月`
                                                                                : '原账期'}
                                                                        </span>
                                                                        {monthlyAdjCount > 0 && (
                                                                            <span
                                                                                className="text-[10px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold border border-amber-200"
                                                                                title={`含 ${monthlyAdjCount} 笔单月级人工调整（在「详情」中查看）`}
                                                                            >
                                                                                +{monthlyAdjCount} 单月
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-0.5 shrink-0">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleShiftPaymentPeriod(t.id, -1)}
                                                                            className="rounded-full p-1 text-slate-600 transition-colors hover:bg-amber-100/80 hover:text-amber-700"
                                                                            title="账期整体提前 1 个月（适用于「需要提前收款」场景）"
                                                                            aria-label="账期整体提前 1 个月"
                                                                        >
                                                                            <ChevronLeft size={14} />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleShiftPaymentPeriod(t.id, +1)}
                                                                            className="rounded-full p-1 text-slate-600 transition-colors hover:bg-amber-100/80 hover:text-amber-700"
                                                                            title="账期整体后移 1 个月（适用于「需要延后收款」场景）"
                                                                            aria-label="账期整体后移 1 个月"
                                                                        >
                                                                            <ChevronRight size={14} />
                                                                        </button>
                                                                        {hasShift && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleClearPaymentPeriodShift(t.id)}
                                                                                className="ml-0.5 rounded-full p-1 text-slate-400 transition-colors hover:bg-rose-50/90 hover:text-rose-600"
                                                                                title="清除整体偏移，恢复原账期（不影响单月级调整）"
                                                                                aria-label="清除账期偏移"
                                                                            >
                                                                                <RotateCcw size={12} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* 操作 */}
                                                            <div className="px-3.5 py-2 border-t border-white/70 flex items-center justify-end gap-3 bg-white/56">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleEdit(t)}
                                                                    className="text-blue-600 font-bold text-xs hover:underline inline-flex items-center gap-1"
                                                                >
                                                                    <FileText size={12} /> 详情
                                                                </button>
                                                                {!isMobileQueryOnly && canRenewContract(t) && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleRenewal(t)}
                                                                        className="text-blue-600 font-bold text-xs hover:underline"
                                                                    >
                                                                        续签
                                                                    </button>
                                                                )}
                                                                {!isMobileQueryOnly && t.status !== ContractStatus.Terminated && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => initiateTermination(t.id)}
                                                                        className="text-amber-600 font-bold text-xs hover:underline"
                                                                    >
                                                                        退租
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </article>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </section>
                            );
                        })}
                    </div>
                )
            ) : (
            <div className="liquid-contract-list rounded-[24px] overflow-hidden">
                <div className="hidden lg:block overflow-x-auto">
                    {useVirtualContractRows ? (
                        <VirtualizedTable<ContractDesktopRow>
                            rows={contractDesktopRows}
                            getRowKey={(row) => row.key}
                            estimateRowHeight={68}
                            dynamicHeight
                            overscan={10}
                            height="72vh"
                            className="min-w-[920px]"
                            tableClassName="w-full text-sm text-left min-w-[920px] table-fixed"
                            emptyMessage={activeTab === 'List' ? '暂无在租客户' : '暂无历史退租记录'}
                            renderColgroup={() => (
                                activeTab === 'List' ? (
                                    <colgroup>
                                        <col style={{ width: '5%' }} />
                                        <col style={{ width: '22%' }} />
                                        <col style={{ width: '18%' }} />
                                        <col style={{ width: '11%' }} />
                                        <col style={{ width: '10%' }} />
                                        <col style={{ width: '17%' }} />
                                        <col style={{ width: '9%' }} />
                                        <col style={{ width: '8%' }} />
                                    </colgroup>
                                ) : (
                                    <colgroup>
                                        <col style={{ width: '24%' }} />
                                        <col style={{ width: '19%' }} />
                                        <col style={{ width: '12%' }} />
                                        <col style={{ width: '10%' }} />
                                        <col style={{ width: '18%' }} />
                                        <col style={{ width: '9%' }} />
                                        <col style={{ width: '8%' }} />
                                    </colgroup>
                                )
                            )}
                            renderHeader={() => (
                                <tr className="liquid-contract-sticky text-slate-600 font-bold border-b border-white/70">
                                    {activeTab === 'List' && <th className="px-3 py-4 text-center">选</th>}
                                    <th className="px-6 py-4">客户名称</th>
                                    <th className="px-6 py-4">租赁位置</th>
                                    <th className="px-6 py-4">{activeTab === 'Terminated' ? '退租日期' : '起租日期'}</th>
                                    <th className="px-6 py-4">实际入驻</th>
                                    <th className="px-6 py-4">合同期 & 单价</th>
                                    <th className="px-6 py-4">付款周期</th>
                                    <th className="px-6 py-4 text-right">操作</th>
                                </tr>
                            )}
                            renderRow={(row) => {
                                if (row.kind === 'building') {
                                    return (
                                        <tr className="liquid-contract-group-row">
                                            <td colSpan={8} className="px-6 py-2 font-bold text-xs text-blue-800">
                                                {row.buildingName} ({row.count}家)
                                            </td>
                                        </tr>
                                    );
                                }
                                if (row.kind === 'floor') {
                                    return (
                                        <tr className="liquid-contract-floor-row">
                                            <td colSpan={8} className="px-6 py-2 font-semibold text-[11px] text-slate-600">
                                                {row.floorLabel} ({row.count}家)
                                            </td>
                                        </tr>
                                    );
                                }
                                if (row.kind === 'year') {
                                    return (
                                        <tr className="liquid-contract-year-row" data-tone={activeTab === 'Terminated' ? 'rose' : 'blue'}>
                                            <td colSpan={7} className={`px-6 py-2 font-bold text-xs ${activeTab === 'Terminated' ? 'text-rose-800' : 'text-blue-800'}`}>
                                                {row.year}年度{activeTab === 'Terminated' ? '退租' : '起租'} ({row.count}家)
                                            </td>
                                        </tr>
                                    );
                                }
                                const t = row.tenant;
                                const building = buildingById.get(t.buildingId);
                                const unitNames = t.unitIds.map((uid) => unitNameById.get(uid) || uid).join(', ');
                                const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
                                const displayPrice = rentDisplay.unitPrice;

                                if (activeTab === 'List') {
                                    const contractYear = Number((t.signingDate || t.leaseStart || '').slice(0, 4));
                                    const isThisYearContract = contractYear === currentCalendarYear;
                                    const isRenewalContract = Boolean(t.rootId);
                                    return (
                                        <tr className="liquid-contract-data-row">
                                            <td className="px-3 py-4 text-center align-middle">
                                                {canBatchSelectTenant(t) ? (
                                                    <input
                                                        type="checkbox"
                                                        className="rounded border-slate-300"
                                                        checked={batchSelectedContractIds.has(t.id)}
                                                        onChange={() => toggleBatchContractSelect(t.id)}
                                                    />
                                                ) : (
                                                    <span className="text-slate-300 text-xs" title="虚拟/预算占位合同不可批量删除">—</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-slate-800">{t.name}</span>
                                                    {isThisYearContract && (
                                                        <span className="liquid-contract-pill" data-tone={isRenewalContract ? 'blue' : 'cyan'}>
                                                            {isRenewalContract ? '本年续租' : '本年新签'}
                                                        </span>
                                                    )}
                                                    {t.isRisk && <ShieldAlert size={14} className="text-rose-500" />}
                                                    {((t.paymentPeriodAdjustments || []).length > 0 || (t.paymentPeriodShiftMonths || 0) !== 0) && (
                                                        <span className="liquid-contract-pill" data-tone="amber" title={`${(t.paymentPeriodAdjustments || []).length}笔单月调整${(t.paymentPeriodShiftMonths || 0) !== 0 ? `，整体${t.paymentPeriodShiftMonths! > 0 ? '后移' : '前移'}${Math.abs(t.paymentPeriodShiftMonths!)}月` : ''}`}>
                                                            <ArrowLeftRight size={10} /> 账期调整
                                                        </span>
                                                    )}
                                                    {t.isSpecialBusiness && (
                                                        <span className="liquid-contract-pill" data-tone="amber">
                                                            <Sparkles size={10} /> 特殊业态
                                                        </span>
                                                    )}
                                                    {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Defer' && (
                                                        <span className="liquid-contract-pill" data-tone="blue">账期顺延</span>
                                                    )}
                                                    {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Deduct' && (
                                                        <span className="liquid-contract-pill" data-tone="sky">当期扣除</span>
                                                    )}
                                                    {renderManagementFeeTags(t, projectIdProp)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-600">
                                                {building?.name} <span className="liquid-contract-location-chip">{unitNames}</span>
                                            </td>
                                            <td className="px-6 py-4"><div className="text-slate-700 font-bold">{t.leaseStart}</div></td>
                                            <td className="px-6 py-4 text-slate-600 text-xs">{t.moveInDate ? <span className="font-medium text-slate-800">{t.moveInDate}</span> : <span className="text-slate-400">同起租</span>}</td>
                                            <td className="px-6 py-4"><div className="text-slate-500 text-xs">{t.leaseStart} ~ {t.leaseEnd}</div><div className="text-blue-600 font-bold">{formatCurrency(displayPrice)}</div></td>
                                            <td className="px-6 py-4 text-slate-600 text-sm">{paymentCycleLabelMap[t.paymentCycle] || t.paymentCycle}</td>
                                            <td className="px-6 py-4 text-right space-x-3">
                                                <button onClick={() => handleEdit(t)} className="liquid-contract-row-action">详情</button>
                                                {!isMobileQueryOnly && canRenewContract(t) && <button onClick={() => handleRenewal(t)} className="liquid-contract-row-action">续签</button>}
                                                {!isMobileQueryOnly && t.status !== ContractStatus.Terminated && <button onClick={() => initiateTermination(t.id)} className="liquid-contract-row-action" data-tone="amber">退租</button>}
                                            </td>
                                        </tr>
                                    );
                                }

                                return (
                                    <tr className="liquid-contract-data-row">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-slate-800">{t.name}</span>
                                                {t.isRisk && <ShieldAlert size={14} className="text-rose-500" />}
                                                {t.isSpecialBusiness && (
                                                    <span className="liquid-contract-pill" data-tone="amber">
                                                        <Sparkles size={10} /> 特殊业态
                                                    </span>
                                                )}
                                                {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Defer' && (
                                                    <span className="liquid-contract-pill" data-tone="blue">账期顺延</span>
                                                )}
                                                {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Deduct' && (
                                                    <span className="liquid-contract-pill" data-tone="sky">当期扣除</span>
                                                )}
                                                {t.parentContractId && (
                                                    <span className="liquid-contract-pill" data-tone="amber">部分退租</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600">
                                            {building?.name} <span className="liquid-contract-location-chip">{unitNames}</span>
                                        </td>
                                        <td className="px-6 py-4"><div className="text-rose-600 font-bold">{t.terminationDate || t.leaseEnd}</div></td>
                                        <td className="px-6 py-4 text-slate-600 text-xs">{t.moveInDate ? <span className="font-medium text-slate-800">{t.moveInDate}</span> : <span className="text-slate-400">同起租</span>}</td>
                                        <td className="px-6 py-4"><div className="text-slate-500 text-xs">{t.leaseStart} ~ {t.leaseEnd}</div><div className="text-blue-600 font-bold">{formatCurrency(displayPrice)}</div></td>
                                        <td className="px-6 py-4 text-slate-600 text-sm">{paymentCycleLabelMap[t.paymentCycle] || t.paymentCycle}</td>
                                        <td className="px-6 py-4 text-right space-x-3">
                                            <button onClick={() => handleEdit(t)} className="liquid-contract-row-action">详情</button>
                                            {!isMobileQueryOnly && <button onClick={() => handleRollback(t.id)} className="liquid-contract-row-action">回退</button>}
                                        </td>
                                    </tr>
                                );
                            }}
                        />
                    ) : (
                    <table className="w-full text-sm text-left min-w-[920px]">
                    <thead className="liquid-contract-sticky text-slate-600 font-bold border-b border-white/70">
                        <tr>
                            {activeTab === 'List' && <th className="px-3 py-4 w-10 text-center">选</th>}
                            <th className="px-6 py-4">客户名称</th><th className="px-6 py-4">租赁位置</th><th className="px-6 py-4">{activeTab === 'Terminated' ? '退租日期' : '起租日期'}</th><th className="px-6 py-4">实际入驻</th><th className="px-6 py-4">合同期 & 单价</th><th className="px-6 py-4">付款周期</th><th className="px-6 py-4 text-right">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {activeTab === 'List' ? buildingFloorGroups.map(group => (
                            <React.Fragment key={group.buildingId}>
                                <tr className="liquid-contract-group-row">
                                    <td colSpan={activeTab === 'List' ? 8 : 7} className="px-6 py-2 font-bold text-xs text-blue-800">{group.buildingName} ({group.floors.reduce((acc, f) => acc + f.tenants.length, 0)}家)</td>
                                </tr>
                                {group.floors.map(fg => (
                                    <React.Fragment key={`${group.buildingId}_${fg.floorLabel}`}>
                                        <tr className="liquid-contract-floor-row">
                                            <td colSpan={activeTab === 'List' ? 8 : 7} className="px-6 py-2 font-semibold text-[11px] text-slate-600">{fg.floorLabel} ({fg.tenants.length}家)</td>
                                        </tr>
                                        {fg.tenants.map(t => {
                                            const asset = tenantAssetDisplayById.get(t.id);
                                            const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
                                                const displayPrice = rentDisplay.unitPrice;
                                            const contractYear = Number((t.signingDate || t.leaseStart || '').slice(0, 4));
                                            const isThisYearContract = contractYear === currentCalendarYear;
                                            const isRenewalContract = Boolean(t.rootId);
                                            return (
                                                <tr key={t.id} className="liquid-contract-data-row">
                                                    <td className="px-3 py-4 text-center align-middle">
                                                        {canBatchSelectTenant(t) ? (
                                                            <input
                                                                type="checkbox"
                                                                className="rounded border-slate-300"
                                                                checked={batchSelectedContractIds.has(t.id)}
                                                                onChange={() => toggleBatchContractSelect(t.id)}
                                                            />
                                                        ) : (
                                                            <span className="text-slate-300 text-xs" title="虚拟/预算占位合同不可批量删除">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-bold text-slate-800">{t.name}</span>
                                                            {isThisYearContract && (
                                                                <span className="liquid-contract-pill" data-tone={isRenewalContract ? 'blue' : 'cyan'}>
                                                                    {isRenewalContract ? '本年续租' : '本年新签'}
                                                                </span>
                                                            )}
                                                            {t.isRisk && <ShieldAlert size={14} className="text-rose-500" />}
                                                            {((t.paymentPeriodAdjustments || []).length > 0 || (t.paymentPeriodShiftMonths || 0) !== 0) && (
                                                                <span className="liquid-contract-pill" data-tone="amber" title={`${(t.paymentPeriodAdjustments || []).length}笔单月调整${(t.paymentPeriodShiftMonths || 0) !== 0 ? `，整体${t.paymentPeriodShiftMonths! > 0 ? '后移' : '前移'}${Math.abs(t.paymentPeriodShiftMonths!)}月` : ''}`}>
                                                                    <ArrowLeftRight size={10} /> 账期调整
                                                                </span>
                                                            )}
                                                            {t.isSpecialBusiness && (
                                                                <span className="liquid-contract-pill" data-tone="amber">
                                                                    <Sparkles size={10} /> 特殊业态
                                                                </span>
                                                            )}
                                                            {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Defer' && (
                                                                <span className="liquid-contract-pill" data-tone="blue">账期顺延</span>
                                                            )}
                                                            {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Deduct' && (
                                                                <span className="liquid-contract-pill" data-tone="sky">当期扣除</span>
                                                            )}
                                                            {renderManagementFeeTags(t, projectIdProp)}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-slate-600">{asset?.buildingName} <span className="liquid-contract-location-chip">{asset?.unitNames}</span></td>
                                                    <td className="px-6 py-4"><div className="text-slate-700 font-bold">{t.leaseStart}</div></td>
                                                    <td className="px-6 py-4 text-slate-600 text-xs">{t.moveInDate ? <span className="font-medium text-slate-800">{t.moveInDate}</span> : <span className="text-slate-400">同起租</span>}</td>
                                                    <td className="px-6 py-4"><div className="text-slate-500 text-xs">{t.leaseStart} ~ {t.leaseEnd}</div><div className="text-blue-600 font-bold">{formatCurrency(displayPrice)}</div></td>
                                                    <td className="px-6 py-4 text-slate-600 text-sm">{paymentCycleLabelMap[t.paymentCycle] || t.paymentCycle}</td>
                                                    <td className="px-6 py-4 text-right"><button onClick={() => handleEdit(t)} className="liquid-contract-row-action">详情</button>{!isMobileQueryOnly && canRenewContract(t) && <button onClick={() => handleRenewal(t)} className="liquid-contract-row-action">续签</button>}{!isMobileQueryOnly && t.status !== ContractStatus.Terminated && <button onClick={() => initiateTermination(t.id)} className="liquid-contract-row-action" data-tone="amber">退租</button>}</td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                ))}
                            </React.Fragment>
                        )) : sortedYears.map(group => (
                            <React.Fragment key={group.year}>
                                <tr className="liquid-contract-year-row" data-tone={activeTab === 'Terminated' ? 'rose' : 'blue'}><td colSpan={7} className={`px-6 py-2 font-bold text-xs ${activeTab === 'Terminated' ? 'text-rose-800' : 'text-blue-800'}`}>{group.year}年度{activeTab === 'Terminated' ? '退租' : '起租'} ({group.tenants.length}家)</td></tr>
                                {group.tenants.map(t => {
                                    const asset = tenantAssetDisplayById.get(t.id);
                                    const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
                                    const displayPrice = rentDisplay.unitPrice;
                                    return (
                                                <tr key={t.id} className="liquid-contract-data-row">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-slate-800">{t.name}</span>
                                                    {t.isRisk && <ShieldAlert size={14} className="text-rose-500" />}
                                                    {t.isSpecialBusiness && (
                                                        <span className="liquid-contract-pill" data-tone="amber">
                                                            <Sparkles size={10} /> 特殊业态
                                                        </span>
                                                    )}
                                                    {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Defer' && (
                                                        <span className="liquid-contract-pill" data-tone="blue">
                                                            账期顺延
                                                        </span>
                                                    )}
                                                    {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Deduct' && (
                                                        <span className="liquid-contract-pill" data-tone="sky">
                                                            当期扣除
                                                        </span>
                                                    )}
                                                    {t.parentContractId && (
                                                        <span className="liquid-contract-pill" data-tone="amber">
                                                            部分退租
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-600">{asset?.buildingName} <span className="liquid-contract-location-chip">{asset?.unitNames}</span></td>
                                            <td className="px-6 py-4">{activeTab === 'Terminated' ? <div className="text-rose-600 font-bold">{t.terminationDate || t.leaseEnd}</div> : <div className="text-slate-700 font-bold">{t.leaseStart}</div>}</td>
                                            <td className="px-6 py-4 text-slate-600 text-xs">{t.moveInDate ? <span className="font-medium text-slate-800">{t.moveInDate}</span> : <span className="text-slate-400">同起租</span>}</td>
                                            <td className="px-6 py-4"><div className="text-slate-500 text-xs">{t.leaseStart} ~ {t.leaseEnd}</div><div className="text-blue-600 font-bold">{formatCurrency(displayPrice)}</div></td>
                                            <td className="px-6 py-4 text-slate-600 text-sm">{paymentCycleLabelMap[t.paymentCycle] || t.paymentCycle}</td>
                                            <td className="px-6 py-4 text-right"><button onClick={() => handleEdit(t)} className="liquid-contract-row-action">详情</button>{!isMobileQueryOnly && <button onClick={() => handleRollback(t.id)} className="liquid-contract-row-action">回退</button>}</td>
                                        </tr>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </tbody>
                    </table>
                    )}
                </div>
                <div className="liquid-contract-mobile-list liquid-contract-mobile-list--master-detail lg:hidden">
                    <div className="liquid-contract-tablet-master-detail">
                        <div className="liquid-contract-tablet-list min-w-0">
                    {activeTab === 'List' ? (
                        buildingFloorGroups.length === 0 ? (
                            <ContractMobileEmptyState
                                icon={<Users size={24} />}
                                title="暂无在租客户"
                                detail={
                                    searchTerm || filterBuilding !== 'all' || filterStatus !== 'all' || filterPaymentCycle !== 'all'
                                        ? '当前筛选没有匹配合同，可以清除筛选或换个关键词。'
                                        : '当前园区还没有在租合同，可先录入第一份签约。'
                                }
                                action={
                                    !isMobileQueryOnly && !searchTerm && filterBuilding === 'all' && filterStatus === 'all' && filterPaymentCycle === 'all' ? (
                                        <button
                                            type="button"
                                            onClick={beginNewContract}
                                            className="liquid-mobile-inline-action-strong mobile-pressable inline-flex min-h-10 items-center rounded-full px-4 text-sm font-black"
                                        >
                                            新增合同
                                        </button>
                                    ) : undefined
                                }
                            />
                        ) : (
                            buildingFloorGroups.map((group) => (
                                <div key={group.buildingId}>
	                                    <div className="liquid-contract-mobile-group px-4 py-2 text-xs font-black text-blue-800">
                                        {group.buildingName} ({group.floors.reduce((acc, f) => acc + f.tenants.length, 0)}家)
                                    </div>
                                    {group.floors.map((fg) => (
                                        <div key={`${group.buildingId}_${fg.floorLabel}`}>
	                                            <div className="liquid-contract-mobile-floor px-4 py-1.5 text-xs font-bold text-slate-600">
                                                {fg.floorLabel} ({fg.tenants.length}家)
                                            </div>
                                            {fg.tenants.map((t) => {
                                                const asset = tenantAssetDisplayById.get(t.id);
                                                const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
                                            const displayPrice = rentDisplay.unitPrice;
                                                const contractYear = Number((t.signingDate || t.leaseStart || '').slice(0, 4));
                                                const isThisYearContract = contractYear === currentCalendarYear;
                                                const isRenewalContract = Boolean(t.rootId);
                                                return (
	                                                    <article
                                                            key={t.id}
                                                            data-selected={tabletPreviewTenant?.id === t.id ? 'true' : 'false'}
                                                            onClick={(event) => {
                                                                const target = event.target as HTMLElement;
                                                                if (target.closest('button, a, input, select, textarea')) return;
                                                                setTabletPreviewTenantId(t.id);
                                                            }}
                                                            className="liquid-contract-mobile-card mx-3 my-2 rounded-[20px] px-4 py-3"
                                                            style={MOBILE_CONTRACT_CARD_VISIBILITY_STYLE}
                                                        >
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="font-bold text-slate-800">{t.name}</span>
                                                            {isThisYearContract && (
                                                                <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${isRenewalContract ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-cyan-200 bg-cyan-50 text-cyan-700'}`}>
                                                                    {isRenewalContract ? '本年续租' : '本年新签'}
                                                                </span>
                                                            )}
                                                            {t.isRisk && <ShieldAlert size={14} className="text-rose-500" />}
                                                            {((t.paymentPeriodAdjustments || []).length > 0 || (t.paymentPeriodShiftMonths || 0) !== 0) && (
                                                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-700" title={`${(t.paymentPeriodAdjustments || []).length}笔单月调整${(t.paymentPeriodShiftMonths || 0) !== 0 ? `，整体${t.paymentPeriodShiftMonths! > 0 ? '后移' : '前移'}${Math.abs(t.paymentPeriodShiftMonths!)}月` : ''}`}>
                                                                    <ArrowLeftRight size={10} /> 账期调整
                                                                </span>
                                                            )}
                                                            {t.isSpecialBusiness && (
                                                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-700">
                                                                    <Sparkles size={10} /> 特殊业态
                                                                </span>
                                                            )}
                                                            {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Defer' && (
                                                                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-black text-blue-700">账期顺延</span>
                                                            )}
                                                            {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Deduct' && (
	                                                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-black text-sky-700">当期扣除</span>
                                                            )}
                                                            {renderManagementFeeTags(t, projectIdProp)}
                                                        </div>
                                                        <div className="text-xs text-slate-600 mt-1">
                                                            {asset?.buildingName}{' '}
	                                                            <span className="liquid-contract-mobile-chip px-1.5 py-0.5 font-medium">{asset?.unitNames}</span>
                                                        </div>
                                                        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-600">
                                                            <span>
                                                                <span className="text-slate-400">起租 </span>
                                                                <span className="font-semibold text-slate-800">{t.leaseStart}</span>
                                                            </span>
                                                            <span>
                                                                <span className="text-slate-400">入驻 </span>
                                                                {t.moveInDate ? <span className="font-medium text-slate-800">{t.moveInDate}</span> : <span className="text-slate-400">同起租</span>}
                                                            </span>
                                                            <span className="col-span-2">
                                                                <span className="text-slate-400">合同期 </span>
                                                                {t.leaseStart} ~ {t.leaseEnd}
                                                            </span>
                                                            {viewRentPricing && (
                                                                <span>
                                                                    <span className="text-slate-400">单价 </span>
                                                                    <span className="text-blue-600 font-bold">{formatCurrency(displayPrice)}</span>
                                                                </span>
                                                            )}
                                                            <span>
                                                                <span className="text-slate-400">付款 </span>
                                                                {paymentCycleLabelMap[t.paymentCycle] || t.paymentCycle}
                                                            </span>
                                                            {(() => {
                                                                const m = getManagementFeeCardStatus(t, projectIdProp);
                                                                if (!m.parkEnabled || (!m.collecting && !m.needsSetup)) return null;
                                                                return (
                                                                    <>
                                                                        <span>
                                                                            <span className="text-slate-400">物业费 </span>
                                                                            <span className="text-cyan-700 font-bold">
                                                                                {m.monthlyUnitPrice
                                                                                    ? `¥${m.monthlyUnitPrice.toFixed(2)}/㎡·月`
                                                                                    : m.monthlyAmount > 0
                                                                                      ? formatCurrency(m.monthlyAmount)
                                                                                      : '待配置'}
                                                                            </span>
                                                                        </span>
                                                                        {m.monthlyAmount > 0 && m.monthlyUnitPrice ? (
                                                                            <span>
                                                                                <span className="text-slate-400">月物业费 </span>
                                                                                <span className="text-cyan-800 font-bold">{formatCurrency(m.monthlyAmount)}</span>
                                                                            </span>
                                                                        ) : null}
                                                                    </>
                                                                );
                                                            })()}
                                                        </div>
                                                        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/70 pt-2">
                                                            <button type="button" onClick={() => setTabletPreviewTenantId(t.id)} className="liquid-pressable hidden rounded-full px-2.5 py-1 text-xs font-black text-slate-600 hover:bg-white/80 sm:inline-flex lg:hidden">
                                                                预览
                                                            </button>
                                                            <button type="button" onClick={() => handleEdit(t)} className="liquid-pressable rounded-full px-2.5 py-1 text-xs font-black text-blue-700 hover:bg-blue-50/80">
                                                                详情
                                                            </button>
                                                            {!isMobileQueryOnly && canRenewContract(t) && (
                                                                <button type="button" onClick={() => handleRenewal(t)} className="liquid-pressable rounded-full px-2.5 py-1 text-xs font-black text-blue-700 hover:bg-blue-50/80">
                                                                    续签
                                                                </button>
                                                            )}
                                                            {!isMobileQueryOnly && t.status !== ContractStatus.Terminated && (
                                                                <button type="button" onClick={() => initiateTermination(t.id)} className="liquid-pressable rounded-full px-2.5 py-1 text-xs font-black text-amber-700 hover:bg-amber-50/80">
                                                                    退租
                                                                </button>
                                                            )}
                                                        </div>
                                                    </article>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            ))
                        )
                    ) : sortedYears.length === 0 ? (
                        <ContractMobileEmptyState
                            icon={<UserMinus size={24} />}
                            title="暂无历史退租记录"
                            detail={
                                searchTerm || filterBuilding !== 'all' || filterPaymentCycle !== 'all'
                                    ? '当前筛选没有匹配的退租合同，可以调整关键词或筛选条件。'
                                    : '本年度暂无退租归档，历史合同会按退租年份分组展示。'
                            }
                        />
                    ) : (
                        sortedYears.map((group) => (
                            <div key={group.year}>
	                                <div className="liquid-contract-mobile-group px-4 py-2 text-xs font-black text-rose-800">
                                    {group.year}年度退租 ({group.tenants.length}家)
                                </div>
                                {group.tenants.map((t) => {
                                    const asset = tenantAssetDisplayById.get(t.id);
                                    const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
                                    const displayPrice = rentDisplay.unitPrice;
                                    return (
	                                        <article
                                                key={t.id}
                                                data-selected={tabletPreviewTenant?.id === t.id ? 'true' : 'false'}
                                                onClick={(event) => {
                                                    const target = event.target as HTMLElement;
                                                    if (target.closest('button, a, input, select, textarea')) return;
                                                    setTabletPreviewTenantId(t.id);
                                                }}
                                                className="liquid-contract-mobile-card mx-3 my-2 rounded-[20px] px-4 py-3"
                                                style={MOBILE_CONTRACT_CARD_VISIBILITY_STYLE}
                                            >
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-bold text-slate-800">{t.name}</span>
                                                {t.isRisk && <ShieldAlert size={14} className="text-rose-500" />}
                                                {t.isSpecialBusiness && (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-700">
                                                        <Sparkles size={10} /> 特殊业态
                                                    </span>
                                                )}
                                                {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Defer' && (
                                                    <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-black text-blue-700">账期顺延</span>
                                                )}
                                                {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Deduct' && (
	                                                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-black text-sky-700">当期扣除</span>
                                                )}
                                                {t.parentContractId && (
                                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-700">部分退租</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-600 mt-1">
                                                {asset?.buildingName}{' '}
	                                                <span className="liquid-contract-mobile-chip px-1.5 py-0.5 font-medium">{asset?.unitNames}</span>
                                            </div>
                                            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-600">
                                                <span className="col-span-2">
                                                    <span className="text-slate-400">退租日 </span>
                                                    <span className="font-bold text-rose-600">{t.terminationDate || t.leaseEnd}</span>
                                                </span>
                                                <span>
                                                    <span className="text-slate-400">起租 </span>
                                                    <span className="font-semibold text-slate-800">{t.leaseStart}</span>
                                                </span>
                                                <span>
                                                    <span className="text-slate-400">入驻 </span>
                                                    {t.moveInDate ? <span className="font-medium text-slate-800">{t.moveInDate}</span> : <span className="text-slate-400">同起租</span>}
                                                </span>
                                                <span className="col-span-2">
                                                    <span className="text-slate-400">合同期 </span>
                                                    {t.leaseStart} ~ {t.leaseEnd}
                                                </span>
                                                <span>
                                                    <span className="text-slate-400">单价 </span>
                                                    <span className="text-blue-600 font-bold">{formatCurrency(displayPrice)}</span>
                                                </span>
                                                <span>
                                                    <span className="text-slate-400">付款 </span>
                                                    {paymentCycleLabelMap[t.paymentCycle] || t.paymentCycle}
                                                </span>
                                            </div>
                                            <div className="mt-3 border-t border-white/70 pt-2">
                                                <button type="button" onClick={() => setTabletPreviewTenantId(t.id)} className="liquid-pressable mr-2 hidden rounded-full px-2.5 py-1 text-xs font-black text-slate-600 hover:bg-white/80 sm:inline-flex lg:hidden">
                                                    预览
                                                </button>
                                                <button type="button" onClick={() => handleEdit(t)} className="liquid-pressable rounded-full px-2.5 py-1 text-xs font-black text-blue-700 hover:bg-blue-50/80">
                                                    详情
                                                </button>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        ))
                    )}
                        </div>
                        <div className="hidden sm:block lg:hidden">
                            {renderTabletContractPreview(tabletPreviewTenant)}
                        </div>
                    </div>
                </div>
            </div>
            )}
          </>
      )}


      {/* 本年到期客户管理 */}
      {activeTab === 'Expiring' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          {/* 顶部统计 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="liquid-contract-expiry-stat p-4">
              <div className="text-xs text-slate-500 font-medium">本年到期客户</div>
              <div className="text-2xl font-bold text-amber-600 mt-1">{expiringTenantSummary.count}</div>
              <div className="text-xs text-slate-400 mt-1">
                已过期 {expiringTenantSummary.overdue} 个
              </div>
            </div>
            <div className="liquid-contract-expiry-stat p-4">
              <div className="text-xs text-slate-500 font-medium">本月到期</div>
              <div className="text-2xl font-bold text-rose-600 mt-1">
                {expiringTenantSummary.thisMonth}
              </div>
              <div className="text-xs text-slate-400 mt-1">需立即处理</div>
            </div>
            <div className="liquid-contract-expiry-stat p-4">
              <div className="text-xs text-slate-500 font-medium">下月到期</div>
              <div className="text-2xl font-bold text-amber-600 mt-1">
                {expiringTenantSummary.nextMonth}
              </div>
              <div className="text-xs text-slate-400 mt-1">需提前准备</div>
            </div>
            <div className="liquid-contract-expiry-stat p-4">
              <div className="text-xs text-slate-500 font-medium">涉及月租金</div>
              <div className="text-2xl font-bold text-blue-600 mt-1">
                {expiringTenantSummary.count > 0
                  ? '¥' + (expiringTenantSummary.monthlyRent / 10000).toFixed(1) + '万'
                  : '¥0'}
              </div>
              <div className="text-xs text-slate-400 mt-1">月度总额</div>
            </div>
          </div>

          {/* 按季度分组 */}
          {expiringByQuarter.length === 0 ? (
            <div className="liquid-contract-list rounded-[24px] p-16 text-center">
              <div className="liquid-icon-well mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[24px] text-blue-700">
                <Calendar size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-700 mb-2">本年度无到期合同</h3>
              <p className="text-slate-400 text-sm">所有合同均在有效期内</p>
            </div>
          ) : (
            expiringByQuarter.map(quarter => (
              <div key={quarter.label} className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-1.5 rounded-full bg-amber-500/80"></div>
                  <h3 className="text-base font-bold text-slate-700">
                    {quarter.label}
                    <span className="ml-2 text-sm font-normal text-slate-400">({quarter.tenants.length}个客户)</span>
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {quarter.tenants.map(t => {
                    const urgency = getExpiryUrgency(t.leaseEnd);
                    const unitIds = t.unitIds || [];
                    const building = buildingById.get(t.buildingId);
                    const mainUnitName = unitIds.length > 0 ? unitNameById.get(unitIds[0]) : undefined;
                    const daysLeft = Math.ceil((new Date(t.leaseEnd).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                    return (
                      <div key={t.id} data-urgency={urgency} className="liquid-contract-expiry-card overflow-hidden transition-shadow hover:shadow-md">
                        <div className="liquid-contract-expiry-header flex items-center justify-between px-4 py-2">
                          <span className={'text-xs font-bold ' + (
                            urgency === 'overdue' ? 'text-rose-700' :
                            urgency === 'thisMonth' ? 'text-rose-600' :
                            urgency === 'nextMonth' ? 'text-amber-600' :
                            'text-slate-500'
                          )}>
                            {urgency === 'overdue' ? '已过期' :
                             urgency === 'thisMonth' ? '本月到期' :
                             urgency === 'nextMonth' ? '下月到期' :
                             daysLeft + '天后到期'}
                          </span>
                          <span className={'text-xs font-medium px-2 py-0.5 rounded-full ' + (
                            t.status === 'Active' ? 'bg-blue-100 text-blue-700' :
                            t.status === 'Expiring' ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-600'
                          )}>{contractStatusTextMap[t.status]}</span>
                        </div>

                        <div className="p-4">
                          <h4 className="font-bold text-slate-800 text-base mb-1 truncate">{t.name}</h4>
                          <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                            <BuildingIcon size={12} />
                            <span>{building?.name || t.buildingId}</span>
                            {mainUnitName && <><span>·</span><span>{mainUnitName}</span></>}
                            {unitIds.length > 1 && <span className="text-slate-400">+{unitIds.length - 1}</span>}
                          </div>

                          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                            <div className="liquid-contract-mini-card p-2">
                              <div className="text-slate-400">到期日期</div>
                              <div className={'font-bold ' + (
                                urgency === 'overdue' ? 'text-rose-600' :
                                urgency === 'thisMonth' ? 'text-rose-500' :
                                'text-slate-700'
                              )}>{t.leaseEnd}</div>
                            </div>
                            <div className="liquid-contract-mini-card p-2">
                              <div className="text-slate-400">月租金</div>
                              <div className="font-bold text-slate-700">¥{(t.monthlyRent || 0).toLocaleString()}</div>
                            </div>
                            <div className="liquid-contract-mini-card p-2">
                              <div className="text-slate-400">面积</div>
                              <div className="font-bold text-slate-700">{t.totalArea || 0}㎡</div>
                            </div>
                            <div className="liquid-contract-mini-card p-2">
                              <div className="text-slate-400">付款周期</div>
                              <div className="font-bold text-slate-700 truncate">{paymentCycleLabelMap[t.paymentCycle] || t.paymentCycle}</div>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            {isMobileQueryOnly ? (
                              <button
                                type="button"
                                onClick={() => handleEdit(t)}
                                className="liquid-action-strong liquid-pressable flex flex-1 items-center justify-center gap-1 rounded-2xl py-2 text-sm font-bold"
                              >
                                <FileText size={14} /> 查看详情
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleRenewal(t)}
                                  className="liquid-action-strong liquid-pressable flex flex-1 items-center justify-center gap-1 rounded-2xl py-2 text-sm font-bold"
                                >
                                  <FileText size={14} /> 续约
                                </button>
                                <button
                                  type="button"
                                  onClick={() => initiateTermination(t.id)}
                                  className="liquid-glass-control liquid-pressable flex flex-1 items-center justify-center gap-1 rounded-2xl py-2 text-sm font-bold text-rose-600 hover:bg-rose-50/80"
                                >
                                  <XCircle size={14} /> 退租
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}


      {showTerminateModal && terminateId && (() => {
          const base = tenants.find((x) => x.id === terminateId);
          const allUnitIds = base?.unitIds || [];
          const hasMultipleUnits = allUnitIds.length > 1;
          const building = buildings.find(b => b.id === base?.buildingId);
          const getUnitInfo = (uid: string) => building?.units.find(u => u.id === uid);

          // 部分退租：拆分合同
          const executePartialTermination = () => {
            if (!base) return;
            const selectedIds = terminateData.selectedUnitIds;
            const remainingIds = allUnitIds.filter(id => !selectedIds.includes(id));

            // 计算面积比例
            let terminatedArea = 0;
            let remainingArea = 0;
            for (const uid of selectedIds) {
              const u = getUnitInfo(uid);
              const term = base.unitTerms?.find(t => t.unitId === uid);
              terminatedArea += term?.area || u?.area || 0;
            }
            for (const uid of remainingIds) {
              const u = getUnitInfo(uid);
              const term = base.unitTerms?.find(t => t.unitId === uid);
              remainingArea += term?.area || u?.area || 0;
            }
            const splitRatio = base.totalArea > 0 ? terminatedArea / base.totalArea : selectedIds.length / allUnitIds.length;

            const parseField = (v: string): number | undefined => {
              if (v === '' || v == null) return undefined;
              const n = Number(v);
              return Number.isFinite(n) ? n : undefined;
            };

            const earlyPatch = terminateData.type === 'Early'
              ? {
                  earlyTerminationFreeRentClawbackOverride: parseField(terminateData.frClawbackOverride),
                  earlyTerminationDepositDeduction: parseField(terminateData.depositDeduction) ?? 0,
                  earlyTerminationOtherAdjustment: parseField(terminateData.otherAdjustment) ?? 0,
                }
              : {
                  earlyTerminationFreeRentClawbackOverride: undefined,
                  earlyTerminationDepositDeduction: undefined,
                  earlyTerminationOtherAdjustment: undefined,
                };

            // 创建退租子合同
            const terminatedContract: Tenant = {
              ...base,
              id: `t${Date.now()}_partial`,
              parentContractId: base.id,
              unitIds: selectedIds,
              totalArea: Number(terminatedArea.toFixed(2)),
              monthlyRent: Math.round(base.monthlyRent * splitRatio),
              depositAmount: Math.round((base.depositAmount || 0) * splitRatio),
              status: ContractStatus.Terminated,
              terminationDate: terminateData.date,
              terminationType: terminateData.type,
              terminationReason: terminateData.reason,
              ...earlyPatch,
              unitTerms: base.unitTerms?.filter(t => selectedIds.includes(t.unitId)) || [],
              paymentTerms: base.paymentTerms?.filter(t => selectedIds.includes(t.unitId)) || [],
            };

            // 更新原合同（保留剩余房源）
            const updatedOriginal: Tenant = {
              ...base,
              unitIds: remainingIds,
              totalArea: Number(remainingArea.toFixed(2)),
              monthlyRent: base.monthlyRent - terminatedContract.monthlyRent,
              depositAmount: base.depositAmount - terminatedContract.depositAmount,
              unitTerms: base.unitTerms?.filter(t => remainingIds.includes(t.unitId)) || [],
              paymentTerms: base.paymentTerms?.filter(t => remainingIds.includes(t.unitId)) || [],
            };

            const updated = tenants.map(t => t.id === base.id ? updatedOriginal : t);
            updated.push(terminatedContract);
            onUpdateTenants(updated);
            closeTerminateModal();
          };

          return (
          <div className="liquid-elevated-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:p-3 md:items-center md:p-4" onClick={closeTerminateModal}>
             <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="contract-termination-modal-title"
                className="liquid-contract-termination-panel flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] animate-in zoom-in-50 duration-200 md:rounded-[28px]"
                onClick={(event) => event.stopPropagation()}
             >
                <div className="liquid-elevated-header flex items-start justify-between gap-3 border-b border-white/60 px-4 py-4 sm:px-5">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="liquid-icon-well flex h-10 w-10 items-center justify-center rounded-2xl text-amber-700">
                            <UserMinus size={20} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-black uppercase text-amber-700/80">Termination</p>
                            <h3 id="contract-termination-modal-title" className="truncate text-lg font-black text-slate-950">办理退租</h3>
                            <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{base?.name || '当前合同'}</p>
                        </div>
                    </div>
                    <button type="button" onClick={closeTerminateModal} className="liquid-glass-control liquid-pressable inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-slate-900" aria-label="关闭办理退租"><X size={18}/></button>
                </div>
                <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div><label className="mb-1.5 block text-xs font-black text-slate-500">退租日期</label><input type="date" value={terminateData.date} onChange={e => setTerminateData({...terminateData, date: e.target.value})} className="liquid-contract-termination-field w-full rounded-2xl px-3.5 py-3 text-base font-black tabular-nums text-slate-950 outline-none focus:ring-4 focus:ring-amber-500/10 md:text-sm md:font-semibold" /></div>
                        <div><label className="mb-1.5 block text-xs font-black text-slate-500">退租类型</label><select value={terminateData.type} onChange={e => setTerminateData({...terminateData, type: e.target.value as 'Normal' | 'Early'})} className="liquid-contract-termination-field w-full rounded-2xl px-3.5 py-3 text-base font-black text-slate-950 outline-none focus:ring-4 focus:ring-amber-500/10 md:text-sm md:font-semibold"><option value="Normal">正常到期退租</option><option value="Early">提前违约退租</option></select></div>
                        <div><label className="mb-1.5 block text-xs font-black text-slate-500">退租原因</label><select value={terminateData.reason} onChange={e => setTerminateData({...terminateData, reason: e.target.value})} className="liquid-contract-termination-field w-full rounded-2xl px-3.5 py-3 text-base font-black text-slate-950 outline-none focus:ring-4 focus:ring-amber-500/10 md:text-sm md:font-semibold"><option value="">请选择原因...</option><option value="合同到期不续约">合同到期不续约</option><option value="由于规模扩张搬迁">由于规模扩张搬迁</option><option value="业务收缩搬迁">业务收缩搬迁</option><option value="经营困难结业">经营困难结业</option><option value="物业环境/服务问题">物业环境/服务问题</option><option value="其他原因">其他原因</option></select></div>
                    </div>

                    {/* 房源多选（仅多房源合同时显示） */}
                    {hasMultipleUnits && (
                      <div className="liquid-contract-termination-card space-y-3 rounded-3xl p-4">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-xs font-black text-slate-500">退租房源（多选）</label>
                          <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-black text-amber-700">
                            已选 {terminateData.selectedUnitIds.length}/{allUnitIds.length}
                          </span>
                        </div>
                        <div className="max-h-[34vh] space-y-2 overflow-y-auto md:max-h-44">
                          {allUnitIds.map((uid) => {
                            const u = getUnitInfo(uid);
                            const term = base?.unitTerms?.find(t => t.unitId === uid);
                            const unitName = term?.unitName || u?.name || uid;
                            const unitArea = term?.area || u?.area || 0;
                            const unitRent = term?.monthlyRent || 0;
                            const checked = terminateData.selectedUnitIds.includes(uid);
                            return (
                              <label key={uid} className={`liquid-pressable flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-3 text-sm transition ${checked ? 'border-amber-300 bg-amber-500/10 text-amber-900' : 'border-slate-200/70 bg-white/55 text-slate-700 hover:bg-white/80'}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = checked
                                      ? terminateData.selectedUnitIds.filter(id => id !== uid)
                                      : [...terminateData.selectedUnitIds, uid];
                                    setTerminateData({ ...terminateData, selectedUnitIds: next });
                                  }}
                                  className="h-4 w-4 rounded text-amber-600"
                                />
                                <span className="min-w-0 flex-1 truncate font-black">{unitName}</span>
                                <span className="shrink-0 text-xs font-bold text-slate-500">{unitArea}㎡</span>
                                <span className="hidden shrink-0 text-xs font-bold text-slate-500 sm:inline">¥{unitRent.toLocaleString()}/月</span>
                              </label>
                            );
                          })}
                        </div>
                        {terminateData.selectedUnitIds.length === 0 ? (
                          <p className="rounded-2xl border border-rose-200 bg-rose-50/85 px-3 py-2 text-xs font-bold text-rose-700">请至少选择一个房源</p>
                        ) : terminateData.selectedUnitIds.length < allUnitIds.length ? (
                          <p className="rounded-2xl border border-amber-200 bg-amber-50/85 px-3 py-2 text-xs font-bold text-amber-800">仅退租 {terminateData.selectedUnitIds.length}/{allUnitIds.length} 个房源，剩余 {allUnitIds.length - terminateData.selectedUnitIds.length} 个房源继续履约</p>
                        ) : (
                          <p className="rounded-2xl border border-slate-200 bg-white/72 px-3 py-2 text-xs font-bold text-slate-500">已选全部房源（整单退租）</p>
                        )}
                      </div>
                    )}

                    {terminateData.type === 'Early' && terminateId && terminateData.date && (() => {
                        if (!base) return null;
                        const formula = computeEarlyTerminationFreeRentClawbackAmount({
                            ...base,
                            terminationDate: terminateData.date,
                            terminationType: 'Early',
                        });
                        const useOverride =
                            terminateData.frClawbackOverride !== '' &&
                            Number.isFinite(Number(terminateData.frClawbackOverride));
                        return (
                            <div className="liquid-contract-termination-card space-y-3 rounded-3xl p-4">
                                <p className="text-xs font-black text-slate-700">
                                    提前退租 — 租金按原收款计划；免租扣回/押金/其它调整在退租日单独一行
                                </p>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                    <div>
                                        <label className="mb-1 block text-[11px] font-black text-slate-500">免租扣回覆盖（元，可选）</label>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            enterKeyHint="done"
                                            className="liquid-contract-termination-field w-full rounded-2xl px-3 py-2.5 text-base font-black tabular-nums text-slate-950 outline-none focus:ring-4 focus:ring-amber-500/10 md:text-sm md:font-semibold"
                                            placeholder={`公式试算 ¥${formula.toLocaleString()}`}
                                            value={terminateData.frClawbackOverride}
                                            onChange={(e) => setTerminateData({ ...terminateData, frClawbackOverride: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[11px] font-black text-slate-500">押金扣款（元）</label>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            enterKeyHint="done"
                                            min={0}
                                            className="liquid-contract-termination-field w-full rounded-2xl px-3 py-2.5 text-base font-black tabular-nums text-slate-950 outline-none focus:ring-4 focus:ring-amber-500/10 md:text-sm md:font-semibold"
                                            value={terminateData.depositDeduction}
                                            onChange={(e) => setTerminateData({ ...terminateData, depositDeduction: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[11px] font-black text-slate-500">最后应收调整（元，可负）</label>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            enterKeyHint="done"
                                            className="liquid-contract-termination-field w-full rounded-2xl px-3 py-2.5 text-base font-black tabular-nums text-slate-950 outline-none focus:ring-4 focus:ring-amber-500/10 md:text-sm md:font-semibold"
                                            value={terminateData.otherAdjustment}
                                            onChange={(e) => setTerminateData({ ...terminateData, otherAdjustment: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-amber-200/70 bg-amber-50/78 px-3 py-2 text-[11px] font-bold text-amber-800">
                                    {useOverride
                                        ? `免租扣回将使用手工金额 ¥${Number(terminateData.frClawbackOverride).toLocaleString()}`
                                        : `免租扣回将使用公式金额 ¥${formula.toLocaleString()}`}
                                </div>
                            </div>
                        );
                    })()}
                </div>
                <div className="liquid-elevated-footer grid grid-cols-2 gap-2 border-t border-white/60 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex sm:justify-end sm:px-5 sm:pb-4">
                        <button type="button" onClick={closeTerminateModal} className="liquid-glass-control liquid-pressable rounded-full px-4 py-2.5 text-sm font-black text-slate-600">取消</button>
                        <button
                            type="button"
                            disabled={terminateData.selectedUnitIds.length === 0}
                            onClick={() => {
                                if (!terminateId || !base) return;
                                const selectedIds = terminateData.selectedUnitIds;
                                const isFullTermination = selectedIds.length === allUnitIds.length;

                                if (!isFullTermination) {
                                  executePartialTermination();
                                  return;
                                }

                                // 整单退租（原有逻辑）
                                const parseField = (v: string): number | undefined => {
                                    if (v === '' || v == null) return undefined;
                                    const n = Number(v);
                                    return Number.isFinite(n) ? n : undefined;
                                };
                                const updatedTenants = tenants.map((t) => {
                                    if (t.id !== terminateId) return t;
                                    const earlyPatch =
                                        terminateData.type === 'Early'
                                            ? {
                                                  earlyTerminationFreeRentClawbackOverride: parseField(
                                                      terminateData.frClawbackOverride
                                                  ),
                                                  earlyTerminationDepositDeduction:
                                                      parseField(terminateData.depositDeduction) ?? 0,
                                                  earlyTerminationOtherAdjustment:
                                                      parseField(terminateData.otherAdjustment) ?? 0,
                                              }
                                            : {
                                                  earlyTerminationFreeRentClawbackOverride: undefined,
                                                  earlyTerminationDepositDeduction: undefined,
                                                  earlyTerminationOtherAdjustment: undefined,
                                              };
                                    return {
                                        ...t,
                                        status: ContractStatus.Terminated,
                                        terminationDate: terminateData.date,
                                        terminationType: terminateData.type,
                                        terminationReason: terminateData.reason,
                                        ...earlyPatch,
                                    };
                                });
                                onUpdateTenants(updatedTenants);
                                closeTerminateModal();
                            }}
                            className={`liquid-pressable rounded-full px-5 py-2.5 text-sm font-black text-white sm:px-6 ${terminateData.selectedUnitIds.length === 0 ? 'cursor-not-allowed bg-slate-300' : 'bg-amber-600 shadow-lg shadow-amber-900/10 hover:bg-amber-700'}`}
                        >
                            确认退租
                        </button>
                </div>
             </section>
          </div>
          );
      })()}

      {showAIContractImport && (
          <React.Suspense fallback={null}>
              <AIContractRecognitionModal
                  isOpen={showAIContractImport}
                  onClose={() => setShowAIContractImport(false)}
                  buildings={buildings}
                  onImport={(tenantData) => {
                      setCurrentTenant({
                          signingDate: new Date().toISOString().split('T')[0],
                          status: ContractStatus.Active,
                          depositStatus: DepositStatus.Unpaid,
                          rentFreePeriods: [],
                          paymentCycle: 'Quarterly',
                          paymentCycleMonths: 3,
                          firstPaymentMonths: 3,
                          ...tenantData,
                      });
                      setIsEditing(true);
                  }}
              />
          </React.Suspense>
      )}

      {showImportResult && (
          <div className="liquid-elevated-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:p-4 md:items-center" onClick={closeImportResultModal}>
              <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="contract-import-result-title"
                  onClick={(event) => event.stopPropagation()}
                  className="liquid-elevated-panel flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[30px] animate-in zoom-in-50 duration-200 md:max-h-[90vh] md:rounded-[28px]"
              >
                  <div className="liquid-elevated-header flex items-start justify-between gap-3 border-b border-white/60 px-4 py-4 sm:px-5">
                      <div className="flex min-w-0 items-start gap-3">
                          <div className="liquid-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-blue-700">
                              <Upload size={20} />
                          </div>
                          <div className="min-w-0">
                              <p className="text-xs font-black uppercase text-blue-700/75">Import Result</p>
                              <h3 id="contract-import-result-title" className="truncate text-lg font-black text-slate-950">批量导入结果</h3>
                          </div>
                      </div>
                      <button onClick={closeImportResultModal} className="liquid-glass-control liquid-pressable inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-slate-900" aria-label="关闭批量导入结果"><X size={18}/></button>
                  </div>
                  <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
                      {importSummary && (
                          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
                              <div className="liquid-glass-readable rounded-2xl p-3"><div className="text-xs font-black text-slate-500">总行数</div><div className="mt-1 text-xl font-black text-slate-950">{importSummary.total}</div></div>
                              <div className="liquid-glass-readable rounded-2xl p-3"><div className="text-xs font-black text-slate-500">成功</div><div className="mt-1 text-xl font-black text-blue-700">{importSummary.success}</div></div>
                              <div className="liquid-glass-readable rounded-2xl p-3"><div className="text-xs font-black text-slate-500">更新</div><div className="mt-1 text-xl font-black text-cyan-700">{importSummary.updated}</div></div>
                              <div className="liquid-glass-readable rounded-2xl p-3"><div className="text-xs font-black text-slate-500">新增</div><div className="mt-1 text-xl font-black text-blue-800">{importSummary.created}</div></div>
                              <div className="liquid-glass-readable rounded-2xl p-3"><div className="text-xs font-black text-slate-500">失败</div><div className="mt-1 text-xl font-black text-rose-700">{importSummary.failed}</div></div>
                          </div>
                      )}

                      {importErrors.length > 0 ? (
                          <div className="liquid-glass-readable overflow-hidden rounded-3xl">
                              <div className="flex flex-col gap-3 border-b border-rose-100/80 bg-rose-50/75 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="flex items-center gap-2 text-sm font-black text-rose-800"><AlertTriangle size={16}/> 失败明细（显示前 20 条）</div>
                                  <button onClick={handleImportErrorsExport} className="liquid-pressable inline-flex items-center justify-center gap-1.5 rounded-full border border-rose-200 bg-white/72 px-3 py-2 text-xs font-black text-rose-700 hover:bg-white"><Download size={13}/> 下载失败明细</button>
                              </div>
                              <div className="space-y-2 p-3 md:hidden">
                                  {importErrors.slice(0, 20).map((e, i) => (
                                      <article key={i} className="liquid-elevated-card rounded-2xl border border-white/70 bg-white/62 p-3 text-xs">
                                          <div className="flex items-start justify-between gap-3">
                                              <div className="min-w-0">
                                                  <div className="text-[11px] font-black text-slate-500">行号</div>
                                                  <div className="mt-0.5 font-mono text-base font-black text-slate-950">{e.row}</div>
                                              </div>
                                              <div className="rounded-full border border-rose-200 bg-rose-50/90 px-2 py-1 text-[11px] font-black text-rose-700">
                                                  导入失败
                                              </div>
                                          </div>
                                          <div className="mt-3 rounded-2xl border border-rose-100/90 bg-rose-50/70 px-3 py-2 font-bold text-rose-800">
                                              {e.reason}
                                          </div>
                                          <div className="mt-3 grid gap-2 text-slate-700">
                                              <div>
                                                  <div className="text-[11px] font-black text-slate-400">企业</div>
                                                  <div className="mt-0.5 font-black text-slate-900">{String(e.data['企业名称'] || e.data.name || '') || '—'}</div>
                                              </div>
                                              <div className="grid grid-cols-2 gap-2">
                                                  <div>
                                                      <div className="text-[11px] font-black text-slate-400">资产</div>
                                                      <div className="mt-0.5 font-bold text-slate-700">{String(e.data['所属资产'] || e.data['楼宇'] || e.data.buildingName || '') || '—'}</div>
                                                  </div>
                                                  <div>
                                                      <div className="text-[11px] font-black text-slate-400">房号</div>
                                                      <div className="mt-0.5 font-bold text-slate-700">{String(e.data['房号'] || e.data.unitNames || '') || '—'}</div>
                                                  </div>
                                              </div>
                                          </div>
                                      </article>
                                  ))}
                              </div>
                              <div className="hidden max-h-64 overflow-y-auto md:block">
                                  <table className="w-full min-w-[720px] text-xs">
                                      <thead className="liquid-contract-sticky sticky top-0 text-slate-500">
                                          <tr>
                                              <th className="px-3 py-2.5 text-left font-black">行号</th>
                                              <th className="px-3 py-2.5 text-left font-black">原因</th>
                                              <th className="px-3 py-2.5 text-left font-black">企业</th>
                                              <th className="px-3 py-2.5 text-left font-black">资产</th>
                                              <th className="px-3 py-2.5 text-left font-black">房号</th>
                                          </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-200/60 bg-transparent">
                                          {importErrors.slice(0, 20).map((e, i) => (
                                              <tr key={i} className="hover:bg-blue-50/50">
                                                  <td className="px-3 py-2 font-black text-slate-700">{e.row}</td>
                                                  <td className="px-3 py-2 text-rose-700 font-medium">{e.reason}</td>
                                                  <td className="px-3 py-2 font-bold text-slate-800">{String(e.data['企业名称'] || e.data.name || '')}</td>
                                                  <td className="px-3 py-2 font-bold text-slate-600">{String(e.data['所属资产'] || e.data['楼宇'] || e.data.buildingName || '')}</td>
                                                  <td className="px-3 py-2 font-bold text-slate-600">{String(e.data['房号'] || e.data.unitNames || '')}</td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              </div>
                          </div>
                      ) : (
                          <div className="rounded-3xl border border-blue-200/70 bg-blue-50/78 p-4 text-sm font-black text-blue-800">
                              全部导入成功。
                          </div>
                      )}
                  </div>
                  <div className="liquid-elevated-footer flex justify-end gap-2 border-t border-white/60 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-5 sm:pb-4">
                      <button onClick={closeImportResultModal} className="liquid-glass-control liquid-pressable w-full rounded-full px-4 py-2.5 text-sm font-black text-slate-600 sm:w-auto">关闭</button>
                  </div>
              </section>
          </div>
      )}

      {/* 名称变更弹窗 */}
      {showNameChange && nameChangeTenantId && (() => {
        const t = tenants.find(x => x.id === nameChangeTenantId);
        if (!t) return null;
        return (
          <React.Suspense fallback={null}>
            <NameChangeDialog tenant={t} onConfirm={handleNameChangeConfirm} onClose={() => { setShowNameChange(false); setNameChangeTenantId(null); }} />
          </React.Suspense>
        );
      })()}

      {/* 付款周期变更弹窗 */}
      {showCycleChange && currentTenant.id && (
        <React.Suspense fallback={null}>
          <PaymentCycleChangeDialog
            tenant={currentTenant as Tenant}
            cloudConfig={cloudConfig}
            serverComputeEnabled={serverComputeEnabled}
            onConfirm={handleCycleChangeConfirm}
            onClose={() => setShowCycleChange(false)}
          />
        </React.Suspense>
      )}
      {contractPrompt ? (
        <ContractPromptOverlay prompt={contractPrompt} onClose={closeContractPrompt} />
      ) : null}
    </div>
  );
};
