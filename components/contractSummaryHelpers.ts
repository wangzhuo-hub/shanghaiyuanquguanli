import type { Tenant } from '../types';
export { resolveTenantAssetLabels } from '../services/tenantAssetLabels';

export type ContractSummaryContent =
    | {
          kind: 'vacant';
          building: string;
          unitNames: string;
          leaseStart?: string;
          area: number;
          unitPrice?: number | null;
          rentFreeYearSummary?: string;
          paymentCycleLabel?: string;
      }
    | {
          kind: 'tenant';
          tenant: Tenant;
          buildingLabel: string;
          unitNamesLabel: string;
      }
    | { kind: 'missing'; hint?: string };
