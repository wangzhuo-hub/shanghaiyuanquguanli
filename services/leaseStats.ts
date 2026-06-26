import { ContractStatus, type Tenant } from '../types';

export interface LeaseStatsSummary {
  newLeasesYear: number;
  newLeasesYearArea: number;
  newLeasesQuarter: number;
  newLeasesQuarterArea: number;
  newLeasesMonth: number;
  newLeasesMonthArea: number;
  terminatedYear: number;
  terminatedYearArea: number;
  terminatedQuarter: number;
  terminatedQuarterArea: number;
  terminatedMonth: number;
  terminatedMonthArea: number;
  netIncreaseYear: number;
  netIncreaseQuarter: number;
  netIncreaseMonth: number;
}

export const emptyLeaseStats = (): LeaseStatsSummary => ({
  newLeasesYear: 0,
  newLeasesYearArea: 0,
  newLeasesQuarter: 0,
  newLeasesQuarterArea: 0,
  newLeasesMonth: 0,
  newLeasesMonthArea: 0,
  terminatedYear: 0,
  terminatedYearArea: 0,
  terminatedQuarter: 0,
  terminatedQuarterArea: 0,
  terminatedMonth: 0,
  terminatedMonthArea: 0,
  netIncreaseYear: 0,
  netIncreaseQuarter: 0,
  netIncreaseMonth: 0,
});

const dateParts = (value: string | undefined): { year: number; quarter: number; month: number } | null => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const month = date.getMonth();
  return {
      year: date.getFullYear(),
      quarter: Math.floor(month / 3),
      month,
  };
};

export const summarizeLeaseStats = (
  tenants: Tenant[],
  selectedYear: number,
  referenceDate: Date = new Date(),
): LeaseStatsSummary => {
  const stats = emptyLeaseStats();
  const currentMonth = referenceDate.getMonth();
  const currentQuarter = Math.floor(currentMonth / 3);

  for (const tenant of tenants) {
      const area = tenant.totalArea || 0;
      const signing = dateParts(tenant.signingDate);
      if (signing?.year === selectedYear) {
          stats.newLeasesYear += 1;
          stats.newLeasesYearArea += area;
          if (signing.quarter === currentQuarter) {
              stats.newLeasesQuarter += 1;
              stats.newLeasesQuarterArea += area;
          }
          if (signing.month === currentMonth) {
              stats.newLeasesMonth += 1;
              stats.newLeasesMonthArea += area;
          }
      }

      if (tenant.status !== ContractStatus.Terminated) continue;
      const ended = dateParts(tenant.terminationDate || tenant.leaseEnd);
      if (ended?.year !== selectedYear) continue;
      stats.terminatedYear += 1;
      stats.terminatedYearArea += area;
      if (ended.quarter === currentQuarter) {
          stats.terminatedQuarter += 1;
          stats.terminatedQuarterArea += area;
      }
      if (ended.month === currentMonth) {
          stats.terminatedMonth += 1;
          stats.terminatedMonthArea += area;
      }
  }

  stats.netIncreaseYear = stats.newLeasesYearArea - stats.terminatedYearArea;
  stats.netIncreaseQuarter = stats.newLeasesQuarterArea - stats.terminatedQuarterArea;
  stats.netIncreaseMonth = stats.newLeasesMonthArea - stats.terminatedMonthArea;
  return stats;
};
