
import React, { useState, useEffect, useMemo } from 'react';
import { Tenant, Building, ContractStatus, DepositStatus, RentFreePeriod, UnitStatus, DashboardData, PaymentRecord } from '../types';
// Added missing UserMinus and Sparkles imports
import { Search, Plus, FileText, Filter, XCircle, AlertTriangle, AlertCircle, Calendar, DollarSign, Edit2, X, Trash2, Users, Save, Building as BuildingIcon, UserCheck, UserPlus, UserMinus, UserX, Info, ShieldAlert, WalletIcon, ArrowLeft, Trash, TrendingUp, TrendingDown, PieChart, Activity, BarChart3, Clock, LayoutDashboard, ArrowUpRight, ArrowDownRight, Sparkles, Briefcase, User, Smartphone, Gift, MapPin, Receipt, CreditCard } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, PieChart as RechartsPieChart, Pie, Legend, ComposedChart, Line } from 'recharts';
import { OccupancyTrendChart, UnitPriceTrendChart } from './Charts';
import { generateBudgetedBills } from '../services/billingService';
import { AIContractRecognitionModal } from './AIContractRecognitionModal';
import * as XLSX from 'xlsx';

interface ContractManagerProps {
  tenants: Tenant[];
  buildings: Building[];
  onUpdateTenants: (tenants: Tenant[]) => void;
  dashboardData?: DashboardData; // 新增：用于图表数据
  payments?: PaymentRecord[]; // 新增：用于关联实际收款
  onUpdatePayments?: (payments: PaymentRecord[]) => void; // 新增：用于更新收款记录
}

const contractStatusTextMap: Record<ContractStatus, string> = {
  [ContractStatus.Active]: '履约中',
  [ContractStatus.Expiring]: '即将到期',
  [ContractStatus.Terminated]: '已退租',
  [ContractStatus.Pending]: '签约中',
  [ContractStatus.Expired]: '已到期',
};

