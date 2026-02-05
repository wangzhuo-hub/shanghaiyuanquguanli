
import React from 'react';
import { DashboardData } from '../types';
import { CheckCircle2, AlertCircle, Building2, Wallet, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface BillingTableProps {
    data: DashboardData;
    selectedMonth: string;
    onMonthChange: (val: string) => void;
}

// Mobile Card Component
const BillingCard: React.FC<{ item: any, building: any, unitNames: string, isPaid: boolean, isPartial: boolean }> = ({ item, building, unitNames, isPaid, isPartial }) => (
    <div className="bg-white p-4 border-b border-slate-100 last:border-0">
        <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2 font-medium text-slate-800">
                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold">
                    {item.tenantName.substring(0,1)}
                </span>
                {item.tenantName}
            </div>
            {isPaid ? (
                <div className="text-green-600 text-xs font-medium bg-green-50 px-2 py-0.5 rounded flex items-center gap-1">
                    <CheckCircle2 size={12} /> 已收
                </div>
            ) : (
                <div className="text-amber-600 text-xs font-medium bg-amber-50 px-2 py-0.5 rounded flex items-center gap-1">
                    <AlertCircle size={12} /> {isPartial ? '部分' : '待缴'}
                </div>
            )}
        </div>
        <div className="text-xs text-slate-500 mb-2">
            {building?.name} {unitNames}
        </div>
        <div className="flex justify-between items-center text-sm border-t border-slate-50 pt-2 mt-1">
            <div className="text-slate-500">
                应收: <span className="font-semibold text-slate-700">¥{item.amountDue.toLocaleString()}</span>
            </div>
            <div className={isPaid ? 'text-green-600' : 'text-blue-600'}>
                实收: <span className="font-bold">¥{item.amountPaid.toLocaleString()}</span>
            </div>
        </div>
    </div>
);

export const BillingTable: React.FC<BillingTableProps> = ({ data, selectedMonth, onMonthChange }) => {
  const billingList = data.currentMonthBilling || [];

  const totalDue = billingList.reduce((acc, curr) => acc + curr.amountDue, 0);
  const totalPaid = billingList.reduce((acc, curr) => acc + curr.amountPaid, 0);

  const handlePrevMonth = () => {
      if (!selectedMonth) return;
      const parts = selectedMonth.split('-');
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      
      let newYear = year;
      let newMonth = month - 1;
      if (newMonth < 1) {
          newMonth = 12;
          newYear -= 1;
      }
      onMonthChange(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
      if (!selectedMonth) return;
      const parts = selectedMonth.split('-');
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      
      let newYear = year;
      let newMonth = month + 1;
      if (newMonth > 12) {
          newMonth = 1;
          newYear += 1;
      }
      onMonthChange(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-4 md:p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center bg-gradient-to-r from-slate-50 to-white gap-4">
        <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start">
             <div className="flex items-center gap-4">
                 <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
                    <Wallet size={20} />
                 </div>
                 <div>
                    <h3 className="text-lg font-bold text-slate-800">租金账单明细</h3>
                    <p className="text-xs text-slate-500 mt-0.5">来源: 预算管理 (含手动调整)</p>
                 </div>
             </div>
             
             {/* Arrow Navigation */}
             <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
                 <button onClick={handlePrevMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors">
                     <ChevronLeft size={16}/>
                 </button>
                 <div className="flex items-center gap-2 px-2 text-sm font-medium text-slate-700 min-w-[80px] justify-center">
                     <Calendar size={14} className="text-slate-400"/>
                     <span>{selectedMonth}</span>
                 </div>
                 <button onClick={handleNextMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors">
                     <ChevronRight size={16}/>
                 </button>
             </div>
        </div>
        
        <div className="flex gap-4 md:gap-6 items-center w-full md:w-auto bg-slate-50 md:bg-transparent p-3 md:p-0 rounded-lg justify-around md:justify-end">
             <div className="text-center md:text-right">
                 <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">当月应收总额</p>
                 <p className="text-base md:text-lg font-bold text-slate-800">¥{totalDue.toLocaleString()}</p>
             </div>
             <div className="h-8 w-px bg-slate-200 block md:hidden"></div>
             <div className="text-center md:text-right md:border-l md:border-slate-200 md:pl-6">
                 <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">当月实收总额</p>
                 <p className={`text-base md:text-lg font-bold ${totalPaid >= totalDue ? 'text-emerald-600' : 'text-blue-600'}`}>¥{totalPaid.toLocaleString()}</p>
             </div>
        </div>
      </div>
      
      {billingList.length === 0 ? (
          <div className="p-12 text-center">
             <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-slate-400 mb-3">
                 <Building2 size={24} />
             </div>
             <p className="text-slate-500">该月份暂无应收租金账单。</p>
          </div>
      ) : (
        <>
            {/* Desktop View */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-medium">
                    <tr>
                    <th className="px-6 py-4">签约客户</th>
                    <th className="px-6 py-4">租赁房号</th>
                    <th className="px-6 py-4">应收租金</th>
                    <th className="px-6 py-4">实收租金</th>
                    <th className="px-6 py-4">缴纳状态</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {billingList.map((item, index) => {
                        const building = data.buildings.find(b => b.units.some(u => item.unitIds.includes(u.id)));
                        const unitNames = item.unitIds.map(uid => {
                            const unit = building?.units.find(u => u.id === uid);
                            return unit ? unit.name : uid;
                        }).join(', ');
                        
                        const isPaid = item.status === 'Paid';
                        const isPartial = item.status === 'Partial';

                        return (
                        <tr key={`${item.tenantId}-${index}`} className="hover:bg-slate-50 transition-colors group">
                            <td className="px-6 py-4 font-medium text-slate-800 flex items-center gap-2">
                            <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold">
                                {item.tenantName.substring(0,1)}
                            </span>
                            {item.tenantName}
                            </td>
                            <td className="px-6 py-4 text-slate-600">
                            {building?.name} <span className="text-slate-400 ml-1">{unitNames}</span>
                            </td>
                            <td className="px-6 py-4 font-semibold text-slate-700">
                                ¥{item.amountDue.toLocaleString()}
                            </td>
                            <td className="px-6 py-4">
                                <span className={isPaid ? 'text-green-600 font-medium' : isPartial ? 'text-amber-600 font-medium' : 'text-slate-400'}>
                                    ¥{item.amountPaid.toLocaleString()}
                                </span>
                            </td>
                            <td className="px-6 py-4">
                                {isPaid ? (
                                    <div className="flex items-center gap-1.5 text-green-600 font-medium bg-green-50 px-2 py-1 rounded-md w-fit">
                                        <CheckCircle2 size={16} className="fill-green-100 stroke-green-600" />
                                        <span>已到账</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5 text-amber-600 font-medium bg-amber-50 px-2 py-1 rounded-md w-fit">
                                        <AlertCircle size={16} />
                                        <span>{isPartial ? '部分缴纳' : '待缴纳'}</span>
                                    </div>
                                )}
                            </td>
                        </tr>
                        );
                    })}
                </tbody>
                </table>
            </div>

            {/* Mobile View */}
            <div className="md:hidden">
                {billingList.map((item, index) => {
                    const building = data.buildings.find(b => b.units.some(u => item.unitIds.includes(u.id)));
                    const unitNames = item.unitIds.map(uid => {
                        const unit = building?.units.find(u => u.id === uid);
                        return unit ? unit.name : uid;
                    }).join(', ');
                    
                    const isPaid = item.status === 'Paid';
                    const isPartial = item.status === 'Partial';

                    return (
                        <BillingCard 
                            key={`${item.tenantId}-${index}`}
                            item={item}
                            building={building}
                            unitNames={unitNames}
                            isPaid={isPaid}
                            isPartial={isPartial}
                        />
                    );
                })}
            </div>
        </>
      )}
    </div>
  );
};
