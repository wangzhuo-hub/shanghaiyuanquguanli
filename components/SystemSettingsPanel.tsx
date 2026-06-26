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
import type { ManagedUserAccount, SignupRequestRecord } from '../services/cloudAccountService';
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
    onRejectSignupRequest: (req: SignupRequestRecord) => void;
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
    'liquid-settings-field min-h-[44px] w-full rounded-2xl px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80';
const labelClass = 'mb-1.5 block text-xs font-black text-slate-500';
const settingsTableHeaderClass =
    'liquid-settings-table-head px-3 py-2 text-xs font-black text-slate-600 sm:px-4';
const settingsGroupHeaderClass =
    'liquid-settings-group-head px-3 py-2 text-sm font-black text-slate-800 sm:px-4';
const settingsRowClass = 'liquid-settings-row px-3 py-3 sm:px-4';
const settingsCompactRowClass = 'liquid-settings-row-compact px-3 py-2.5 text-sm sm:px-4';
const settingsActionBaseClass =
    'liquid-settings-action liquid-pressable inline-flex min-h-[36px] items-center justify-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold';
const settingsDangerButtonClass =
    `${settingsActionBaseClass} liquid-settings-action--danger`;
const settingsWarnButtonClass =
    `${settingsActionBaseClass} liquid-settings-action--warning`;
const settingsTinyButtonClass =
    'liquid-settings-action liquid-pressable inline-flex min-h-[36px] items-center justify-center rounded-full px-3 py-1.5 text-xs font-bold';
const settingsTinyNeutralButtonClass = `${settingsTinyButtonClass} liquid-settings-action--neutral`;

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
        <section className="liquid-settings-card overflow-hidden rounded-[24px]">
            <div className="flex flex-col gap-3 border-b border-white/65 bg-white/18 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        {icon}
                        <h2 className="text-base font-black text-slate-950">{title}</h2>
                    </div>
                    {description ? <p className="mt-1 text-sm font-semibold text-slate-500">{description}</p> : null}
                </div>
                {action ? <div className="flex w-full shrink-0 justify-start sm:w-auto sm:justify-end">{action}</div> : null}
            </div>
            <div className="px-4 py-4 sm:px-5">{children}</div>
        </section>
    );
}

