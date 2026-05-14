import * as XLSX from 'xlsx';
import { ContractStatus, DepositStatus, Tenant } from '../types';

const hasCellValue = (v: unknown): boolean => {
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    return true;
};

export const normalizeExcelDate = (input: unknown): string => {
    const s = String(input ?? '').trim();
    if (!s) return '';
    if (typeof input === 'number' && Number.isFinite(input) && input > 20000 && input < 60000) {
        const d = XLSX.SSF.parse_date_code(input);
        if (d?.y && d?.m && d?.d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    const m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    return s;
};

export const parseExcelNumber = (input: unknown): number | undefined => {
    if (input === null || input === undefined) return undefined;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    const str = String(input).replace(/[,\s￥¥]/g, '').trim();
    if (!str) return undefined;
    const n = Number(str);
    return Number.isFinite(n) ? n : undefined;
};

export const parseContractStatusFromExcel = (v: unknown): ContractStatus | undefined => {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return undefined;
    const map: Record<string, ContractStatus> = {
        active: ContractStatus.Active,
        履约中: ContractStatus.Active,
        在租: ContractStatus.Active,
        expiring: ContractStatus.Expiring,
        即将到期: ContractStatus.Expiring,
        terminated: ContractStatus.Terminated,
        已退租: ContractStatus.Terminated,
        退租: ContractStatus.Terminated,
        pending: ContractStatus.Pending,
        签约中: ContractStatus.Pending,
        expired: ContractStatus.Expired,
        已到期: ContractStatus.Expired,
    };
    if (map[s]) return map[s];
    const cap = s.charAt(0).toUpperCase() + s.slice(1);
    if ((Object.values(ContractStatus) as string[]).includes(cap)) return cap as ContractStatus;
    return undefined;
};

const parseTerminationTypeFromExcel = (v: unknown): 'Normal' | 'Early' | undefined => {
    const s = String(v ?? '').trim();
    if (!s) return undefined;
    const low = s.toLowerCase();
    if (low === 'early' || s.includes('提前') || s.includes('违约')) return 'Early';
    if (low === 'normal' || s.includes('正常')) return 'Normal';
    return 'Normal';
};

const inferPaymentCycle = (text: unknown): Tenant['paymentCycle'] => {
    const s = String(text ?? '').trim();
    if (!s) return 'Quarterly';
    if (s === 'HalfMonthly' || s.includes('半月')) return 'HalfMonthly';
    if (s === 'BiMonthly' || s.includes('两月')) return 'BiMonthly';
    if (s === 'Monthly' || s.includes('月付') || (s.includes('月') && !s.includes('季'))) return 'Monthly';
    if (s === 'SemiAnnual' || s.includes('半年')) return 'SemiAnnual';
    if (s === 'Annual' || s.includes('年')) return 'Annual';
    if (s === 'Quarterly' || s.includes('季')) return 'Quarterly';
    if (s === 'Custom' || s.includes('自定义')) return 'Custom';
    return 'Quarterly';
};

/**
 * 楼宇资管 Excel 同行可选合同列：写入/更新 tenants，供应收与报表使用。
 * 返回 null 表示本行未尝试同步合同（未填企业名称）。
 */
export function syncTenantFromBuildingImportRow(
    row: Record<string, unknown>,
    buildingId: string,
    unitId: string,
    tenants: Tenant[],
    rowSeed: number
): { nextTenants: Tenant[]; error?: string; setUnitVacant: boolean } {
    const company = String(
        row['合同企业名称'] ?? row['客户名称'] ?? row['企业名称'] ?? row['tenantName'] ?? ''
    ).trim();
    if (!company) {
        return { nextTenants: tenants, setUnitVacant: false };
    }

    const leaseStart = hasCellValue(row['起租日期'] ?? row['起租日'] ?? row.leaseStart)
        ? normalizeExcelDate(row['起租日期'] ?? row['起租日'] ?? row.leaseStart)
        : '';
    const leaseEnd = hasCellValue(row['结束日期'] ?? row['到期日期'] ?? row.leaseEnd)
        ? normalizeExcelDate(row['结束日期'] ?? row['到期日期'] ?? row.leaseEnd)
        : '';
    if (!leaseStart || !leaseEnd) {
        return {
            nextTenants: tenants,
            error: '填写了合同企业名称时，必须同时填写起租日期与结束日期',
            setUnitVacant: false,
        };
    }

    const terminationDate = hasCellValue(row['退租日期'] ?? row.terminationDate)
        ? normalizeExcelDate(row['退租日期'] ?? row.terminationDate)
        : '';
    const statusFromRow = hasCellValue(row['合同状态'] ?? row.status)
        ? parseContractStatusFromExcel(row['合同状态'] ?? row.status)
        : undefined;
    const importingTerminated =
        statusFromRow === ContractStatus.Terminated || !!terminationDate;

    if (importingTerminated && !terminationDate) {
        return {
            nextTenants: tenants,
            error: '已退租合同必须填写退租日期（或合同状态为 Terminated/已退租）',
            setUnitVacant: false,
        };
    }

    const signingDate = hasCellValue(row['签约日期'] ?? row.signingDate)
        ? normalizeExcelDate(row['签约日期'] ?? row.signingDate)
        : leaseStart;

    const monthlyRent = parseExcelNumber(row['月租金'] ?? row.monthlyRent);
    const unitPrice = parseExcelNumber(row['日单价'] ?? row.unitPrice);
    const totalArea = parseExcelNumber(row['合同面积'] ?? row['面积'] ?? row.totalArea);
    const deposit = parseExcelNumber(row['押金'] ?? row.depositAmount);

    const paymentCycleRaw = row['支付频率'] ?? row.paymentCycle;
    const paymentCycle = hasCellValue(paymentCycleRaw)
        ? inferPaymentCycle(paymentCycleRaw)
        : undefined;

    const next = tenants.map((t) => ({ ...t }));
    const matchIdx = next.findIndex(
        (t) =>
            t.name === company &&
            t.buildingId === buildingId &&
            t.unitIds.includes(unitId) &&
            String(t.leaseStart || '') === leaseStart
    );

    const statusResolved =
        statusFromRow ||
        (importingTerminated ? ContractStatus.Terminated : ContractStatus.Active);

    const patch: Partial<Tenant> = {
        name: company,
        buildingId,
        unitIds: [unitId],
        leaseStart,
        leaseEnd,
        signingDate,
        status: statusResolved,
        rentFreePeriods: [],
        depositStatus: DepositStatus.Unpaid,
        isRisk: false,
        keyMoments: [],
    };
    if (paymentCycle) {
        patch.paymentCycle = paymentCycle;
    }

    if (typeof monthlyRent === 'number' && monthlyRent > 0) {
        patch.monthlyRent = Math.round(monthlyRent * 100) / 100;
    } else if (typeof unitPrice === 'number' && unitPrice > 0 && typeof totalArea === 'number' && totalArea > 0) {
        patch.monthlyRent = Math.round(unitPrice * (365 / 12) * totalArea * 100) / 100;
        patch.unitPrice = Number(unitPrice.toFixed(2));
        patch.totalArea = Number(totalArea.toFixed(2));
    } else if (typeof totalArea === 'number' && totalArea > 0) {
        patch.totalArea = Number(totalArea.toFixed(2));
    }

    if (typeof unitPrice === 'number' && unitPrice > 0) patch.unitPrice = Number(unitPrice.toFixed(2));
    if (typeof totalArea === 'number' && totalArea > 0) patch.totalArea = Number(totalArea.toFixed(2));
    if (typeof deposit === 'number' && deposit >= 0) patch.depositAmount = Math.round(deposit);

    if (hasCellValue(row['首次收款日期'] ?? row.firstPaymentDate)) {
        patch.firstPaymentDate = normalizeExcelDate(row['首次收款日期'] ?? row.firstPaymentDate) || undefined;
    } else {
        patch.firstPaymentDate = signingDate;
    }
    patch.firstPaymentMonths = 3;

    if (terminationDate) {
        patch.terminationDate = terminationDate;
        patch.status = ContractStatus.Terminated;
    }
    if (hasCellValue(row['退租类型'] ?? row.terminationType)) {
        patch.terminationType = parseTerminationTypeFromExcel(row['退租类型'] ?? row.terminationType);
    } else if (terminationDate) {
        patch.terminationType = 'Normal';
    }
    if (hasCellValue(row['退租原因'] ?? row.terminationReason)) {
        patch.terminationReason = String(row['退租原因'] ?? row.terminationReason).trim();
    }

    if (matchIdx < 0) {
        const mr = patch.monthlyRent ?? 0;
        if (
            mr <= 0 &&
            !(typeof patch.unitPrice === 'number' && patch.unitPrice > 0 && typeof patch.totalArea === 'number' && patch.totalArea > 0)
        ) {
            return {
                nextTenants: tenants,
                error: '新建合同须填写月租金（>0），或同时填写日单价与合同面积',
                setUnitVacant: false,
            };
        }
    }

    if (matchIdx >= 0) {
        const prev = next[matchIdx];
        next[matchIdx] = {
            ...prev,
            ...patch,
            id: prev.id,
            unitIds: patch.unitIds?.length ? patch.unitIds : prev.unitIds,
            monthlyRent: patch.monthlyRent ?? prev.monthlyRent,
            totalArea: patch.totalArea ?? prev.totalArea,
            rentFreePeriods: prev.rentFreePeriods?.length ? prev.rentFreePeriods : patch.rentFreePeriods || [],
        };
    } else {
        const id = `t${Date.now()}_${rowSeed}`;
        next.push({
            id,
            name: company,
            buildingId,
            unitIds: [unitId],
            totalArea: patch.totalArea ?? 0,
            signingDate: patch.signingDate || leaseStart,
            leaseStart,
            leaseEnd,
            unitPrice: patch.unitPrice,
            monthlyRent: patch.monthlyRent ?? 0,
            rentFreePeriods: patch.rentFreePeriods || [],
            paymentCycle: patch.paymentCycle || 'Quarterly',
            firstPaymentDate: patch.firstPaymentDate || leaseStart,
            firstPaymentMonths: 3,
            depositAmount: patch.depositAmount ?? 0,
            depositStatus: DepositStatus.Unpaid,
            status: patch.status || ContractStatus.Active,
            terminationDate: patch.terminationDate,
            terminationType: patch.terminationType,
            terminationReason: patch.terminationReason || '',
            keyMoments: [],
        });
    }

    return {
        nextTenants: next,
        setUnitVacant: statusResolved === ContractStatus.Terminated,
    };
}

export const buildingImportReadmeRows = (): { 章节: string; 说明: string }[] => [
    { 章节: '一、楼宇单元（必填）', 说明: '资产名称、单元名称、楼层、面积；状态支持 待租/已租/预留 等；是否自用填 是/否。' },
    { 章节: '', 说明: '' },
    { 章节: '二、可选：同行绑定合同', 说明: '若填写「合同企业名称」（或客户名称），本行在写入单元后会同步创建或更新一条客户合同，房间即本行的资产+单元。' },
    { 章节: '', 说明: '必填：起租日期、结束日期。在租还需签约日期（可留空已退租时，签约日默认=起租日）。月租金或（日单价+面积）至少填一种。' },
    { 章节: '', 说明: '' },
    { 章节: '三、已退租 / 历史合同', 说明: '合同状态填 Terminated 或 已退租，或仅填写「退租日期」亦可自动视为已退租。须填写退租日期。退租类型：Normal/正常、Early/提前。' },
    { 章节: '', 说明: '导入已退租后：合同进入「客户合同 → 历史退租」列表；本行单元状态将自动置为「待租」（便于房态与在租统计）。' },
    { 章节: '', 说明: '' },
    { 章节: '四、应收与预算/报表', 说明: '系统按起止租期、月租金、免租策略生成各月应收；在工作台应收、预算执行等视图中体现。已退租客户仅在对应账单月仍有应收时出现在应收明细。' },
    { 章节: '', 说明: '' },
    { 章节: '五、完整合同字段', 说明: '免租多段、分段租金、提前退租结算等请使用「客户合同」页下载模板批量导入，或与财务在系统中补录。' },
];
