
import React, { useState, useMemo, useEffect } from 'react';
import { Building, Tenant, BudgetAssumption, ContractStatus, UnitStatus, DepositStatus, BudgetAdjustment, BudgetAnalysisData, PaymentRecord, BudgetScenario, RentFreePeriod } from '../types';
import type ExcelJS from 'exceljs';
import { Calculator, Calendar, DollarSign, TrendingUp, Save, Table, LayoutList, ChevronRight, ChevronDown, ChevronLeft, Download, ShieldAlert, ArrowRight, Maximize2, Minimize2, LineChart as LineChartIcon, Lightbulb, Edit3, X, Sparkles, PieChart, Activity, RotateCcw, TrendingDown, ArrowUpRight, ArrowDownRight, ArrowLeftRight, History, FileText, Info, FileWarning, Layers, Building as BuildingIcon, CheckCircle2, Copy, CloudUpload, Play, Trash2, Plus, Check, FileSpreadsheet, ArrowUpDown, List, AlertCircle, User, Briefcase, CheckCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { analyzeBudget } from '../services/geminiService';
import { generateBudgetedBills } from '../services/billingService';

function monthOverlapsRentFree(year: number, month: number, periods: RentFreePeriod[]): boolean {
    if (!periods?.length) return false;
    const ms = new Date(year, month, 1);
    const me = new Date(year, month + 1, 0);
    return periods.some((p) => {
        const ps = new Date(p.start);
        const pe = new Date(p.end);
        return !Number.isNaN(ps.getTime()) && !Number.isNaN(pe.getTime()) && ps <= me && pe >= ms;
    });
}

/** 当年历月与免租期重叠的紧凑描述，如「2–4月、9月」 */
function formatYearRentFreeSummary(year: number, periods: RentFreePeriod[] | undefined): string {
    if (!periods?.length) return '—';
    const hit: number[] = [];
    for (let m = 0; m < 12; m++) {
        if (monthOverlapsRentFree(year, m, periods)) hit.push(m);
    }
    if (hit.length === 0) return '—';
    const parts: string[] = [];
    let i = 0;
    while (i < hit.length) {
        const start = hit[i];
        let end = start;
        while (i + 1 < hit.length && hit[i + 1] === end + 1) {
            end = hit[i + 1];
            i++;
        }
        i++;
        if (start === end) parts.push(`${start + 1}月`);
        else parts.push(`${start + 1}–${end + 1}月`);
    }
    return parts.join('、');
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
    onRenameScenario
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
  
  const [sortMethod, setSortMethod] = useState<'Category' | 'Building'>('Category');
  
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [adjData, setAdjData] = useState<{ tenantId: string, tenantName: string, originalMonth: number, amount: number } | null>(null);
  const [adjForm, setAdjForm] = useState({ targetYear: detailYear, targetMonth: 0, reason: 'Deferred Payment / Adjustment' });
  const [adjEditTab, setAdjEditTab] = useState<'period' | 'amount'>('period');
  const [newAmountInput, setNewAmountInput] = useState('');

  const [showAdjHistory, setShowAdjHistory] = useState(false);
  const [adjHistoryTab, setAdjHistoryTab] = useState<'summary' | 'period' | 'amount'>('summary');

  useEffect(() => {
      const active = scenarios.find(s => s.isActive && (s.budgetYear || currentYear) === scenarioYearFilter);
      if (active) {
          setActiveScenarioId(active.id);
      } else {
          setActiveScenarioId('current');
      }
  }, [scenarios, scenarioYearFilter]);

  useEffect(() => {
      if (String(activeScenarioId).startsWith('invoice_dedicated_')) {
          setActiveScenarioId('current');
      }
  }, [activeScenarioId]);

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
      if (!newScenarioName.trim()) { alert("请输入方案名称"); return; }
      const newScenario: BudgetScenario = {
          id: `scenario_${Date.now()}`, name: newScenarioName, budgetYear: newScenarioYear, description: newScenarioDesc, createdAt: new Date().toISOString(), isActive: false,
          assumptions: [...propAssumptions], adjustments: [...propAdjustments],
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
  const confirmCloudSave = () => { if (!operatorName) return; const scenarioName = activeScenarioId === 'current' ? '当前生效方案' : scenarios.find(s => s.id === activeScenarioId)?.name || '未命名方案'; onSaveBudgetToCloud(scenarioName, operatorName); setShowCloudModal(false); };

  const activeTenants = useMemo(() => tenants.filter(t => t.status === ContractStatus.Active || t.status === ContractStatus.Expiring || t.status === ContractStatus.Pending), [tenants]);
  const expiringTenants = useMemo(() => tenants.filter(t => { const endYear = new Date(t.leaseEnd).getFullYear(); return endYear === nextYear && t.status !== ContractStatus.Terminated; }), [tenants, nextYear]);
  
  const vacantUnits = useMemo(() => {
    const list: { unitId: string; unitName: string; buildingName: string; area: number }[] = [];
    buildings.forEach(b => {
      b.units.forEach(u => {
        const isOccupied = tenants.some(t => 
            t.unitIds.includes(u.id) && 
            (t.status === ContractStatus.Active || t.status === ContractStatus.Expiring || t.status === ContractStatus.Pending)
        );
        if (!isOccupied && u.status !== UnitStatus.Occupied && !u.isSelfUse) {
          list.push({ unitId: u.id, unitName: u.name, buildingName: b.name, area: u.area });
        }
      });
    });
    return list;
  }, [buildings, tenants]);
  
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
          const floorSummary = formatFloorSummary(
              t.unitIds
                  .map(uid => building?.units.find(u => u.id === uid)?.floor)
                  .filter((f): f is number => typeof f === 'number')
          );
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

          tenantBills.forEach(bill => { if (bill.date.getFullYear() === year) { const m = bill.date.getMonth(); if (m >= 0 && m < 12) { monthlyValues[m].amount += bill.amount; } } });

          // ACTUAL DATA CALCULATION FOR TENANT
          payments.filter(p => p.tenantId === t.id && (p.type === 'Rent' || p.type === 'DepositToRent') && p.date.startsWith(year.toString())).forEach(p => {
              const m = parseInt(p.date.substring(5, 7), 10) - 1;
              if (m >= 0 && m < 12) {
                  monthlyValues[m].actual += p.amount;
              }
          });

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
                 virtualBills.forEach(bill => { if (bill.date.getFullYear() === year) { const m = bill.date.getMonth(); if (m >= 0 && m < 12) { monthlyValues[m].amount += bill.amount; } } });
             }
          }

          budgetAdjustments.forEach((adj) => {
              if (adj.tenantId !== t.id) return;
              const isAmt = adj.adjustmentKind === 'amount_delta' || (adj.originalYear === -1 && adj.originalMonth === -1);
              if (isAmt) {
                  if (adj.adjustedYear === year) {
                      const m = adj.adjustedMonth;
                      if (m >= 0 && m < 12) {
                          const tag = `金额 Δ ${adj.amount >= 0 ? '+' : ''}¥${adj.amount.toLocaleString()}`;
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

          rows.push({
              id: t.id,
              name: t.name,
              building: building?.name || '未知楼宇',
              unitNames,
              floorSummary,
              area: t.totalArea,
              category,
              monthlyValues,
              monthlyLeasedArea,
              unitPrice: t.unitPrice,
              rentFreeYearSummary: formatYearRentFreeSummary(year, t.rentFreePeriods || []),
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
             virtualBills.forEach(bill => { if (bill.date.getFullYear() === year) { const m = bill.date.getMonth(); if (m >= 0 && m < 12) { monthlyValues[m].amount += bill.amount; } } });
             vacantUnitPrice = assumption.projectedUnitPrice;
             vacantRentPeriods = virtualTenant.rentFreePeriods || [];
          }
          rows.push({
              id: u.unitId,
              name: '待租单元',
              building: u.buildingName,
              unitNames: u.unitName,
              floorSummary: formatFloorSummary(
                  [buildings.find(b => b.name === u.buildingName)?.units.find(x => x.id === u.unitId)?.floor]
                      .filter((f): f is number => typeof f === 'number')
              ),
              area: u.area,
              category: '空置去化',
              monthlyValues,
              monthlyLeasedArea,
              unitPrice: vacantUnitPrice,
              rentFreeYearSummary: formatYearRentFreeSummary(year, vacantRentPeriods),
          });
      });
      return rows;
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
            ? '当前实时生效方案 (Live)'
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
    mCell.value = `预算年度：${detailYear}年\n方案：${scenarioLabel}\n导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    mCell.font = { size: 11, name: 'Calibri', color: { argb: 'FF475569' } };
    mCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
    setRowBorder(ws.getRow(r), 1, totalCols);
    ws.getRow(r).height = 56;
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
            for (let c = 1; c <= totalCols; c++) {
                const cell = excelRow.getCell(c);
                cell.border = { ...cellBorder };
                if (zebra) cell.fill = zebraFill;
                if (c <= 7) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                    cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
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
                s = v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
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
      const groups: Record<string, any[]> = {};
      data.forEach(r => {
          const key = sortMethod === 'Category' ? r.category : r.building;
          if (!groups[key]) groups[key] = [];
          groups[key].push(r);
      });
      return groups;
  };

  const saveAdjustment = () => {
    if (!adjData) return;
    const newAdj: BudgetAdjustment = {
        id: `adj_${Date.now()}`,
        tenantId: adjData.tenantId,
        tenantName: adjData.tenantName,
        originalYear: detailYear,
        originalMonth: adjData.originalMonth,
        adjustedYear: adjForm.targetYear,
        adjustedMonth: adjForm.targetMonth,
        amount: adjData.amount,
        reason: adjForm.reason,
        adjustmentKind: 'period_shift',
    };
    handleUpdateAdjustments([...budgetAdjustments, newAdj]);
    setShowAdjModal(false);
  };

  const saveAmountAdjustment = () => {
      if (!adjData) return;
      const prev = adjData.amount;
      const next = Number(String(newAmountInput).replace(/,/g, '').trim());
      if (Number.isNaN(next)) {
          alert('请输入有效金额');
          return;
      }
      const delta = Math.round((next - prev) * 100) / 100;
      if (Math.abs(delta) < 0.005) {
          setShowAdjModal(false);
          return;
      }
      const newAdj: BudgetAdjustment = {
          id: `adj_${Date.now()}`,
          tenantId: adjData.tenantId,
          tenantName: adjData.tenantName,
          originalYear: -1,
          originalMonth: -1,
          adjustedYear: detailYear,
          adjustedMonth: adjData.originalMonth,
          amount: delta,
          reason: `手动调整金额: ¥${prev.toLocaleString()} → ¥${next.toLocaleString()}`,
          adjustmentKind: 'amount_delta',
      };
      handleUpdateAdjustments([...budgetAdjustments, newAdj]);
      setShowAdjModal(false);
  };

  const deleteAdjustment = (id: string) => {
    if (window.confirm("确定撤销此调整记录吗？")) {
        const newAdjs = budgetAdjustments.filter(a => a.id !== id);
        handleUpdateAdjustments(newAdjs);
    }
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

  const renderSettingsView = () => {
    return (
        <div className="space-y-6 p-1">
            <div className="flex border-b border-slate-200">
                <button onClick={() => setActiveTab('Vacancy')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'Vacancy' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>空置去化 ({vacantUnits.length})</button>
                <button onClick={() => setActiveTab('Renewal')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'Renewal' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>到期续约 ({expiringTenants.length})</button>
                <button onClick={() => setActiveTab('Risk')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'Risk' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>风险应对 ({riskTenants.length})</button>
                <button onClick={() => setActiveTab('Existing')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'Existing' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>存量调优 ({activeTenants.length})</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in slide-in-from-bottom-2">
                {activeTab === 'Vacancy' && vacantUnits.map(unit => {
                    const asm = getAssumption(unit.unitId, 'Vacancy', `${unit.unitName} (Vacancy)`);
                    return (
                        <div key={unit.unitId} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                            <div className="flex justify-between items-start mb-3">
                                <div><h4 className="font-bold text-slate-700">{unit.buildingName} - {unit.unitName}</h4><p className="text-xs text-slate-500">{unit.area} ㎡</p></div>
                                <span className="bg-slate-100 text-slate-500 text-xs px-2 py-1 rounded">空置</span>
                            </div>
                            <div className="space-y-3">
                                <div><label className="text-xs font-medium text-slate-500 block mb-1">预计签约日</label><input type="date" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedSignDate} onChange={e => updateAssumption({...asm, projectedSignDate: e.target.value})} /></div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div><label className="text-xs font-medium text-slate-500 block mb-1">预估单价</label><input type="number" step="0.1" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedUnitPrice} onChange={e => updateAssumption({...asm, projectedUnitPrice: Number(e.target.value)})} /></div>
                                    <div><label className="text-xs font-medium text-slate-500 block mb-1">免租月数</label><input type="number" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedRentFreeMonths} onChange={e => updateAssumption({...asm, projectedRentFreeMonths: Number(e.target.value)})} /></div>
                                </div>
                            </div>
                        </div>
                    );
                })}
                {activeTab === 'Renewal' && expiringTenants.map(tenant => {
                    const asm = getAssumption(tenant.id, 'Renewal', tenant.name);
                    return (
                        <div key={tenant.id} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                            <div className="flex justify-between items-start mb-3">
                                <div><h4 className="font-bold text-slate-700 truncate w-40" title={tenant.name}>{tenant.name}</h4><p className="text-xs text-rose-500 font-medium">到期日: {tenant.leaseEnd}</p></div>
                                <select className={`text-xs px-2 py-1 rounded border ${asm.strategy === 'Renewal' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`} value={asm.strategy} onChange={e => updateAssumption({...asm, strategy: e.target.value as any})}>
                                    <option value="Renewal">续签</option>
                                    <option value="ReLease">到期退租招商</option>
                                </select>
                            </div>
                            {asm.strategy === 'ReLease' ? (
                                <div className="space-y-3 bg-amber-50/50 p-2 rounded">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div><label className="text-xs font-medium text-slate-500 block mb-1">空置期(月)</label><input type="number" className="w-full border rounded px-2 py-1 text-sm" value={asm.vacancyGapMonths} onChange={e => updateAssumption({...asm, vacancyGapMonths: Number(e.target.value)})} /></div>
                                        <div><label className="text-xs font-medium text-slate-500 block mb-1">新租单价</label><input type="number" step="0.1" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedUnitPrice} onChange={e => updateAssumption({...asm, projectedUnitPrice: Number(e.target.value)})} /></div>
                                    </div>
                                    <div><label className="text-xs font-medium text-slate-500 block mb-1">新租免租期(月)</label><input type="number" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedRentFreeMonths} onChange={e => updateAssumption({...asm, projectedRentFreeMonths: Number(e.target.value)})} /></div>
                                </div>
                            ) : (
                                <div className="space-y-3 bg-emerald-50/50 p-2 rounded">
                                     <div className="grid grid-cols-2 gap-2">
                                        <div><label className="text-xs font-medium text-slate-500 block mb-1">续签单价</label><input type="number" step="0.1" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedUnitPrice} onChange={e => updateAssumption({...asm, projectedUnitPrice: Number(e.target.value)})} /></div>
                                        <div><label className="text-xs font-medium text-slate-500 block mb-1">免租激励(月)</label><input type="number" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedRentFreeMonths} onChange={e => updateAssumption({...asm, projectedRentFreeMonths: Number(e.target.value)})} /></div>
                                     </div>
                                </div>
                            )}
                        </div>
                    );
                })}
                {activeTab === 'Risk' && riskTenants.map(tenant => {
                    const asm = getAssumption(tenant.id, 'RiskTermination', tenant.name);
                    return (
                         <div key={tenant.id} className="bg-white border border-red-100 rounded-lg p-4 shadow-sm relative overflow-hidden">
                             <div className="absolute top-0 left-0 w-1 h-full bg-red-400"></div>
                             <div className="flex justify-between items-start mb-3">
                                <div><h4 className="font-bold text-slate-700 truncate w-40" title={tenant.name}>{tenant.name}</h4><p className="text-xs text-slate-400">原到期: {tenant.leaseEnd}</p></div>
                                <ShieldAlert size={16} className="text-red-500"/>
                            </div>
                            <div className="space-y-3">
                                <div><label className="text-xs font-medium text-red-600 block mb-1">预计提前退租日</label><input type="date" className="w-full border border-red-200 rounded px-2 py-1 text-sm bg-red-50" value={asm.projectedTerminationDate || ''} onChange={e => updateAssumption({...asm, projectedTerminationDate: e.target.value})} /></div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div><label className="text-xs font-medium text-slate-500 block mb-1">空置期(月)</label><input type="number" className="w-full border rounded px-2 py-1 text-sm" value={asm.vacancyGapMonths} onChange={e => updateAssumption({...asm, vacancyGapMonths: Number(e.target.value)})} /></div>
                                    <div><label className="text-xs font-medium text-slate-500 block mb-1">新租单价</label><input type="number" step="0.1" className="w-full border rounded px-2 py-1 text-sm" value={asm.projectedUnitPrice} onChange={e => updateAssumption({...asm, projectedUnitPrice: Number(e.target.value)})} /></div>
                                </div>
                            </div>
                         </div>
                    );
                })}
                {activeTab === 'Existing' && activeTenants.map(tenant => {
                    const asm = getAssumption(tenant.id, 'Existing', tenant.name);
                    const shift = asm.billingCycleShiftMonths || 0;
                    return (
                        <div key={tenant.id} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                            <div className="flex justify-between items-start mb-2">
                                <h4 className="font-bold text-slate-700 text-sm truncate w-40">{tenant.name}</h4>
                                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">正常</span>
                            </div>
                            <div className="space-y-3">
                                <div className="bg-slate-50 p-2 rounded">
                                    <label className="text-xs font-medium text-slate-600 block mb-1 flex justify-between">
                                        <span>账期整体平移</span>
                                        <span className={shift > 0 ? 'text-blue-600' : shift < 0 ? 'text-orange-600' : 'text-slate-400'}>{shift > 0 ? `延后${shift}个月` : shift < 0 ? `提前${Math.abs(shift)}个月` : '无偏移'}</span>
                                    </label>
                                    <input type="range" min="-3" max="3" step="1" className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer" value={shift} onChange={e => updateAssumption({...asm, billingCycleShiftMonths: Number(e.target.value)})} />
                                    <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>-3月</span><span>0</span><span>+3月</span></div>
                                </div>
                            </div>
                        </div>
                    );
                })}
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
                        </div>
                        <button onClick={() => setShowAdjHistory(true)} className="flex items-center gap-1 text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors" title="查看人工调整记录"><History size={14} /> 调整记录</button>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-right hidden md:block border-r pr-4 border-slate-200">
                            <span className="text-xs text-slate-500 block">全年预算总额</span>
                            <span className="text-lg font-bold text-slate-800">¥{grandBudgetTotal.toLocaleString()}</span>
                        </div>
                        {isExec && (
                             <div className="text-right hidden md:block">
                                <span className="text-xs text-emerald-600 block">累计实收总额</span>
                                <span className="text-lg font-bold text-emerald-600">¥{grandActualTotal.toLocaleString()}</span>
                             </div>
                        )}
                        <div className="flex gap-2">
                             <button onClick={exportToExcel} className="p-2 hover:bg-slate-200 rounded text-slate-500" title="导出Excel"><Download size={16}/></button>
                             <button onClick={() => setIsFullScreen(!isFullScreen)} className="p-2 hover:bg-slate-200 rounded text-slate-500" title={isFullScreen ? "退出全屏" : "全屏模式"}>{isFullScreen ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>
                        </div>
                    </div>
               </div>

               <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-20 shadow-sm">
                            <tr>
                                <th className="px-4 py-3 sticky left-0 bg-slate-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] w-[220px]">客户/单元</th>
                                <th className="px-2 py-3 text-center whitespace-nowrap bg-slate-50 min-w-[92px]">
                                    签约单价
                                    <span className="block text-[10px] font-normal text-slate-400">(元/㎡·天)</span>
                                </th>
                                <th className="px-2 py-3 text-center bg-slate-50 min-w-[128px] max-w-[160px]">本年度免租期</th>
                                {Array.from({length:12}).map((_, i) => (
                                    <th key={i} className={`px-2 py-3 text-right min-w-[${isExec ? '120px' : '95px'}]`}>{i+1}月</th>
                                ))}
                                <th className="px-4 py-3 text-right bg-slate-100 font-bold sticky right-0 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">合计</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {Object.entries(groups).map(([groupName, rows]: [string, any]) => {
                                let groupBudgetSum = Array(12).fill(0);
                                let groupActualSum = Array(12).fill(0);
                                return (
                                    <React.Fragment key={groupName}>
                                        <tr className="bg-slate-50 font-bold border-t border-slate-200">
                                            <td className="px-4 py-2 sticky left-0 bg-slate-50 z-10 text-slate-500 uppercase tracking-wider text-[10px]">{groupName}</td>
                                            <td colSpan={15}></td>
                                        </tr>
                                        {rows.map((row: any) => {
                                            const rowTotalBudget = row.monthlyValues.reduce((acc: number, curr: any) => acc + curr.amount, 0);
                                            const rowTotalActual = row.monthlyValues.reduce((acc: number, curr: any) => acc + (curr.actual || 0), 0);
                                            
                                            row.monthlyValues.forEach((v: any, i: number) => {
                                                groupBudgetSum[i] += v.amount;
                                                groupActualSum[i] += (v.actual || 0);
                                            });

                                            return (
                                                <tr key={row.id} className="hover:bg-slate-50 group">
                                                    <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-slate-50 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] border-r border-slate-100">
                                                        <div className="font-medium text-slate-700 truncate w-[200px]" title={row.name}>{row.name}</div>
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
                                                            <span className="text-[10px] text-slate-400">{row.area}㎡</span>
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

                                                        return (
                                                            <td 
                                                                key={idx} 
                                                                title={adjNote || (!isExec && val.amount > 0 ? '点击编辑预算（账期或金额）' : undefined)}
                                                                className={`px-2 py-2 text-right relative transition-colors group/cell align-top ${
                                                                    !isExec && val.amount > 0 ? 'cursor-pointer' : ''
                                                                } ${!hasAdj && !isExec && val.amount > 0 ? 'hover:bg-emerald-50/50' : ''} ${
                                                                    isExec && isOverdue && !hasAdj ? 'bg-rose-50' : ''
                                                                } ${adjSt.shell} ${val.amount > 0 ? 'text-slate-700' : 'text-slate-300'}`}
                                                                onClick={() => { 
                                                                    if(!isExec && val.amount > 0) { 
                                                                        setAdjData({ tenantId: row.id, tenantName: row.name, originalMonth: idx, amount: val.amount }); 
                                                                        setAdjForm(prev => ({ ...prev, targetYear: detailYear, targetMonth: idx === 11 ? 0 : idx + 1 })); 
                                                                        setNewAmountInput(String(Math.round(val.amount)));
                                                                        setAdjEditTab('period');
                                                                        setShowAdjModal(true); 
                                                                    } 
                                                                }}
                                                            >
                                                                {!isExec ? (
                                                                    <div className="flex flex-col items-end gap-0.5">
                                                                        <div className="flex items-center justify-end gap-1">
                                                                            <span className={displayBudgetAmount > 0 ? 'font-medium' : ''}>
                                                                                {displayBudgetAmount > 0 ? displayBudgetAmount.toLocaleString() : (val.isAdjustedOut ? '0' : '-')}
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
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex flex-col items-end gap-0.5">
                                                                        <div className="flex items-center gap-1">
                                                                            <span className={`text-[11px] font-bold ${isPaid ? 'text-emerald-600' : isOverdue ? 'text-rose-600 animate-pulse' : 'text-slate-400'}`}>
                                                                                ¥{(val.actual || 0).toLocaleString()}
                                                                            </span>
                                                                            {isPaid && <CheckCircle size={10} className="text-emerald-500" />}
                                                                            {isExec && isOverdue && <AlertCircle size={10} className="text-rose-500" />}
                                                                        </div>
                                                                        <span className="text-[9px] text-slate-400 font-mono opacity-60">预 ¥{val.amount.toLocaleString()}</span>
                                                                        {adjNote ? (
                                                                            <div className={`text-[9px] leading-snug max-w-[min(140px,22vw)] text-right font-medium ${adjSt.noteClass || 'text-slate-600'}`}>
                                                                                {adjNote}
                                                                            </div>
                                                                        ) : null}
                                                                    </div>
                                                                )}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className={`px-4 py-3 text-right font-bold sticky right-0 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)] border-l border-slate-100 ${isExec ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-800 group-hover:bg-slate-100'}`}>
                                                        {isExec ? (
                                                            <div className="flex flex-col items-end">
                                                                <span>¥{rowTotalActual.toLocaleString()}</span>
                                                                <span className="text-[10px] text-slate-400 font-normal">预: ¥{rowTotalBudget.toLocaleString()}</span>
                                                            </div>
                                                        ) : (
                                                            `¥${rowTotalBudget.toLocaleString()}`
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {/* Sub-total Row */}
                                        <tr className="bg-white font-semibold italic border-b border-slate-200">
                                            <td className="px-4 py-2 sticky left-0 bg-white z-10 text-blue-600 text-xs">小计 ({groupName})</td>
                                            <td className="px-2 py-2 text-center text-slate-300 text-xs bg-white">—</td>
                                            <td className="px-2 py-2 text-center text-slate-300 text-xs bg-white">—</td>
                                            {groupBudgetSum.map((val, i) => (
                                                <td key={i} className="px-2 py-2 text-right text-blue-600/70 text-xs">
                                                    {isExec ? (
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-emerald-600">¥{groupActualSum[i].toLocaleString()}</span>
                                                            <span className="text-[9px] font-normal text-slate-400">预 ¥{val.toLocaleString()}</span>
                                                        </div>
                                                    ) : (
                                                        `¥${val.toLocaleString()}`
                                                    )}
                                                </td>
                                            ))}
                                            <td className={`px-4 py-2 text-right sticky right-0 ${isExec ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-50 text-blue-600'}`}>
                                                {isExec ? (
                                                    <div className="flex flex-col items-end">
                                                        <span>¥{groupActualSum.reduce((a,b)=>a+b, 0).toLocaleString()}</span>
                                                        <span className="text-[10px] font-normal opacity-60">预 ¥{groupBudgetSum.reduce((a,b)=>a+b, 0).toLocaleString()}</span>
                                                    </div>
                                                ) : (
                                                    `¥${groupBudgetSum.reduce((a,b)=>a+b, 0).toLocaleString()}`
                                                )}
                                            </td>
                                        </tr>
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
                                                <span className="text-emerald-400">¥{monthlyActualTotals[i].toLocaleString()}</span>
                                                <span className="text-[10px] font-normal text-slate-300 opacity-60">预 ¥{t.toLocaleString()}</span>
                                            </div>
                                        ) : (
                                            `¥${t.toLocaleString()}`
                                        )}
                                    </td>
                                ))}
                                <td className="px-4 py-3 text-right bg-slate-900 sticky right-0 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    {isExec ? (
                                        <div className="flex flex-col items-end">
                                            <span className="text-emerald-400 font-black text-base">¥{grandActualTotal.toLocaleString()}</span>
                                            <span className="text-[10px] font-normal text-slate-300">预 ¥{grandBudgetTotal.toLocaleString()}</span>
                                        </div>
                                    ) : (
                                        `¥${grandBudgetTotal.toLocaleString()}`
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
                                    const rate = totalLeasableArea > 0 ? (occupied / totalLeasableArea * 100).toFixed(1) : '0.0';
                                    return (
                                        <td key={i} className="px-2 py-3 text-right">
                                            {rate}%
                                            <div className="text-[10px] font-normal opacity-60">({occupied.toLocaleString()}㎡)</div>
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
                       <option value="current">🟡 当前实时生效方案 (Live)</option>
                     {scenarios.filter(s => !String(s.id).startsWith('invoice_dedicated_') && (s.budgetYear || currentYear) === scenarioYearFilter).map(s => (<option key={s.id} value={s.id}>{s.name} ({s.budgetYear || currentYear}) {s.isActive ? '(✅生效中)' : ''} {s.isReceivableActive ? '(🧾应收专用)' : ''}</option>))}
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
                   <button onClick={handleActivateCurrentScenario} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 shadow-sm animate-pulse"><Play size={14} /> 应用为{scenarioYearFilter}预算</button>
               )}
           </div>
       </div>

       <div className="flex-1 min-h-0">
           {viewMode === 'Settings' && renderSettingsView()}
           {(viewMode === 'Monthly' || viewMode === 'Execution') && renderDetailTable()}
       </div>

       {showAdjModal && adjData && (
           <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-50 duration-200">
                   <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
                       <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Edit3 size={20} className="text-emerald-600" /> 编辑预算单元格</h3>
                       <button type="button" onClick={() => setShowAdjModal(false)} className="p-1 rounded hover:bg-slate-200 text-slate-500"><X size={22} /></button>
                   </div>
                   <div className="px-6 pt-3 flex gap-2 border-b border-slate-100">
                       <button type="button" onClick={() => setAdjEditTab('period')} className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${adjEditTab === 'period' ? 'border-emerald-600 text-emerald-700 bg-emerald-50/50' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>调整账期</button>
                       <button type="button" onClick={() => setAdjEditTab('amount')} className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${adjEditTab === 'amount' ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>调整金额</button>
                   </div>
                   <div className="p-6 overflow-y-auto flex-1 space-y-4">
                       <div className="bg-slate-50 p-4 rounded-xl text-sm text-slate-700 space-y-1 border border-slate-100">
                           <p><span className="text-slate-500">客户</span> <span className="font-semibold">{adjData.tenantName}</span></p>
                           <p><span className="text-slate-500">账期</span> {detailYear}年{adjData.originalMonth + 1}月</p>
                           <p><span className="text-slate-500">当前预算额</span> <span className="font-mono font-bold text-slate-900">¥{adjData.amount.toLocaleString()}</span></p>
                       </div>
                       {adjEditTab === 'period' ? (
                           <div className="space-y-4">
                               <p className="text-xs text-slate-500">将本账期金额移至目标月份（生成一条账期调整记录）。</p>
                               <div><label className="block text-sm font-medium text-slate-700 mb-1">目标年份</label><input type="number" className="w-full border border-slate-200 rounded-lg px-3 py-2" value={adjForm.targetYear} onChange={(e) => setAdjForm({ ...adjForm, targetYear: Number(e.target.value) })} /></div>
                               <div><label className="block text-sm font-medium text-slate-700 mb-1">目标月份</label><select className="w-full border border-slate-200 rounded-lg px-3 py-2" value={adjForm.targetMonth} onChange={(e) => setAdjForm({ ...adjForm, targetMonth: Number(e.target.value) })}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{i + 1}月</option>)}</select></div>
                               <div><label className="block text-sm font-medium text-slate-700 mb-1">原因说明</label><input type="text" className="w-full border border-slate-200 rounded-lg px-3 py-2" value={adjForm.reason} onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })} placeholder="例如：客户申请缓缴" /></div>
                           </div>
                       ) : (
                           <div className="space-y-4">
                               <p className="text-xs text-slate-500">直接修改该月预算金额（按差额生成「金额调整」记录，与系统账单叠加计算）。</p>
                               <div><label className="block text-sm font-medium text-slate-700 mb-1">新预算金额 (元)</label><input type="text" inputMode="decimal" className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-lg" value={newAmountInput} onChange={(e) => setNewAmountInput(e.target.value)} placeholder="输入金额" /></div>
                           </div>
                       )}
                   </div>
                   <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/50">
                       <button type="button" onClick={() => setShowAdjModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-white">取消</button>
                       {adjEditTab === 'period' ? (
                           <button type="button" onClick={saveAdjustment} className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium">确认账期调整</button>
                       ) : (
                           <button type="button" onClick={saveAmountAdjustment} className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium">确认金额调整</button>
                       )}
                   </div>
               </div>
           </div>
       )}

       {showAdjHistory && (
           <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-6">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden animate-in zoom-in-50 duration-200">
                   <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-start gap-4 flex-shrink-0 bg-gradient-to-r from-slate-50 to-white">
                       <div>
                           <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><History size={20} className="text-blue-600" /> 预算调整记录</h3>
                           <p className="text-sm text-slate-500 mt-1">
                               {adjHistoryTab === 'summary'
                                   ? '按客户名称汇总全部调整，单行展示多条记录，并汇总对本年度与次年度收款的影响'
                                   : '按租户集中展示，账期与金额调整分开展示'}
                           </p>
                       </div>
                       <button type="button" onClick={() => setShowAdjHistory(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"><X size={22} /></button>
                   </div>
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex-shrink-0">
                       <div className="bg-white border border-blue-100 rounded-xl p-4 shadow-sm">
                           <div className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-1">本年度 ({detailYear}) 预算影响</div>
                           <div className={`text-2xl font-bold ${impactStats.currentYearNet >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{impactStats.currentYearNet >= 0 ? '+' : ''}¥{impactStats.currentYearNet.toLocaleString()}</div>
                       </div>
                       <div className="bg-white border border-purple-100 rounded-xl p-4 shadow-sm">
                           <div className="text-xs font-bold text-purple-600 uppercase tracking-wide mb-1">次年度 ({detailYear + 1}) 预算影响</div>
                           <div className={`text-2xl font-bold ${impactStats.nextYearNet >= 0 ? 'text-purple-700' : 'text-red-600'}`}>{impactStats.nextYearNet >= 0 ? '+' : ''}¥{impactStats.nextYearNet.toLocaleString()}</div>
                       </div>
                   </div>
                   <div className="px-6 pt-3 flex flex-wrap gap-2 border-b border-slate-100 flex-shrink-0">
                       <button type="button" onClick={() => setAdjHistoryTab('summary')} className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 ${adjHistoryTab === 'summary' ? 'border-slate-800 text-slate-900 bg-slate-50/80' : 'border-transparent text-slate-500 hover:text-slate-700'}`}><LayoutList size={15} /> 调整汇总 ({budgetAdjustments.length})</button>
                       <button type="button" onClick={() => setAdjHistoryTab('period')} className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${adjHistoryTab === 'period' ? 'border-emerald-600 text-emerald-700 bg-emerald-50/50' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>调整账期 ({periodAdjustmentsList.length})</button>
                       <button type="button" onClick={() => setAdjHistoryTab('amount')} className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${adjHistoryTab === 'amount' ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>调整金额 ({amountAdjustmentsList.length})</button>
                   </div>
                   <div className="flex-1 overflow-y-auto px-6 py-5 min-h-[200px]">
                       {adjHistoryTab === 'summary' ? (
                           tenantAdjustmentSummary.length > 0 ? (
                               <div className="space-y-4">
                                   <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
                                       <table className="w-full text-sm">
                                           <thead>
                                               <tr className="bg-slate-50 text-left text-slate-600 border-b border-slate-200">
                                                   <th className="px-4 py-3 font-semibold whitespace-nowrap w-[14%]">客户名称</th>
                                                   <th className="px-4 py-3 font-semibold min-w-[280px]">调整内容</th>
                                                   <th className="px-4 py-3 font-semibold whitespace-nowrap text-right w-[12%]">本年度 ({detailYear}) 影响</th>
                                                   <th className="px-4 py-3 font-semibold whitespace-nowrap text-right w-[12%]">次年度 ({detailYear + 1}) 影响</th>
                                               </tr>
                                           </thead>
                                           <tbody className="divide-y divide-slate-100 bg-white">
                                               {tenantAdjustmentSummary.map((row) => (
                                                   <tr key={row.tenantId} className="hover:bg-slate-50/80 align-top">
                                                       <td className="px-4 py-3 font-bold text-slate-800">{row.tenantName}</td>
                                                       <td className="px-4 py-3">
                                                           <div className="flex flex-wrap gap-2">
                                                               {row.adjs.map((adj) => {
                                                                   const isAmt = isAmountDeltaAdj(adj);
                                                                   return (
                                                                       <span
                                                                           key={adj.id}
                                                                           className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs max-w-full ${isAmt ? 'border-indigo-200 bg-indigo-50/80 text-indigo-900' : 'border-emerald-200 bg-emerald-50/80 text-emerald-900'}`}
                                                                       title={adj.reason}
                                                                       >
                                                                           <span className={`font-semibold shrink-0 ${isAmt ? 'text-indigo-700' : 'text-emerald-700'}`}>{isAmt ? '金额' : '账期'}</span>
                                                                           {isAmt ? (
                                                                               <span className="font-mono">
                                                                                   {adj.adjustedYear}年{adj.adjustedMonth + 1}月 {adj.amount >= 0 ? '+' : ''}¥{adj.amount.toLocaleString()}
                                                                               </span>
                                                                           ) : (
                                                                               <span className="font-mono">
                                                                                   {adj.originalYear}/{String(adj.originalMonth + 1).padStart(2, '0')} → {adj.adjustedYear}/{String(adj.adjustedMonth + 1).padStart(2, '0')} ¥{adj.amount.toLocaleString()}
                                                                               </span>
                                                                           )}
                                                                           <button type="button" onClick={() => deleteAdjustment(adj.id)} className="p-0.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded shrink-0" title="撤销"><Trash2 size={13} /></button>
                                                                       </span>
                                                                   );
                                                               })}
                                                           </div>
                                                       </td>
                                                       <td className={`px-4 py-3 text-right font-mono font-bold whitespace-nowrap ${row.currentYearNet >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                                                           {row.currentYearNet >= 0 ? '+' : ''}¥{row.currentYearNet.toLocaleString()}
                                                       </td>
                                                       <td className={`px-4 py-3 text-right font-mono font-bold whitespace-nowrap ${row.nextYearNet >= 0 ? 'text-purple-700' : 'text-red-600'}`}>
                                                           {row.nextYearNet >= 0 ? '+' : ''}¥{row.nextYearNet.toLocaleString()}
                                                       </td>
                                                   </tr>
                                               ))}
                                           </tbody>
                                       </table>
                                   </div>
                                   <div className="md:hidden space-y-4">
                                       {tenantAdjustmentSummary.map((row) => (
                                           <div key={row.tenantId} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                                               <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 font-bold text-slate-800">{row.tenantName}</div>
                                               <div className="p-4 space-y-3">
                                                   <div className="flex flex-wrap gap-2">
                                                       {row.adjs.map((adj) => {
                                                           const isAmt = isAmountDeltaAdj(adj);
                                                           return (
                                                               <span key={adj.id} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${isAmt ? 'border-indigo-200 bg-indigo-50/80' : 'border-emerald-200 bg-emerald-50/80'}`} title={adj.reason}>
                                                                   <span className={`font-semibold ${isAmt ? 'text-indigo-700' : 'text-emerald-700'}`}>{isAmt ? '金额' : '账期'}</span>
                                                                   {isAmt ? (
                                                                       <span className="font-mono text-indigo-900">{adj.adjustedYear}年{adj.adjustedMonth + 1}月 {adj.amount >= 0 ? '+' : ''}¥{adj.amount.toLocaleString()}</span>
                                                                   ) : (
                                                                       <span className="font-mono text-emerald-900">{adj.originalYear}/{String(adj.originalMonth + 1).padStart(2, '0')} → {adj.adjustedYear}/{String(adj.adjustedMonth + 1).padStart(2, '0')} ¥{adj.amount.toLocaleString()}</span>
                                                                   )}
                                                                   <button type="button" onClick={() => deleteAdjustment(adj.id)} className="p-0.5 text-slate-400 hover:text-red-600"><Trash2 size={13} /></button>
                                                               </span>
                                                           );
                                                       })}
                                                   </div>
                                                   <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                                                       <div>
                                                           <div className="text-[10px] font-bold text-blue-600 uppercase mb-0.5">本年度影响</div>
                                                           <div className={`font-mono font-bold ${row.currentYearNet >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{row.currentYearNet >= 0 ? '+' : ''}¥{row.currentYearNet.toLocaleString()}</div>
                                                       </div>
                                                       <div>
                                                           <div className="text-[10px] font-bold text-purple-600 uppercase mb-0.5">次年度影响</div>
                                                           <div className={`font-mono font-bold ${row.nextYearNet >= 0 ? 'text-purple-700' : 'text-red-600'}`}>{row.nextYearNet >= 0 ? '+' : ''}¥{row.nextYearNet.toLocaleString()}</div>
                                                       </div>
                                                   </div>
                                               </div>
                                           </div>
                                       ))}
                                   </div>
                               </div>
                           ) : (
                               <div className="text-center py-16 text-slate-400 flex flex-col items-center"><FileWarning size={40} className="mb-3 opacity-40" /><p>暂无预算调整记录</p></div>
                           )
                       ) : adjHistoryTab === 'period' ? (
                           Object.keys(groupedPeriodAdjustments).length > 0 ? (
                               <div className="space-y-5">
                                   {Object.entries(groupedPeriodAdjustments)
                                       .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
                                       .map(([tenantName, rawAdjs]) => {
                                       const adjs = rawAdjs as BudgetAdjustment[];
                                       return (
                                           <div key={tenantName} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                               <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                                                   <div className="font-bold text-slate-800 flex items-center gap-2"><User size={16} className="text-slate-500" /> {tenantName}</div>
                                                   <span className="text-xs bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-medium">{adjs.length} 条</span>
                                               </div>
                                               <div className="divide-y divide-slate-100 bg-white">
                                                   {adjs.map((adj) => (
                                                       <div key={adj.id} className="p-4 flex justify-between items-start gap-3 hover:bg-slate-50/80 transition-colors">
                                                           <div className="min-w-0 flex-1">
                                                               <div className="flex flex-wrap items-center gap-2 text-sm mb-1">
                                                                   <span className="text-slate-400 line-through">{adj.originalYear}/{String(adj.originalMonth + 1).padStart(2, '0')}</span>
                                                                   <ArrowRight size={14} className="text-slate-300 flex-shrink-0" />
                                                                   <span className="text-emerald-700 font-semibold">{adj.adjustedYear}/{String(adj.adjustedMonth + 1).padStart(2, '0')}</span>
                                                                   <span className="font-bold text-slate-800 ml-1">¥{adj.amount.toLocaleString()}</span>
                                                               </div>
                                                               <div className="text-xs text-slate-500 flex items-center gap-1"><Info size={12} /> {adj.reason}</div>
                                                           </div>
                                                           <button type="button" onClick={() => deleteAdjustment(adj.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg flex-shrink-0" title="撤销"><Trash2 size={16} /></button>
                                                       </div>
                                                   ))}
                                               </div>
                                           </div>
                                       );
                                   })}
                               </div>
                           ) : (
                               <div className="text-center py-16 text-slate-400 flex flex-col items-center"><FileWarning size={40} className="mb-3 opacity-40" /><p>暂无账期调整记录</p></div>
                           )
                       ) : Object.keys(groupedAmountAdjustments).length > 0 ? (
                           <div className="space-y-5">
                               {Object.entries(groupedAmountAdjustments)
                                   .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
                                   .map(([tenantName, rawAdjs]) => {
                                   const adjs = rawAdjs as BudgetAdjustment[];
                                   return (
                                       <div key={tenantName} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                           <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                                               <div className="font-bold text-slate-800 flex items-center gap-2"><User size={16} className="text-slate-500" /> {tenantName}</div>
                                               <span className="text-xs bg-indigo-100 text-indigo-800 px-2.5 py-1 rounded-full font-medium">{adjs.length} 条</span>
                                           </div>
                                           <div className="divide-y divide-slate-100 bg-white">
                                               {adjs.map((adj) => (
                                                   <div key={adj.id} className="p-4 flex justify-between items-start gap-3 hover:bg-slate-50/80 transition-colors">
                                                       <div className="min-w-0 flex-1">
                                                           <div className="flex flex-wrap items-center gap-2 text-sm mb-1">
                                                               <span className="text-slate-600 font-medium">{adj.adjustedYear}年{adj.adjustedMonth + 1}月</span>
                                                               <span className={`font-bold ${adj.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{adj.amount >= 0 ? '+' : ''}¥{adj.amount.toLocaleString()}</span>
                                                           </div>
                                                           <div className="text-xs text-slate-500 flex items-center gap-1"><Info size={12} /> {adj.reason}</div>
                                                       </div>
                                                       <button type="button" onClick={() => deleteAdjustment(adj.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg flex-shrink-0" title="撤销"><Trash2 size={16} /></button>
                                                   </div>
                                               ))}
                                           </div>
                                       </div>
                                   );
                               })}
                           </div>
                       ) : (
                           <div className="text-center py-16 text-slate-400 flex flex-col items-center"><FileWarning size={40} className="mb-3 opacity-40" /><p>暂无金额调整记录</p></div>
                       )}
                   </div>
                   <div className="px-6 py-4 border-t border-slate-200 flex justify-end bg-slate-50/50 flex-shrink-0">
                       <button type="button" onClick={() => setShowAdjHistory(false)} className="px-5 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 font-medium">关闭</button>
                   </div>
               </div>
           </div>
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
                       <div className="bg-blue-50 p-3 rounded text-sm text-blue-800">即将保存: <strong>{activeScenarioId === 'current' ? '当前生效方案 (Live)' : scenarios.find(s=>s.id===activeScenarioId)?.name}</strong></div>
                       <div><label className="block text-sm font-medium text-slate-700 mb-1">操作人员姓名 <span className="text-red-500">*</span></label><input type="text" className="w-full border rounded p-2" value={operatorName} onChange={e => setOperatorName(e.target.value)} placeholder="请输入您的姓名" /></div>
                       <div className="flex justify-end gap-2 pt-2"><button onClick={() => setShowCloudModal(false)} className="px-4 py-2 border rounded text-slate-600 hover:bg-slate-50">取消</button><button onClick={confirmCloudSave} disabled={!operatorName.trim()} className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">确认上传</button></div>
                   </div>
               </div>
           </div>
       )}
    </div>
  );
};
