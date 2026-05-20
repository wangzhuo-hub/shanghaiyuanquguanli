
import React, { useState, useEffect, useMemo } from 'react';
import {
  Tenant,
  Building,
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
} from '../types';
// Added missing UserMinus and Sparkles imports
import { Search, Plus, FileText, Filter, XCircle, AlertTriangle, AlertCircle, Calendar, DollarSign, Edit2, X, Trash2, Users, Save, Building as BuildingIcon, UserCheck, UserPlus, UserMinus, UserX, Info, ShieldAlert, WalletIcon, ArrowLeft, ArrowLeftRight, Trash, TrendingUp, TrendingDown, PieChart, Activity, BarChart3, Clock, LayoutDashboard, ArrowUpRight, ArrowDownRight, Sparkles, Briefcase, User, Smartphone, Gift, MapPin, Receipt, CreditCard, ChevronLeft, ChevronRight, RotateCcw, LayoutGrid, Rows3, Download, Upload } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, PieChart as RechartsPieChart, Pie, Legend, ComposedChart, Line } from 'recharts';
import { OccupancyTrendChart, UnitPriceTrendChart } from './Charts';
import {
    generateBudgetedBills,
    computeEarlyTerminationFreeRentClawbackAmount,
    buildVacancyBudgetAlignmentNote,
    parseDateLocal,
    resolveRentUnitPriceForDisplay,
} from '../services/billingService';
import { AIContractRecognitionModal } from './AIContractRecognitionModal';
import { NameChangeDialog } from './NameChangeDialog';
import { PaymentCycleChangeDialog } from './PaymentCycleChangeDialog';
import * as XLSX from 'xlsx';
import { formatArea, formatCurrency, formatPercent } from '../services/numberFormat';
import { paymentCycleLabelMap } from '../services/sharedUtils';
import { isManagementFeeBillingEnabled } from '../services/parkBillingConfig';
import { canViewRentPricing } from '../services/receivablePermissions';
import {
    generateManagementFeeBills,
    getManagementFeeCardStatus,
    resolveLeaseOccupancyDate,
    resolveManagementFeeMonthly,
    shouldGenerateManagementFeeBills,
    toManagementFeeMonthlyUnitPrice,
} from '../services/managementFeeBillingService';

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
  authUser?: AuthUser | null;
  projectId?: string;
}

const contractStatusTextMap: Record<ContractStatus, string> = {
  [ContractStatus.Active]: '履约中',
  [ContractStatus.Expiring]: '即将到期',
  [ContractStatus.Terminated]: '已退租',
  [ContractStatus.Pending]: '签约中',
  [ContractStatus.Expired]: '已到期',
};

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
                className="text-[10px] bg-teal-50 text-teal-800 border border-teal-200 px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-0.5"
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
            <span className="text-[10px] bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded font-bold">
                全免物业费
            </span>
        );
    }
    if (m.disabled) {
        return (
            <span className="text-[10px] bg-slate-50 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded font-bold">
                不收物业费
            </span>
        );
    }
    if (m.needsSetup) {
        return (
            <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded font-bold">
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
                <div className="text-teal-700 font-bold tabular-nums">
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
                <div className="text-teal-800 font-bold tabular-nums">
                    {m.monthlyAmount > 0 ? `¥${m.monthlyAmount.toLocaleString()}` : '—'}
                </div>
            </div>
        </>
    );
};

