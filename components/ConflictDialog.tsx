import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import type { IncrementalConflict } from '../services/cloudService';

/**
 * ConflictDialog —— 增量保存遇到行级冲突时的决策弹窗。
 *
 * 业务流：
 *   1. App 调用 saveIncrementalToCloud → 收到 conflicts[] → 弹出本对话框
 *   2. 用户对每条冲突选择「用服务端值」「用我的值」「跳过此条」
 *   3. 点击「应用决策」→ 回调 onResolve(decisions[])，由 App 层调用
 *      forceOverwriteCloudRecord 落库（仅对「用我的值」），并刷新 recordMeta
 */

export type ConflictAction = 'mine' | 'theirs' | 'skip';

export interface ConflictDecision {
    conflict: IncrementalConflict;
    action: ConflictAction;
}

export interface ConflictDialogProps {
    open: boolean;
    conflicts: IncrementalConflict[];
    /** 用户点击「应用决策」时调用，参数对每条冲突都有一个明确 action */
    onResolve: (decisions: ConflictDecision[]) => void | Promise<void>;
    /** 用户点击关闭/取消时调用 */
    onClose: () => void;
    /** 可选：把 collection + 服务端 record 转成人类可读名字，例如租户"张三" */
    nameOf?: (collection: string, record: Record<string, any>, originalId: string) => string;
}

const COLLECTION_LABEL: Record<string, string> = {
    pb_buildings: '楼宇',
    pb_units: '单元',
    pb_tenants: '租户',
    pb_payments: '回款',
    pb_invoices: '发票',
    pb_yearly_targets: '年度目标',
    pb_monthly_init_data: '月度初始化',
    pb_budget_assumptions: '预算假设',
    pb_budget_adjustments: '预算调整',
    pb_budget_scenarios: '预算方案',
    pb_billing_period_notes: '账期备注',
};

const defaultNameOf = (
    collection: string,
    record: Record<string, any>,
    originalId: string
): string => {
    if (!record) return originalId;
    return (
        record.name ||
        record.tenant_name ||
        record.target_name ||
        record.original_id ||
        originalId
    );
};

const formatValue = (v: unknown): string => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
};

interface FieldDiff {
    field: string;
    localValue: unknown;
    serverValue: unknown;
}

const computeFieldDiffs = (c: IncrementalConflict): FieldDiff[] => {
    if (c.op === 'delete') {
        // 删除冲突：没有 localChanges，整个记录视为「本地想删 / 服务端有改动」
        return [
            {
                field: '<整条记录>',
                localValue: '<删除>',
                serverValue: '<服务端已被改动>',
            },
        ];
    }
    const changed = c.localChanges || {};
    return Object.keys(changed).map((field) => ({
        field,
        localValue: (changed as any)[field],
        serverValue: (c.serverRecord as any)?.[field],
    }));
};

const getDefaultAction = (c: IncrementalConflict): ConflictAction => {
    // 账期备注（含缓缴、跟进备注）冲突时默认保留本地值，避免导入后被服务端空值覆盖。
    if (c.collection === 'pb_billing_period_notes') return 'mine';
    return 'skip';
};

const conflictActionButtonClass = (active: boolean, tone: ConflictAction): string => {
    if (active) {
        if (tone === 'mine') return 'liquid-conflict-decision-active-mine';
        if (tone === 'theirs') return 'liquid-conflict-decision-active-theirs';
        return 'liquid-conflict-decision-active-skip';
    }
    return 'liquid-conflict-decision-idle';
};

