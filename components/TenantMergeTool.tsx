import React, { useMemo, useState } from 'react';
import { AlertCircle, Link2, Trash2, X } from 'lucide-react';
import type { DashboardData, Tenant } from '../types';
import {
    findImportedRowByKey,
    importedBudgetRowKey,
    listImportedBudgetYears,
    readBudgetCustomerNameLinks,
    readImportedBudgetTable,
    writeBudgetCustomerNameLinks,
} from '../services/budgetTableImport';

export interface TenantBudgetNameLinkToolProps {
    tenants: Tenant[];
    billingPeriodNotes?: Record<string, string>;
    onBatchUpdate?: (updates: Partial<DashboardData>) => void;
}

type MergePromptTone = 'blue' | 'amber' | 'rose' | 'slate';

type MergePromptState = {
    kind: 'notice' | 'confirm';
    title: string;
    message?: string;
    tone?: MergePromptTone;
    confirmText?: string;
    cancelText?: string;
    resolve?: (result?: boolean) => void;
};

function formatLinkRowLabel(customer: string, unit: string, building: string): string {
    const u = (unit || '—').trim() || '—';
    const b = (building || '—').trim() || '—';
    return `${(customer || '（无名称）').trim()} · ${u} · ${b}`;
}

function mergePromptToneClass(tone: MergePromptTone = 'blue'): string {
    switch (tone) {
        case 'amber':
            return 'border-amber-200/80 bg-amber-50/82 text-amber-900';
        case 'rose':
            return 'border-rose-200/80 bg-rose-50/82 text-rose-800';
        case 'slate':
            return 'border-slate-200/80 bg-white/82 text-slate-700';
        default:
            return 'border-blue-200/80 bg-blue-50/78 text-blue-800';
    }
}

const MergePromptOverlay: React.FC<{
    prompt: MergePromptState;
    onClose: (result?: boolean) => void;
}> = ({ prompt, onClose }) => {
    const toneClass = mergePromptToneClass(prompt.tone || 'blue');
    return (
        <div className="liquid-elevated-backdrop fixed inset-0 z-[95] flex items-end justify-center p-0 md:items-center md:p-4">
            <section
                role="dialog"
                aria-modal="true"
                aria-label={prompt.title}
                className="liquid-elevated-panel flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] md:rounded-[28px]"
            >
                <div className="liquid-elevated-header flex items-start justify-between gap-3 border-b border-white/60 px-5 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <span className={`liquid-glass-readable inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${toneClass}`}>
                            <AlertCircle size={18} />
                        </span>
                        <div className="min-w-0">
                            <h3 className="text-base font-black text-slate-950">{prompt.title}</h3>
                            <p className="mt-0.5 text-xs font-semibold text-slate-500">
                                {prompt.kind === 'confirm' ? '请确认后继续' : '名称关联提示'}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => onClose(prompt.kind === 'confirm' ? false : true)}
                        className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:text-slate-900"
                        aria-label="关闭提示"
                    >
                        <X size={18} />
                    </button>
                </div>
                {prompt.message ? (
                    <div className="px-5 py-4">
                        <div className={`liquid-glass-readable max-h-[50vh] overflow-auto whitespace-pre-line rounded-2xl border px-4 py-3 text-sm font-semibold leading-relaxed ${toneClass}`}>
                            {prompt.message}
                        </div>
                    </div>
                ) : null}
                <div className="liquid-elevated-footer grid grid-cols-2 gap-2 border-t border-white/60 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:flex md:justify-end md:pb-4">
                    {prompt.kind === 'confirm' ? (
                        <button
                            type="button"
                            onClick={() => onClose(false)}
                            className="liquid-glass-control liquid-pressable inline-flex min-h-10 items-center justify-center rounded-full px-4 py-2 text-sm font-black text-slate-600"
                        >
                            {prompt.cancelText || '取消'}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => onClose(true)}
                        className={`${prompt.kind === 'confirm' ? '' : 'col-span-2 '}liquid-action-strong liquid-pressable inline-flex min-h-10 items-center justify-center rounded-full px-5 py-2 text-sm font-black text-white`}
                    >
                        {prompt.confirmText || (prompt.kind === 'confirm' ? '确认' : '知道了')}
                    </button>
                </div>
            </section>
        </div>
    );
};