export const ContractManager: React.FC<ContractManagerProps> = ({ tenants, buildings, onUpdateTenants, dashboardData, payments = [], onUpdatePayments }) => {
  const currentCalendarYear = new Date().getFullYear();
  // Default to Analysis tab as requested
  const [activeTab, setActiveTab] = useState<'List' | 'Terminated' | 'Analysis'>('Analysis');
  const [analysisPeriod, setAnalysisPeriod] = useState<'Year' | 'Quarter' | 'Month'>('Year');
  
  const [isEditing, setIsEditing] = useState(false);
  const [currentTenant, setCurrentTenant] = useState<Partial<Tenant>>({});
  const [renewingFromId, setRenewingFromId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBuilding, setFilterBuilding] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [terminateId, setTerminateId] = useState<string | null>(null);
  const [terminateData, setTerminateData] = useState({ date: '', type: 'Normal' as 'Normal' | 'Early', reason: '' });

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

    const newTenant = {
      ...currentTenant,
      id: currentTenant.id || `t${Date.now()}`,
      status: currentTenant.status || ContractStatus.Active,
      rentFreePeriods: currentTenant.rentFreePeriods || [],
      depositAmount: currentTenant.depositAmount || 0,
      depositStatus: currentTenant.depositStatus || DepositStatus.Unpaid,
      paymentCycle: currentTenant.paymentCycle || 'Quarterly',
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

  const handleEdit = (tenant: Tenant) => {
    const derivedPrice = tenant.unitPrice || (tenant.totalArea ? Number((tenant.monthlyRent / tenant.totalArea * 12 / 365).toFixed(2)) : 0);
    setCurrentTenant({ ...tenant, unitPrice: derivedPrice });
    setRenewingFromId(null); setFormErrors({}); setIsEditing(true);
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

  const initiateTermination = (id: string) => {
    setTerminateId(id);
    setTerminateData({ date: new Date().toISOString().split('T')[0], type: 'Normal', reason: '' });
    setShowTerminateModal(true);
  };

  const toggleUnit = (unitId: string, unitArea: number) => {
      const currentIds = currentTenant.unitIds || [];
      const currentTotalArea = currentTenant.totalArea || 0;
      let newIds = currentIds.includes(unitId) ? currentIds.filter(id => id !== unitId) : [...currentIds, unitId];
      let newArea = currentIds.includes(unitId) ? currentTotalArea - unitArea : currentTotalArea + unitArea;
      const areaFixed = Number(newArea.toFixed(2));
      const currentPrice = currentTenant.unitPrice || 0;
      const newMonthlyRent = Number((currentPrice * (365/12) * areaFixed).toFixed(0));
      setCurrentTenant({ ...currentTenant, unitIds: newIds, totalArea: areaFixed, monthlyRent: newMonthlyRent });
  };

  const addRentFree = () => {
    const rf = currentTenant.rentFreePeriods || [];
    setCurrentTenant({ ...currentTenant, rentFreePeriods: [...rf, { start: '', end: '', description: '' }] });
  };

  const updateRentFree = (index: number, field: keyof RentFreePeriod, value: string) => {
    const rf = [...(currentTenant.rentFreePeriods || [])];
    rf[index] = { ...rf[index], [field]: value };
    setCurrentTenant({ ...currentTenant, rentFreePeriods: rf });
  };

  const removeRentFree = (index: number) => {
    const rf = currentTenant.rentFreePeriods?.filter((_, i) => i !== index);
    setCurrentTenant({ ...currentTenant, rentFreePeriods: rf });
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
        
        return matchesSearch && matchesBuilding && matchesStatus;
    }).sort((a,b) => new Date(b.leaseStart).getTime() - new Date(a.leaseStart).getTime());
  }, [tenants, searchTerm, filterBuilding, filterStatus, activeTab]);

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
      if (s === 'Monthly' || s.includes('月')) return 'Monthly';
      if (s === 'SemiAnnual' || s.includes('半年')) return 'SemiAnnual';
      if (s === 'Annual' || s.includes('年')) return 'Annual';
      if (s === 'Quarterly' || s.includes('季')) return 'Quarterly';
      return 'Quarterly';
  };

  const downloadXlsx = (filename: string, rows: any[], sheetName = 'Sheet1') => {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, filename);
  };

  const handleExportTenants = () => {
      const exportRows = filteredTenants.map((t) => {
          const building = buildings.find((b) => b.id === t.buildingId);
          const unitNames = t.unitIds
              .map((uid) => building?.units.find((u) => u.id === uid)?.name || uid)
              .join(',');
          const displayPrice = t.unitPrice || (t.totalArea ? (t.monthlyRent / t.totalArea * 12 / 365) : 0);
          const rf = (t.rentFreePeriods || [])[0];
          return {
              original_id: t.id,
              企业名称: t.name,
              所属行业: t.industry || '',
              所属资产: building?.name || '',
              房号: unitNames,
              签约日期: t.signingDate || '',
              实际入驻日期: t.moveInDate || '',
              起租日期: t.leaseStart,
              结束日期: t.leaseEnd,
              日单价: Number(displayPrice.toFixed(2)),
              月租金: t.monthlyRent || 0,
              面积: t.totalArea || 0,
              支付频率: t.paymentCycle || 'Quarterly',
              支付周期月数: t.paymentCycleMonths ?? '',
              首次收款日期: t.firstPaymentDate || '',
              押金: t.depositAmount || 0,
              免租处理方式: t.freeRentHandling || '',
              免租开始: rf?.start || '',
              免租结束: rf?.end || '',
              免租说明: rf?.description || '',
              合同状态: t.status || '',
              联系人: t.contactName || '',
              联系方式: t.contactInfo || '',
              法人: t.legalRepName || '',
              成立日期: t.foundingDate || '',
              备注: t.specialRequirements || '',
          };
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
              免租开始: '',
              免租结束: '',
              免租说明: '',
              合同状态: 'Active',
              联系人: '',
              联系方式: '',
              法人: '',
              成立日期: '',
              备注: '',
          },
      ];
      downloadXlsx('客户合同导入模板.xlsx', rows, 'template');
  };

  const handleBatchImportFile = async (file: File) => {
      const buf = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const first = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(first, { defval: '' });

      const errors: Array<{ row: number; reason: string; data: Record<string, any> }> = [];
      let updated = 0;
      let created = 0;

      const updatedTenants = [...tenants];

      const findExistingIndex = (row: Record<string, any>): number => {
          const oid = String(row.original_id || row['original_id'] || '').trim();
          if (oid) {
              const i = updatedTenants.findIndex((t) => t.id === oid);
              if (i >= 0) return i;
          }
          const name = String(row['企业名称'] || row.name || '').trim();
          const leaseStart = normalizeDate(row['起租日期'] || row.leaseStart);
          if (!name || !leaseStart) return -1;
          return updatedTenants.findIndex((t) => t.name === name && String(t.leaseStart || '') === leaseStart);
      };

      json.forEach((row, idx) => {
          const rowNo = idx + 2; // header=1
          const name = String(row['企业名称'] || row.name || '').trim();
          const buildingName = row['所属资产'] || row['楼宇'] || row['楼宇名称'] || row.buildingName;
          const buildingId = matchBuildingByName(buildingName) || String(row.buildingId || '').trim();
          const unitNamesRaw = String(row['房号'] || row['租赁单元'] || row.unitNames || '').trim();
          const unitNames = unitNamesRaw
              ? unitNamesRaw.split(/[,，、;\s]+/).map((s) => s.trim()).filter(Boolean)
              : [];
          const unitIds = buildingId ? matchUnitIdsByNames(buildingId, unitNames) : [];

          const signingDate = normalizeDate(row['签约日期'] || row.signingDate);
          const leaseStart = normalizeDate(row['起租日期'] || row.leaseStart);
          const leaseEnd = normalizeDate(row['结束日期'] || row['到期日期'] || row.leaseEnd);
          const moveInDate = normalizeDate(row['实际入驻日期'] || row.moveInDate);

          const unitPrice = parseNumber(row['日单价'] ?? row.unitPrice);
          const monthlyRent = parseNumber(row['月租金'] ?? row.monthlyRent);
          const totalArea = parseNumber(row['面积'] ?? row.totalArea);
          const depositAmount = parseNumber(row['押金'] ?? row.depositAmount);

          const paymentCycle = inferPaymentCycle(row['支付频率'] ?? row.paymentCycle);
          const paymentCycleMonths = parseNumber(row['支付周期月数'] ?? row.paymentCycleMonths);
          const firstPaymentDate = normalizeDate(row['首次收款日期'] ?? row.firstPaymentDate);

          const freeRentHandling = String(row['免租处理方式'] ?? row.freeRentHandling ?? '').trim() as any;
          const rfStart = normalizeDate(row['免租开始'] ?? row.rentFreeStart);
          const rfEnd = normalizeDate(row['免租结束'] ?? row.rentFreeEnd);
          const rfDesc = String(row['免租说明'] ?? row.rentFreeDesc ?? '').trim();

          const status = String(row['合同状态'] ?? row.status ?? '').trim() as any;

          if (!name) {
              errors.push({ row: rowNo, reason: '缺少必填字段：企业名称', data: row });
              return;
          }
          if (!buildingId) {
              errors.push({ row: rowNo, reason: `无法匹配所属资产：${String(buildingName ?? '').trim() || '空'}`, data: row });
              return;
          }
          if (unitNames.length > 0 && unitIds.length === 0) {
              errors.push({ row: rowNo, reason: `无法匹配房号：${unitNamesRaw}`, data: row });
              return;
          }
          if (!leaseStart || !leaseEnd || !signingDate) {
              errors.push({ row: rowNo, reason: '缺少必填字段：签约日期/起租日期/结束日期', data: row });
              return;
          }

          const resolvedTotalArea =
              typeof totalArea === 'number' && Number.isFinite(totalArea) && totalArea > 0
                  ? Number(totalArea.toFixed(2))
                  : unitIds.reduce((sum, uid) => {
                        const b = buildings.find((x) => x.id === buildingId);
                        const u = b?.units.find((x) => x.id === uid);
                        return sum + (u?.area || 0);
                    }, 0);

          const resolvedUnitPrice =
              typeof unitPrice === 'number' && Number.isFinite(unitPrice) && unitPrice > 0
                  ? Number(unitPrice.toFixed(2))
                  : undefined;

          const resolvedMonthlyRent =
              typeof monthlyRent === 'number' && Number.isFinite(monthlyRent) && monthlyRent > 0
                  ? Math.round(monthlyRent)
                  : resolvedUnitPrice && resolvedTotalArea
                    ? Math.round(resolvedUnitPrice * (365 / 12) * resolvedTotalArea)
                    : 0;

          const patch: Tenant = {
              id: String(row.original_id || row['original_id'] || '').trim() || `t${Date.now()}_${idx}`,
              rootId: String(row.rootId || row['root_id'] || '').trim() || undefined,
              name,
              industry: String(row['所属行业'] ?? row.industry ?? '').trim() || undefined,
              contactInfo: String(row['联系方式'] ?? row.contactInfo ?? '').trim() || undefined,
              contactName: String(row['联系人'] ?? row.contactName ?? '').trim() || undefined,
              legalRepName: String(row['法人'] ?? row.legalRepName ?? '').trim() || undefined,
              foundingDate: normalizeDate(row['成立日期'] ?? row.foundingDate) || undefined,
              buildingId,
              unitIds,
              totalArea: Number(Number(resolvedTotalArea || 0).toFixed(2)),
              signingDate,
              moveInDate: moveInDate || undefined,
              leaseStart,
              leaseEnd,
              unitPrice: resolvedUnitPrice,
              monthlyRent: resolvedMonthlyRent,
              rentFreePeriods: rfStart && rfEnd ? [{ start: rfStart, end: rfEnd, description: rfDesc || '免租期' }] : [],
              paymentCycle,
              paymentCycleMonths: typeof paymentCycleMonths === 'number' ? Math.round(paymentCycleMonths) : undefined,
              firstPaymentDate: firstPaymentDate || leaseStart,
              firstPaymentMonths: typeof paymentCycleMonths === 'number' ? Math.round(paymentCycleMonths) : undefined,
              freeRentHandling: freeRentHandling === 'Deduct' || freeRentHandling === 'Defer' ? freeRentHandling : undefined,
              depositAmount: typeof depositAmount === 'number' ? Math.round(depositAmount) : 0,
              depositStatus: DepositStatus.Unpaid,
              status: (status as ContractStatus) || ContractStatus.Active,
              specialRequirements: String(row['备注'] ?? row.specialRequirements ?? '').trim() || undefined,
              isRisk: false,
              contractParkingSpaces: parseNumber(row['约定车位'] ?? row.contractParkingSpaces) as any,
              actualParkingSpaces: parseNumber(row['实际车位'] ?? row.actualParkingSpaces) as any,
              parkingUnitPrice: parseNumber(row['车位单价'] ?? row.parkingUnitPrice),
              keyMoments: [],
          };

          // 已存在则更新（按你选择的策略）
          const existingIndex = findExistingIndex(row);
          if (existingIndex >= 0) {
              const existing = updatedTenants[existingIndex];
              updatedTenants[existingIndex] = { ...existing, ...patch, id: existing.id };
              updated += 1;
          } else {
              updatedTenants.push(patch);
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
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">企业名称 <span className="text-red-500">*</span></label><input type="text" className={`w-full border p-2.5 rounded-lg text-sm ${formErrors.name ? 'border-red-500 bg-red-50' : 'border-slate-300'}`} value={currentTenant.name || ''} onChange={e => setCurrentTenant({...currentTenant, name: e.target.value})} /></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">所属资产 <span className="text-red-500">*</span></label><select className={`w-full border p-2.5 rounded-lg text-sm ${formErrors.buildingId ? 'border-red-500 bg-red-50' : 'border-slate-300'}`} value={currentTenant.buildingId || ''} onChange={e => setCurrentTenant({...currentTenant, buildingId: e.target.value, unitIds: [], totalArea: 0})}>
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
                                            <button key={u.id} onClick={() => toggleUnit(u.id, u.area)} className={`px-2 py-2 rounded text-xs border transition-all ${currentTenant.unitIds?.includes(u.id) ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-105 font-bold' : 'bg-white border-slate-200 hover:border-blue-400'}`}><div>{u.name}</div><div className="opacity-70 font-normal">{u.area}㎡</div></button>
                                        )) : (
                                            <div className="col-span-full text-center py-4 text-slate-400 text-xs italic">
                                                {currentTenant.buildingId ? '该资产下暂无空置单元' : '请先选择左侧所属资产'}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

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
                                                    <td className="px-4 py-2 text-blue-600 font-bold">¥{unitPrice.toFixed(2)}</td>
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

                    {/* 2. Rent & Payments */}
                    <section className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-4">
                        <div className="flex items-center gap-2 text-emerald-600 font-bold mb-2"><DollarSign size={18}/> <span>租金单价与支付</span></div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">日租金单价 (元/㎡/天)</label><div className="relative"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">¥</span><input type="number" step="0.01" className="w-full border border-slate-300 pl-7 pr-3 py-2.5 rounded-lg text-sm font-mono" value={currentTenant.unitPrice || ''} onChange={e => {
                                const price = Number(e.target.value);
                                const rent = Number((price * (365/12) * (currentTenant.totalArea || 0)).toFixed(0));
                                setCurrentTenant({...currentTenant, unitPrice: price, monthlyRent: rent});
                            }} /></div></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">月租金总额 (预估)</label><div className="relative"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">¥</span><input type="number" className="w-full border border-slate-300 pl-7 pr-3 py-2.5 rounded-lg text-sm bg-slate-50 font-bold" value={currentTenant.monthlyRent || ''} onChange={e => setCurrentTenant({...currentTenant, monthlyRent: Number(e.target.value)})} /></div></div>
                            <div>
                                <label className="block text-sm font-medium mb-1.5 text-slate-600">支付频率</label>
                                <select 
                                    className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" 
                                    value={currentTenant.paymentCycle || 'Quarterly'} 
                                    onChange={e => {
                                        const cycle = e.target.value as any;
                                        let months = 3;
                                        if (cycle === 'Monthly') months = 1;
                                        else if (cycle === 'SemiAnnual') months = 6;
                                        else if (cycle === 'Annual') months = 12;
                                        
                                        setCurrentTenant({
                                            ...currentTenant, 
                                            paymentCycle: cycle, 
                                            paymentCycleMonths: months,
                                            firstPaymentMonths: months 
                                        });
                                    }}
                                >
                                    <option value="Monthly">月付</option>
                                    <option value="Quarterly">季付</option>
                                    <option value="SemiAnnual">半年付</option>
                                    <option value="Annual">年付</option>
                                </select>
                            </div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">首期支付日</label><input type="date" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.firstPaymentDate || ''} onChange={e => setCurrentTenant({...currentTenant, firstPaymentDate: e.target.value})} /></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">押金金额</label><div className="relative"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">¥</span><input type="number" className="w-full border border-slate-300 pl-7 pr-3 py-2.5 rounded-lg text-sm" value={currentTenant.depositAmount || ''} onChange={e => setCurrentTenant({...currentTenant, depositAmount: Number(e.target.value)})} /></div></div>
                            <div><label className="block text-sm font-medium mb-1.5 text-slate-600">押金状态</label><select className="w-full border border-slate-300 p-2.5 rounded-lg text-sm" value={currentTenant.depositStatus || DepositStatus.Unpaid} onChange={e => setCurrentTenant({...currentTenant, depositStatus: e.target.value as any})}>
                                <option value={DepositStatus.Unpaid}>待缴</option><option value={DepositStatus.Paid}>已收</option><option value={DepositStatus.Refunded}>已退</option>
                            </select></div>
                        </div>
                    </section>

                    {/* 3. Rent Free Periods */}
                    <section className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm space-y-4">
                         <div className="flex justify-between items-center mb-2">
                             <div className="flex items-center gap-2 text-indigo-600 font-bold"><Gift size={18}/> <span>免租期设定</span></div>
                             <button onClick={addRentFree} className="text-xs font-bold bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-100 flex items-center gap-1 transition-colors"><Plus size={14}/> 添加免租段</button>
                         </div>
                         <div className="space-y-3">
                             {currentTenant.rentFreePeriods?.map((rf, idx) => (
                                 <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 relative group">
                                     <div className="md:col-span-3"><label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">开始日期</label><input type="date" className="w-full border p-2 rounded-lg text-sm" value={rf.start} onChange={e => updateRentFree(idx, 'start', e.target.value)} /></div>
                                     <div className="md:col-span-3"><label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">结束日期</label><input type="date" className="w-full border p-2 rounded-lg text-sm" value={rf.end} onChange={e => updateRentFree(idx, 'end', e.target.value)} /></div>
                                     <div className="md:col-span-5"><label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">说明备注</label><input type="text" placeholder="如：装修免租" className="w-full border p-2 rounded-lg text-sm" value={rf.description} onChange={e => updateRentFree(idx, 'description', e.target.value)} /></div>
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
                         
                         {/* 账单明细预览 */}
                         {currentTenant.rentFreePeriods && currentTenant.rentFreePeriods.length > 0 && 
                          currentTenant.leaseStart && currentTenant.leaseEnd && 
                          currentTenant.monthlyRent && currentTenant.monthlyRent > 0 && 
                          currentTenant.freeRentHandling && (
                             <div className="mt-4 pt-4 border-t border-slate-200">
                                 {(() => {
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
                                         freeRentHandling: currentTenant.freeRentHandling
                                     } as Tenant;
                                     
                                     const previewStart = new Date(currentTenant.leaseStart!);
                                     const previewEnd = new Date(currentTenant.leaseEnd!);
                                     
                                     // 生成合同期内所有账单
                                     const bills = generateBudgetedBills(
                                         tenantForPreview,
                                         [],
                                         [],
                                         previewStart,
                                         previewEnd
                                     ); // 不再限制期数
                                     
                                     if (bills.length === 0) {
                                         return (
                                             <div className="text-center py-4 text-slate-400 text-sm">
                                                 无法生成账单预览，请检查合同信息
                                             </div>
                                         );
                                     }
                                     
                                     // 计算财务汇总
                                     const totalReceivable = bills.reduce((sum, bill) => sum + bill.amount, 0);
                                     
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
                                         ? totalReceivable / totalMonths / currentTenant.totalArea / 30
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
                                                     <div className="text-2xl font-bold text-blue-900">¥{totalReceivable.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                                                     <div className="text-xs text-blue-600 mt-1">合同期内共{bills.length}期</div>
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
                                                     <div className="text-2xl font-bold text-green-900">¥{totalPaid.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                                                     <div className="text-xs text-green-600 mt-1">实际收款{tenantPayments.length}笔</div>
                                                 </div>
                                                 
                                                 <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-xl border border-purple-200">
                                                     <div className="flex items-center gap-2 mb-2">
                                                         <TrendingUp size={16} className="text-purple-600" />
                                                         <span className="text-xs font-bold text-purple-700">月均收款</span>
                                                     </div>
                                                     <div className="text-2xl font-bold text-purple-900">¥{avgMonthlyPayment.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                                                     <div className="text-xs text-purple-600 mt-1">合同共{totalMonths}个月</div>
                                                 </div>
                                                 
                                                <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 rounded-xl border border-amber-200">
                                                     <div className="flex items-center gap-2 mb-2">
                                                         <DollarSign size={16} className="text-amber-600" />
                                                         <span className="text-xs font-bold text-amber-700">实际单价</span>
                                                     </div>
                                                     <div className="text-2xl font-bold text-amber-900">¥{actualDailyPrice.toFixed(2)}</div>
                                                     <div className="text-xs text-amber-600 mt-1">元/天/㎡</div>
                                                 </div>
                                             </div>
                                             
                                             {/* 账单明细表格 */}
                                             <div>
                                                 <div className="flex items-center gap-2 mb-3">
                                                     <Receipt size={18} className="text-blue-600" />
                                                     <span className="text-sm font-bold text-slate-800">应收款明细预览</span>
                                                     <span className="text-xs text-slate-500">（合同期内共{bills.length}期）</span>
                                                 </div>
                                                 <div className="overflow-x-auto max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
                                                     <table className="w-full text-xs">
                                                         <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                                                             <tr>
                                                                 <th className="px-3 py-2 text-left font-bold text-slate-600">期次</th>
                                                                 <th className="px-3 py-2 text-left font-bold text-slate-600">收款日期</th>
                                                                 <th className="px-3 py-2 text-left font-bold text-slate-600">应收金额</th>
                                                                 <th className="px-3 py-2 text-left font-bold text-slate-600">覆盖周期</th>
                                                             </tr>
                                                         </thead>
                                                         <tbody className="divide-y divide-slate-100">
                                                     {bills.map((bill, idx) => {
                                                         // 计算覆盖周期
                                                         const billDate = bill.date;
                                                         const cycleMonths = currentTenant.paymentCycle === 'Monthly' ? 1 : 
                                                                            currentTenant.paymentCycle === 'Quarterly' ? 3 : 
                                                                            currentTenant.paymentCycle === 'SemiAnnual' ? 6 : 12;
                                                         
                                                         // 计算下一个月的开始日期（收款日期后一个月）
                                                         const coverageStart = new Date(billDate);
                                                         coverageStart.setMonth(coverageStart.getMonth() + 1);
                                                         
                                                         const coverageEnd = new Date(coverageStart);
                                                         coverageEnd.setMonth(coverageEnd.getMonth() + cycleMonths);
                                                         coverageEnd.setDate(coverageEnd.getDate() - 1);
                                                         
                                                         const formatDate = (d: Date) => {
                                                             return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                                         };
                                                         
                                                         return (
                                                             <tr key={idx} className="hover:bg-slate-50">
                                                                 <td className="px-3 py-2 text-slate-600">第{idx + 1}期</td>
                                                                 <td className="px-3 py-2 font-bold text-blue-600">{formatDate(billDate)}</td>
                                                                 <td className="px-3 py-2 font-bold text-green-600">¥{bill.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                                                                 <td className="px-3 py-2 text-slate-500">
                                                                     {formatDate(coverageStart)} ~ {formatDate(coverageEnd)}
                                                                 </td>
                                                             </tr>
                                                         );
                                                     })}
                                                         </tbody>
                                                     </table>
                                                     <p className="text-xs text-slate-500 mt-2">
                                                         <span className="text-amber-600">ℹ️ 提示：</span>
                                                         收款日期为当期租金的收取时间，覆盖周期为该笔款项对应的租期范围。
                                                         {currentTenant.freeRentHandling === 'Defer' && '免租期采用账期顺延模式，收款时间会自动顺延。'}
                                                         {currentTenant.freeRentHandling === 'Deduct' && '免租期采用当期扣除模式，应收金额会相应减少。'}
                                                     </p>
                                                 </div>
                                             </div>
                                         </div>
                                     );
                                 })()}
                             </div>
                         )}
                    </section>

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
                                <div><label className="block text-sm font-medium mb-1.5 text-slate-600">特殊要求 / 备注信息</label><textarea className="w-full border border-slate-300 p-2.5 rounded-lg text-sm min-h-[100px]" placeholder="记录任何非标合同条款、装修要求、特殊配套需求等..." value={currentTenant.specialRequirements || ''} onChange={e => setCurrentTenant({...currentTenant, specialRequirements: e.target.value})} /></div>
                            </div>
                        </div>
                    </section>
                </div>

                <div className="flex justify-between items-center px-8 py-6 border-t border-slate-100 bg-white sticky bottom-0 z-20 rounded-b-xl shadow-lg">
                    <div>{currentTenant.id && <button onClick={() => { if(window.confirm("确定删除?")) { onUpdateTenants(tenants.filter(t => t.id !== currentTenant.id)); setIsEditing(false); } }} className="text-rose-500 font-bold flex items-center gap-2 px-4 py-2 hover:bg-rose-50 rounded-lg"><Trash2 size={18}/> 删除记录</button>}</div>
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
         </div>
     )
  }

  return (
    <div className="space-y-6">
      {/* ... keeping Analysis/List/Terminated navigation logic from previous version ... */}
      <div className="flex justify-between items-center">
           <h2 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2"><LayoutDashboard size={22} className="text-blue-600"/> 客户合同中心</h2>
           <div className="flex bg-slate-200/60 p-1 rounded-xl shadow-inner">
               <button onClick={() => setActiveTab('Analysis')} className={`px-5 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'Analysis' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>经营分析</button>
               <button onClick={() => setActiveTab('List')} className={`px-5 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'List' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>在租明细</button>
               <button onClick={() => setActiveTab('Terminated')} className={`px-5 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'Terminated' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>历史退租</button>
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
                         <div className="text-3xl font-black mt-1 tabular-nums">{perfData.metrics.netArea > 0 ? '+' : ''}{perfData.metrics.netArea.toLocaleString()} <span className="text-sm font-normal">㎡</span></div>
                         <div className="mt-4 pt-4 border-t border-white/10 flex justify-between items-center text-[10px]">
                             <div className="flex items-center gap-1"><ArrowUpRight size={12} className="text-emerald-300"/> 新签 {perfData.metrics.signedArea}㎡</div>
                             <div className="flex items-center gap-1"><ArrowDownRight size={12} className="text-rose-300"/> 退租 {perfData.metrics.terminatedArea}㎡</div>
                         </div>
                    </div>
                </div>

                <div className="lg:w-3/4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* New Signings KPI */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between group hover:border-emerald-200 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                            <div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">新签业绩 Signings</p><h3 className="text-3xl font-black text-slate-800 mt-1">{perfData.metrics.signedArea.toLocaleString()} <span className="text-sm font-bold text-slate-400">㎡</span></h3></div>
                            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl group-hover:scale-110 transition-transform"><UserPlus size={24}/></div>
                        </div>
                        <div className="flex items-center gap-6 mt-4">
                            <div className="space-y-1">
                                <div className="text-[10px] font-bold text-slate-400">同比 (YoY)</div>
                                <div className={`flex items-center gap-1 font-black text-sm ${perfData.yoy.area >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                    {perfData.yoy.area >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>}
                                    {Math.abs(perfData.yoy.area).toFixed(1)}%
                                </div>
                            </div>
                            <div className="w-px h-8 bg-slate-100"></div>
                            <div className="space-y-1">
                                <div className="text-[10px] font-bold text-slate-400">环比 (MoM)</div>
                                <div className={`flex items-center gap-1 font-black text-sm ${perfData.mom.area >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                    {perfData.mom.area >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>}
                                    {Math.abs(perfData.mom.area).toFixed(1)}%
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
                            <div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">退租流失 Churn</p><h3 className="text-3xl font-black text-slate-800 mt-1">{perfData.metrics.terminatedArea.toLocaleString()} <span className="text-sm font-bold text-slate-400">㎡</span></h3></div>
                            <div className="p-3 bg-rose-50 text-rose-600 rounded-xl group-hover:scale-110 transition-transform"><UserMinus size={24}/></div>
                        </div>
                        <div className="flex items-center gap-4 mt-4">
                            <div className="bg-rose-50 px-3 py-2 rounded-xl flex-1 border border-rose-100">
                                <div className="text-[10px] font-bold text-rose-400 mb-1">提前退租占比</div>
                                <div className="flex items-end gap-2">
                                    <span className="text-xl font-black text-rose-700">{perfData.earlyRate}%</span>
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
                        <div className="text-2xl font-bold text-red-800">{perfData.earlyRate}%</div>
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
                                                <span className="text-slate-500">({percentage}%)</span>
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
            <div className="flex flex-col md:flex-row gap-3 mb-4 items-center">
                <div className="flex gap-2 w-full md:w-auto">
                    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"><Filter size={16} className="text-slate-400" /><select value={filterBuilding} onChange={e => setFilterBuilding(e.target.value)} className="bg-transparent focus:outline-none text-slate-600 font-medium"><option value="all">所有楼宇</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                    {activeTab === 'List' && (
                        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"><select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-transparent focus:outline-none text-slate-600 font-medium"><option value="all">合同状态</option><option value={ContractStatus.Active}>履约中</option><option value={ContractStatus.Expiring}>即将到期</option><option value="risk">⚠️ 高风险</option></select></div>
                    )}
                </div>
                <div className="flex gap-2 w-full md:w-auto items-center md:ml-auto">
                    <div className="relative flex-1 md:w-64"><Search className="absolute left-3 top-2.5 text-slate-400 w-4 h-4" /><input type="text" placeholder="搜索企业名称..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 outline-none"/></div>
                    {activeTab === 'List' && (
                        <>
                            <button
                                type="button"
                                onClick={handleExportTenants}
                                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 shadow-sm font-bold text-sm"
                                title="导出当前筛选结果"
                            >
                                批量导出
                            </button>
                            <button
                                type="button"
                                onClick={handleDownloadTemplate}
                                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 shadow-sm font-bold text-sm"
                                title="下载导入模板"
                            >
                                下载模板
                            </button>
                            <label className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 shadow-sm font-bold text-sm cursor-pointer" title="批量导入（Excel）">
                                批量导入
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
                            <button
                                type="button"
                                onClick={() => setShowAIContractImport(true)}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md font-bold text-sm flex items-center gap-2"
                                title="上传截图/文本/Excel，由 AI 识别并生成合同草稿"
                            >
                                <Sparkles size={16} /> AI识别导入
                            </button>
                        </>
                    )}
                    {activeTab === 'List' && (
                        <button onClick={() => { setCurrentTenant({ signingDate: new Date().toISOString().split('T')[0], status: ContractStatus.Active, depositStatus: DepositStatus.Unpaid, rentFreePeriods: [], paymentCycle: 'Quarterly', paymentCycleMonths: 3, firstPaymentMonths: 3 }); setIsEditing(true); }} className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md font-bold flex items-center gap-2 transition-all"><Plus size={18} /><span>新签客户</span></button>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm text-left min-w-[920px]">
                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                        <tr><th className="px-6 py-4">客户名称</th><th className="px-6 py-4">租赁位置</th><th className="px-6 py-4">{activeTab === 'Terminated' ? '退租日期' : '起租日期'}</th><th className="px-6 py-4">实际入驻</th><th className="px-6 py-4">合同期 & 单价</th><th className="px-6 py-4 text-right">操作</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {activeTab === 'List' ? buildingFloorGroups.map(group => (
                            <React.Fragment key={group.buildingId}>
                                <tr className="bg-blue-50/40 border-y border-slate-100">
                                    <td colSpan={6} className="px-6 py-2 font-bold text-xs text-blue-800">{group.buildingName} ({group.floors.reduce((acc, f) => acc + f.tenants.length, 0)}家)</td>
                                </tr>
                                {group.floors.map(fg => (
                                    <React.Fragment key={`${group.buildingId}_${fg.floorLabel}`}>
                                        <tr className="bg-slate-50/60 border-y border-slate-100">
                                            <td colSpan={6} className="px-6 py-2 font-semibold text-[11px] text-slate-600">{fg.floorLabel} ({fg.tenants.length}家)</td>
                                        </tr>
                                        {fg.tenants.map(t => {
                                            const building = buildings.find(b => b.id === t.buildingId);
                                            const unitNames = t.unitIds.map(uid => building?.units.find(u => u.id === uid)?.name || uid).join(', ');
                                            const displayPrice = t.unitPrice || (t.totalArea ? (t.monthlyRent / t.totalArea * 12 / 365) : 0);
                                            const contractYear = Number((t.signingDate || t.leaseStart || '').slice(0, 4));
                                            const isThisYearContract = contractYear === currentCalendarYear;
                                            const isRenewalContract = Boolean(t.rootId);
                                            return (
                                                <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-slate-800">{t.name}</span>
                                                            {isThisYearContract && (
                                                                <span className={`text-[10px] px-2 py-0.5 rounded-md border font-bold ${isRenewalContract ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-cyan-50 text-cyan-700 border-cyan-200'}`}>
                                                                    {isRenewalContract ? '本年续租' : '本年新签'}
                                                                </span>
                                                            )}
                                                            {t.isRisk && <ShieldAlert size={14} className="text-red-500" />}
                                                            {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Defer' && (
                                                                <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-200 font-bold">账期顺延</span>
                                                            )}
                                                            {t.rentFreePeriods && t.rentFreePeriods.length > 0 && t.freeRentHandling === 'Deduct' && (
                                                                <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-md border border-green-200 font-bold">当期扣除</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-slate-600">{building?.name} <span className="text-xs bg-slate-100 px-1 rounded font-medium">{unitNames}</span></td>
                                                    <td className="px-6 py-4"><div className="text-slate-700 font-bold">{t.leaseStart}</div></td>
                                                    <td className="px-6 py-4 text-slate-600 text-xs">{t.moveInDate ? <span className="font-medium text-slate-800">{t.moveInDate}</span> : <span className="text-slate-400">同起租</span>}</td>
                                                    <td className="px-6 py-4"><div className="text-slate-500 text-xs">{t.leaseStart} ~ {t.leaseEnd}</div><div className="text-blue-600 font-bold">¥{displayPrice.toFixed(2)}</div></td>
                                                    <td className="px-6 py-4 text-right space-x-3"><button onClick={() => handleEdit(t)} className="text-blue-600 font-bold text-xs hover:underline">详情</button>{(t.status === ContractStatus.Expiring || t.status === ContractStatus.Active) && <button onClick={() => handleRenewal(t)} className="text-emerald-600 font-bold text-xs hover:underline">续签</button>}{t.status !== ContractStatus.Terminated && <button onClick={() => initiateTermination(t.id)} className="text-amber-600 font-bold text-xs hover:underline">退租</button>}</td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                ))}
                            </React.Fragment>
                        )) : sortedYears.map(group => (
                            <React.Fragment key={group.year}>
                                <tr className={`${activeTab === 'Terminated' ? 'bg-rose-50/30' : 'bg-blue-50/30'} border-y border-slate-100`}><td colSpan={6} className={`px-6 py-2 font-bold text-xs ${activeTab === 'Terminated' ? 'text-rose-800' : 'text-blue-800'}`}>{group.year}年度{activeTab === 'Terminated' ? '退租' : '起租'} ({group.tenants.length}家)</td></tr>
                                {group.tenants.map(t => {
                                    const building = buildings.find(b => b.id === t.buildingId);
                                    const unitNames = t.unitIds.map(uid => building?.units.find(u => u.id === uid)?.name || uid).join(', ');
                                    const displayPrice = t.unitPrice || (t.totalArea ? (t.monthlyRent / t.totalArea * 12 / 365) : 0);
                                    return (
                                        <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-slate-800">{t.name}</span>
                                                    {t.isRisk && <ShieldAlert size={14} className="text-red-500" />}
                                                    {/* 免租期处理方式标识 */}
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
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-600">{building?.name} <span className="text-xs bg-slate-100 px-1 rounded font-medium">{unitNames}</span></td>
                                            <td className="px-6 py-4">{activeTab === 'Terminated' ? <div className="text-rose-600 font-bold">{t.terminationDate || t.leaseEnd}</div> : <div className="text-slate-700 font-bold">{t.leaseStart}</div>}</td>
                                            <td className="px-6 py-4 text-slate-600 text-xs">{t.moveInDate ? <span className="font-medium text-slate-800">{t.moveInDate}</span> : <span className="text-slate-400">同起租</span>}</td>
                                            <td className="px-6 py-4"><div className="text-slate-500 text-xs">{t.leaseStart} ~ {t.leaseEnd}</div><div className="text-blue-600 font-bold">¥{displayPrice.toFixed(2)}</div></td>
                                            <td className="px-6 py-4 text-right space-x-3"><button onClick={() => handleEdit(t)} className="text-blue-600 font-bold text-xs hover:underline">详情</button></td>
                                        </tr>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </tbody>
                    </table>
                </div>
            </div>
          </>
      )}

      {showTerminateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
             <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-sm border border-slate-200 animate-in zoom-in-50 duration-200">
                <h3 className="font-bold text-lg mb-4 text-slate-800">办理退租</h3>
                <div className="space-y-4">
                    <div><label className="block text-sm text-slate-600 mb-1">退租日期</label><input type="date" value={terminateData.date} onChange={e => setTerminateData({...terminateData, date: e.target.value})} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-amber-100 outline-none" /></div>
                    <div><label className="block text-sm text-slate-600 mb-1">退租类型</label><select value={terminateData.type} onChange={e => setTerminateData({...terminateData, type: e.target.value as any})} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-amber-100 outline-none"><option value="Normal">正常到期退租</option><option value="Early">提前违约退租</option></select></div>
                    <div><label className="block text-sm text-slate-600 mb-1">退租原因</label><select value={terminateData.reason} onChange={e => setTerminateData({...terminateData, reason: e.target.value})} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-amber-100 outline-none"><option value="">请选择原因...</option><option value="合同到期不续约">合同到期不续约</option><option value="由于规模扩张搬迁">由于规模扩张搬迁</option><option value="业务收缩搬迁">业务收缩搬迁</option><option value="经营困难结业">经营困难结业</option><option value="物业环境/服务问题">物业环境/服务问题</option><option value="其他原因">其他原因</option></select></div>
                    <div className="flex justify-end gap-2 mt-6"><button onClick={() => setShowTerminateModal(false)} className="px-4 py-2 text-slate-600">取消</button><button onClick={() => { if (terminateId) { const updatedTenants = tenants.map(t => t.id === terminateId ? { ...t, status: ContractStatus.Terminated, terminationDate: terminateData.date, terminationType: terminateData.type, terminationReason: terminateData.reason } : t); onUpdateTenants(updatedTenants); setShowTerminateModal(false); setTerminateId(null); }}} className="px-6 py-2 bg-amber-600 text-white rounded-lg font-bold">确认退租</button></div>
                </div>
             </div>
          </div>
      )}

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
    </div>
  );
};
