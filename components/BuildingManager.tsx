
import React, { useEffect, useState, useMemo } from 'react';
import { Building, Unit, UnitStatus, Tenant, ContractStatus } from '../types';
import { Plus, Trash2, Edit2, Home, Info, X, Users, Scissors, Coffee, Car, Maximize, Unlock, ShieldCheck, LayoutGrid, LayoutList, Percent, Building2 as Building2Icon, MapPin, FileSpreadsheet, Download, Upload } from 'lucide-react';
import { formatArea, formatNumber, formatPercent } from '../services/numberFormat';
import { buildingImportReadmeRows, syncTenantFromBuildingImportRow } from '../services/buildingImportContractSync';
import { buildParkAreaMetricsByBuilding, type ParkAreaMetrics } from '../services/parkAreaMetrics';
import { readFirstSheetRows, writeXlsxRows, writeXlsxWorkbook } from '../services/xlsxLoader';
import {
  buildActiveTenantByUnitId,
  buildActiveThenTerminatedTenantByUnitId,
} from '../services/unitTenantLookup';
import { useMobileSheetFocus } from './useMobileSheetFocus';
import {
  BuildingMobileBatchStatusSheet,
  BuildingMobileQuickUnitSheet,
} from './BuildingMobileActionSheets';

interface BuildingManagerProps {
  buildings: Building[];
  tenants: Tenant[];
  /** 与看板 / OpenClaw 快照同源，由 App 传入 processedData 指标 */
  parkAreaMetrics: ParkAreaMetrics;
  onUpdateBuildings: (buildings: Building[]) => void;
  onCommitBuildingsTenants: (buildings: Building[], tenants: Tenant[]) => void;
}

function findBuildingIdContainingUnit(buildings: Building[], unitId: string): string | undefined {
  for (const b of buildings) {
    if (b.units.some(u => u.id === unitId)) return b.id;
  }
  return undefined;
}

/** 按「楼层×100+序号」规则生成下一个数字房号；无法解析时退回楼层-序号形式 */
function nextUnitNameForFloor(floor: number, units: Unit[]): string {
  const onFloor = units.filter(u => u.floor === floor);
  const numeric = onFloor
    .map(u => u.name.trim())
    .filter(name => /^\d+$/.test(name))
    .map(name => parseInt(name, 10));
  const base = floor * 100;
  if (numeric.length === 0) return String(base + 1);
  const max = Math.max(...numeric);
  return String(max >= base ? max + 1 : base + 1);
}

function collectUnitIds(buildings: Building[]): Set<string> {
  const s = new Set<string>();
  buildings.forEach(b => b.units.forEach(u => s.add(u.id)));
  return s;
}

function allocUnitId(buildingId: string, name: string, ids: Set<string>): string {
  let id = `${buildingId}-${name}`;
  if (!ids.has(id)) return id;
  let i = 2;
  while (ids.has(`${buildingId}-${name}-${i}`)) i += 1;
  return `${buildingId}-${name}-${i}`;
}

const EMPTY_BUILDING_AREA_METRICS: ParkAreaMetrics = {
  campusTotalArea: 0,
  selfUseArea: 0,
  leasableArea: 0,
  leasedArea: 0,
  vacantArea: 0,
  occupancyRate: 0,
  leasableUnits: 0,
  leasedUnits: 0,
  vacantUnits: 0,
};

type BuildingPromptTone = 'blue' | 'cyan' | 'amber' | 'rose' | 'slate';

type BuildingPromptState = {
  kind: 'notice' | 'confirm';
  title: string;
  message?: string;
  tone?: BuildingPromptTone;
  confirmText?: string;
  cancelText?: string;
  resolve?: (result?: boolean) => void;
};

type UnitListRow = {
  unit: Unit;
  tenant?: Tenant;
  statusLabel: string;
  statusTone: 'vacant' | 'self' | 'occupied' | 'reserved';
  tenantLine: string;
  hasSpecialRequirements: boolean;
};

const buildingGhostButtonClass = 'liquid-glass-control liquid-pressable inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-slate-700 disabled:pointer-events-none disabled:opacity-45';

