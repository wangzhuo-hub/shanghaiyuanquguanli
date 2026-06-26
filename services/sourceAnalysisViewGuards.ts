export function shouldBuildSourceTenantLookup(options: {
    expandedSource: string | null;
}): boolean {
    return !!options.expandedSource;
}
