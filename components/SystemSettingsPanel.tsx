import React, { useState } from 'react';
import {
    AlertCircle,
    CheckCircle2,
    CloudCog,
    Database,
    Download,
    FileClock,
    History,
    Loader2,
    Pencil,
    RefreshCw,
    RotateCcw,
    Sparkles,
    Trash2,
    Users,
    X,
} from 'lucide-react';
import type { AIConfig, CloudBackupMetadata, CloudConfig, ParkInfo, UserRole } from '../types';
import type { ManagedUserAccount, SignupRequestRecord } from '../services/cloudService';
import { userRoleLabel } from '../services/receivablePermissions';

export type NewManagedUserForm = {
    email: string;
    name: string;
    password: string;
    projectId: string;
    role: 'park_user' | 'park_admin' | 'group_admin' | 'property_staff';
    enabled: boolean;
};

type UserManageForm = {
    name: string;
    role: UserRole;
    projectId: string;
    allowedParkIds: string[];
    enabled: boolean;
    password: string;
};

type ApprovedSignupByPark = {
    parkOrder: string[];
    byPark: Map<string, SignupRequestRecord[]>;
};

type SettingsUserTab = 'add' | 'pending' | 'accounts' | 'signup';

export type SystemSettingsPanelProps = {
    isCloudConnected: boolean;
    cloudConfig: CloudConfig;
    onCloudConfigChange: (next: CloudConfig) => void;
    onPersistCloudConfig: (next: CloudConfig) => void;
    pocketbaseUrl: string;
    currentParkName: string;
    authorizedParks: ParkInfo[];
    isPlatformAdmin: boolean;
    canManageUsers: boolean;
    cloudConnectionMsg: { type: 'success' | 'error'; text: string } | null;
    newUserForm: NewManagedUserForm;
    onNewUserFormChange: (patch: Partial<NewManagedUserForm>) => void;
    onCreateManagedUser: (e: React.FormEvent) => void;
    isCreatingUser: boolean;
    onRefreshUsers: () => void;
    managedUsers: ManagedUserAccount[];
    managedUsersError: string | null;
    isLoadingManagedUsers: boolean;
    onApproveManagedUser: (user: ManagedUserAccount, enabled: boolean) => void;
    onOpenUserManage: (user: ManagedUserAccount) => void;
    onDeleteManagedUser: (user: ManagedUserAccount) => void;
    signupRequests: SignupRequestRecord[];
    signupRequestsError: string | null;
    isLoadingSignupRequests: boolean;
    onApproveSignupRequest: (req: SignupRequestRecord) => void;
    onDeleteSignupRequest: (req: SignupRequestRecord) => void;
    approvedSignupByPark: ApprovedSignupByPark;
    userManageTarget: ManagedUserAccount | null;
    userManageForm: UserManageForm;
    onUserManageFormChange: (patch: Partial<UserManageForm>) => void;
    onCloseUserManage: () => void;
    onSaveUserManage: () => void;
    onDeleteUserManage: () => void;
    userManageSaving: boolean;
    aiConfig: AIConfig;
    onAiConfigChange: (next: AIConfig) => void;
    onSaveAiConfig: () => void;
    cloudHistory: CloudBackupMetadata[];
    isLoadingHistory: boolean;
    onRefreshHistory: () => void;
    onOpenSnapshot: () => void;
    onRestoreBackup: (id: string) => void;
    onDownloadBackup: (id: string, note?: string) => void;
    restoringId: string | null;
    onExport: () => void;
    onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onResetData: () => void;
};

const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100';
const labelClass = 'mb-1 block text-xs font-medium text-slate-500';

function SectionCard({
    title,
    icon,
    description,
    action,
    children,
}: {
    title: string;
    icon: React.ReactNode;
    description?: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        {icon}
                        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
                    </div>
                    {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
                </div>
                {action}
            </div>
            <div className="px-5 py-4">{children}</div>
        </section>
    );
}

function StatusPill({ connected }: { connected: boolean }) {
    return connected ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <CheckCircle2 size={12} /> 已连接
        </span>
    ) : (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
            <AlertCircle size={12} /> 未连接
        </span>
    );
}

function UserTabButton({
    active,
    onClick,
    children,
    count,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    count?: number;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
        >
            {children}
            {count != null && count > 0 ? (
                <span
                    className={`ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full px-1 text-[10px] ${
                        active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                    }`}
                >
                    {count}
                </span>
            ) : null}
        </button>
    );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
    return <div className="py-8 text-center text-sm text-slate-500">{children}</div>;
}