function StatusPill({ connected }: { connected: boolean }) {
    return connected ? (
        <span className="liquid-settings-status-pill inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black" data-state="connected">
            <CheckCircle2 size={12} /> 已连接
        </span>
    ) : (
        <span className="liquid-settings-status-pill inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black" data-state="disconnected">
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
            className={`liquid-pressable inline-flex min-h-[38px] items-center justify-center rounded-full px-3 py-1.5 text-sm font-bold transition ${
                active ? 'liquid-action-strong' : 'liquid-glass-control text-slate-600 hover:bg-white/70'
            }`}
        >
            {children}
            {count != null && count > 0 ? (
                <span
                    className={`ml-1.5 inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 text-xs font-black ${
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
    return <div className="liquid-glass-readable rounded-[18px] px-4 py-8 text-center text-sm font-semibold text-slate-500">{children}</div>;
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
        onRejectSignupRequest,
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
    const rejectedSignups = signupRequests.filter((r) => r.status === 'rejected');
    const pendingTotal = pendingUsers.length + pendingSignups.length;

    const handleAutoSyncChange = (checked: boolean) => {
        const next = { ...cloudConfig, autoSync: checked };
        onCloudConfigChange(next);
        onPersistCloudConfig(next);
    };

    return (
        <div className="mx-auto max-w-5xl space-y-4 pb-8 animate-in fade-in duration-300 sm:space-y-5">
            <div className="liquid-settings-hero rounded-[28px] px-5 py-5 md:px-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-black text-blue-700">
                            <Sparkles size={14} />
                            系统配置
                        </div>
                        <h2 className="mt-1 text-xl font-black tracking-normal text-slate-950 md:text-2xl">系统与备份</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-500">
                            后端连接、登录人员、AI 识别、历史备份和数据维护集中管理。
                        </p>
                    </div>
                    <div className="liquid-glass-readable rounded-[20px] px-4 py-3 text-sm">
                        <div className="text-xs font-black text-slate-500">当前园区</div>
                        <div className="mt-1 max-w-[220px] truncate font-black text-slate-900">{currentParkName || '未选择园区'}</div>
                    </div>
                </div>
            </div>
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
                            <span className="ml-2 text-xs font-semibold text-slate-500">（顶栏切换）</span>
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
                        className="liquid-settings-notice mt-3 rounded-2xl px-3 py-2 text-sm font-semibold"
                        data-tone={cloudConnectionMsg.type === 'success' ? 'success' : 'danger'}
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
	                                className="liquid-glass-control liquid-pressable inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-slate-600"
	                            >
                                <RefreshCw size={14} /> 刷新
                            </button>
                        ) : null
                    }
                >
                    {!isPlatformAdmin ? (
                        <div className="liquid-settings-notice rounded-2xl px-4 py-3 text-sm font-semibold" data-tone="warning">
                            当前为园区/集团管理员，仅可查看连接设置，不可维护登录人员。
                        </div>
                    ) : (
                        <>
                            <div className="liquid-glass-readable mb-4 grid grid-cols-2 gap-1 rounded-[22px] p-1 sm:flex sm:flex-wrap sm:rounded-full">
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
                                    <div className="flex sm:col-span-2 sm:justify-end">
	                                        <button
	                                            type="submit"
	                                            disabled={isCreatingUser}
	                                            className="liquid-action-strong liquid-pressable w-full rounded-full px-4 py-2 text-sm font-black disabled:opacity-60 sm:w-auto"
	                                        >
                                            {isCreatingUser ? '提交中…' : '新增登录人员'}
                                        </button>
                                    </div>
                                </form>
                            )}

                            {userTab === 'pending' && (
                                <div className="space-y-4">
	                                    <div className="liquid-settings-table overflow-hidden rounded-[20px]">
	                                        <div className={settingsTableHeaderClass}>
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
                                                    className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${settingsRowClass}`}
                                                >
                                                    <div className="min-w-0 self-stretch sm:self-auto">
                                                        <div className="truncate text-sm font-medium text-slate-800">
                                                            {u.email}
                                                        </div>
                                                        <div className="text-xs text-slate-500">
                                                            {u.name || '未填姓名'} · {userRoleLabel(u.role)}
                                                            {u.password ? (
                                                                <>
                                                                    {' '}
                                                                    · 密码{' '}
                                                                    <span className="font-mono text-slate-600">{u.password}</span>
                                                                </>
                                                            ) : null}
                                                        </div>
                                                    </div>
	                                                    <button
	                                                        type="button"
	                                                        onClick={() => onApproveManagedUser(u, true)}
	                                                        className="liquid-action-strong liquid-pressable min-h-[36px] w-full shrink-0 rounded-full px-3 py-1.5 text-xs font-bold sm:w-auto"
	                                                    >
                                                        通过
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
	                                    <div className="liquid-settings-table overflow-hidden rounded-[20px]">
	                                        <div className={settingsTableHeaderClass}>
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
                                                    className={`space-y-2 ${settingsRowClass}`}
                                                >
                                                    <div className="text-sm font-medium text-slate-800">
                                                        {req.applicantName || '（未填姓名）'}
                                                    </div>
                                                    <div className="text-xs text-slate-500">{req.email}</div>
                                                    {req.password ? (
                                                        <div className="text-xs text-slate-500">
                                                            密码{' '}
                                                            <span className="font-mono text-slate-600">{req.password}</span>
                                                        </div>
                                                    ) : null}
                                                    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                                                        <button
                                                            type="button"
                                                            onClick={() => onDeleteSignupRequest(req)}
                                                            className={`${settingsDangerButtonClass} w-full sm:w-auto`}
                                                        >
                                                            <Trash2 size={13} /> 删除申请
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => onRejectSignupRequest(req)}
                                                            className={`${settingsWarnButtonClass} w-full sm:w-auto`}
                                                        >
                                                            <RotateCcw size={13} /> 退回
                                                        </button>
	                                                        <button
	                                                            type="button"
	                                                            onClick={() => onApproveSignupRequest(req)}
	                                                            className="liquid-action-strong liquid-pressable inline-flex min-h-[36px] w-full items-center justify-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold sm:w-auto"
	                                                        >
                                                            <CheckCircle2 size={13} />
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
	                                <div className="liquid-settings-table max-h-96 overflow-y-auto rounded-[20px]">
                                    {isLoadingManagedUsers ? (
                                        <EmptyRow>加载中…</EmptyRow>
                                    ) : managedUsersError ? (
                                        <EmptyRow>{managedUsersError}</EmptyRow>
                                    ) : activeUsers.length === 0 ? (
                                        <EmptyRow>暂无已启用账号</EmptyRow>
                                    ) : (
                                        activeUsers.map((u) => (
                                            <div
                                                key={u.id}
                                                className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${settingsRowClass}`}
                                            >
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-medium text-slate-800">
                                                        {u.email}
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        {u.name || '未填姓名'} · {userRoleLabel(u.role)} ·{' '}
                                                        {u.projectId || '—'}
                                                        {u.password ? (
                                                            <>
                                                                {' '}
                                                                · 密码{' '}
                                                                <span className="font-mono text-slate-600">{u.password}</span>
                                                            </>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:w-auto sm:flex sm:gap-1">
	                                                    <button
	                                                        type="button"
	                                                        onClick={() => onOpenUserManage(u)}
	                                                        className="liquid-glass-control liquid-pressable inline-flex min-h-[36px] items-center justify-center rounded-full px-2.5 py-1 text-xs font-bold text-slate-700"
	                                                    >
                                                        <Pencil size={12} className="inline" /> 编辑
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => onDeleteManagedUser(u)}
                                                        className={settingsDangerButtonClass}
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
	                                <div className="liquid-settings-table max-h-96 overflow-y-auto rounded-[20px]">
                                    {isLoadingSignupRequests ? (
                                        <EmptyRow>加载中…</EmptyRow>
                                    ) : approvedSignupByPark.parkOrder.length === 0 && rejectedSignups.length === 0 ? (
                                        <EmptyRow>暂无线上注册审批记录</EmptyRow>
                                    ) : (
                                        <>
                                            {approvedSignupByPark.parkOrder.map((projectId) => {
                                                const parkTitle =
                                                    authorizedParks.find((p) => p.projectId === projectId)?.name ||
                                                    projectId;
                                                const rows = approvedSignupByPark.byPark.get(projectId) || [];
                                                return (
                                                    <div key={projectId}>
	                                                        <div className={settingsGroupHeaderClass}>
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
                                                                    className={settingsCompactRowClass}
                                                                >
                                                                    <div className="font-medium text-slate-800">
                                                                        {req.applicantName || '（未填姓名）'}
                                                                    </div>
                                                                    <div className="text-xs text-slate-500">{req.email}</div>
                                                                    <div className="mt-2 grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:justify-end">
                                                                        {linked && (
                                                                            <>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => onOpenUserManage(linked)}
                                                                                    className={settingsTinyNeutralButtonClass}
                                                                                >
                                                                                    编辑
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => onDeleteManagedUser(linked)}
                                                                                    className={`${settingsTinyButtonClass} liquid-settings-action--danger`}
                                                                                >
                                                                                    删除账号
                                                                                </button>
                                                                            </>
                                                                        )}
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => onDeleteSignupRequest(req)}
                                                                            className={`${settingsTinyButtonClass} liquid-settings-action--warning`}
                                                                        >
                                                                            清理记录
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })}
                                            {rejectedSignups.length > 0 ? (
                                                <div>
                                                    <div className={`${settingsGroupHeaderClass} liquid-settings-group-head--warning`}>
                                                        已退回申请 · {rejectedSignups.length}
                                                    </div>
                                                    {rejectedSignups.map((req) => (
                                                        <div
                                                            key={req.id}
                                                            className={`${settingsCompactRowClass} liquid-settings-row--warning`}
                                                        >
                                                            <div className="font-medium text-slate-800">
                                                                {req.applicantName || '（未填姓名）'}
                                                            </div>
                                                            <div className="text-xs text-slate-500">{req.email}</div>
                                                            {req.reviewNote ? (
                                                                <div className="mt-1 text-xs text-amber-700">
                                                                    {req.reviewNote}
                                                                </div>
                                                            ) : null}
                                                            <div className="mt-2 flex justify-stretch sm:justify-end">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onDeleteSignupRequest(req)}
                                                                    className={`${settingsTinyButtonClass} liquid-settings-action--warning w-full sm:w-auto`}
                                                                >
                                                                    清理记录
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : null}
                                        </>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </SectionCard>
            ) : null}

	            <details className="liquid-settings-card group overflow-hidden rounded-[24px]">
	                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 marker:content-none">
	                    <div className="flex items-center gap-2">
                        <Sparkles size={18} className="text-blue-600" />
                        <span className="text-base font-black text-slate-950">AI 助手</span>
                        {aiConfig.enabled ? (
                            <span className="liquid-settings-status-pill rounded-full px-2 py-0.5 text-xs font-black" data-state="enabled">已启用</span>
                        ) : (
                            <span className="liquid-settings-status-pill rounded-full px-2 py-0.5 text-xs font-black" data-state="muted">未启用</span>
                        )}
                    </div>
                    <span className="text-xs font-semibold text-slate-500 group-open:hidden">展开配置</span>
                </summary>
                <div className="liquid-settings-panel-body space-y-4 px-4 py-4 sm:px-5">
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
                        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
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
	                                className="liquid-action-strong liquid-pressable w-full rounded-full px-4 py-2 text-sm font-black sm:w-auto"
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
	                                className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500"
	                                title="刷新"
                            >
                                <RefreshCw size={14} />
                            </button>
	                            <button
	                                type="button"
	                                onClick={onOpenSnapshot}
	                                className="liquid-glass-control liquid-pressable rounded-full px-3 py-1.5 text-xs font-bold text-blue-700"
	                            >
                                新建备份
                            </button>
                        </div>
                    }
                >
	                    <div className="liquid-settings-table max-h-48 overflow-y-auto rounded-[20px]">
                        {isLoadingHistory ? (
                            <EmptyRow>加载中…</EmptyRow>
                        ) : cloudHistory.length === 0 ? (
                            <EmptyRow>暂无备份</EmptyRow>
                        ) : (
                            cloudHistory.map((backup) => (
	                                <div
	                                    key={backup.id}
	                                    className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${settingsRowClass}`}
	                                >
                                    <div className="min-w-0 self-stretch sm:self-auto">
                                        <div className="text-sm font-medium text-slate-700">
                                            {backup.note || '无备注'}
                                        </div>
                                        <div className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                                            <FileClock size={10} />
                                            {new Date(backup.created_at).toLocaleString()}
                                        </div>
                                    </div>
                                    <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex">
	                                        <button
	                                            type="button"
	                                            onClick={() => onRestoreBackup(backup.id)}
	                                            disabled={restoringId === backup.id}
	                                            className={`${settingsWarnButtonClass} flex w-full sm:w-auto`}
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
                                            className="liquid-glass-control liquid-pressable flex min-h-[36px] items-center justify-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-slate-700"
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
		                    <div className="liquid-settings-maintenance-row flex flex-col gap-3 rounded-[18px] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-700">导出 JSON 备份</div>
                            <div className="text-xs font-semibold text-slate-500">含 project_id={cloudConfig.projectId}</div>
                        </div>
                        <button
                            type="button"
                            onClick={onExport}
	                            className="liquid-glass-control liquid-pressable min-h-[36px] w-full rounded-full px-3 py-1.5 text-xs font-bold text-slate-700 sm:w-auto"
                        >
                            导出
                        </button>
                    </div>
		                    <div className="liquid-settings-maintenance-row flex flex-col gap-3 rounded-[18px] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-700">导入到当前园区</div>
                            <div className="text-xs font-semibold text-slate-500">校验备份 project_id</div>
                        </div>
	                        <label className="liquid-glass-control liquid-pressable inline-flex min-h-[36px] w-full cursor-pointer items-center justify-center rounded-full px-3 py-1.5 text-xs font-bold text-slate-700 sm:w-auto">
                            选择文件
                            <input type="file" className="hidden" accept=".json" onChange={onImport} />
                        </label>
                    </div>
		                    <div className="liquid-settings-maintenance-row liquid-settings-maintenance-row--danger flex flex-col gap-3 rounded-[18px] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-rose-700">重置本地缓存</div>
                            <div className="text-xs text-rose-400">仅当前园区浏览器数据</div>
                        </div>
	                        <button
		                            type="button"
		                            onClick={onResetData}
		                            className={`${settingsDangerButtonClass} w-full sm:w-auto`}
		                        >
                            重置
                        </button>
                    </div>
                </div>
            </SectionCard>

            <p className="text-center text-xs font-semibold text-slate-500">
                Kingdee Park Management System v4.0 · © 2024 Kingdee
            </p>

            {userManageTarget && (
	                <div className="liquid-elevated-backdrop fixed inset-0 z-[80] flex items-end justify-center p-3 sm:items-center sm:p-4">
	                    <div className="liquid-elevated-panel max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[26px]">
	                        <div className="liquid-elevated-header mb-4 flex items-start justify-between gap-2 px-5 py-4">
	                            <div>
	                                <h4 className="text-sm font-black text-slate-950">管理登录账号</h4>
	                                <p className="mt-0.5 break-all text-xs text-slate-500">{userManageTarget.email}</p>
	                            </div>
	                            <button
	                                type="button"
	                                aria-label="关闭"
	                                className="liquid-glass-control liquid-pressable rounded-full p-1.5 text-slate-500"
	                                onClick={onCloseUserManage}
	                            >
	                                <X size={18} />
	                            </button>
	                        </div>
	                        <div className="space-y-3 px-5">
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
	                                    <p className="liquid-settings-notice mt-2 rounded-2xl px-3 py-2 text-xs font-semibold leading-relaxed" data-tone="info">
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
	                                <div className="liquid-settings-table max-h-40 space-y-2 overflow-y-auto rounded-[18px] p-3">
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
                                            <span className="font-semibold text-slate-500">({park.projectId})</span>
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
                                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                                    仅修改密码时填写；系统将使用账号备份的旧密码完成 PocketBase 改密校验。
                                </p>
                            </div>
                        </div>
	                        <div className="liquid-elevated-footer mt-5 grid grid-cols-1 gap-2 px-5 py-4 sm:flex sm:justify-end">
	                            <button
	                                type="button"
	                                onClick={onCloseUserManage}
	                                className="liquid-glass-control liquid-pressable rounded-full px-3 py-2 text-sm font-bold text-slate-600"
	                            >
                                取消
                            </button>
	                            <button
		                            type="button"
		                            onClick={onDeleteUserManage}
		                            disabled={userManageSaving}
		                                className={`${settingsDangerButtonClass} px-3 py-2 text-sm`}
		                            >
                                删除
                            </button>
	                            <button
	                                type="button"
	                                onClick={onSaveUserManage}
	                                disabled={userManageSaving}
	                                className="liquid-action-strong liquid-pressable rounded-full px-3 py-2 text-sm font-black disabled:opacity-50"
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
