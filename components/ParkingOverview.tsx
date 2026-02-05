
import React from 'react';
import { DashboardData } from '../types';
import { Car } from 'lucide-react';

export const ParkingOverview: React.FC<{ data: DashboardData }> = ({ data }) => {
  const stats = data.parkingStats;

  if (!stats) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
       <div className="p-4 bg-gradient-to-r from-orange-50 to-white flex justify-between items-center">
         <div className="flex items-center gap-3">
            <div className="bg-orange-100 p-2 rounded-lg text-orange-600">
               <Car size={20} />
            </div>
            <div>
               <h3 className="text-lg font-bold text-slate-800">园区月卡车位管理</h3>
               <p className="text-xs text-slate-500 mt-0.5">合同约定与实际办理情况概览 (明细请查看楼宇资产)</p>
            </div>
         </div>
         <div className="flex items-center gap-8 pr-4">
             <div className="text-right">
                 <p className="text-xs text-slate-400">合同约定总数</p>
                 <p className="font-bold text-slate-700 text-lg">{stats.totalContractSpaces} <span className="text-xs font-normal">个</span></p>
             </div>
             <div className="text-right">
                 <p className="text-xs text-slate-400">实际办理/占用</p>
                 <p className="font-bold text-blue-600 text-lg">{stats.totalActualSpaces} <span className="text-xs font-normal">个</span></p>
             </div>
             <div className="text-right">
                 <p className="text-xs text-slate-400">停车费累计收款</p>
                 <p className="font-bold text-orange-600 text-lg">¥{stats.totalMonthlyRevenue.toLocaleString()}</p>
             </div>
         </div>
       </div>
    </div>
  );
};
