
import React, { useState, useMemo } from 'react';
import { Building, Unit, UnitStatus, Tenant, ContractStatus } from '../types';
import { Plus, Trash2, Edit2, Home, Info, X, Users, Scissors, Coffee, Car, Maximize, Unlock, ShieldCheck, LayoutGrid, Percent, TrendingUp, Calendar, Building2 as Building2Icon, MapPin } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface BuildingManagerProps {
  buildings: Building[];
  tenants: Tenant[];
  onUpdateBuildings: (buildings: Building[]) => void;
}

export const BuildingManager: React.FC<BuildingManagerProps> = ({ buildings, tenants, onUpdateBuildings }) => {
  const [activeBuildingId, setActiveBuildingId] = useState<string>(buildings[0]?.id || '');
  
  // Modals state
  const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
  const [isBuildingModalOpen, setIsBuildingModalOpen] = useState(false);
  
  // Current editing state
  const [editingUnit, setEditingUnit] = useState<Partial<Unit> & { isNew?: boolean }>({});
  const [editingBuilding, setEditingBuilding] = useState<Partial<Building> & { isNew?: boolean }>({});

  // Split Unit State
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [splitData, setSplitData] = useState({ currentArea: 0, newUnitName: '' });

  const activeBuilding = buildings.find(b => b.id === activeBuildingId);

  // --- Global Park Stats: SYNCED TO LEASING ACHIEVEMENT (招商口径) ---
  const globalStats = useMemo(() => {
    let totalArea = 0;
    let selfUseArea = 0;
    const now = new Date();

    buildings.forEach(b => {
      // Exclude 'Site' (场地) from Global Stats
      if (b.type === 'Site') return;

      b.units.forEach(u => {
        totalArea += u.area;
        if (u.isSelfUse) selfUseArea += u.area;
      });
    });

    const leasableArea = totalArea - selfUseArea;
    
    // SYNCED LOGIC: Calculate Leased Area based on Signing Achievements as of TODAY
    let leasedArea = 0;
    tenants.forEach(t => {
        if (t.status === ContractStatus.Expired) return;
        
        // Exclude tenants in 'Sites'
        const building = buildings.find(b => b.id === t.buildingId);
        if (building && building.type === 'Site') return;

        // Use Signing Date if available, fallback to leaseStart
        const achievedDate = t.signingDate ? new Date(t.signingDate) : new Date(t.leaseStart);
        const terminated = t.terminationDate ? new Date(t.terminationDate) : null;
        
        // Is it signed as of now, and not already terminated?
        const isAchievedNow = achievedDate <= now && (!terminated || terminated > now);
        
        if (isAchievedNow) {
            leasedArea += t.totalArea;
        }
    });

    const vacantArea = Math.max(0, leasableArea - leasedArea);
    const rate = leasableArea > 0 ? (leasedArea / leasableArea * 100).toFixed(1) : '0.0';

    return { 
        totalArea: Number(totalArea.toFixed(2)), 
        selfUseArea: Number(selfUseArea.toFixed(2)), 
        leasableArea: Number(leasableArea.toFixed(2)), 
        leasedArea: Number(leasedArea.toFixed(2)), 
        vacantArea: Number(vacantArea.toFixed(2)), 
        rate 
    };
  }, [buildings, tenants]);

  // --- Calculate Occupancy Trend Based on Signing Date (Existing Logic) ---
  const signingTrendData = useMemo(() => {
    if (globalStats.leasableArea <= 0) return [];

    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
            label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            date: new Date(d.getFullYear(), d.getMonth() + 1, 0), // Month end
            signedArea: 0
        });
    }

    const trend = months.map(m => {
        let totalSignedArea = 0;
        tenants.forEach(t => {
            // Exclude tenants in 'Sites' from trend
            const building = buildings.find(b => b.id === t.buildingId);
            if (building && building.type === 'Site') return;

            const signRef = t.signingDate || t.leaseStart;
            if (!signRef) return;
            
            const signDate = new Date(signRef);
            const isSigned = signDate <= m.date;
            
            if (isSigned && t.status !== ContractStatus.Expired) {
                totalSignedArea += t.totalArea;
            }
        });

        const occupancyAtPoint = Number(((totalSignedArea / globalStats.leasableArea) * 100).toFixed(1));
        return {
            month: m.label,
            occupancy: occupancyAtPoint,
            area: Number(totalSignedArea.toFixed(2))
        };
    });

    return trend;
  }, [tenants, globalStats.leasableArea, buildings]);

  // Calculate stats for active building - SYNCED TO LEASING ACHIEVEMENT
  const buildingStats = activeBuilding ? (() => {
      const totalUnits = activeBuilding.units.length;
      const totalArea = activeBuilding.units.reduce((s, u) => s + u.area, 0);
      const selfUseArea = activeBuilding.units.filter(u => u.isSelfUse).reduce((s, u) => s + u.area, 0);
      const leasableArea = totalArea - selfUseArea;
      
      const now = new Date();
      let occupiedArea = 0;
      tenants.forEach(t => {
          if (t.buildingId !== activeBuilding.id || t.status === ContractStatus.Expired) return;
          const achievedDate = t.signingDate ? new Date(t.signingDate) : new Date(t.leaseStart);
          const terminated = t.terminationDate ? new Date(t.terminationDate) : null;
          if (achievedDate <= now && (!terminated || terminated > now)) {
              occupiedArea += t.totalArea;
          }
      });

      const rate = leasableArea > 0 ? (occupiedArea / leasableArea * 100).toFixed(1) : '0.0';
      return { 
          totalUnits, 
          totalArea: Number(totalArea.toFixed(2)), 
          leasableArea: Number(leasableArea.toFixed(2)), 
          occupiedArea: Number(occupiedArea.toFixed(2)), 
          rate, 
          selfUseArea: Number(selfUseArea.toFixed(2)) 
      };
  })() : null;

  // Group units by floor to organize the floor plan visual
  const unitsByFloor = useMemo(() => {
    if (!activeBuilding) return {};
    const groups: Record<number, Unit[]> = {};
    activeBuilding.units.forEach(u => {
      if (!groups[u.floor]) groups[u.floor] = [];
      groups[u.floor].push(u);
    });
    // Sort units within each floor by name
    Object.keys(groups).forEach(floor => {
        groups[Number(floor)].sort((a, b) => a.name.localeCompare(b.name));
    });
    return groups;
  }, [activeBuilding]);

  const handleStatusColor = (status: UnitStatus) => {
    switch (status) {
      case UnitStatus.Occupied: return 'bg-blue-100 border-blue-300 text-blue-700';
      case UnitStatus.Reserved: return 'bg-amber-100 border-amber-300 text-amber-700';
      default: return 'bg-slate-50 border-slate-200 text-slate-500 hover:border-blue-400';
    }
  };

  // 优化后的单元格尺寸计算，根据面积比例动态调整宽度
  const getSizeClass = (area: number) => {
      // 基于面积区间的细粒度分级，让视觉宽度与面积成比例
      if (area >= 2000) return 'col-span-full'; // 超大面积：整行
      if (area >= 1200) return 'col-span-6 md:col-span-8'; // 大面积
      if (area >= 800) return 'col-span-4 md:col-span-6'; // 较大面积
      if (area >= 500) return 'col-span-3 md:col-span-4'; // 中大面积
      if (area >= 300) return 'col-span-2 md:col-span-3'; // 中等面积
      if (area >= 200) return 'col-span-2'; // 中小面积
      if (area >= 100) return 'col-span-1 md:col-span-2'; // 小面积
      return 'col-span-1'; // 微小面积
  };

  const openAddBuilding = () => {
    setEditingBuilding({ name: '', isNew: true, type: 'Building' });
    setIsBuildingModalOpen(true);
  };

  const openEditBuilding = () => {
    if (!activeBuilding) return;
    setEditingBuilding({ ...activeBuilding, isNew: false });
    setIsBuildingModalOpen(true);
  };

  const saveBuilding = () => {
    if (!editingBuilding.name) {
       alert("请输入名称"); 
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
    setIsBuildingModalOpen(false);
  };

  const handleDeleteBuilding = (id: string) => {
    if (window.confirm("确定要删除该资产吗？此操作不可恢复。")) {
      const newBuildings = buildings.filter(b => b.id !== id);
      onUpdateBuildings(newBuildings);
      if (activeBuildingId === id && newBuildings.length > 0) {
        setActiveBuildingId(newBuildings[0].id);
      }
    }
  };

  const openAddUnit = () => {
    setEditingUnit({ name: '', floor: 1, area: 100, status: UnitStatus.Vacant, isSelfUse: false, isNew: true });
    setShowSplitForm(false);
    setIsUnitModalOpen(true);
  };

  const openEditUnit = (unit: Unit) => {
    setEditingUnit({ ...unit, isNew: false });
    setShowSplitForm(false);
    setSplitData({ currentArea: unit.area, newUnitName: `${unit.name}-B` });
    setIsUnitModalOpen(true);
  };

  const saveUnit = () => {
    if (!activeBuilding) return;
    if (!editingUnit.name || !editingUnit.area || !editingUnit.floor) {
        alert("请填写完整的单元信息");
        return;
    }
    const newUnitData: Unit = {
        id: editingUnit.id || `${activeBuilding.id}-${editingUnit.name}`,
        name: editingUnit.name,
        floor: Number(editingUnit.floor),
        area: Number(Number(editingUnit.area).toFixed(2)),
        status: editingUnit.status || UnitStatus.Vacant,
        isSelfUse: editingUnit.isSelfUse || false,
    };
    const updatedBuildings = buildings.map(b => {
        if (b.id === activeBuilding.id) {
            let newUnits;
            if (editingUnit.isNew) {
                if (b.units.some(u => u.id === newUnitData.id)) {
                    alert("单元ID已存在，请修改房号");
                    return b;
                }
                newUnits = [...b.units, newUnitData];
            } else {
                newUnits = b.units.map(u => u.id === editingUnit.id ? newUnitData : u);
            }
            newUnits.sort((x, y) => x.name.localeCompare(y.name));
            return { ...b, units: newUnits };
        }
        return b;
    });
    onUpdateBuildings(updatedBuildings);
    setIsUnitModalOpen(false);
  };

  const handleSplitUnit = () => {
      if (!activeBuilding || !editingUnit.id) return;
      if (splitData.currentArea >= (editingUnit.area || 0)) {
          alert("拆分后的当前单元面积必须小于原面积");
          return;
      }
      if (!splitData.newUnitName) {
          alert("请输入新单元名称");
          return;
      }
      const originalArea = editingUnit.area || 0;
      const remainingArea = Number((originalArea - splitData.currentArea).toFixed(2));
      const updatedOriginalUnit: Unit = { ...editingUnit as Unit, area: Number(splitData.currentArea.toFixed(2)) };
      const newUnit: Unit = {
          id: `${activeBuilding.id}-${splitData.newUnitName}`,
          name: splitData.newUnitName,
          floor: editingUnit.floor || 1,
          area: remainingArea,
          status: UnitStatus.Vacant,
          isSelfUse: false
      };
      const updatedBuildings = buildings.map(b => {
          if (b.id === activeBuilding.id) {
              const newUnits = b.units.map(u => u.id === editingUnit.id ? updatedOriginalUnit : u);
              newUnits.push(newUnit);
              newUnits.sort((x, y) => x.name.localeCompare(y.name));
              return { ...b, units: newUnits };
          }
          return b;
      });
      onUpdateBuildings(updatedBuildings);
      setIsUnitModalOpen(false);
  };

  const handleDeleteUnit = () => {
    if (!activeBuilding || !editingUnit.id) return;
    if (window.confirm("确定删除该单元？")) {
       const updatedBuildings = buildings.map(b => {
          if (b.id === activeBuilding.id) {
              return { ...b, units: b.units.filter(u => u.id !== editingUnit.id) };
          }
          return b;
       });
       onUpdateBuildings(updatedBuildings);
       setIsUnitModalOpen(false);
    }
  };

  const activeTenantForUnit = tenants.find(t => 
    editingUnit.id && t.unitIds.includes(editingUnit.id) && t.status === 'Active'
  );

  return (
    <div className="space-y-6">
      {/* 园区总览统计 - 全面统一招商签约口径 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {[
          { label: '园区总面积', value: globalStats.totalArea, unit: '㎡', icon: <Maximize size={18}/>, color: 'bg-slate-50 text-slate-600' },
          { label: '自用面积', value: globalStats.selfUseArea, unit: '㎡', icon: <Coffee size={18}/>, color: 'bg-slate-50 text-slate-500' },
          { label: '可出租面积', value: globalStats.leasableArea, unit: '㎡', icon: <Unlock size={18}/>, color: 'bg-blue-50 text-blue-600' },
          { label: '已出租面积', value: globalStats.leasedArea, unit: '㎡', icon: <ShieldCheck size={18}/>, color: 'bg-emerald-50 text-emerald-600' },
          { label: '待出租面积', value: globalStats.vacantArea, unit: '㎡', icon: <LayoutGrid size={18}/>, color: 'bg-amber-50 text-amber-600' },
          { label: '当前出租率', value: globalStats.rate, unit: '%', icon: <Percent size={18}/>, color: 'bg-sky-600 text-white shadow-md' },
        ].map((stat, i) => (
          <div key={i} className={`p-4 rounded-xl border border-slate-200/60 shadow-sm flex flex-col justify-between ${stat.color}`}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider opacity-80">{stat.label}</span>
              <span className="opacity-70">{stat.icon}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold tabular-nums">
                {typeof stat.value === 'number' ? stat.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : stat.value}
              </span>
              <span className="text-[10px] font-medium opacity-70">{stat.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Signing-based Occupancy Trend Dashboard */}
      <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                  <div className="bg-purple-100 p-2 rounded-lg text-purple-600">
                    <TrendingUp size={20}/>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">招商签约进度折现图</h3>
                    <p className="text-xs text-slate-500 mt-0.5">按合同“签约时间”统计的累计出租率趋势 (招商口径，不含场地)</p>
                  </div>
              </div>
              <div className="text-right hidden md:block">
                  <div className="text-xs text-slate-400 font-medium">当前累计签约面积</div>
                  <div className="text-xl font-bold text-purple-600">
                      {globalStats.leasedArea.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ㎡
                  </div>
              </div>
          </div>
          
          <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={signingTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                          <linearGradient id="colorSigned" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.15}/>
                              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                          </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="month" 
                        tick={{fill: '#94a3b8', fontSize: 10}} 
                        axisLine={false} 
                        tickLine={false} 
                        dy={10}
                      />
                      <YAxis 
                        yAxisId="occupancy"
                        tick={{fill: '#94a3b8', fontSize: 10}} 
                        axisLine={false} 
                        tickLine={false} 
                        unit="%"
                        domain={[0, 100]}
                      />
                      <YAxis yAxisId="area" hide />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                        formatter={(value: any, name: string) => {
                            if (name === '签约出租率') return [`${value}%`, name];
                            return [value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ㎡', name];
                        }}
                      />
                      <Area 
                        yAxisId="occupancy"
                        type="monotone" 
                        dataKey="occupancy" 
                        name="签约出租率" 
                        stroke="#8b5cf6" 
                        strokeWidth={3} 
                        fillOpacity={1} 
                        fill="url(#colorSigned)" 
                      />
                  </AreaChart>
              </ResponsiveContainer>
          </div>
          
          <div className="mt-4 flex items-center gap-4 text-[10px] text-slate-400 font-medium border-t border-slate-50 pt-4">
              <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                  <span>累计签约出租率 (%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                  <Info size={12} className="text-slate-300"/>
                  <span>统计逻辑：基于合同 Signing Date 累计，顶部汇总卡片已与此图表完全同步</span>
              </div>
          </div>
      </div>

      <div className="flex justify-between items-center pt-4">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Building2Icon size={24} className="text-blue-600" /> 楼宇资管列表
        </h2>
        <button 
          onClick={openAddBuilding}
          className="flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm text-sm md:text-base"
        >
          <Plus size={16} /> <span className="hidden md:inline">新增资产</span><span className="md:hidden">新增</span>
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 border-b border-slate-200 scrollbar-hide">
        {buildings.map(b => {
             const bTotal = b.units.reduce((s,u) => s+u.area, 0);
             const bSelfUse = b.units.filter(u => u.isSelfUse).reduce((s, u) => s + u.area, 0);
             const bLeasable = bTotal - bSelfUse;
             
             // Sync building card rate as well
             let bSignedArea = 0;
             const now = new Date();
             tenants.forEach(t => {
                 if (t.buildingId === b.id && t.status !== ContractStatus.Expired) {
                    const achievedDate = t.signingDate ? new Date(t.signingDate) : new Date(t.leaseStart);
                    const terminated = t.terminationDate ? new Date(t.terminationDate) : null;
                    if (achievedDate <= now && (!terminated || terminated > now)) {
                        bSignedArea += t.totalArea;
                    }
                 }
             });

             const rate = bLeasable > 0 ? Math.round((bSignedArea/bLeasable)*100) : 0;
             const isSite = b.type === 'Site';

             return (
                <button
                    key={b.id}
                    onClick={() => setActiveBuildingId(b.id)}
                    className={`px-4 py-3 md:px-5 rounded-t-lg font-medium transition-colors flex flex-col items-start gap-1 min-w-[120px] md:min-w-[140px] flex-shrink-0 ${
                    activeBuildingId === b.id 
                        ? 'bg-white border-x border-t border-slate-200 text-blue-600 relative top-[1px]' 
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                >
                    <div className="flex items-center gap-2">
                        {isSite ? <MapPin size={16} className="text-orange-500"/> : <Home size={16} />}
                        <span className="truncate max-w-[80px] md:max-w-none">{b.name}</span>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${isSite ? 'bg-orange-100 text-orange-700' : 'bg-slate-200 text-slate-600'}`}>
                        {isSite ? '类型: 场地' : `签约率: ${rate}%`}
                    </span>
                </button>
            );
        })}
      </div>

      {activeBuilding && buildingStats && (
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-slate-100 pb-4">
             <div>
                 <div className="flex flex-col md:flex-row md:items-baseline gap-2 md:gap-3">
                    <div className="flex items-center gap-2">
                        <h3 className="text-xl md:text-2xl font-bold text-slate-800">{activeBuilding.name}</h3>
                        {activeBuilding.type === 'Site' && <span className="bg-orange-100 text-orange-700 text-xs px-2 py-1 rounded-full font-bold">场地资产</span>}
                        <button onClick={openEditBuilding} className="text-slate-400 hover:text-blue-600 p-1"><Edit2 size={14}/></button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 md:gap-3 text-sm text-slate-500">
                        <span>总面积: {buildingStats.totalArea.toFixed(2)}㎡</span>
                        <span className="hidden md:inline w-px h-3 bg-slate-300"></span>
                        <span className={buildingStats.selfUseArea > 0 ? 'text-slate-800 font-medium' : ''}>
                            可租: {buildingStats.leasableArea.toFixed(2)}㎡
                        </span>
                        {buildingStats.selfUseArea > 0 && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-1 rounded border border-gray-200">
                                含自用 {buildingStats.selfUseArea.toFixed(2)}㎡
                            </span>
                        )}
                        {activeBuilding.type !== 'Site' && (
                            <>
                                <span className="hidden md:inline w-px h-3 bg-slate-300"></span>
                                <span>签约出租率: <strong className="text-blue-600">{buildingStats.rate}%</strong></span>
                            </>
                        )}
                    </div>
                 </div>
             </div>
             
             <div className="flex gap-2 w-full md:w-auto">
                 <button onClick={openAddUnit} className="flex-1 md:flex-none justify-center text-sm px-3 py-1.5 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 font-medium flex items-center gap-1">
                    <Plus size={14} /> 新增{activeBuilding.type === 'Site' ? '地块' : '单元'}
                 </button>
                 <button onClick={() => handleDeleteBuilding(activeBuilding.id)} className="flex-1 md:flex-none justify-center text-sm px-3 py-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50 flex items-center gap-1">
                    <Trash2 size={14} /> 删除{activeBuilding.type === 'Site' ? '场地' : '楼宇'}
                 </button>
            </div>
          </div>

          <div className="flex gap-4 text-xs mb-6 overflow-x-auto pb-2 scrollbar-hide">
               <div className="flex items-center gap-1.5 whitespace-nowrap flex-shrink-0">
                 <div className="w-8 h-8 bg-slate-50 border border-slate-200 rounded"></div>
                 <span>待租</span>
               </div>
               <div className="flex items-center gap-1.5 ml-2 whitespace-nowrap flex-shrink-0">
                 <div className="w-8 h-8 bg-blue-100 border border-blue-300 rounded"></div>
                 <span>已租</span>
               </div>
               <div className="flex items-center gap-1.5 ml-2 whitespace-nowrap flex-shrink-0">
                 <div className="w-8 h-8 bg-gray-200 border border-gray-300 rounded opacity-75"></div>
                 <span>自用</span>
               </div>
               <div className="flex items-center gap-1.5 ml-2 whitespace-nowrap flex-shrink-0">
                  <div className="flex items-center text-slate-500 bg-slate-100 rounded px-1"><Car size={10} /></div>
                  <span>车位</span>
               </div>
          </div>

          <div className="space-y-6">
            {Object.keys(unitsByFloor).sort((a,b) => Number(b) - Number(a)).map(floor => (
              <div key={floor} className="flex gap-2 md:gap-4">
                <div className="w-8 md:w-12 h-[80px] flex-shrink-0 flex items-center justify-center font-bold text-slate-500 bg-slate-100 rounded-lg text-sm md:text-base">
                  {floor}F
                </div>
                <div className="flex-1 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 auto-rows-[80px] gap-2 md:gap-3 grid-flow-dense">
                  {unitsByFloor[Number(floor)].map(unit => {
                    const tenant = tenants.find(t => t.unitIds.includes(unit.id) && t.status === 'Active');
                    const isSelfUse = unit.isSelfUse;
                    const hasParking = tenant && ((tenant.contractParkingSpaces || 0) > 0 || (tenant.actualParkingSpaces || 0) > 0);
                    return (
                        <div 
                        key={unit.id}
                        onClick={() => openEditUnit(unit)}
                        className={`relative p-2 md:p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md group flex flex-col justify-between overflow-hidden
                            ${isSelfUse 
                                ? 'bg-gray-100 border-gray-200 text-gray-500 hover:border-gray-300' 
                                : handleStatusColor(unit.status)} 
                            ${getSizeClass(unit.area)}
                        `}
                        >
                        <div className="flex justify-between items-start">
                            <span className="font-bold text-sm md:text-lg truncate pr-1">{unit.name}</span>
                            <div className="flex gap-1">
                                {isSelfUse && <span title="自用" className="text-gray-400"><Coffee size={12}/></span>}
                                {tenant?.specialRequirements && !isSelfUse && (
                                <span title="有特殊备注">
                                    <Info size={12} className="text-blue-500" />
                                </span>
                                )}
                            </div>
                        </div>
                        <div className="mt-1 flex flex-col justify-end">
                            <div className="flex justify-between items-end">
                                <div className="min-w-0">
                                    <div className="text-[10px] md:text-xs opacity-75">{unit.area.toFixed(2)} ㎡</div>
                                    <div className="text-[10px] md:text-xs font-medium truncate w-full" title={isSelfUse ? '自用' : tenant?.name}>
                                        {isSelfUse ? '自用保留' : (unit.status === UnitStatus.Vacant ? '待租' : tenant?.name || '已租')}
                                    </div>
                                </div>
                                {hasParking && !isSelfUse && (
                                    <div className="text-[10px] text-slate-500 flex items-center gap-0.5 bg-white/50 rounded px-1 mb-0.5 hidden sm:flex" title={`车位: 约定${tenant.contractParkingSpaces} / 实际${tenant.actualParkingSpaces}`}>
                                        <Car size={10} /> 
                                        <span>{tenant?.actualParkingSpaces || 0}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white/50 rounded pointer-events-none">
                            <span className="p-1 rounded shadow-sm text-xs hover:bg-white"><Edit2 size={10} /></span>
                        </div>
                        </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isBuildingModalOpen && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
             <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-50 duration-200">
                 <div className="flex justify-between items-center mb-4">
                     <h3 className="text-lg font-bold">{editingBuilding.isNew ? '新增资产' : '编辑资产'}</h3>
                     <button onClick={() => setIsBuildingModalOpen(false)}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                 </div>
                 <div className="space-y-4">
                     <div>
                         <label className="block text-sm font-medium text-slate-700 mb-1">资产类型</label>
                         <div className="flex gap-4">
                             <label className="flex items-center gap-2 cursor-pointer">
                                 <input type="radio" name="buildingType" checked={editingBuilding.type === 'Building' || !editingBuilding.type} onChange={() => setEditingBuilding({...editingBuilding, type: 'Building'})} className="text-blue-600" />
                                 <span className="text-sm">楼宇</span>
                             </label>
                             <label className="flex items-center gap-2 cursor-pointer">
                                 <input type="radio" name="buildingType" checked={editingBuilding.type === 'Site'} onChange={() => setEditingBuilding({...editingBuilding, type: 'Site'})} className="text-orange-600" />
                                 <span className="text-sm">场地</span>
                             </label>
                         </div>
                     </div>
                     <div>
                         <label className="block text-sm font-medium text-slate-700 mb-1">名称</label>
                         <input type="text" className="w-full border rounded-lg p-2" value={editingBuilding.name} onChange={e => setEditingBuilding({...editingBuilding, name: e.target.value})} placeholder={editingBuilding.type === 'Site' ? '例如: 中央广场' : '例如: 5号楼'} />
                     </div>
                     {editingBuilding.type === 'Site' && (
                         <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
                             注意：场地类型的资产仅用于记录租赁状态和收款，<strong>不计入园区的出租率统计</strong>。
                         </div>
                     )}
                     <div className="flex justify-end pt-2">
                         <button onClick={saveBuilding} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 w-full md:w-auto">保存</button>
                     </div>
                 </div>
             </div>
         </div>
      )}

      {isUnitModalOpen && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
             <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 animate-in zoom-in-50 duration-200 overflow-y-auto max-h-[90vh]">
                 <div className="flex justify-between items-center mb-4 border-b pb-2">
                     <h3 className="text-lg font-bold">{editingUnit.isNew ? `新增${activeBuilding?.type === 'Site' ? '地块' : '单元'}` : `编辑${activeBuilding?.type === 'Site' ? '地块' : '单元'} ${editingUnit.name}`}</h3>
                     <button onClick={() => setIsUnitModalOpen(false)}><X size={24} className="text-slate-400 hover:text-slate-600" /></button>
                 </div>
                 <div className="space-y-4">
                     <div className="grid grid-cols-2 gap-4">
                         <div>
                             <label className="block text-sm font-medium text-slate-700 mb-1">名称/房号</label>
                             <input type="text" className="w-full border rounded-lg p-2" value={editingUnit.name} onChange={e => setEditingUnit({...editingUnit, name: e.target.value})} />
                         </div>
                         <div>
                             <label className="block text-sm font-medium text-slate-700 mb-1">楼层/区块</label>
                             <input type="number" className="w-full border rounded-lg p-2" value={editingUnit.floor} onChange={e => setEditingUnit({...editingUnit, floor: Number(e.target.value)})} />
                         </div>
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                         <div>
                             <label className="block text-sm font-medium text-slate-700 mb-1">面积 (㎡)</label>
                             <input type="number" step="0.01" className="w-full border rounded-lg p-2" value={editingUnit.area} onChange={e => setEditingUnit({...editingUnit, area: Number(e.target.value)})} />
                         </div>
                         <div>
                             <label className="block text-sm font-medium text-slate-700 mb-1">状态</label>
                             <select className="w-full border rounded-lg p-2" value={editingUnit.status} onChange={e => setEditingUnit({...editingUnit, status: e.target.value as UnitStatus})} disabled={editingUnit.status === UnitStatus.Occupied}>
                                 <option value={UnitStatus.Vacant}>空置</option>
                                 <option value={UnitStatus.Occupied}>已租 (由合同控制)</option>
                                 <option value={UnitStatus.Reserved}>预留</option>
                             </select>
                         </div>
                     </div>
                     <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border border-gray-100">
                        <div className="flex items-center h-5">
                            <input id="isSelfUse" type="checkbox" checked={editingUnit.isSelfUse || false} onChange={e => setEditingUnit({...editingUnit, isSelfUse: e.target.checked})} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                        </div>
                        <div className="text-sm">
                            <label htmlFor="isSelfUse" className="font-medium text-gray-700">设为自用</label>
                            <p className="text-xs text-gray-500">自用部分将从可租赁面积、出租率统计及营收目标中剔除。</p>
                        </div>
                     </div>
                     {!editingUnit.isNew && (
                         <div className="border-t border-dashed pt-3 mt-1">
                             <div className="flex justify-between items-center mb-2">
                                <button onClick={() => setShowSplitForm(!showSplitForm)} className="text-xs font-semibold text-blue-600 flex items-center gap-1 hover:underline"><Scissors size={12} /> {showSplitForm ? '取消拆分' : '拆分此单元'}</button>
                             </div>
                             {showSplitForm && (
                                 <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm space-y-3 animate-in slide-in-from-top-2">
                                     <div className="grid grid-cols-2 gap-3">
                                         <div>
                                             <label className="block text-xs font-medium text-slate-600 mb-1">保留面积 (原单元)</label>
                                             <input type="number" step="0.01" className="w-full p-1.5 border rounded" value={splitData.currentArea} onChange={e => setSplitData({...splitData, currentArea: Number(e.target.value)})} />
                                         </div>
                                         <div>
                                             <label className="block text-xs font-medium text-slate-600 mb-1">拆分出的新单元名称</label>
                                             <input type="text" className="w-full p-1.5 border rounded" value={splitData.newUnitName} onChange={e => setSplitData({...splitData, newUnitName: e.target.value})} />
                                         </div>
                                     </div>
                                     <div className="flex justify-between items-center bg-blue-50 p-2 rounded text-blue-700 text-xs font-medium">
                                         <span>新单元面积: {((editingUnit.area || 0) - splitData.currentArea).toFixed(2)} ㎡</span>
                                         <button onClick={handleSplitUnit} className="bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">确认拆分</button>
                                     </div>
                                 </div>
                             )}
                         </div>
                     )}
                     {activeTenantForUnit && !editingUnit.isSelfUse && (
                         <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm">
                             <div className="flex items-center gap-2 mb-2 font-semibold text-blue-800"><Users size={16} /> 当前租户</div>
                             <p><span className="text-blue-600">企业:</span> {activeTenantForUnit.name}</p>
                             <p><span className="text-blue-600">租期:</span> {activeTenantForUnit.leaseStart} ~ {activeTenantForUnit.leaseEnd}</p>
                         </div>
                     )}
                     <div className="flex justify-between pt-4 border-t mt-2 gap-4">
                         {!editingUnit.isNew ? (
                            <button onClick={handleDeleteUnit} className="text-red-500 hover:text-red-700 text-sm flex items-center gap-1"><Trash2 size={16} /> 删除</button>
                         ) : <div></div>}
                         <div className="flex gap-2">
                            <button onClick={() => setIsUnitModalOpen(false)} className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50">取消</button>
                            <button onClick={saveUnit} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">保存</button>
                         </div>
                     </div>
                 </div>
             </div>
         </div>
      )}
    </div>
  );
};