export const ConflictDialog: React.FC<ConflictDialogProps> = ({
    open,
    conflicts,
    onResolve,
    onClose,
    nameOf = defaultNameOf,
}) => {
    // 每条冲突的当前选择，默认「跳过」更安全
    const [decisions, setDecisions] = useState<Record<string, ConflictAction>>({});
    const [isApplying, setIsApplying] = useState(false);

    const keyOf = (c: IncrementalConflict) => `${c.collection}::${c.originalId}::${c.op}`;

    const items = useMemo(
        () =>
            conflicts.map((c) => ({
                key: keyOf(c),
                conflict: c,
                label: COLLECTION_LABEL[c.collection] || c.collection,
                name: nameOf(c.collection, c.serverRecord, c.originalId),
                diffs: computeFieldDiffs(c),
                action: decisions[keyOf(c)] || getDefaultAction(c),
            })),
        [conflicts, decisions, nameOf]
    );

    const setAction = (key: string, action: ConflictAction) => {
        setDecisions((prev) => ({ ...prev, [key]: action }));
    };

    const setAllAction = (action: ConflictAction) => {
        const next: Record<string, ConflictAction> = {};
        for (const it of items) next[it.key] = action;
        setDecisions(next);
    };

    const counts = useMemo(() => {
        let mine = 0;
        let theirs = 0;
        let skip = 0;
        for (const it of items) {
            if (it.action === 'mine') mine += 1;
            else if (it.action === 'theirs') theirs += 1;
            else skip += 1;
        }
        return { mine, theirs, skip };
    }, [items]);

    const handleApply = async () => {
        setIsApplying(true);
        try {
            const out: ConflictDecision[] = items.map((it) => ({
                conflict: it.conflict,
                action: it.action,
            }));
            await onResolve(out);
        } finally {
            setIsApplying(false);
        }
    };

    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            onClose();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, open]);

    if (!open) return null;

    return (
        <div className="liquid-elevated-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:p-4 md:items-center" onClick={onClose}>
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="cloud-save-conflict-dialog-title"
                className="liquid-elevated-panel flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[30px] md:max-h-[92vh] md:rounded-[28px]"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="liquid-elevated-header flex items-start justify-between gap-3 border-b border-white/70 px-4 py-4 sm:px-6">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="liquid-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100">
                            <AlertCircle size={20} className="text-amber-600" />
                        </div>
                        <div className="min-w-0">
                            <h3 id="cloud-save-conflict-dialog-title" className="truncate text-lg font-black text-slate-950">
                                数据冲突（{conflicts.length} 条）
                            </h3>
                            <p className="mt-0.5 text-xs font-semibold leading-relaxed text-slate-500">
                                您编辑的记录在保存前已被他人更新，请逐条选择处理方式
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="liquid-glass-control liquid-pressable inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-slate-950"
                        aria-label="关闭数据冲突弹窗"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="liquid-elevated-header flex flex-col gap-3 border-b border-white/70 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="text-xs font-bold text-slate-600">
                        当前选择：
                        <span className="ml-2 inline-flex items-center gap-1 text-cyan-700">
                            用我的 {counts.mine}
                        </span>
                        <span className="ml-3 inline-flex items-center gap-1 text-blue-700">
                            用服务端 {counts.theirs}
                        </span>
                        <span className="ml-3 inline-flex items-center gap-1 text-slate-500">
                            跳过 {counts.skip}
                        </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                        <button
                            onClick={() => setAllAction('theirs')}
                            className="liquid-conflict-bulk-action liquid-conflict-bulk-theirs liquid-pressable rounded-full px-3 py-2 text-xs font-black"
                        >
                            全部用服务端
                        </button>
                        <button
                            onClick={() => setAllAction('mine')}
                            className="liquid-conflict-bulk-action liquid-conflict-bulk-mine liquid-pressable rounded-full px-3 py-2 text-xs font-black"
                        >
                            全部用我的
                        </button>
                        <button
                            onClick={() => setAllAction('skip')}
                            className="liquid-conflict-bulk-action liquid-conflict-bulk-skip liquid-pressable rounded-full px-3 py-2 text-xs font-black"
                        >
                            全部跳过
                        </button>
                    </div>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
                    {items.map((it) => (
                        <div
                            key={it.key}
                            className="liquid-elevated-card overflow-hidden rounded-3xl"
                        >
                            <div className="liquid-conflict-card-head flex flex-col gap-2 border-b border-white/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="liquid-conflict-type-pill rounded-full px-2 py-0.5 text-xs font-black">
                                        {it.label}
                                    </span>
                                    <span className="font-bold text-slate-800">{it.name}</span>
                                    <span className="text-xs font-semibold text-slate-500">
                                        ({it.conflict.op === 'delete' ? '删除' : '更新'})
                                    </span>
                                </div>
                                <div className="text-xs font-semibold text-slate-500">
                                    本地基准：{it.conflict.baseUpdated || '—'} ／ 服务端最新：
                                    {it.conflict.serverUpdated || '—'}
                                </div>
                            </div>

                            <div className="space-y-2 p-3 md:hidden">
                                {it.diffs.map((d, idx) => (
                                    <div key={idx} className="liquid-conflict-mobile-field rounded-2xl p-3">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <span className="text-xs font-black text-slate-500">字段</span>
                                            <span className="liquid-conflict-field-pill rounded-full px-2 py-0.5 font-mono text-xs font-black">
                                                {d.field}
                                            </span>
                                        </div>
                                        <div className="grid gap-2">
                                            <div className="liquid-conflict-value-local rounded-2xl px-3 py-2">
                                                <div className="text-xs font-black text-cyan-700">我的值（本地）</div>
                                                <div className="mt-1 break-all text-sm font-bold text-cyan-900">
                                                    {formatValue(d.localValue)}
                                                </div>
                                            </div>
                                            <div className="liquid-conflict-value-server rounded-2xl px-3 py-2">
                                                <div className="text-xs font-black text-blue-700">服务端最新值</div>
                                                <div className="mt-1 break-all text-sm font-bold text-blue-900">
                                                    {formatValue(d.serverValue)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="hidden overflow-x-auto md:block">
                            <table className="w-full min-w-[680px] text-sm">
                                <thead className="liquid-contract-sticky text-slate-500 text-xs">
                                    <tr>
                                        <th className="text-left px-4 py-2 w-1/4">字段</th>
                                        <th className="text-left px-4 py-2 w-1/3">我的值（本地）</th>
                                        <th className="text-left px-4 py-2 w-1/3">服务端最新值</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {it.diffs.map((d, idx) => (
                                        <tr key={idx} className="liquid-conflict-table-row border-t border-white/70">
                                            <td className="px-4 py-2 font-mono text-xs text-slate-600">
                                                {d.field}
                                            </td>
                                            <td className="px-4 py-2 text-cyan-700 font-medium break-all">
                                                {formatValue(d.localValue)}
                                            </td>
                                            <td className="px-4 py-2 text-blue-700 font-medium break-all">
                                                {formatValue(d.serverValue)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </div>

                            <div className="liquid-conflict-actions grid grid-cols-3 gap-2 border-t border-white/70 px-3 py-3 sm:flex sm:flex-wrap sm:justify-end sm:px-4">
                                <button
                                    onClick={() => setAction(it.key, 'theirs')}
                                    className={`liquid-conflict-decision liquid-pressable min-h-10 rounded-full px-2 py-2 text-xs font-black transition ${conflictActionButtonClass(it.action === 'theirs', 'theirs')}`}
                                >
                                    用服务端值
                                </button>
                                <button
                                    onClick={() => setAction(it.key, 'mine')}
                                    className={`liquid-conflict-decision liquid-pressable min-h-10 rounded-full px-2 py-2 text-xs font-black transition ${conflictActionButtonClass(it.action === 'mine', 'mine')}`}
                                >
                                    用我的值
                                </button>
                                <button
                                    onClick={() => setAction(it.key, 'skip')}
                                    className={`liquid-conflict-decision liquid-pressable min-h-10 rounded-full px-2 py-2 text-xs font-black transition ${conflictActionButtonClass(it.action === 'skip', 'skip')}`}
                                >
                                    跳过此条
                                </button>
                            </div>
                        </div>
                    ))}
                    {items.length === 0 && (
                        <div className="liquid-elevated-card rounded-3xl py-12 text-center text-sm font-semibold text-slate-500">
                            <CheckCircle2 size={32} className="mx-auto mb-2 text-cyan-500" />
                            没有冲突
                        </div>
                    )}
                </div>

                <div className="liquid-elevated-footer flex flex-col gap-3 border-t border-white/70 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:pb-4">
                    <div className="text-xs font-semibold leading-relaxed text-slate-500">
                        提示：
                        <span className="ml-1 text-cyan-700">用我的值</span>
                        会强制覆盖服务端；
                        <span className="ml-1 text-blue-700">用服务端值</span>
                        会丢弃本次本地改动；
                        <span className="ml-1 text-slate-700">跳过</span>
                        保留为待解决（不写库，本地数据不变）
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                        <button
                            onClick={onClose}
                            disabled={isApplying}
                            className="liquid-elevated-field liquid-pressable rounded-full px-5 py-2.5 font-black text-slate-700 hover:bg-white disabled:opacity-50 sm:py-2"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleApply}
                            disabled={isApplying}
                            className="liquid-action-strong liquid-pressable rounded-full px-5 py-2.5 font-black shadow disabled:opacity-50 sm:py-2"
                        >
                            {isApplying ? '正在应用…' : '应用决策'}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
};
