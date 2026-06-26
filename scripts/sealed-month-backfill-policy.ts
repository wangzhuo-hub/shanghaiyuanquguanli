export type ExistingSealedMonthState = {
    id: string;
    detailsJson?: unknown;
};

export type SealedMonthBackfillAction =
    | 'create'
    | 'update_for_force'
    | 'update_for_missing_details'
    | 'skip_existing'
    | 'skip_missing_row';

export function hasUsableSealedMonthDetails(existing: ExistingSealedMonthState | null): boolean {
    return Array.isArray(existing?.detailsJson);
}

export function decideSealedMonthBackfillAction(
    existing: ExistingSealedMonthState | null,
    options: { force?: boolean; missingDetailsOnly?: boolean } = {},
): SealedMonthBackfillAction {
    if (existing) {
        if (options.force) return 'update_for_force';
        if (hasUsableSealedMonthDetails(existing)) return 'skip_existing';
        return 'update_for_missing_details';
    }
    return options.missingDetailsOnly ? 'skip_missing_row' : 'create';
}