export const SystemSettingsPanel: React.FC<SystemSettingsPanelProps> = (props) => {
    const {
        isCloudConnected,
        cloudConfig,
        onCloudConfigChange,
        onPersistCloudConfig,
        pocketbaseUrl,
        currentParkName,
        authorizedParks,
        isPlatformAdmin,
        canManageUsers,
        cloudConnectionMsg,
        newUserForm,
        onNewUserFormChange,
        onCreateManagedUser,
        isCreatingUser,
        onRefreshUsers,
        managedUsers,
        managedUsersError,
        isLoadingManagedUsers,
        onApproveManagedUser,
        onOpenUserManage,
        onDeleteManagedUser,
        signupRequests,
        signupRequestsError,
        isLoadingSignupRequests,
        onApproveSignupRequest,
        onDeleteSignupRequest,
        approvedSignupByPark,
        userManageTarget,
        userManageForm,
        onUserManageFormChange,
        onCloseUserManage,
        onSaveUserManage,
        onDeleteUserManage,
        userManageSaving,
        aiConfig,
        onAiConfigChange,
        onSaveAiConfig,
        cloudHistory,
        isLoadingHistory,
        onRefreshHistory,
        onOpenSnapshot,
        onRestoreBackup,
        onDownloadBackup,
        restoringId,
        onExport,
        onImport,
        onResetData,
    } = props;

    const [userTab, setUserTab] = useState<SettingsUserTab>('add');

    const pendingUsers = managedUsers.filter((u) => !u.enabled);
    const activeUsers = managedUsers.filter((u) => u.enabled);
    const pendingSignups = signupRequests.filter((r) => r.status === 'pending');
    const pendingTotal = pendingUsers.length + pendingSignups.length;

    const handleAutoSyncChange = (checked: boolean) => {
        const next = { ...cloudConfig, autoSync: checked };
        onCloudConfigChange(next);
        onPersistCloudConfig(next);
    };

    return (
        <div className="mx-auto max-w-4xl space-y-5 pb-8 animate-in fade-in duration-300">
            <SectionCard
                title="连接与同步"
                icon={<CloudCog size={18} className="text-sky-600" />}
                description="后端地址由部署配置维护；园区请在顶栏切换。"
                action={<StatusPill connected={isCloudConnected} />}
            >
                <dl className="grid gap-4 sm:grid-cols-2 text-sm">
                    <div>
                        <dt className={labelClass}>后端地址</dt>
                        <dd className="font-mono text-slate-700 break-all">{pocketbaseUrl}</dd>
                    </div>
                    <div>
                        <dt className={labelClass}>当前园区</dt>
                        <dd className="text-slate-800">
                            {currentParkName}
                            <span className="ml-2 text-xs text-slate-400">（顶栏切换）</span>
                        </dd>
                    </div>
                </dl>
                <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                    <input
                        type="checkbox"
                        className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-200"
                        checked={!!cloudConfig.autoSync}
                        onChange={(e) => handleAutoSyncChange(e.target.checked)}
                    />
                    <span>编辑后自动同步到 PocketBase</span>
                </label>
                {cloudConnectionMsg ? (
                    <p
                        className={`mt-3 text-sm ${
                            cloudConnectionMsg.type === 'success' ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                    >
                        {cloudConnectionMsg.text}
                    </p>
                ) : null}
            </SectionCard>

            {canManageUsers ? (
                <SectionCard
                    title="登录人员"
                    icon={<Users size={18} className="text-sky-600" />}
                    description={isPlatformAdmin ? '新增账号、审批待办与权限维护。' : '仅平台管理员可维护登录人员。'}
                    action={
                        isPlatformAdmin ? (
                            <button
                                type="button"
                                onClick={onRefreshUsers}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            >
                                <RefreshCw size={14} /> 刷新
                            </button>
                        ) : null
                    }
                >
                    {!isPlatformAdmin ? (
                        <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            当前为园区/集团管理员，仅可查看连接设置，不可维护登录人员。
                        </div>
                    ) : (
                        <>
                            <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                                <UserTabButton active={userTab === 'add'} onClick={() => setUserTab('add')}>
                                    新增
                                </UserTabButton>
                                <UserTabButton
                                    active={userTab === 'pending'}
                                    onClick={() => setUserTab('pending')}
                                    count={pendingTotal}
                                >
                                    待办
                                </UserTabButton>
                                <UserTabButton active={userTab === 'accounts'} onClick={() => setUserTab('accounts')}>
                                    账号
                                </UserTabButton>
                                <UserTabButton
                                    active={userTab === 'signup'}
                                    onClick={() => setUserTab('signup')}
                                >
                                    注册记录
                                </UserTabButton>
                            </div>

                            {userTab === 'add' && (
                                <form
                                    onSubmit={onCreateManagedUser}
                                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                                >
                                    <div>
                                        <label className={labelClass}>登录邮箱</label>
                                        <input
                                            className={inputClass}
                                            placeholder="name@company.com"
                                            value={newUserForm.email}
                                            onChange={(e) => onNewUserFormChange({ email: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>姓名（可选）</label>
                                        <input
                                            className={inputClass}
                                            placeholder="张三"
                                            value={newUserForm.name}
                                            onChange={(e) => onNewUserFormChange({ name: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>初始密码</label>
                                        <input
                                            type="password"
                                            className={inputClass}
                                            value={newUserForm.password}
                                            onChange={(e) => onNewUserFormChange({ password: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>角色</label>
                                        <select
                                            className={inputClass}
                                            value={newUserForm.role}
                                            onChange={(e) =>
                                                onNewUserFormChange({
                                                    role: e.target.value as NewManagedUserForm['role'],
                                                })
                                            }
                                        >
                                            <option value="park_user">普通用户</option>
                                            <option value="property_staff">物业人员</option>
                                            <option value="park_admin">园区管理员</option>
                                            <option value="group_admin">集团管理员</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelClass}>默认园区</label>
                                        <select
                                            className={inputClass}
                                            value={newUserForm.projectId}
                                            onChange={(e) => onNewUserFormChange({ projectId: e.target.value })}
                                        >
                                            <option value="">选择园区</option>
                                            {authorizedParks.map((park) => (
                                                <option key={park.projectId} value={park.projectId}>
                                                    {park.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <label className="flex items-center gap-2 self-end text-sm text-slate-600 sm:pb-2">
                                        <input
                                            type="checkbox"
                                            checked={newUserForm.enabled}
                                            onChange={(e) => onNewUserFormChange({ enabled: e.target.checked })}
                                        />
                                        新增后直接启用
                                    </label>
                                    <div className="sm:col-span-2 flex justify-end">
                                        <button
                                            type="submit"
                                            disabled={isCreatingUser}
                                            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                                        >
                                            {isCreatingUser ? '提交中…' : '新增登录人员'}
                                        </button>
                                    </div>
                                </form>
                            )}

                            {userTab === 'pending' && (
                                <div className="space-y-4">
                                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                                        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
                                            待启用账号 · {pendingUsers.length}
                                        </div>
                                        {isLoadingManagedUsers ? (
                                            <EmptyRow>加载中…</EmptyRow>
                                        ) : managedUsersError ? (
                                            <EmptyRow>{managedUsersError}</EmptyRow>
                                        ) : pendingUsers.length === 0 ? (
                                            <EmptyRow>暂无</EmptyRow>
                                        ) : (
                                            pendingUsers.map((u) => (
                                                <div
                                                    key={u.id}
                                                    className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="truncate text-sm font-medium text-slate-800">
                                                            {u.email}
                                                        </div>
                                                        <div className="text-xs text-slate-500">
                                                            {u.name || '未填姓名'} · {userRoleLabel(u.role)}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => onApproveManagedUser(u, true)}
                                                        className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-700"
                                                    >
                                                        通过
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                                        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
                                            注册申请 · {pendingSignups.length}
                                        </div>
                                        {isLoadingSignupRequests ? (
                                            <EmptyRow>加载中…</EmptyRow>
                                        ) : signupRequestsError ? (
                                            <EmptyRow>{signupRequestsError}</EmptyRow>
                                        ) : pendingSignups.length === 0 ? (
                                            <EmptyRow>暂无</EmptyRow>
                                        ) : (
                                            pendingSignups.map((req) => (
                                                <div
                                                    key={req.id}
                                                    className="space-y-2 border-t border-slate-100 px-4 py-3 first:border-t-0"
                                                >
                                                    <div className="text-sm font-medium text-slate-800">
                                                        {req.applicantName || '（未填姓名）'}
                                                    </div>
                                                    <div className="text-xs text-slate-500">{req.email}</div>
                                                    <div className="flex justify-end">
                                                        <button
                                                            type="button"
                                                            onClick={() => onApproveSignupRequest(req)}
                                                            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-700"
                                                        >
                                                            审批通过
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}

                            {userTab === 'accounts' && (
                                <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
                                    {isLoadingManagedUsers ? (
                                        <EmptyRow>加载中…</EmptyRow>
                                    ) : activeUsers.length === 0 ? (
                                        <EmptyRow>暂无已启用账号</EmptyRow>
                                    ) : (
                                        activeUsers.map((u) => (
                                            <div
                                                key={u.id}
                                                className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 first:border-t-0"
                                            >
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-medium text-slate-800">
                                                        {u.email}
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        {u.name || '未填姓名'} · {userRoleLabel(u.role)} ·{' '}
                                                        {u.projectId || '—'}
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => onOpenUserManage(u)}
                                                        className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                                    >
                                                        <Pencil size={12} className="inline" /> 编辑
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => onDeleteManagedUser(u)}
                                                        className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                                                    >
                                                        删除
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {userTab === 'signup' && (
                                <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
                                    {isLoadingSignupRequests ? (
                                        <EmptyRow>加载中…</EmptyRow>
                                    ) : approvedSignupByPark.parkOrder.length === 0 ? (
                                        <EmptyRow>暂无线上注册审批记录</EmptyRow>
                                    ) : (
                                        approvedSignupByPark.parkOrder.map((projectId) => {
                                            const parkTitle =
                                                authorizedParks.find((p) => p.projectId === projectId)?.name ||
                                                projectId;
                                            const rows = approvedSignupByPark.byPark.get(projectId) || [];
                                            return (
                                                <div key={projectId}>
                                                    <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800 first:border-t-0">
                                                        {parkTitle}
                                                    </div>
                                                    {rows.map((req) => {
                                                        const linked = req.approvedUserId
                                                            ? managedUsers.find((x) => x.id === req.approvedUserId)
                                                            : managedUsers.find(
                                                                  (x) =>
                                                                      x.email.trim().toLowerCase() ===
                                                                      req.email.trim().toLowerCase()
                                                              );
                                                        return (
                                                            <div
                                                                key={`${req.id}-${projectId}`}
                                                                className="border-t border-slate-100 px-4 py-2.5 text-sm"
                                                            >
                                                                <div className="font-medium text-slate-800">
                                                                    {req.applicantName || '（未填姓名）'}
                                                                </div>
                                                                <div className="text-xs text-slate-500">{req.email}</div>
                                                                <div className="mt-2 flex flex-wrap justify-end gap-1">
                                                                    {linked && (
                                                                        <>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => onOpenUserManage(linked)}
                                                                                className="rounded border border-slate-200 px-2 py-0.5 text-[11px] hover:bg-slate-50"
                                                                            >
                                                                                编辑
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => onDeleteManagedUser(linked)}
                                                                                className="rounded border border-rose-200 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50"
                                                                            >
                                                                                删除账号
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onDeleteSignupRequest(req)}
                                                                        className="rounded border border-amber-200 px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-50"
                                                                    >
                                                                        清理记录
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </SectionCard>
            ) : null}

            <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 marker:content-none">
                    <div className="flex items-center gap-2">
                        <Sparkles size={18} className="text-violet-600" />
                        <span className="text-base font-semibold text-slate-800">AI 助手</span>
                        {aiConfig.enabled ? (
                            <span className="text-xs text-emerald-600">已启用</span>
                        ) : (
                            <span className="text-xs text-slate-400">未启用</span>
                        )}
                    </div>
                    <span className="text-xs text-slate-400 group-open:hidden">展开配置</span>
                </summary>
                <div className="space-y-4 border-t border-slate-100 px-5 py-4">
                    <div>
                        <label className={labelClass}>提供商</label>
                        <select
                            className={inputClass}
                            value={aiConfig.provider}
                            onChange={(e) =>
                                onAiConfigChange({
                                    ...aiConfig,
                                    provider: e.target.value as AIConfig['provider'],
                                })
                            }
                        >
                            <option value="none">不使用</option>
                            <option value="qwen">千问 (Qwen)</option>
                            <option value="openai">OpenAI 兼容</option>
                        </select>
                    </div>
                    {aiConfig.provider === 'qwen' && (
                        <>
                            <div>
                                <label className={labelClass}>API Key</label>
                                <input
                                    type="password"
                                    className={inputClass}
                                    placeholder="sk-…"
                                    value={aiConfig.qwenApiKey || ''}
                                    onChange={(e) => onAiConfigChange({ ...aiConfig, qwenApiKey: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>Base URL</label>
                                <select
                                    className={inputClass}
                                    value={aiConfig.qwenBaseUrl || ''}
                                    onChange={(e) => onAiConfigChange({ ...aiConfig, qwenBaseUrl: e.target.value })}
                                >
                                    <option value="https://coding.dashscope.aliyuncs.com/v1">
                                        OpenAI 兼容
                                    </option>
                                    <option value="https://coding.dashscope.aliyuncs.com/apps/anthropic">
                                        Anthropic 兼容
                                    </option>
                                </select>
                            </div>
                        </>
                    )}
                    {aiConfig.provider === 'openai' && (
                        <>
                            <div>
                                <label className={labelClass}>API Key</label>
                                <input
                                    type="password"
                                    className={inputClass}
                                    value={aiConfig.openaiApiKey || ''}
                                    onChange={(e) => onAiConfigChange({ ...aiConfig, openaiApiKey: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>Base URL（可选）</label>
                                <input
                                    type="text"
                                    className={inputClass}
                                    placeholder="https://api.openai.com/v1"
                                    value={aiConfig.openaiBaseUrl || ''}
                                    onChange={(e) => onAiConfigChange({ ...aiConfig, openaiBaseUrl: e.target.value })}
                                />
                            </div>
                        </>
                    )}
                    {aiConfig.provider !== 'none' && (
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                            <label className="flex items-center gap-2 text-sm text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={aiConfig.enabled}
                                    onChange={(e) => onAiConfigChange({ ...aiConfig, enabled: e.target.checked })}
                                />
                                启用 AI 助手
                            </label>
                            <button
                                type="button"
                                onClick={onSaveAiConfig}
                                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
                            >
                                保存配置
                            </button>
                        </div>
                    )}
                </div>
            </details>

            {isCloudConnected && (
                <SectionCard
                    title="云端备份"
                    icon={<History size={18} className="text-sky-600" />}
                    action={
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={onRefreshHistory}
                                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                                title="刷新"
                            >
                                <RefreshCw size={14} />
                            </button>
                            <button
                                type="button"
                                onClick={onOpenSnapshot}
                                className="rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
                            >
                                新建备份
                            </button>
                        </div>
                    }
                >
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                        {isLoadingHistory ? (
                            <EmptyRow>加载中…</EmptyRow>
                        ) : cloudHistory.length === 0 ? (
                            <EmptyRow>暂无备份</EmptyRow>
                        ) : (
                            cloudHistory.map((backup) => (
                                <div
                                    key={backup.id}
                                    className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0"
                                >
                                    <div>
                                        <div className="text-sm font-medium text-slate-700">
                                            {backup.note || '无备注'}
                                        </div>
                                        <div className="flex items-center gap-1 text-xs text-slate-400">
                                            <FileClock size={10} />
                                            {new Date(backup.created_at).toLocaleString()}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => onRestoreBackup(backup.id)}
                                            disabled={restoringId === backup.id}
                                            className="flex items-center gap-1 rounded border border-orange-200 px-2 py-1 text-xs text-orange-600 hover:bg-orange-50"
                                        >
                                            {restoringId === backup.id ? (
                                                <Loader2 size={12} className="animate-spin" />
                                            ) : (
                                                <RotateCcw size={12} />
                                            )}
                                            恢复
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onDownloadBackup(backup.id, backup.note)}
                                            className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                                        >
                                            <Download size={12} /> 下载
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </SectionCard>
            )}

            <SectionCard title="本地数据" icon={<Database size={18} className="text-sky-600" />}>
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3">
                        <div>
                            <div className="text-sm font-medium text-slate-700">导出 JSON 备份</div>
                            <div className="text-xs text-slate-400">含 project_id={cloudConfig.projectId}</div>
                        </div>
                        <button
                            type="button"
                            onClick={onExport}
                            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                        >
                            导出
                        </button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3">
                        <div>
                            <div className="text-sm font-medium text-slate-700">导入到当前园区</div>
                            <div className="text-xs text-slate-400">校验备份 project_id</div>
                        </div>
                        <label className="cursor-pointer rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
                            选择文件
                            <input type="file" className="hidden" accept=".json" onChange={onImport} />
                        </label>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-100 bg-rose-50/50 px-4 py-3">
                        <div>
                            <div className="text-sm font-medium text-rose-700">重置本地缓存</div>
                            <div className="text-xs text-rose-400">仅当前园区浏览器数据</div>
                        </div>
                        <button
                            type="button"
                            onClick={onResetData}
                            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100"
                        >
                            重置
                        </button>
                    </div>
                </div>
            </SectionCard>

            <p className="text-center text-xs text-slate-400">
                Kingdee Park Management System v4.0 · © 2024 Kingdee
            </p>

            {userManageTarget && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
                    <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
                        <div className="mb-4 flex items-start justify-between gap-2">
                            <div>
                                <h4 className="text-sm font-bold text-slate-800">管理登录账号</h4>
                                <p className="mt-0.5 break-all text-xs text-slate-500">{userManageTarget.email}</p>
                            </div>
                            <button
                                type="button"
                                aria-label="关闭"
                                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                                onClick={onCloseUserManage}
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className={labelClass}>姓名</label>
                                <input
                                    className={inputClass}
                                    value={userManageForm.name}
                                    onChange={(e) => onUserManageFormChange({ name: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>角色</label>
                                <select
                                    className={inputClass}
                                    value={userManageForm.role}
                                    onChange={(e) =>
                                        onUserManageFormChange({ role: e.target.value as UserRole })
                                    }
                                >
                                    <option value="park_user">普通用户</option>
                                    <option value="property_staff">物业人员</option>
                                    <option value="park_admin">园区管理员</option>
                                    <option value="group_admin">集团管理员</option>
                                    <option value="platform_admin">平台管理员</option>
                                </select>
                                {userManageForm.role === 'property_staff' && (
                                    <p className="mt-2 text-xs leading-relaxed text-teal-700">
                                        物业人员不显示租金相关字段，可维护物业费应收。
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className={labelClass}>默认园区</label>
                                <input
                                    className={inputClass}
                                    value={userManageForm.projectId}
                                    onChange={(e) => onUserManageFormChange({ projectId: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>可访问园区</label>
                                <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                                    {authorizedParks.map((park) => (
                                        <label
                                            key={park.projectId}
                                            className="flex items-center gap-2 text-sm text-slate-700"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={userManageForm.allowedParkIds.includes(park.projectId)}
                                                onChange={(e) => {
                                                    const ids = e.target.checked
                                                        ? [...userManageForm.allowedParkIds, park.projectId]
                                                        : userManageForm.allowedParkIds.filter(
                                                              (id) => id !== park.projectId
                                                          );
                                                    onUserManageFormChange({ allowedParkIds: ids });
                                                }}
                                            />
                                            {park.name}{' '}
                                            <span className="text-slate-400">({park.projectId})</span>
                                        </label>
                                    ))}
                                    {authorizedParks.length === 0 && (
                                        <p className="text-xs text-amber-600">
                                            未加载园区目录时可直接保存默认园区。
                                        </p>
                                    )}
                                </div>
                            </div>
                            <label className="flex items-center gap-2 text-sm text-slate-600">
                                <input
                                    type="checkbox"
                                    checked={userManageForm.enabled}
                                    onChange={(e) => onUserManageFormChange({ enabled: e.target.checked })}
                                />
                                账号已启用（可登录）
                            </label>
                            <div>
                                <label className={labelClass}>新密码（留空不修改）</label>
                                <input
                                    type="password"
                                    className={inputClass}
                                    value={userManageForm.password}
                                    onChange={(e) => onUserManageFormChange({ password: e.target.value })}
                                    placeholder="至少 8 位"
                                    autoComplete="new-password"
                                />
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={onCloseUserManage}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={onDeleteUserManage}
                                disabled={userManageSaving}
                                className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                            >
                                删除
                            </button>
                            <button
                                type="button"
                                onClick={onSaveUserManage}
                                disabled={userManageSaving}
                                className="rounded-lg bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-50"
                            >
                                {userManageSaving ? '保存中…' : '保存'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
