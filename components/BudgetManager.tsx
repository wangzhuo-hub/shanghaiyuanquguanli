
import React, { useState, useMemo, useEffect } from 'react';
import { Building, Tenant, BudgetAssumption, ContractStatus, UnitStatus, DepositStatus, BudgetAdjustment, BudgetAnalysisData, PaymentRecord, BudgetScenario } from '../types';
import { Calculator, Calendar, DollarSign, TrendingUp, Save, Table, LayoutList, ChevronRight, ChevronDown, ChevronLeft, Download, ShieldAlert, ArrowRight, Maximize2, Minimize2, LineChart as LineChartIcon, Lightbulb, Edit3, X, Sparkles, PieChart, Activity, RotateCcw, TrendingDown, ArrowUpRight, ArrowDownRight, ArrowLeftRight, History, FileText, Info, FileWarning, Layers, Building as BuildingIcon, CheckCircle2, Copy, CloudUpload, Play, Trash2, Plus, Check, FileSpreadsheet, ArrowUpDown, List, AlertCircle, User, Briefcase, CheckCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { analyzeBudget } from '../services/geminiService';
import { generateBudgetedBills } from '../services/billingService';

// SheetJS (XLSX) is loaded via script tag in index.html
declare const XLSX: any;

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

  const [showAdjHistory, setShowAdjHistory] = useState(false);

  useEffect(() => {
      const active = scenarios.find(s => s.isActive);
      if (active) {
          setActiveScenarioId(active.id);
      }
  }, [scenarios]);

  useEffect(() => {
      if (activeScenarioId === 'invoice_dedicated') {
          setActiveTab('Existing');
      }
  }, [activeScenarioId]);

  const effectiveData = useMemo(() => {
      if (activeScenarioId === 'invoice_dedicated') {
          const stored = scenarios.find(s => s.id === 'invoice_dedicated');
          if (stored) {
              return {
                  buildings: propBuildings,
                  tenants: propTenants,
                  assumptions: stored.assumptions,
                  adjustments: stored.adjustments
              };
          }
          return {
              buildings: propBuildings,
              tenants: propTenants,
              assumptions: propAssumptions.filter(a => a.targetType === 'Existing'),
              adjustments: propAdjustments
          };
      }

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
      if (activeScenarioId === 'invoice_dedicated') {
          const existing = scenarios.find(s => s.id === 'invoice_dedicated');
          const newScenario: BudgetScenario = {
              id: 'invoice_dedicated',
              name: '发票/实收专用方案',
              description: '系统自动生成：用于发票管理与实收核对的专用数据源 (独立数据)',
              createdAt: existing?.createdAt || new Date().toISOString(),
              isActive: false,
              assumptions: newAssumptions,
              adjustments: existing?.adjustments || budgetAdjustments,
          };
          
          const otherScenarios = scenarios.filter(s => s.id !== 'invoice_dedicated');
          onUpdateScenarios([...otherScenarios, newScenario]);
          return;
      }

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
      if (activeScenarioId === 'invoice_dedicated') {
          const existing = scenarios.find(s => s.id === 'invoice_dedicated');
          const newScenario: BudgetScenario = {
              id: 'invoice_dedicated',
              name: '发票/实收专用方案',
              description: '系统自动生成：用于发票管理与实收核对的专用数据源 (独立数据)',
              createdAt: existing?.createdAt || new Date().toISOString(),
              isActive: false,
              assumptions: existing?.assumptions || budgetAssumptions,
              adjustments: newAdjustments,
          };
          
          const otherScenarios = scenarios.filter(s => s.id !== 'invoice_dedicated');
          onUpdateScenarios([...otherScenarios, newScenario]);
          return;
      }

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
          id: `scenario_${Date.now()}`, name: newScenarioName, description: newScenarioDesc, createdAt: new Date().toISOString(), isActive: false,
          assumptions: [...propAssumptions], adjustments: [...propAdjustments],
          baseDataSnapshot: useSnapshot ? { tenants: JSON.parse(JSON.stringify(propTenants)), buildings: JSON.parse(JSON.stringify(propBuildings)) } : undefined
      };
      onUpdateScenarios([...scenarios, newScenario]); setActiveScenarioId(newScenario.id); setShowScenarioModal(false); setNewScenarioName(''); setNewScenarioDesc('');
  };
  const handleDeleteScenario = (id: string) => { if(window.confirm("确定删除此预算方案吗？")) { const newScenarios = scenarios.filter(s => s.id !== id); onUpdateScenarios(newScenarios); if (activeScenarioId === id) setActiveScenarioId('current'); } };
  const startRenaming = () => { const scenario = scenarios.find(s => s.id === activeScenarioId); if (scenario) { setTempScenarioName(scenario.name); setIsRenaming(true); } };
  const saveRenaming = () => { if (tempScenarioName.trim()) { onRenameScenario(activeScenarioId, tempScenarioName); } setIsRenaming(false); };
  const handleActivateCurrentScenario = () => { const scenario = scenarios.find(s => s.id === activeScenarioId); if (scenario) { onActivateScenario(scenario); } };
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
    if (activeScenarioId === 'invoice_dedicated' && type !== 'Existing') {
        return {
            id: `read_only_${targetId}`, targetType: type, targetId: targetId, targetName: targetName,
            strategy: 'Renewal', projectedSignDate: '', projectedUnitPrice: 0, projectedRentFreeMonths: 0
        } as BudgetAssumption;
    }

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

          budgetAdjustments.forEach(adj => { if (adj.tenantId === t.id) { if (adj.originalYear === year) { const m = adj.originalMonth; if (m >= 0 && m < 12) { monthlyValues[m].isAdjustedOut = true; monthlyValues[m].adjustmentDetail = `调出 -> ${adj.adjustedYear}年${adj.adjustedMonth + 1}月`; } } if (adj.adjustedYear === year) { const m = adj.adjustedMonth; if (m >= 0 && m < 12) { monthlyValues[m].isAdjustedIn = true; monthlyValues[m].adjustmentDetail = `调入 <- ${adj.originalYear}年${adj.originalMonth + 1}月 (${adj.reason})`; } } } });

          rows.push({ id: t.id, name: t.name, building: building?.name || '未知楼宇', unitNames, area: t.totalArea, category, monthlyValues, monthlyLeasedArea });
      });

      vacantUnits.forEach(u => {
          const assumption = budgetAssumptions.find(a => a.targetId === u.unitId && a.targetType === 'Vacancy');
          let monthlyValues = Array(12).fill(null).map(() => ({ amount: 0, actual: 0, isAdjustedIn:false, isAdjustedOut:false, adjustmentDetail:'' }));
          let monthlyLeasedArea = Array(12).fill(0);
          
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
          }
          rows.push({ id: u.unitId, name: '待租单元', building: u.buildingName, unitNames: u.unitName, area: u.area, category: '空置去化', monthlyValues, monthlyLeasedArea });
      });
      return rows;
  };

  const exportToExcel = () => {
    const monthlyData = generateMonthlyDetail(detailYear);
    const groups = groupData(monthlyData);
    const flattened: any[] = [];
    const isExec = viewMode === 'Execution';
    
    flattened.push([`上海金蝶软件园 ${isExec ? '预算执行跟踪表' : '预算表'}`, "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    flattened.push([`预算年度: ${detailYear}年`, `方案: ${activeScenarioId}`, "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    flattened.push([""]);
    
    const headers = ["客户/单元", "房号", "所属楼宇", "租赁面积", "类别"];
    for(let i=1; i<=12; i++) {
        headers.push(`${i}月${isExec ? '(预算)' : ''}`);
        if(isExec) headers.push(`${i}月(实收)`);
    }
    headers.push("合计");
    flattened.push(headers);

    Object.entries(groups).forEach(([groupName, rows]: [string, any]) => {
        flattened.push([groupName.toUpperCase(), "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
        let groupSum = Array(isExec ? 25 : 13).fill(0);
        
        rows.forEach((r: any) => {
            const rowSum = r.monthlyValues.reduce((a: any, b: any) => a + (isExec ? b.actual : b.amount), 0);
            const rowData = [r.name, r.unitNames, r.building, r.area, r.category];
            
            r.monthlyValues.forEach((v: any, i: number) => {
                rowData.push(v.amount);
                if(isExec) rowData.push(v.actual);
            });
            rowData.push(rowSum);
            flattened.push(rowData);
            
            r.monthlyValues.forEach((v: any, i: number) => {
                if(isExec) {
                    groupSum[i*2] += v.amount;
                    groupSum[i*2+1] += v.actual;
                } else {
                    groupSum[i] += v.amount;
                }
            });
            groupSum[groupSum.length - 1] += rowSum;
        });
        
        flattened.push([`${groupName} 小计`, "", "", "", "", ...groupSum]);
        flattened.push([""]);
    });

    const ws = XLSX.utils.aoa_to_sheet(flattened);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BudgetExecution");
    XLSX.writeFile(wb, `park_budget_${isExec ? 'execution_' : ''}${detailYear}.xlsx`);
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
        reason: adjForm.reason
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

  const groupedAdjustments = useMemo(() => {
    const groups: Record<string, BudgetAdjustment[]> = {};
    budgetAdjustments.forEach(adj => {
        if (!groups[adj.tenantName]) groups[adj.tenantName] = [];
        groups[adj.tenantName].push(adj);
    });
    return groups;
  }, [budgetAdjustments]);

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

  const renderSettingsView = () => {
    return (
        <div className="space-y-6 p-1">
            <div className="flex border-b border-slate-200">
                {activeScenarioId !== 'invoice_dedicated' && (
                    <>
                        <button onClick={() => setActiveTab('Vacancy')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'Vacancy' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>空置去化 ({vacantUnits.length})</button>
                        <button onClick={() => setActiveTab('Renewal')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'Renewal' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>到期续约 ({expiringTenants.length})</button>
                        <button onClick={() => setActiveTab('Risk')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'Risk' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>风险应对 ({riskTenants.length})</button>
                    </>
                )}
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
                        <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="px-4 py-3 sticky left-0 bg-slate-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] w-[220px]">客户/单元</th>
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
                                            <td colSpan={13}></td>
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
                                                        <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-2 gap-y-0.5">
                                                            <span className="bg-slate-100 px-1 rounded font-bold">{row.building}</span>
                                                            <span className="text-blue-500 font-medium">{row.unitNames}</span>
                                                            <span>{row.area}㎡</span>
                                                        </div>
                                                    </td>
                                                    {row.monthlyValues.map((val: any, idx: number) => {
                                                        const isPastMonth = detailYear < currentYearM || (detailYear === currentYearM && idx <= currentMonthM);
                                                        const isOverdue = isPastMonth && val.amount > 0 && (val.actual || 0) < val.amount;
                                                        const isPaid = val.amount > 0 && (val.actual || 0) >= val.amount;

                                                        return (
                                                            <td 
                                                                key={idx} 
                                                                className={`px-2 py-3 text-right relative transition-colors ${isExec && isOverdue ? 'bg-rose-50' : ''} ${val.amount > 0 ? 'text-slate-700' : 'text-slate-300'}`}
                                                                onClick={() => { 
                                                                    if(!isExec && val.amount > 0) { 
                                                                        setAdjData({ tenantId: row.id, tenantName: row.name, originalMonth: idx, amount: val.amount }); 
                                                                        setAdjForm(prev => ({ ...prev, targetMonth: idx === 11 ? 0 : idx + 1 })); 
                                                                        setShowAdjModal(true); 
                                                                    } 
                                                                }}
                                                            >
                                                                {!isExec ? (
                                                                     <span className={val.isAdjustedOut ? 'text-slate-300 line-through' : val.amount > 0 ? 'font-medium' : ''}>
                                                                        {val.amount > 0 ? val.amount.toLocaleString() : '-'}
                                                                    </span>
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
                   <select value={activeScenarioId} onChange={e => setActiveScenarioId(e.target.value)} className="bg-white border border-slate-300 rounded px-3 py-1.5 text-sm min-w-[200px] outline-none focus:ring-2 focus:ring-blue-200 cursor-pointer shadow-sm">
                       <option value="current">🟡 当前实时生效方案 (Live)</option>
                       <option value="invoice_dedicated">🔵 发票/实收专用方案 (Invoice Dedicated)</option>
                       {scenarios.map(s => (<option key={s.id} value={s.id}>{s.name} {s.isActive ? '(✅生效中)' : ''}</option>))}
                   </select>
                   {activeScenarioId !== 'current' && activeScenarioId !== 'invoice_dedicated' && (
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

           {activeScenarioId === 'invoice_dedicated' ? (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold border border-blue-200 animate-in fade-in">
                    <Info size={14} />
                    <span>此模式下仅“存量调优”生效，空置/续签严格按合同执行</span>
                </div>
           ) : (
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
                   {activeScenarioId !== 'current' && !scenarios.find(s => s.id === activeScenarioId)?.isActive && (
                       <button onClick={handleActivateCurrentScenario} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 shadow-sm animate-pulse"><Play size={14} /> 应用此方案</button>
                   )}
               </div>
           )}
       </div>

       <div className="flex-1 min-h-0">
           {viewMode === 'Settings' && renderSettingsView()}
           {(viewMode === 'Monthly' || viewMode === 'Execution') && renderDetailTable()}
       </div>

       {showAdjModal && (
           <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
               <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-50 duration-200">
                   <h3 className="text-lg font-bold text-slate-800 mb-4">调整/缓缴预算</h3>
                   <div className="space-y-4">
                       <div className="bg-slate-50 p-3 rounded text-sm text-slate-600">
                           <p><strong>客户:</strong> {adjData?.tenantName}</p>
                           <p><strong>原计划月份:</strong> {detailYear}年{adjData ? adjData.originalMonth + 1 : ''}月</p>
                           <p><strong>金额:</strong> ¥{adjData?.amount.toLocaleString()}</p>
                       </div>
                       <div><label className="block text-sm font-medium text-slate-700 mb-1">调整至 (年份)</label><input type="number" className="w-full border rounded p-2" value={adjForm.targetYear} onChange={e => setAdjForm({...adjForm, targetYear: Number(e.target.value)})} /></div>
                       <div><label className="block text-sm font-medium text-slate-700 mb-1">调整至 (月份)</label><select className="w-full border rounded p-2" value={adjForm.targetMonth} onChange={e => setAdjForm({...adjForm, targetMonth: Number(e.target.value)})}>{Array.from({length: 12}, (_, i) => <option key={i} value={i}>{i+1}月</option>)}</select></div>
                       <div><label className="block text-sm font-medium text-slate-700 mb-1">调整原因</label><input type="text" className="w-full border rounded p-2" value={adjForm.reason} onChange={e => setAdjForm({...adjForm, reason: e.target.value})} placeholder="例如: 客户申请缓缴" /></div>
                       <div className="flex justify-end gap-2 pt-2"><button onClick={() => setShowAdjModal(false)} className="px-4 py-2 border rounded text-slate-600 hover:bg-slate-50">取消</button><button onClick={saveAdjustment} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">确认调整</button></div>
                   </div>
               </div>
           </div>
       )}

       {showAdjHistory && (
           <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
               <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 animate-in zoom-in-50 duration-200 flex flex-col max-h-[90vh]">
                   <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-4"><h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><History size={20}/> 预算调整记录管理</h3><button onClick={() => setShowAdjHistory(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button></div>
                   <div className="grid grid-cols-2 gap-4 mb-6">
                       <div className="bg-blue-50 border border-blue-100 rounded-lg p-4"><div className="text-xs font-bold text-blue-600 uppercase mb-1">本年度 ({detailYear}) 预算影响</div><div className={`text-2xl font-bold ${impactStats.currentYearNet >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{impactStats.currentYearNet >= 0 ? '+' : ''}¥{impactStats.currentYearNet.toLocaleString()}</div></div>
                       <div className="bg-purple-50 border border-purple-100 rounded-lg p-4"><div className="text-xs font-bold text-purple-600 uppercase mb-1">次年度 ({detailYear + 1}) 预算影响</div><div className={`text-2xl font-bold ${impactStats.nextYearNet >= 0 ? 'text-purple-700' : 'text-red-600'}`}>{impactStats.nextYearNet >= 0 ? '+' : ''}¥{impactStats.nextYearNet.toLocaleString()}</div></div>
                   </div>
                   <div className="flex-1 overflow-y-auto pr-2">{Object.keys(groupedAdjustments).length > 0 ? (<div className="space-y-4">{Object.entries(groupedAdjustments).map(([tenantName, rawAdjs]) => { const adjs = rawAdjs as BudgetAdjustment[]; return (<div key={tenantName} className="border border-slate-200 rounded-lg overflow-hidden"><div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center"><div className="font-bold text-slate-700 flex items-center gap-2"><User size={14} /> {tenantName}</div><span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{adjs.length} 条记录</span></div><div className="divide-y divide-slate-100">{adjs.map(adj => (<div key={adj.id} className="p-3 text-sm flex justify-between items-center hover:bg-slate-50/50 transition-colors"><div><div className="flex items-center gap-2 mb-1">{adj.originalYear !== -1 ? (<span className="text-slate-500 line-through text-xs">{adj.originalYear}/{String(adj.originalMonth+1).padStart(2,'0')}</span>) : <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-1 rounded">ADD</span>}<ArrowRight size={12} className="text-slate-300"/>{adj.adjustedYear !== -1 ? (<span className="text-blue-600 font-medium text-xs">{adj.adjustedYear}/{String(adj.adjustedMonth+1).padStart(2,'0')}</span>) : <span className="text-xs font-bold text-red-600 bg-red-50 px-1 rounded">DEL</span>}<span className="font-bold text-slate-700 ml-2">¥{adj.amount.toLocaleString()}</span></div><div className="text-xs text-slate-400 italic flex items-center gap-1"><Info size={10}/> {adj.reason}</div></div><button onClick={() => deleteAdjustment(adj.id)} className="px-2 py-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="撤销"><Trash2 size={14} /></button></div>))}</div></div>); })}</div>) : (<div className="text-center py-10 flex flex-col items-center justify-center text-slate-400"><FileWarning size={32} className="mb-2 opacity-50"/><p>暂无人工调整记录</p></div>)}</div>
                   <div className="mt-4 pt-4 border-t text-right"><button onClick={() => setShowAdjHistory(false)} className="px-4 py-2 border rounded text-slate-600 hover:bg-slate-50">关闭</button></div>
               </div>
           </div>
       )}

       {showScenarioModal && (
           <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
               <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-50 duration-200">
                   <h3 className="text-lg font-bold text-slate-800 mb-4">新建预算方案</h3>
                   <div className="space-y-4">
                       <div><label className="block text-sm font-medium text-slate-700 mb-1">方案名称</label><input type="text" className="w-full border rounded p-2" value={newScenarioName} onChange={e => setNewScenarioName(e.target.value)} placeholder="例如: 2024激进版预算" autoFocus /></div>
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
