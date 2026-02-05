
import React, { useState, useMemo, useEffect } from 'react';
import { Unit, UnitStatus, Opportunity, Activity } from '../types';
import { Building, Download, Plus, Edit2, X, Save, Lock, Calendar, Clock, AlertTriangle, Percent, Layers, ShieldCheck, Database, LayoutGrid, RefreshCw, Wifi, WifiOff, AlertCircle, ExternalLink, HardDrive, Link2, DollarSign, User, ChevronDown, Target, Eye } from 'lucide-react';
import { fetchPropertyUnits, PROPERTY_POCKETBASE_URL_DISPLAY } from '../services/pocketbase';
import { getUnitHeatDetails } from '../services/unitHeatAnalytics';

interface AssetsProps {
  isAdmin: boolean;
  units: Unit[];
  opportunities: Opportunity[]; // 新增
  activities: Activity[]; // 新增
  onAddUnit: (unit: Unit) => void;
  onUpdateUnit: (unit: Unit) => void;
  onDeleteUnit: (id: string) => void;
  onSyncUnits?: (units: Unit[], backupName?: string) => void;
}

export const Assets: React.FC<AssetsProps> = ({ isAdmin, units, opportunities, activities, onAddUnit, onUpdateUnit, onSyncUnits }) => {
  const [activeBuilding, setActiveBuilding] = useState<string>('1号楼');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'ADD' | 'EDIT'>('ADD');
  const [editingUnit, setEditingUnit] = useState<Partial<Unit>>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<'connected' | 'disconnected' | 'syncing'>('disconnected');
  const [syncMetadata, setSyncMetadata] = useState<{ name: string; date: string } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  
  const buildings = Array.from(new Set(units.map(u => u.building))).sort() as string[];
  const filteredUnits = units.filter(u => u.building === activeBuilding);
  const floors = (Array.from(new Set(filteredUnits.map(u => u.floor))) as number[]).sort((a, b) => b - a);

  const instanceId = 'park_data_main@pb8090';

  useEffect(() => {
    handleSyncFromCloud(true);
  }, []);

  const metrics = useMemo(() => {
    const totalArea = units.reduce((acc, u) => acc + u.area, 0);
    const selfUseArea = units.filter(u => u.status === UnitStatus.SELF_USE).reduce((acc, u) => acc + u.area, 0);
    const leasableArea = totalArea - selfUseArea;
    const rentedArea = units.filter(u => u.status === UnitStatus.OCCUPIED).reduce((acc, u) => acc + u.area, 0);
    const vacantArea = units.filter(u => u.status === UnitStatus.VACANT).reduce((acc, u) => acc + u.area, 0);
    const occupancyRate = leasableArea > 0 ? (rentedArea / leasableArea) * 100 : 0;
    return { totalArea, selfUseArea, leasableArea, rentedArea, vacantArea, occupancyRate };
  }, [units]);

  const getStatusColor = (status: UnitStatus, vacantSince?: string) => {
    if (status === UnitStatus.VACANT && !vacantSince) return 'bg-rose-50 border-rose-300 text-rose-800 shadow-rose-100 animate-pulse';
    switch (status) {
      case UnitStatus.OCCUPIED: return 'bg-blue-50 border-blue-200 text-blue-700 hover:shadow-blue-100';
      case UnitStatus.VACANT: return 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300';
      case UnitStatus.RESERVED: return 'bg-amber-50 border-amber-100 text-amber-700';
      case UnitStatus.SELF_USE: return 'bg-slate-50 border-slate-100 text-slate-400';
      default: return 'bg-white border-slate-200';
    }
  };

  const getStatusText = (status: UnitStatus) => {
    switch (status) {
      case UnitStatus.OCCUPIED: return '已出租';
      case UnitStatus.VACANT: return '待出租';
      case UnitStatus.RESERVED: return '预留';
      case UnitStatus.SELF_USE: return '自用/保留';
      default: return status;
    }
  };

  const calculateVacantDays = (since?: string) => {
    if (!since) return 0;
    const diff = Date.now() - new Date(since).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const handleAddClick = () => {
    if (!isAdmin) return;
    setModalMode('ADD');
    setEditingUnit({
      building: activeBuilding || '1号楼',
      floor: 1,
      roomNo: '',
      area: 0,
      status: UnitStatus.VACANT,
      price: undefined,
      tenantName: '',
      vacantSince: new Date().toISOString().slice(0, 10)
    });
    setIsModalOpen(true);
  };

  const handleEditClick = (unit: Unit) => {
    if (!isAdmin) return;
    setModalMode('EDIT');
    setEditingUnit({ ...unit });
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!editingUnit.roomNo || !editingUnit.area || !editingUnit.building) return alert("请填写完整信息");
    if (modalMode === 'ADD') {
      onAddUnit({
        ...editingUnit as Unit,
        id: `U-${Date.now()}`
      });
    } else {
      onUpdateUnit(editingUnit as Unit);
    }
    setIsModalOpen(false);
  };

  const handleSyncFromCloud = async (silent = false) => {
    setCloudStatus('syncing');
    setSyncError(null);
    setIsSyncing(true);
    
    try {
      const response = await fetchPropertyUnits();
      
      if (response.error) {
        // 区分不同类型的错误
        if (response.error.includes('超时')) {
          setSyncError('同步超时，请稍后重试。如持续出现，请检查招商管理系统PocketBase服务是否运行。');
        } else {
          setSyncError(response.error);
        }
        setCloudStatus('disconnected');
        if (!silent) {
          alert(`⚠️ 同步失败：${response.error}`);
        }
        return;
      }
      
      if (response.data && onSyncUnits) {
        if (response.data.length > 0) {
            onSyncUnits(response.data, response.backupName);
            setSyncMetadata({
                name: response.backupName || '数据源',
                date: response.backupDate ? new Date(response.backupDate).toLocaleString() : '实时'
            });
            setCloudStatus('connected');
            console.log(`✅ 同步成功：${response.data.length}个房源单元`);
            if (!silent) alert('✅ 资产云端补录与同步已完成');
        } else {
            setCloudStatus('connected');
            if (!silent) alert('ℹ️ 云端连接成功，但主库暂无有效资产快照，已保持当前数据状态。');
        }
      }
    } catch (err: any) {
      const errorMsg = err?.message || "网络同步异常";
      console.error('同步错误:', err);
      
      // 更友好的错误提示
      if (errorMsg.includes('autocancelled') || errorMsg.includes('cancelled')) {
        setSyncError('请求被取消，可能是网络问题或数据量过大。系统已自动重试，如持续失败请联系管理员。');
      } else if (errorMsg.includes('超时')) {
        setSyncError('连接超时，请检查网络或招商管理系统PocketBase服务状态。');
      } else {
        setSyncError(errorMsg);
      }
      
      setCloudStatus('disconnected');
      if (!silent) {
        alert(`❌ 同步失败：${errorMsg}`);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col relative pb-10">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Building className="text-indigo-600" /> 资产落位与销控大表</h1>
          <div className="flex items-center gap-4 mt-1">
             <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter border ${
                cloudStatus === 'connected' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 
                cloudStatus === 'syncing' ? 'bg-indigo-50 text-indigo-600 border-indigo-200 animate-pulse' : 
                'bg-rose-50 text-rose-500 border-rose-200'
             }`}>
                {cloudStatus === 'connected' ? <Wifi size={10}/> : cloudStatus === 'syncing' ? <RefreshCw size={10} className="animate-spin"/> : <WifiOff size={10}/>}
                连接态: {cloudStatus === 'connected' ? '云端直连' : cloudStatus === 'syncing' ? '握手交互' : '连接中断'}
             </div>
             <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                <Link2 size={10} className="text-indigo-500"/>
                <span>实例: <span className="text-slate-600 font-mono">{instanceId}</span></span>
             </div>
             {syncMetadata && cloudStatus === 'connected' && (
                <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                   <HardDrive size={10} className="text-indigo-500"/> 
                   <span>源表: <span className="text-indigo-600 font-black">park_data_main</span></span>
                </div>
             )}
          </div>
          
          {/* 错误提示条 */}
          {syncError && (
            <div className="mt-2 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs">
              <AlertCircle size={14} className="text-rose-500 mt-0.5 flex-shrink-0"/>
              <div className="flex-1">
                <div className="font-bold text-rose-700 mb-0.5">同步引擎断开异常</div>
                <div className="text-rose-600">{syncError}</div>
                <div className="mt-1.5 text-[10px] text-rose-500">
                  建议：检查网络连接，解决后刷新页面或点击“立即同步主库”重试。不影响本地数据查看与编辑。
                </div>
              </div>
              <button 
                onClick={() => setSyncError(null)}
                className="text-rose-400 hover:text-rose-600 transition-colors"
              >
                <X size={14}/>
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <>
              <button 
                onClick={() => handleSyncFromCloud()} 
                disabled={isSyncing}
                className="bg-white text-slate-700 border border-slate-200 px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
              >
                {isSyncing ? <RefreshCw size={18} className="animate-spin" /> : <RefreshCw size={18}/>} 立即同步主库
              </button>
              <button onClick={handleAddClick} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg hover:bg-indigo-700 transition-all active:scale-95">
                <Plus size={18}/> 新增房源
              </button>
            </>
          )}
        </div>
      </div>

      {syncError && (
        <div className="bg-rose-50 border border-rose-100 p-5 rounded-3xl flex items-start gap-4 animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm shadow-rose-100/50">
          <div className="w-10 h-10 bg-rose-100 rounded-2xl flex items-center justify-center shrink-0">
             <AlertCircle className="text-rose-600" size={20}/>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-black text-rose-800">资产同步提示 (Sync Advisory)</h4>
            <div className="bg-white/50 p-3 rounded-xl border border-rose-200 mt-2">
              <p className="text-xs text-rose-700 leading-relaxed font-medium font-mono">{syncError}</p>
            </div>
            <p className="text-[10px] text-slate-400 mt-2 italic font-bold leading-relaxed">提示：检测到云端数据格式已变更，解析引擎需手动适配。已保护当前数据不被重置。</p>
          </div>
        </div>
      )}

      {/* Panorama Asset Metric Panel */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex divide-x divide-slate-100 shrink-0">
        <div className="w-1/4 p-8 bg-slate-900 text-white flex flex-col justify-between relative overflow-hidden group">
           <div className="relative z-10">
             <div className="flex items-center gap-2 opacity-60 mb-2"><Database size={14} className="text-indigo-400"/><span className="text-[10px] font-black uppercase tracking-widest">园区总规模</span></div>
             <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black">{metrics.totalArea.toLocaleString()}</span>
                <span className="text-xs font-bold text-slate-400">m²</span>
             </div>
           </div>
        </div>
        <div className="flex-1 p-8 grid grid-cols-4 gap-6 items-center">
           <div className="space-y-1">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">已出租面积</p>
             <p className="text-2xl font-black text-indigo-700">{metrics.rentedArea.toLocaleString()} <span className="text-xs font-normal">m²</span></p>
           </div>
           <div className="space-y-1">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">待出租面积</p>
             <p className="text-2xl font-black text-rose-600">{metrics.vacantArea.toLocaleString()} <span className="text-xs font-normal">m²</span></p>
           </div>
           <div className="space-y-1">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">自用/保留</p>
             <p className="text-2xl font-black text-slate-500">{metrics.selfUseArea.toLocaleString()} <span className="text-xs font-normal">m²</span></p>
           </div>
           <div className="bg-emerald-50 rounded-2xl p-5 border border-emerald-100 flex flex-col justify-center text-center">
              <p className="text-[9px] font-black text-emerald-600 uppercase mb-1 tracking-widest">实时出租率</p>
              <p className="text-3xl font-black text-emerald-700">{metrics.occupancyRate.toFixed(1)}%</p>
           </div>
        </div>
      </div>

      <div className="flex gap-4 border-b overflow-x-auto bg-slate-50/50 px-4 rounded-t-2xl shrink-0 pt-2 custom-scrollbar">
        {buildings.map(b => (
          <button key={b} onClick={() => setActiveBuilding(b)} className={`px-8 py-4 font-black text-xs uppercase tracking-widest transition-all relative ${activeBuilding === b ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
            {b}
            {activeBuilding === b && <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full"></div>}
          </button>
        ))}
      </div>

      <div className="flex-1 bg-white border rounded-b-2xl border-t-0 p-8 overflow-y-auto shadow-sm custom-scrollbar">
        <div className="space-y-12">
          {floors.map(floor => (
            <div key={floor} className="flex gap-10">
              <div className="w-16 h-16 flex flex-col items-center justify-center bg-slate-50 rounded-3xl font-black text-slate-400 border border-slate-100 shrink-0 shadow-inner group hover:bg-indigo-600 hover:text-white transition-all cursor-default">
                <span className="text-2xl leading-none">{floor}</span>
                <span className="text-[9px] uppercase tracking-tighter mt-1 opacity-60">Floor</span>
              </div>
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {filteredUnits.filter(u => u.floor === floor).map(unit => (
                  <div key={unit.id} onClick={() => handleEditClick(unit)} className={`group p-6 border-2 rounded-2xl relative transition-all cursor-pointer ${getStatusColor(unit.status, unit.vacantSince)} hover:shadow-xl hover:scale-[1.02] active:scale-95`}>
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-2xl font-black tracking-tighter">{unit.roomNo}</span>
                      {isAdmin && <Edit2 size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </div>
                    
                    <div className="flex flex-col gap-0.5 mb-4">
                        <div className="text-base font-black opacity-80 font-mono">{unit.area} <span className="text-[10px] font-normal">m²</span></div>
                        {unit.price && (
                          <div className="text-[10px] font-bold text-indigo-500 flex items-center gap-0.5">
                             <DollarSign size={10}/> ¥ {unit.price} <span className="text-[8px] font-normal opacity-60">/㎡/天</span>
                          </div>
                        )}
                    </div>

                    {/* 新增：空置房源显示热度统计 */}
                    {unit.status === UnitStatus.VACANT && (() => {
                      const heatData = getUnitHeatDetails(unit.id, opportunities, activities);
                      const hasHeat = heatData.relatedOpportunities.length > 0 || heatData.totalVisits > 0;
                      
                      return hasHeat && (
                        <div className="mb-3 p-2 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-100">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-[9px] font-bold text-indigo-600">
                              <Target size={10}/>
                              <span>{heatData.relatedOpportunities.length} 商机</span>
                            </div>
                            <div className="flex items-center gap-2 text-[9px] font-bold text-purple-600">
                              <Eye size={10}/>
                              <span>{heatData.totalVisits} 次带看</span>
                            </div>
                          </div>
                          {heatData.concernsSummary.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {heatData.concernsSummary.slice(0, 3).map((concern, idx) => (
                                <span key={idx} className="text-[8px] px-1.5 py-0.5 bg-white/80 text-indigo-700 rounded font-bold border border-indigo-100">
                                  {concern.keyword}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <div className="flex items-center justify-between mt-auto pt-4 border-t border-black/5">
                        <span className="text-[9px] uppercase font-black opacity-60 tracking-widest flex items-center gap-1"><Layers size={10}/> {getStatusText(unit.status)}</span>
                        
                        {unit.status === UnitStatus.OCCUPIED && unit.tenantName && (
                           <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded flex items-center gap-1 truncate max-w-[100px]">
                             <User size={10}/> {isAdmin ? unit.tenantName : '******'}
                           </span>
                        )}

                        {unit.status === UnitStatus.VACANT && (
                           unit.vacantSince ? (
                             <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                               <Clock size={9}/> 空置 {calculateVacantDays(unit.vacantSince)} 天
                             </span>
                           ) : (
                             <span className="text-[9px] font-black text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse border border-rose-200 shadow-sm">
                               <AlertCircle size={9}/> 待补录
                             </span>
                           )
                        )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {isModalOpen && editingUnit && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-[560px] shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col overflow-hidden">
            <div className="px-10 py-8 border-b flex justify-between items-center">
              <h2 className="text-2xl font-black text-slate-800">{modalMode === 'ADD' ? '新增房源' : '房源属性编辑'}</h2>
              <button onClick={()=>setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"><X size={28}/></button>
            </div>
            
            <div className="p-10 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">楼宇</label>
                  <input className="w-full border border-slate-200 rounded-xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" value={editingUnit.building} onChange={e=>setEditingUnit({...editingUnit, building:e.target.value})}/>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">楼层</label>
                  <input type="number" className="w-full border border-slate-200 rounded-xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" value={editingUnit.floor} onChange={e=>setEditingUnit({...editingUnit, floor:Number(e.target.value)})}/>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">房号</label>
                  <input className="w-full border border-slate-200 rounded-xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" value={editingUnit.roomNo} onChange={e=>setEditingUnit({...editingUnit, roomNo:e.target.value})} placeholder="例如: 401"/>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">面积 (㎡)</label>
                  <input type="number" className="w-full border border-slate-200 rounded-xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" value={editingUnit.area} onChange={e=>setEditingUnit({...editingUnit, area:Number(e.target.value)})}/>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">当前状态</label>
                <div className="relative">
                   <select className="w-full border border-slate-200 rounded-xl p-4 text-sm font-bold bg-white outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 appearance-none cursor-pointer" value={editingUnit.status} onChange={e=>setEditingUnit({...editingUnit, status: e.target.value as UnitStatus})}>
                      {Object.values(UnitStatus).map(s => <option key={s} value={s}>{getStatusText(s)}</option>)}
                   </select>
                   <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18}/>
                </div>
              </div>

              {editingUnit.status === UnitStatus.VACANT && (
                <div className="grid grid-cols-2 gap-x-8 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest flex items-center gap-1.5"><DollarSign size={12} className="text-indigo-500"/> 报价 (元/㎡/天)</label>
                    <input type="number" step="0.01" className="w-full border border-slate-200 rounded-xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" value={editingUnit.price || ''} onChange={e=>setEditingUnit({...editingUnit, price:Number(e.target.value)})} placeholder="输入单价"/>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest flex items-center gap-1.5"><Calendar size={12} className="text-indigo-500"/> 空置起始时间 (补录)</label>
                    <input type="date" className="w-full border border-slate-200 rounded-xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" value={editingUnit.vacantSince || ''} onChange={e=>setEditingUnit({...editingUnit, vacantSince: e.target.value})}/>
                  </div>
                </div>
              )}

              {(editingUnit.status === UnitStatus.OCCUPIED || editingUnit.status === UnitStatus.RESERVED) && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                  <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest">客户名称</label>
                  <input className="w-full border border-slate-200 rounded-xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" value={editingUnit.tenantName || ''} onChange={e=>setEditingUnit({...editingUnit, tenantName:e.target.value})} placeholder="输入租客公司名称"/>
                </div>
              )}
            </div>

            <div className="px-10 py-8 border-t bg-slate-50 flex justify-end gap-4">
              <button onClick={()=>setIsModalOpen(false)} className="px-10 py-3.5 text-slate-500 font-black text-sm hover:text-slate-800 transition-colors border-2 border-transparent hover:border-slate-200 rounded-2xl">取消</button>
              <button onClick={handleSave} className="bg-indigo-600 text-white px-12 py-3.5 rounded-2xl font-black text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2">
                <Save size={18}/> 保存信息
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
