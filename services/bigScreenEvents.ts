/**
 * 多园区大屏看板 —— 最新动态事件生成
 * 从合同、收款、发票等原始数据派生滚动事件，不新增数据库集合。
 */
import type { Tenant, PaymentRecord, InvoiceRecord, BillingDetail } from '../types';
import { ContractStatus } from '../types';

// ---- types ----

export type BigScreenEventType =
  | 'new_contract'
  | 'new_payment'
  | 'new_invoice'
  | 'expiring_contract'
  | 'overdue_receivable'
  | 'low_occupancy'
  | 'low_collection';

export interface BigScreenEvent {
  id: string;
  parkId: string;
  parkName: string;
  type: BigScreenEventType;
  level: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  description: string;
  tenantId?: string;
  tenantName?: string;
  amount?: number;
  area?: number;
  occurredAt: string;
}

// ---- helpers ----

const now = () => new Date();
const daysAgo = (d: Date, n: number) => new Date(d.getTime() - n * 86400000);
const daysFromNow = (dateStr: string): number => {
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - now().getTime()) / 86400000);
};

const isWithinDays = (dateStr: string | undefined, days: number): boolean => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= daysAgo(now(), days) && d <= now();
};

// ---- event generators ----

export const generateNewContractEvents = (
  tenants: Tenant[],
  parkId: string,
  parkName: string,
  days = 30,
): BigScreenEvent[] =>
  tenants
    .filter(
      (t) =>
        t.signingDate &&
        isWithinDays(t.signingDate, days) &&
        t.status !== ContractStatus.Terminated,
    )
    .map((t) => ({
      id: `new_contract_${parkId}_${t.id}`,
      parkId,
      parkName,
      type: 'new_contract' as const,
      level: 'success' as const,
      title: `${parkName} 新签约 ${t.name}`,
      description: `面积 ${t.totalArea}㎡，起租 ${t.leaseStart || '—'}`,
      tenantId: t.id,
      tenantName: t.name,
      area: t.totalArea,
      amount: t.monthlyRent,
      occurredAt: t.signingDate!,
    }));

export const generateNewPaymentEvents = (
  payments: PaymentRecord[],
  parkId: string,
  parkName: string,
  days = 30,
): BigScreenEvent[] =>
  payments
    .filter(
      (p) =>
        p.status === 'Received' &&
        p.date &&
        isWithinDays(p.date, days),
    )
    .map((p) => {
      const typeLabel =
        p.type === 'Rent'
          ? '租金'
          : p.type === 'Deposit'
            ? '押金'
            : p.type === 'ManagementFee'
              ? '物业费'
              : p.type === 'ParkingFee'
                ? '停车费'
                : p.type === 'DepositToRent'
                  ? '押金转租金'
                  : p.type === 'DepositRefund'
                    ? '押金退还'
                    : '其他';
      return {
        id: `new_payment_${parkId}_${p.id}`,
        parkId,
        parkName,
        type: 'new_payment' as const,
        level: 'info' as const,
        title: `${parkName} 收到 ${p.tenantName || '—'} ${typeLabel}`,
        description: `${(p.amount / 10000).toFixed(1)}万元`,
        tenantId: p.tenantId,
        tenantName: p.tenantName,
        amount: p.amount,
        occurredAt: p.date!,
      };
    });

export const generateNewInvoiceEvents = (
  invoices: InvoiceRecord[],
  parkId: string,
  parkName: string,
  tenantNameById: Map<string, string>,
  days = 30,
): BigScreenEvent[] =>
  invoices
    .filter(
      (inv) =>
        inv.status === 'Invoiced' &&
        inv.invoicedAt &&
        isWithinDays(inv.invoicedAt, days),
    )
    .map((inv) => {
      const tenantName = tenantNameById.get(inv.tenantId) || inv.tenantId || '—';
      return {
        id: `new_invoice_${parkId}_${inv.id}`,
        parkId,
        parkName,
        type: 'new_invoice' as const,
        level: 'info' as const,
        title: `${parkName} ${tenantName} 已开票`,
        description: `${(inv.amount / 10000).toFixed(1)}万元`,
        tenantId: inv.tenantId,
        tenantName,
        amount: inv.amount,
        occurredAt: inv.invoicedAt!,
      };
    });