const buildingPromptToneClass = (tone: BuildingPromptTone = 'blue'): string => {
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

const BuildingPromptOverlay: React.FC<{
  prompt: BuildingPromptState;
  onClose: (result?: boolean) => void;
}> = ({ prompt, onClose }) => {
  const toneClass = buildingPromptToneClass(prompt.tone || 'blue');
  const dismissPrompt = () => {
    onClose(prompt.kind === 'confirm' ? false : true);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      dismissPrompt();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prompt.kind, onClose]);

  return (
    <div className="monthly-detail-backdrop fixed inset-0 z-[90] flex items-end justify-center p-0 md:items-center md:p-4" onClick={dismissPrompt}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="building-prompt-title"
        onClick={(event) => event.stopPropagation()}
        className="monthly-detail-panel liquid-glass-panel flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] md:rounded-[28px]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/70 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`liquid-glass-readable inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${toneClass}`}>
              <Info size={18} />
            </span>
            <div className="min-w-0">
              <h3 id="building-prompt-title" className="text-base font-black text-slate-950">{prompt.title}</h3>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">
                {prompt.kind === 'confirm' ? '请确认后继续' : '系统提示'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissPrompt}
            className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:bg-white/75 hover:text-slate-900"
            aria-label="关闭楼宇提示"
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
        <div className="grid grid-cols-2 gap-2 border-t border-white/70 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:flex md:justify-end md:pb-4">
          {prompt.kind === 'confirm' ? (
            <button type="button" onClick={() => onClose(false)} className={buildingGhostButtonClass}>
              {prompt.cancelText || '取消'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onClose(true)}
            className={`${prompt.kind === 'confirm' ? '' : 'col-span-2 '}liquid-action-strong liquid-pressable rounded-full px-5 py-2.5 text-sm font-black text-white`}
          >
            {prompt.confirmText || (prompt.kind === 'confirm' ? '确认' : '知道了')}
          </button>
        </div>
      </section>
    </div>
  );
};

export const BuildingManager: React.FC<BuildingManagerProps> = ({ buildings, tenants, parkAreaMetrics, onUpdateBuildings, onCommitBuildingsTenants }) => {
  const [activeBuildingId, setActiveBuildingId] = useState<string>(buildings[0]?.id || '');
  const [buildingPrompt, setBuildingPrompt] = useState<BuildingPromptState | null>(null);
  const showBuildingNotice = React.useCallback((prompt: Omit<BuildingPromptState, 'kind' | 'resolve'>) => (
    new Promise<void>((resolve) => {
      setBuildingPrompt({
        kind: 'notice',
        confirmText: '知道了',
        tone: 'blue',
        ...prompt,
        resolve: () => resolve(),
      });
    })
  ), []);
  const showBuildingConfirm = React.useCallback((prompt: Omit<BuildingPromptState, 'kind' | 'resolve'>) => (
    new Promise<boolean>((resolve) => {
      setBuildingPrompt({
        kind: 'confirm',
        confirmText: '确认',
        cancelText: '取消',
        tone: 'amber',
        ...prompt,
        resolve: (result) => resolve(result === true),
      });
    })
  ), []);
  const closeBuildingPrompt = React.useCallback((result?: boolean) => {
    setBuildingPrompt((current) => {
      current?.resolve?.(result);
      return null;
    });
  }, []);

  const [unitDrawerOpen, setUnitDrawerOpen] = useState(false);
  const [buildingDrawerOpen, setBuildingDrawerOpen] = useState(false);
  const [mobileQuickUnitId, setMobileQuickUnitId] = useState<string | null>(null);
  const [mobileBatchMode, setMobileBatchMode] = useState(false);
  const [mobileSelectedUnitIds, setMobileSelectedUnitIds] = useState<string[]>([]);
  const [mobileBatchSheetOpen, setMobileBatchSheetOpen] = useState(false);

  const [editingUnit, setEditingUnit] = useState<Partial<Unit> & { isNew?: boolean }>({});
  /** 保存/编辑时目标所属楼栋（新建单元固定为当前 Tab 楼栋） */
  const [unitTargetBuildingId, setUnitTargetBuildingId] = useState<string>('');
  const [editingBuilding, setEditingBuilding] = useState<Partial<Building> & { isNew?: boolean }>({});

  const [showSplitForm, setShowSplitForm] = useState(false);
  const [splitData, setSplitData] = useState({ currentArea: 0, newUnitName: '' });

  /** 当前楼栋详情区视图：条带化「平面图」示意 vs 表格列表（方案 E） */
  const [buildingDetailView, setBuildingDetailView] = useState<'plan' | 'list'>('plan');

  // 批量导入相关状态
  const [importErrors, setImportErrors] = useState<Array<{ row: number; reason: string; data: Record<string, any> }>>([]);
  const [importSummary, setImportSummary] = useState<
    null | { total: number; success: number; updated: number; created: number; failed: number; contractsSynced: number }
  >(null);
  const [showImportResult, setShowImportResult] = useState(false);

  const closeImportResult = () => {
    setShowImportResult(false);
  };

  const activeBuilding = buildings.find(b => b.id === activeBuildingId);

  const globalStats = parkAreaMetrics;
  const buildingAreaMetricsById = useMemo(
    () => buildParkAreaMetricsByBuilding(buildings, tenants),
    [buildings, tenants],
  );
  const activeTenantByUnitId = useMemo(
    () => buildActiveTenantByUnitId(tenants),
    [tenants],
  );
  const exportTenantByUnitId = useMemo(
    () => buildActiveThenTerminatedTenantByUnitId(tenants),
    [tenants],
  );

  const buildingStats = activeBuilding ? (() => {
      const perBuilding = buildingAreaMetricsById.get(activeBuilding.id) || EMPTY_BUILDING_AREA_METRICS;
      const totalUnits = activeBuilding.units.length;
      return {
          totalUnits,
          totalArea: perBuilding.campusTotalArea,
          leasableArea: perBuilding.leasableArea,
          occupiedArea: perBuilding.leasedArea,
          rate: perBuilding.occupancyRate,
          selfUseArea: perBuilding.selfUseArea,
          leasableUnits: perBuilding.leasableUnits,
          leasedUnits: perBuilding.leasedUnits,
      };
  })() : null;

  const unitsByFloor = useMemo(() => {
    if (!activeBuilding) return {};
    const groups: Record<number, Unit[]> = {};
    activeBuilding.units.forEach(u => {
      if (!groups[u.floor]) groups[u.floor] = [];
      groups[u.floor].push(u);
    });
    Object.keys(groups).forEach(floor => {
        groups[Number(floor)].sort((a, b) => a.name.localeCompare(b.name));
    });
    return groups;
  }, [activeBuilding]);

  const unitListRows = useMemo<UnitListRow[]>(() => (
    Object.keys(unitsByFloor)
      .sort((a, b) => Number(b) - Number(a))
      .flatMap(floorKey =>
        (unitsByFloor[Number(floorKey)] ?? []).map((unit: Unit) => {
          const tenant = activeTenantByUnitId.get(unit.id);
          const isSelfUse = unit.isSelfUse;
          let statusLabel = '待租';
          let statusTone: UnitListRow['statusTone'] = 'vacant';
          if (isSelfUse) {
            statusLabel = '自用';
            statusTone = 'self';
          } else if (unit.status === UnitStatus.Occupied) {
            statusLabel = '已租';
            statusTone = 'occupied';
          } else if (unit.status === UnitStatus.Reserved) {
            statusLabel = '预留';
            statusTone = 'reserved';
          }
          const tenantLine = isSelfUse
            ? '自用保留'
            : unit.status === UnitStatus.Vacant
              ? '—'
              : tenant?.name || '已租';
          return {
            unit,
            tenant,
            statusLabel,
            statusTone,
            tenantLine,
            hasSpecialRequirements: Boolean(tenant?.specialRequirements && !isSelfUse),
          };
        })
      )
  ), [activeTenantByUnitId, unitsByFloor]);

  const mobileSelectableUnitRows = useMemo(
    () => unitListRows.filter(({ unit, tenant }) => unit.status !== UnitStatus.Occupied && !tenant),
    [unitListRows],
  );
  const mobileSelectedUnitIdSet = useMemo(() => new Set(mobileSelectedUnitIds), [mobileSelectedUnitIds]);
  const mobileSelectedUnitRows = useMemo(
    () => mobileSelectableUnitRows.filter(({ unit }) => mobileSelectedUnitIdSet.has(unit.id)),
    [mobileSelectableUnitRows, mobileSelectedUnitIdSet],
  );
  const mobileUnitRowsByFloor = useMemo(() => (
    Object.keys(unitsByFloor)
      .sort((a, b) => Number(b) - Number(a))
      .map((floorKey) => {
        const floor = Number(floorKey);
        const rows = unitListRows.filter(({ unit }) => unit.floor === floor);
        const selectableCount = rows.filter(({ unit, tenant }) => unit.status !== UnitStatus.Occupied && !tenant).length;
        return { floor, rows, selectableCount };
      })
      .filter(({ rows }) => rows.length > 0)
  ), [unitListRows, unitsByFloor]);

  const mobileQuickUnitContext = useMemo(() => {
    if (!mobileQuickUnitId) return null;
    for (const building of buildings) {
      const unit = building.units.find((candidate) => candidate.id === mobileQuickUnitId);
      if (!unit) continue;
      const tenant = activeTenantByUnitId.get(unit.id);
      const locked = unit.status === UnitStatus.Occupied || Boolean(tenant);
      const statusTone: UnitListRow['statusTone'] = unit.isSelfUse
        ? 'self'
        : unit.status === UnitStatus.Occupied
          ? 'occupied'
          : unit.status === UnitStatus.Reserved
            ? 'reserved'
            : 'vacant';
      const statusLabel = unit.isSelfUse
        ? '自用'
        : unit.status === UnitStatus.Occupied
          ? '已租'
          : unit.status === UnitStatus.Reserved
            ? '预留'
            : '待租';
      const tenantLine = unit.isSelfUse ? '自用保留' : tenant?.name || (unit.status === UnitStatus.Vacant ? '—' : '已租');
      return { building, unit, tenant, locked, statusTone, statusLabel, tenantLine };
    }
    return null;
  }, [activeTenantByUnitId, buildings, mobileQuickUnitId]);
  const isMobileQuickUnitSheetOpen = Boolean(mobileQuickUnitContext);
  const isMobileBatchSheetVisible = mobileBatchSheetOpen && mobileSelectedUnitRows.length > 0;

  const closeMobileQuickUnitSheet = React.useCallback(() => setMobileQuickUnitId(null), []);
  const closeMobileBatchSheet = React.useCallback(() => setMobileBatchSheetOpen(false), []);
  const {
    triggerRef: mobileQuickTriggerRef,
    initialFocusRef: mobileQuickCloseButtonRef,
    sheetRef: mobileQuickSheetRef,
  } = useMobileSheetFocus<HTMLButtonElement, HTMLButtonElement, HTMLElement>({
    isOpen: isMobileQuickUnitSheetOpen,
    onEscape: closeMobileQuickUnitSheet,
  });
  const {
    triggerRef: mobileBatchTriggerRef,
    initialFocusRef: mobileBatchCloseButtonRef,
    sheetRef: mobileBatchSheetRef,
  } = useMobileSheetFocus<HTMLButtonElement, HTMLButtonElement, HTMLElement>({
    isOpen: isMobileBatchSheetVisible,
    onEscape: closeMobileBatchSheet,
  });

  useEffect(() => {
    if (!showImportResult) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeImportResult();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showImportResult]);

  React.useEffect(() => {
    const selectable = new Set(mobileSelectableUnitRows.map(({ unit }) => unit.id));
    setMobileSelectedUnitIds((prev) => prev.filter((id) => selectable.has(id)));
  }, [mobileSelectableUnitRows]);

  React.useEffect(() => {
    setMobileBatchMode(false);
    setMobileSelectedUnitIds([]);
    setMobileBatchSheetOpen(false);
    setMobileQuickUnitId(null);
  }, [activeBuildingId]);

  const maxFloorInActive = useMemo(() => {
    if (!activeBuilding || !activeBuilding.units.length) return 0;
    return Math.max(...activeBuilding.units.map(u => u.floor));
  }, [activeBuilding]);

  const quickAddBuilding = () => {
    const buildingCount = buildings.filter(b => b.type !== 'Site').length;
    const id = `b${Date.now()}`;
    const newBuilding: Building = {
      id,
      name: `新${buildingCount + 1}号楼`,
      units: [],
      type: 'Building',
    };
    onUpdateBuildings([...buildings, newBuilding]);
    setActiveBuildingId(id);
  };

  const openBuildingDrawer = (isNew: boolean) => {
    if (isNew) {
      setEditingBuilding({ name: '', isNew: true, type: 'Building' });
    } else if (activeBuilding) {
      setEditingBuilding({ ...activeBuilding, isNew: false });
    }
    setBuildingDrawerOpen(true);
  };

  const saveBuilding = async () => {
    if (!editingBuilding.name) {
       await showBuildingNotice({
         title: '请输入资产名称',
         message: '保存资产前需要先填写名称。',
         tone: 'amber',
       });
       return;
    }
    if (editingBuilding.isNew) {
      const newBuilding: Building = {
          id: `b${Date.now()}`,
          name: editingBuilding.name,
          units: [],
          type: editingBuilding.type || 'Building'
      };
      onUpdateBuildings([...buildings, newBuilding]);
      setActiveBuildingId(newBuilding.id);
    } else {
      const updated = buildings.map(b => b.id === editingBuilding.id ? {
          ...b,
          name: editingBuilding.name!,
          type: editingBuilding.type
      } : b);
      onUpdateBuildings(updated);
    }
    setBuildingDrawerOpen(false);
  };

  const handleDeleteBuilding = async (id: string) => {
    const confirmed = await showBuildingConfirm({
      title: '删除资产',
      message: '确定要删除该资产吗？此操作不可恢复。',
      tone: 'rose',
      confirmText: '删除',
    });
    if (confirmed) {
      const newBuildings = buildings.filter(b => b.id !== id);
      onUpdateBuildings(newBuildings);
      if (activeBuildingId === id && newBuildings.length > 0) {
        setActiveBuildingId(newBuildings[0].id);
      }
    }
  };

  const addUnitOnFloor = (floor: number) => {
    if (!activeBuilding) return;
    const name = nextUnitNameForFloor(floor, activeBuilding.units);
    const ids = collectUnitIds(buildings);
    const id = allocUnitId(activeBuilding.id, name, ids);
    const prefix = `${activeBuilding.id}-`;
    const displayName = id.startsWith(prefix) ? id.slice(prefix.length) : name;
    const newUnit: Unit = {
      id,
      name: displayName,
      floor,
      area: 100,
      status: UnitStatus.Vacant,
      isSelfUse: false,
    };
    const updatedBuildings = buildings.map(b =>
      b.id === activeBuilding.id ? { ...b, units: [...b.units, newUnit].sort((x, y) => x.name.localeCompare(y.name)) } : b
    );
    onUpdateBuildings(updatedBuildings);
  };

  const addNewTopFloorUnit = () => {
    if (!activeBuilding) return;
    const nextFloor = maxFloorInActive > 0 ? maxFloorInActive + 1 : 1;
    addUnitOnFloor(nextFloor);
  };

  const openUnitDrawer = (unit: Unit) => {
    const bid = findBuildingIdContainingUnit(buildings, unit.id) || activeBuildingId;
    setMobileQuickUnitId(null);
    setMobileBatchSheetOpen(false);
    setMobileBatchMode(false);
    setMobileSelectedUnitIds([]);
    setEditingUnit({ ...unit, isNew: false });
    setUnitTargetBuildingId(bid);
    setShowSplitForm(false);
    setSplitData({ currentArea: unit.area, newUnitName: `${unit.name}-B` });
    setUnitDrawerOpen(true);
  };

  const closeUnitDrawer = () => {
    setUnitDrawerOpen(false);
  };

  const saveUnit = async () => {
    if (!editingUnit.name || !editingUnit.area || !editingUnit.floor) {
        await showBuildingNotice({
          title: '请填写完整的单元信息',
          message: '单元名称、面积和楼层均为必填项。',
          tone: 'amber',
        });
        return;
    }
    const targetBid = editingUnit.isNew ? (activeBuilding?.id || '') : unitTargetBuildingId;
    if (!targetBid) return;

    const targetBuilding = buildings.find(b => b.id === targetBid);
    if (!targetBuilding) return;

    const floorNum = Number(editingUnit.floor);
    const areaNum = Number(Number(editingUnit.area).toFixed(2));

    if (editingUnit.isNew) {
      const ids = collectUnitIds(buildings);
      const id = allocUnitId(targetBid, editingUnit.name, ids);
      const newUnitData: Unit = {
        id,
        name: editingUnit.name,
        floor: floorNum,
        area: areaNum,
        status: editingUnit.status || UnitStatus.Vacant,
        isSelfUse: editingUnit.isSelfUse || false,
      };
      const updatedBuildings = buildings.map(b =>
        b.id === targetBid
          ? { ...b, units: [...b.units, newUnitData].sort((x, y) => x.name.localeCompare(y.name)) }
          : b
      );
      onUpdateBuildings(updatedBuildings);
      closeUnitDrawer();
      return;
    }

    const oldId = editingUnit.id as string;
    const sourceBid = findBuildingIdContainingUnit(buildings, oldId);
    if (!sourceBid) return;

    const sameBuilding = sourceBid === targetBid;
    const nameChanged = editingUnit.name !== (targetBuilding.units.find(u => u.id === oldId)?.name);
    let newId = oldId;
    if (!sameBuilding || nameChanged) {
      const ids = collectUnitIds(buildings);
      ids.delete(oldId);
      newId = allocUnitId(targetBid, editingUnit.name, ids);
    }

    const newUnitData: Unit = {
      id: newId,
      name: editingUnit.name,
      floor: floorNum,
      area: areaNum,
      status: editingUnit.status || UnitStatus.Vacant,
      isSelfUse: editingUnit.isSelfUse || false,
    };

    if (sameBuilding && newId === oldId) {
      const updatedBuildings = buildings.map(b => {
        if (b.id !== sourceBid) return b;
        const newUnits = b.units.map(u => (u.id === oldId ? newUnitData : u));
        newUnits.sort((x, y) => x.name.localeCompare(y.name));
        return { ...b, units: newUnits };
      });
      onUpdateBuildings(updatedBuildings);
      closeUnitDrawer();
      return;
    }

    const tenantsOnUnit = tenants.filter(t => t.unitIds.includes(oldId));
    if (!sameBuilding && tenantsOnUnit.some(t => t.status === ContractStatus.Active)) {
      await showBuildingNotice({
        title: '无法变更所属楼宇',
        message: '该单元已有在履约中的租户。请先调整或退租相关合同后，再变更所属楼宇。',
        tone: 'amber',
      });
      return;
    }

    const updatedBuildings = buildings.map(b => {
      if (b.id === sourceBid && b.id === targetBid) {
        const newUnits = b.units.map(u => (u.id === oldId ? newUnitData : u));
        newUnits.sort((x, y) => x.name.localeCompare(y.name));
        return { ...b, units: newUnits };
      }
      if (b.id === sourceBid) {
        return { ...b, units: b.units.filter(u => u.id !== oldId) };
      }
      if (b.id === targetBid) {
        const merged = [...b.units.filter(u => u.id !== newId), newUnitData];
        merged.sort((x, y) => x.name.localeCompare(y.name));
        return { ...b, units: merged };
      }
      return b;
    });

    const updatedTenants = tenants.map(t => {
      if (!t.unitIds.includes(oldId)) return t;
      const nextIds = t.unitIds.map(uid => (uid === oldId ? newId : uid));
      const nextBuildingId = sourceBid !== targetBid ? targetBid : t.buildingId;
      return { ...t, unitIds: nextIds, buildingId: nextBuildingId };
    });

    onCommitBuildingsTenants(updatedBuildings, updatedTenants);
    closeUnitDrawer();
  };

  const handleSplitUnit = async () => {
      const sourceBid = editingUnit.id ? findBuildingIdContainingUnit(buildings, editingUnit.id) : undefined;
      const b = sourceBid ? buildings.find(x => x.id === sourceBid) : activeBuilding;
      if (!b || !editingUnit.id) return;
      if (splitData.currentArea >= (editingUnit.area || 0)) {
          await showBuildingNotice({
              title: '拆分面积不合法',
              message: '拆分后的当前单元面积必须小于原面积。',
              tone: 'amber',
          });
          return;
      }
      if (!splitData.newUnitName) {
          await showBuildingNotice({
              title: '请输入新单元名称',
              message: '拆分单元前需要填写新单元名称。',
              tone: 'amber',
          });
          return;
      }
      const originalArea = editingUnit.area || 0;
      const remainingArea = Number((originalArea - splitData.currentArea).toFixed(2));
      const updatedOriginalUnit: Unit = { ...(editingUnit as Unit), area: Number(splitData.currentArea.toFixed(2)) };
      const ids = collectUnitIds(buildings);
      const newUnitId = allocUnitId(b.id, splitData.newUnitName, ids);
      const newUnit: Unit = {
          id: newUnitId,
          name: splitData.newUnitName,
          floor: editingUnit.floor || 1,
          area: remainingArea,
          status: UnitStatus.Vacant,
          isSelfUse: false
      };
      const updatedBuildings = buildings.map(build => {
          if (build.id === b.id) {
              const newUnits = build.units.map(u => u.id === editingUnit.id ? updatedOriginalUnit : u);
              newUnits.push(newUnit);
              newUnits.sort((x, y) => x.name.localeCompare(y.name));
              return { ...build, units: newUnits };
          }
          return build;
      });
      onUpdateBuildings(updatedBuildings);
      closeUnitDrawer();
  };

  const handleDeleteUnit = async () => {
    const sourceBid = editingUnit.id ? findBuildingIdContainingUnit(buildings, editingUnit.id) : undefined;
    const b = sourceBid ? buildings.find(x => x.id === sourceBid) : activeBuilding;
    if (!b || !editingUnit.id) return;
    const confirmed = await showBuildingConfirm({
      title: '删除单元',
      message: '确定删除该单元？删除后相关资产台账将移除此单元。',
      tone: 'rose',
      confirmText: '删除',
    });
    if (confirmed) {
       const updatedBuildings = buildings.map(build => {
          if (build.id === b.id) {
              return { ...build, units: build.units.filter(u => u.id !== editingUnit.id) };
          }
          return build;
       });
       onUpdateBuildings(updatedBuildings);
       closeUnitDrawer();
    }
  };

  const openMobileQuickUnitSheet = (unit: Unit) => {
    setMobileBatchSheetOpen(false);
    setMobileQuickUnitId(unit.id);
  };

  const applyMobileQuickUnitStatus = async (unit: Unit, next: { status: UnitStatus; isSelfUse: boolean }) => {
    const sourceBid = findBuildingIdContainingUnit(buildings, unit.id);
    const tenant = activeTenantByUnitId.get(unit.id);
    if (!sourceBid) return;
    if (unit.status === UnitStatus.Occupied || tenant) {
      await showBuildingNotice({
        title: '该单元由合同控制',
        message: '已租单元的状态由当前合同决定。若要释放房源，请先在合同中办理退租或调整房源。',
        tone: 'amber',
      });
      return;
    }
    const isSame = unit.status === next.status && Boolean(unit.isSelfUse) === next.isSelfUse;
    if (isSame) {
      setMobileQuickUnitId(null);
      return;
    }
    const updatedBuildings = buildings.map((building) => {
      if (building.id !== sourceBid) return building;
      return {
        ...building,
        units: building.units.map((candidate) => (
          candidate.id === unit.id
            ? { ...candidate, status: next.status, isSelfUse: next.isSelfUse }
            : candidate
        )),
      };
    });
    onUpdateBuildings(updatedBuildings);
    setMobileQuickUnitId(null);
  };

  const toggleMobileBatchMode = () => {
    setMobileBatchMode((current) => {
      const next = !current;
      if (next) {
        setMobileQuickUnitId(null);
        setMobileBatchSheetOpen(false);
      } else {
        setMobileSelectedUnitIds([]);
        setMobileBatchSheetOpen(false);
      }
      return next;
    });
  };

  const toggleMobileUnitSelection = (unit: Unit) => {
    const tenant = activeTenantByUnitId.get(unit.id);
    if (unit.status === UnitStatus.Occupied || tenant) {
      void showBuildingNotice({
        title: '该单元由合同控制',
        message: '已租单元不能加入批量状态处理。若要释放房源，请先在合同中办理退租或调整房源。',
        tone: 'amber',
      });
      return;
    }
    setMobileSelectedUnitIds((prev) => (
      prev.includes(unit.id)
        ? prev.filter((id) => id !== unit.id)
        : [...prev, unit.id]
    ));
  };

  const toggleMobileSelectAllUnits = () => {
    const selectableIds = mobileSelectableUnitRows.map(({ unit }) => unit.id);
    if (selectableIds.length === 0) return;
    setMobileSelectedUnitIds((prev) => (
      prev.length >= selectableIds.length ? [] : selectableIds
    ));
  };

  const applyMobileBatchUnitStatus = async (
    next: { status: UnitStatus; isSelfUse: boolean },
    label: string,
  ) => {
    const selectedIds = new Set(mobileSelectedUnitRows.map(({ unit }) => unit.id));
    if (selectedIds.size === 0) return;
    const changedCount = mobileSelectedUnitRows.filter(({ unit }) => (
      unit.status !== next.status || Boolean(unit.isSelfUse) !== next.isSelfUse
    )).length;
    if (changedCount === 0) {
      setMobileBatchSheetOpen(false);
      setMobileBatchMode(false);
      setMobileSelectedUnitIds([]);
      await showBuildingNotice({
        title: '无需调整',
        message: `已选 ${selectedIds.size} 个单元当前已经是「${label}」状态。`,
        tone: 'slate',
      });
      return;
    }
    const confirmed = await showBuildingConfirm({
      title: `批量设为${label}`,
      message: `将把 ${changedCount} 个可处理单元设为「${label}」。已租或当前有租户的单元不会被改动，合同、面积、租户引用和历史导入记录保持不变。`,
      tone: 'blue',
      confirmText: `设为${label}`,
    });
    if (!confirmed) return;

    const updatedBuildings = buildings.map((building) => ({
      ...building,
      units: building.units.map((unit) => {
        if (!selectedIds.has(unit.id)) return unit;
        const tenant = activeTenantByUnitId.get(unit.id);
        if (unit.status === UnitStatus.Occupied || tenant) return unit;
        return { ...unit, status: next.status, isSelfUse: next.isSelfUse };
      }),
    }));
    onUpdateBuildings(updatedBuildings);
    setMobileBatchSheetOpen(false);
    setMobileBatchMode(false);
    setMobileSelectedUnitIds([]);
    await showBuildingNotice({
      title: '批量状态已更新',
      message: `已将 ${changedCount} 个单元设为「${label}」。请点击系统保存后同步到云端。`,
      tone: 'blue',
    });
  };

  // 批量导入/导出相关函数
  const downloadXlsx = (filename: string, rows: any[], sheetName = 'Sheet1') => {
      void writeXlsxRows(filename, rows, sheetName);
  };

  /** 是否为"用户填了内容"（区分未填 vs 显式 false/0） */
  const hasValue = (v: any): boolean => {
      if (v === undefined || v === null) return false;
      if (typeof v === 'string') return v.trim() !== '';
      return true;
  };

  /** 解析 Excel 中的布尔值（兼容中文/英文/数字/空） */
  const parseBoolean = (v: any, fallback = false): boolean => {
      if (v === undefined || v === null) return fallback;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      const s = String(v).trim().toLowerCase();
      if (!s) return fallback;
      if (['true', '1', 'y', 'yes', '是', '√', '✓', '自用'].includes(s)) return true;
      if (['false', '0', 'n', 'no', '否', '×', 'x', '非自用', '不自用'].includes(s)) return false;
      return fallback;
  };

  /** 把中文/英文状态归一为 UnitStatus */
  const normalizeUnitStatus = (v: any): UnitStatus => {
      const s = String(v ?? '').trim().toLowerCase();
      if (!s) return UnitStatus.Vacant;
      if (['vacant', '空置', '待租', '可租'].includes(s)) return UnitStatus.Vacant;
      if (['occupied', '已租', '已出租', '在租', 'leased'].includes(s)) return UnitStatus.Occupied;
      if (['reserved', '预留', '锁定'].includes(s)) return UnitStatus.Reserved;
      // 直接命中枚举值
      if ((Object.values(UnitStatus) as string[]).includes(s)) return s as UnitStatus;
      const cap = s.charAt(0).toUpperCase() + s.slice(1);
      if ((Object.values(UnitStatus) as string[]).includes(cap)) return cap as UnitStatus;
      return UnitStatus.Vacant;
  };

  const handleDownloadTemplate = () => {
      const exampleBuilding = buildings[0];
      const rows = [
          {
              资产名称: exampleBuilding?.name || '1号楼',
              单元名称: '101',
              楼层: 1,
              面积: 100.0,
              状态: '待租',
              是否自用: '否',
              合同企业名称: '',
              签约日期: '',
              起租日期: '',
              结束日期: '',
              退租日期: '',
              合同状态: '',
              退租类型: '',
              退租原因: '',
              月租金: '',
              日单价: '',
              合同面积: '',
              押金: '',
              首次收款日期: '',
              支付频率: 'Quarterly',
          },
          {
              资产名称: exampleBuilding?.name || '1号楼',
              单元名称: '102',
              楼层: 1,
              面积: 150.0,
              状态: '待租',
              是否自用: '否',
              合同企业名称: '示例：历史退租客户有限公司',
              签约日期: '',
              起租日期: '2023-01-01',
              结束日期: '2026-12-31',
              退租日期: '2025-06-30',
              合同状态: 'Terminated',
              退租类型: 'Early',
              退租原因: '业务收缩',
              月租金: '45000',
              日单价: '',
              合同面积: '150',
              押金: '90000',
              首次收款日期: '2022-12-01',
              支付频率: 'Quarterly',
          },
      ];
      void writeXlsxWorkbook('楼宇单元导入模板.xlsx', [
          { name: '楼宇单元', rows },
          { name: '填写说明', rows: buildingImportReadmeRows() },
      ]);
  };

  /** 批量导出：导出当前所有楼宇/场地下的单元清单（含每个单元的当前租户信息） */
  const handleExportBuildings = async () => {
      const rows: any[] = [];
      buildings.forEach((b) => {
          // 空楼栋也至少导出一行占位，方便用户在 Excel 中按楼栋分组
          if (b.units.length === 0) {
              rows.push({
                  资产名称: b.name,
                  资产类型: b.type === 'Site' ? '场地' : '楼宇',
                  单元名称: '',
                  楼层: '',
                  面积: '',
                  状态: '',
                  是否自用: '',
                  当前租户: '',
                  起租日期: '',
                  到期日期: '',
                  合同状态: '',
                  退租日期: '',
                  月租金: '',
              });
              return;
          }
          [...b.units]
              .sort((a, c) => (a.floor - c.floor) || a.name.localeCompare(c.name))
              .forEach((u) => {
	                  const tenantForUnit = exportTenantByUnitId.get(u.id);
                  rows.push({
                      资产名称: b.name,
                      资产类型: b.type === 'Site' ? '场地' : '楼宇',
                      单元名称: u.name,
                      楼层: u.floor,
                      面积: Number((u.area || 0).toFixed(2)),
                      状态: u.isSelfUse
                          ? '自用'
                          : (u.status === UnitStatus.Occupied
                              ? '已租'
                              : (u.status === UnitStatus.Reserved ? '预留' : '待租')),
                      是否自用: u.isSelfUse ? '是' : '否',
                      当前租户: tenantForUnit?.name || '',
                      起租日期: tenantForUnit?.leaseStart || '',
                      到期日期: tenantForUnit?.leaseEnd || '',
                      合同状态: tenantForUnit?.status || '',
                      退租日期: tenantForUnit?.terminationDate || '',
                      月租金: tenantForUnit?.monthlyRent ?? '',
                  });
              });
      });

      if (rows.length === 0) {
          await showBuildingNotice({
              title: '暂无可导出数据',
              message: '当前没有可导出的楼宇/单元数据。',
              tone: 'slate',
          });
          return;
      }

      const fname = `楼宇资管导出_${new Date().toISOString().slice(0, 10)}.xlsx`;
      downloadXlsx(fname, rows, 'buildings');
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
          let contractsSynced = 0;

          // 深克隆楼宇/单元数组，避免直接 mutate 入参 buildings
          const updatedBuildings: Building[] = buildings.map((b) => ({
              ...b,
              units: b.units.map((u) => ({ ...u })),
          }));
          let tenantsWorking = tenants.map((t) => ({ ...t }));

          json.forEach((row, idx) => {
              const rowNo = idx + 2; // header=1
              const buildingName = String(row['资产名称'] || row['楼宇名称'] || row.buildingName || '').trim();
              const unitName = String(row['单元名称'] || row['房号'] || row.unitName || '').trim();
              const floorRaw = row['楼层'] ?? row.floor;
              const areaRaw = row['面积'] ?? row.area;

              if (!buildingName) {
                  errors.push({ row: rowNo, reason: '缺少必填字段：资产名称', data: row });
                  return;
              }
              if (!unitName) {
                  errors.push({ row: rowNo, reason: '缺少必填字段：单元名称', data: row });
                  return;
              }

              // 查找或创建资产
              let targetBuilding = updatedBuildings.find((b) => b.name === buildingName);
              if (!targetBuilding) {
                  const newBuilding: Building = {
                      id: `b${Date.now()}_${idx}`,
                      name: buildingName,
                      units: [],
                      type: 'Building',
                  };
                  updatedBuildings.push(newBuilding);
                  targetBuilding = newBuilding;
              }

              // 是否存在同名单元（按 name 匹配，以保留原 ID）
              const existingUnit = targetBuilding.units.find((u) => u.name === unitName);

              // 字段解析（更新模式下，未填字段保留原值）
              const floor = hasValue(floorRaw)
                  ? Number(floorRaw)
                  : (existingUnit?.floor ?? NaN);
              const area = hasValue(areaRaw)
                  ? Number(areaRaw)
                  : (existingUnit?.area ?? NaN);

              if (!Number.isFinite(floor) || floor <= 0) {
                  errors.push({ row: rowNo, reason: '楼层必须为正数', data: row });
                  return;
              }
              if (!Number.isFinite(area) || area <= 0) {
                  errors.push({ row: rowNo, reason: '面积必须为正数', data: row });
                  return;
              }

              const status = hasValue(row['状态'] ?? row.status)
                  ? normalizeUnitStatus(row['状态'] ?? row.status)
                  : (existingUnit?.status ?? UnitStatus.Vacant);
              const isSelfUse = hasValue(row['是否自用'] ?? row.isSelfUse)
                  ? parseBoolean(row['是否自用'] ?? row.isSelfUse, existingUnit?.isSelfUse ?? false)
                  : (existingUnit?.isSelfUse ?? false);

              if (existingUnit) {
                  // 更新现有单元 —— 关键：保留原 ID，避免破坏租户的 unitIds 引用
                  Object.assign(existingUnit, {
                      name: unitName,
                      floor,
                      area: Number(area.toFixed(2)),
                      status,
                      isSelfUse,
                  });
                  updated += 1;
              } else {
                  // 新增单元
                  const ids = collectUnitIds(updatedBuildings);
                  const unitId = allocUnitId(targetBuilding.id, unitName, ids);
                  targetBuilding.units.push({
                      id: unitId,
                      name: unitName,
                      floor,
                      area: Number(area.toFixed(2)),
                      status,
                      isSelfUse,
                  });
                  created += 1;
              }

              // 对单元按楼层、名称排序
              targetBuilding.units.sort((a, b) => (a.floor - b.floor) || a.name.localeCompare(b.name));

              const company = String(
                  row['合同企业名称'] ?? row['客户名称'] ?? row['企业名称'] ?? row['tenantName'] ?? ''
              ).trim();
              if (company) {
                  const unitRef = targetBuilding.units.find((u) => u.name === unitName);
                  if (!unitRef) {
                      errors.push({ row: rowNo, reason: '合同同步失败：未找到本行单元', data: row });
                      return;
                  }
                  const sync = syncTenantFromBuildingImportRow(
                      row as Record<string, unknown>,
                      targetBuilding.id,
                      unitRef.id,
                      tenantsWorking,
                      idx
                  );
                  if (sync.error) {
                      errors.push({ row: rowNo, reason: sync.error, data: row });
                      return;
                  }
                  tenantsWorking = sync.nextTenants;
                  contractsSynced += 1;
                  if (sync.setUnitVacant) {
                      unitRef.status = UnitStatus.Vacant;
                      unitRef.isSelfUse = false;
                  }
              }
          });

          setImportErrors(errors);
          setImportSummary({
              total: json.length,
              success: json.length - errors.length,
              updated,
              created,
              failed: errors.length,
              contractsSynced,
          });
          setShowImportResult(true);

          if (json.length - errors.length > 0) {
              if (contractsSynced > 0) {
                  onCommitBuildingsTenants(updatedBuildings, tenantsWorking);
              } else {
                  onUpdateBuildings(updatedBuildings);
              }
          }
      } catch (error) {
          console.error('批量导入失败:', error);
          await showBuildingNotice({
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
      downloadXlsx(`楼宇单元导入失败明细_${new Date().toISOString().slice(0,10)}.xlsx`, rows, 'errors');
  };

  const activeTenantForUnit = editingUnit.id ? activeTenantByUnitId.get(editingUnit.id) : undefined;
  const editingUnitStatusLabel = editingUnit.isSelfUse
    ? '自用'
    : editingUnit.status === UnitStatus.Occupied
      ? '已租'
      : editingUnit.status === UnitStatus.Reserved
        ? '预留'
        : '待租';
  const editingUnitStatusTone: UnitListRow['statusTone'] = editingUnit.isSelfUse
    ? 'self'
    : editingUnit.status === UnitStatus.Occupied
      ? 'occupied'
      : editingUnit.status === UnitStatus.Reserved
        ? 'reserved'
        : 'vacant';
  const unitStatusLockedByContract = !editingUnit.isNew && editingUnit.status === UnitStatus.Occupied;
  const setEditableUnitStatus = (status: UnitStatus) => {
    if (unitStatusLockedByContract) return;
    setEditingUnit({ ...editingUnit, status, isSelfUse: false });
  };
  const setEditableUnitSelfUse = () => {
    if (unitStatusLockedByContract) return;
    setEditingUnit({ ...editingUnit, status: UnitStatus.Vacant, isSelfUse: true });
  };
  const unitStatusCounts = useMemo(() => (
    unitListRows.reduce(
      (counts, row) => {
        counts[row.statusTone] += 1;
        return counts;
      },
      { vacant: 0, self: 0, occupied: 0, reserved: 0 } as Record<UnitListRow['statusTone'], number>,
    )
  ), [unitListRows]);

  const buildingOverviewMetrics = [
    {
      label: '可出租面积',
      value: globalStats.leasableArea,
      unit: '㎡',
      helper: `${globalStats.leasableUnits} 户`,
      tone: 'leasable',
    },
    {
      label: '已出租面积',
      value: globalStats.leasedArea,
      unit: '㎡',
      helper: `${globalStats.leasedUnits} 户`,
      tone: 'occupied',
    },
    {
      label: '待出租面积',
      value: globalStats.vacantArea,
      unit: '㎡',
      helper: `${globalStats.vacantUnits} 户`,
      tone: 'vacant',
    },
  ] as const;

  const buildingStatusLegend = [
    { label: '待租', status: 'vacant' as const, count: unitStatusCounts.vacant },
    { label: '已租', status: 'occupied' as const, count: unitStatusCounts.occupied },
    { label: '自用', status: 'self' as const, count: unitStatusCounts.self },
    { label: '预留', status: 'reserved' as const, count: unitStatusCounts.reserved },
  ];

  const addUnitStripSlot = (floor: number) => (
    <button
      type="button"
      onClick={() => addUnitOnFloor(floor)}
      className="liquid-building-add-slot liquid-pressable flex min-h-[92px] w-10 shrink-0 items-center justify-center rounded-[16px] text-blue-600 transition-colors hover:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
      title="在本层新增单元（自动生成房号）"
    >
      <Plus size={20} strokeWidth={2} />
    </button>
  );

  const stripBlockVisual = (unit: Unit) => {
    if (unit.isSelfUse) {
      return 'liquid-building-unit liquid-building-unit-self text-slate-800';
    }
    if (unit.status === UnitStatus.Reserved) {
      return 'liquid-building-unit liquid-building-unit-reserved text-amber-950';
    }
    if (unit.status === UnitStatus.Occupied) {
      return 'liquid-building-unit liquid-building-unit-occupied text-sky-950';
    }
    return 'liquid-building-unit liquid-building-unit-vacant text-slate-700';
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-[minmax(240px,1.2fr)_repeat(3,minmax(140px,1fr))]">
        <section className="liquid-building-overview-hero liquid-pressable rounded-[28px] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-blue-100/90">园区资产总览</p>
              <h2 className="mt-1 text-xl font-black text-white">楼宇资产管理</h2>
            </div>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/18 text-white shadow-inner">
              <Percent size={20} />
            </span>
          </div>
          <div className="mt-8">
            <div className="text-4xl font-black leading-none tracking-normal text-white md:text-5xl">
              {formatPercent(Number(globalStats.occupancyRate || 0))}
            </div>
            <p className="mt-2 text-sm font-bold text-blue-100/90">当前签约出租率</p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 text-xs font-bold text-blue-50/90">
            <div className="rounded-2xl bg-white/12 px-3 py-2">
              <div className="opacity-80">园区总面积</div>
              <div className="mt-1 text-sm font-black tabular-nums text-white">{formatArea(globalStats.campusTotalArea)}</div>
            </div>
            <div className="rounded-2xl bg-white/12 px-3 py-2">
              <div className="opacity-80">自用面积</div>
              <div className="mt-1 text-sm font-black tabular-nums text-white">{formatArea(globalStats.selfUseArea)}</div>
            </div>
          </div>
        </section>

        {buildingOverviewMetrics.map((stat) => (
          <section
            key={stat.label}
            data-tone={stat.tone}
            title={stat.label === '可出租面积' ? '非自用可招商面积（不含场地资产）' : undefined}
            className="liquid-building-overview-card liquid-pressable rounded-[24px] p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-black text-slate-500">{stat.label}</span>
              <span className="liquid-building-overview-dot" />
            </div>
            <div className="mt-6 flex items-baseline gap-1">
              <span className="text-2xl font-black leading-none tabular-nums text-slate-950">
                {formatNumber(Number(stat.value || 0))}
              </span>
              <span className="text-xs font-bold text-slate-500">{stat.unit}</span>
            </div>
            <p className="mt-2 text-xs font-bold tabular-nums text-slate-500">{stat.helper}</p>
          </section>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-[22px] md:flex-row md:items-center md:justify-between">
        <h2 className="flex items-center gap-2 text-xl font-black text-slate-950">
          <span className="liquid-icon-well inline-flex h-9 w-9 items-center justify-center rounded-2xl text-blue-700">
            <Building2Icon size={21} />
          </span>
          楼宇资管列表
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <details className="liquid-building-tools relative">
            <summary className="liquid-glass-control liquid-pressable inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold text-slate-700 md:px-4 md:py-2">
              <FileSpreadsheet size={16} />
              导入 / 导出
            </summary>
            <div className="liquid-building-tools-menu absolute right-0 top-[calc(100%+0.55rem)] z-30 grid min-w-[12rem] gap-1 rounded-[20px] p-2">
              <button type="button" onClick={handleExportBuildings} className="liquid-building-tools-item" title="导出当前所有楼宇/单元（Excel）">
                <Download size={15} />
                批量导出
              </button>
              <label className="liquid-building-tools-item cursor-pointer" title="批量导入（Excel）">
                <Upload size={15} />
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
              <button type="button" onClick={handleDownloadTemplate} className="liquid-building-tools-item">
                <FileSpreadsheet size={15} />
                下载模板
              </button>
            </div>
          </details>
          <button
            type="button"
            onClick={quickAddBuilding}
            className="liquid-action-strong liquid-pressable flex min-h-10 items-center gap-2 rounded-full px-4 py-2 text-sm font-black text-white"
          >
            <Plus size={16} /> 新增资产
          </button>
        </div>
      </div>

      <div className="liquid-building-switcher flex gap-2 overflow-x-auto rounded-[26px] p-2 scrollbar-hide">
        {buildings.map(b => {
             const perBuilding = buildingAreaMetricsById.get(b.id) || EMPTY_BUILDING_AREA_METRICS;
             const bLeasable = perBuilding.leasableArea;
             const bSignedArea = perBuilding.leasedArea;
             const rate = perBuilding.occupancyRate;
             const isSite = b.type === 'Site';
             const bLeasableUnits = perBuilding.leasableUnits;
             const bLeasedUnits = perBuilding.leasedUnits;

             return (
                <button
                    key={b.id}
                    type="button"
                    onClick={() => setActiveBuildingId(b.id)}
                    title={
                        isSite
                            ? `场地资产 · ${b.units.length} 个登记单元`
                            : `第 1 行：签约率 = 合同已生效承租面积 ÷ 可出租面积（均不含自用）。\n第 2 行：面积为已租/可租㎡；户数为非自用单元中「已租」套数 / 可租套数（与平面图单元状态一致）。`
                    }
                    className={`liquid-building-tab liquid-pressable flex min-w-[136px] flex-shrink-0 flex-col items-start gap-2 rounded-[20px] px-4 py-3 font-medium transition-colors md:min-w-[178px] ${
                      activeBuildingId === b.id ? 'liquid-building-tab--active' : ''
                    }`}
                >
                    <div className="flex items-center gap-2">
                        {isSite ? <MapPin size={16} className="text-orange-500"/> : <Home size={16} />}
                        <span className="max-w-[96px] truncate text-sm font-black md:max-w-[140px]">{b.name}</span>
                    </div>
                    {isSite ? (
                        <div className="text-xs font-bold leading-snug text-orange-700">
                            <div>场地资产</div>
                            {b.units.length > 0 && (
                                <div className="mt-0.5 text-xs font-bold tabular-nums">{b.units.length} 单元</div>
                            )}
                        </div>
                    ) : (
                        <div className="w-full text-xs leading-snug text-slate-500">
                            <div className="font-black tabular-nums text-slate-800">签约率 {formatPercent(rate)}</div>
                            <div className="mt-0.5 truncate text-xs font-bold tabular-nums text-slate-600">
                                {formatNumber(bSignedArea)}/{formatNumber(bLeasable)}㎡ · {bLeasedUnits}/{bLeasableUnits} 户
                            </div>
                        </div>
                    )}
                </button>
            );
        })}
      </div>

      {activeBuilding && buildingStats && (
        <div className="liquid-building-content-panel relative min-w-0 rounded-[30px] p-4 md:p-6">
          <div className="mb-5 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
             <div>
                 <div className="flex flex-col md:flex-row md:items-baseline gap-2 md:gap-3">
                    <div className="flex items-center gap-2">
                        <h3 className="text-2xl font-black text-slate-950 md:text-3xl">{activeBuilding.name}</h3>
	                        {activeBuilding.type === 'Site' && <span className="liquid-glass-control text-orange-700 text-xs px-2 py-1 rounded-full font-bold">场地资产</span>}
	                        <button type="button" onClick={() => openBuildingDrawer(false)} className="liquid-glass-control liquid-pressable rounded-full p-1.5 text-slate-500 hover:text-blue-700" title="编辑资产名称与类型"><Edit2 size={14}/></button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500 md:gap-3">
                        <span>总面积: {formatArea(buildingStats.totalArea)}</span>
                        <span className="hidden h-3 w-px bg-slate-300 md:inline"></span>
                        <span className={buildingStats.selfUseArea > 0 ? 'text-slate-800 font-medium' : ''}>
                            可租: {formatArea(buildingStats.leasableArea)}
                            <span className="ml-1 text-xs font-semibold text-slate-500">（{buildingStats.leasableUnits} 户）</span>
                        </span>
                        {buildingStats.selfUseArea > 0 && (
	                            <span className="liquid-glass-control text-xs text-gray-600 px-2 py-0.5 rounded-full">
                                含自用 {formatArea(buildingStats.selfUseArea)}
                            </span>
                        )}
                        {activeBuilding.type !== 'Site' && (
                            <>
                                <span className="hidden h-3 w-px bg-slate-300 md:inline"></span>
                                <span>签约出租率: <strong className="text-blue-600">{formatPercent(Number(buildingStats.rate || 0))}</strong></span>
                                <span className="text-xs font-semibold text-slate-500">
                                    （已租 {buildingStats.leasedUnits} / 可租 {buildingStats.leasableUnits} 户）
                                </span>
                            </>
                        )}
                    </div>
                 </div>
             </div>

             <div className="flex gap-2 w-full md:w-auto">
	                 <button type="button" onClick={() => openBuildingDrawer(true)} className="liquid-glass-control liquid-pressable flex-1 md:flex-none justify-center text-sm px-3 py-1.5 text-slate-700 rounded-full font-bold flex items-center gap-1">
	                    <Plus size={14} /> 指定类型新增
	                 </button>
		                 <button type="button" onClick={() => handleDeleteBuilding(activeBuilding.id)} className="liquid-building-danger-action liquid-pressable flex-1 md:flex-none justify-center text-sm px-3 py-1.5 rounded-full hover:text-rose-700 flex items-center gap-1 font-bold">
	                    <Trash2 size={14} /> 删除{activeBuilding.type === 'Site' ? '场地' : '楼宇'}
                 </button>
            </div>
          </div>

          {activeBuilding.units.length === 0 ? (
            <button
              type="button"
              onClick={() => addUnitOnFloor(1)}
	              className="liquid-glass-readable liquid-pressable w-full flex flex-col items-center justify-center gap-3 rounded-[22px] border-2 border-dashed border-slate-300/70 py-16 text-slate-500 hover:border-blue-400/70 hover:text-blue-700 transition-colors"
            >
              <Plus size={36} strokeWidth={1.5} />
              <span className="text-sm font-medium">点击添加首个单元（自动生成 1 层房号）</span>
            </button>
          ) : (
          <>
	            <div className="liquid-building-view-toggle flex gap-1 rounded-2xl p-1 -mx-1 sm:mx-0">
              <button
                type="button"
                onClick={() => setBuildingDetailView('plan')}
	                className={`liquid-pressable flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors sm:flex-none sm:px-5 ${
	                  buildingDetailView === 'plan'
		                    ? 'liquid-action-strong text-white'
	                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutGrid size={16} className="opacity-80" />
                平面图
              </button>
              <button
                type="button"
                onClick={() => setBuildingDetailView('list')}
	                className={`liquid-pressable flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors sm:flex-none sm:px-5 ${
	                  buildingDetailView === 'list'
		                    ? 'liquid-action-strong text-white'
	                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutList size={16} className="opacity-80" />
                列表
              </button>
            </div>

            {buildingDetailView === 'plan' ? (
              <div className="space-y-4 pt-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-bold text-slate-500">
                  {buildingStatusLegend.map((item) => (
                    <span key={item.status} className="liquid-building-legend-pill inline-flex items-center gap-2 rounded-full px-2.5 py-1.5">
                      <span data-status={item.status} className="liquid-building-unit-dot" />
                      {item.label}
                      <span className="tabular-nums font-black text-slate-500">{item.count}</span>
                    </span>
                  ))}
                  <span className="ml-auto text-xs font-semibold text-slate-500">宽度按面积做近似表达，点击单元可编辑</span>
                </div>

                {Object.keys(unitsByFloor)
                  .sort((a, b) => Number(b) - Number(a))
                  .map(floor => {
                    const floorUnits = unitsByFloor[Number(floor)] ?? [];
                    return (
                    <div key={floor} className="liquid-building-floor-row grid gap-2 rounded-[22px] p-2 md:grid-cols-[4.5rem_minmax(0,1fr)]">
                      <div className="liquid-building-floor-label flex items-center justify-between rounded-[18px] px-3 py-2 md:flex-col md:items-start md:justify-center">
                        <span className="text-base font-black tabular-nums text-slate-700">{floor}F</span>
                        <span className="text-xs font-bold tabular-nums text-slate-500">{floorUnits.length} 间</span>
                      </div>
	                      <div className="liquid-building-floor flex min-h-[96px] min-w-0 flex-wrap content-start items-stretch gap-2 rounded-[18px] p-2">
                        {floorUnits.map((unit: Unit) => {
	                          const tenant = activeTenantByUnitId.get(unit.id);
                          const isSelfUse = unit.isSelfUse;
                          const flexGrow = Math.max(unit.area || 0, 8);
                          const statusTone: UnitListRow['statusTone'] = isSelfUse
                            ? 'self'
                            : unit.status === UnitStatus.Occupied
                              ? 'occupied'
                              : unit.status === UnitStatus.Reserved
                                ? 'reserved'
                                : 'vacant';
                          const statusText = isSelfUse
                            ? '自用保留'
                            : unit.status === UnitStatus.Vacant
                              ? '待租'
                              : unit.status === UnitStatus.Reserved
                                ? '预留'
                                : tenant?.name || '已租';
                          return (
                            <button
                              key={unit.id}
                              type="button"
                              onClick={() => openUnitDrawer(unit)}
                              data-status={statusTone}
                              style={{ flex: `${flexGrow} 1 6.5rem` }}
	                              className={`mobile-pressable min-h-[92px] min-w-0 max-w-full rounded-[16px] border px-3 py-2.5 text-left transition hover:brightness-[1.02] hover:ring-2 hover:ring-blue-300/40 ${stripBlockVisual(unit)}`}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <span className="truncate text-sm font-black leading-tight text-slate-950">{unit.name}</span>
                                <span className="flex shrink-0 gap-0.5">
                                  <span data-status={statusTone} className="liquid-building-unit-dot mt-1" />
                                  {isSelfUse && (
                                    <span title="自用" className="text-slate-500">
                                      <Coffee size={12} />
                                    </span>
                                  )}
                                  {tenant?.specialRequirements && !isSelfUse && (
                                    <span title="有特殊备注">
                                      <Info size={12} className="text-sky-600" />
                                    </span>
                                  )}
                                </span>
                              </div>
                              <div className="mt-2 text-xs font-bold text-slate-500 tabular-nums">{formatArea(unit.area)}</div>
                              <div
                                className="mt-1 line-clamp-2 text-xs font-semibold leading-snug text-slate-600"
                                title={statusText}
                              >
                                {statusText}
                              </div>
                            </button>
                          );
                        })}
                        {addUnitStripSlot(Number(floor))}
                      </div>
                    </div>
                  )})}

	                <div className="flex gap-2 border-t border-dashed border-white/70 pt-4">
                  <button
                    type="button"
                    onClick={addNewTopFloorUnit}
	                    className="liquid-glass-readable liquid-pressable flex w-full items-center justify-center gap-2 rounded-[18px] border-2 border-dashed border-slate-300/70 py-3.5 text-sm font-bold text-slate-500 transition-colors hover:border-blue-400/70 hover:text-blue-700"
                  >
                    <Plus size={18} />
                    添加更高楼层（{maxFloorInActive + 1}F，自动生成房号）
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 pt-5">
                <div className="liquid-building-mobile-batch-toolbar lg:hidden rounded-[22px] px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-black text-slate-950">批量状态处理</div>
                      <div className="mt-0.5 text-xs font-semibold text-slate-500">
                        {mobileSelectableUnitRows.length} 个可处理 · {unitListRows.length - mobileSelectableUnitRows.length} 个合同锁定
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={toggleMobileBatchMode}
                      disabled={mobileSelectableUnitRows.length === 0}
                      className="liquid-building-mobile-action-pill mobile-pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-black text-blue-700 disabled:pointer-events-none disabled:opacity-45"
                    >
                      <LayoutList size={14} />
                      {mobileBatchMode ? '退出' : '批量'}
                    </button>
                  </div>
                  {mobileBatchMode ? (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={toggleMobileSelectAllUnits}
                        disabled={mobileSelectableUnitRows.length === 0}
                        className="liquid-building-mobile-action-pill mobile-pressable min-h-11 rounded-2xl px-2 text-xs font-black text-slate-700 disabled:pointer-events-none disabled:opacity-45"
                      >
                        {mobileSelectedUnitRows.length >= mobileSelectableUnitRows.length ? '清空' : '全选'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMobileSelectedUnitIds([]);
                          setMobileBatchMode(false);
                          setMobileBatchSheetOpen(false);
                        }}
                        className="liquid-building-mobile-action-pill mobile-pressable min-h-11 rounded-2xl px-2 text-xs font-black text-slate-700"
                      >
                        取消
                      </button>
	                      <button
	                        type="button"
	                        ref={mobileBatchTriggerRef}
	                        onClick={() => setMobileBatchSheetOpen(true)}
	                        disabled={mobileSelectedUnitRows.length === 0}
	                        aria-expanded={isMobileBatchSheetVisible}
	                        aria-controls="building-mobile-batch-status-sheet"
		                        className="liquid-action-strong liquid-pressable min-h-11 rounded-2xl px-2 text-xs font-black text-white disabled:pointer-events-none disabled:opacity-45"
	                      >
                        处理 {mobileSelectedUnitRows.length}
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="liquid-building-mobile-list grid gap-4 lg:hidden">
                  {mobileUnitRowsByFloor.map(({ floor, rows, selectableCount }) => (
                    <section key={floor} className="liquid-building-mobile-floor-section rounded-[24px] p-2.5">
                      <div className="liquid-building-mobile-floor-header mb-2 flex items-center justify-between gap-3 rounded-[18px] px-3 py-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-base font-black tabular-nums text-slate-900">{floor}F</span>
                          <span className="text-xs font-bold text-slate-500">{rows.length} 间</span>
                        </div>
                        <span className="rounded-full bg-white/66 px-2.5 py-1 text-xs font-black text-slate-500">
                          {selectableCount} 可处理
                        </span>
                      </div>
                      <div className="grid gap-2.5">
                        {rows.map(({ unit, tenant, statusLabel, statusTone, tenantLine, hasSpecialRequirements }) => {
                          const lockedForBatch = unit.status === UnitStatus.Occupied || Boolean(tenant);
                          const selectedForBatch = mobileSelectedUnitIdSet.has(unit.id);
                          const tenantDisplay = tenantLine === '—' ? '暂无租户' : tenantLine;
                          const managementHint = lockedForBatch
                            ? '合同控制'
                            : statusTone === 'vacant'
                              ? '可招商'
                              : statusTone === 'reserved'
                                ? '可转待租'
                                : '可轻管理';
                          return (
                            <div
                              key={unit.id}
                              data-unit-id={unit.id}
                              data-status={statusTone}
                              data-selected={selectedForBatch ? 'true' : 'false'}
                              data-batch-locked={lockedForBatch ? 'true' : 'false'}
                              className="liquid-building-mobile-unit mobile-card-enter w-full rounded-[22px] p-3.5 text-left transition"
                            >
                              <button
                                type="button"
                                data-unit-action="open"
                                onClick={() => mobileBatchMode ? toggleMobileUnitSelection(unit) : openUnitDrawer(unit)}
                                className="liquid-pressable w-full rounded-[20px] text-left focus-visible:outline-none"
                                title={mobileBatchMode ? (lockedForBatch ? '合同控制房源不能批量处理' : '选择单元') : '打开单元完整信息'}
                                aria-label={`${unit.name}，${statusLabel}，${formatArea(unit.area)}，${tenantDisplay}`}
                              >
                                <div className="liquid-building-mobile-unit-main rounded-[20px] px-3 py-3" data-status={statusTone}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span data-status={statusTone} className="liquid-building-status inline-flex rounded-full px-2.5 py-1 text-xs font-black">{statusLabel}</span>
                                        <span className="rounded-full bg-white/68 px-2.5 py-1 text-xs font-black text-slate-500">{managementHint}</span>
                                      </div>
                                      <div className="mt-3 flex min-w-0 items-baseline gap-2">
                                        <span className="truncate text-xl font-black leading-none text-slate-950">{unit.name}</span>
                                        <span className="shrink-0 text-xs font-bold tabular-nums text-slate-500">{unit.floor}F</span>
                                      </div>
                                    </div>
                                    {mobileBatchMode ? (
                                      <span className={`liquid-building-mobile-select inline-flex h-10 min-w-16 shrink-0 items-center justify-center rounded-2xl px-2 text-xs font-black ${selectedForBatch ? 'liquid-building-mobile-select-active' : ''}`}>
                                        {lockedForBatch ? '锁定' : selectedForBatch ? '已选' : '选择'}
                                      </span>
                                    ) : (
                                      <span className="liquid-icon-well inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-blue-700">
                                        <Edit2 size={16} />
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-4 grid grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] gap-2">
                                    <div className="liquid-building-mobile-meta rounded-2xl px-3 py-2.5">
                                      <div className="text-xs font-bold text-slate-500">面积</div>
                                      <div className="mt-1 text-lg font-black tabular-nums text-slate-900">{formatArea(unit.area)}</div>
                                    </div>
                                    <div className="liquid-building-mobile-meta rounded-2xl px-3 py-2.5">
                                      <div className="text-xs font-bold text-slate-500">租户 / 说明</div>
                                      <div className="mt-1 line-clamp-2 text-sm font-black text-slate-800" title={tenantDisplay}>{tenantDisplay}</div>
                                    </div>
                                  </div>
                                </div>
                                {hasSpecialRequirements ? (
                                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-sky-200/80 bg-sky-50/82 px-3 py-1 text-xs font-black text-sky-700">
                                    <Info size={12} />
                                    有特殊备注
                                  </div>
                                ) : null}
                              </button>
                              <div className="liquid-building-mobile-actionbar mt-3 flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5">
                                <span className="min-w-0 truncate text-xs font-bold text-slate-500">
                                  {mobileBatchMode ? (lockedForBatch ? '合同控制，批量跳过' : '批量处理：待租、预留、自用') : '轻管理：面积、状态、拆分'}
                                </span>
                                {mobileBatchMode ? (
                                  <button
                                    type="button"
                                    data-unit-action="select"
                                    onClick={() => toggleMobileUnitSelection(unit)}
                                    disabled={lockedForBatch}
                                    className={`liquid-building-mobile-action-pill mobile-pressable inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-black disabled:pointer-events-none disabled:opacity-45 ${selectedForBatch ? 'text-blue-700' : 'text-slate-600'}`}
                                  >
                                    {selectedForBatch ? '取消选择' : '选择'}
                                  </button>
                                ) : (
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <button
                                      type="button"
	                                      data-unit-action="quick"
	                                      onClick={(event) => {
	                                        mobileQuickTriggerRef.current = event.currentTarget;
	                                        openMobileQuickUnitSheet(unit);
	                                      }}
	                                      aria-expanded={mobileQuickUnitId === unit.id && isMobileQuickUnitSheetOpen}
	                                      aria-controls="building-mobile-quick-unit-sheet"
		                                      className="liquid-building-mobile-action-pill mobile-pressable inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-black text-blue-700"
	                                    >
                                      <ShieldCheck size={13} />
                                      快速处理
                                    </button>
                                    <button
                                      type="button"
                                      data-unit-action="edit"
                                      onClick={() => openUnitDrawer(unit)}
                                      className="liquid-building-mobile-action-pill mobile-pressable inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-black text-slate-600"
                                    >
                                      <Edit2 size={13} />
                                      编辑
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>

	                <div className="liquid-glass-readable hidden overflow-x-auto rounded-[20px] lg:block">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
		                      <tr className="liquid-building-table-head border-b border-slate-200/70 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2.5">楼层</th>
                        <th className="px-3 py-2.5">单元</th>
                        <th className="px-3 py-2.5">面积</th>
                        <th className="px-3 py-2.5">状态</th>
                        <th className="px-3 py-2.5">租户 / 说明</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/60">
                      {unitListRows.map(({ unit, statusLabel, statusTone, tenantLine, hasSpecialRequirements }) => (
                              <tr key={unit.id} className="liquid-building-table-row">
                                <td className="px-3 py-2.5 font-extrabold tabular-nums text-slate-500">{unit.floor}F</td>
                                <td className="px-3 py-2.5">
                                  <button
                                    type="button"
                                    onClick={() => openUnitDrawer(unit)}
                                    className="font-semibold text-slate-800 underline-offset-2 hover:text-blue-600 hover:underline"
                                  >
                                    {unit.name}
                                  </button>
                                </td>
                                <td className="px-3 py-2.5 tabular-nums text-slate-600">{formatArea(unit.area)}</td>
                                <td className="px-3 py-2.5">
                                  <span data-status={statusTone} className="liquid-building-status inline-flex rounded-full px-2.5 py-1 text-xs font-black">{statusLabel}</span>
                                </td>
                                <td className="max-w-[min(28rem,40vw)] px-3 py-2.5 text-slate-600">
                                  <span className="line-clamp-2" title={tenantLine}>
                                    {tenantLine}
                                    {hasSpecialRequirements ? ' · 有特殊备注' : ''}
                                  </span>
                                </td>
                              </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

	                <div className="flex gap-2 border-t border-dashed border-white/70 pt-2">
                  <button
                    type="button"
                    onClick={addNewTopFloorUnit}
	                    className="liquid-glass-readable liquid-pressable flex w-full items-center justify-center gap-2 rounded-[18px] border-2 border-dashed border-slate-300/70 py-3.5 text-sm font-bold text-slate-500 transition-colors hover:border-blue-400/70 hover:text-blue-700"
                  >
                    <Plus size={18} />
                    添加更高楼层（{maxFloorInActive + 1}F，自动生成房号）
                  </button>
                </div>
              </div>
            )}
          </>
          )}
        </div>
      )}

      {mobileQuickUnitContext && (
        <BuildingMobileQuickUnitSheet
          context={mobileQuickUnitContext}
          sheetRef={mobileQuickSheetRef}
          closeButtonRef={mobileQuickCloseButtonRef}
          onClose={closeMobileQuickUnitSheet}
          onEdit={openUnitDrawer}
          onApplyStatus={applyMobileQuickUnitStatus}
        />
      )}

      {isMobileBatchSheetVisible && (
        <BuildingMobileBatchStatusSheet
          activeBuildingName={activeBuilding?.name || '当前楼宇'}
          selectedRows={mobileSelectedUnitRows}
          sheetRef={mobileBatchSheetRef}
          closeButtonRef={mobileBatchCloseButtonRef}
          onClose={closeMobileBatchSheet}
          onExitBatch={() => {
            setMobileBatchSheetOpen(false);
            setMobileBatchMode(false);
            setMobileSelectedUnitIds([]);
          }}
          onApplyStatus={applyMobileBatchUnitStatus}
        />
      )}

      {buildingDrawerOpen && (
        <>
          <div className="liquid-drawer-backdrop fixed inset-0 z-40" aria-hidden onClick={() => setBuildingDrawerOpen(false)} />
          <aside className="liquid-drawer-panel fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] w-full flex-col rounded-t-[30px] animate-in slide-in-from-bottom-4 duration-200 lg:inset-y-0 lg:left-auto lg:right-0 lg:h-full lg:max-h-none lg:max-w-md lg:rounded-none lg:slide-in-from-right">
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-slate-300/70 lg:hidden" aria-hidden />
            <div className="flex items-center justify-between p-4 border-b border-white/70">
              <h3 className="text-lg font-black text-slate-950">{editingBuilding.isNew ? '新增资产' : '编辑资产'}</h3>
              <button type="button" onClick={() => setBuildingDrawerOpen(false)} className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:text-slate-900"><X size={22} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <span className="block text-sm font-medium text-slate-700 mb-2">资产类型</span>
                <div className="liquid-glass-readable flex gap-3 rounded-2xl p-3">
                  <label className="liquid-building-metric-chip flex flex-1 items-center gap-2 cursor-pointer rounded-xl px-2 py-1.5 transition-colors hover:text-blue-700">
                    <input type="radio" name="buildingType" checked={editingBuilding.type === 'Building' || !editingBuilding.type} onChange={() => setEditingBuilding({...editingBuilding, type: 'Building'})} className="text-blue-600" />
                    <span className="text-sm font-bold text-slate-700">楼宇</span>
                  </label>
                  <label className="liquid-building-metric-chip flex flex-1 items-center gap-2 cursor-pointer rounded-xl px-2 py-1.5 transition-colors hover:text-blue-700">
                    <input type="radio" name="buildingType" checked={editingBuilding.type === 'Site'} onChange={() => setEditingBuilding({...editingBuilding, type: 'Site'})} className="text-orange-600" />
                    <span className="text-sm font-bold text-slate-700">场地</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">名称</label>
                <input type="text" className="liquid-glass-readable w-full rounded-xl px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80" value={editingBuilding.name || ''} onChange={e => setEditingBuilding({...editingBuilding, name: e.target.value})} placeholder={editingBuilding.type === 'Site' ? '例如: 中央广场' : '例如: 5号楼'} />
              </div>
              {editingBuilding.type === 'Site' && (
                <div className="rounded-xl border border-orange-200/70 bg-orange-50/78 p-3 text-xs font-semibold text-orange-700">
                  注意：场地类型的资产仅用于记录租赁状态和收款，<strong>不计入园区的出租率统计</strong>。
                </div>
              )}
            </div>
            <div className="p-4 border-t border-white/70">
              <button type="button" onClick={saveBuilding} className="liquid-action-strong liquid-pressable w-full rounded-full py-2.5 font-bold text-white">保存</button>
            </div>
          </aside>
        </>
      )}

      {unitDrawerOpen && (
        <>
          <div className="liquid-drawer-backdrop fixed inset-0 z-40" aria-hidden onClick={closeUnitDrawer} />
          <aside className="liquid-drawer-panel liquid-building-unit-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] w-full flex-col rounded-t-[30px] animate-in slide-in-from-bottom-4 duration-200 lg:inset-y-0 lg:left-auto lg:right-0 lg:h-full lg:max-h-none lg:max-w-lg lg:rounded-none lg:slide-in-from-right">
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-slate-300/70 lg:hidden" aria-hidden />
            <div className="flex items-center justify-between p-4 border-b border-white/70">
              <div className="min-w-0 pr-2">
              <h3 className="truncate text-lg font-black text-slate-950">
                {editingUnit.isNew ? `新增${activeBuilding?.type === 'Site' ? '地块' : '单元'}` : `编辑${activeBuilding?.type === 'Site' ? '地块' : '单元'} ${editingUnit.name}`}
              </h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-500 lg:hidden">
                  <span data-status={editingUnitStatusTone} className="liquid-building-status inline-flex rounded-full px-2 py-0.5 text-xs font-black">
                    {editingUnitStatusLabel}
                  </span>
                  <span>{formatArea(Number(editingUnit.area || 0))}</span>
                  {activeTenantForUnit && !editingUnit.isSelfUse ? <span className="truncate">· {activeTenantForUnit.name}</span> : null}
                </div>
              </div>
              <button type="button" onClick={closeUnitDrawer} className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:text-slate-900 shrink-0"><X size={22} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="liquid-building-mobile-quick-panel rounded-[24px] p-3 lg:hidden">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-black text-slate-500">快捷状态</div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-500">
                      已租单元由合同控制，不在资产台账直接改为待租
                    </div>
                  </div>
                  {unitStatusLockedByContract ? (
                    <span className="rounded-full bg-white/72 px-2.5 py-1 text-xs font-black text-slate-500">锁定</span>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditableUnitStatus(UnitStatus.Vacant)}
                    disabled={unitStatusLockedByContract}
                    className={`liquid-building-mobile-action mobile-pressable min-h-11 rounded-2xl px-2 text-xs font-black disabled:opacity-45 ${!editingUnit.isSelfUse && editingUnit.status === UnitStatus.Vacant ? 'liquid-building-mobile-action-active' : ''}`}
                  >
                    待租
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditableUnitStatus(UnitStatus.Reserved)}
                    disabled={unitStatusLockedByContract}
                    className={`liquid-building-mobile-action mobile-pressable min-h-11 rounded-2xl px-2 text-xs font-black disabled:opacity-45 ${!editingUnit.isSelfUse && editingUnit.status === UnitStatus.Reserved ? 'liquid-building-mobile-action-active' : ''}`}
                  >
                    预留
                  </button>
                  <button
                    type="button"
                    onClick={setEditableUnitSelfUse}
                    disabled={unitStatusLockedByContract}
                    className={`liquid-building-mobile-action mobile-pressable min-h-11 rounded-2xl px-2 text-xs font-black disabled:opacity-45 ${editingUnit.isSelfUse ? 'liquid-building-mobile-action-active' : ''}`}
                  >
                    自用
                  </button>
                </div>
              </div>
              {!editingUnit.isNew && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">所属楼栋</label>
                  <select
                    className="liquid-glass-readable w-full rounded-xl px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                    value={unitTargetBuildingId}
                    onChange={e => setUnitTargetBuildingId(e.target.value)}
                  >
                    {buildings.map(b => (
                      <option key={b.id} value={b.id}>{b.name}{b.type === 'Site' ? '（场地）' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">名称/房号</label>
                  <input type="text" className="liquid-glass-readable w-full rounded-xl px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80" value={editingUnit.name || ''} onChange={e => setEditingUnit({...editingUnit, name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">楼层/区块</label>
                  <input type="number" inputMode="numeric" enterKeyHint="done" className="liquid-glass-readable w-full rounded-xl px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80" value={editingUnit.floor ?? ''} onChange={e => setEditingUnit({...editingUnit, floor: Number(e.target.value)})} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">面积 (㎡)</label>
                  <input type="number" inputMode="decimal" enterKeyHint="done" step="0.01" className="liquid-glass-readable w-full rounded-xl px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80" value={editingUnit.area ?? ''} onChange={e => setEditingUnit({...editingUnit, area: Number(e.target.value)})} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">状态</label>
                  <select className="liquid-glass-readable w-full rounded-xl px-3 py-2 text-sm font-semibold outline-none disabled:opacity-60 focus-visible:ring-4 focus-visible:ring-blue-200/80" value={editingUnit.status} onChange={e => setEditingUnit({...editingUnit, status: e.target.value as UnitStatus})} disabled={editingUnit.status === UnitStatus.Occupied}>
                    <option value={UnitStatus.Vacant}>空置</option>
                    <option value={UnitStatus.Occupied}>已租 (由合同控制)</option>
                    <option value={UnitStatus.Reserved}>预留</option>
                  </select>
                </div>
              </div>
              <div className="liquid-glass-readable flex items-center gap-3 rounded-2xl p-3">
                <div className="flex items-center h-5">
                  <input id="isSelfUse" type="checkbox" checked={editingUnit.isSelfUse || false} onChange={e => setEditingUnit({...editingUnit, isSelfUse: e.target.checked})} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                </div>
                <div className="text-sm">
                  <label htmlFor="isSelfUse" className="font-medium text-gray-700">设为自用</label>
                  <p className="text-xs text-gray-500">自用部分将从可租赁面积、出租率统计及营收目标中剔除。</p>
                </div>
              </div>
              {!editingUnit.isNew && (
                <div className="border-t border-dashed border-white/70 pt-3 mt-1">
                  <div className="flex justify-between items-center mb-2">
                    <button type="button" onClick={() => setShowSplitForm(!showSplitForm)} className="text-xs font-semibold text-blue-600 flex items-center gap-1 hover:underline"><Scissors size={12} /> {showSplitForm ? '取消拆分' : '拆分此单元'}</button>
                  </div>
                  {showSplitForm && (
                    <div className="liquid-glass-readable p-3 rounded-2xl text-sm space-y-3 animate-in slide-in-from-top-2">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">保留面积 (原单元)</label>
                          <input type="number" inputMode="decimal" enterKeyHint="done" step="0.01" className="liquid-building-field w-full rounded-xl p-1.5 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80" value={splitData.currentArea} onChange={e => setSplitData({...splitData, currentArea: Number(e.target.value)})} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">拆分出的新单元名称</label>
                          <input type="text" className="liquid-building-field w-full rounded-xl p-1.5 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80" value={splitData.newUnitName} onChange={e => setSplitData({...splitData, newUnitName: e.target.value})} />
                        </div>
                      </div>
                      <div className="flex justify-between items-center rounded-xl bg-blue-50/86 p-2 text-blue-700 text-xs font-medium">
                        <span>新单元面积: {formatArea((editingUnit.area || 0) - splitData.currentArea)}</span>
                        <button type="button" onClick={handleSplitUnit} className="liquid-action-strong liquid-pressable rounded-full px-3 py-1 text-white">确认拆分</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {activeTenantForUnit && !editingUnit.isSelfUse && (
                <div className="liquid-glass-readable p-4 rounded-2xl text-sm">
                  <div className="flex items-center gap-2 mb-2 font-semibold text-blue-800"><Users size={16} /> 当前租户</div>
                  <p><span className="text-blue-600">企业:</span> {activeTenantForUnit.name}</p>
                  <p><span className="text-blue-600">租期:</span> {activeTenantForUnit.leaseStart} ~ {activeTenantForUnit.leaseEnd}</p>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 border-t border-white/70 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:pb-4">
              {!editingUnit.isNew ? (
                <button type="button" onClick={handleDeleteUnit} className="liquid-building-danger-action liquid-pressable text-sm flex items-center justify-center gap-1 py-2 rounded-full hover:text-rose-700 font-bold">
                  <Trash2 size={16} /> 删除此单元
                </button>
              ) : null}
              <div className="flex gap-2">
                <button type="button" onClick={closeUnitDrawer} className="liquid-glass-control liquid-pressable flex-1 rounded-full px-4 py-2.5 text-slate-700 font-bold">取消</button>
                <button type="button" onClick={saveUnit} className="liquid-action-strong liquid-pressable flex-1 rounded-full px-4 py-2.5 text-white font-bold">保存</button>
              </div>
            </div>
          </aside>
        </>
      )}

      {showImportResult && (
        <div className="monthly-detail-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-4" onClick={closeImportResult}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="building-import-result-title"
            onClick={(event) => event.stopPropagation()}
            className="monthly-detail-panel flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] animate-in zoom-in-50 duration-200 md:rounded-[28px]"
          >
            <div className="liquid-elevated-header flex items-center justify-between gap-3 border-b border-white/60 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="liquid-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-blue-700">
                  <Upload size={20} />
                </div>
                <div className="min-w-0">
                  <h3 id="building-import-result-title" className="truncate font-black text-slate-950">批量导入结果</h3>
                  <p className="mt-0.5 text-xs font-semibold text-slate-500">楼宇、单元和合同同步校验明细</p>
                </div>
              </div>
              <button onClick={closeImportResult} className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:text-slate-900" aria-label="关闭导入结果"><X size={18}/></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {importSummary && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 text-sm">
                  <div className="liquid-glass-readable p-3 rounded-2xl"><div className="text-xs text-slate-500">总行数</div><div className="font-black text-slate-800">{importSummary.total}</div></div>
                  <div className="liquid-glass-readable p-3 rounded-2xl"><div className="text-xs text-slate-500">成功</div><div className="font-black text-cyan-700">{importSummary.success}</div></div>
                  <div className="liquid-glass-readable p-3 rounded-2xl"><div className="text-xs text-slate-500">更新</div><div className="font-black text-blue-700">{importSummary.updated}</div></div>
                  <div className="liquid-glass-readable p-3 rounded-2xl"><div className="text-xs text-slate-500">新增</div><div className="font-black text-sky-700">{importSummary.created}</div></div>
                  <div className="liquid-glass-readable p-3 rounded-2xl"><div className="text-xs text-slate-500">失败</div><div className="font-black text-rose-700">{importSummary.failed}</div></div>
                  <div className="liquid-glass-readable p-3 rounded-2xl"><div className="text-xs text-slate-500">合同同步行</div><div className="font-black text-slate-800">{importSummary.contractsSynced}</div></div>
                </div>
              )}

              {importErrors.length > 0 ? (
                <div className="liquid-glass-readable overflow-hidden rounded-3xl border border-white/70">
                  <div className="liquid-building-import-head flex flex-wrap items-center justify-between gap-2 border-b border-white/70 p-3">
                    <div className="text-sm font-black text-rose-800">失败明细（显示前 20 条）</div>
                    <button onClick={handleImportErrorsExport} className="liquid-glass-control liquid-pressable inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-white/80"><Download size={13}/> 下载失败明细</button>
                  </div>
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full min-w-[560px] text-xs">
                      <thead className="liquid-building-import-head sticky top-0 z-10 text-slate-600">
                        <tr>
                          <th className="px-3 py-2.5 text-left font-black">行号</th>
                          <th className="px-3 py-2.5 text-left font-black">原因</th>
                          <th className="px-3 py-2.5 text-left font-black">资产名称</th>
                          <th className="px-3 py-2.5 text-left font-black">单元名称</th>
                        </tr>
                      </thead>
                      <tbody className="liquid-building-import-body divide-y divide-white/60">
                        {importErrors.slice(0, 20).map((e, i) => (
                          <tr key={i} className="liquid-building-import-row">
                            <td className="px-3 py-2.5 font-black tabular-nums text-slate-700">{e.row}</td>
                            <td className="px-3 py-2.5 font-bold text-rose-700">{e.reason}</td>
                            <td className="px-3 py-2.5 font-semibold text-slate-700">{String(e.data['资产名称'] || e.data.buildingName || '')}</td>
                            <td className="px-3 py-2.5 font-semibold text-slate-700">{String(e.data['单元名称'] || e.data.unitName || '')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="liquid-building-import-success rounded-3xl py-6 text-center font-black">
                  所有数据导入成功！
                </div>
              )}
            </div>
            <div className="liquid-elevated-footer flex justify-end border-t border-white/60 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:pb-4">
              <button onClick={closeImportResult} className="liquid-glass-control liquid-pressable rounded-full px-5 py-2 text-slate-700 font-bold">关闭</button>
            </div>
          </section>
        </div>
      )}
      {buildingPrompt ? (
        <BuildingPromptOverlay prompt={buildingPrompt} onClose={closeBuildingPrompt} />
      ) : null}
    </div>
  );
};
