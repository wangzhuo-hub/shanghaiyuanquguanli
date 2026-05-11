
import React, { useRef, useState, useMemo, useEffect } from 'react';
import { Building, Tenant, Unit, BudgetAssumption, ContractStatus, UnitStatus, DepositStatus, BudgetAdjustment, BudgetAnalysisData, PaymentRecord, BudgetScenario, RentFreePeriod, MonthlyInitData, DashboardData } from '../types';
import type ExcelJS from 'exceljs';
import { Calculator, DollarSign, TrendingUp, Save, Table, LayoutList, ChevronRight, ChevronDown, ChevronLeft, Download, Upload, ShieldAlert, ArrowRight, Maximize2, Minimize2, LineChart as LineChartIcon, Lightbulb, Edit3, X, Sparkles, PieChart, Activity, RotateCcw, TrendingDown, ArrowUpRight, ArrowDownRight, ArrowLeftRight, History, FileText, Info, FileWarning, Layers, Building as BuildingIcon, CheckCircle2, Copy, CloudUpload, Play, Trash2, Plus, Check, FileSpreadsheet, ArrowUpDown, List, AlertCircle, User, Briefcase, CheckCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { analyzeBudget } from '../services/geminiService';
import { generateBudgetedBills } from '../services/billingService';
import { ContractSummaryModal } from './ContractSummaryModal';
import { formatArea, formatCurrency, formatNumber, formatPercent, formatWan } from '../services/numberFormat';
import {
    parseBudgetTableExcel,
    mergeBudgetTotalsIntoInitData,
    readImportedBudgetTable,
    writeImportedBudgetTable,
    clearImportedBudgetTable,
    importedBudgetRowKey,
    normalizeBudgetRowKeyPart,
    readBudgetCustomerNameLinks,
    type ParsedBudgetTable,
    type BudgetTableSnapshot,
} from '../services/budgetTableImport';
import { receivableBudgetMonthForBill } from '../services/receivableListHelpers';
import {
    monthOverlapsRentFree,
    formatYearRentFreeSummary,
    compareUnitNameNumeric,
    tenantUnitsResolved,
    tenantMergedRoomLabels,
    paymentCycleLabelMap,
    paymentCycleLabel,
} from '../services/sharedUtils';

function yearRentFreeMonthFlags(year: number, periods: RentFreePeriod[] | undefined): boolean[] {
    return Array.from({ length: 12 }, (_, m) => monthOverlapsRentFree(year, m, periods || []));
}

function leaseEndCalendarQuarter(date: Date): 1 | 2 | 3 | 4 {
    const m = date.getMonth();
    return (Math.floor(m / 3) + 1) as 1 | 2 | 3 | 4;
}

function quarterLabelCn(q: 1 | 2 | 3 | 4): string {
    const ranges: Record<number, string> = { 1: '1–3 月', 2: '4–6 月', 3: '7–9 月', 4: '10–12 月' };
    return `第 ${q} 季度（${ranges[q]}）`;
}

function tenantSortRoomKey(t: Tenant, building: Building | undefined): string {
    const units = tenantUnitsResolved(t, building);
    if (!units.length) return '';
    const sorted = [...units].sort((a, b) => {
        if (a.floor !== b.floor) return a.floor - b.floor;
        return compareUnitNameNumeric(a.name, b.name);
    });
    return sorted[0]?.name || '';
}

function tenantGroupFloor(t: Tenant, building: Building | undefined): number {
    const units = tenantUnitsResolved(t, building);
    if (!units.length) return 0;
    return Math.min(...units.map((u) => u.floor));
}

const paymentCycleOrderMap: Record<Tenant['paymentCycle'], number> = {
    HalfMonthly: 0,
    Monthly: 1,
    BiMonthly: 2,
    Quarterly: 3,
    SemiAnnual: 4,
    Annual: 5,
    Custom: 6,
};

function paymentCycleOrder(cycle: Tenant['paymentCycle'] | undefined): number {
    return paymentCycleOrderMap[cycle || 'Quarterly'] ?? 3;
}

function parsePaymentPeriods(periodRaw?: string): string[] {
    if (!periodRaw) return [];
    return Array.from(new Set(
        periodRaw
            .split(/[,\n;，；\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .filter((s) => /^\d{4}-\d{2}$/.test(s))
    ));
}

function paymentAllocatedAmountForPeriod(p: PaymentRecord, periodYYYYMM: string): number {
    const periods = parsePaymentPeriods(p.period);
    if (periods.length === 0) {
        return p.date?.startsWith(periodYYYYMM) ? p.amount : 0;
    }
    if (!periods.includes(periodYYYYMM)) return 0;
    return p.amount / periods.length;
}

function paymentMatchesTenant(p: PaymentRecord, tenant: Tenant, allTenants: Tenant[]): boolean {
    if (p.tenantId === tenant.id) return true;
    const paymentTenant = allTenants.find((t) => t.id === p.tenantId);
    if (paymentTenant) {
        const paymentRoot = paymentTenant.rootId || paymentTenant.id;
        const tenantRoot = tenant.rootId || tenant.id;
        if (paymentRoot === tenantRoot) return true;
        if (normalizeBudgetRowKeyPart(paymentTenant.name) === normalizeBudgetRowKeyPart(tenant.name)) return true;
    }
    return normalizeBudgetRowKeyPart(p.tenantName) === normalizeBudgetRowKeyPart(tenant.name);
}

function actualRentCollectionForTenantPeriod(
    payments: PaymentRecord[],
    tenant: Tenant,
    allTenants: Tenant[],
    periodYYYYMM: string
): number {
    return payments
        .filter((p) => (p.type === 'Rent' || p.type === 'DepositToRent') && paymentMatchesTenant(p, tenant, allTenants))
        .reduce((sum, p) => sum + paymentAllocatedAmountForPeriod(p, periodYYYYMM), 0);
}

/** 有人工预算调整记录的单元格：底色 + 小字颜色 */
function budgetAdjustmentCellStyle(val: {
    isAdjustedIn?: boolean;
    isAdjustedOut?: boolean;
    adjustmentDetail?: string;
}): { shell: string; noteClass: string } {
    const detail = (val.adjustmentDetail || '').trim();
    const touched = !!(detail || val.isAdjustedOut || val.isAdjustedIn);
    if (!touched) return { shell: '', noteClass: '' };
    if (val.isAdjustedOut) {
        return {
            shell: 'bg-orange-100/95 shadow-[inset_0_0_0_1px_rgba(234,88,12,0.35)]',
            noteClass: 'text-orange-900/90',
        };
    }
    if (val.isAdjustedIn) {
        return {
            shell: 'bg-violet-100/95 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.4)]',
            noteClass: 'text-violet-900/90',
        };
    }
    return {
        shell: 'bg-teal-50/95 shadow-[inset_0_0_0_1px_rgba(20,184,166,0.4)]',
        noteClass: 'text-teal-900/90',
    };
}

interface BudgetManagerProps {
  buildings: Building[];
  tenants: Tenant[];
  budgetAssumptions: BudgetAssumption[];
  budgetAdjustments: BudgetAdjustment[];
  budgetAnalysis: BudgetAnalysisData;
  onUpdateAssumptions: (assumptions: BudgetAssumption[]) => void;
  onUpdateAdjustments: (adjustments: BudgetAdjustment[]) => void;
  onUpdateAnalysis: (analysis: BudgetAnalysisData) => void;
  payments: PaymentRecord[];
  
  scenarios: BudgetScenario[];
  onUpdateScenarios: (scenarios: BudgetScenario[]) => void;
  onActivateScenario: (scenario: BudgetScenario) => void;
  onSaveBudgetToCloud: (name: string, operator: string) => void;
  onRenameScenario: (id: string, newName: string) => void;
  initializationData?: MonthlyInitData[];
  /** 用于持久化已导入预算表（`__budget_table_<year>__` 键） */
  billingPeriodNotes?: Record<string, string>;
  /** 预算表 Excel 导入后批量更新（至少包含 initializationData） */
  onBatchUpdate?: (updates: Partial<DashboardData>) => void;
}

export const BudgetManager: React.FC<BudgetManagerProps> = ({ 
    buildings: propBuildings, 
    tenants: propTenants, 
    budgetAssumptions: propAssumptions, 
    onUpdateAssumptions, 
    budgetAdjustments: propAdjustments, 
    onUpdateAdjustments, 
    budgetAnalysis, 
    onUpdateAnalysis, 
    payments,
    scenarios,
    onUpdateScenarios,
    onActivateScenario,
    onSaveBudgetToCloud,
    onRenameScenario,
    initializationData,
    billingPeriodNotes,
    onBatchUpdate,
}) => {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  
  const [activeScenarioId, setActiveScenarioId] = useState<string>('current');
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState('');
  const [newScenarioDesc, setNewScenarioDesc] = useState('');
  const [newScenarioYear, setNewScenarioYear] = useState(currentYear);
  const [scenarioYearFilter, setScenarioYearFilter] = useState(currentYear);
  const [useSnapshot, setUseSnapshot] = useState(true);
  
  const [isRenaming, setIsRenaming] = useState(false);
  const [tempScenarioName, setTempScenarioName] = useState('');

  const [showCloudModal, setShowCloudModal] = useState(false);
  const [operatorName, setOperatorName] = useState('');

  const [activeTab, setActiveTab] = useState<'Vacancy' | 'Renewal' | 'Risk' | 'Existing'>('Vacancy');
  const [viewMode, setViewMode] = useState<'Settings' | 'Monthly' | 'Execution'>('Settings');
  const [detailYear, setDetailYear] = useState<number>(currentYear);
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  const [sortMethod, setSortMethod] = useState<'Category' | 'Building' | 'PaymentCycle'>('Category');
  
  /** 预算表明细行：点击客户名查看合同概要 */
  const [contractSummaryRow, setContractSummaryRow] = useState<any | null>(null);

  /** 预算表分组折叠（按类别 / 楼宇 / 账期）；切换年份或排序时清空 */
  const [collapsedBudgetGroups, setCollapsedBudgetGroups] = useState<Set<string>>(() => new Set());

  // 预算表 Excel 导入
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importPreview, setImportPreview] = useState<ParsedBudgetTable | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handlePickBudgetExcel = () => {
      if (!onBatchUpdate) {
          alert('当前页面不支持写入预算数据，请联系管理员。');
          return;
      }
      importInputRef.current?.click();
  };

  const handleBudgetExcelChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setIsImporting(true);
      try {
          const buffer = await file.arrayBuffer();
          const parsed = await parseBudgetTableExcel(buffer);
          setImportPreview(parsed);
      } catch (err: any) {
          alert(`解析预算表失败：${err?.message || '未知错误'}`);
      } finally {
          setIsImporting(false);
      }
  };

  const confirmApplyImportedBudget = () => {
      if (!importPreview || !onBatchUpdate) return;
      const merged = mergeBudgetTotalsIntoInitData(
          initializationData,
          importPreview.year,
          importPreview.monthlyTotals
      );
      const snapshot: BudgetTableSnapshot = {
          importedAt: new Date().toISOString(),
          sourceSheet: importPreview.sheetName,
          rows: importPreview.rows,
          monthlyTotals: importPreview.monthlyTotals,
          annualTotal: importPreview.annualTotal,
      };
      const nextNotes = writeImportedBudgetTable(billingPeriodNotes, importPreview.year, snapshot);
      onBatchUpdate({
          initializationData: merged,
          billingPeriodNotes: nextNotes,
      });
      const sumWan = (importPreview.annualTotal / 10000).toFixed(2);
      alert(
          `✅ 已导入 ${importPreview.year} 年度预算（共 ${importPreview.rows.length} 行明细，合计 ${sumWan} 万元）。\n\n` +
          `· 月度合计已写入「预算执行」目标列\n` +
          `· 完整明细已写入存档（pb_billing_period_notes）\n\n` +
          `请点击右上角「保存」按钮写入后端。`
      );
      setImportPreview(null);
  };

  /** 清除指定年份的导入预算表（同时移除月度目标值） */
  const handleClearImportedBudget = (year: number) => {
      if (!onBatchUpdate) return;
      if (!window.confirm(`确认清除 ${year} 年的导入预算表？\n\n这将同时移除「预算执行」中本年度月度目标的导入值（其他字段如累计实收/在租率不受影响）。`)) {
          return;
      }
      const nextNotes = clearImportedBudgetTable(billingPeriodNotes, year);
      // 月度目标置零（保留 month/year/其他字段），与导入前对称
      const merged = mergeBudgetTotalsIntoInitData(initializationData, year, new Array(12).fill(0));
      onBatchUpdate({
          initializationData: merged,
          billingPeriodNotes: nextNotes,
      });
      alert(`已清除 ${year} 年导入预算表。请点击右上角「保存」写入后端。`);
  };

  /** 当前 detailYear 是否存在已导入预算表 */
  const importedBudgetForDetailYear = useMemo<BudgetTableSnapshot | null>(() => {
      return readImportedBudgetTable(billingPeriodNotes, detailYear);
  }, [billingPeriodNotes, detailYear]);

  // 仅在切换年份时自动定位到生效方案；编辑假设内容时不跳转
  const prevYearFilter = React.useRef(scenarioYearFilter);
  useEffect(() => {
      if (prevYearFilter.current === scenarioYearFilter) return;
      prevYearFilter.current = scenarioYearFilter;
      const active = scenarios.find(s => s.isActive && (s.budgetYear || currentYear) === scenarioYearFilter);
      if (active) {
          setActiveScenarioId(active.id);
      } else {
          setActiveScenarioId('current');
      }
  }, [scenarioYearFilter]); // 不依赖 scenarios，避免每次编辑都触发跳转

  useEffect(() => {
      if (String(activeScenarioId).startsWith('invoice_dedicated_')) {
          setActiveScenarioId('current');
      }
  }, [activeScenarioId]);

  useEffect(() => {
      setCollapsedBudgetGroups(new Set());
  }, [detailYear, sortMethod]);

  const toggleBudgetGroupCollapse = (groupName: string) => {
      setCollapsedBudgetGroups((prev) => {
          const next = new Set(prev);
          if (next.has(groupName)) next.delete(groupName);
          else next.add(groupName);
          return next;
      });
  };

  const effectiveData = useMemo(() => {
      if (activeScenarioId === 'current') {
          return {
              buildings: propBuildings,
              tenants: propTenants,
              assumptions: propAssumptions,
              adjustments: propAdjustments
          };
      }
      
      const scenario = scenarios.find(s => s.id === activeScenarioId);
      if (!scenario) return {
          buildings: propBuildings,
          tenants: propTenants,
          assumptions: propAssumptions,
          adjustments: propAdjustments
      };

      return {
          buildings: scenario.baseDataSnapshot?.buildings || propBuildings,
          tenants: scenario.baseDataSnapshot?.tenants || propTenants,
          assumptions: scenario.assumptions,
          adjustments: scenario.adjustments
      };
  }, [activeScenarioId, scenarios, propBuildings, propTenants, propAssumptions, propAdjustments]);

  const { buildings, tenants, assumptions: budgetAssumptions, adjustments: budgetAdjustments } = effectiveData;

  const contractSummaryModalPayload = useMemo(() => {
      if (!contractSummaryRow) return null;
      if (contractSummaryRow.name === '待租单元') {
          return {
              detailYear,
              content: {
                  kind: 'vacant' as const,
                  building: contractSummaryRow.building,
                  unitNames: contractSummaryRow.unitNames,
                  leaseStart: contractSummaryRow.leaseStart,
                  area: contractSummaryRow.area,
                  unitPrice: contractSummaryRow.unitPrice,
                  rentFreeYearSummary: contractSummaryRow.rentFreeYearSummary,
                  paymentCycleLabel: contractSummaryRow.paymentCycleLabel,
              },
          };
      }
      const t = tenants.find((x) => x.id === contractSummaryRow.id);
      if (!t) return { detailYear, content: { kind: 'missing' as const } };
      return {
          detailYear,
          content: {
              kind: 'tenant' as const,
              tenant: t,
              buildingLabel: contractSummaryRow.building,
              unitNamesLabel: contractSummaryRow.unitNames,
          },
      };
  }, [contractSummaryRow, tenants, detailYear]);

  const handleUpdateAssumptions = (newAssumptions: BudgetAssumption[]) => {
      if (activeScenarioId === 'current') {
          onUpdateAssumptions(newAssumptions);
      } else {
          const updatedScenarios = scenarios.map(s => 
              s.id === activeScenarioId ? { ...s, assumptions: newAssumptions } : s
          );
          onUpdateScenarios(updatedScenarios);
      }
  };

  const handleUpdateAdjustments = (newAdjustments: BudgetAdjustment[]) => {
      if (activeScenarioId === 'current') {
          onUpdateAdjustments(newAdjustments);
      } else {
          const updatedScenarios = scenarios.map(s => 
              s.id === activeScenarioId ? { ...s, adjustments: newAdjustments } : s
          );
          onUpdateScenarios(updatedScenarios);
      }
  };

  const handleCreateScenario = () => {
      const trimmedName = newScenarioName.trim();
      if (!trimmedName) { alert("请输入方案名称"); return; }
      if (trimmedName.length < 2) { alert("方案名称至少需要2个字符"); return; }
      if (/^\d+$/.test(trimmedName)) { alert("方案名称不能为纯数字"); return; }
      const newScenario: BudgetScenario = {
          id: `scenario_${Date.now()}`, name: newScenarioName, budgetYear: newScenarioYear, description: newScenarioDesc, createdAt: new Date().toISOString(), isActive: false,
          assumptions: [], adjustments: [],
          baseDataSnapshot: useSnapshot ? { tenants: JSON.parse(JSON.stringify(propTenants)), buildings: JSON.parse(JSON.stringify(propBuildings)) } : undefined
      };
      onUpdateScenarios([...scenarios, newScenario]); setScenarioYearFilter(newScenarioYear); setActiveScenarioId(newScenario.id); setShowScenarioModal(false); setNewScenarioName(''); setNewScenarioDesc('');
  };
  const handleDeleteScenario = (id: string) => {
      if (String(id).startsWith('invoice_dedicated_')) {
          alert('系统常驻的应收专用方案不支持删除。');
          return;
      }
      if(window.confirm("确定删除此预算方案吗？")) {
          const newScenarios = scenarios.filter(s => s.id !== id);
          onUpdateScenarios(newScenarios);
          if (activeScenarioId === id) setActiveScenarioId('current');
      }
  };
  const startRenaming = () => { const scenario = scenarios.find(s => s.id === activeScenarioId); if (scenario) { setTempScenarioName(scenario.name); setIsRenaming(true); } };
  const saveRenaming = () => { if (tempScenarioName.trim()) { onRenameScenario(activeScenarioId, tempScenarioName); } setIsRenaming(false); };
  const handleActivateCurrentScenario = () => { const scenario = scenarios.find(s => s.id === activeScenarioId); if (scenario) { onActivateScenario(scenario); } };
  const handleSetReceivableScenario = () => {
      const scenario = scenarios.find((s) => s.id === activeScenarioId);
      if (!scenario) return;
      const updated = scenarios.map((s) => {
          if ((s.budgetYear || currentYear) !== (scenario.budgetYear || currentYear)) return s;
          return { ...s, isReceivableActive: s.id === scenario.id };
      });
      onUpdateScenarios(updated);
  };
  const confirmCloudSave = () => {
    if (!operatorName) return;
    const scenario = scenarios.find(s => s.id === activeScenarioId);
    if (scenario && !scenario.assumptions?.length && !scenario.adjustments?.length) {
      alert('当前方案没有预算假设数据，请先生成预算假设再保存。');
      return;
    }
    const scenarioName = activeScenarioId === 'current' ? '年初预算方案' : scenario?.name || '未命名方案';
    onSaveBudgetToCloud(scenarioName, operatorName); setShowCloudModal(false);
  };

  const activeTenants = useMemo(() => tenants.filter(t => t.status === ContractStatus.Active || t.status === ContractStatus.Expiring || t.status === ContractStatus.Pending), [tenants]);
  const expiringTenants = useMemo(
      () =>
          tenants.filter((t) => {
              const endYear = new Date(t.leaseEnd).getFullYear();
              return (endYear === currentYear || endYear === nextYear) && t.status !== ContractStatus.Terminated;
          }),
      [tenants, currentYear, nextYear]
  );

  const renewalGroupedByYearQuarter = useMemo(() => {
      const byYear = new Map<number, Map<number, Tenant[]>>();
      for (const t of expiringTenants) {
          const d = new Date(t.leaseEnd);
          if (Number.isNaN(d.getTime())) continue;
          const y = d.getFullYear();
          const q = leaseEndCalendarQuarter(d);
          if (!byYear.has(y)) byYear.set(y, new Map());
          const byQ = byYear.get(y)!;
          if (!byQ.has(q)) byQ.set(q, []);
          byQ.get(q)!.push(t);
      }
      const years = Array.from(byYear.keys()).sort((a, b) => a - b);
      return years
          .map((year) => {
              const quarterMap = byYear.get(year)!;
              const quarters = ([1, 2, 3, 4] as const)
                  .map((q) => ({
                      quarter: q,
                      label: quarterLabelCn(q),
                      tenants: (quarterMap.get(q) || []).slice().sort((a, b) => new Date(a.leaseEnd).getTime() - new Date(b.leaseEnd).getTime()),
                  }))
                  .filter((block) => block.tenants.length > 0);
              return { year, quarters };
          })
          .filter((yBlock) => yBlock.quarters.length > 0);
  }, [expiringTenants]);

  const vacantUnits = useMemo(() => {
    const list: { unitId: string; unitName: string; buildingName: string; buildingId: string; floor: number; area: number }[] = [];
    buildings.forEach(b => {
      b.units.forEach(u => {
        const isOccupied = tenants.some(t => 
            t.unitIds.includes(u.id) && 
            (t.status === ContractStatus.Active || t.status === ContractStatus.Expiring || t.status === ContractStatus.Pending)
        );
        if (!isOccupied && u.status !== UnitStatus.Occupied && !u.isSelfUse) {
          list.push({ unitId: u.id, unitName: u.name, buildingName: b.name, buildingId: b.id, floor: u.floor, area: u.area });
        }
      });
    });
    return list;
  }, [buildings, tenants]);

  const vacantUnitsGrouped = useMemo(() => {
      const byBuilding = new Map<string, typeof vacantUnits>();
      vacantUnits.forEach((u) => {
          if (!byBuilding.has(u.buildingId)) byBuilding.set(u.buildingId, []);
          byBuilding.get(u.buildingId)!.push(u);
      });
      return [...buildings]
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
          .map((b) => {
              const units = (byBuilding.get(b.id) || []).slice();
              if (!units.length) return null;
              const byFloor = new Map<number, typeof vacantUnits>();
              units.forEach((u) => {
                  if (!byFloor.has(u.floor)) byFloor.set(u.floor, []);
                  byFloor.get(u.floor)!.push(u);
              });
              const floors = Array.from(byFloor.keys()).sort((a, b) => a - b);
              return {
                  building: b,
                  count: units.length,
                  floors: floors.map((fl) => ({
                      floor: fl,
                      units: (byFloor.get(fl) || []).slice().sort((a, b) => compareUnitNameNumeric(a.unitName, b.unitName)),
                  })),
              };
          })
          .filter((g): g is NonNullable<typeof g> => g != null);
  }, [vacantUnits, buildings]);

  const existingTenantsGrouped = useMemo(() => {
      const buildingById = new Map(buildings.map((b) => [b.id, b] as const));
      const cellMap = new Map<string, Map<number, Tenant[]>>();
      const orphans: Tenant[] = [];

      for (const t of activeTenants) {
          const b = buildingById.get(t.buildingId);
          if (!b) {
              orphans.push(t);
              continue;
          }
          const floor = tenantGroupFloor(t, b);
          if (!cellMap.has(t.buildingId)) cellMap.set(t.buildingId, new Map());
          const fm = cellMap.get(t.buildingId)!;
          if (!fm.has(floor)) fm.set(floor, []);
          fm.get(floor)!.push(t);
      }

      const blocks = [...buildings]
          .filter((b) => cellMap.has(b.id))
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
          .map((b) => {
              const fm = cellMap.get(b.id)!;
              const floors = Array.from(fm.keys()).sort((a, b) => a - b);
              const allHere = floors.flatMap((f) => fm.get(f)!);
              return {
                  building: b,
                  tenantCount: allHere.length,
                  totalArea: allHere.reduce((s, t) => s + t.totalArea, 0),
                  floors: floors.map((fl) => {
                      const list = fm.get(fl)!.slice();
                      list.sort((a, b) => {
                          const ka = tenantSortRoomKey(a, buildingById.get(a.buildingId));
                          const kb = tenantSortRoomKey(b, buildingById.get(b.buildingId));
                          const c = compareUnitNameNumeric(ka, kb);
                          if (c !== 0) return c;
                          return a.name.localeCompare(b.name, 'zh-CN');
                      });
                      return { floor: fl, tenants: list };
                  }),
              };
          });

      if (orphans.length) {
          blocks.push({
              building: { id: '__unknown__', name: '未知楼宇', units: [] } as Building,
              tenantCount: orphans.length,
              totalArea: orphans.reduce((s, t) => s + t.totalArea, 0),
              floors: [
                  {
                      floor: 0,
                      tenants: orphans.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
                  },
              ],
          });
      }
      return blocks;
  }, [activeTenants, buildings]);
  
  const riskTenants = useMemo(() => tenants.filter(t => t.isRisk && t.status === ContractStatus.Active), [tenants]);

  const getAssumption = (targetId: string, type: 'Vacancy' | 'Renewal' | 'RiskTermination' | 'Existing', targetName: string) => {
    const existing = budgetAssumptions.find(a => a.targetId === targetId && a.targetType === type);
    if (existing) return existing;
    return {
      id: `budget_${targetId}_${type}`, targetType: type, targetId: targetId, targetName: targetName,
      strategy: 'Renewal', projectedSignDate: `${nextYear}-01-01`, projectedUnitPrice: 2.5, projectedRentFreeMonths: 0, vacancyGapMonths: 2,
    } as BudgetAssumption;
  };
  
  const updateAssumption = (updated: BudgetAssumption) => { 
      const others = budgetAssumptions.filter(a => a.targetId !== updated.targetId || a.targetType !== updated.targetType); 
      handleUpdateAssumptions([...others, updated]); 
  };

  const generateMonthlyDetail = (year: number): any[] => {
      const rows: any[] = [];
      const billingGenStart = new Date(year - 2, 0, 1);
      const billingGenEnd = new Date(year, 11, 31);
      const addMonths = (dateStr: string, months: number): string => { const d = new Date(dateStr); d.setMonth(d.getMonth() + months); return d.toISOString().split('T')[0]; };
      const formatFloorSummary = (floors: number[]): string => {
          const uniq = Array.from(new Set(floors)).sort((a, b) => a - b);
          if (uniq.length === 0) return '—';
          return uniq.map(f => `${f}F`).join(' / ');
      };

      const selfUseUnitIds = new Set<string>();
      buildings.forEach(b => b.units.forEach(u => { if (u.isSelfUse) selfUseUnitIds.add(u.id); }));

      tenants.forEach(t => {
          if (t.status === ContractStatus.Terminated) return;
          const isSelfUse = t.unitIds.some(uid => selfUseUnitIds.has(uid));
          if (isSelfUse) return;
          // 特殊业态：合同不滚动账单，应收金额由「财务报表 → 特殊业态收入录入」按月手工录入；
          // 预算明细同理不再按合同自动列入。
          if (t.isSpecialBusiness) return;

          const leaseEndYear = new Date(t.leaseEnd).getFullYear();
          const isExpiringThisYear = leaseEndYear === year;
          let category = '存量客户';
          let assumptionType: 'Renewal' | 'RiskTermination' | 'Existing' | null = null;
          
          const riskAsm = budgetAssumptions.find(a => a.targetId === t.id && a.targetType === 'RiskTermination');
          const renewAsm = budgetAssumptions.find(a => a.targetId === t.id && a.targetType === 'Renewal');

          if (t.isRisk && riskAsm) { assumptionType = 'RiskTermination'; category = '高风险退租'; }
          else if (isExpiringThisYear && renewAsm) { 
              assumptionType = 'Renewal'; 
              if (renewAsm.strategy === 'ReLease') category = '到期退租招商'; else category = '续签客户'; 
          }
          else assumptionType = 'Existing';

          const building = buildings.find(b => b.id === t.buildingId);
          const unitNames = t.unitIds.map(uid => building?.units.find(u => u.id === uid)?.name || uid).join(', ');
          const tenantFloors = t.unitIds
              .map(uid => building?.units.find(u => u.id === uid)?.floor)
              .filter((f): f is number => typeof f === 'number');
          const floorSummary = formatFloorSummary(tenantFloors);
          const tenantBills = generateBudgetedBills(t, budgetAssumptions, budgetAdjustments, billingGenStart, billingGenEnd);
          
          // amount and area tracking
          let monthlyValues = Array(12).fill(null).map(() => ({ amount: 0, actual: 0, isAdjustedIn: false, isAdjustedOut: false, adjustmentDetail: '' }));
          let monthlyLeasedArea = Array(12).fill(0);

          // 1. Existing Lease Area & Rent
          for (let m = 0; m < 12; m++) {
              const monthStart = new Date(year, m, 1);
              const monthEnd = new Date(year, m + 1, 0);
              const leaseStart = new Date(t.leaseStart);
              const leaseEnd = t.terminationDate ? new Date(t.terminationDate) : new Date(t.leaseEnd);
              
              if (leaseStart <= monthEnd && leaseEnd >= monthStart) {
                  monthlyLeasedArea[m] = t.totalArea;
              }
          }

          tenantBills.forEach((bill) => {
              const { year: y, monthIndex: m } = receivableBudgetMonthForBill(bill, t);
              if (y === year && m >= 0 && m < 12) monthlyValues[m].amount += bill.amount;
          });

          // ACTUAL DATA CALCULATION FOR TENANT
          // 与财务报表「收款明细」一致：优先按关联账期 period 归属，未填账期才按入账月份归属。
          for (let m = 0; m < 12; m++) {
              const periodYYYYMM = `${year}-${String(m + 1).padStart(2, '0')}`;
              monthlyValues[m].actual += actualRentCollectionForTenantPeriod(payments, t, propTenants, periodYYYYMM);
          }

          // 2. Assumptions Extension
          const assumption = budgetAssumptions.find(a => a.targetId === t.id && a.targetType === assumptionType);
          if (assumption && assumptionType !== 'Existing') {
             let newStart: Date | null = null;
             if (assumption.targetType === 'Renewal' && assumption.strategy !== 'ReLease') { const le = new Date(t.leaseEnd); le.setDate(le.getDate() + 1); newStart = le; } 
             else if (assumption.strategy === 'ReLease' || assumption.targetType === 'RiskTermination') { const baseDate = assumption.targetType === 'RiskTermination' && assumption.projectedTerminationDate ? new Date(assumption.projectedTerminationDate) : new Date(t.leaseEnd); const gap = assumption.vacancyGapMonths || 0; newStart = new Date(baseDate); newStart.setMonth(newStart.getMonth() + gap); newStart.setDate(newStart.getDate() + 1); }

             if (newStart) {
                 const newStartStr = newStart.toISOString().split('T')[0];
                 const newEnd = new Date(newStart); newEnd.setFullYear(newEnd.getFullYear() + 3); 
                 const firstPayDate = addMonths(newStartStr, assumption.projectedRentFreeMonths || 0);
                 
                 // Extension Area contribution
                 for (let m = 0; m < 12; m++) {
                    const monthStart = new Date(year, m, 1);
                    const monthEnd = new Date(year, m + 1, 0);
                    if (newStart <= monthEnd && newEnd >= monthStart) {
                        monthlyLeasedArea[m] = t.totalArea; 
                    }
                 }

                 const virtualTenant: Tenant = {
                     ...t, id: `virtual_${t.id}`, leaseStart: newStartStr, leaseEnd: newEnd.toISOString().split('T')[0], unitPrice: assumption.projectedUnitPrice, monthlyRent: 0,
                     rentFreePeriods: assumption.projectedRentFreeMonths > 0 ? [{ start: newStartStr, end: new Date(new Date(newStart).setMonth(newStart.getMonth() + assumption.projectedRentFreeMonths)).toISOString().split('T')[0], description: 'Assumption Rent Free' }] : [],
                     firstPaymentDate: firstPayDate, freeRentHandling: 'Defer'
                 };
                 const virtualBills = generateBudgetedBills(virtualTenant, [], [], billingGenStart, billingGenEnd);
                 virtualBills.forEach((bill) => {
                     const { year: y, monthIndex: m } = receivableBudgetMonthForBill(bill, virtualTenant);
                     if (y === year && m >= 0 && m < 12) monthlyValues[m].amount += bill.amount;
                 });
             }
          }

          budgetAdjustments.forEach((adj) => {
              if (adj.tenantId !== t.id) return;
              const isAmt = adj.adjustmentKind === 'amount_delta' || (adj.originalYear === -1 && adj.originalMonth === -1);
              if (isAmt) {
                  if (adj.adjustedYear === year) {
                      const m = adj.adjustedMonth;
                      if (m >= 0 && m < 12) {
                          const tag = `金额 Δ ${adj.amount >= 0 ? '+' : ''}${formatCurrency(adj.amount)}`;
                          monthlyValues[m].adjustmentDetail = monthlyValues[m].adjustmentDetail
                              ? `${monthlyValues[m].adjustmentDetail} | ${tag}`
                              : tag;
                      }
                  }
                  return;
              }
              if (adj.originalYear === year) {
                  const m = adj.originalMonth;
                  if (m >= 0 && m < 12) {
                      // 账期调出后，原账期预算额应清零，避免继续参与合计
                      monthlyValues[m].amount = 0;
                      monthlyValues[m].isAdjustedOut = true;
                      monthlyValues[m].adjustmentDetail = `调出 -> ${adj.adjustedYear}年${adj.adjustedMonth + 1}月`;
                  }
              }
              if (adj.adjustedYear === year) {
                  const m = adj.adjustedMonth;
                  if (m >= 0 && m < 12) {
                      monthlyValues[m].isAdjustedIn = true;
                      monthlyValues[m].adjustmentDetail = `调入 <- ${adj.originalYear}年${adj.originalMonth + 1}月 (${adj.reason})`;
                  }
              }
          });

          // 复核：检查预算假设/调整对合同应收的偏离
          const existingAsm = budgetAssumptions.find(a => a.targetId === t.id && a.targetType === 'Existing');
          const tenantAdjustments = budgetAdjustments.filter(a => a.tenantId === t.id);
          const verificationReasons: string[] = [];
          // 整体偏移已迁移到合同，仅检查预算级调价/付款转移
          if (existingAsm?.priceAdjustment?.startDate) verificationReasons.push(`单价调整(${existingAsm.priceAdjustment.newUnitPrice}元/㎡·天)`);
          if (existingAsm?.paymentShift?.isActive) verificationReasons.push(`付款转移 ${existingAsm.paymentShift.fromYear}/${existingAsm.paymentShift.fromMonth+1}→${existingAsm.paymentShift.toYear}/${existingAsm.paymentShift.toMonth+1}`);
          if (t.paymentPeriodShiftMonths) verificationReasons.push(`合同整体偏移 ${t.paymentPeriodShiftMonths > 0 ? '后移' : '前移'}${Math.abs(t.paymentPeriodShiftMonths)}月`);
          if ((t.paymentPeriodAdjustments || []).length > 0) verificationReasons.push(`${t.paymentPeriodAdjustments!.length}笔合同账期调整`);
          if (tenantAdjustments.length > 0) verificationReasons.push(`${tenantAdjustments.length}笔调账`);
          const hasBudgetMods = verificationReasons.length > 0;
          const pureBills = hasBudgetMods
              ? generateBudgetedBills(t, [], [], billingGenStart, billingGenEnd)
              : tenantBills;
          const pureTotal = pureBills.reduce((s, b) => {
              if (b.date.getFullYear() === year) s += b.amount;
              return s;
          }, 0);
          const budgetTotal = tenantBills.reduce((s, b) => {
              if (b.date.getFullYear() === year) s += b.amount;
              return s;
          }, 0);
          const contractDiff = budgetTotal - pureTotal;

          rows.push({
              id: t.id,
              name: t.name,
              building: building?.name || '未知楼宇',
              unitNames,
              floorSummary,
              area: t.totalArea,
              category,
              signingDate: t.signingDate,
              leaseStart: t.leaseStart,
              isNewSigningInYear: !!t.signingDate && new Date(t.signingDate).getFullYear() === year,
              leaseStartMonthInYear: t.leaseStart && new Date(t.leaseStart).getFullYear() === year ? new Date(t.leaseStart).getMonth() : null,
              terminationDate: t.terminationDate,
              isTerminatingInYear: !!t.terminationDate && new Date(t.terminationDate).getFullYear() === year,
              paymentCycle: t.paymentCycle || 'Quarterly',
              paymentCycleLabel: paymentCycleLabel(t.paymentCycle),
              paymentCycleOrder: paymentCycleOrder(t.paymentCycle),
              buildingSort: building?.name || '未知楼宇',
              floorSort: tenantFloors.length > 0 ? Math.min(...tenantFloors) : 9999,
              roomSort: tenantSortRoomKey(t, building) || unitNames,
              monthlyValues,
              monthlyLeasedArea,
              unitPrice: t.unitPrice,
              rentFreeYearSummary: formatYearRentFreeSummary(year, t.rentFreePeriods || []),
              rentFreeMonthFlags: yearRentFreeMonthFlags(year, t.rentFreePeriods || []),
              // 复核字段
              hasBudgetMods,
              isVirtual: false,
              verificationReasons,
              contractDiff,
          });
      });

      vacantUnits.forEach(u => {
          const assumption = budgetAssumptions.find(a => a.targetId === u.unitId && a.targetType === 'Vacancy');
          let monthlyValues = Array(12).fill(null).map(() => ({ amount: 0, actual: 0, isAdjustedIn:false, isAdjustedOut:false, adjustmentDetail:'' }));
          let monthlyLeasedArea = Array(12).fill(0);
          let vacantUnitPrice: number | undefined;
          let vacantRentPeriods: RentFreePeriod[] = [];

          if (assumption && assumption.projectedSignDate) {
             const start = new Date(assumption.projectedSignDate);
             const end = new Date(start); end.setFullYear(end.getFullYear() + 5);
             
             // Vacancy Area contribution
             for (let m = 0; m < 12; m++) {
                const monthStart = new Date(year, m, 1);
                const monthEnd = new Date(year, m + 1, 0);
                if (start <= monthEnd && end >= monthStart) {
                    monthlyLeasedArea[m] = u.area;
                }
             }

             const firstPayDate = addMonths(assumption.projectedSignDate, assumption.projectedRentFreeMonths || 0);
             const virtualTenant: Tenant = {
                 id: u.unitId, name: '待租单元', buildingId: '', unitIds: [u.unitId], totalArea: u.area, leaseStart: assumption.projectedSignDate, leaseEnd: end.toISOString().split('T')[0], unitPrice: assumption.projectedUnitPrice, monthlyRent: 0, paymentCycle: 'Quarterly', paymentCycleMonths: 3, firstPaymentMonths: 3, firstPaymentDate: firstPayDate, depositAmount: 0, depositStatus: DepositStatus.Unpaid, status: ContractStatus.Active,
                 rentFreePeriods: assumption.projectedRentFreeMonths > 0 ? [{ start: assumption.projectedSignDate, end: new Date(new Date(start).setMonth(start.getMonth() + assumption.projectedRentFreeMonths)).toISOString().split('T')[0], description: 'Vacancy Rent Free' }] : [], 
                 freeRentHandling: 'Defer'
             };
             const virtualBills = generateBudgetedBills(virtualTenant, [], budgetAdjustments, billingGenStart, billingGenEnd);
             virtualBills.forEach((bill) => {
                 const { year: y, monthIndex: m } = receivableBudgetMonthForBill(bill, virtualTenant);
                 if (y === year && m >= 0 && m < 12) monthlyValues[m].amount += bill.amount;
             });
             vacantUnitPrice = assumption.projectedUnitPrice;
             vacantRentPeriods = virtualTenant.rentFreePeriods || [];
          }
          const vacantBuilding = buildings.find(b => b.name === u.buildingName);
          const vacantFloor = vacantBuilding?.units.find(x => x.id === u.unitId)?.floor;
          rows.push({
              id: u.unitId,
              name: '待租单元',
              building: u.buildingName,
              unitNames: u.unitName,
              floorSummary: formatFloorSummary([vacantFloor].filter((f): f is number => typeof f === 'number')),
              area: u.area,
              category: '空置去化',
              signingDate: assumption?.projectedSignDate,
              leaseStart: assumption?.projectedSignDate,
              isNewSigningInYear: !!assumption?.projectedSignDate && new Date(assumption.projectedSignDate).getFullYear() === year,
              leaseStartMonthInYear: assumption?.projectedSignDate && new Date(assumption.projectedSignDate).getFullYear() === year ? new Date(assumption.projectedSignDate).getMonth() : null,
              paymentCycle: 'Quarterly',
              paymentCycleLabel: paymentCycleLabel('Quarterly'),
              paymentCycleOrder: paymentCycleOrder('Quarterly'),
              buildingSort: u.buildingName,
              floorSort: typeof vacantFloor === 'number' ? vacantFloor : 9999,
              roomSort: u.unitName,
              monthlyValues,
              monthlyLeasedArea,
              unitPrice: vacantUnitPrice,
              rentFreeYearSummary: formatYearRentFreeSummary(year, vacantRentPeriods),
              rentFreeMonthFlags: yearRentFreeMonthFlags(year, vacantRentPeriods),
          });
      });

      // 若该年度存在已导入预算表，则预算金额优先采用导入明细（客户+房号+楼宇精确匹配）。
      // 这样可避免合同账单口径（账期/免租/调账）与财务预算表口径不一致导致的显示偏差。
      const imported = readImportedBudgetTable(billingPeriodNotes, year);
      if (!imported?.rows?.length) return rows;

      const importedByKey = new Map(
          imported.rows.map((r) => [importedBudgetRowKey(r.customer, r.unit, r.building), r] as const)
      );
      const links = readBudgetCustomerNameLinks(billingPeriodNotes, year);
      const linkImportKeyByTenantId = new Map(links.map((l) => [l.tenantId, l.importKey] as const));

      return rows.map((row) => {
          const directKey = importedBudgetRowKey(row.name, row.unitNames, row.building);
          let importedRow = importedByKey.get(directKey);
          if (!importedRow) {
              const lk = linkImportKeyByTenantId.get(row.id);
              if (lk) importedRow = importedByKey.get(lk);
          }
          if (!importedRow) return row;
          // 与财务报表 applyImportedBudgetRowsToBillingDetails 一致：导入格为 0/空视为「未覆盖」，保留合同滚动推算额
          const nextMonthlyValues = row.monthlyValues.map((mv: any, idx: number) => {
              const importedCell = Math.round(Number(importedRow.months[idx] ?? 0));
              const amount = importedCell > 0.005 ? importedCell : mv.amount;
              return { ...mv, amount };
          });
          return {
              ...row,
              monthlyValues: nextMonthlyValues,
              // 导入明细里的单价/面积更贴近预算模板，存在时用于展示
              unitPrice: importedRow.unitPrice != null ? importedRow.unitPrice : row.unitPrice,
              area: importedRow.area != null ? importedRow.area : row.area,
          };
      });
  };

  const exportToExcel = async () => {
    const ExcelJSModule = await import('exceljs');
    const ExcelJSDefault = ExcelJSModule.default;
    const monthlyData = generateMonthlyDetail(detailYear);
    const groups = groupData(monthlyData);
    const isExec = viewMode === 'Execution';
    const monthValueCols = isExec ? 24 : 12;
    const totalCols = 7 + monthValueCols + 1;
    const sectionLabel = (x: string) => `【${x}】`;
    const fmtNum = (n: number) => (Math.abs(n) < 0.005 ? undefined : Math.round(n * 100) / 100);
    const fmtArea = (n: number) => (Math.abs(n) < 0.005 ? undefined : Number(n.toFixed(2)));
    const scenarioLabel =
        activeScenarioId === 'current'
            ? '年初预算方案 (Live)'
            : (scenarios.find((s) => s.id === activeScenarioId)?.name || activeScenarioId);

    const thinSide: ExcelJS.Border = { style: 'thin', color: { argb: 'FFCBD5E1' } };
    const cellBorder: Partial<ExcelJS.Borders> = {
        top: thinSide,
        left: thinSide,
        bottom: thinSide,
        right: thinSide,
    };

    const headerFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' },
    };
    const sectionFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
    };
    const subtotalFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF9C3' },
    };
    const zebraFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8FAFC' },
    };
    const newSigningFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD1FAE5' },
    };
    const leaseStartFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFEDD5' },
    };
    const rentFreeFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF3C7' },
    };
    const terminatingFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFE4E6' },
    };
    const adjustmentOutFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFEDD5' },
    };
    const adjustmentInFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF3E8FF' },
    };
    const amountAdjustmentFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFCCFBF1' },
    };

    const workbook = new ExcelJSDefault.Workbook();
    workbook.creator = '上海金蝶软件园招商看板';
    const sheetTitle = isExec ? `执行跟踪${detailYear}` : `预算表${detailYear}`;
    const ws = workbook.addWorksheet(sheetTitle, {
        views: [{ state: 'frozen', xSplit: 7, ySplit: isExec ? 5 : 4 }],
        properties: { defaultRowHeight: 20 },
    });

    const setRowBorder = (row: ExcelJS.Row, fromC: number, toC: number) => {
        for (let c = fromC; c <= toC; c++) {
            row.getCell(c).border = { ...cellBorder };
        }
    };
    const addCellNote = (cell: ExcelJS.Cell, lines: string[]) => {
        const text = lines.filter(Boolean).join('\n');
        if (!text) return;
        (cell as any).note = text;
    };

    let r = 1;
    ws.mergeCells(r, 1, r, totalCols);
    const tCell = ws.getCell(r, 1);
    tCell.value = `上海金蝶软件园 ${isExec ? '预算执行跟踪表' : '预算表'}`;
    tCell.font = { bold: true, size: 16, name: 'Calibri', color: { argb: 'FF0F172A' } };
    tCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    setRowBorder(ws.getRow(r), 1, totalCols);
    ws.getRow(r).height = 32;
    r++;

    ws.mergeCells(r, 1, r, totalCols);
    const mCell = ws.getCell(r, 1);
    mCell.value = `预算年度：${detailYear}年\n方案：${scenarioLabel}\n导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n标注说明：绿色=当年新签客户；橙色=起租月/账期调出；红色=退租客户/最后一期应收；紫色=账期调入；青色=金额调整。单元格批注包含详细说明。`;
    mCell.font = { size: 11, name: 'Calibri', color: { argb: 'FF475569' } };
    mCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
    setRowBorder(ws.getRow(r), 1, totalCols);
    ws.getRow(r).height = 88;
    r++;

    ws.addRow([]);
    ws.getRow(r).height = 6;
    r++;

    const headerRowIndex = r;
    if (isExec) {
        const h1: (string | undefined)[] = Array(totalCols).fill(undefined);
        h1[0] = '客户/单元';
        h1[1] = '房号';
        h1[2] = '所属楼宇';
        h1[3] = '租赁面积(㎡)';
        h1[4] = '类别';
        h1[5] = '签约单价(元/㎡·天)';
        h1[6] = '本年度免租期';
        for (let i = 0; i < 12; i++) {
            h1[7 + i * 2] = `${i + 1}月`;
        }
        h1[totalCols - 1] = '全年合计';
        ws.addRow(h1);
        const h2: (string | undefined)[] = Array(totalCols).fill(undefined);
        for (let i = 0; i < 12; i++) {
            h2[7 + i * 2] = '预算';
            h2[8 + i * 2] = '实收';
        }
        h2[totalCols - 1] = '实收合计';
        ws.addRow(h2);

        for (let c = 1; c <= 7; c++) {
            ws.mergeCells(headerRowIndex, c, headerRowIndex + 1, c);
        }
        for (let i = 0; i < 12; i++) {
            ws.mergeCells(headerRowIndex, 8 + i * 2, headerRowIndex, 9 + i * 2);
        }

        for (const hr of [headerRowIndex, headerRowIndex + 1]) {
            const row = ws.getRow(hr);
            for (let c = 1; c <= totalCols; c++) {
                const cell = row.getCell(c);
                cell.fill = headerFill;
                cell.font = { bold: true, color: { argb: 'FFF1F5F9' }, size: 10, name: 'Calibri' };
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                cell.border = { ...cellBorder };
            }
        }
    } else {
        const h: (string | undefined)[] = Array(totalCols).fill(undefined);
        h[0] = '客户/单元';
        h[1] = '房号';
        h[2] = '所属楼宇';
        h[3] = '租赁面积(㎡)';
        h[4] = '类别';
        h[5] = '签约单价(元/㎡·天)';
        h[6] = '本年度免租期';
        for (let i = 1; i <= 12; i++) {
            h[6 + i] = `${i}月`;
        }
        h[totalCols - 1] = '全年合计';
        ws.addRow(h);
        const row = ws.getRow(headerRowIndex);
        for (let c = 1; c <= totalCols; c++) {
            const cell = row.getCell(c);
            cell.fill = headerFill;
            cell.font = { bold: true, color: { argb: 'FFF1F5F9' }, size: 10, name: 'Calibri' };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = { ...cellBorder };
        }
    }

    let dataRowIndex = 0;
    Object.entries(groups).forEach(([groupName, rows]: [string, any]) => {
        const vals = Array(totalCols).fill(undefined) as (string | undefined)[];
        vals[0] = sectionLabel(groupName);
        const secRow = ws.addRow(vals);
        ws.mergeCells(secRow.number, 1, secRow.number, totalCols);
        const sc = ws.getCell(secRow.number, 1);
        sc.fill = sectionFill;
        sc.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF334155' } };
        sc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
        setRowBorder(secRow, 1, totalCols);
        secRow.height = 24;

        const groupBudgetSum = Array(12).fill(0);
        const groupActualSum = Array(12).fill(0);

        rows.forEach((rowData: any) => {
            const rowArr: (string | number | undefined)[] = Array(totalCols).fill(undefined);
            rowArr[0] = rowData.name;
            rowArr[1] = rowData.unitNames;
            rowArr[2] = rowData.building;
            rowArr[3] = fmtArea(rowData.area || 0);
            rowArr[4] = rowData.category;
            rowArr[5] =
                rowData.unitPrice != null && rowData.unitPrice > 0
                    ? Math.round(Number(rowData.unitPrice) * 100) / 100
                    : undefined;
            rowArr[6] =
                rowData.rentFreeYearSummary && rowData.rentFreeYearSummary !== '—'
                    ? rowData.rentFreeYearSummary
                    : undefined;
            const lastReceivableMonth = rowData.isTerminatingInYear
                ? rowData.monthlyValues.reduce((last: number | null, v: any, i: number) => (Number(v.amount || 0) > 0 ? i : last), null)
                : null;

            let rowBudgetTotal = 0;
            let rowActualTotal = 0;
            rowData.monthlyValues.forEach((v: any, i: number) => {
                const b = Number(v.amount || 0);
                const a = Number(v.actual || 0);
                rowBudgetTotal += b;
                rowActualTotal += a;
                groupBudgetSum[i] += b;
                groupActualSum[i] += a;

                if (isExec) {
                    rowArr[7 + i * 2] = fmtNum(b);
                    rowArr[8 + i * 2] = fmtNum(a);
                } else {
                    rowArr[7 + i] = fmtNum(b);
                }
            });

            rowArr[totalCols - 1] = fmtNum(isExec ? rowActualTotal : rowBudgetTotal);
            const excelRow = ws.addRow(rowArr);
            const zebra = dataRowIndex % 2 === 1;
            dataRowIndex++;
            const rowNotes = [
                rowData.paymentCycleLabel ? `账期类型：${rowData.paymentCycleLabel}` : '',
                rowData.isNewSigningInYear ? `当年新签；签约日：${rowData.signingDate || '—'}` : '',
                rowData.leaseStart ? `起租日：${rowData.leaseStart}` : '',
                rowData.isTerminatingInYear ? `退租客户；退租日：${rowData.terminationDate || '—'}` : '',
            ];
            for (let c = 1; c <= totalCols; c++) {
                const cell = excelRow.getCell(c);
                cell.border = { ...cellBorder };
                if (zebra) cell.fill = zebraFill;
                if (c <= 7) {
                    if (rowData.isTerminatingInYear) cell.fill = terminatingFill;
                    else if (rowData.isNewSigningInYear) cell.fill = newSigningFill;
                }
                if (c <= 7) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                    cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
                    if (c === 1) {
                        addCellNote(cell, rowNotes);
                        if (rowData.isTerminatingInYear) {
                            cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF9F1239' }, bold: true };
                        } else if (rowData.isNewSigningInYear) {
                            cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF047857' }, bold: true };
                        }
                    }
                    if (c === 4 && typeof cell.value === 'number') {
                        cell.numFmt = '#,##0.00';
                        cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    }
                    if (c === 5 && typeof cell.value === 'number') {
                        cell.numFmt = '#,##0.00';
                        cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    }
                } else {
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF334155' } };
                    if (typeof cell.value === 'number') {
                        cell.numFmt = '#,##0.00';
                    }
                }
            }
            rowData.monthlyValues.forEach((v: any, i: number) => {
                const budgetCol = isExec ? 8 + i * 2 : 8 + i;
                const cols = isExec ? [budgetCol, budgetCol + 1] : [budgetCol];
                const noteLines: string[] = [];
                const isLeaseStartMonth = rowData.leaseStartMonthInYear === i;
                const isLastReceivableMonth = lastReceivableMonth === i;
                const isRentFreeMonth = !!rowData.rentFreeMonthFlags?.[i];
                if (isRentFreeMonth) noteLines.push('合同免租自然月');
                if (isLeaseStartMonth) noteLines.push(`起租月；起租日：${rowData.leaseStart || '—'}`);
                if (isLastReceivableMonth) noteLines.push(`最后一期应收；退租日：${rowData.terminationDate || '—'}`);
                if (v.adjustmentDetail) noteLines.push(`调整说明：${v.adjustmentDetail}`);
                if (v.isAdjustedOut) noteLines.push('账期调整：本月调出');
                if (v.isAdjustedIn) noteLines.push('账期调整：本月调入');

                cols.forEach((col) => {
                    const cell = excelRow.getCell(col);
                    if (v.isAdjustedOut) cell.fill = adjustmentOutFill;
                    else if (v.isAdjustedIn) cell.fill = adjustmentInFill;
                    else if (v.adjustmentDetail) cell.fill = amountAdjustmentFill;
                    if (isLeaseStartMonth) cell.fill = leaseStartFill;
                    if (isRentFreeMonth) cell.fill = rentFreeFill;
                    if (isLastReceivableMonth) cell.fill = terminatingFill;
                    if (noteLines.length) addCellNote(cell, noteLines);
                    if (isLastReceivableMonth) {
                        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FFBE123C' }, bold: true };
                    } else if (isRentFreeMonth) {
                        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF92400E' }, bold: true };
                    } else if (isLeaseStartMonth) {
                        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FFC2410C' }, bold: true };
                    }
                });
            });
            excelRow.height = 22;
        });

        const subArr: (string | number | undefined)[] = Array(totalCols).fill(undefined);
        subArr[0] = `${groupName} 小计`;
        if (isExec) {
            let actualTotal = 0;
            for (let i = 0; i < 12; i++) {
                subArr[7 + i * 2] = fmtNum(groupBudgetSum[i]);
                subArr[8 + i * 2] = fmtNum(groupActualSum[i]);
                actualTotal += groupActualSum[i];
            }
            subArr[totalCols - 1] = fmtNum(actualTotal);
        } else {
            let budgetTotal = 0;
            for (let i = 0; i < 12; i++) {
                subArr[7 + i] = fmtNum(groupBudgetSum[i]);
                budgetTotal += groupBudgetSum[i];
            }
            subArr[totalCols - 1] = fmtNum(budgetTotal);
        }
        const subRow = ws.addRow(subArr);
        for (let c = 1; c <= totalCols; c++) {
            const cell = subRow.getCell(c);
            cell.fill = subtotalFill;
            cell.font = { bold: true, name: 'Calibri', size: 10, color: { argb: 'FF78350F' } };
            cell.border = { ...cellBorder };
            if (c <= 7) {
                cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            } else {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                if (typeof cell.value === 'number') cell.numFmt = '#,##0.00';
            }
        }
        subRow.height = 24;

        const gapAfterGroup = ws.addRow([]);
        gapAfterGroup.height = 10;
    });

    const excelVisualWidth = (text: string) => {
        let w = 0;
        for (let i = 0; i < text.length; i++) {
            w += text.charCodeAt(i) > 127 ? 2.1 : 1;
        }
        return w;
    };

    for (let col = 1; col <= totalCols; col++) {
        let maxW = col === 1 ? 14 : 10;
        ws.eachRow({ includeEmpty: true }, (row) => {
            const cell = row.getCell(col);
            let s = '';
            const v = cell.value;
            if (v == null) return;
            if (typeof v === 'object' && v !== null && 'richText' in v) {
                s = String((v as ExcelJS.CellRichTextValue).richText?.map((t) => t.text).join('') ?? '');
            } else if (typeof v === 'number') {
                s = v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            } else {
                s = String(v);
            }
            maxW = Math.max(maxW, excelVisualWidth(s));
        });
        const cap = col <= 5 ? 52 : 16;
        ws.getColumn(col).width = Math.min(cap, Math.max(col === 1 ? 24 : 9, maxW * 0.65 + 2.5));
    }

    try {
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `park_budget_${isExec ? 'execution_' : ''}${detailYear}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error(e);
        alert('导出失败，请重试或更新浏览器。');
    }
  };

  const groupData = (data: any[]) => {
      const rowCompare = (a: any, b: any) => {
          const building = String(a.buildingSort || a.building || '').localeCompare(String(b.buildingSort || b.building || ''), 'zh-CN', { numeric: true });
          if (building !== 0) return building;
          const floor = (a.floorSort ?? 9999) - (b.floorSort ?? 9999);
          if (floor !== 0) return floor;
          const room = compareUnitNameNumeric(String(a.roomSort || a.unitNames || ''), String(b.roomSort || b.unitNames || ''));
          if (room !== 0) return room;
          return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      };
      const groupOrder = (name: string, rows: any[]) => {
          if (sortMethod === 'PaymentCycle') return rows[0]?.paymentCycleOrder ?? 99;
          if (sortMethod === 'Building') return String(name);
          const categoryIndex = ['存量客户', '续签客户', '到期退租招商', '高风险退租', '空置去化'].indexOf(name);
          return categoryIndex >= 0 ? categoryIndex : 99;
      };
      const groups = new Map<string, any[]>();
      data.forEach(r => {
          const key = sortMethod === 'Category' ? r.category : sortMethod === 'Building' ? r.building : r.paymentCycleLabel;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(r);
      });
      const entries = Array.from(groups.entries()).map(([key, rows]) => [key, rows.sort(rowCompare)] as const);
      entries.sort((a, b) => {
          const oa = groupOrder(a[0], a[1]);
          const ob = groupOrder(b[0], b[1]);
          if (typeof oa === 'number' && typeof ob === 'number' && oa !== ob) return oa - ob;
          return String(a[0]).localeCompare(String(b[0]), 'zh-CN', { numeric: true });
      });
      return Object.fromEntries(entries);
  };

  const groupAdjustmentsByTenant = (list: BudgetAdjustment[]) => {
      const groups: Record<string, BudgetAdjustment[]> = {};
      list.forEach((adj) => {
          if (!groups[adj.tenantName]) groups[adj.tenantName] = [];
          groups[adj.tenantName].push(adj);
      });
      return groups;
  };

  const isAmountDeltaAdj = (a: BudgetAdjustment) => a.originalYear === -1 && a.originalMonth === -1;

  const periodAdjustmentsList = useMemo(
      () => budgetAdjustments.filter((a) => !isAmountDeltaAdj(a)),
      [budgetAdjustments]
  );
  const amountAdjustmentsList = useMemo(
      () => budgetAdjustments.filter((a) => isAmountDeltaAdj(a)),
      [budgetAdjustments]
  );

  const groupedPeriodAdjustments = useMemo(
      () => groupAdjustmentsByTenant(periodAdjustmentsList),
      [periodAdjustmentsList]
  );
  const groupedAmountAdjustments = useMemo(
      () => groupAdjustmentsByTenant(amountAdjustmentsList),
      [amountAdjustmentsList]
  );

  const impactStats = useMemo(() => {
    let currentYearNet = 0;
    let nextYearNet = 0;
    budgetAdjustments.forEach(adj => {
        if (adj.originalYear === detailYear) currentYearNet -= adj.amount;
        if (adj.adjustedYear === detailYear) currentYearNet += adj.amount;
        if (adj.originalYear === detailYear + 1) nextYearNet -= adj.amount;
        if (adj.adjustedYear === detailYear + 1) nextYearNet += adj.amount;
    });
    return { currentYearNet, nextYearNet };
  }, [budgetAdjustments, detailYear]);

  /** 按客户汇总：与本页「本年度/次年度预算影响」同一套口径（逐条加减） */
  const tenantAdjustmentSummary = useMemo(() => {
    const byTenant = new Map<string, { tenantId: string; tenantName: string; adjs: BudgetAdjustment[]; currentYearNet: number; nextYearNet: number }>();
    for (const adj of budgetAdjustments) {
      let row = byTenant.get(adj.tenantId);
      if (!row) {
        row = { tenantId: adj.tenantId, tenantName: adj.tenantName, adjs: [], currentYearNet: 0, nextYearNet: 0 };
        byTenant.set(adj.tenantId, row);
      }
      row.adjs.push(adj);
      if (adj.originalYear === detailYear) row.currentYearNet -= adj.amount;
      if (adj.adjustedYear === detailYear) row.currentYearNet += adj.amount;
      if (adj.originalYear === detailYear + 1) row.nextYearNet -= adj.amount;
      if (adj.adjustedYear === detailYear + 1) row.nextYearNet += adj.amount;
    }
    for (const row of byTenant.values()) {
      row.adjs.sort((a, b) => {
        const ay = a.adjustmentKind === 'amount_delta' ? a.adjustedYear : a.originalYear;
        const am = a.adjustmentKind === 'amount_delta' ? a.adjustedMonth : a.originalMonth;
        const by = b.adjustmentKind === 'amount_delta' ? b.adjustedYear : b.originalYear;
        const bm = b.adjustmentKind === 'amount_delta' ? b.adjustedMonth : b.originalMonth;
        if (ay !== by) return ay - by;
        return am - bm;
      });
    }
    return Array.from(byTenant.values()).sort((a, b) => a.tenantName.localeCompare(b.tenantName, 'zh-CN'));
  }, [budgetAdjustments, detailYear]);

  const renderRenewalCard = (tenant: Tenant) => {
      const asm = getAssumption(tenant.id, 'Renewal', tenant.name);
      return (
          <div key={tenant.id} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                  <div>
                      <h4 className="font-bold text-slate-700 truncate max-w-[10rem]" title={tenant.name}>
                          {tenant.name}
                      </h4>
                      <p className="text-xs text-rose-500 font-medium">到期日: {tenant.leaseEnd}</p>
                  </div>
                  <select
                      className={`text-xs px-2 py-1 rounded border ${asm.strategy === 'Renewal' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}
                      value={asm.strategy}
                      onChange={(e) => updateAssumption({ ...asm, strategy: e.target.value as 'Renewal' | 'ReLease' })}
                  >
                      <option value="Renewal">续签</option>
                      <option value="ReLease">到期退租招商</option>
                  </select>
              </div>
              {asm.strategy === 'ReLease' ? (
                  <div className="space-y-3 bg-amber-50/50 p-2 rounded">
                      <div className="grid grid-cols-2 gap-2">
                          <div>
                              <label className="text-xs font-medium text-slate-500 block mb-1">空置期(月)</label>
                              <input type="number" className="w-full border rounded px-2 py-1 text-sm" value={asm.vacancyGapMonths} onChange={(e) => updateAssumption({ ...asm, vacancyGapMonths: Number(e.target.value) })} />
                          </div>
                          <div>
                              <label className="text-xs font-medium text-slate-500 block mb-1">新租单价</label>
                              <input type="number" step="0.1" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedUnitPrice} onChange={(e) => updateAssumption({ ...asm, projectedUnitPrice: Number(e.target.value) })} />
                          </div>
                      </div>
                      <div>
                          <label className="text-xs font-medium text-slate-500 block mb-1">新租免租期(月)</label>
                          <input type="number" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedRentFreeMonths} onChange={(e) => updateAssumption({ ...asm, projectedRentFreeMonths: Number(e.target.value) })} />
                      </div>
                  </div>
              ) : (
                  <div className="space-y-3 bg-emerald-50/50 p-2 rounded">
                      <div className="grid grid-cols-2 gap-2">
                          <div>
                              <label className="text-xs font-medium text-slate-500 block mb-1">续签单价</label>
                              <input type="number" step="0.1" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedUnitPrice} onChange={(e) => updateAssumption({ ...asm, projectedUnitPrice: Number(e.target.value) })} />
                          </div>
                          <div>
                              <label className="text-xs font-medium text-slate-500 block mb-1">免租激励(月)</label>
                              <input type="number" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedRentFreeMonths} onChange={(e) => updateAssumption({ ...asm, projectedRentFreeMonths: Number(e.target.value) })} />
                          </div>
                      </div>
                  </div>
              )}
          </div>
      );
  };

  const renderSettingsView = () => {
    return (
        <div className="grid grid-cols-1 gap-6 p-1">
            <div className="col-span-full flex flex-wrap border-b border-slate-200">
                <button onClick={() => setActiveTab('Vacancy')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'Vacancy' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>空置去化 ({vacantUnits.length})</button>
                <button onClick={() => setActiveTab('Renewal')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'Renewal' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>到期续约 ({expiringTenants.length})</button>
                <button onClick={() => setActiveTab('Risk')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'Risk' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>风险应对 ({riskTenants.length})</button>
            </div>

            <div className="col-span-full min-w-0 animate-in fade-in slide-in-from-bottom-2">
                {activeTab === 'Vacancy' && (
                    <div className="space-y-8">
                        {vacantUnitsGrouped.map(({ building, count, floors }) => (
                            <section key={building.id} className="space-y-4">
                                <h3 className="text-sm font-bold text-slate-800 border-l-4 border-blue-500 pl-2">
                                    {building.name}
                                    <span className="font-normal text-slate-500 text-xs ml-2">本楼待去化 {count} 间</span>
                                </h3>
                                {floors.map(({ floor, units }) => (
                                    <div key={`${building.id}-${floor}`} className="space-y-2">
                                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                            {building.id === '__unknown__' && floor === 0 ? '未关联资产' : `第 ${floor} 层`}
                                        </h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {units.map((unit) => {
                                                const asm = getAssumption(unit.unitId, 'Vacancy', `${unit.unitName} (Vacancy)`);
                                                return (
                                                    <div key={unit.unitId} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                                                        <div className="flex justify-between items-start mb-3">
                                                            <div>
                                                                <h4 className="font-bold text-slate-700">{unit.unitName}</h4>
                                                                <p className="text-xs text-slate-500">{formatArea(unit.area)}</p>
                                                            </div>
                                                            <span className="bg-slate-100 text-slate-500 text-xs px-2 py-1 rounded">空置</span>
                                                        </div>
                                                        <div className="space-y-3">
                                                            <div>
                                                                <label className="text-xs font-medium text-slate-500 block mb-1">预计签约日</label>
                                                                <input type="date" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedSignDate} onChange={(e) => updateAssumption({ ...asm, projectedSignDate: e.target.value })} />
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div>
                                                                    <label className="text-xs font-medium text-slate-500 block mb-1">预估单价</label>
                                                                    <input type="number" step="0.1" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedUnitPrice} onChange={(e) => updateAssumption({ ...asm, projectedUnitPrice: Number(e.target.value) })} />
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs font-medium text-slate-500 block mb-1">免租月数</label>
                                                                    <input type="number" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedRentFreeMonths} onChange={(e) => updateAssumption({ ...asm, projectedRentFreeMonths: Number(e.target.value) })} />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </section>
                        ))}
                    </div>
                )}

                {activeTab === 'Renewal' && (
                    <div className="space-y-10">
                        {renewalGroupedByYearQuarter.map(({ year, quarters }) => (
                            <section key={year} className="space-y-5">
                                <h3 className="text-base font-bold text-slate-800 border-l-4 border-rose-400 pl-2">{year} 年到期</h3>
                                {quarters.map(({ quarter, label, tenants: qTenants }) => (
                                    <div key={`${year}-Q${quarter}`} className="space-y-3">
                                        <h4 className="text-xs font-semibold text-slate-600">{label}</h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{qTenants.map((tenant) => renderRenewalCard(tenant))}</div>
                                    </div>
                                ))}
                            </section>
                        ))}
                    </div>
                )}

                {activeTab === 'Risk' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {riskTenants.map((tenant) => {
                            const asm = getAssumption(tenant.id, 'RiskTermination', tenant.name);
                            return (
                                <div key={tenant.id} className="bg-white border border-red-100 rounded-lg p-4 shadow-sm relative overflow-hidden">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-red-400"></div>
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <h4 className="font-bold text-slate-700 truncate max-w-[10rem]" title={tenant.name}>
                                                {tenant.name}
                                            </h4>
                                            <p className="text-xs text-slate-400">原到期: {tenant.leaseEnd}</p>
                                        </div>
                                        <ShieldAlert size={16} className="text-red-500" />
                                    </div>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-xs font-medium text-red-600 block mb-1">预计提前退租日</label>
                                            <input type="date" className="w-full border border-red-200 rounded px-2 py-1 text-sm bg-red-50" value={asm.projectedTerminationDate || ''} onChange={(e) => updateAssumption({ ...asm, projectedTerminationDate: e.target.value })} />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-xs font-medium text-slate-500 block mb-1">空置期(月)</label>
                                                <input type="number" className="w-full border rounded px-2 py-1 text-sm" value={asm.vacancyGapMonths} onChange={(e) => updateAssumption({ ...asm, vacancyGapMonths: Number(e.target.value) })} />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-slate-500 block mb-1">新租单价</label>
                                                <input type="number" step="0.1" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedUnitPrice} onChange={(e) => updateAssumption({ ...asm, projectedUnitPrice: Number(e.target.value) })} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

            </div>
        </div>
    );
  };

  const renderDetailTable = () => {
      const monthlyData = generateMonthlyDetail(detailYear);
      const groups = groupData(monthlyData);
      const isExec = viewMode === 'Execution';
      const now = new Date();
      const currentYearM = now.getFullYear();
      const currentMonthM = now.getMonth();
      
      const monthlyBudgetTotals = Array(12).fill(0);
      const monthlyActualTotals = Array(12).fill(0);
      const monthlyOccupiedArea = Array(12).fill(0);
      
      monthlyData.forEach(row => {
          row.monthlyValues.forEach((val: any, idx: number) => {
              monthlyBudgetTotals[idx] += val.amount;
              monthlyActualTotals[idx] += val.actual || 0;
          });
          row.monthlyLeasedArea.forEach((area: number, idx: number) => {
              monthlyOccupiedArea[idx] += area;
          });
      });
      const grandBudgetTotal = monthlyBudgetTotals.reduce((a, b) => a + b, 0);
      const grandActualTotal = monthlyActualTotals.reduce((a, b) => a + b, 0);

      // Total leasable area calculation
      const totalLeasableArea = buildings.reduce((total, b) => 
          total + b.units.reduce((sum, u) => sum + (u.isSelfUse ? 0 : u.area), 0), 0);

      return (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm flex flex-col h-full">
               <div className="p-3 border-b border-slate-200 flex justify-between items-center bg-slate-50 flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center bg-white border border-slate-300 rounded-md shadow-sm">
                            <button onClick={() => setDetailYear(detailYear - 1)} className="p-1 hover:bg-slate-100 rounded-l text-slate-500"><ChevronLeft size={16}/></button>
                            <span className="px-3 py-1 font-bold text-slate-700 text-sm">{detailYear}年</span>
                            <button onClick={() => setDetailYear(detailYear + 1)} className="p-1 hover:bg-slate-100 rounded-r text-slate-500"><ChevronRight size={16}/></button>
                        </div>
                        <div className="flex bg-slate-200 rounded p-0.5">
                            <button onClick={() => setSortMethod('Category')} className={`px-3 py-1 text-xs font-medium rounded ${sortMethod === 'Category' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}>按类别</button>
                            <button onClick={() => setSortMethod('Building')} className={`px-3 py-1 text-xs font-medium rounded ${sortMethod === 'Building' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}>按楼宇</button>
                            <button onClick={() => setSortMethod('PaymentCycle')} className={`px-3 py-1 text-xs font-medium rounded ${sortMethod === 'PaymentCycle' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}>按账期</button>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-right hidden md:block border-r pr-4 border-slate-200">
                            <span className="text-xs text-slate-500 block">全年预算总额</span>
                            <span className="text-lg font-bold text-slate-800">{formatCurrency(grandBudgetTotal)}</span>
                        </div>
                        {isExec && (
                             <div className="text-right hidden md:block">
                                <span className="text-xs text-emerald-600 block">累计实收总额</span>
                                <span className="text-lg font-bold text-emerald-600">{formatCurrency(grandActualTotal)}</span>
                             </div>
                        )}
                        <div className="flex gap-2">
                             <button
                                 onClick={handlePickBudgetExcel}
                                 className="p-2 hover:bg-blue-100 rounded text-blue-600 disabled:opacity-50"
                                 title="从 Excel 导入预算表（按月汇总写入「预算执行」目标列）"
                                 disabled={isImporting || !onBatchUpdate}
                             >
                                 {isImporting ? <RotateCcw size={16} className="animate-spin"/> : <Upload size={16}/>}
                             </button>
                             <input
                                 ref={importInputRef}
                                 type="file"
                                 accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                 className="hidden"
                                 onChange={handleBudgetExcelChosen}
                             />
                             <button onClick={exportToExcel} className="p-2 hover:bg-slate-200 rounded text-slate-500" title="导出Excel"><Download size={16}/></button>
                             <button onClick={() => setIsFullScreen(!isFullScreen)} className="p-2 hover:bg-slate-200 rounded text-slate-500" title={isFullScreen ? "退出全屏" : "全屏模式"}>{isFullScreen ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>
                        </div>
                    </div>
               </div>
               {importedBudgetForDetailYear && (
                   <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between text-xs">
                       <div className="flex items-center gap-2 text-emerald-800">
                           <CheckCircle2 size={14} />
                           <span>
                               已导入 <strong>{detailYear}</strong> 年预算表
                               （{importedBudgetForDetailYear.rows.length} 行明细，全年合计 <strong>{formatCurrency(importedBudgetForDetailYear.annualTotal)}</strong>，
                               导入时间：{new Date(importedBudgetForDetailYear.importedAt).toLocaleString('zh-CN', { hour12: false })}
                               {importedBudgetForDetailYear.sourceSheet ? `，来源表：${importedBudgetForDetailYear.sourceSheet}` : ''}）
                           </span>
                           <span className="text-emerald-600">·</span>
                           <span className="text-emerald-700">数据已写入存档，点击右上角「保存」即可同步至云端。</span>
                       </div>
                       <button
                           onClick={() => handleClearImportedBudget(detailYear)}
                           className="text-emerald-700 hover:text-rose-600 underline"
                           title="清除本年度的导入预算表（同时清空月度目标值）"
                           disabled={!onBatchUpdate}
                       >
                           清除导入
                       </button>
                   </div>
               )}

               <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm text-left border-collapse">
                        {/* 表头粘性：sticky 需写在每个 th 上；写在 thead 上在多数浏览器对 table 无效 */}
                        <thead className="bg-slate-50 text-slate-500 font-medium">
                            <tr>
                                <th className="px-4 py-3 sticky left-0 top-0 z-30 bg-slate-50 border-b border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] w-[220px]">
                                    客户/单元
                                </th>
                                <th className="px-2 py-3 text-center whitespace-nowrap bg-slate-50 sticky top-0 z-20 border-b border-slate-200 shadow-sm min-w-[92px]">
                                    签约单价
                                    <span className="block text-[10px] font-normal text-slate-400">(元/㎡·天)</span>
                                </th>
                                <th className="px-2 py-3 text-center bg-slate-50 sticky top-0 z-20 border-b border-slate-200 shadow-sm min-w-[128px] max-w-[160px]">
                                    本年度免租期
                                </th>
                                {Array.from({length:12}).map((_, i) => (
                                    <th
                                        key={i}
                                        className={`px-2 py-3 text-right bg-slate-50 sticky top-0 z-20 border-b border-slate-200 shadow-sm min-w-[${isExec ? '120px' : '95px'}]`}
                                    >
                                        {i + 1}月
                                    </th>
                                ))}
                                <th className="px-4 py-3 text-right bg-slate-100 font-bold sticky right-0 top-0 z-30 border-b border-slate-200 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    合计
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {Object.entries(groups).map(([groupName, rows]: [string, any]) => {
                                let groupBudgetSum = Array(12).fill(0);
                                let groupActualSum = Array(12).fill(0);
                                const isCollapsed = collapsedBudgetGroups.has(groupName);
                                return (
                                    <React.Fragment key={groupName}>
                                        <tr
                                            className="group/hdr bg-slate-50 font-bold border-t border-slate-200 cursor-pointer hover:bg-slate-100/95 select-none"
                                            title={isCollapsed ? '展开本组' : '折叠本组'}
                                            onClick={() => toggleBudgetGroupCollapse(groupName)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    toggleBudgetGroupCollapse(groupName);
                                                }
                                            }}
                                            tabIndex={0}
                                            role="button"
                                            aria-expanded={!isCollapsed}
                                        >
                                            <td className="px-4 py-2 sticky left-0 z-10 bg-slate-50 group-hover/hdr:bg-slate-100 text-slate-500 uppercase tracking-wider text-[10px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] border-r border-slate-100/80">
                                                <span className="inline-flex items-center gap-1.5 normal-case tracking-normal font-semibold text-slate-600">
                                                    {isCollapsed ? (
                                                        <ChevronRight size={14} className="shrink-0 text-slate-400" aria-hidden />
                                                    ) : (
                                                        <ChevronDown size={14} className="shrink-0 text-slate-400" aria-hidden />
                                                    )}
                                                    <span className="uppercase tracking-wider text-[10px] text-slate-500">{groupName}</span>
                                                    <span className="text-[10px] font-normal text-slate-400 tabular-nums">({rows.length})</span>
                                                </span>
                                            </td>
                                            <td colSpan={15} className="bg-slate-50 group-hover/hdr:bg-slate-100 text-[10px] font-normal text-slate-400 text-right pr-4 py-2">
                                                {isCollapsed ? '已折叠，点击左侧展开' : ''}
                                            </td>
                                        </tr>
                                        {!isCollapsed &&
                                            rows.map((row: any) => {
                                            const rowTotalBudget = row.monthlyValues.reduce((acc: number, curr: any) => acc + curr.amount, 0);
                                            const rowTotalActual = row.monthlyValues.reduce((acc: number, curr: any) => acc + (curr.actual || 0), 0);
                                            
                                            row.monthlyValues.forEach((v: any, i: number) => {
                                                groupBudgetSum[i] += v.amount;
                                                groupActualSum[i] += (v.actual || 0);
                                            });
                                            const lastReceivableMonth = row.isTerminatingInYear
                                                ? row.monthlyValues.reduce((last: number | null, v: any, i: number) => (v.amount > 0 ? i : last), null)
                                                : null;

                                            return (
                                                <tr key={row.id} className={`hover:bg-slate-50 group ${row.isTerminatingInYear ? 'bg-rose-50/20' : row.isNewSigningInYear ? 'bg-emerald-50/25' : ''}`}>
                                                    <td
                                                        className={`px-4 py-3 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] border-r border-slate-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:z-20 ${
                                                            row.isTerminatingInYear
                                                                ? 'bg-rose-50 group-hover:bg-rose-50/80 border-l-4 border-l-rose-400'
                                                                : row.isNewSigningInYear
                                                                    ? 'bg-emerald-50 group-hover:bg-emerald-50/80 border-l-4 border-l-emerald-400'
                                                                    : 'bg-white group-hover:bg-slate-50'
                                                        }`}
                                                        title="点击查看合同概要（起租、免租、系统应收口径），便于对照当年预算"
                                                        tabIndex={0}
                                                        role="button"
                                                        onClick={() => setContractSummaryRow(row)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                setContractSummaryRow(row);
                                                            }
                                                        }}
                                                    >
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                            {/* 复核标记 */}
                                                            {!row.isVirtual && (
                                                                <span
                                                                    className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                                                        row.hasBudgetMods
                                                                            ? 'bg-amber-100 text-amber-700'
                                                                            : 'bg-emerald-100 text-emerald-700'
                                                                    }`}
                                                                    title={row.hasBudgetMods
                                                                        ? `合同应收 vs 预算有差异 (${formatWan(row.contractDiff)})\n原因：${row.verificationReasons.join('；')}`
                                                                        : '合同应收与预算一致，无调整'}
                                                                >
                                                                    {row.hasBudgetMods ? '⚠' : '✓'}
                                                                </span>
                                                            )}
                                                            <div className="font-medium text-slate-700 truncate w-[180px]" title={row.name}>{row.name}</div>
                                                            {row.isTerminatingInYear && (
                                                                <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700" title={`退租/到期日：${row.terminationDate || '—'}`}>
                                                                    退租
                                                                </span>
                                                            )}
                                                            {row.isNewSigningInYear && (
                                                                <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700" title={`签约日：${row.signingDate || '—'}`}>
                                                                    新签
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-1 mt-0.5">
                                                            <span className="inline-flex items-center rounded bg-slate-100 px-1 py-[1px] font-medium text-slate-700">
                                                                {row.building}
                                                            </span>
                                                            <span className="inline-flex items-center rounded bg-blue-50 px-1 py-[1px] font-medium text-blue-700">
                                                                {row.floorSummary || '—'}
                                                            </span>
                                                            <span
                                                                className="inline-flex items-center rounded bg-emerald-50 px-1 py-[1px] font-medium text-emerald-800 max-w-[min(160px,26vw)] truncate"
                                                                title={row.unitNames ? `房号：${row.unitNames}` : ''}
                                                            >
                                                                {row.unitNames?.trim() ? row.unitNames : '—'}
                                                            </span>
                                                            <span className="inline-flex items-center rounded bg-purple-50 px-1 py-[1px] font-medium text-purple-700">
                                                                {row.paymentCycleLabel || '季付'}
                                                            </span>
                                                            {row.leaseStartMonthInYear != null && (
                                                                <span className="inline-flex items-center rounded bg-orange-50 px-1 py-[1px] font-medium text-orange-700" title={`起租日：${row.leaseStart || '—'}`}>
                                                                    起租 {row.leaseStartMonthInYear + 1}月
                                                                </span>
                                                            )}
                                                            {row.isTerminatingInYear && (
                                                                <span className="inline-flex items-center rounded bg-rose-50 px-1 py-[1px] font-medium text-rose-700" title={`退租/到期日：${row.terminationDate || '—'}`}>
                                                                    退租 {new Date(row.terminationDate).getMonth() + 1}月
                                                                </span>
                                                            )}
                                                            <span className="text-[10px] text-slate-400">{formatArea(row.area)}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-2 py-3 text-center font-medium text-slate-700 bg-white group-hover:bg-slate-50 whitespace-nowrap align-top">
                                                        {row.unitPrice != null && row.unitPrice > 0 ? Number(row.unitPrice.toFixed(2)) : '—'}
                                                    </td>
                                                    <td className="px-2 py-3 text-center font-medium text-slate-700 bg-white group-hover:bg-slate-50 align-top max-w-[160px] leading-snug" title={row.rentFreeYearSummary}>
                                                        {row.rentFreeYearSummary || '—'}
                                                    </td>
                                                    {row.monthlyValues.map((val: any, idx: number) => {
                                                        const isPastMonth = detailYear < currentYearM || (detailYear === currentYearM && idx <= currentMonthM);
                                                        const isOverdue = isPastMonth && val.amount > 0 && (val.actual || 0) < val.amount;
                                                        const isPaid = val.amount > 0 && (val.actual || 0) >= val.amount;
                                                        const adjSt = budgetAdjustmentCellStyle(val);
                                                        const hasAdj = !!adjSt.shell;
                                                        const adjNote = (val.adjustmentDetail || '').trim();
                                                        const displayBudgetAmount = val.isAdjustedOut ? 0 : val.amount;
                                                        const isLeaseStartMonth = row.leaseStartMonthInYear === idx;
                                                        const isLastReceivableMonth = lastReceivableMonth === idx;
                                                        const isRentFreeMonth = !!row.rentFreeMonthFlags?.[idx];
                                                        const cellTitleParts = [
                                                            isRentFreeMonth ? '合同免租自然月' : '',
                                                            adjNote ? `调整说明：${adjNote}` : '',
                                                            isLastReceivableMonth ? `最后一期应收，退租/到期日：${row.terminationDate || '—'}` : '',
                                                            isLeaseStartMonth ? `起租日：${row.leaseStart || '—'}` : '',
                                                            !isExec && val.amount > 0 ? '点击编辑预算（账期或金额）' : '',
                                                        ].filter(Boolean);

                                                        return (
                                                            <td 
                                                                key={idx} 
                                                                title={cellTitleParts.length ? cellTitleParts.join('；') : undefined}
                                                                className={`px-2 py-2 text-right relative transition-colors group/cell align-top ${!hasAdj && !isExec && val.amount > 0 ? 'hover:bg-emerald-50/50' : ''} ${
                                                                    isExec && isOverdue && !hasAdj ? 'bg-rose-50' : ''
                                                                } ${!hasAdj && isLeaseStartMonth ? 'bg-orange-50/80 ring-1 ring-inset ring-orange-200' : ''} ${!hasAdj && isRentFreeMonth ? 'bg-amber-100/95 ring-1 ring-inset ring-amber-300 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.18)]' : ''} ${!hasAdj && isLastReceivableMonth ? 'bg-rose-50/90 ring-1 ring-inset ring-rose-200' : ''} ${adjSt.shell} ${val.amount > 0 ? 'text-slate-700' : 'text-slate-300'}`}
                                                            >
                                                                {!isExec ? (
                                                                    <div className="flex flex-col items-end gap-0.5">
                                                                        <div className="flex items-center justify-end gap-1">
                                                                            <span className={displayBudgetAmount > 0 ? 'font-medium' : ''}>
                                                                                {displayBudgetAmount > 0 ? formatNumber(displayBudgetAmount) : (val.isAdjustedOut ? '0.00' : '-')}
                                                                            </span>
                                                                            {displayBudgetAmount > 0 && (
                                                                                <Edit3 size={12} className="text-emerald-600 opacity-0 group-hover/cell:opacity-100 transition-opacity flex-shrink-0" aria-hidden />
                                                                            )}
                                                                        </div>
                                                                        {adjNote ? (
                                                                            <div className={`text-[9px] leading-snug max-w-[min(140px,22vw)] text-right font-medium ${adjSt.noteClass || 'text-slate-600'}`}>
                                                                                {adjNote}
                                                                            </div>
                                                                        ) : null}
                                                                        {isRentFreeMonth && (
                                                                            <div className="text-[9px] leading-snug text-amber-800 font-bold">免租月</div>
                                                                        )}
                                                                        {isLeaseStartMonth && (
                                                                            <div className="text-[9px] leading-snug text-orange-700 font-bold">起租月</div>
                                                                        )}
                                                                        {isLastReceivableMonth && (
                                                                            <div className="text-[9px] leading-snug text-rose-700 font-bold">最后一期</div>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex flex-col items-end gap-0.5">
                                                                        <div className="flex items-center gap-1">
                                                                            <span className={`text-[11px] font-bold ${isPaid ? 'text-emerald-600' : isOverdue ? 'text-rose-600 animate-pulse' : 'text-slate-400'}`}>
                                                                                {formatCurrency(val.actual || 0)}
                                                                            </span>
                                                                            {isPaid && <CheckCircle size={10} className="text-emerald-500" />}
                                                                            {isExec && isOverdue && <AlertCircle size={10} className="text-rose-500" />}
                                                                        </div>
                                                                        <span className="text-[9px] text-slate-400 font-mono opacity-60">预 {formatCurrency(val.amount)}</span>
                                                                        {adjNote ? (
                                                                            <div className={`text-[9px] leading-snug max-w-[min(140px,22vw)] text-right font-medium ${adjSt.noteClass || 'text-slate-600'}`}>
                                                                                {adjNote}
                                                                            </div>
                                                                        ) : null}
                                                                        {isRentFreeMonth && (
                                                                            <div className="text-[9px] leading-snug text-amber-800 font-bold">免租月</div>
                                                                        )}
                                                                        {isLeaseStartMonth && (
                                                                            <div className="text-[9px] leading-snug text-orange-700 font-bold">起租月</div>
                                                                        )}
                                                                        {isLastReceivableMonth && (
                                                                            <div className="text-[9px] leading-snug text-rose-700 font-bold">最后一期</div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className={`px-4 py-3 text-right font-bold sticky right-0 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)] border-l border-slate-100 ${isExec ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-800 group-hover:bg-slate-100'}`}>
                                                        {isExec ? (
                                                            <div className="flex flex-col items-end">
                                                                <span>{formatCurrency(rowTotalActual)}</span>
                                                                <span className="text-[10px] text-slate-400 font-normal">预: {formatCurrency(rowTotalBudget)}</span>
                                                            </div>
                                                        ) : (
                                                            formatCurrency(rowTotalBudget)
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {!isCollapsed && (
                                            <>
                                                {/* Sub-total Row */}
                                                <tr className="bg-white font-semibold italic border-b border-slate-200">
                                                    <td className="px-4 py-2 sticky left-0 bg-white z-10 text-blue-600 text-xs">
                                                        小计 ({groupName})
                                                    </td>
                                                    <td className="px-2 py-2 text-center text-slate-300 text-xs bg-white">—</td>
                                                    <td className="px-2 py-2 text-center text-slate-300 text-xs bg-white">—</td>
                                                    {groupBudgetSum.map((val, i) => (
                                                        <td key={i} className="px-2 py-2 text-right text-blue-600/70 text-xs">
                                                            {isExec ? (
                                                                <div className="flex flex-col items-end">
                                                                    <span className="text-emerald-600">{formatCurrency(groupActualSum[i])}</span>
                                                                    <span className="text-[9px] font-normal text-slate-400">预 {formatCurrency(val)}</span>
                                                                </div>
                                                            ) : (
                                                                formatCurrency(val)
                                                            )}
                                                        </td>
                                                    ))}
                                                    <td className={`px-4 py-2 text-right sticky right-0 ${isExec ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-50 text-blue-600'}`}>
                                                        {isExec ? (
                                                            <div className="flex flex-col items-end">
                                                                <span>{formatCurrency(groupActualSum.reduce((a, b) => a + b, 0))}</span>
                                                                <span className="text-[10px] font-normal opacity-60">
                                                                    预 {formatCurrency(groupBudgetSum.reduce((a, b) => a + b, 0))}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            formatCurrency(groupBudgetSum.reduce((a, b) => a + b, 0))
                                                        )}
                                                    </td>
                                                </tr>
                                            </>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            
                            {/* Summary Rows */}
                            <tr className="bg-slate-800 font-bold border-t-2 border-slate-700 text-white">
                                <td className="px-4 py-3 sticky left-0 bg-slate-800 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">月度合计 (实收/预算)</td>
                                <td className="px-2 py-3 text-center bg-slate-800 text-slate-500 text-xs font-normal">—</td>
                                <td className="px-2 py-3 text-center bg-slate-800 text-slate-500 text-xs font-normal">—</td>
                                {monthlyBudgetTotals.map((t, i) => (
                                    <td key={i} className="px-2 py-3 text-right">
                                        {isExec ? (
                                            <div className="flex flex-col items-end">
                                                <span className="text-emerald-400">{formatCurrency(monthlyActualTotals[i])}</span>
                                                <span className="text-[10px] font-normal text-slate-300 opacity-60">预 {formatCurrency(t)}</span>
                                            </div>
                                        ) : (
                                            formatCurrency(t)
                                        )}
                                    </td>
                                ))}
                                <td className="px-4 py-3 text-right bg-slate-900 sticky right-0 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    {isExec ? (
                                        <div className="flex flex-col items-end">
                                            <span className="text-emerald-400 font-black text-base">{formatCurrency(grandActualTotal)}</span>
                                            <span className="text-[10px] font-normal text-slate-300">预 {formatCurrency(grandBudgetTotal)}</span>
                                        </div>
                                    ) : (
                                        formatCurrency(grandBudgetTotal)
                                    )}
                                </td>
                            </tr>
                            
                            {/* Occupancy Rate Row */}
                            <tr className="bg-blue-50 font-bold border-t border-blue-100 text-blue-800">
                                <td className="px-4 py-3 sticky left-0 bg-blue-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    <div className="flex items-center gap-2">
                                        <TrendingUp size={14}/>
                                        <span>预测出租率</span>
                                    </div>
                                </td>
                                <td className="px-2 py-3 text-center bg-blue-50 text-slate-400 text-xs font-normal">—</td>
                                <td className="px-2 py-3 text-center bg-blue-50 text-slate-400 text-xs font-normal">—</td>
                                {monthlyOccupiedArea.map((occupied, i) => {
                                    const rate = totalLeasableArea > 0 ? (occupied / totalLeasableArea * 100) : 0;
                                    return (
                                        <td key={i} className="px-2 py-3 text-right">
                                            {formatPercent(rate)}
                                            <div className="text-[10px] font-normal opacity-60">({formatArea(occupied)})</div>
                                        </td>
                                    );
                                })}
                                <td className="px-4 py-3 text-right bg-blue-100 sticky right-0 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    -
                                </td>
                            </tr>
                        </tbody>
                    </table>
               </div>
          </div>
      );
  };

  return (
    <div className={`space-y-6 ${isFullScreen ? 'fixed inset-0 z-50 bg-white p-6 flex flex-col h-screen overflow-auto' : ''}`}>
       <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 border border-slate-200 p-3 rounded-lg flex-shrink-0">
           <div className="flex items-center gap-3 flex-1 min-w-[200px]">
               <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                   <LayoutList size={16} /> 预算方案:
               </div>
               <div className="flex items-center gap-2">
                   <select value={scenarioYearFilter} onChange={e => setScenarioYearFilter(Number(e.target.value))} className="bg-white border border-slate-300 rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-200 cursor-pointer shadow-sm">
                       {Array.from(new Set([currentYear, currentYear + 1, ...scenarios.map(s => s.budgetYear || currentYear)])).sort((a, b) => a - b).map(y => (
                           <option key={y} value={y}>{y}预算</option>
                       ))}
                   </select>
                   <select value={activeScenarioId} onChange={e => setActiveScenarioId(e.target.value)} className="bg-white border border-slate-300 rounded px-3 py-1.5 text-sm min-w-[240px] outline-none focus:ring-2 focus:ring-blue-200 cursor-pointer shadow-sm">
                       <option value="current">🟡 年初预算方案 (Live)</option>
                     {scenarios.filter(s => !String(s.id).startsWith('invoice_dedicated_') && (s.budgetYear || currentYear) === scenarioYearFilter).map(s => (<option key={s.id} value={s.id}>{s.name} ({s.budgetYear || currentYear}) {s.isActive ? '(✅年初预算生效中)' : ''} {s.isReceivableActive ? '(🧾应收专用)' : ''}</option>))}
                   </select>
                   {activeScenarioId !== 'current' && (
                       <div className="flex items-center gap-1">
                           {isRenaming ? (
                               <div className="flex items-center bg-white border border-blue-300 rounded overflow-hidden"><input type="text" value={tempScenarioName} onChange={e => setTempScenarioName(e.target.value)} className="px-2 py-1 text-xs outline-none w-32" autoFocus /><button onClick={saveRenaming} className="p-1 text-green-600 hover:bg-green-50"><Check size={12}/></button><button onClick={() => setIsRenaming(false)} className="p-1 text-red-500 hover:bg-red-50"><X size={12}/></button></div>
                           ) : (<button onClick={startRenaming} className="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-slate-200" title="重命名"><Edit3 size={14} /></button>)}
                           <button onClick={() => handleDeleteScenario(activeScenarioId)} className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-slate-200" title="删除方案"><Trash2 size={14} /></button>
                       </div>
                   )}
                   <button onClick={() => setShowScenarioModal(true)} className="p-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100" title="新建方案"><Plus size={16} /></button>
               </div>
           </div>

           <div className="flex items-center gap-3">
               <div className="flex bg-white rounded-lg border border-slate-200 p-1 shadow-sm">
                   {(['Settings', 'Monthly', 'Execution'] as const).map(mode => (
                       <button key={mode} onClick={() => setViewMode(mode)} className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1 ${viewMode === mode ? 'bg-slate-800 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
                           {mode === 'Settings' && <Calculator size={14} />}
                           {mode === 'Monthly' && <Table size={14} />}
                           {mode === 'Execution' && <Activity size={14} />}
                           {mode === 'Settings' ? '假设设定' : mode === 'Monthly' ? '预算表' : '执行跟踪'}
                       </button>
                   ))}
               </div>
               <div className="h-6 w-px bg-slate-300 mx-1"></div>
               <button disabled={activeScenarioId === 'current' && !scenarios.find(s=>s.isActive)} onClick={() => setShowCloudModal(true)} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 shadow-sm"><CloudUpload size={14} /> 云端保存</button>
              {activeScenarioId !== 'current' && (
                  <button
                      onClick={handleSetReceivableScenario}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                          scenarios.find(s => s.id === activeScenarioId)?.isReceivableActive
                              ? 'bg-sky-50 text-sky-700 border-sky-200'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                  >
                      <FileText size={14} /> 设为应收专用
                  </button>
              )}
               {activeScenarioId !== 'current' && !scenarios.find(s => s.id === activeScenarioId)?.isActive && (
                   <button onClick={handleActivateCurrentScenario} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 shadow-sm"><Play size={14} /> 设为{scenarioYearFilter}年初预算方案</button>
               )}
           </div>
       </div>

       <div className="flex-1 min-h-0">
           {viewMode === 'Settings' && renderSettingsView()}
           {(viewMode === 'Monthly' || viewMode === 'Execution') && renderDetailTable()}
       </div>

       {contractSummaryModalPayload && (
           <ContractSummaryModal
               open
               onClose={() => setContractSummaryRow(null)}
               detailYear={contractSummaryModalPayload.detailYear}
               subtitle={`${contractSummaryModalPayload.detailYear} 年预算对照 · 应收金额与表中「系统账单 + 人工调整」口径一致`}
               billsSectionSuffix="与预算列一致"
               budgetAssumptions={budgetAssumptions}
               budgetAdjustments={budgetAdjustments}
               content={contractSummaryModalPayload.content}
           />
       )}



       {showScenarioModal && (
           <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
               <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-50 duration-200">
                   <h3 className="text-lg font-bold text-slate-800 mb-4">新建预算方案</h3>
                   <div className="space-y-4">
                      <div><label className="block text-sm font-medium text-slate-700 mb-1">预算年份</label><select className="w-full border rounded p-2" value={newScenarioYear} onChange={e => setNewScenarioYear(Number(e.target.value))}>{Array.from(new Set([currentYear, currentYear + 1, currentYear + 2, ...scenarios.map(s => s.budgetYear || currentYear)])).sort((a,b)=>a-b).map(y => <option key={y} value={y}>{y}年</option>)}</select></div>
                      <div><label className="block text-sm font-medium text-slate-700 mb-1">方案名称</label><input type="text" className="w-full border rounded p-2" value={newScenarioName} onChange={e => setNewScenarioName(e.target.value)} placeholder="例如: 2027年度保守方案" autoFocus /></div>
                       <div><label className="block text-sm font-medium text-slate-700 mb-1">描述 (可选)</label><textarea className="w-full border rounded p-2 text-sm" rows={3} value={newScenarioDesc} onChange={e => setNewScenarioDesc(e.target.value)} placeholder="备注此方案的关键假设..." /></div>
                       <div className="flex items-center gap-2"><input type="checkbox" id="snapshot" checked={useSnapshot} onChange={e => setUseSnapshot(e.target.checked)} className="rounded text-blue-600" /><label htmlFor="snapshot" className="text-sm text-slate-600">保存当前租户与楼宇数据快照 (推荐)</label></div>
                       <p className="text-xs text-slate-400">勾选快照将锁定当前的租赁状态，使方案不受后续实际运营数据变化的影响，适合做静态测算。</p>
                       <div className="flex justify-end gap-2 pt-2"><button onClick={() => setShowScenarioModal(false)} className="px-4 py-2 border rounded text-slate-600 hover:bg-slate-50">取消</button><button onClick={handleCreateScenario} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">创建</button></div>
                   </div>
               </div>
           </div>
       )}

       {showCloudModal && (
           <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
               <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-50 duration-200">
                   <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><CloudUpload size={20}/> 备份至云端</h3>
                   <div className="space-y-4">
                       <div className="bg-blue-50 p-3 rounded text-sm text-blue-800">即将保存: <strong>{activeScenarioId === 'current' ? '年初预算方案 (Live)' : scenarios.find(s=>s.id===activeScenarioId)?.name}</strong></div>
                       <div><label className="block text-sm font-medium text-slate-700 mb-1">操作人员姓名 <span className="text-red-500">*</span></label><input type="text" className="w-full border rounded p-2" value={operatorName} onChange={e => setOperatorName(e.target.value)} placeholder="请输入您的姓名" /></div>
                       <div className="flex justify-end gap-2 pt-2"><button onClick={() => setShowCloudModal(false)} className="px-4 py-2 border rounded text-slate-600 hover:bg-slate-50">取消</button><button onClick={confirmCloudSave} disabled={!operatorName.trim()} className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">确认上传</button></div>
                   </div>
               </div>
           </div>
       )}

       {importPreview && (
           <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
               <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col animate-in zoom-in-50 duration-200">
                   <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                       <div className="flex items-center gap-2">
                           <Upload size={20} className="text-blue-600" />
                           <h3 className="text-lg font-bold text-slate-800">预算表导入预览</h3>
                       </div>
                       <button
                           onClick={() => setImportPreview(null)}
                           className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100"
                           aria-label="关闭"
                       >
                           <X size={20} />
                       </button>
                   </div>
                   <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                       <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-800">
                           <div>预算年度：<strong>{importPreview.year} 年</strong></div>
                           <div>工作表：<span className="font-mono">{importPreview.sheetName}</span></div>
                           <div>明细行：{importPreview.rows.length} 条</div>
                           <div>全年合计：<strong>{formatCurrency(importPreview.annualTotal)}</strong></div>
                       </div>

                       <div className="border border-slate-200 rounded-lg overflow-hidden">
                           <div className="bg-slate-50 px-4 py-2 text-xs text-slate-500 font-medium">
                               月度合计（将写入「预算执行」表的目标列）
                           </div>
                           <table className="w-full text-sm">
                               <thead className="bg-white text-slate-500 text-xs">
                                   <tr>
                                       {Array.from({ length: 12 }).map((_, i) => (
                                           <th key={i} className="text-right px-2 py-1.5">{i + 1}月</th>
                                       ))}
                                   </tr>
                               </thead>
                               <tbody>
                                   <tr className="border-t border-slate-100">
                                       {importPreview.monthlyTotals.map((v, i) => (
                                           <td key={i} className="text-right px-2 py-1.5 font-mono text-slate-700">
                                               {(v / 10000).toFixed(2)}万
                                           </td>
                                       ))}
                                   </tr>
                               </tbody>
                           </table>
                       </div>

                       {importPreview.warnings.length > 0 && (
                           <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 text-xs text-amber-800 space-y-1">
                               <div className="font-bold flex items-center gap-1">
                                   <AlertCircle size={14} /> 解析提示（{importPreview.warnings.length} 条）
                               </div>
                               <ul className="list-disc list-inside space-y-0.5 max-h-32 overflow-auto">
                                   {importPreview.warnings.slice(0, 50).map((w, i) => (
                                       <li key={i}>{w}</li>
                                   ))}
                               </ul>
                           </div>
                       )}

                       <div className="border border-slate-200 rounded-lg overflow-hidden">
                           <div className="bg-slate-50 px-4 py-2 text-xs text-slate-500 font-medium flex items-center justify-between">
                               <span>明细预览（前 8 行）</span>
                               <span className="text-slate-400">仅显示，不影响导入结果</span>
                           </div>
                           <div className="overflow-x-auto">
                               <table className="w-full text-xs">
                                   <thead className="bg-white text-slate-500">
                                       <tr>
                                           <th className="text-left px-2 py-1.5">客户</th>
                                           <th className="text-left px-2 py-1.5">房号</th>
                                           <th className="text-left px-2 py-1.5">楼宇</th>
                                           <th className="text-left px-2 py-1.5">类别</th>
                                           <th className="text-right px-2 py-1.5">合计(元)</th>
                                       </tr>
                                   </thead>
                                   <tbody>
                                       {importPreview.rows.slice(0, 8).map((r, i) => (
                                           <tr key={i} className="border-t border-slate-100">
                                               <td className="px-2 py-1.5">{r.customer}</td>
                                               <td className="px-2 py-1.5 text-slate-500">{r.unit}</td>
                                               <td className="px-2 py-1.5 text-slate-500">{r.building}</td>
                                               <td className="px-2 py-1.5 text-slate-500">{r.category}</td>
                                               <td className="px-2 py-1.5 text-right font-mono">{formatCurrency(r.total)}</td>
                                           </tr>
                                       ))}
                                   </tbody>
                               </table>
                           </div>
                       </div>

                       <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 text-xs text-slate-600 leading-relaxed">
                           <div className="font-bold text-slate-700 mb-1">导入说明</div>
                           确认导入后，<strong>{importPreview.year} 年</strong>每月的预算目标将被覆盖为以上「月度合计」值；
                           其它字段（实收金额、出租率、累计欠款）保留原值。
                           导入只在本地生效，请检查无误后再点击右上角「保存」写入后端。
                       </div>
                   </div>
                   <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                       <button
                           onClick={() => setImportPreview(null)}
                           className="px-5 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-white"
                       >
                           取消
                       </button>
                       <button
                           onClick={confirmApplyImportedBudget}
                           className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow"
                       >
                           确认导入预算表
                       </button>
                   </div>
               </div>
           </div>
       )}
    </div>
  );
};
