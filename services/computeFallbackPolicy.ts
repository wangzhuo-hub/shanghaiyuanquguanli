type RuntimeComputeFallbackEnv = {
    MODE?: string;
    DEV?: boolean;
    PROD?: boolean;
    VITE_ENABLE_LOCAL_HEAVY_COMPUTE_FALLBACK?: string;
};

export type LocalHeavyComputeFallbackSetting = {
    mode?: string;
    dev?: boolean;
    prod?: boolean;
    flag?: string | boolean | null;
};

export type LocalHeavyComputeFallbackOption = {
    localFallbackEnabled?: boolean;
};

const truthyFlags = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled', 'enable', 'always']);
const falsyFlags = new Set(['0', 'false', 'no', 'n', 'off', 'disabled', 'disable', 'never']);

const normalizeFallbackFlag = (flag: string | boolean | null | undefined): boolean | null => {
    if (typeof flag === 'boolean') return flag;
    const normalized = String(flag ?? '').trim().toLowerCase();
    if (!normalized || normalized === 'auto') return null;
    if (truthyFlags.has(normalized)) return true;
    if (falsyFlags.has(normalized)) return false;
    return null;
};

const runtimeEnv = (): RuntimeComputeFallbackEnv => {
    try {
        return (import.meta as ImportMeta & { env?: RuntimeComputeFallbackEnv }).env || {};
    } catch {
        return {};
    }
};

export function resolveLocalHeavyComputeFallbackEnabled(
    setting: LocalHeavyComputeFallbackSetting = {},
): boolean {
    const explicit = normalizeFallbackFlag(setting.flag);
    if (explicit !== null) return explicit;
    if (setting.prod === true) return false;
    if (setting.dev === true) return true;
    return String(setting.mode || 'development').trim().toLowerCase() !== 'production';
}

export function isLocalHeavyComputeFallbackEnabled(): boolean {
    const env = runtimeEnv();
    return resolveLocalHeavyComputeFallbackEnabled({
        mode: env.MODE,
        dev: env.DEV,
        prod: env.PROD,
        flag: env.VITE_ENABLE_LOCAL_HEAVY_COMPUTE_FALLBACK,
    });
}

export function shouldAllowLocalHeavyComputeFallback(
    options: LocalHeavyComputeFallbackOption = {},
): boolean {
    return options.localFallbackEnabled ?? isLocalHeavyComputeFallbackEnabled();
}

export function isServerComputeEnabled(options: {
    cloudConnected: boolean;
    authEnabled: boolean;
    authToken?: string | null;
    projectId: string | undefined | null;
}): boolean {
    if (!options.cloudConnected || !options.authEnabled || !options.projectId) return false;
    return options.authToken === undefined ? true : !!options.authToken;
}

export function shouldRunLocalDashboardMetricsFallback(options: {
    canUseServer: boolean;
    serverAttempted: boolean;
} & LocalHeavyComputeFallbackOption): boolean {
    if (!shouldAllowLocalHeavyComputeFallback(options)) return false;
    if (!options.canUseServer) return true;
    return !options.serverAttempted;
}

export function shouldRunLocalDashboardMetricsForCloudLoad(options: {
    cloudConnected: boolean;
    authEnabled: boolean;
    projectId: string | undefined | null;
    serverAttempted: boolean;
} & LocalHeavyComputeFallbackOption): boolean {
    return shouldRunLocalDashboardMetricsFallback({
        canUseServer: isServerComputeEnabled(options),
        serverAttempted: options.serverAttempted,
        localFallbackEnabled: options.localFallbackEnabled,
    });
}

export function shouldRunLocalBillingFallback(options: {
    canUseServer: boolean;
    serverAttempted: boolean;
} & LocalHeavyComputeFallbackOption): boolean {
    if (!shouldAllowLocalHeavyComputeFallback(options)) return false;
    if (!options.canUseServer) return true;
    return !options.serverAttempted;
}

export function shouldRunLocalBigScreenFallback(options: {
    canUseServer: boolean;
    serverAttempted: boolean;
} & LocalHeavyComputeFallbackOption): boolean {
    if (!shouldAllowLocalHeavyComputeFallback(options)) return false;
    if (!options.canUseServer) return true;
    return !options.serverAttempted;
}

export function shouldRunLocalBudgetedBillPreviewFallback(options: {
    canUseServer: boolean;
    serverAttempted: boolean;
} & LocalHeavyComputeFallbackOption): boolean {
    if (!shouldAllowLocalHeavyComputeFallback(options)) return false;
    if (!options.canUseServer) return true;
    return !options.serverAttempted;
}

export function shouldRunLocalSourceAgentMetricsFallback(options: {
    canUseServer: boolean;
    serverAttempted: boolean;
} & LocalHeavyComputeFallbackOption): boolean {
    if (!shouldAllowLocalHeavyComputeFallback(options)) return false;
    if (!options.canUseServer) return true;
    return !options.serverAttempted;
}

export function shouldRunLocalContractAnalysisMetricsFallback(options: {
    canUseServer: boolean;
    serverAttempted: boolean;
} & LocalHeavyComputeFallbackOption): boolean {
    if (!shouldAllowLocalHeavyComputeFallback(options)) return false;
    if (!options.canUseServer) return true;
    return !options.serverAttempted;
}
