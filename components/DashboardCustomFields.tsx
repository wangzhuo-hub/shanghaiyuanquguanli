import React from 'react';
import { Check, Settings, X } from 'lucide-react';
import type { DashboardData } from '../types';
import {
    CUSTOM_DASHBOARD_FIELD_LIMIT,
    DASHBOARD_CUSTOM_FIELD_OPTIONS,
    DASHBOARD_CUSTOM_FIELD_OPTION_MAP,
    DEFAULT_CUSTOM_DASHBOARD_FIELD_IDS,
    customFieldToneClass,
    type DashboardCustomFieldId,
    type DashboardCustomFieldOption,
} from '../services/dashboardCustomFields';
import { useMobileSheetFocus } from './useMobileSheetFocus';

const DashboardCustomFieldsBase: React.FC<{
    data: DashboardData;
    selectedYear: number;
    projectId?: string;
    selectedFieldIds: DashboardCustomFieldId[];
    onConfigure: () => void;
    compact?: boolean;
    settingsOpen?: boolean;
    syncLabel?: string;
    syncTone?: 'blue' | 'cyan' | 'amber' | 'slate';
}> = ({ data, selectedYear, projectId, selectedFieldIds, onConfigure, compact = false, settingsOpen = false, syncLabel, syncTone = 'slate' }) => {
    const fields = React.useMemo(
        () => selectedFieldIds
            .map((id) => DASHBOARD_CUSTOM_FIELD_OPTION_MAP.get(id))
            .filter((option): option is DashboardCustomFieldOption => Boolean(option))
            .map((option) => ({ option, resolved: option.resolve(data, selectedYear, projectId) })),
        [data, projectId, selectedFieldIds, selectedYear],
    );

    const shellClass = compact
        ? 'mobile-dashboard-custom-fields liquid-mobile-readable border-t border-slate-200/70 p-3'
        : 'mt-4 w-[min(72vw,920px)] max-w-full';
    const listClass = compact
        ? 'liquid-mobile-custom-fields-track flex snap-x gap-2 overflow-x-auto pb-1'
        : 'grid grid-cols-2 gap-2 md:grid-cols-5';
    const cardClass = compact
        ? 'liquid-mobile-custom-field min-h-[84px] min-w-[156px] snap-start rounded-[18px] px-3 py-3 text-left'
        : 'liquid-glass-readable liquid-custom-field min-w-0 rounded-[18px] px-3 py-3 text-center';
    const listA11yProps = compact
        ? {
            role: 'list' as const,
            'aria-label': `我的关注字段，横向滚动，最多显示 ${CUSTOM_DASHBOARD_FIELD_LIMIT} 个字段`,
        }
        : {};
    const syncClass = {
        blue: 'text-blue-600',
        cyan: 'text-cyan-700',
        amber: 'text-amber-600',
        slate: 'text-slate-500',
    }[syncTone];

    return (
        <div className={shellClass}>
            <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
                <div className="min-w-0">
                    <div className="text-xs font-black text-slate-800">我的关注字段</div>
                    <div className="text-xs font-semibold text-slate-500">
                        最多显示 {CUSTOM_DASHBOARD_FIELD_LIMIT} 个字段
                        {syncLabel && <span className={`ml-1 ${syncClass}`}>· {syncLabel}</span>}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onConfigure}
                    aria-expanded={settingsOpen}
                    aria-controls="dashboard-custom-field-settings-panel"
                    className="liquid-glass-control liquid-pressable inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-white/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                >
                    <Settings size={14} />
                    自定义
                </button>
            </div>
            {fields.length > 0 ? (
                <div className={listClass} {...listA11yProps}>
                    {fields.map(({ option, resolved }) => {
                        const fieldSummaryLabel = `${option.label} ${resolved.value}，${resolved.helper}`;
                        return (
                            <div
                                key={option.id}
                                className={cardClass}
                                role={compact ? 'listitem' : undefined}
                                aria-label={compact ? fieldSummaryLabel : undefined}
                                title={fieldSummaryLabel}
                            >
                                <div className="truncate text-xs font-black text-slate-500" title={option.label}>{option.label}</div>
                                <div
                                    className={`mt-1 truncate text-xl font-black tabular-nums ${customFieldToneClass(option.tone)}`}
                                    title={resolved.value}
                                >
                                    {resolved.value}
                                </div>
                                <div className="mt-1 truncate text-xs font-semibold text-slate-500" title={resolved.helper}>{resolved.helper}</div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <button
                    type="button"
                    onClick={onConfigure}
                    aria-expanded={settingsOpen}
                    aria-controls="dashboard-custom-field-settings-panel"
                    title="点击添加个人关注字段"
                    className="liquid-glass-readable liquid-custom-field mobile-pressable min-h-12 w-full rounded-[18px] px-4 py-4 text-center text-sm font-black text-slate-500 transition"
                >
                    点击添加个人关注字段
                </button>
            )}
        </div>
    );
};

export const DashboardCustomFields = React.memo(DashboardCustomFieldsBase);

export const DashboardCustomFieldSettings: React.FC<{
    open: boolean;
    selectedFieldIds: DashboardCustomFieldId[];
    onClose: () => void;
    onSave: (ids: DashboardCustomFieldId[]) => void;
}> = ({ open, selectedFieldIds, onClose, onSave }) => {
    const [draftIds, setDraftIds] = React.useState<DashboardCustomFieldId[]>(selectedFieldIds);
    const {
        triggerRef: settingsTriggerRef,
        initialFocusRef: settingsCloseButtonRef,
        sheetRef: settingsSheetRef,
    } = useMobileSheetFocus<HTMLElement, HTMLButtonElement, HTMLElement>({
        isOpen: open,
        onEscape: onClose,
    });

    React.useEffect(() => {
        if (open) setDraftIds(selectedFieldIds);
    }, [open, selectedFieldIds]);

    React.useEffect(() => {
        if (!open) return;
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && !settingsSheetRef.current?.contains(activeElement)) {
            settingsTriggerRef.current = activeElement;
        }
    }, [open, settingsSheetRef, settingsTriggerRef]);

    if (!open) return null;

    const toggleField = (id: DashboardCustomFieldId) => {
        setDraftIds((current) => {
            if (current.includes(id)) return current.filter((item) => item !== id);
            if (current.length >= CUSTOM_DASHBOARD_FIELD_LIMIT) return current;
            return [...current, id];
        });
    };

    return (
        <div className="monthly-detail-backdrop fixed inset-0 z-[72] flex items-end justify-center px-3 py-3 md:items-center md:py-6" onClick={onClose}>
            <section
                id="dashboard-custom-field-settings-panel"
                ref={settingsSheetRef}
                className="monthly-detail-panel liquid-glass-panel flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] md:max-h-[86vh] md:rounded-[28px]"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="dashboard-custom-field-settings-title"
                aria-describedby="dashboard-custom-field-settings-description"
            >
                <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 bg-white/82 px-4 py-4 md:px-5">
                    <div className="min-w-0">
                        <h3 id="dashboard-custom-field-settings-title" className="text-lg font-black text-slate-950">自定义关注字段</h3>
                        <p id="dashboard-custom-field-settings-description" className="mt-1 text-sm font-semibold text-slate-500">
                            选择最多 {CUSTOM_DASHBOARD_FIELD_LIMIT} 个字段，保存后按当前登录用户同步。
                        </p>
                    </div>
                    <button
                        ref={settingsCloseButtonRef}
                        type="button"
                        onClick={onClose}
                        className="liquid-glass-control liquid-pressable inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/70 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                        aria-label="关闭自定义字段设置"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="overflow-auto p-4 md:p-5">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {DASHBOARD_CUSTOM_FIELD_OPTIONS.map((option) => {
                            const checked = draftIds.includes(option.id);
                            const disabled = !checked && draftIds.length >= CUSTOM_DASHBOARD_FIELD_LIMIT;
                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => toggleField(option.id)}
                                    disabled={disabled}
                                    aria-pressed={checked}
                                    className={`liquid-glass-readable liquid-pressable flex min-h-[88px] items-start gap-3 rounded-[18px] px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80 ${
                                        checked ? 'ring-2 ring-blue-300/70' : 'hover:bg-white/75'
                                    } ${disabled ? 'cursor-not-allowed opacity-45' : ''}`}
                                >
                                    <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                        checked ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300 bg-white/40 text-transparent'
                                    }`}>
                                        <Check size={13} />
                                    </span>
                                    <span className="min-w-0">
                                        <span className={`block text-sm font-black ${customFieldToneClass(option.tone)}`}>{option.label}</span>
                                        <span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200/70 bg-white/76 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:flex-row md:items-center md:justify-between md:px-5 md:pb-4">
                    <div className="text-xs font-semibold text-slate-500" aria-live="polite" aria-atomic="true">
                        已选择 {draftIds.length}/{CUSTOM_DASHBOARD_FIELD_LIMIT}
                    </div>
                    <div className="grid grid-cols-3 gap-2 md:flex md:items-center">
                        <button
                            type="button"
                            onClick={() => setDraftIds(DEFAULT_CUSTOM_DASHBOARD_FIELD_IDS)}
                            className="liquid-glass-control liquid-pressable min-h-11 rounded-full px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-white/70"
                        >
                            恢复默认
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="liquid-glass-control liquid-pressable min-h-11 rounded-full px-3 py-2 text-xs font-bold text-slate-500 transition hover:bg-white/70"
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={() => onSave(draftIds)}
                            className="liquid-glass-control liquid-action-strong liquid-pressable min-h-11 rounded-full px-4 py-2 text-xs font-bold"
                        >
                            保存设置
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
};
