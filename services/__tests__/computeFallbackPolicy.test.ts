import { describe, expect, it } from 'vitest';
import {
    isServerComputeEnabled,
    resolveLocalHeavyComputeFallbackEnabled,
    shouldRunLocalBudgetedBillPreviewFallback,
    shouldRunLocalBillingFallback,
    shouldRunLocalBigScreenFallback,
    shouldRunLocalContractAnalysisMetricsFallback,
    shouldRunLocalDashboardMetricsForCloudLoad,
    shouldRunLocalDashboardMetricsFallback,
    shouldRunLocalSourceAgentMetricsFallback,
} from '../computeFallbackPolicy';

describe('computeFallbackPolicy', () => {
    it('disables heavy local compute fallback by default in production mode', () => {
        expect(resolveLocalHeavyComputeFallbackEnabled({ mode: 'production' })).toBe(false);
        expect(resolveLocalHeavyComputeFallbackEnabled({ prod: true })).toBe(false);
        expect(resolveLocalHeavyComputeFallbackEnabled({ mode: 'development' })).toBe(true);
        expect(resolveLocalHeavyComputeFallbackEnabled({ mode: 'test' })).toBe(true);
    });

    it('lets explicit local compute fallback flags override mode defaults', () => {
        expect(resolveLocalHeavyComputeFallbackEnabled({
            mode: 'production',
            flag: 'true',
        })).toBe(true);
        expect(resolveLocalHeavyComputeFallbackEnabled({
            mode: 'development',
            flag: '0',
        })).toBe(false);
        expect(resolveLocalHeavyComputeFallbackEnabled({
            mode: 'production',
            flag: 'auto',
        })).toBe(false);
    });

    it('requires connectivity, auth, and project before enabling server compute', () => {
        expect(isServerComputeEnabled({
            cloudConnected: true,
            authEnabled: true,
            projectId: 'shanghai_park',
        })).toBe(true);

        expect(isServerComputeEnabled({
            cloudConnected: false,
            authEnabled: true,
            projectId: 'shanghai_park',
        })).toBe(false);

        expect(isServerComputeEnabled({
            cloudConnected: true,
            authEnabled: false,
            projectId: 'shanghai_park',
        })).toBe(false);

        expect(isServerComputeEnabled({
            cloudConnected: true,
            authEnabled: true,
            projectId: '',
        })).toBe(false);

        expect(isServerComputeEnabled({
            cloudConnected: true,
            authEnabled: true,
            authToken: '',
            projectId: 'shanghai_park',
        })).toBe(false);

        expect(isServerComputeEnabled({
            cloudConnected: true,
            authEnabled: true,
            authToken: 'auth-token',
            projectId: 'shanghai_park',
        })).toBe(true);
    });

    it('does not run local dashboard metrics fallback after a server compute attempt', () => {
        expect(shouldRunLocalDashboardMetricsFallback({
            canUseServer: true,
            serverAttempted: true,
        })).toBe(false);
    });

    it('allows local dashboard metrics compute when server compute is unavailable or not attempted', () => {
        expect(shouldRunLocalDashboardMetricsFallback({
            canUseServer: false,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalDashboardMetricsFallback({
            canUseServer: true,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalDashboardMetricsFallback({
            canUseServer: false,
            serverAttempted: false,
            localFallbackEnabled: false,
        })).toBe(false);
    });

    it('uses the same dashboard fallback policy for cloud load paths', () => {
        expect(shouldRunLocalDashboardMetricsForCloudLoad({
            cloudConnected: true,
            authEnabled: true,
            projectId: 'shanghai_park',
            serverAttempted: true,
        })).toBe(false);

        expect(shouldRunLocalDashboardMetricsForCloudLoad({
            cloudConnected: false,
            authEnabled: true,
            projectId: 'shanghai_park',
            serverAttempted: true,
        })).toBe(true);

        expect(shouldRunLocalDashboardMetricsForCloudLoad({
            cloudConnected: true,
            authEnabled: false,
            projectId: 'shanghai_park',
            serverAttempted: true,
        })).toBe(true);

        expect(shouldRunLocalDashboardMetricsForCloudLoad({
            cloudConnected: false,
            authEnabled: true,
            projectId: 'shanghai_park',
            serverAttempted: true,
            localFallbackEnabled: false,
        })).toBe(false);
    });

    it('uses target project connectivity for project switch fallback decisions', () => {
        const previousProjectConnected = false;
        const targetProjectConnected = true;

        expect(shouldRunLocalDashboardMetricsForCloudLoad({
            cloudConnected: targetProjectConnected,
            authEnabled: true,
            projectId: 'beijing_park',
            serverAttempted: true,
        })).toBe(false);

        expect(shouldRunLocalDashboardMetricsForCloudLoad({
            cloudConnected: previousProjectConnected,
            authEnabled: true,
            projectId: 'beijing_park',
            serverAttempted: true,
        })).toBe(true);
    });

    it('does not run local billing fallback after a server compute attempt', () => {
        expect(shouldRunLocalBillingFallback({
            canUseServer: true,
            serverAttempted: true,
        })).toBe(false);
    });

    it('allows local billing compute when server compute is unavailable or not attempted', () => {
        expect(shouldRunLocalBillingFallback({
            canUseServer: false,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalBillingFallback({
            canUseServer: true,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalBillingFallback({
            canUseServer: false,
            serverAttempted: false,
            localFallbackEnabled: false,
        })).toBe(false);
    });

    it('does not run local big screen fallback after a server compute attempt', () => {
        expect(shouldRunLocalBigScreenFallback({
            canUseServer: true,
            serverAttempted: true,
        })).toBe(false);
    });

    it('allows local big screen compute when server compute is unavailable or not attempted', () => {
        expect(shouldRunLocalBigScreenFallback({
            canUseServer: false,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalBigScreenFallback({
            canUseServer: true,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalBigScreenFallback({
            canUseServer: false,
            serverAttempted: false,
            localFallbackEnabled: false,
        })).toBe(false);
    });

    it('does not run local budgeted bill preview fallback after a server compute attempt', () => {
        expect(shouldRunLocalBudgetedBillPreviewFallback({
            canUseServer: true,
            serverAttempted: true,
        })).toBe(false);
    });

    it('allows local budgeted bill preview compute when server compute is unavailable or not attempted', () => {
        expect(shouldRunLocalBudgetedBillPreviewFallback({
            canUseServer: false,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalBudgetedBillPreviewFallback({
            canUseServer: true,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalBudgetedBillPreviewFallback({
            canUseServer: false,
            serverAttempted: false,
            localFallbackEnabled: false,
        })).toBe(false);
    });

    it('does not run local source agent metrics fallback after a server compute attempt', () => {
        expect(shouldRunLocalSourceAgentMetricsFallback({
            canUseServer: true,
            serverAttempted: true,
        })).toBe(false);
    });

    it('allows local source agent metrics compute when server compute is unavailable or not attempted', () => {
        expect(shouldRunLocalSourceAgentMetricsFallback({
            canUseServer: false,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalSourceAgentMetricsFallback({
            canUseServer: true,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalSourceAgentMetricsFallback({
            canUseServer: false,
            serverAttempted: false,
            localFallbackEnabled: false,
        })).toBe(false);
    });

    it('does not run local contract analysis metrics fallback after a server compute attempt', () => {
        expect(shouldRunLocalContractAnalysisMetricsFallback({
            canUseServer: true,
            serverAttempted: true,
        })).toBe(false);
    });

    it('allows local contract analysis metrics compute when server compute is unavailable or not attempted', () => {
        expect(shouldRunLocalContractAnalysisMetricsFallback({
            canUseServer: false,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalContractAnalysisMetricsFallback({
            canUseServer: true,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalContractAnalysisMetricsFallback({
            canUseServer: false,
            serverAttempted: false,
            localFallbackEnabled: false,
        })).toBe(false);
    });
});
