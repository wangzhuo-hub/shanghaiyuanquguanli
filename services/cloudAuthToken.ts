let runtimeCloudAuthToken = '';

const readPocketBaseAuthTokenFromStorage = (): string => {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    try {
        const raw = window.localStorage.getItem('pocketbase_auth');
        if (!raw) return '';
        const parsed = JSON.parse(raw) as { token?: unknown };
        return String(parsed?.token || '').trim();
    } catch {
        return '';
    }
};

export const setCurrentCloudAuthToken = (token: string | null | undefined): void => {
    runtimeCloudAuthToken = String(token || '').trim();
};

export const clearCurrentCloudAuthToken = (): void => {
    runtimeCloudAuthToken = '';
};

export const getCurrentCloudAuthToken = (): string => {
    return runtimeCloudAuthToken || readPocketBaseAuthTokenFromStorage();
};
