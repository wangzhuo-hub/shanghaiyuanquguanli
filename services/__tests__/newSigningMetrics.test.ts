import { describe, expect, it } from 'vitest';
import { ContractStatus } from '../../types';
import {
    getNewSigningExcludeReason,
    isNewSigningInYear,
    listNewSigningsInYear,
} from '../newSigningMetrics';

describe('newSigningMetrics', () => {
    it('excludes pending renewal draft with rootId from new signings in year', () => {
        const pendingRenewal = {
            id: 't-renew-pending',
            name: '北京华路顺工程咨询有限公司',
            rootId: 't-root',
            signingDate: '2026-04-24',
            leaseStart: '2026-04-24',
            leaseEnd: '2027-04-23',
            status: ContractStatus.Pending,
            totalArea: 245,
        } as any;

        expect(getNewSigningExcludeReason(pendingRenewal, 2026, new Date('2026-05-26'))).toBe(
            'pending_renewal_draft',
        );
        expect(isNewSigningInYear(pendingRenewal, 2026, new Date('2026-05-26'))).toBe(false);
    });

    it('includes active renewal with same signing year', () => {
        const activeRenewal = {
            id: 't-renew-active',
            name: '北京华路顺工程咨询有限公司',
            rootId: 't-root',
            signingDate: '2026-04-24',
            leaseStart: '2026-04-24',
            leaseEnd: '2027-04-23',
            status: ContractStatus.Active,
            totalArea: 245,
        } as any;

        expect(isNewSigningInYear(activeRenewal, 2026, new Date('2026-05-26'))).toBe(true);
    });

    it('dedupes area when only pending draft exists alongside active', () => {
        const tenants = [
            {
                id: 'active',
                signingDate: '2026-04-24',
                leaseStart: '2026-04-24',
                status: ContractStatus.Active,
                totalArea: 245,
            },
            {
                id: 'pending-draft',
                rootId: 'active',
                signingDate: '2026-04-24',
                leaseStart: '2026-04-24',
                status: ContractStatus.Pending,
                totalArea: 245,
            },
        ] as any[];

        const list = listNewSigningsInYear(tenants, 2026, new Date('2026-05-26'));
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('active');
    });
});
