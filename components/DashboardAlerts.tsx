
import React from 'react';
import { Tenant, ContractStatus, InvoiceRecord } from '../types';
import { Calendar, PartyPopper, Cake, X, Flag, Clock, ArrowRight, AlertTriangle } from 'lucide-react';

interface DashboardAlertsProps {
  tenants: Tenant[];
  invoices?: InvoiceRecord[];
}

export const DashboardAlerts: React.FC<DashboardAlertsProps> = ({ tenants, invoices = [] }) => {
  const today = new Date();
  const currentMonth = today.getMonth() + 1; // 1-12
  const currentYear = today.getFullYear();
  const currentDay = today.getDate();
  
  // Calculate Next Month
  let nextMonth = currentMonth + 1;
  let nextMonthYear = currentYear;
  if (nextMonth > 12) {
      nextMonth = 1;
      nextMonthYear = currentYear + 1;
  }

  const [isVisible, setIsVisible] = React.useState(true);

  // Invoice Risk Check
  const showInvoiceRisk = currentDay > 14;
  const pendingInvoices = showInvoiceRisk ? invoices.filter(inv => {
      const targetDate = new Date(inv.targetInvoiceDate);
      return targetDate.getFullYear() === currentYear && 
             (targetDate.getMonth() + 1) === currentMonth && 
             inv.status === 'Pending';
  }) : [];

  // Helper to check month match from date string "MM-DD" or "YYYY-MM-DD"
  const checkMonth = (targetMonth: number, dateStr?: string) => {
    if (!dateStr) return false;
    const parts = dateStr.split('-');
    // If YYYY-MM-DD, month is parts[1]; If MM-DD, month is parts[0]
    const month = parts.length === 3 ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
    return month === targetMonth;
  };

  const getAlertsForMonth = (targetMonth: number, targetYear: number) => {
      // Park Anniversaries (Must be active and start year < target year)
      const park = tenants.filter(t => {
          if (t.status !== ContractStatus.Active || !t.leaseStart) return false;
          const start = new Date(t.leaseStart);
          const startMonth = start.getMonth() + 1;
          const startYear = start.getFullYear();
          return startMonth === targetMonth && targetYear > startYear;
      });

      // Company Founding Anniversaries
      const company = tenants.filter(t => 
        t.status === ContractStatus.Active && checkMonth(targetMonth, t.foundingDate)
      );

      // Birthdays
      const birthday = tenants.filter(t => 
        t.status === ContractStatus.Active && (checkMonth(targetMonth, t.legalRepBirthday) || checkMonth(targetMonth, t.contactBirthday))
      );

      return { park, company, birthday };
  };

  const currentAlerts = getAlertsForMonth(currentMonth, currentYear);
  const nextAlerts = getAlertsForMonth(nextMonth, nextMonthYear);

  const hasCurrent = currentAlerts.park.length > 0 || currentAlerts.company.length > 0 || currentAlerts.birthday.length > 0;
  const hasNext = nextAlerts.park.length > 0 || nextAlerts.company.length > 0 || nextAlerts.birthday.length > 0;
  const hasRisks = pendingInvoices.length > 0;

  if (!isVisible || (!hasCurrent && !hasNext && !hasRisks)) return null;

  return (
    <div className="mb-6 space-y-4">
        {/* Risk Alerts */}
        {hasRisks && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 shadow-sm animate-pulse relative">
                <div className="flex items-start gap-3">
                    <div className="bg-red-100 p-2 rounded-lg text-red-600 mt-1">
                        <AlertTriangle size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-red-800 text-sm mb-1">
                            发票开具风险预警 (本月逾期)
                        </h3>
                        <p className="text-xs text-red-600 mb-2">
                            今天是{currentDay}号，以下客户尚未完成本月开票，请尽快处理：
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {pendingInvoices.map(inv => {
                                const tenantName = tenants.find(t => t.id === inv.tenantId)?.name || '未知客户';
                                return (
                                    <span key={inv.id} className="bg-white border border-red-200 text-red-700 px-2 py-1 rounded text-xs font-medium">
                                        {tenantName} (¥{inv.amount.toLocaleString()})
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Regular Alerts */}
        {(hasCurrent || hasNext) && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm relative animate-in slide-in-from-top-4 fade-in overflow-hidden">
                <button 
                    onClick={() => setIsVisible(false)} 
                    className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 z-10 p-1 hover:bg-slate-100 rounded-full"
                >
                    <X size={16} />
                </button>
                
                {/* Current Month Section */}
                {hasCurrent && (
                    <div className="p-4 bg-gradient-to-r from-violet-50 to-indigo-50">
                        <div className="flex items-start gap-3">
                            <div className="bg-violet-100 p-2 rounded-lg text-violet-600 mt-1 shadow-sm">
                                <PartyPopper size={20} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-violet-900 text-sm mb-3 flex items-center gap-2">
                                    本月 ({currentMonth}月) 关键时刻
                                    <span className="text-[10px] font-normal text-violet-600 bg-white/50 px-2 py-0.5 rounded-full">及时送上祝福</span>
                                </h3>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {/* Park Anniversaries */}
                                    {currentAlerts.park.length > 0 && (
                                        <AlertCard 
                                            title="入园整周年" 
                                            icon={<Flag size={14}/>} 
                                            iconColor="text-emerald-600"
                                            items={currentAlerts.park}
                                            renderItem={(t) => {
                                                const years = currentYear - parseInt(t.leaseStart.split('-')[0]);
                                                return (
                                                    <>
                                                        <span className="truncate flex-1 pr-2">{t.name}</span>
                                                        <span className="font-medium bg-emerald-100 text-emerald-700 px-1.5 rounded flex-shrink-0">入园 {years} 周年</span>
                                                    </>
                                                );
                                            }}
                                        />
                                    )}

                                    {/* Company Anniversaries */}
                                    {currentAlerts.company.length > 0 && (
                                        <AlertCard 
                                            title="企业成立纪念" 
                                            icon={<Calendar size={14}/>} 
                                            iconColor="text-violet-700"
                                            items={currentAlerts.company}
                                            renderItem={(t) => {
                                                const age = t.foundingDate ? (currentYear - parseInt(t.foundingDate.split('-')[0])) : 0;
                                                return (
                                                    <>
                                                        <span className="truncate flex-1 pr-2">{t.name}</span>
                                                        <span className="font-medium bg-violet-100 text-violet-700 px-1.5 rounded flex-shrink-0">{t.foundingDate?.slice(5)} ({age}周年)</span>
                                                    </>
                                                );
                                            }}
                                        />
                                    )}
                                    
                                    {/* Birthdays */}
                                    {currentAlerts.birthday.length > 0 && (
                                        <AlertCard 
                                            title="核心人员生日" 
                                            icon={<Cake size={14}/>} 
                                            iconColor="text-pink-600"
                                            items={currentAlerts.birthday}
                                            renderItem={(t) => {
                                                const isLegal = checkMonth(currentMonth, t.legalRepBirthday);
                                                const isContact = checkMonth(currentMonth, t.contactBirthday);
                                                return (
                                                    <>
                                                        <span className="truncate flex-1 pr-2">{t.name}</span>
                                                        <div className="flex gap-1 flex-shrink-0">
                                                            {isLegal && <span className="bg-pink-100 text-pink-700 px-1.5 rounded text-[10px]" title="高管">{t.legalRepName || '高管'} ({t.legalRepBirthday?.slice(-5)})</span>}
                                                            {isContact && <span className="bg-orange-100 text-orange-700 px-1.5 rounded text-[10px]" title="对接人">{t.contactName || '对接人'} ({t.contactBirthday?.slice(-5)})</span>}
                                                        </div>
                                                    </>
                                                );
                                            }}
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Separator if both exist */}
                {hasCurrent && hasNext && <div className="h-px bg-slate-200 w-full"></div>}

                {/* Next Month Section */}
                {hasNext && (
                    <div className="p-4 bg-slate-50">
                        <div className="flex items-start gap-3">
                            <div className="bg-slate-200 p-2 rounded-lg text-slate-500 mt-1">
                                <Clock size={20} />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-slate-700 text-sm mb-3 flex items-center gap-2">
                                    下月 ({nextMonth}月) 预告 
                                    <span className="text-[10px] font-normal text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                                        <ArrowRight size={10} /> 提前准备关怀
                                    </span>
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-90">
                                    {/* Next Park */}
                                    {nextAlerts.park.length > 0 && (
                                        <AlertCard 
                                            title="入园整周年" 
                                            icon={<Flag size={14}/>} 
                                            iconColor="text-slate-600"
                                            bgColor="bg-white"
                                            items={nextAlerts.park}
                                            renderItem={(t) => {
                                                const years = nextMonthYear - parseInt(t.leaseStart.split('-')[0]);
                                                return (
                                                    <>
                                                        <span className="truncate flex-1 pr-2">{t.name}</span>
                                                        <span className="font-medium bg-slate-100 text-slate-600 px-1.5 rounded flex-shrink-0">{years} 周年</span>
                                                    </>
                                                );
                                            }}
                                        />
                                    )}
                                    {/* Next Company */}
                                    {nextAlerts.company.length > 0 && (
                                        <AlertCard 
                                            title="企业成立纪念" 
                                            icon={<Calendar size={14}/>} 
                                            iconColor="text-slate-600"
                                            bgColor="bg-white"
                                            items={nextAlerts.company}
                                            renderItem={(t) => {
                                                const age = t.foundingDate ? (nextMonthYear - parseInt(t.foundingDate.split('-')[0])) : 0;
                                                return (
                                                    <>
                                                        <span className="truncate flex-1 pr-2">{t.name}</span>
                                                        <span className="font-medium bg-slate-100 text-slate-600 px-1.5 rounded flex-shrink-0">{t.foundingDate?.slice(5)} ({age}周年)</span>
                                                    </>
                                                );
                                            }}
                                        />
                                    )}
                                    {/* Next Birthday */}
                                    {nextAlerts.birthday.length > 0 && (
                                        <AlertCard 
                                            title="核心人员生日" 
                                            icon={<Cake size={14}/>} 
                                            iconColor="text-slate-600"
                                            bgColor="bg-white"
                                            items={nextAlerts.birthday}
                                            renderItem={(t) => {
                                                const isLegal = checkMonth(nextMonth, t.legalRepBirthday);
                                                const isContact = checkMonth(nextMonth, t.contactBirthday);
                                                return (
                                                    <>
                                                        <span className="truncate flex-1 pr-2">{t.name}</span>
                                                        <div className="flex gap-1 flex-shrink-0">
                                                            {isLegal && <span className="bg-slate-100 text-slate-600 px-1.5 rounded text-[10px]">{t.legalRepName || '高管'} ({t.legalRepBirthday?.slice(-5)})</span>}
                                                            {isContact && <span className="bg-slate-100 text-slate-600 px-1.5 rounded text-[10px]">{t.contactName || '对接人'} ({t.contactBirthday?.slice(-5)})</span>}
                                                        </div>
                                                    </>
                                                );
                                            }}
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )}
    </div>
  );
};

// Reusable Sub-component for Alert Cards
interface AlertCardProps {
    title: string;
    icon: React.ReactNode;
    iconColor: string;
    items: Tenant[];
    renderItem: (t: Tenant) => React.ReactNode;
    bgColor?: string;
}

const AlertCard: React.FC<AlertCardProps> = ({ title, icon, iconColor, items, renderItem, bgColor = "bg-white/60" }) => (
    <div className={`${bgColor} p-3 rounded-lg border border-slate-200/60 shadow-sm`}>
        <h4 className={`flex items-center gap-1.5 text-xs font-bold ${iconColor} mb-2`}>
            {icon} {title}
        </h4>
        <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
            {items.map(t => (
                <div key={t.id} className="flex justify-between items-center text-xs text-slate-700">
                    {renderItem(t)}
                </div>
            ))}
        </div>
    </div>
);
