import React, { useMemo, useState } from 'react';
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

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                            <AlertCircle size={20} className="text-amber-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-800">
                                数据冲突（{conflicts.length} 条）
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                                您编辑的记录在保存前已被他人更新，请逐条选择处理方式
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100"
                        aria-label="关闭"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="px-6 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div className="text-xs text-slate-600">
                        当前选择：
                        <span className="ml-2 inline-flex items-center gap-1 text-emerald-700">
                            用我的 {counts.mine}
                        </span>
                        <span className="ml-3 inline-flex items-center gap-1 text-blue-700">
                            用服务端 {counts.theirs}
                        </span>
                        <span className="ml-3 inline-flex items-center gap-1 text-slate-500">
                            跳过 {counts.skip}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setAllAction('theirs')}
                            className="px-3 py-1.5 text-xs rounded border border-blue-200 text-blue-700 hover:bg-blue-50"
                        >
                            全部用服务端
                        </button>
                        <button
                            onClick={() => setAllAction('mine')}
                            className="px-3 py-1.5 text-xs rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        >
                            全部用我的
                        </button>
                        <button
                            onClick={() => setAllAction('skip')}
                            className="px-3 py-1.5 text-xs rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                        >
                            全部跳过
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    {items.map((it) => (
                        <div
                            key={it.key}
                            className="border border-slate-200 rounded-xl overflow-hidden"
                        >
                            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-medium">
                                        {it.label}
                                    </span>
                                    <span className="font-bold text-slate-800">{it.name}</span>
                                    <span className="text-xs text-slate-400">
                                        ({it.conflict.op === 'delete' ? '删除' : '更新'})
                                    </span>
                                </div>
                                <div className="text-[11px] text-slate-400">
                                    本地基准：{it.conflict.baseUpdated || '—'} ／ 服务端最新：
                                    {it.conflict.serverUpdated || '—'}
                                </div>
                            </div>

                            <table className="w-full text-sm">
                                <thead className="bg-white text-slate-500 text-xs">
                                    <tr>
                                        <th className="text-left px-4 py-2 w-1/4">字段</th>
                                        <th className="text-left px-4 py-2 w-1/3">我的值（本地）</th>
                                        <th className="text-left px-4 py-2 w-1/3">服务端最新值</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {it.diffs.map((d, idx) => (
                                        <tr key={idx} className="border-t border-slate-100">
                                            <td className="px-4 py-2 font-mono text-xs text-slate-600">
                                                {d.field}
                                            </td>
                                            <td className="px-4 py-2 text-emerald-700 font-medium break-all">
                                                {formatValue(d.localValue)}
                                            </td>
                                            <td className="px-4 py-2 text-blue-700 font-medium break-all">
                                                {formatValue(d.serverValue)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div className="px-4 py-3 bg-white border-t border-slate-100 flex gap-2 justify-end">
                                <button
                                    onClick={() => setAction(it.key, 'theirs')}
                                    className={`px-3 py-1.5 text-xs rounded border transition ${
                                        it.action === 'theirs'
                                            ? 'border-blue-500 bg-blue-50 text-blue-700 font-bold'
                                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                >
                                    用服务端值
                                </button>
                                <button
                                    onClick={() => setAction(it.key, 'mine')}
                                    className={`px-3 py-1.5 text-xs rounded border transition ${
                                        it.action === 'mine'
                                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-bold'
                                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                >
                                    用我的值
                                </button>
                                <button
                                    onClick={() => setAction(it.key, 'skip')}
                                    className={`px-3 py-1.5 text-xs rounded border transition ${
                                        it.action === 'skip'
                                            ? 'border-slate-400 bg-slate-100 text-slate-700 font-bold'
                                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                >
                                    跳过此条
                                </button>
                            </div>
                        </div>
                    ))}
                    {items.length === 0 && (
                        <div className="text-center text-slate-400 py-12">
                            <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-400" />
                            没有冲突
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center bg-slate-50">
                    <div className="text-xs text-slate-500">
                        提示：
                        <span className="ml-1 text-emerald-700">用我的值</span>
                        会强制覆盖服务端；
                        <span className="ml-1 text-blue-700">用服务端值</span>
                        会丢弃本次本地改动；
                        <span className="ml-1 text-slate-700">跳过</span>
                        保留为待解决（不写库，本地数据不变）
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            disabled={isApplying}
                            className="px-5 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-white disabled:opacity-50"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleApply}
                            disabled={isApplying}
                            className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow disabled:opacity-50"
                        >
                            {isApplying ? '正在应用…' : '应用决策'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
