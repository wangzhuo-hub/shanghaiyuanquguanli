export const toFixedNumber = (value: number | null | undefined, digits = 2): number => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    const base = 10 ** digits;
    return Math.round(n * base) / base;
};

/** 金额统一两位小数（与全局应收/收款口径一致） */
export const roundMoney2 = (value: number | null | undefined): number => toFixedNumber(value, 2);

export const formatNumber = (value: number | null | undefined, digits = 2): string =>
    toFixedNumber(value, digits).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });

export const formatCurrency = (value: number | null | undefined, digits = 2): string =>
    `¥${formatNumber(value, digits)}`;

export const formatWan = (value: number | null | undefined, digits = 2): string =>
    `${formatNumber((value || 0) / 10000, digits)}万`;

export const formatPercent = (value: number | null | undefined, digits = 2): string =>
    `${formatNumber(value, digits)}%`;

export const formatArea = (value: number | null | undefined, digits = 2): string =>
    `${formatNumber(value, digits)}㎡`;