export function TenantBudgetNameLinkTool({
    tenants,
    billingPeriodNotes,
    onBatchUpdate,
}: TenantBudgetNameLinkToolProps) {
    const yearsWithImport = useMemo(
        () => listImportedBudgetYears(billingPeriodNotes),
        [billingPeriodNotes]
    );
    const defaultYear = yearsWithImport.length ? yearsWithImport[yearsWithImport.length - 1] : new Date().getFullYear();
    const [year, setYear] = useState(defaultYear);

    React.useEffect(() => {
        if (yearsWithImport.length && !yearsWithImport.includes(year)) {
            setYear(yearsWithImport[yearsWithImport.length - 1]);
        }
    }, [yearsWithImport, year]);

    const importedSnapshot = useMemo(
        () => readImportedBudgetTable(billingPeriodNotes, year),
        [billingPeriodNotes, year]
    );

    const links = useMemo(
        () => readBudgetCustomerNameLinks(billingPeriodNotes, year),
        [billingPeriodNotes, year]
    );

    const [importKey, setImportKey] = useState('');
    const [tenantId, setTenantId] = useState('');
    const [keyword, setKeyword] = useState('');
    const [mergePrompt, setMergePrompt] = useState<MergePromptState | null>(null);

    const showMergeNotice = React.useCallback((prompt: Omit<MergePromptState, 'kind' | 'resolve'>) => (
        new Promise<void>((resolve) => {
            setMergePrompt({
                kind: 'notice',
                confirmText: '知道了',
                tone: 'blue',
                ...prompt,
                resolve: () => resolve(),
            });
        })
    ), []);

    const showMergeConfirm = React.useCallback((prompt: Omit<MergePromptState, 'kind' | 'resolve'>) => (
        new Promise<boolean>((resolve) => {
            setMergePrompt({
                kind: 'confirm',
                confirmText: '确认',
                cancelText: '取消',
                tone: 'amber',
                ...prompt,
                resolve: (result) => resolve(result === true),
            });
        })
    ), []);

    const closeMergePrompt = React.useCallback((result?: boolean) => {
        setMergePrompt((current) => {
            current?.resolve?.(result);
            return null;
        });
    }, []);

    const importRowOptions = useMemo(() => {
        const rows = importedSnapshot?.rows || [];
        const seen = new Set<string>();
        const out: { key: string; label: string }[] = [];
        for (const r of rows) {
            const key = importedBudgetRowKey(r.customer, r.unit, r.building);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push({ key, label: formatLinkRowLabel(r.customer, r.unit, r.building) });
        }
        return out.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
    }, [importedSnapshot]);

    const sortedTenants = useMemo(
        () => [...tenants].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN')),
        [tenants]
    );

    const selectedTenant = tenants.find((t) => t.id === tenantId) ?? null;

    const candidates = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return sortedTenants
            .filter((t) => {
                if (!kw) return true;
                const hay = `${t.name || ''} ${t.id}`.toLowerCase();
                return hay.includes(kw);
            })
            .slice(0, 80);
    }, [sortedTenants, keyword]);

    const linksWithLabels = useMemo(() => {
        return links.map((link) => {
            const row = findImportedRowByKey(importedSnapshot, link.importKey);
            const tenant = tenants.find((t) => t.id === link.tenantId);
            return {
                ...link,
                importLabel: row
                    ? formatLinkRowLabel(row.customer, row.unit, row.building)
                    : link.importKey,
                tenantName: tenant?.name || link.tenantId,
            };
        });
    }, [links, importedSnapshot, tenants]);

    const persistLinks = async (nextLinks: typeof links): Promise<boolean> => {
        if (!onBatchUpdate) {
            await showMergeNotice({
                title: '无法写入关联',
                message: '当前环境不支持批量保存，无法写入关联。',
                tone: 'rose',
            });
            return false;
        }
        onBatchUpdate({
            billingPeriodNotes: writeBudgetCustomerNameLinks(billingPeriodNotes, year, nextLinks),
        });
        return true;
    };

    const handleAddLink = async () => {
        if (!importKey || !tenantId) return;
        if (!importedSnapshot?.rows?.length) {
            await showMergeNotice({
                title: '暂无预算表',
                message: '当前年度没有已导入的预算表，请先在「预算管理」导入预算表。',
                tone: 'amber',
            });
            return;
        }
        if (!findImportedRowByKey(importedSnapshot, importKey)) {
            await showMergeNotice({
                title: '预算行不存在',
                message: '所选预算行已不存在（可能已重新导入），请重新选择。',
                tone: 'amber',
            });
            return;
        }
        const tenant = tenants.find((t) => t.id === tenantId);
        if (!tenant) return;

        const dupImport = links.find((l) => l.importKey === importKey && l.tenantId !== tenantId);
        if (dupImport) {
            await showMergeNotice({
                title: '预算行已有关联',
                message: '该预算表行已关联到其他合同客户，请先解除原关联。',
                tone: 'amber',
            });
            return;
        }
        const dupTenant = links.find((l) => l.tenantId === tenantId && l.importKey !== importKey);
        if (dupTenant) {
            await showMergeNotice({
                title: '合同客户已有关联',
                message: '该合同客户在本年度已有关联的预算行，请先解除原关联再绑定新行。',
                tone: 'amber',
            });
            return;
        }

        const exists = links.some((l) => l.importKey === importKey && l.tenantId === tenantId);
        const next = exists ? links : [...links, { importKey, tenantId }];
        const persisted = await persistLinks(next);
        if (!persisted) return;
        const linkedRow = findImportedRowByKey(importedSnapshot, importKey);
        setImportKey('');
        setTenantId('');
        setKeyword('');
        await showMergeNotice({
            title: '关联已保存',
            message: `预算表「${formatLinkRowLabel(
                linkedRow?.customer || '',
                linkedRow?.unit || '',
                linkedRow?.building || ''
            )}」\n→ 合同「${tenant.name}」`,
            tone: 'blue',
        });
    };

    const handleRemoveLink = async (importKeyToRemove: string, tenantIdToRemove: string) => {
        const confirmed = await showMergeConfirm({
            title: '移除名称关联',
            message: '确定移除此条名称关联？移除后不会删除合同、预算表或财务数据，只取消导入预算行与合同客户的映射。',
            tone: 'rose',
            confirmText: '移除',
        });
        if (!confirmed) return;
        await persistLinks(links.filter((l) => !(l.importKey === importKeyToRemove && l.tenantId === tenantIdToRemove)));
    };

    return (
        <div className="liquid-elevated-card overflow-hidden rounded-[28px] border border-white/70 bg-white/45 shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
            {mergePrompt && <MergePromptOverlay prompt={mergePrompt} onClose={closeMergePrompt} />}
            <div className="flex flex-col gap-3 border-b border-white/60 p-4 sm:flex-row sm:items-start md:p-6">
                <div className="liquid-icon-well flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-blue-700">
                    <Link2 size={22} />
                </div>
                <div className="min-w-0">
                    <h3 className="font-black text-slate-950">客户名称关联（预算导入 ↔ 合同）</h3>
                    <p className="mt-1 text-sm font-medium leading-relaxed text-slate-600">
                        预算表按「客户名称 + 房号 + 楼宇」与合同行自动对齐；若客户改名导致对不上，在此把<strong>导入表中的那一行</strong>绑定到<strong>合同中心要保留的客户</strong>即可。不删除、不迁移收款/发票数据，避免合并带来的错乱；绑定后「预算表 / 执行跟踪」与首页导入预算口径会按关联取数。
                    </p>
                </div>
            </div>

            <div className="space-y-4 p-4 text-sm text-slate-700 md:p-6">
                <div className="liquid-glass-readable rounded-2xl border border-blue-100/80 p-3 text-xs text-slate-700">
                    <div className="mb-1 inline-flex items-center gap-1.5 font-black text-blue-800">
                        <AlertCircle size={14} /> 与旧版「客户数据合并」的区别
                    </div>
                    <p className="font-medium leading-relaxed text-slate-600">
                        合并会删除一条客户并迁移流水，容易误操作。名称关联仅建立「导入预算行 → 合同客户」的映射，合同与财务数据保持独立；存量预算假设 / 调整里若仍引用旧客户 ID，请在预算管理中按需改绑。
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                        <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">预算年度</label>
                        <select
                            value={year}
                            onChange={(e) => {
                                setYear(Number(e.target.value));
                                setImportKey('');
                                setTenantId('');
                                setKeyword('');
                            }}
                            className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none focus-visible:ring-4 focus-visible:ring-blue-500/10"
                        >
                            {yearsWithImport.length === 0 ? (
                                <option value={defaultYear}>{defaultYear}（尚未导入预算表）</option>
                            ) : (
                                yearsWithImport.map((y) => (
                                    <option key={y} value={y}>
                                        {y} 年（已导入预算表）
                                    </option>
                                ))
                            )}
                        </select>
                    </div>
                </div>

                {!importedSnapshot?.rows?.length ? (
                    <div className="liquid-glass-readable rounded-2xl border border-dashed border-blue-200/80 p-5 text-center text-xs font-semibold text-slate-500">
                        <div className="liquid-icon-well mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl text-blue-700">
                            <Link2 size={18} />
                        </div>
                        <p className="leading-relaxed">
                            {yearsWithImport.length === 0
                                ? '请先在「预算管理」导入对应年度的预算表 Excel，再回到此处配置关联。'
                                : `${year} 年暂无已存档的导入预算表。`}
                        </p>
                    </div>
                ) : (
                    <>
                        <div>
                            <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
                                预算表中的客户行（导入文件里的名称）
                            </label>
                            <select
                                value={importKey}
                                onChange={(e) => {
                                    setImportKey(e.target.value);
                                    setTenantId('');
                                    setKeyword('');
                                }}
                                className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none focus-visible:ring-4 focus-visible:ring-blue-500/10"
                            >
                                <option value="">请选择一行（通常为 Excel 中的旧名称或与合同不一致的写法）…</option>
                                {importRowOptions.map((opt) => (
                                    <option key={opt.key} value={opt.key}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {importKey && (
                            <div className="liquid-glass-readable overflow-hidden rounded-3xl border border-white/70">
                                <div className="border-b border-white/60 px-3 pt-3 pb-2">
                                    <div className="mb-2 text-xs font-black uppercase tracking-wide text-blue-700">
                                        合同客户（当前要与之对齐的一条）
                                    </div>
                                    {selectedTenant ? (
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="break-words font-black text-slate-950">{selectedTenant.name}</div>
                                                <div className="mt-0.5 text-xs font-semibold text-slate-500">
                                                    ID <span className="break-all font-mono">{selectedTenant.id}</span>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setTenantId('')}
                                                className="liquid-glass-control liquid-pressable shrink-0 self-start rounded-full px-3 py-1.5 text-xs font-black text-blue-700 hover:bg-blue-50/70 sm:self-auto"
                                            >
                                                重选
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <input
                                                type="search"
                                                value={keyword}
                                                onChange={(e) => setKeyword(e.target.value)}
                                                placeholder="搜索合同客户名称…"
                                                className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-500 focus-visible:ring-4 focus-visible:ring-blue-500/10"
                                            />
                                            <div className="liquid-glass-readable mt-2 max-h-[240px] overflow-y-auto rounded-2xl border border-white/70 shadow-inner divide-y divide-white/60">
                                                {candidates.length === 0 ? (
                                                    <div className="p-4 text-center text-xs font-semibold text-slate-500">无匹配</div>
                                                ) : (
                                                    candidates.map((t) => (
                                                        <button
                                                            key={t.id}
                                                            type="button"
                                                            onClick={() => setTenantId(t.id)}
                                                            className="liquid-pressable flex w-full flex-col gap-1 px-3 py-3 text-left text-sm transition hover:bg-blue-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 sm:flex-row sm:items-center sm:justify-between"
                                                        >
                                                            <span className="min-w-0 break-words font-bold text-slate-900">{t.name}</span>
                                                            <span className="font-mono text-xs font-semibold text-slate-500 sm:ml-2">{t.id}</span>
                                                        </button>
                                                    ))
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 pt-1 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
                            <button
                                type="button"
                                onClick={() => {
                                    setImportKey('');
                                    setTenantId('');
                                    setKeyword('');
                                }}
                                className="liquid-glass-control liquid-pressable inline-flex min-h-11 items-center justify-center gap-1 rounded-2xl px-3.5 py-2.5 text-sm font-bold text-slate-600 hover:bg-white/80"
                            >
                                <X size={16} /> 清空
                            </button>
                            <button
                                type="button"
                                disabled={!importKey || !tenantId || !onBatchUpdate}
                                onClick={handleAddLink}
                                className="liquid-action-strong liquid-pressable min-h-11 rounded-2xl px-5 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                保存关联
                            </button>
                        </div>
                    </>
                )}

                {linksWithLabels.length > 0 && (
                    <div className="liquid-glass-readable overflow-hidden rounded-3xl border border-white/70">
                        <div className="liquid-glass-toolbar border-b border-white/70 px-3 py-2 text-xs font-black text-slate-700">
                            {year} 年已保存的关联（{linksWithLabels.length}）
                        </div>
                        <ul className="max-h-[320px] overflow-y-auto divide-y divide-white/60">
                            {linksWithLabels.map((item) => (
                                <li
                                    key={`${item.importKey}|${item.tenantId}`}
                                    className="liquid-pressable flex items-start gap-2 px-3 py-3 text-xs transition-colors hover:bg-blue-50/45"
                                >
                                    <div className="min-w-0 flex-1 space-y-2">
                                        <div className="liquid-glass-subtle rounded-2xl px-3 py-2">
                                            <div className="text-xs font-black uppercase tracking-wide text-slate-500">预算行</div>
                                            <div className="mt-0.5 break-words font-bold text-slate-800">{item.importLabel}</div>
                                        </div>
                                        <div className="liquid-glass-subtle rounded-2xl px-3 py-2">
                                            <div className="text-xs font-black uppercase tracking-wide text-blue-700">合同</div>
                                            <div className="mt-0.5 break-words font-black text-blue-900">{item.tenantName}</div>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        title="移除关联"
                                        onClick={() => handleRemoveLink(item.importKey, item.tenantId)}
                                        className="liquid-glass-control liquid-pressable shrink-0 rounded-full p-2 text-rose-600 hover:bg-rose-50/80"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}