// ---- contract expiry & overdue events ----

export const generateExpiringContractEvents = (
  tenants: Tenant[],
  parkId: string,
  parkName: string,
  daysAhead = 90,
): BigScreenEvent[] =>
  tenants
    .filter(
      (t) =>
        t.leaseEnd &&
        t.status !== 'Terminated' &&
        t.status !== 'Expired' &&
        t.status !== 'Pending',
    )
    .map((t) => {
      const daysLeft = Math.ceil(
        (new Date(t.leaseEnd!).getTime() - now().getTime()) / 86400000,
      );
      if (daysLeft < 0 || daysLeft > daysAhead) return null;
      return {
        id: `expiring_${parkId}_${t.id}`,
        parkId,
        parkName,
        type: 'expiring_contract' as const,
        level: daysLeft <= 30 ? 'danger' : daysLeft <= 60 ? 'warning' : 'info',
        title: `${parkName} ${t.name} 合同${daysLeft}天后到期`,
        description: `面积 ${t.totalArea}㎡，月租 ${(t.monthlyRent / 10000).toFixed(1)}万元`,
        tenantId: t.id,
        tenantName: t.name,
        area: t.totalArea,
        amount: t.monthlyRent,
        occurredAt: t.leaseEnd!,
      } as BigScreenEvent;
    })
    .filter(Boolean) as BigScreenEvent[];

export const generateOverdueReceivableEvents = (
  billingDetails: BillingDetail[],
  parkId: string,
  parkName: string,
): BigScreenEvent[] =>
  billingDetails
    .filter((b) => {
      const unpaid = (b.amountDue || 0) - (b.amountPaid || 0);
      return (
        unpaid > 0 &&
        (b.status === 'Overdue' || b.status === 'Partial' || b.status === 'Unpaid')
      );
    })
    .map((b) => {
      const unpaid = (b.amountDue || 0) - (b.amountPaid || 0);
      const level = unpaid / 10000 >= 10 ? 'danger' : unpaid / 10000 >= 3 ? 'warning' : 'info';
      return {
        id: `overdue_evt_${parkId}_${b.tenantId}`,
        parkId,
        parkName,
        type: 'overdue_receivable' as const,
        level,
        title: `${parkName} ${b.tenantName || '—'} 未收 ${(unpaid / 10000).toFixed(1)}万元`,
        description:
          b.status === 'Overdue' ? '已逾期' : b.status === 'Partial' ? '部分未收' : '待收款',
        tenantId: b.tenantId,
        tenantName: b.tenantName,
        amount: unpaid,
        occurredAt: now().toISOString(),
      };
    });

// ---- aggregate ----

export interface RawParkData {
  tenants: Tenant[];
  payments: PaymentRecord[];
  invoices: InvoiceRecord[];
  /** 当月应收明细（用于逾期事件和预警） */
  billingDetails?: BillingDetail[];
}

export const generateAllEvents = (
  rawData: RawParkData,
  parkId: string,
  parkName: string,
  days = 30,
): BigScreenEvent[] => {
  const tenantNameById = new Map(rawData.tenants.map((t) => [t.id, t.name]));
  return [
    ...generateNewContractEvents(rawData.tenants, parkId, parkName, days),
    ...generateNewPaymentEvents(rawData.payments, parkId, parkName, days),
    ...generateNewInvoiceEvents(rawData.invoices, parkId, parkName, tenantNameById, days),
    ...generateExpiringContractEvents(rawData.tenants, parkId, parkName),
    ...generateOverdueReceivableEvents(rawData.billingDetails || [], parkId, parkName),
  ];
};

export const sortEventsByTime = (events: BigScreenEvent[]): BigScreenEvent[] =>
  [...events].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
