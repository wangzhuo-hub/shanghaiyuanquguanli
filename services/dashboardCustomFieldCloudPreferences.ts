import {
    getIntegrationAppDashboardCustomFieldsPreferenceUrl,
} from '../config/urls';
import { getCurrentCloudAuthToken } from './cloudAuthToken';
import {
    normalizeDashboardCustomFieldIds,
    type DashboardCustomFieldId,
} from './dashboardCustomFields';

export type CloudDashboardCustomFieldPreferenceResult = {
    success: boolean;
    found?: boolean;
    fieldIds?: DashboardCustomFieldId[];
    updatedAt?: string;
    message: string;
};

const preferenceAuthHeaders = (): { headers?: Record<string, string>; error?: string } => {
    const token = getCurrentCloudAuthToken();
    if (!token) return { error: '当前用户 token 不可用' };
    return {
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
    };
};

const parsePreferenceResponse = async (
    res: Response,
    failurePrefix: string,
): Promise<CloudDashboardCustomFieldPreferenceResult> => {
    const body = await res.json().catch(() => null) as {
        success?: boolean;
        data?: {
            ok?: boolean;
            found?: boolean;
            fieldIds?: unknown;
            field_ids?: unknown;
            updatedAt?: string;
            updated_at?: string;
            message?: string;
        };
        error?: { message?: string };
    } | null;
    const payload = body?.data;
    if (!res.ok || body?.success === false || payload?.ok === false) {
        return {
            success: false,
            message: payload?.message || body?.error?.message || `${failurePrefix} HTTP ${res.status}`,
        };
    }
    const rawFieldIds = payload?.fieldIds ?? payload?.field_ids;
    return {
        success: true,
        found: payload?.found === true,
        fieldIds: Array.isArray(rawFieldIds) ? normalizeDashboardCustomFieldIds(rawFieldIds) : undefined,
        updatedAt: payload?.updatedAt || payload?.updated_at,
        message: payload?.message || '关注字段偏好已同步',
    };
};

export const fetchCloudDashboardCustomFieldIds = async (): Promise<CloudDashboardCustomFieldPreferenceResult> => {
    const auth = preferenceAuthHeaders();
    if (auth.error) return { success: false, message: auth.error };

    return fetch(getIntegrationAppDashboardCustomFieldsPreferenceUrl(), {
        method: 'GET',
        headers: auth.headers,
    })
        .then((res) => parsePreferenceResponse(res, '读取关注字段偏好失败'))
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '读取关注字段偏好请求失败',
        }));
};

export const writeCloudDashboardCustomFieldIds = async (
    fieldIds: DashboardCustomFieldId[],
): Promise<CloudDashboardCustomFieldPreferenceResult> => {
    const auth = preferenceAuthHeaders();
    if (auth.error) return { success: false, message: auth.error };
    const normalized = normalizeDashboardCustomFieldIds(fieldIds);

    return fetch(getIntegrationAppDashboardCustomFieldsPreferenceUrl(), {
        method: 'PUT',
        headers: auth.headers,
        body: JSON.stringify({ field_ids: normalized }),
    })
        .then((res) => parsePreferenceResponse(res, '保存关注字段偏好失败'))
        .catch((e: unknown) => ({
            success: false,
            message: e instanceof Error ? e.message : '保存关注字段偏好请求失败',
        }));
};