export const ContractManager: React.FC<ContractManagerProps> = ({ tenants, buildings, onUpdateTenants, dashboardData, payments = [], onUpdatePayments, budgetAdjustments = [], onUpdateAdjustments, mobileEntryMode = false, authUser = null, projectId: projectIdProp }) => {
  const viewRentPricing = canViewRentPricing(authUser);
  const mgmtFeeParkEnabled = isManagementFeeBillingEnabled(projectIdProp || tenants[0]?.projectId);
  const currentCalendarYear = new Date().getFullYear();
  const [activeTab, setActiveTab] = useState<'List' | 'Terminated' | 'Analysis' | 'Expiring'>(() =>
    mobileEntryMode ? 'List' : 'Analysis'
  );
  const [analysisPeriod, setAnalysisPeriod] = useState<'Year' | 'Quarter' | 'Month'>('Year');

  useEffect(() => {
    if (!mobileEntryMode) return;
    if (activeTab === 'Analysis') setActiveTab('List');
  }, [mobileEntryMode, activeTab]);

  // 本年度到期客户 — 按季度分组
  const thisYear = new Date().getFullYear();
  const expiringTenants = useMemo(() => {
    const now = new Date();
    const today = new Date(thisYear, now.getMonth(), now.getDate());
    const sixMonthsLater = new Date(thisYear, now.getMonth() + 6, now.getDate());
    return tenants
      .filter(t => {
        if (!t.leaseEnd) return false;
        if (t.status === 'Terminated') return false;
        const endDate = new Date(t.leaseEnd);
        return endDate.getFullYear() === thisYear || (endDate >= today && endDate <= sixMonthsLater);
      })
      .sort((a, b) => new Date(a.leaseEnd).getTime() - new Date(b.leaseEnd).getTime());
  }, [tenants, thisYear]);

  const expiringByQuarter = useMemo(() => {
    const quarters: { label: string; range: [Date, Date] }[] = [
      { label: '第一季度 (1-3月)', range: [new Date(thisYear, 0, 1), new Date(thisYear, 2, 31)] },
      { label: '第二季度 (4-6月)', range: [new Date(thisYear, 3, 1), new Date(thisYear, 5, 30)] },
      { label: '第三季度 (7-9月)', range: [new Date(thisYear, 6, 1), new Date(thisYear, 8, 30)] },
      { label: '第四季度 (10-12月)', range: [new Date(thisYear, 9, 1), new Date(thisYear, 11, 31)] },
    ];
    return quarters.map(q => ({
      ...q,
      tenants: expiringTenants.filter(t => {
        const d = new Date(t.leaseEnd);
        return d >= q.range[0] && d <= q.range[1];
      }),
    })).filter(q => q.tenants.length > 0);
  }, [expiringTenants, thisYear]);

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
  /** 账期调整表单：按当前合同字段推算收款日列表（与保存后计费一致，不含预算叠加） */
  const adjPreviewBills = useMemo(() => {
    if (!showAdjForm || !currentTenant.leaseStart || !currentTenant.leaseEnd || !currentTenant.monthlyRent || currentTenant.monthlyRent <= 0) {
      return [];
    }
    const inheritedProjectId =
      currentTenant.projectId || tenants.find((t) => (t.projectId || '').trim())?.projectId || '';
    const t = {
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
      freeRentHandling: currentTenant.freeRentHandling || 'Deduct',
      projectId: inheritedProjectId,
    } as Tenant;
    return generateBudgetedBills(t, [], [], parseDateLocal(currentTenant.leaseStart), parseDateLocal(currentTenant.leaseEnd));
  }, [showAdjForm, currentTenant, tenants]);
  const [batchSelectedContractIds, setBatchSelectedContractIds] = useState<Set<string>>(() => new Set());
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
      !String(t.id || '').startsWith('virt_') && !String(t.name || '').includes('(预算)');

  const toggleBatchContractSelect = (id: string) => {
      setBatchSelectedContractIds((prev) => {
          const n = new Set(prev);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
      });
  };

  const handleBatchDeleteContracts = () => {
      if (!viewRentPricing) {
          alert('当前账号无合同删除权限。');
          return;
      }
      if (batchSelectedContractIds.size === 0) return;
      if (!window.confirm(`确定删除选中的 ${batchSelectedContractIds.size} 份合同？此操作不可恢复。`)) return;
      const rm = batchSelectedContractIds;
      onUpdateTenants(tenants.filter((t) => !rm.has(t.id)));
      setBatchSelectedContractIds(new Set());
      if (currentTenant.id && rm.has(currentTenant.id)) {
          setIsEditing(false);
          setCurrentTenant({});
      }
  };

  // 批量导入/导出 & AI 识别导入
  const [showAIContractImport, setShowAIContractImport] = useState(false);
  const [importSummary, setImportSummary] = useState<null | { total: number; success: number; updated: number; created: number; failed: number }>(null);
  const [importErrors, setImportErrors] = useState<Array<{ row: number; reason: string; data: Record<string, any> }>>([]);
  const [showImportResult, setShowImportResult] = useState(false);
  
  // 初始化录入状态
  const [showInitPaymentModal, setShowInitPaymentModal] = useState(false);
  const [initPaymentData, setInitPaymentData] = useState({
    amount: '',
    date: '',
    remarks: '2026年1月前历史数据'
  });

  // --- High-Performance Analysis Engine ---
  const perfData = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-11
    const currentQuarter = Math.floor(currentMonth / 3); // 0-3

    const getPeriodKey = (dateStr: string) => {
        const d = new Date(dateStr);
        return {
            year: d.getFullYear(),
            month: d.getMonth(),
            quarter: Math.floor(d.getMonth() / 3)
        };
    };

    // Helper: Is Date in Period?
    const isInPeriod = (dateStr: string, period: 'Year' | 'Quarter' | 'Month', offsetYear = 0, offsetPeriod = 0) => {
        if (!dateStr) return false;
        const d = getPeriodKey(dateStr);
        let targetYear = currentYear + offsetYear;
        
        if (period === 'Year') {
            return d.year === targetYear;
        }
        if (period === 'Quarter') {
            let targetQ = currentQuarter + offsetPeriod;
            while (targetQ < 0) { targetQ += 4; targetYear -= 1; }
            while (targetQ > 3) { targetQ -= 4; targetYear += 1; }
            return d.year === targetYear && d.quarter === targetQ;
        }
        if (period === 'Month') {
            let targetM = currentMonth + offsetPeriod;
            while (targetM < 0) { targetM += 12; targetYear -= 1; }
            while (targetM > 11) { targetM -= 12; targetYear += 1; }
            return d.year === targetYear && d.month === targetM;
        }
        return false;
    };

    // Calculate Core Metrics
    const calculateMetrics = (offsetYear = 0, offsetPeriod = 0) => {
        const signed = tenants.filter(t => isInPeriod(t.signingDate || t.leaseStart, analysisPeriod, offsetYear, offsetPeriod));
        const terminated = tenants.filter(t => t.status === ContractStatus.Terminated && isInPeriod(t.terminationDate || t.leaseEnd, analysisPeriod, offsetYear, offsetPeriod));
        
        const signedArea = signed.reduce((s, t) => s + t.totalArea, 0);
        const terminatedArea = terminated.reduce((s, t) => s + t.totalArea, 0);
        
        return {
            signedCount: signed.length,
            signedArea: Math.round(signedArea),
            terminatedCount: terminated.length,
            terminatedArea: Math.round(terminatedArea),
            netArea: Math.round(signedArea - terminatedArea)
        };
    };

    const current = calculateMetrics(0, 0);
    const prevPeriod = calculateMetrics(analysisPeriod === 'Year' ? -1 : 0, analysisPeriod === 'Year' ? 0 : -1);
    const prevYear = calculateMetrics(-1, 0);

    // Helper: Calculation Percentage change
    const getChange = (curr: number, prev: number) => {
        if (prev === 0) return curr > 0 ? 100 : 0;
        return ((curr - prev) / prev) * 100;
    };

    // Termination Reason Distribution
    const terminatedAll = tenants.filter(t => t.status === ContractStatus.Terminated);
    const terminatedYear = tenants.filter(t => t.status === ContractStatus.Terminated && isInPeriod(t.terminationDate || t.leaseEnd, 'Year'));
    const terminatedQuarter = tenants.filter(t => t.status === ContractStatus.Terminated && isInPeriod(t.terminationDate || t.leaseEnd, 'Quarter'));
    const terminatedMonth = tenants.filter(t => t.status === ContractStatus.Terminated && isInPeriod(t.terminationDate || t.leaseEnd, 'Month'));
    
    const reasonMap: Record<string, number> = {};
    let earlyCount = 0;
    
    terminatedAll.forEach(t => {
        const r = t.terminationReason || '未填写原因';
        reasonMap[r] = (reasonMap[r] || 0) + 1;
        if (t.terminationType === 'Early') earlyCount++;
    });

    const reasonData = Object.entries(reasonMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const earlyRate = terminatedAll.length > 0 ? Math.round((earlyCount / terminatedAll.length) * 100) : 0;
    
    // 退租类型分布（正常退租 vs 提前退租）
    const terminationTypeData = [
        { name: '正常退租', value: terminatedAll.length - earlyCount },
        { name: '提前退租', value: earlyCount }
    ].filter(item => item.value > 0);

    // Monthly Trends for Chart (Last 12 Months)
    const trendData = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(currentYear, currentMonth - i, 1);
        const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        
        const mSigned = tenants.filter(t => isInPeriod(t.signingDate || t.leaseStart, 'Month', d.getFullYear() - currentYear, d.getMonth() - currentMonth));
        const mTerminated = tenants.filter(t => t.status === ContractStatus.Terminated && isInPeriod(t.terminationDate || t.leaseEnd, 'Month', d.getFullYear() - currentYear, d.getMonth() - currentMonth));
        
        const sArea = mSigned.reduce((s, t) => s + t.totalArea, 0);
        const tArea = mTerminated.reduce((s, t) => s + t.totalArea, 0);

        trendData.push({
            month: label,
            newArea: Math.round(sArea),
            lostArea: Math.round(tArea),
            netArea: Math.round(sArea - tArea)
        });
    }

    return {
        metrics: current,
        mom: {
            area: getChange(current.signedArea, prevPeriod.signedArea),
            count: getChange(current.signedCount, prevPeriod.signedCount)
        },
        yoy: {
            area: getChange(current.signedArea, prevYear.signedArea),
            count: getChange(current.signedCount, prevYear.signedCount)
        },
        reasons: reasonData,
        earlyRate,
        trend: trendData,
        terminationStats: {
            all: terminatedAll.length,
            year: terminatedYear.length,
            quarter: terminatedQuarter.length,
            month: terminatedMonth.length,
            earlyCount,
            normalCount: terminatedAll.length - earlyCount
        },
        terminationTypeData
    };
  }, [tenants, analysisPeriod]);

  // --- Actions ---
  const handleSave = () => {
    const errors: Record<string, boolean> = {};
    const missingFields = [];
    if (!currentTenant.name) { errors.name = true; missingFields.push('企业名称'); }
    if (!currentTenant.buildingId) { errors.buildingId = true; missingFields.push('所属楼宇'); }
    if (!currentTenant.unitIds || currentTenant.unitIds.length === 0) { errors.unitIds = true; missingFields.push('租赁单元/房号'); }
    if (!currentTenant.signingDate) { errors.signingDate = true; missingFields.push('签约日期'); }
    if (!currentTenant.leaseStart) { errors.leaseStart = true; missingFields.push('起租日期'); }
    if (!currentTenant.leaseEnd) { errors.leaseEnd = true; missingFields.push('结束日期'); }
    
    setFormErrors(errors);
    if (missingFields.length > 0) { alert(`无法保存，请填写以下必填项：\n${missingFields.join(', ')}`); return; }

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
        updatedTenants = updatedTenants.map(t => t.id === renewingFromId ? { ...t, status: ContractStatus.Expired } : t);
        updatedTenants.push(newTenant);
    } else if (currentTenant.id && tenants.some(t => t.id === currentTenant.id)) {
       updatedTenants = updatedTenants.map(t => t.id === currentTenant.id ? newTenant : t);
    } else { updatedTenants.push(newTenant); }
    onUpdateTenants(updatedTenants); setIsEditing(false); setCurrentTenant({}); setRenewingFromId(null); setFormErrors({});
  };

  // 退租回退
  const handleRollback = (tenantId: string) => {
    const t = tenants.find(x => x.id === tenantId);
    if (!t) return;

    // 部分退租回退：合并回父合同
    if (t.parentContractId) {
      const parent = tenants.find(x => x.id === t.parentContractId);
      if (!parent) {
        alert('未找到原合同，无法回退');
        return;
      }
      if (!window.confirm(
        `确定将「${t.name}」的部分退租房源合并回原合同吗？\n\n` +
        `退租房源：${(t.unitIds || []).join('、')}\n` +
        `合并后原合同恢复包含全部房源，此退租记录将被删除。`
      )) return;

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
    if (!window.confirm(`确定将「${t.name}」回退为履约中状态吗？\n\n此操作将清除退租日期、退租类型、退租原因及提前退租结算数据。`)) return;
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
    setNameChangeTenantId(tenant.id);
    setShowNameChange(true);
  };
  const handleNameChangeConfirm = (newName: string, record: import('../types').NameChangeRecord) => {
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
    const updated = tenants.map((t) =>
      t.id === tenantId ? { ...t, paymentPeriodShiftMonths: 0 } : t,
    );
    onUpdateTenants(updated);
  };

  const handleRenewal = (tenant: Tenant) => {
    const nextDay = new Date(tenant.leaseEnd);
    nextDay.setDate(nextDay.getDate() + 1);
    const leaseEnd = new Date(nextDay);
    leaseEnd.setFullYear(leaseEnd.getFullYear() + 1);

    const renewalTenant: Partial<Tenant> = {
      ...tenant,
      id: `t${Date.now()}_renewal`,
      rootId: tenant.rootId || tenant.id,
      leaseStart: nextDay.toISOString().split('T')[0],
      leaseEnd: leaseEnd.toISOString().split('T')[0],
      signingDate: new Date().toISOString().split('T')[0],
      status: ContractStatus.Pending,
    };
    
    setCurrentTenant(renewalTenant);
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

  const handleAddAmountDelta = () => {
    if (!onUpdateAdjustments || !currentTenant.id) {
      alert('当前环境无法保存预算金额调整');
      return;
    }
    if (!amountDeltaForm.reason.trim()) {
      alert('请填写调整原因');
      return;
    }
    if (amountDeltaForm.amount === 0) {
      alert('调整金额不能为 0');
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
    return tenants.filter(t => {
        const isTerminated = t.status === ContractStatus.Terminated;
        const isExpired = t.status === ContractStatus.Expired;
        if (activeTab === 'List' && isTerminated) return false;
        if (activeTab === 'List' && isExpired) return false; // 续租后的旧合同不应出现在在租明细
        if (activeTab === 'Terminated' && !isTerminated) return false;

        const matchesSearch = t.name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesBuilding = filterBuilding === 'all' || t.buildingId === filterBuilding;
        let matchesStatus = filterStatus === 'all' || t.status === filterStatus;
        if (filterStatus === 'risk') matchesStatus = t.isRisk === true;
        if (filterStatus === 'special') matchesStatus = t.isSpecialBusiness === true;
        const matchesPayment = filterPaymentCycle === 'all' || t.paymentCycle === filterPaymentCycle;
        
        return matchesSearch && matchesBuilding && matchesStatus && matchesPayment;
    }).sort((a,b) => new Date(b.leaseStart).getTime() - new Date(a.leaseStart).getTime());
  }, [tenants, searchTerm, filterBuilding, filterStatus, filterPaymentCycle, activeTab]);

  const normalizeDate = (input: any): string => {
      const s = String(input ?? '').trim();
      if (!s) return '';
      // Excel 序列号日期
      if (typeof input === 'number' && Number.isFinite(input) && input > 20000 && input < 60000) {
          const d = XLSX.SSF.parse_date_code(input);
          if (d?.y && d?.m && d?.d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
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
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, filename);
  };

  const downloadWorkbookMultiSheet = (filename: string, sheets: { name: string; rows: any[] }[]) => {
      const wb = XLSX.utils.book_new();
      sheets.forEach(({ name, rows }) => {
          const safeName = name.replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet';
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), safeName);
      });
      XLSX.writeFile(wb, filename);
  };

  const handleExportTenants = () => {
      const exportRows = filteredTenants.map((t) => {
          const building = buildings.find((b) => b.id === t.buildingId);
          const unitNames = t.unitIds
              .map((uid) => building?.units.find((u) => u.id === uid)?.name || uid)
              .join(',');
          const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
          const displayPrice = rentDisplay.unitPrice;
          const isMonthlyMode = rentDisplay.mode === 'monthly';
          const exportRow: any = {
              original_id: t.id,
              企业名称: t.name,
              所属行业: t.industry || '',
              所属资产: building?.name || '',
              房号: unitNames,
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
          const workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
          const first = workbook.Sheets[workbook.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json<Record<string, any>>(first, { defval: '' });
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
          alert('批量导入失败：' + (error instanceof Error ? error.message : '未知错误'));
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
          const building = buildings.find((b) => b.id === t.buildingId);
          const buildingId = t.buildingId || 'unknown';
          const buildingName = building?.name || '未知楼栋';
          if (!grouped.has(buildingId)) {
              grouped.set(buildingId, { buildingId, buildingName, floors: new Map<string, Tenant[]>() });
          }
          const unitFloors = new Set<number>();
          t.unitIds.forEach((uid) => {
              const f = building?.units.find((u) => u.id === uid)?.floor;
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
  }, [activeTab, filteredTenants, buildings]);

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
         <div className="bg-slate-50 fixed inset-0 z-50 overflow-y-auto p-2 md:p-6 animate-in zoom-in-50 duration-200">
             <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-5xl mx-auto flex flex-col min-h-full">
                <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-20 rounded-t-xl shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Users size={20}/></div>
                        <h2 className="text-xl font-bold text-slate-800">
                            {currentTenant.id ? (renewingFromId ? '合同续签' : '客户合同详情') : '新增租赁签约'}
                        </h2>
                    </div>
                    <button onClick={() => { setIsEditing(false); setRenewingFromId(null); setFormErrors({}); }} className="text-slate-400 hover:text-slate-600 bg-slate-100 p-2 rounded-full transition-colors"><X size={20}/></button>
                </div>

                <div className="p-6 md:p-8 space-y-8 flex-1">
                    {/* 1. Core Info Section */}
                    <section className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-4">
                        <div className="flex items-center gap-2 text-blue-600 font-bold mb-2"><FileText size={18}/> <span>核心签约信息</span></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">企业名称 <span className="text-red-500">*</span></label><div className="flex gap-2"><input type="text" className={`flex-1 border p-2.5 rounded-lg text-sm ${formErrors.name ? 'border-red-500 bg-red-50' : 'border-slate-300'}`} value={currentTenant.name || ''} onChange={e => setCurrentTenant({...currentTenant, name: e.target.value})} />{currentTenant.id && <button type="button" onClick={() => handleNameChange(currentTenant as Tenant)} className="px-3 py-2 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 whitespace-nowrap">变更名称</button>}</div></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">所属资产 <span className="text-red-500">*</span></label><select className={`w-full border p-2.5 rounded-lg text-sm ${formErrors.buildingId ? 'border-red-500 bg-red-50' : 'border-slate-300'}`} value={currentTenant.buildingId || ''} onChange={e => setCurrentTenant({...currentTenant, buildingId: e.target.value, unitIds: [], unitTerms: [], paymentTerms: [], totalArea: 0, monthlyRent: 0})}>
                                <option value="">选择资产...</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name} {b.type === 'Site' ? '(场地)' : ''}</option>)}
                            </select></div>
                            
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium mb-2 text-slate-600">租赁单元 / 地块 <span className="text-red-500">*</span></label>
                                {targetBuilding && targetBuilding.units.length === 0 ? (
                                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                                        <AlertCircle className="text-amber-500 mt-0.5 flex-shrink-0" size={18} />
                                        <div>
                                            <div className="text-amber-700 font-bold text-sm mb-1">该资产下暂无租赁单元/地块</div>
                                            <div className="text-amber-600 text-xs">
                                                请先前往 <span className="font-bold bg-amber-100 px-1 rounded">楼宇资管</span> 页面，为该资产添加可租赁的单元或地块信息，然后才能进行签约。
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 max-h-48 overflow-y-auto font-mono">
                                        {availableUnits.length > 0 ? availableUnits.map(u => (
                                            <button key={u.id} onClick={() => toggleUnit(u.id)} className={`px-2 py-2 rounded text-xs border transition-all ${currentTenant.unitIds?.includes(u.id) ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-105 font-bold' : 'bg-white border-slate-200 hover:border-blue-400'}`}><div>{u.name}</div><div className="opacity-70 font-normal">{formatArea(u.area)}</div></button>
                                        )) : (
                                            <div className="col-span-full text-center py-4 text-slate-400 text-xs italic">
                                                {currentTenant.buildingId ? '该资产下暂无空置单元' : '请先选择左侧所属资产'}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {selectedUnitTerms.length > 0 && (
                                <div className="md:col-span-2 bg-blue-50/60 border border-blue-100 rounded-xl p-4 space-y-3">
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
                                            <div key={term.unitId} className="bg-white border border-blue-100 rounded-xl p-4 space-y-3">
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
                                                        className="px-3 py-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 text-xs font-bold flex items-center justify-center gap-1"
                                                    >
                                                        <Plus size={14} /> 添加该房源免租期
                                                    </button>
                                                </div>
                                                {(term.rentFreePeriods || []).length > 0 && (
                                                    <div className="space-y-2 pt-2 border-t border-slate-100">
                                                        {(term.rentFreePeriods || []).map((rf, idx) => (
                                                            <div key={`${term.unitId}-${idx}`} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end bg-slate-50 rounded-lg p-3">
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
                                                                    <button type="button" onClick={() => removeUnitRentFree(term.unitId, idx)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={16}/></button>
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
                        <section className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-4">
                            <div className="flex items-center gap-2 text-violet-600 font-bold mb-2"><Clock size={18}/> <span>历史签约记录</span></div>
                            <div className="overflow-x-auto border border-slate-200 rounded-lg">
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
                                                <tr key={h.id} className={h.isCurrentEditing ? 'bg-violet-50/50' : ''}>
                                                    <td className="px-4 py-2 text-slate-700 font-medium">
                                                        第{idx + 1}期
                                                        {h.isCurrentEditing && <span className="ml-2 text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">当前编辑</span>}
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
                    <section className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-4">
                        <div className="flex items-center gap-2 text-emerald-600 font-bold mb-2"><DollarSign size={18}/> <span>租金与支付</span></div>

                        {/* 租金输入模式：按单价运算 / 直接填月租金 */}
                        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
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
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${rentInputMode === 'byUnitPrice' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                                按单价运算
                            </button>
                            <button type="button"
                                onClick={() => {
                                    setCurrentTenant({...currentTenant, unitPrice: undefined, unitPriceMode: undefined});
                                    setRentInputMode('direct');
                                }}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${rentInputMode === 'direct' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
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
                                            className="text-[10px] px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:bg-slate-100 transition-colors">
                                            切换为{(currentTenant.unitPriceMode || 'daily') === 'monthly' ? '元/㎡/天' : '元/㎡/月'}
                                        </button>
                                    </div>
                                    <div className="relative"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">¥</span>
                                        <input type="number" step="0.01" className="w-full border border-slate-300 pl-7 pr-3 py-2.5 rounded-lg text-sm font-mono"
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
                                        <input type="number" className="w-full border border-slate-300 pl-7 pr-3 py-2.5 rounded-lg text-sm font-bold"
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
                                        className={`w-full border border-slate-300 pl-7 pr-3 py-2.5 rounded-lg text-sm font-bold ${rentInputMode === 'byUnitPrice' ? 'bg-slate-50' : ''}`}
                                        value={currentTenant.monthlyRent || ''}
                                        readOnly={rentInputMode === 'byUnitPrice'}
                                        onChange={e => setCurrentTenant({...currentTenant, monthlyRent: Number(e.target.value)})} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1.5 text-slate-600">支付频率 {currentTenant.id && <button type="button" onClick={() => setShowCycleChange(true)} className="ml-2 text-xs text-amber-600 hover:text-amber-700 underline">变更周期</button>}</label>
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
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">首期应收自定义（元，可选）</label><input type="number" step="0.01" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm font-mono" placeholder="不填则按系统计费" value={currentTenant.firstReceivableAmount ?? ''} onChange={e => setCurrentTenant({ ...currentTenant, firstReceivableAmount: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">首期覆盖起（可选）</label><input type="date" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.firstReceivableStartDate || ''} onChange={e => setCurrentTenant({ ...currentTenant, firstReceivableStartDate: e.target.value || undefined })} /></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">首期覆盖止（可选）</label><input type="date" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.firstReceivableEndDate || ''} onChange={e => setCurrentTenant({ ...currentTenant, firstReceivableEndDate: e.target.value || undefined })} /></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">押金金额</label><div className="relative"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">¥</span><input type="number" className="w-full border border-slate-300 pl-7 pr-3 py-2.5 rounded-lg text-sm" value={currentTenant.depositAmount || ''} onChange={e => setCurrentTenant({...currentTenant, depositAmount: Number(e.target.value)})} /></div></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">押金状态</label><select className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.depositStatus || DepositStatus.Unpaid} onChange={e => setCurrentTenant({...currentTenant, depositStatus: e.target.value as any})}>
                                <option value={DepositStatus.Unpaid}>待缴</option><option value={DepositStatus.Paid}>已收</option><option value={DepositStatus.Refunded}>已退</option>
                            </select></div>
                        </div>
                    </section>

                    {!viewRentPricing && mgmtFeeParkEnabled && (
                        <p className="text-sm text-teal-800 bg-teal-50 border border-teal-100 rounded-lg px-4 py-3">
                            当前为物业人员视图：租金、押金等招商价格已隐藏，请维护物业费条款与收款核销。
                        </p>
                    )}
                    {(mgmtFeeParkEnabled || isManagementFeeBillingEnabled(currentTenant.projectId)) && (
                    <section className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-4">
                            <div className="space-y-4">
                                <div className="text-teal-800 font-bold text-sm">物业费条款</div>
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
                                        <span className="font-medium text-teal-800">
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
                                        <p className="text-sm text-teal-800 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
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
                            <section className="bg-amber-50/60 p-6 rounded-xl border border-amber-200 shadow-sm space-y-4">
                                <div className="flex items-center gap-2 text-amber-800 font-bold">
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
                                <div className="text-xs text-slate-600 font-mono bg-white/80 p-2 rounded border border-amber-100">
                                    公式试算免租扣回：¥
                                    {computeEarlyTerminationFreeRentClawbackAmount(currentTenant as Tenant).toLocaleString()}
                                </div>
                            </section>
                        )}

                    {/* 3. Rent Free Periods */}
                    <section className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-4">
                         <div className="flex justify-between items-center mb-2">
                             <div className="flex items-center gap-2 text-indigo-600 font-bold"><Gift size={18}/> <span>免租期设定</span></div>
                             <button onClick={addRentFree} className="text-xs font-bold bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-100 flex items-center gap-1 transition-colors"><Plus size={14}/> 添加免租段</button>
                         </div>
                         <div className="space-y-3">
                             {currentTenant.rentFreePeriods?.map((rf, idx) => (
                                 <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 relative group">
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
                                     <div className="md:col-span-1 flex items-end justify-center"><button onClick={() => removeRentFree(idx)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={18}/></button></div>
                                 </div>
                             ))}
                             {(!currentTenant.rentFreePeriods || currentTenant.rentFreePeriods.length === 0) && <div className="text-center py-6 text-slate-400 text-sm italic border-2 border-dashed border-slate-100 rounded-xl">暂未设定免租期</div>}
                         </div>
                         
                         {/* 免租期处理方式 */}
                         {currentTenant.rentFreePeriods && currentTenant.rentFreePeriods.length > 0 && (
                             <div className="mt-4 pt-4 border-t border-slate-200">
                                 <label className="block text-sm font-medium mb-3 text-slate-700">
                                     <span className="text-indigo-600">★</span> 免租期处理方式
                                 </label>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                     <button
                                         type="button"
                                         onClick={() => setCurrentTenant({...currentTenant, freeRentHandling: 'Defer'})}
                                         className={`p-4 rounded-xl border-2 transition-all text-left ${
                                             currentTenant.freeRentHandling === 'Defer' 
                                                 ? 'border-indigo-500 bg-indigo-50' 
                                                 : 'border-slate-200 bg-white hover:border-indigo-300'
                                         }`}
                                     >
                                         <div className="flex items-center gap-2 mb-2">
                                             <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                                 currentTenant.freeRentHandling === 'Defer' 
                                                     ? 'border-indigo-500 bg-indigo-500' 
                                                     : 'border-slate-300'
                                             }`}>
                                                 {currentTenant.freeRentHandling === 'Defer' && (
                                                     <div className="w-2 h-2 bg-white rounded-full" />
                                                 )}
                                             </div>
                                             <span className="font-bold text-slate-800">账期顺延</span>
                                         </div>
                                         <p className="text-xs text-slate-600 leading-relaxed">
                                             免租期月份不产生账单，收款时间整体顺延。<br/>
                                             <span className="text-indigo-600">例：1-3月免租，原12月收Q1租金 → 改为3月收Q2租金</span>
                                         </p>
                                     </button>
                                     
                                     <button
                                         type="button"
                                         onClick={() => setCurrentTenant({...currentTenant, freeRentHandling: 'Deduct'})}
                                         className={`p-4 rounded-xl border-2 transition-all text-left ${
                                             currentTenant.freeRentHandling === 'Deduct' 
                                                 ? 'border-green-500 bg-green-50' 
                                                 : 'border-slate-200 bg-white hover:border-green-300'
                                         }`}
                                     >
                                         <div className="flex items-center gap-2 mb-2">
                                             <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                                 currentTenant.freeRentHandling === 'Deduct' 
                                                     ? 'border-green-500 bg-green-500' 
                                                     : 'border-slate-300'
                                             }`}>
                                                 {currentTenant.freeRentHandling === 'Deduct' && (
                                                     <div className="w-2 h-2 bg-white rounded-full" />
                                                 )}
                                             </div>
                                             <span className="font-bold text-slate-800">当期账单扣除</span>
                                         </div>
                                         <p className="text-xs text-slate-600 leading-relaxed">
                                             在当期账单中扣除免租期月数，收款时间不变但金额减少。<br/>
                                             <span className="text-green-600">例：1月免租，原12月收Q1(3个月) → 改为12月收只收取2个月(2-3月)</span>
                                         </p>
                                     </button>
                                 </div>
                             </div>
                         )}
                    </section>

                    {/* 固定金额减免（补充协议等） */}
                    <section className="bg-white p-6 rounded-xl border border-teal-100 shadow-sm space-y-4">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2 text-teal-700 font-bold">
                                <Receipt size={18} />
                                <span>固定金额减免</span>
                            </div>
                            <button
                                type="button"
                                onClick={addFixedRentReduction}
                                className="text-xs font-bold bg-teal-50 text-teal-700 px-3 py-1.5 rounded-lg hover:bg-teal-100 flex items-center gap-1"
                            >
                                <Plus size={14} /> 添加减免段
                            </button>
                        </div>
                        <p className="text-xs text-teal-800/80 leading-relaxed">
                            用于「上半年应缴 130,670、减免 66,282.16、实缴 64,387.84」类约定：在覆盖期内按账单比例扣减{' '}
                            <strong>减免金额</strong>，不按整月×月租计算。请勿与整段免租重复录入同一区间。
                        </p>
                        <div className="space-y-3">
                            {(currentTenant.rentReductions || []).map((rr, idx) => (
                                <div
                                    key={rr.id}
                                    className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 bg-teal-50/40 rounded-xl border border-teal-100"
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
                                            className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {(!currentTenant.rentReductions || currentTenant.rentReductions.length === 0) && (
                                <div className="text-center py-4 text-slate-400 text-sm italic border-2 border-dashed border-teal-100 rounded-xl">
                                    暂无固定金额减免
                                </div>
                            )}
                        </div>
                    </section>

                    {/* 按月金额调整（amount_delta，叠加预算方案） */}
                    {currentTenant.id && onUpdateAdjustments && (
                        <section className="bg-white p-6 rounded-xl border border-purple-100 shadow-sm space-y-3">
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2 text-purple-700 font-bold text-sm">
                                    <ArrowLeftRight size={16} />
                                    按月金额调整（预算层）
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowAmountDeltaForm(!showAmountDeltaForm)}
                                    className="text-xs font-bold bg-purple-50 text-purple-700 px-3 py-1.5 rounded-lg hover:bg-purple-100"
                                >
                                    {showAmountDeltaForm ? '取消' : '+ 新增调整'}
                                </button>
                            </div>
                            <p className="text-xs text-purple-800/80">
                                在指定<strong>收款日所在月</strong>对账单金额加减（不挪账期）。保存园区数据后写入预算调整，预览时请勾选「叠加存量调优」。
                            </p>
                            {showAmountDeltaForm && (
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 bg-purple-50/50 rounded-lg border border-purple-100">
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-1">年份</label>
                                        <input
                                            type="number"
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
                                            className="px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-700"
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
                                            className="flex justify-between items-center gap-2 p-2 bg-slate-50 rounded border border-slate-200"
                                        >
                                            <span>
                                                {a.adjustedYear}年{a.adjustedMonth + 1}月{' '}
                                                <strong className={a.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                                                    {a.amount >= 0 ? '+' : ''}
                                                    {formatCurrency(a.amount)}
                                                </strong>
                                                {a.reason ? ` · ${a.reason}` : ''}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveAmountDelta(a.id)}
                                                className="text-rose-500 hover:text-rose-700"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div className="text-xs text-slate-400 italic">暂无按月金额调整</div>
                            )}
                        </section>
                    )}

                    <section className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-4">
                         {/* 账单明细预览 */}
                        {currentTenant.leaseStart && currentTenant.leaseEnd &&
                         currentTenant.monthlyRent && currentTenant.monthlyRent > 0 && (
                             <div className="mt-4 pt-4 border-t border-slate-200">
                                 {(() => {
                                     // 预览阶段尚未保存时，新合同的 projectId 仍为空；从已有合同推断当前园区，
                                     // 让计费引擎对深圳 / 上海 / 北京等用对应账期规则生成账单（与保存后再加载结果一致）。
                                     const inheritedProjectId =
                                         currentTenant.projectId ||
                                         tenants.find((t) => (t.projectId || '').trim())?.projectId ||
                                         '';

                                     // 生成预览账单
                                     const tenantForPreview: Tenant = {
                                         ...currentTenant,
                                         id: currentTenant.id || 'preview',
                                         name: currentTenant.name || '预览',
                                         buildingId: currentTenant.buildingId || '',
                                         unitIds: currentTenant.unitIds || [],
                                         totalArea: currentTenant.totalArea || 0,
                                         leaseStart: currentTenant.leaseStart!,
                                         leaseEnd: currentTenant.leaseEnd!,
                                         monthlyRent: currentTenant.monthlyRent!,
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
                                     
                                     const previewStart = new Date(currentTenant.leaseStart!);
                                     const previewEnd = new Date(currentTenant.leaseEnd!);

                                     // 空置去化：按单元挂预算假设；合同起租与「预计签约日」一致时由计费层自动对齐收款计划（与财务报表应收核销一致）。
                                     // 存量调优（Existing）仅当勾选开关时叠加。
                                     const allAssumptions = (dashboardData as any)?.budgetAssumptions || [];
                                     const allAdjustments = (dashboardData as any)?.budgetAdjustments || [];
                                     const vacancyBudgetAssumptions =
                                         (currentTenant.unitIds?.length ?? 0) > 0
                                             ? allAssumptions.filter(
                                                   (a: any) => a.targetType === 'Vacancy' && currentTenant.unitIds!.includes(a.targetId),
                                               )
                                             : [];
                                     const existingTenantAssumptions = currentTenant.id
                                         ? allAssumptions.filter((a: any) => a.targetId === currentTenant.id && a.targetType === 'Existing')
                                         : [];
                                     const tenantAdjustments = currentTenant.id
                                         ? allAdjustments.filter((a: any) => a.tenantId === currentTenant.id)
                                         : [];
                                     const hasExistingBudgetItems = existingTenantAssumptions.length > 0 || tenantAdjustments.length > 0;
                                     const hasVacancyBudgetItems = vacancyBudgetAssumptions.length > 0;
                                     const assumptionsForPreview = [
                                         ...vacancyBudgetAssumptions,
                                         ...(previewApplyBudget ? existingTenantAssumptions : []),
                                     ];
                                     const adjustmentsForPreview = previewApplyBudget ? tenantAdjustments : [];
                                     const showBillingDiffOverlay =
                                         assumptionsForPreview.length > 0 || adjustmentsForPreview.length > 0;
                                     const willApplyBudget = previewApplyBudget && hasExistingBudgetItems;

                                     // 生成合同期内所有账单
                                     const bills = generateBudgetedBills(
                                         tenantForPreview,
                                         assumptionsForPreview,
                                         adjustmentsForPreview,
                                         previewStart,
                                         previewEnd
                                     ); // 不再限制期数

                                     const showMgmtPreview =
                                         isManagementFeeBillingEnabled(inheritedProjectId) &&
                                         shouldGenerateManagementFeeBills(tenantForPreview);
                                     const mgmtBills = showMgmtPreview
                                         ? generateManagementFeeBills(tenantForPreview, previewStart, previewEnd)
                                         : [];

                                     // 同时生成「纯合同口径」用于对照（有预算层时计算）
                                     const billsRaw = showBillingDiffOverlay
                                         ? generateBudgetedBills(tenantForPreview, [], [], previewStart, previewEnd)
                                         : bills;
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
                                             <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                 <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-xl border border-blue-200">
                                                     <div className="flex items-center gap-2 mb-2">
                                                         <Receipt size={16} className="text-blue-600" />
                                                         <span className="text-xs font-bold text-blue-700">应收总额</span>
                                                     </div>
                                                    <div className="text-2xl font-bold text-blue-900">{formatCurrency(totalReceivable)}</div>
                                                     <div className="text-xs text-blue-600 mt-1">
                                                         合同期内共{previewRows.length}期
                                                         {showMgmtPreview && totalMgmtReceivable > 0 ? (
                                                             <span className="block text-teal-700 mt-0.5">
                                                                 租金 {formatCurrency(totalRentReceivable)} + 物业费{' '}
                                                                 {formatCurrency(totalMgmtReceivable)}
                                                             </span>
                                                         ) : null}
                                                     </div>
                                                 </div>
                                                 
                                                 <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-xl border border-green-200">
                                                     <div className="flex items-center justify-between mb-2">
                                                         <div className="flex items-center gap-2">
                                                             <CreditCard size={16} className="text-green-600" />
                                                             <span className="text-xs font-bold text-green-700">已收总额</span>
                                                         </div>
                                                         {(() => {
                                                             // 检查是否有初始化数据（判断是否有 2026-01-01 前的数据）
                                                             const hasInitData = tenantPayments.some(p => new Date(p.date) < new Date('2026-01-01'));
                                                             if (hasInitData) {
                                                                 return (
                                                                     <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                                                         含初始化
                                                                     </span>
                                                                 );
                                                             } else {
                                                                 return (
                                                                     <button
                                                                         onClick={() => setShowInitPaymentModal(true)}
                                                                         className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 transition-colors flex items-center gap-1"
                                                                     >
                                                                         <Plus size={12} />
                                                                         初始化
                                                                     </button>
                                                                 );
                                                             }
                                                         })()}
                                                     </div>
                                                    <div className="text-2xl font-bold text-green-900">{formatCurrency(totalPaid)}</div>
                                                     <div className="text-xs text-green-600 mt-1">实际收款{tenantPayments.length}笔</div>
                                                 </div>
                                                 
                                                 <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-xl border border-purple-200">
                                                     <div className="flex items-center gap-2 mb-2">
                                                         <TrendingUp size={16} className="text-purple-600" />
                                                         <span className="text-xs font-bold text-purple-700">月均收款</span>
                                                     </div>
                                                    <div className="text-2xl font-bold text-purple-900">{formatCurrency(avgMonthlyPayment)}</div>
                                                     <div className="text-xs text-purple-600 mt-1">合同共{totalMonths}个月</div>
                                                 </div>
                                                 
                                                <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 rounded-xl border border-amber-200">
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
                                                     <div className="flex items-center gap-2">
                                                         <Receipt size={18} className="text-blue-600" />
                                                         <span className="text-sm font-bold text-slate-800">应收款明细预览</span>
                                                         <span className="text-xs text-slate-500">（合同期内共{previewRows.length}期）</span>
                                                         {showMgmtPreview && (
                                                             <span className="text-[10px] font-bold bg-teal-50 text-teal-800 px-2 py-0.5 rounded border border-teal-100">
                                                                 含物业费
                                                             </span>
                                                         )}
                                                         {willApplyBudget && (
                                                             <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                                                                 <Sparkles size={10}/> 已叠加存量调优假设/调整
                                                             </span>
                                                         )}
                                                         {hasVacancyBudgetItems && (
                                                             <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-rose-50 text-rose-700 px-2 py-0.5 rounded border border-rose-200">
                                                                 <Sparkles size={10}/> 空置去化预算已参与推算
                                                             </span>
                                                         )}
                                                         {!showBillingDiffOverlay && (
                                                             <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                                                                 纯合同口径
                                                             </span>
                                                         )}
                                                     </div>
                                                     {hasExistingBudgetItems && (
                                                         <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                                                             <input
                                                                 type="checkbox"
                                                                 className="w-3.5 h-3.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                                                 checked={previewApplyBudget}
                                                                 onChange={(e) => setPreviewApplyBudget(e.target.checked)}
                                                             />
                                                             <span>叠加预算管理中的存量假设/调整（与「预算表」口径一致）</span>
                                                         </label>
                                                     )}
                                                 </div>

                                                 {/* 叠加项摘要提示 */}
                                                 {hasVacancyBudgetItems && vacancyBudgetNote && (
                                                     <div className="mb-3 p-3 rounded-lg bg-rose-50/70 border border-rose-200 text-xs text-rose-900 flex items-start gap-2">
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
                                                                     color: 'indigo',
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
                                                                     color: 'teal',
                                                                     text: `${adj.adjustedYear}年${adj.adjustedMonth + 1}月 ${adj.amount >= 0 ? '+' : ''}¥${adj.amount.toLocaleString()}${adj.reason ? `（${adj.reason}）` : ''}`,
                                                                 });
                                                             } else {
                                                                 items.push({
                                                                     tag: '账期调整',
                                                                     color: 'purple',
                                                                     text: `${adj.originalYear}年${adj.originalMonth + 1}月 → ${adj.adjustedYear}年${adj.adjustedMonth + 1}月${adj.reason ? `（${adj.reason}）` : ''}`,
                                                                 });
                                                             }
                                                         });
                                                         if (items.length === 0) return null;
                                                         const colorMap: Record<string, string> = {
                                                             amber: 'bg-amber-50 text-amber-800 border-amber-200',
                                                             blue: 'bg-blue-50 text-blue-800 border-blue-200',
                                                             indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
                                                             teal: 'bg-teal-50 text-teal-800 border-teal-200',
                                                             purple: 'bg-purple-50 text-purple-800 border-purple-200',
                                                         };
                                                         return (
                                                             <div className="mb-3 p-3 rounded-lg bg-purple-50/60 border border-purple-200">
                                                                 <div className="flex items-center gap-2 mb-2">
                                                                     <Info size={14} className="text-purple-600" />
                                                                     <span className="text-xs font-bold text-purple-800">
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
                                                     <div className="mb-3 p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
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
                                                 <div className="overflow-x-auto max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
                                                     <table className="w-full text-xs">
                                                         <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                                                             <tr>
                                                                 <th className="px-3 py-2 text-left font-bold text-slate-600">期次</th>
                                                                 <th className="px-3 py-2 text-left font-bold text-slate-600">收款日期</th>
                                                                 {showMgmtPreview ? (
                                                                     <>
                                                                         <th className="px-3 py-2 text-right font-bold text-slate-600">租金</th>
                                                                         <th className="px-3 py-2 text-right font-bold text-teal-700">物业费</th>
                                                                         <th className="px-3 py-2 text-right font-bold text-slate-800">合计</th>
                                                                     </>
                                                                 ) : (
                                                                     <>
                                                                         <th className="px-3 py-2 text-right font-bold text-slate-600">应缴</th>
                                                                         <th className="px-3 py-2 text-right font-bold text-slate-600">减免</th>
                                                                         <th className="px-3 py-2 text-right font-bold text-slate-800">实缴</th>
                                                                     </>
                                                                 )}
                                                                 <th className="px-3 py-2 text-left font-bold text-slate-600">覆盖周期</th>
                                                             </tr>
                                                         </thead>
                                                         <tbody className="divide-y divide-slate-100">
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
                                                             <tr key={idx} className={`hover:bg-slate-50 ${isBudgetNew ? 'bg-purple-50/40' : isBudgetChanged ? 'bg-amber-50/40' : ''}`}>
                                                                 <td className="px-3 py-2 text-slate-600">
                                                                     第{idx + 1}期
                                                                     {idx === firstCustomBillIdx && (currentTenant.firstReceivableAmount ?? 0) > 0 && (
                                                                         <span className="ml-1 inline-flex items-center text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-bold">首期自定义</span>
                                                                     )}
                                                                     {bill?.earlyTerminationExtraDetail && (
                                                                         <span
                                                                             className="ml-1 inline-flex items-center text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-bold border border-amber-200"
                                                                             title="免租扣回、押金扣款、其它调整（不含当期租金）"
                                                                         >
                                                                             提前退租结算
                                                                         </span>
                                                                     )}
                                                                     {row.mgmtAmount > 0 && row.rentAmount <= 0 && (
                                                                         <span className="ml-1 inline-flex items-center text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.5 rounded font-bold">
                                                                             物业费
                                                                         </span>
                                                                     )}
                                                                     {isBudgetNew && (
                                                                         <span className="ml-1 inline-flex items-center text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-bold" title="此账期由预算假设/调整新增">预算新增</span>
                                                                     )}
                                                                     {isBudgetChanged && (
                                                                         <span className="ml-1 inline-flex items-center text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold" title="此账期金额因预算调整发生变化">金额已调整</span>
                                                                     )}
                                                                 </td>
                                                                 <td className="px-3 py-2 font-bold text-blue-600">{formatDate(billDate)}</td>
                                                                 {showMgmtPreview ? (
                                                                     <>
                                                                         <td className="px-3 py-2 text-right text-slate-700">
                                                                             {row.rentAmount > 0 ? formatCurrency(row.rentAmount) : '—'}
                                                                         </td>
                                                                         <td className="px-3 py-2 text-right font-medium text-teal-700">
                                                                             {row.mgmtAmount > 0 ? formatCurrency(row.mgmtAmount) : '—'}
                                                                         </td>
                                                                         <td className="px-3 py-2 text-right font-bold text-green-600">
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
                                                                         <td className="px-3 py-2 text-right font-bold text-green-600">
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
                                                     <p className="text-xs text-slate-500 mt-2">
                                                         <span className="text-amber-600">ℹ️ 提示：</span>
                                                         收款日期为当期款项的收取时间；覆盖周期分别标注租金与物业费（若同日收款则合并为一行）。「财务报表 → 应收核销」按月筛选时：<strong className="text-slate-700">当期扣除</strong>模式按<strong className="text-slate-700">收款日期</strong>所在自然月归集；<strong className="text-slate-700">账期顺延</strong>（Defer）模式按<strong className="text-slate-700">覆盖期首月</strong>归集（与预算表、合同概要一致）。整笔应收仅在归属月出现一笔。
                                                         {(currentTenant.rentFreePeriods?.length || 0) > 0 && currentTenant.freeRentHandling === 'Defer' && '免租期采用账期顺延模式，收款时间会自动顺延。'}
                                                         {(currentTenant.rentFreePeriods?.length || 0) > 0 && currentTenant.freeRentHandling === 'Deduct' && '免租期采用当期扣除模式，应收金额会相应减少。'}
                                                         {showBillingDiffOverlay && (
                                                             <>
                                                                 {' '}
                                                                 <span className="text-purple-700">紫色行</span>
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
                    <section className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-4">
                        <div className="flex items-center gap-2 text-rose-600 font-bold mb-2"><Briefcase size={18}/> <span>客户背景与风险管理</span></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">所属行业</label><input type="text" placeholder="例如：人工智能 / 医疗器械" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.industry || ''} onChange={e => setCurrentTenant({...currentTenant, industry: e.target.value})} /></div>
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">企业成立日期</label><input type="date" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.foundingDate || ''} onChange={e => setCurrentTenant({...currentTenant, foundingDate: e.target.value})} /></div>
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">企业法人</label><input type="text" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.legalRepName || ''} onChange={e => setCurrentTenant({...currentTenant, legalRepName: e.target.value})} /></div>
                            </div>
                            <div className="space-y-4">
                                <div className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-100 rounded-xl">
                                    <input id="risk_flag" type="checkbox" className="w-5 h-5 text-rose-600 border-rose-300 rounded focus:ring-rose-500" checked={currentTenant.isRisk || false} onChange={e => setCurrentTenant({...currentTenant, isRisk: e.target.checked})} />
                                    <label htmlFor="risk_flag" className="flex-1 cursor-pointer">
                                        <div className="font-bold text-rose-700 text-sm">高风险客户监控</div>
                                        <div className="text-xs text-rose-600/70">勾选后将在看板重点标记，建议加强租金催缴。</div>
                                    </label>
                                    <ShieldAlert className="text-rose-500" size={24}/>
                                </div>
                                <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-100 rounded-xl">
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
                    <section className="px-8 py-5 border-t border-slate-200 bg-amber-50/30">
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
                            const handleAddAdj = () => {
                                if (!adjForm.amount || !adjForm.reason.trim()) {
                                    alert('请填写金额和原因');
                                    return;
                                }
                                if (adjPreviewBills.length === 0) {
                                    alert('当前无法推算收款计划，请检查起租日、止租日与月租金');
                                    return;
                                }
                                const origBill =
                                    origList.find((b) => String(b.date.getTime()) === adjForm.origBillKey) ?? origList[0];
                                const targetBill =
                                    targetList.find((b) => String(b.date.getTime()) === adjForm.targetBillKey) ?? targetList[0];
                                if (!origBill) {
                                    alert('未找到「原账期月份」下的收款日，请更换筛选或检查合同');
                                    return;
                                }
                                if (!targetBill) {
                                    alert('未找到「目标月份」下的收款日，请更换筛选');
                                    return;
                                }
                                if (origBill.date.getTime() === targetBill.date.getTime()) {
                                    alert('原收款日与目标收款日不能为同一天');
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
                                        <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2">
                                            <ArrowLeftRight size={16} /> 账期调整（存量调优）
                                        </h3>
                                        <div className="flex items-center gap-3">
                                            {/* 整体偏移 */}
                                            <div className="flex items-center gap-1 text-xs">
                                                <span className="text-slate-500">整体偏移:</span>
                                                <button
                                                    onClick={() => setCurrentTenant(prev => ({ ...prev, paymentPeriodShiftMonths: (prev.paymentPeriodShiftMonths || 0) - 1 }))}
                                                    className="w-6 h-6 rounded bg-amber-100 text-amber-700 font-bold hover:bg-amber-200"
                                                >−</button>
                                                <span className="font-mono font-bold w-6 text-center">{(currentTenant.paymentPeriodShiftMonths || 0) > 0 ? '+' : ''}{currentTenant.paymentPeriodShiftMonths || 0}</span>
                                                <button
                                                    onClick={() => setCurrentTenant(prev => ({ ...prev, paymentPeriodShiftMonths: (prev.paymentPeriodShiftMonths || 0) + 1 }))}
                                                    className="w-6 h-6 rounded bg-amber-100 text-amber-700 font-bold hover:bg-amber-200"
                                                >+</button>
                                                <span className="text-slate-400">月</span>
                                            </div>
                                            <button onClick={() => setShowAdjForm(!showAdjForm)} className="text-xs px-3 py-1 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 font-medium">
                                                {showAdjForm ? '取消' : '+ 单月调整'}
                                            </button>
                                        </div>
                                    </div>
                                    {(currentTenant.paymentPeriodShiftMonths || 0) !== 0 && (
                                        <p className="text-xs text-amber-700 bg-amber-100/50 rounded px-3 py-1.5">
                                            整体{currentTenant.paymentPeriodShiftMonths! > 0 ? '后移' : '前移'} {Math.abs(currentTenant.paymentPeriodShiftMonths!)} 个月：所有收款日期统一{currentTenant.paymentPeriodShiftMonths! > 0 ? '推迟' : '提前'}，适用于合同整体调整场景
                                        </p>
                                    )}
                                    {tenantAdjs.length > 0 && (
                                        <div className="space-y-1.5">
                                            {tenantAdjs.map(adj => (
                                                <div key={adj.id} className="flex items-center gap-2 text-xs bg-white rounded-lg px-3 py-2 border border-amber-200">
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
                                        <div className="bg-white rounded-lg border border-amber-200 p-3 space-y-2">
                                            {adjPreviewBills.length === 0 ? (
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
                                                disabled={adjPreviewBills.length === 0}
                                                className="w-full py-1.5 bg-amber-600 text-white rounded text-xs font-bold hover:bg-amber-700 disabled:opacity-40 disabled:pointer-events-none"
                                            >
                                                确认添加
                                            </button>
                                        </div>
                                    )}
                                    {tenantAdjs.length === 0 && !showAdjForm && (
                                        <p className="text-xs text-amber-600/60">暂无账期调整，点击上方按钮添加。</p>
                                    )}
                                </div>
                            );
                        })()}
                    </section>
                )}

                <div className="flex justify-between items-center px-8 py-6 border-t border-slate-100 bg-white sticky bottom-0 z-20 rounded-b-xl shadow-lg">
                    <div>{currentTenant.id && viewRentPricing && <button onClick={() => { if(window.confirm("确定删除?")) { onUpdateTenants(tenants.filter(t => t.id !== currentTenant.id)); setIsEditing(false); } }} className="text-rose-500 font-bold flex items-center gap-2 px-4 py-2 hover:bg-rose-50 rounded-lg"><Trash2 size={18}/> 删除记录</button>}</div>
                    <div className="flex gap-3"><button onClick={() => { setIsEditing(false); setRenewingFromId(null); setFormErrors({}); }} className="px-6 py-2.5 text-slate-600 font-bold">取消</button><button onClick={handleSave} className="px-10 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold flex items-center gap-2 shadow-lg"><Save size={18}/> 保存并退出</button></div>
                </div>
             </div>
             
             {/* 初始化录入弹窗（渲染在合同详情页面内） */}
             {showInitPaymentModal && (
                 <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
                    <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-md border border-slate-200 animate-in zoom-in-50 duration-200">
                       <h3 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2">
                           <CreditCard size={20} className="text-green-600" />
                           初始化录入 - 2026年1月前收款
                       </h3>
                       <div className="space-y-4">
                           <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                               <div className="flex items-start gap-2">
                                   <Info size={14} className="mt-0.5 flex-shrink-0" />
                                   <div>
                                       <div className="font-bold mb-1">功能说明：</div>
                                       <div>用于录入该客户在 <strong>2026年1月之前</strong> 的历史收款数据。请填写截至2025年12月31日的累计已收金额。</div>
                                   </div>
                               </div>
                           </div>
                           
                           <div>
                               <label className="block text-sm font-medium text-slate-700 mb-1">
                                   累计已收金额 <span className="text-red-500">*</span>
                               </label>
                               <input 
                                   type="number" 
                                   value={initPaymentData.amount} 
                                   onChange={e => setInitPaymentData({...initPaymentData, amount: e.target.value})} 
                                   placeholder="请输入金额"
                                   className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-green-100 outline-none" 
                               />
                           </div>
                           
                           <div>
                               <label className="block text-sm font-medium text-slate-700 mb-1">
                                   数据截止日期 <span className="text-red-500">*</span>
                               </label>
                               <input 
                                   type="date" 
                                   value={initPaymentData.date} 
                                   onChange={e => setInitPaymentData({...initPaymentData, date: e.target.value})} 
                                   max="2025-12-31"
                                   className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-green-100 outline-none" 
                               />
                               <div className="text-xs text-slate-500 mt-1">必须为 2025-12-31 或之前</div>
                           </div>
                           
                           <div>
                               <label className="block text-sm font-medium text-slate-700 mb-1">
                                   备注
                               </label>
                               <textarea 
                                   value={initPaymentData.remarks} 
                                   onChange={e => setInitPaymentData({...initPaymentData, remarks: e.target.value})} 
                                   placeholder="可输入备注信息"
                                   rows={2}
                                   className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-green-100 outline-none resize-none" 
                               />
                           </div>
                           
                           <div className="flex justify-end gap-2 mt-6">
                               <button 
                                   onClick={() => {
                                       setShowInitPaymentModal(false);
                                       setInitPaymentData({ amount: '', date: '', remarks: '2026年1月前历史数据' });
                                   }} 
                                   className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                               >
                                   取消
                               </button>
                               <button 
                                   onClick={() => {
                                       // 验证必填字段
                                       if (!initPaymentData.amount || !initPaymentData.date) {
                                           alert('请填写完整信息！');
                                           return;
                                       }
                                       
                                       // 验证日期必须在 2026-01-01 之前
                                       if (new Date(initPaymentData.date) >= new Date('2026-01-01')) {
                                           alert('数据截止日期必须为 2025-12-31 或之前！');
                                           return;
                                       }
                                       
                                       if (onUpdatePayments && currentTenant.id) {
                                           // 创建新的收款记录
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
                                           
                                           // 更新 payments 数组
                                           onUpdatePayments([...payments, newPayment]);
                                           
                                           // 关闭弹窗并重置表单
                                           setShowInitPaymentModal(false);
                                           setInitPaymentData({ amount: '', date: '', remarks: '2026年1月前历史数据' });
                                           
                                           alert('初始化数据录入成功！');
                                       }
                                   }} 
                                   className="px-6 py-2 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition-colors"
                                   disabled={!onUpdatePayments}
                               >
                                   确认录入
                               </button>
                           </div>
                       </div>
                    </div>
                 </div>
             )}

             {/* 名称变更弹窗 — 编辑页 */}
             {showNameChange && nameChangeTenantId && (() => {
               const t = tenants.find(x => x.id === nameChangeTenantId);
               if (!t) return null;
               return <NameChangeDialog tenant={t} onConfirm={handleNameChangeConfirm} onClose={() => { setShowNameChange(false); setNameChangeTenantId(null); }} />;
             })()}

             {/* 付款周期变更弹窗 — 编辑页 */}
             {showCycleChange && currentTenant.id && (
               <PaymentCycleChangeDialog tenant={currentTenant as Tenant} onConfirm={handleCycleChangeConfirm} onClose={() => setShowCycleChange(false)} />
             )}
         </div>
     )
  }

  return (
    <div className="space-y-6">
      {/* ... keeping Analysis/List/Terminated navigation logic from previous version ... */}
      <div className={`flex justify-between items-center gap-3 ${mobileEntryMode ? 'flex-col sm:flex-row sm:items-center' : ''}`}>
           <h2 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2 w-full sm:w-auto">
             <LayoutDashboard size={22} className="text-blue-600 shrink-0"/>
             {mobileEntryMode ? '合同录入' : '客户合同中心'}
           </h2>
           <div className={`flex bg-slate-200/60 p-1 rounded-xl shadow-inner w-full sm:w-auto ${mobileEntryMode ? 'justify-stretch' : ''}`}>
               {!mobileEntryMode && (
               <button type="button" onClick={() => setActiveTab('Analysis')} className={`flex-1 sm:flex-none px-4 sm:px-5 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'Analysis' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>经营分析</button>
               )}
               <button type="button" onClick={() => setActiveTab('List')} className={`flex-1 sm:flex-none px-4 sm:px-5 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'List' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>在租明细</button>
               <button type="button" onClick={() => setActiveTab('Terminated')} className={`flex-1 sm:flex-none px-4 sm:px-5 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'Terminated' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>历史退租</button>
           </div>
      </div>

      {activeTab === 'Analysis' && (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Period Selector & Top KPIs */}
            <div className="flex flex-col lg:flex-row gap-6">
                <div className="lg:w-1/4 space-y-4">
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-3">统计维度选择</label>
                        <div className="grid grid-cols-3 gap-1 bg-slate-50 p-1 rounded-lg">
                            {(['Year', 'Quarter', 'Month'] as const).map(p => (
                                <button key={p} onClick={() => setAnalysisPeriod(p)} className={`py-1.5 rounded-md text-xs font-bold transition-all ${analysisPeriod === p ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-200'}`}>
                                    {p === 'Year' ? '本年度' : p === 'Quarter' ? '本季度' : '本月'}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-5 rounded-2xl text-white shadow-lg shadow-blue-100">
                         <div className="flex justify-between items-start mb-4">
                             <div className="p-2 bg-white/10 rounded-lg"><TrendingUp size={20}/></div>
                             <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full">NET GROWTH</span>
                         </div>
                         <div className="text-xs opacity-80 font-medium">期间净去化面积</div>
                         <div className="text-3xl font-black mt-1 tabular-nums">{perfData.metrics.netArea > 0 ? '+' : ''}{formatArea(perfData.metrics.netArea)}</div>
                         <div className="mt-4 pt-4 border-t border-white/10 flex justify-between items-center text-[10px]">
                             <div className="flex items-center gap-1"><ArrowUpRight size={12} className="text-emerald-300"/> 新签 {formatArea(perfData.metrics.signedArea)}</div>
                             <div className="flex items-center gap-1"><ArrowDownRight size={12} className="text-rose-300"/> 退租 {formatArea(perfData.metrics.terminatedArea)}</div>
                         </div>
                    </div>
                </div>

                <div className="lg:w-3/4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* New Signings KPI */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between group hover:border-emerald-200 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                            <div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">新签业绩 Signings</p><h3 className="text-3xl font-black text-slate-800 mt-1">{formatArea(perfData.metrics.signedArea)}</h3></div>
                            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl group-hover:scale-110 transition-transform"><UserPlus size={24}/></div>
                        </div>
                        <div className="flex items-center gap-6 mt-4">
                            <div className="space-y-1">
                                <div className="text-[10px] font-bold text-slate-400">同比 (YoY)</div>
                                <div className={`flex items-center gap-1 font-black text-sm ${perfData.yoy.area >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                    {perfData.yoy.area >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>}
                                    {formatPercent(Math.abs(perfData.yoy.area))}
                                </div>
                            </div>
                            <div className="w-px h-8 bg-slate-100"></div>
                            <div className="space-y-1">
                                <div className="text-[10px] font-bold text-slate-400">环比 (MoM)</div>
                                <div className={`flex items-center gap-1 font-black text-sm ${perfData.mom.area >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
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
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between group hover:border-rose-200 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                            <div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">退租流失 Churn</p><h3 className="text-3xl font-black text-slate-800 mt-1">{formatArea(perfData.metrics.terminatedArea)}</h3></div>
                            <div className="p-3 bg-rose-50 text-rose-600 rounded-xl group-hover:scale-110 transition-transform"><UserMinus size={24}/></div>
                        </div>
                        <div className="flex items-center gap-4 mt-4">
                            <div className="bg-rose-50 px-3 py-2 rounded-xl flex-1 border border-rose-100">
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <OccupancyTrendChart data={dashboardData} period="年度" />
                    <UnitPriceTrendChart data={dashboardData} period="年度" />
                </div>
            )}

            {/* Trends Chart */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><BarChart3 size={20}/></div>
                        <div><h3 className="font-bold text-slate-800">租赁面积变动趋势 (近12个月)</h3><p className="text-xs text-slate-500 mt-0.5">展示各月新签面积与退租面积的博弈及净增长</p></div>
                    </div>
                </div>
                <div className="h-[320px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={perfData.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="month" tick={{fill: '#94a3b8', fontSize: 10}} axisLine={false} tickLine={false} dy={10} />
                            <YAxis tick={{fill: '#94a3b8', fontSize: 10}} axisLine={false} tickLine={false} unit="㎡" />
                            <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                            <Legend verticalAlign="top" align="right" height={36} iconType="circle" />
                            <Bar dataKey="newArea" name="新租面积" fill="#10b981" radius={[4, 4, 0, 0]} barSize={24} />
                            <Bar dataKey="lostArea" name="退租面积" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={24} />
                            <Line type="monotone" dataKey="netArea" name="净去化" stroke="#6366f1" strokeWidth={3} dot={{ r: 4, fill: '#6366f1' }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Churn Reasons Distribution */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 mb-6">
                    <div className="p-2 bg-rose-50 text-rose-600 rounded-lg"><PieChart size={20}/></div>
                    <h3 className="font-bold text-slate-800">退租分析</h3>
                </div>
                
                {/* 退租数量统计卡片 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-4 rounded-xl border border-slate-200">
                        <div className="text-xs text-slate-500 mb-1">本年退租</div>
                        <div className="text-2xl font-bold text-slate-800">{perfData.terminationStats.year}</div>
                        <div className="text-xs text-slate-500 mt-1">家企业</div>
                    </div>
                    
                    <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 rounded-xl border border-amber-200">
                        <div className="text-xs text-amber-600 mb-1">本季度退租</div>
                        <div className="text-2xl font-bold text-amber-800">{perfData.terminationStats.quarter}</div>
                        <div className="text-xs text-amber-600 mt-1">家企业</div>
                    </div>
                    
                    <div className="bg-gradient-to-br from-rose-50 to-rose-100 p-4 rounded-xl border border-rose-200">
                        <div className="text-xs text-rose-600 mb-1">本月退租</div>
                        <div className="text-2xl font-bold text-rose-800">{perfData.terminationStats.month}</div>
                        <div className="text-xs text-rose-600 mt-1">家企业</div>
                    </div>
                    
                    <div className="bg-gradient-to-br from-red-50 to-red-100 p-4 rounded-xl border border-red-200">
                        <div className="text-xs text-red-600 mb-1">提前退租率</div>
                        <div className="text-2xl font-bold text-red-800">{formatPercent(perfData.earlyRate)}</div>
                        <div className="text-xs text-red-600 mt-1">{perfData.terminationStats.earlyCount}/{perfData.terminationStats.all} 家</div>
                    </div>
                </div>
                
                {/* 退租原因分布图表 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 退租类型饼图 */}
                    <div>
                        <h4 className="text-sm font-bold text-slate-700 mb-3">退租类型分布</h4>
                        <div className="h-[200px] flex items-center">
                            {perfData.terminationTypeData.length > 0 ? (
                                <>
                                    <div className="w-1/2 h-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <RechartsPieChart>
                                                <Pie 
                                                    data={perfData.terminationTypeData} 
                                                    cx="50%" 
                                                    cy="50%" 
                                                    innerRadius={50} 
                                                    outerRadius={70} 
                                                    paddingAngle={5} 
                                                    dataKey="value"
                                                >
                                                    <Cell fill="#10b981" />
                                                    <Cell fill="#ef4444" />
                                                </Pie>
                                                <Tooltip />
                                            </RechartsPieChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="w-1/2 space-y-3">
                                        {perfData.terminationTypeData.map((item, i) => (
                                            <div key={i} className="flex items-center justify-between text-sm">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 rounded-full" style={{backgroundColor: i === 0 ? '#10b981' : '#ef4444'}}></div>
                                                    <span className="text-slate-700">{item.name}</span>
                                                </div>
                                                <span className="font-bold text-slate-800">{item.value} 家</span>
                                            </div>
                                        ))}
                                    </div>
                                </>
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

      {(activeTab === 'List' || activeTab === 'Terminated') && (
          <>
            <div className="mb-4 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm sm:p-4">
                {/* 第一行：筛选（小屏可横向滑动，避免与操作区抢高） */}
                <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:pb-0">
                    <div className="flex min-w-0 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-2.5 py-1.5 text-sm shadow-sm sm:min-w-[10rem]">
                        <Filter size={15} className="shrink-0 text-slate-400" aria-hidden />
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
                        <div className="flex min-w-0 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-2.5 py-1.5 text-sm shadow-sm sm:min-w-[8.5rem]">
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
                    <div className="flex min-w-0 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-2.5 py-1.5 text-sm shadow-sm sm:min-w-[8.5rem]">
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
                    <div className="relative min-w-0 w-full lg:max-w-md lg:flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                        <input
                            type="search"
                            enterKeyHint="search"
                            placeholder="搜索企业名称…"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-9 pr-3 text-sm text-slate-800 shadow-inner outline-none ring-blue-100 transition-[box-shadow,border-color] placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:ring-2"
                        />
                    </div>

                    {activeTab === 'List' ? (
                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:shrink-0 lg:gap-3">
                            <div
                                className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-100/70 p-1 sm:justify-end"
                                role="group"
                                aria-label="批量与导入"
                            >
                                <button
                                    type="button"
                                    onClick={handleBatchDeleteContracts}
                                    disabled={!viewRentPricing || batchSelectedContractIds.size === 0}
                                    className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:pointer-events-none disabled:opacity-40 sm:px-3 sm:text-sm"
                                    title="删除已勾选的可删合同"
                                >
                                    <Trash2 size={14} className="shrink-0 opacity-80" aria-hidden />
                                    <span>删除</span>
                                    <span className="tabular-nums text-rose-600/90">({batchSelectedContractIds.size})</span>
                                </button>
                                <span className="hidden h-5 w-px bg-slate-300/80 sm:inline" aria-hidden />
                                <button
                                    type="button"
                                    onClick={handleExportTenants}
                                    className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white sm:px-3 sm:text-sm"
                                    title="导出当前筛选结果"
                                >
                                    <Download size={14} className="shrink-0 text-slate-500" aria-hidden />
                                    导出
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDownloadTemplate}
                                    className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white sm:px-3 sm:text-sm"
                                    title="下载导入模板"
                                >
                                    模板
                                </button>
                                <label
                                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white sm:px-3 sm:text-sm"
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
                            </div>

                            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                <div
                                    className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5 shadow-sm"
                                    title="切换在租明细布局"
                                >
                                    <button
                                        type="button"
                                        onClick={() => setListLayoutMode('Card')}
                                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors sm:px-3 ${
                                            listLayoutMode === 'Card'
                                                ? 'bg-white text-blue-600 shadow-sm'
                                                : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                        title="卡片视图：按楼栋→楼层分组，含账期 ◀▶ 微调"
                                    >
                                        <LayoutGrid size={14} aria-hidden /> 卡片
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setListLayoutMode('Table')}
                                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors sm:px-3 ${
                                            listLayoutMode === 'Table'
                                                ? 'bg-white text-blue-600 shadow-sm'
                                                : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                        title="表格视图：紧凑列表"
                                    >
                                        <Rows3 size={14} aria-hidden /> 表格
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowAIContractImport(true)}
                                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 sm:px-4 sm:text-sm"
                                    title="上传截图/文本/Excel，由 AI 识别并生成合同草稿"
                                >
                                    <Sparkles size={15} className="shrink-0" aria-hidden />
                                    <span className="sm:hidden">AI导入</span>
                                    <span className="hidden sm:inline">AI识别导入</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCurrentTenant({
                                            signingDate: new Date().toISOString().split('T')[0],
                                            status: ContractStatus.Active,
                                            depositStatus: DepositStatus.Unpaid,
                                            rentFreePeriods: [],
                                            paymentCycle: 'Quarterly',
                                            paymentCycleMonths: 3,
                                            firstPaymentMonths: 3,
                                        });
                                        setIsEditing(true);
                                    }}
                                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-blue-700 sm:flex-initial sm:px-4 sm:text-sm"
                                >
                                    <Plus size={16} className="shrink-0" aria-hidden />
                                    新签客户
                                </button>
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
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-400 text-sm">
                        暂无在租客户
                    </div>
                ) : (
                    <div className="space-y-5">
                        {buildingFloorGroups.map((group) => {
                            const totalCount = group.floors.reduce((acc, f) => acc + f.tenants.length, 0);
                            return (
                                <section
                                    key={group.buildingId}
                                    className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                                >
                                    <header className="bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50/40 px-4 md:px-5 py-2.5 border-b border-blue-100 flex items-center gap-2">
                                        <BuildingIcon size={16} className="text-blue-600 shrink-0" />
                                        <h3 className="font-bold text-slate-800 text-sm md:text-base">
                                            {group.buildingName}
                                        </h3>
                                        <span className="ml-auto text-[11px] bg-white text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-bold tabular-nums shadow-sm">
                                            {totalCount} 家
                                        </span>
                                    </header>
                                    {group.floors.map((fg) => (
                                        <div key={`${group.buildingId}_${fg.floorLabel}`}>
                                            <div className="bg-slate-50/80 px-4 md:px-5 py-1.5 border-b border-slate-100 flex items-center gap-2 sticky top-0 z-[1]">
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
                                                    const building = buildings.find((b) => b.id === t.buildingId);
                                                    const unitNames = t.unitIds
                                                        .map((uid) => building?.units.find((u) => u.id === uid)?.name || uid)
                                                        .join(', ');
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
                                                            className={`relative flex flex-col bg-white border rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden ${
                                                                hasAdjustment
                                                                    ? 'border-amber-200 ring-1 ring-amber-100'
                                                                    : t.isRisk
                                                                      ? 'border-rose-200 ring-1 ring-rose-100'
                                                                      : 'border-slate-200'
                                                            }`}
                                                        >
                                                            {/* 头部：选择框 + 客户名 + 状态标签 */}
                                                            <div className="px-3.5 pt-3 pb-2 border-b border-slate-100">
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
                                                                                            ? 'bg-violet-50 text-violet-700 border-violet-200'
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
                                                                                <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded font-bold">
                                                                                    账期顺延
                                                                                </span>
                                                                            )}
                                                                            {!!(t.rentFreePeriods && t.rentFreePeriods.length > 0) && t.freeRentHandling === 'Deduct' && (
                                                                                <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded font-bold">
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
                                                                    <span className="font-medium">{building?.name}</span>
                                                                    <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-mono text-[11px]" title={unitNames}>
                                                                        {unitNames}
                                                                    </span>
                                                                </div>
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
                                                                            : 'bg-slate-50/60 border-slate-100'
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
                                                                            className="p-1 text-slate-600 hover:text-amber-700 hover:bg-amber-100 rounded transition-colors"
                                                                            title="账期整体提前 1 个月（适用于「需要提前收款」场景）"
                                                                            aria-label="账期整体提前 1 个月"
                                                                        >
                                                                            <ChevronLeft size={14} />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleShiftPaymentPeriod(t.id, +1)}
                                                                            className="p-1 text-slate-600 hover:text-amber-700 hover:bg-amber-100 rounded transition-colors"
                                                                            title="账期整体后移 1 个月（适用于「需要延后收款」场景）"
                                                                            aria-label="账期整体后移 1 个月"
                                                                        >
                                                                            <ChevronRight size={14} />
                                                                        </button>
                                                                        {hasShift && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleClearPaymentPeriodShift(t.id)}
                                                                                className="ml-0.5 p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
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
                                                            <div className="px-3.5 py-2 border-t border-slate-100 flex items-center justify-end gap-3 bg-white">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleEdit(t)}
                                                                    className="text-blue-600 font-bold text-xs hover:underline inline-flex items-center gap-1"
                                                                >
                                                                    <FileText size={12} /> 详情
                                                                </button>
                                                                {(t.status === ContractStatus.Expiring || t.status === ContractStatus.Active) && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleRenewal(t)}
                                                                        className="text-emerald-600 font-bold text-xs hover:underline"
                                                                    >
                                                                        续签
                                                                    </button>
                                                                )}
                                                                {t.status !== ContractStatus.Terminated && (
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
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm text-left min-w-[920px]">
                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                        <tr>
                            {activeTab === 'List' && <th className="px-3 py-4 w-10 text-center">选</th>}
                            <th className="px-6 py-4">客户名称</th><th className="px-6 py-4">租赁位置</th><th className="px-6 py-4">{activeTab === 'Terminated' ? '退租日期' : '起租日期'}</th><th className="px-6 py-4">实际入驻</th><th className="px-6 py-4">合同期 & 单价</th><th className="px-6 py-4">付款周期</th><th className="px-6 py-4 text-right">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {activeTab === 'List' ? buildingFloorGroups.map(group => (
                            <React.Fragment key={group.buildingId}>
                                <tr className="bg-blue-50/40 border-y border-slate-100">
                                    <td colSpan={activeTab === 'List' ? 8 : 7} className="px-6 py-2 font-bold text-xs text-blue-800">{group.buildingName} ({group.floors.reduce((acc, f) => acc + f.tenants.length, 0)}家)</td>
                                </tr>
                                {group.floors.map(fg => (
                                    <React.Fragment key={`${group.buildingId}_${fg.floorLabel}`}>
                                        <tr className="bg-slate-50/60 border-y border-slate-100">
                                            <td colSpan={activeTab === 'List' ? 8 : 7} className="px-6 py-2 font-semibold text-[11px] text-slate-600">{fg.floorLabel} ({fg.tenants.length}家)</td>
                                        </tr>
                                        {fg.tenants.map(t => {
                                            const building = buildings.find(b => b.id === t.buildingId);
                                            const unitNames = t.unitIds.map(uid => building?.units.find(u => u.id === uid)?.name || uid).join(', ');
                                            const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
                                            const displayPrice = rentDisplay.unitPrice;
                                            const contractYear = Number((t.signingDate || t.leaseStart || '').slice(0, 4));
                                            const isThisYearContract = contractYear === currentCalendarYear;
                                            const isRenewalContract = Boolean(t.rootId);
                                            return (
                                                <tr key={t.id} className="hover:bg-slate-50 transition-colors">
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
                                                                <span className={`text-[10px] px-2 py-0.5 rounded-md border font-bold ${isRenewalContract ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-cyan-50 text-cyan-700 border-cyan-200'}`}>
                                                                    {isRenewalContract ? '本年续租' : '本年新签'}
                                                                </span>
                                                            )}
                                                            {t.isRisk && <ShieldAlert size={14} className="text-red-500" />}
                                                            {((t.paymentPeriodAdjustments || []).length > 0 || (t.paymentPeriodShiftMonths || 0) !== 0) && (
                                                                <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200 font-bold inline-flex items-center gap-1" title={`${(t.paymentPeriodAdjustments || []).length}笔单月调整${(t.paymentPeriodShiftMonths || 0) !== 0 ? `，整体${t.paymentPeriodShiftMonths! > 0 ? '后移' : '前移'}${Math.abs(t.paymentPeriodShiftMonths!)}月` : ''}`}>
                                                                    <ArrowLeftRight size={10} /> 账期调整
                                                                </span>
                                                            )}
                                                            {t.isSpecialBusiness && (
                                                                <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200 font-bold inline-flex items-center gap-1">
                                                                    <Sparkles size={10} /> 特殊业态
                                                                </span>
                                                            )}
                                                            {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Defer' && (
                                                                <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-200 font-bold">账期顺延</span>
                                                            )}
                                                            {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Deduct' && (
                                                                <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-md border border-green-200 font-bold">当期扣除</span>
                                                            )}
                                                            {renderManagementFeeTags(t, projectIdProp)}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-slate-600">{building?.name} <span className="text-xs bg-slate-100 px-1 rounded font-medium">{unitNames}</span></td>
                                                    <td className="px-6 py-4"><div className="text-slate-700 font-bold">{t.leaseStart}</div></td>
                                                    <td className="px-6 py-4 text-slate-600 text-xs">{t.moveInDate ? <span className="font-medium text-slate-800">{t.moveInDate}</span> : <span className="text-slate-400">同起租</span>}</td>
                                                    <td className="px-6 py-4"><div className="text-slate-500 text-xs">{t.leaseStart} ~ {t.leaseEnd}</div><div className="text-blue-600 font-bold">{formatCurrency(displayPrice)}</div></td>
                                                    <td className="px-6 py-4 text-slate-600 text-sm">{paymentCycleLabelMap[t.paymentCycle] || t.paymentCycle}</td>
                                                    <td className="px-6 py-4 text-right space-x-3"><button onClick={() => handleEdit(t)} className="text-blue-600 font-bold text-xs hover:underline">详情</button>{(t.status === ContractStatus.Expiring || t.status === ContractStatus.Active) && <button onClick={() => handleRenewal(t)} className="text-emerald-600 font-bold text-xs hover:underline">续签</button>}{t.status !== ContractStatus.Terminated && <button onClick={() => initiateTermination(t.id)} className="text-amber-600 font-bold text-xs hover:underline">退租</button>}</td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                ))}
                            </React.Fragment>
                        )) : sortedYears.map(group => (
                            <React.Fragment key={group.year}>
                                <tr className={`${activeTab === 'Terminated' ? 'bg-rose-50/30' : 'bg-blue-50/30'} border-y border-slate-100`}><td colSpan={7} className={`px-6 py-2 font-bold text-xs ${activeTab === 'Terminated' ? 'text-rose-800' : 'text-blue-800'}`}>{group.year}年度{activeTab === 'Terminated' ? '退租' : '起租'} ({group.tenants.length}家)</td></tr>
                                {group.tenants.map(t => {
                                    const building = buildings.find(b => b.id === t.buildingId);
                                    const unitNames = t.unitIds.map(uid => building?.units.find(u => u.id === uid)?.name || uid).join(', ');
                                    const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
                                    const displayPrice = rentDisplay.unitPrice;
                                    return (
                                        <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-slate-800">{t.name}</span>
                                                    {t.isRisk && <ShieldAlert size={14} className="text-red-500" />}
                                                    {t.isSpecialBusiness && (
                                                        <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200 font-bold inline-flex items-center gap-1">
                                                            <Sparkles size={10} /> 特殊业态
                                                        </span>
                                                    )}
                                                    {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Defer' && (
                                                        <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-200 font-bold">
                                                            账期顺延
                                                        </span>
                                                    )}
                                                    {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Deduct' && (
                                                        <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-md border border-green-200 font-bold">
                                                            当期扣除
                                                        </span>
                                                    )}
                                                    {t.parentContractId && (
                                                        <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200 font-bold">
                                                            部分退租
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-600">{building?.name} <span className="text-xs bg-slate-100 px-1 rounded font-medium">{unitNames}</span></td>
                                            <td className="px-6 py-4">{activeTab === 'Terminated' ? <div className="text-rose-600 font-bold">{t.terminationDate || t.leaseEnd}</div> : <div className="text-slate-700 font-bold">{t.leaseStart}</div>}</td>
                                            <td className="px-6 py-4 text-slate-600 text-xs">{t.moveInDate ? <span className="font-medium text-slate-800">{t.moveInDate}</span> : <span className="text-slate-400">同起租</span>}</td>
                                            <td className="px-6 py-4"><div className="text-slate-500 text-xs">{t.leaseStart} ~ {t.leaseEnd}</div><div className="text-blue-600 font-bold">{formatCurrency(displayPrice)}</div></td>
                                            <td className="px-6 py-4 text-slate-600 text-sm">{paymentCycleLabelMap[t.paymentCycle] || t.paymentCycle}</td>
                                            <td className="px-6 py-4 text-right space-x-3"><button onClick={() => handleEdit(t)} className="text-blue-600 font-bold text-xs hover:underline">详情</button><button onClick={() => handleRollback(t.id)} className="text-emerald-600 font-bold text-xs hover:underline">回退</button></td>
                                        </tr>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </tbody>
                    </table>
                </div>
                <div className="md:hidden">
                    {activeTab === 'List' ? (
                        buildingFloorGroups.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-sm">暂无在租客户</div>
                        ) : (
                            buildingFloorGroups.map((group) => (
                                <div key={group.buildingId}>
                                    <div className="bg-blue-50/80 px-4 py-2 text-xs font-bold text-blue-800 border-b border-blue-100">
                                        {group.buildingName} ({group.floors.reduce((acc, f) => acc + f.tenants.length, 0)}家)
                                    </div>
                                    {group.floors.map((fg) => (
                                        <div key={`${group.buildingId}_${fg.floorLabel}`}>
                                            <div className="bg-slate-50 px-4 py-1.5 text-[11px] font-semibold text-slate-600 border-b border-slate-100">
                                                {fg.floorLabel} ({fg.tenants.length}家)
                                            </div>
                                            {fg.tenants.map((t) => {
                                                const building = buildings.find((b) => b.id === t.buildingId);
                                                const unitNames = t.unitIds.map((uid) => building?.units.find((u) => u.id === uid)?.name || uid).join(', ');
                                                const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
                                            const displayPrice = rentDisplay.unitPrice;
                                                const contractYear = Number((t.signingDate || t.leaseStart || '').slice(0, 4));
                                                const isThisYearContract = contractYear === currentCalendarYear;
                                                const isRenewalContract = Boolean(t.rootId);
                                                return (
                                                    <div key={t.id} className="px-4 py-3 border-b border-slate-100 bg-white">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="font-bold text-slate-800">{t.name}</span>
                                                            {isThisYearContract && (
                                                                <span className={`text-[10px] px-2 py-0.5 rounded-md border font-bold ${isRenewalContract ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-cyan-50 text-cyan-700 border-cyan-200'}`}>
                                                                    {isRenewalContract ? '本年续租' : '本年新签'}
                                                                </span>
                                                            )}
                                                            {t.isRisk && <ShieldAlert size={14} className="text-red-500" />}
                                                            {((t.paymentPeriodAdjustments || []).length > 0 || (t.paymentPeriodShiftMonths || 0) !== 0) && (
                                                                <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200 font-bold inline-flex items-center gap-1" title={`${(t.paymentPeriodAdjustments || []).length}笔单月调整${(t.paymentPeriodShiftMonths || 0) !== 0 ? `，整体${t.paymentPeriodShiftMonths! > 0 ? '后移' : '前移'}${Math.abs(t.paymentPeriodShiftMonths!)}月` : ''}`}>
                                                                    <ArrowLeftRight size={10} /> 账期调整
                                                                </span>
                                                            )}
                                                            {t.isSpecialBusiness && (
                                                                <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200 font-bold inline-flex items-center gap-1">
                                                                    <Sparkles size={10} /> 特殊业态
                                                                </span>
                                                            )}
                                                            {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Defer' && (
                                                                <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-200 font-bold">账期顺延</span>
                                                            )}
                                                            {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Deduct' && (
                                                                <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-md border border-green-200 font-bold">当期扣除</span>
                                                            )}
                                                            {renderManagementFeeTags(t, projectIdProp)}
                                                        </div>
                                                        <div className="text-xs text-slate-600 mt-1">
                                                            {building?.name}{' '}
                                                            <span className="bg-slate-100 px-1 rounded font-medium">{unitNames}</span>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-2 text-[11px] text-slate-600">
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
                                                                            <span className="text-teal-700 font-bold">
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
                                                                                <span className="text-teal-800 font-bold">{formatCurrency(m.monthlyAmount)}</span>
                                                                            </span>
                                                                        ) : null}
                                                                    </>
                                                                );
                                                            })()}
                                                        </div>
                                                        <div className="flex flex-wrap gap-3 mt-3">
                                                            <button type="button" onClick={() => handleEdit(t)} className="text-blue-600 font-bold text-xs">
                                                                详情
                                                            </button>
                                                            {(t.status === ContractStatus.Expiring || t.status === ContractStatus.Active) && (
                                                                <button type="button" onClick={() => handleRenewal(t)} className="text-emerald-600 font-bold text-xs">
                                                                    续签
                                                                </button>
                                                            )}
                                                            {t.status !== ContractStatus.Terminated && (
                                                                <button type="button" onClick={() => initiateTermination(t.id)} className="text-amber-600 font-bold text-xs">
                                                                    退租
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            ))
                        )
                    ) : sortedYears.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 text-sm">暂无历史退租记录</div>
                    ) : (
                        sortedYears.map((group) => (
                            <div key={group.year}>
                                <div className="bg-rose-50/80 px-4 py-2 text-xs font-bold text-rose-800 border-b border-rose-100">
                                    {group.year}年度退租 ({group.tenants.length}家)
                                </div>
                                {group.tenants.map((t) => {
                                    const building = buildings.find((b) => b.id === t.buildingId);
                                    const unitNames = t.unitIds.map((uid) => building?.units.find((u) => u.id === uid)?.name || uid).join(', ');
                                    const rentDisplay = resolveRentUnitPriceForDisplay(t, projectIdProp);
                                    const displayPrice = rentDisplay.unitPrice;
                                    return (
                                        <div key={t.id} className="px-4 py-3 border-b border-slate-100 bg-white">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-bold text-slate-800">{t.name}</span>
                                                {t.isRisk && <ShieldAlert size={14} className="text-red-500" />}
                                                {t.isSpecialBusiness && (
                                                    <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200 font-bold inline-flex items-center gap-1">
                                                        <Sparkles size={10} /> 特殊业态
                                                    </span>
                                                )}
                                                {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Defer' && (
                                                    <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-200 font-bold">账期顺延</span>
                                                )}
                                                {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Deduct' && (
                                                    <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-md border border-green-200 font-bold">当期扣除</span>
                                                )}
                                                {t.parentContractId && (
                                                    <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200 font-bold">部分退租</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-600 mt-1">
                                                {building?.name}{' '}
                                                <span className="bg-slate-100 px-1 rounded font-medium">{unitNames}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-2 text-[11px] text-slate-600">
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
                                            <div className="mt-3">
                                                <button type="button" onClick={() => handleEdit(t)} className="text-blue-600 font-bold text-xs">
                                                    详情
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))
                    )}
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
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="text-xs text-slate-500 font-medium">本年到期客户</div>
              <div className="text-2xl font-bold text-amber-600 mt-1">{expiringTenants.length}</div>
              <div className="text-xs text-slate-400 mt-1">
                已过期 {expiringTenants.filter(t => getExpiryUrgency(t.leaseEnd) === 'overdue').length} 个
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="text-xs text-slate-500 font-medium">本月到期</div>
              <div className="text-2xl font-bold text-red-500 mt-1">
                {expiringTenants.filter(t => getExpiryUrgency(t.leaseEnd) === 'thisMonth').length}
              </div>
              <div className="text-xs text-slate-400 mt-1">需立即处理</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="text-xs text-slate-500 font-medium">下月到期</div>
              <div className="text-2xl font-bold text-orange-500 mt-1">
                {expiringTenants.filter(t => getExpiryUrgency(t.leaseEnd) === 'nextMonth').length}
              </div>
              <div className="text-xs text-slate-400 mt-1">需提前准备</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="text-xs text-slate-500 font-medium">涉及月租金</div>
              <div className="text-2xl font-bold text-blue-600 mt-1">
                {expiringTenants.length > 0
                  ? '¥' + (expiringTenants.reduce((sum, t) => sum + (t.monthlyRent || 0), 0) / 10000).toFixed(1) + '万'
                  : '¥0'}
              </div>
              <div className="text-xs text-slate-400 mt-1">月度总额</div>
            </div>
          </div>

          {/* 按季度分组 */}
          {expiringByQuarter.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Calendar size={28} className="text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-700 mb-2">本年度无到期合同</h3>
              <p className="text-slate-400 text-sm">所有合同均在有效期内</p>
            </div>
          ) : (
            expiringByQuarter.map(quarter => (
              <div key={quarter.label} className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-5 bg-amber-500 rounded-full"></div>
                  <h3 className="text-base font-bold text-slate-700">
                    {quarter.label}
                    <span className="ml-2 text-sm font-normal text-slate-400">({quarter.tenants.length}个客户)</span>
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {quarter.tenants.map(t => {
                    const urgency = getExpiryUrgency(t.leaseEnd);
                    const building = buildings.find(b => b.id === t.buildingId);
                    const unitIds = t.unitIds || [];
                    const mainUnit = building?.units.find(u => unitIds.includes(u.id));
                    const daysLeft = Math.ceil((new Date(t.leaseEnd).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                    return (
                      <div key={t.id} className={'bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow overflow-hidden ' + (
                        urgency === 'overdue' ? 'border-red-300 bg-red-50/30' :
                        urgency === 'thisMonth' ? 'border-red-200' :
                        urgency === 'nextMonth' ? 'border-orange-200' :
                        'border-slate-200'
                      )}>
                        <div className={'px-4 py-2 flex items-center justify-between ' + (
                          urgency === 'overdue' ? 'bg-red-500 text-white' :
                          urgency === 'thisMonth' ? 'bg-red-50 border-b border-red-100' :
                          urgency === 'nextMonth' ? 'bg-orange-50 border-b border-orange-100' :
                          'bg-slate-50 border-b border-slate-100'
                        )}>
                          <span className={'text-xs font-bold ' + (
                            urgency === 'overdue' ? 'text-white' :
                            urgency === 'thisMonth' ? 'text-red-600' :
                            urgency === 'nextMonth' ? 'text-orange-600' :
                            'text-slate-500'
                          )}>
                            {urgency === 'overdue' ? '已过期' :
                             urgency === 'thisMonth' ? '本月到期' :
                             urgency === 'nextMonth' ? '下月到期' :
                             daysLeft + '天后到期'}
                          </span>
                          <span className={'text-xs font-medium px-2 py-0.5 rounded-full ' + (
                            t.status === 'Active' ? 'bg-emerald-100 text-emerald-700' :
                            t.status === 'Expiring' ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-600'
                          )}>{contractStatusTextMap[t.status]}</span>
                        </div>

                        <div className="p-4">
                          <h4 className="font-bold text-slate-800 text-base mb-1 truncate">{t.name}</h4>
                          <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                            <BuildingIcon size={12} />
                            <span>{building?.name || t.buildingId}</span>
                            {mainUnit && <><span>·</span><span>{mainUnit.name}</span></>}
                            {unitIds.length > 1 && <span className="text-slate-400">+{unitIds.length - 1}</span>}
                          </div>

                          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-slate-400">到期日期</div>
                              <div className={'font-bold ' + (
                                urgency === 'overdue' ? 'text-red-600' :
                                urgency === 'thisMonth' ? 'text-red-500' :
                                'text-slate-700'
                              )}>{t.leaseEnd}</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-slate-400">月租金</div>
                              <div className="font-bold text-slate-700">¥{(t.monthlyRent || 0).toLocaleString()}</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-slate-400">面积</div>
                              <div className="font-bold text-slate-700">{t.totalArea || 0}㎡</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-slate-400">付款周期</div>
                              <div className="font-bold text-slate-700 truncate">{paymentCycleLabelMap[t.paymentCycle] || t.paymentCycle}</div>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleRenewal(t)}
                              className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1"
                            >
                              <FileText size={14} /> 续约
                            </button>
                            <button
                              type="button"
                              onClick={() => initiateTermination(t.id)}
                              className="flex-1 py-2 bg-white border border-red-300 text-red-600 rounded-lg text-sm font-bold hover:bg-red-50 transition-colors flex items-center justify-center gap-1"
                            >
                              <XCircle size={14} /> 退租
                            </button>
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
            setShowTerminateModal(false);
            setTerminateId(null);
          };

          return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
             <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-lg border border-slate-200 animate-in zoom-in-50 duration-200 max-h-[90vh] overflow-y-auto">
                <h3 className="font-bold text-lg mb-4 text-slate-800">办理退租</h3>
                <div className="space-y-4">
                    <div><label className="block text-sm text-slate-600 mb-1">退租日期</label><input type="date" value={terminateData.date} onChange={e => setTerminateData({...terminateData, date: e.target.value})} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-amber-100 outline-none" /></div>
                    <div><label className="block text-sm text-slate-600 mb-1">退租类型</label><select value={terminateData.type} onChange={e => setTerminateData({...terminateData, type: e.target.value as 'Normal' | 'Early'})} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-amber-100 outline-none"><option value="Normal">正常到期退租</option><option value="Early">提前违约退租</option></select></div>
                    <div><label className="block text-sm text-slate-600 mb-1">退租原因</label><select value={terminateData.reason} onChange={e => setTerminateData({...terminateData, reason: e.target.value})} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-amber-100 outline-none"><option value="">请选择原因...</option><option value="合同到期不续约">合同到期不续约</option><option value="由于规模扩张搬迁">由于规模扩张搬迁</option><option value="业务收缩搬迁">业务收缩搬迁</option><option value="经营困难结业">经营困难结业</option><option value="物业环境/服务问题">物业环境/服务问题</option><option value="其他原因">其他原因</option></select></div>

                    {/* 房源多选（仅多房源合同时显示） */}
                    {hasMultipleUnits && (
                      <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                        <label className="block text-sm font-medium text-slate-700">退租房源（多选）</label>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {allUnitIds.map((uid) => {
                            const u = getUnitInfo(uid);
                            const term = base?.unitTerms?.find(t => t.unitId === uid);
                            const unitName = term?.unitName || u?.name || uid;
                            const unitArea = term?.area || u?.area || 0;
                            const unitRent = term?.monthlyRent || 0;
                            const checked = terminateData.selectedUnitIds.includes(uid);
                            return (
                              <label key={uid} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer border ${checked ? 'border-amber-300 bg-amber-50' : 'border-slate-100 hover:bg-slate-50'}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = checked
                                      ? terminateData.selectedUnitIds.filter(id => id !== uid)
                                      : [...terminateData.selectedUnitIds, uid];
                                    setTerminateData({ ...terminateData, selectedUnitIds: next });
                                  }}
                                  className="w-4 h-4 text-amber-600 rounded"
                                />
                                <span className="flex-1 text-sm">{unitName}</span>
                                <span className="text-xs text-slate-400">{unitArea}㎡</span>
                                <span className="text-xs text-slate-400">¥{unitRent.toLocaleString()}/月</span>
                              </label>
                            );
                          })}
                        </div>
                        {terminateData.selectedUnitIds.length === 0 ? (
                          <p className="text-xs text-rose-500">请至少选择一个房源</p>
                        ) : terminateData.selectedUnitIds.length < allUnitIds.length ? (
                          <p className="text-xs text-amber-600">仅退租 {terminateData.selectedUnitIds.length}/{allUnitIds.length} 个房源，剩余 {allUnitIds.length - terminateData.selectedUnitIds.length} 个房源继续履约</p>
                        ) : (
                          <p className="text-xs text-slate-400">已选全部房源（整单退租）</p>
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
                            <div className="space-y-2 pt-2 border-t border-slate-100">
                                <p className="text-xs font-bold text-slate-700">
                                    提前退租 — 租金按原收款计划；免租扣回/押金/其它调整在退租日单独一行
                                </p>
                                <div className="grid grid-cols-1 gap-2">
                                    <div>
                                        <label className="block text-[11px] text-slate-500 mb-0.5">免租扣回覆盖（元，可选）</label>
                                        <input
                                            type="number"
                                            className="w-full p-2 border rounded-lg text-sm"
                                            placeholder={`公式试算 ¥${formula.toLocaleString()}`}
                                            value={terminateData.frClawbackOverride}
                                            onChange={(e) => setTerminateData({ ...terminateData, frClawbackOverride: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] text-slate-500 mb-0.5">押金扣款（元）</label>
                                        <input
                                            type="number"
                                            min={0}
                                            className="w-full p-2 border rounded-lg text-sm"
                                            value={terminateData.depositDeduction}
                                            onChange={(e) => setTerminateData({ ...terminateData, depositDeduction: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] text-slate-500 mb-0.5">最后应收调整（元，可负）</label>
                                        <input
                                            type="number"
                                            className="w-full p-2 border rounded-lg text-sm"
                                            value={terminateData.otherAdjustment}
                                            onChange={(e) => setTerminateData({ ...terminateData, otherAdjustment: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-100">
                                    {useOverride
                                        ? `免租扣回将使用手工金额 ¥${Number(terminateData.frClawbackOverride).toLocaleString()}`
                                        : `免租扣回将使用公式金额 ¥${formula.toLocaleString()}`}
                                </div>
                            </div>
                        );
                    })()}
                    <div className="flex justify-end gap-2 mt-6">
                        <button type="button" onClick={() => { setShowTerminateModal(false); setTerminateId(null); }} className="px-4 py-2 text-slate-600">取消</button>
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
                                setShowTerminateModal(false);
                                setTerminateId(null);
                            }}
                            className={`px-6 py-2 text-white rounded-lg font-bold ${terminateData.selectedUnitIds.length === 0 ? 'bg-slate-300 cursor-not-allowed' : 'bg-amber-600'}`}
                        >
                            确认退租
                        </button>
                    </div>
                </div>
             </div>
          </div>
          );
      })()}

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

      {showImportResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
              <div className="bg-white w-full max-w-3xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-in zoom-in-50 duration-200">
                  <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
                      <div className="font-bold text-slate-800">批量导入结果</div>
                      <button onClick={() => setShowImportResult(false)} className="p-2 rounded-lg hover:bg-white text-slate-500"><X size={18}/></button>
                  </div>
                  <div className="p-4 space-y-3">
                      {importSummary && (
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                              <div className="p-3 rounded-lg border bg-white"><div className="text-xs text-slate-500">总行数</div><div className="font-black text-slate-800">{importSummary.total}</div></div>
                              <div className="p-3 rounded-lg border bg-white"><div className="text-xs text-slate-500">成功</div><div className="font-black text-emerald-700">{importSummary.success}</div></div>
                              <div className="p-3 rounded-lg border bg-white"><div className="text-xs text-slate-500">更新</div><div className="font-black text-blue-700">{importSummary.updated}</div></div>
                              <div className="p-3 rounded-lg border bg-white"><div className="text-xs text-slate-500">新增</div><div className="font-black text-indigo-700">{importSummary.created}</div></div>
                              <div className="p-3 rounded-lg border bg-white"><div className="text-xs text-slate-500">失败</div><div className="font-black text-rose-700">{importSummary.failed}</div></div>
                          </div>
                      )}

                      {importErrors.length > 0 ? (
                          <div className="border rounded-xl overflow-hidden">
                              <div className="flex items-center justify-between p-3 bg-rose-50 border-b">
                                  <div className="text-sm font-bold text-rose-800">失败明细（显示前 20 条）</div>
                                  <button onClick={handleImportErrorsExport} className="text-xs font-bold text-rose-700 hover:underline">下载失败明细</button>
                              </div>
                              <div className="max-h-64 overflow-y-auto">
                                  <table className="w-full text-xs">
                                      <thead className="bg-slate-50 text-slate-500">
                                          <tr>
                                              <th className="px-3 py-2 text-left">行号</th>
                                              <th className="px-3 py-2 text-left">原因</th>
                                              <th className="px-3 py-2 text-left">企业</th>
                                              <th className="px-3 py-2 text-left">资产</th>
                                              <th className="px-3 py-2 text-left">房号</th>
                                          </tr>
                                      </thead>
                                      <tbody className="divide-y">
                                          {importErrors.slice(0, 20).map((e, i) => (
                                              <tr key={i} className="hover:bg-slate-50">
                                                  <td className="px-3 py-2">{e.row}</td>
                                                  <td className="px-3 py-2 text-rose-700 font-medium">{e.reason}</td>
                                                  <td className="px-3 py-2">{String(e.data['企业名称'] || e.data.name || '')}</td>
                                                  <td className="px-3 py-2">{String(e.data['所属资产'] || e.data['楼宇'] || e.data.buildingName || '')}</td>
                                                  <td className="px-3 py-2">{String(e.data['房号'] || e.data.unitNames || '')}</td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              </div>
                          </div>
                      ) : (
                          <div className="text-sm text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 p-3 rounded-xl">
                              全部导入成功。
                          </div>
                      )}
                  </div>
                  <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
                      <button onClick={() => setShowImportResult(false)} className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 font-medium">关闭</button>
                  </div>
              </div>
          </div>
      )}

      {/* 名称变更弹窗 */}
      {showNameChange && nameChangeTenantId && (() => {
        const t = tenants.find(x => x.id === nameChangeTenantId);
        if (!t) return null;
        return <NameChangeDialog tenant={t} onConfirm={handleNameChangeConfirm} onClose={() => { setShowNameChange(false); setNameChangeTenantId(null); }} />;
      })()}

      {/* 付款周期变更弹窗 */}
      {showCycleChange && currentTenant.id && (
        <PaymentCycleChangeDialog tenant={currentTenant as Tenant} onConfirm={handleCycleChangeConfirm} onClose={() => setShowCycleChange(false)} />
      )}
    </div>
  );
};
