
import React from 'react';
import { Tenant, ContractStatus, InvoiceRecord } from '../types';
import { Calendar, PartyPopper, Cake, X, Flag, Clock, ArrowRight, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../services/numberFormat';

interface DashboardAlertsProps {
  tenants: Tenant[];
  invoices?: InvoiceRecord[];
}

/** 入园关键时刻基准日：优先实际入驻，否则起租日 */
const parkEntryDate = (t: Tenant) => t.moveInDate || t.leaseStart;

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
  const pendingInvoiceTotal = pendingInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);

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
          const ref = parkEntryDate(t);
          if (t.status !== ContractStatus.Active || !ref) return false;
          const start = new Date(ref);
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
    <div className="space-y-3 md:mb-6 md:space-y-4">
        {/* Risk Alerts */}
        {hasRisks && (
            <div className="liquid-glass-readable relative overflow-hidden rounded-[24px] p-3 md:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="liquid-icon-well inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl p-2 text-rose-600 ring-1 ring-rose-200/70">
                        <AlertTriangle size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
                            <h3 className="min-w-0 text-sm font-black text-rose-700">
                                发票开具风险预警 (本月逾期)
                            </h3>
                            <span className="liquid-glass-control shrink-0 rounded-full px-2.5 py-1 text-xs font-black text-rose-700">
                                {pendingInvoices.length} 笔 · {formatCurrency(pendingInvoiceTotal)}
                            </span>
                        </div>
                        <p className="mb-3 text-xs font-semibold leading-5 text-rose-600">
                            今天是{currentDay}号，以下客户尚未完成本月开票，请尽快处理：
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {pendingInvoices.map(inv => {
                                const tenantName = tenants.find(t => t.id === inv.tenantId)?.name || '未知客户';
                                return (
                                    <span key={inv.id} className="liquid-glass-control flex min-w-0 items-center justify-between gap-2 rounded-2xl px-3 py-2 text-xs font-bold text-rose-700">
                                        <span className="min-w-0 truncate">{tenantName}</span>
                                        <span className="shrink-0 tabular-nums">{formatCurrency(inv.amount)}</span>
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
            <div className="liquid-glass-readable relative overflow-hidden rounded-[24px] animate-in slide-in-from-top-4 fade-in">
                <button 
                    onClick={() => setIsVisible(false)} 
                    className="liquid-glass-control liquid-pressable absolute right-2 top-2 z-10 rounded-full p-1.5 text-slate-500 hover:text-slate-800 md:right-3 md:top-3"
                    aria-label="关闭关键时刻提醒"
                >
                    <X size={16} />
                </button>
                
                {/* Current Month Section */}
                {hasCurrent && (
                    <div className="px-3 py-4 md:px-4">
                        <div className="flex items-start gap-3">
                            <div className="liquid-icon-well mt-1 shrink-0 rounded-2xl p-2 text-blue-700 ring-1 ring-blue-200/70">
                                <PartyPopper size={20} />
                            </div>
                            <div className="min-w-0 flex-1 pr-9 sm:pr-0">
                                <h3 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-black text-slate-950">
                                    本月 ({currentMonth}月) 关键时刻
                                    <span className="liquid-glass-control rounded-full px-2.5 py-1 text-xs font-bold text-blue-700">及时送上祝福</span>
                                </h3>
                                
                                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-3 lg:grid-cols-3">
                                    {/* Park Anniversaries */}
                                    {currentAlerts.park.length > 0 && (
                                        <AlertCard 
                                            title="入园整周年" 
                                            icon={<Flag size={14}/>} 
                                            iconColor="text-blue-700"
                                            items={currentAlerts.park}
                                            renderItem={(t) => {
                                                const years = currentYear - parseInt(parkEntryDate(t)!.split('-')[0]);
                                                return (
                                                    <>
                                                        <span className="min-w-0 flex-1 truncate pr-2">{t.name}</span>
                                                        <span className="shrink-0 rounded-full bg-blue-100/80 px-2 py-0.5 font-bold text-blue-700">入园 {years} 周年</span>
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
                                            iconColor="text-cyan-700"
                                            items={currentAlerts.company}
                                            renderItem={(t) => {
                                                const age = t.foundingDate ? (currentYear - parseInt(t.foundingDate.split('-')[0])) : 0;
                                                return (
                                                    <>
                                                        <span className="min-w-0 flex-1 truncate pr-2">{t.name}</span>
                                                        <span className="shrink-0 rounded-full bg-cyan-100/80 px-2 py-0.5 font-bold text-cyan-700">{t.foundingDate?.slice(5)} ({age}周年)</span>
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
                                                        <span className="min-w-0 flex-1 truncate pr-2">{t.name}</span>
                                                        <div className="flex min-w-0 flex-wrap gap-1 sm:flex-shrink-0">
                                                            {isLegal && <span className="rounded-full bg-rose-100/80 px-2 py-0.5 text-xs font-bold text-rose-700" title="高管">{t.legalRepName || '高管'} ({t.legalRepBirthday?.slice(-5)})</span>}
                                                            {isContact && <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-xs font-bold text-amber-700" title="对接人">{t.contactName || '对接人'} ({t.contactBirthday?.slice(-5)})</span>}
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
                {hasCurrent && hasNext && <div className="h-px w-full bg-white/60"></div>}

                {/* Next Month Section */}
                {hasNext && (
                    <div className="px-3 py-4 md:px-4">
                        <div className="flex items-start gap-3">
                            <div className="liquid-icon-well mt-1 shrink-0 rounded-2xl p-2 text-slate-600">
                                <Clock size={20} />
                            </div>
                            <div className="min-w-0 flex-1 pr-9 sm:pr-0">
                                <h3 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-black text-slate-800">
                                    下月 ({nextMonth}月) 预告 
                                    <span className="liquid-glass-control flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-slate-600">
                                        <ArrowRight size={12} /> 提前准备关怀
                                    </span>
                                </h3>
                                <div className="grid grid-cols-1 gap-2.5 opacity-95 md:grid-cols-2 md:gap-3 lg:grid-cols-3">
                                    {/* Next Park */}
                                    {nextAlerts.park.length > 0 && (
                                        <AlertCard 
                                            title="入园整周年" 
                                            icon={<Flag size={14}/>} 
                                            iconColor="text-slate-600"
                                            items={nextAlerts.park}
                                            renderItem={(t) => {
                                                const years = nextMonthYear - parseInt(parkEntryDate(t)!.split('-')[0]);
                                                return (
                                                    <>
                                                        <span className="min-w-0 flex-1 truncate pr-2">{t.name}</span>
                                                        <span className="shrink-0 rounded-full bg-slate-100/90 px-2 py-0.5 font-bold text-slate-600">{years} 周年</span>
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
                                            items={nextAlerts.company}
                                            renderItem={(t) => {
                                                const age = t.foundingDate ? (nextMonthYear - parseInt(t.foundingDate.split('-')[0])) : 0;
                                                return (
                                                    <>
                                                        <span className="min-w-0 flex-1 truncate pr-2">{t.name}</span>
                                                        <span className="shrink-0 rounded-full bg-slate-100/90 px-2 py-0.5 font-bold text-slate-600">{t.foundingDate?.slice(5)} ({age}周年)</span>
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
                                            items={nextAlerts.birthday}
                                            renderItem={(t) => {
                                                const isLegal = checkMonth(nextMonth, t.legalRepBirthday);
                                                const isContact = checkMonth(nextMonth, t.contactBirthday);
                                                return (
                                                    <>
                                                        <span className="min-w-0 flex-1 truncate pr-2">{t.name}</span>
                                                        <div className="flex min-w-0 flex-wrap gap-1 sm:flex-shrink-0">
                                                            {isLegal && <span className="rounded-full bg-slate-100/90 px-2 py-0.5 text-xs font-bold text-slate-600">{t.legalRepName || '高管'} ({t.legalRepBirthday?.slice(-5)})</span>}
                                                            {isContact && <span className="rounded-full bg-slate-100/90 px-2 py-0.5 text-xs font-bold text-slate-600">{t.contactName || '对接人'} ({t.contactBirthday?.slice(-5)})</span>}
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
}

const AlertCard: React.FC<AlertCardProps> = ({ title, icon, iconColor, items, renderItem }) => (
    <div className="liquid-glass-readable rounded-[20px] p-3 md:p-3.5">
        <h4 className={`mb-2 flex items-center justify-between gap-2 text-xs font-bold ${iconColor}`}>
            <span className="min-w-0 flex items-center gap-1.5">
                {icon} <span className="truncate">{title}</span>
            </span>
            <span className="liquid-glass-control shrink-0 rounded-full px-2 py-0.5 text-xs font-black text-slate-600">
                {items.length}
            </span>
        </h4>
        <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar md:max-h-32">
            {items.map(t => (
                <div key={t.id} className="liquid-glass-control flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl px-2.5 py-2 text-xs font-semibold text-slate-700">
                    {renderItem(t)}
                </div>
            ))}
        </div>
    </div>
);
