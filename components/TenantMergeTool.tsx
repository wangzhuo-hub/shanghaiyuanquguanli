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

function formatLinkRowLabel(customer: string, unit: string, building: string): string {
    const u = (unit || '—').trim() || '—';
    const b = (building || '—').trim() || '—';
    return `${(customer || '（无名称）').trim()} · ${u} · ${b}`;
}

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

    const persistLinks = (nextLinks: typeof links) => {
        if (!onBatchUpdate) {
            alert('当前环境不支持批量保存，无法写入关联');
            return;
        }
        onBatchUpdate({
            billingPeriodNotes: writeBudgetCustomerNameLinks(billingPeriodNotes, year, nextLinks),
        });
    };

    const handleAddLink = () => {
        if (!importKey || !tenantId) return;
        if (!importedSnapshot?.rows?.length) {
            alert('当前年度没有已导入的预算表，请先在「预算管理」导入预算表。');
            return;
        }
        if (!findImportedRowByKey(importedSnapshot, importKey)) {
            alert('所选预算行已不存在（可能已重新导入），请重新选择。');
            return;
        }
        const tenant = tenants.find((t) => t.id === tenantId);
        if (!tenant) return;

        const dupImport = links.find((l) => l.importKey === importKey && l.tenantId !== tenantId);
        if (dupImport) {
            alert('该预算表行已关联到其他合同客户，请先解除原关联。');
            return;
        }
        const dupTenant = links.find((l) => l.tenantId === tenantId && l.importKey !== importKey);
        if (dupTenant) {
            alert('该合同客户在本年度已有关联的预算行，请先解除原关联再绑定新行。');
            return;
        }

        const exists = links.some((l) => l.importKey === importKey && l.tenantId === tenantId);
        const next = exists ? links : [...links, { importKey, tenantId }];
        persistLinks(next);
        const linkedRow = findImportedRowByKey(importedSnapshot, importKey);
        setImportKey('');
        setTenantId('');
        setKeyword('');
        alert(
            `已保存：预算表「${formatLinkRowLabel(
                linkedRow?.customer || '',
                linkedRow?.unit || '',
                linkedRow?.building || ''
            )}」→ 合同「${tenant.name}」`
        );
    };

    const handleRemoveLink = (importKeyToRemove: string, tenantIdToRemove: string) => {
        if (!confirm('确定移除此条名称关联？')) return;
        persistLinks(links.filter((l) => !(l.importKey === importKeyToRemove && l.tenantId === tenantIdToRemove)));
    };

    return (
        <div className="border-t border-slate-200 bg-indigo-50/15">
            <div className="p-4 md:p-6 border-b border-slate-200 flex items-start gap-3">
                <div className="p-2 bg-white rounded-lg text-indigo-600 shadow-sm border border-indigo-100 shrink-0">
                    <Link2 size={22} />
                </div>
                <div className="min-w-0">
                    <h3 className="font-bold text-slate-800">客户名称关联（预算导入 ↔ 合同）</h3>
                    <p className="text-sm text-slate-500 mt-1">
                        预算表按「客户名称 + 房号 + 楼宇」与合同行自动对齐；若客户改名导致对不上，在此把<strong>导入表中的那一行</strong>绑定到<strong>合同中心要保留的客户</strong>即可。不删除、不迁移收款/发票数据，避免合并带来的错乱；绑定后「预算表 / 执行跟踪」与首页导入预算口径会按关联取数。
                    </p>
                </div>
            </div>

            <div className="p-4 md:p-6 space-y-4 text-sm text-slate-700">
                <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-xs text-sky-950">
                    <div className="font-bold mb-1 inline-flex items-center gap-1.5">
                        <AlertCircle size={14} /> 与旧版「客户数据合并」的区别
                    </div>
                    <p className="leading-relaxed text-sky-900/90">
                        合并会删除一条客户并迁移流水，容易误操作。名称关联仅建立「导入预算行 → 合同客户」的映射，合同与财务数据保持独立；存量预算假设 / 调整里若仍引用旧客户 ID，请在预算管理中按需改绑。
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-[10px] text-slate-500 font-bold uppercase mb-1">预算年度</label>
                        <select
                            value={year}
                            onChange={(e) => {
                                setYear(Number(e.target.value));
                                setImportKey('');
                                setTenantId('');
                                setKeyword('');
                            }}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
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
                    <div className="text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg p-4 text-center">
                        {yearsWithImport.length === 0
                            ? '请先在「预算管理」导入对应年度的预算表 Excel，再回到此处配置关联。'
                            : `${year} 年暂无已存档的导入预算表。`}
                    </div>
                ) : (
                    <>
                        <div>
                            <label className="block text-[10px] text-slate-500 font-bold uppercase mb-1">
                                预算表中的客户行（导入文件里的名称）
                            </label>
                            <select
                                value={importKey}
                                onChange={(e) => {
                                    setImportKey(e.target.value);
                                    setTenantId('');
                                    setKeyword('');
                                }}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
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
                            <div className="border border-slate-200 rounded-xl">
                                <div className="px-3 pt-3 pb-2 border-b border-slate-100">
                                    <div className="text-[10px] text-emerald-700 font-bold uppercase mb-2">
                                        合同客户（当前要与之对齐的一条）
                                    </div>
                                    {selectedTenant ? (
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <div className="font-semibold text-slate-800">{selectedTenant.name}</div>
                                                <div className="text-[11px] text-slate-500 mt-0.5">
                                                    ID <span className="font-mono">{selectedTenant.id}</span>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setTenantId('')}
                                                className="text-[11px] text-emerald-700 hover:underline shrink-0"
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
                                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                                            />
                                            <div className="max-h-[220px] overflow-y-auto divide-y divide-slate-100 mt-2 rounded-lg border border-slate-100">
                                                {candidates.length === 0 ? (
                                                    <div className="p-4 text-center text-slate-400 text-xs">无匹配</div>
                                                ) : (
                                                    candidates.map((t) => (
                                                        <button
                                                            key={t.id}
                                                            type="button"
                                                            onClick={() => setTenantId(t.id)}
                                                            className="w-full text-left px-3 py-2 hover:bg-emerald-50/60 text-sm"
                                                        >
                                                            <span className="font-medium text-slate-800">{t.name}</span>
                                                            <span className="text-[11px] text-slate-400 ml-2 font-mono">{t.id}</span>
                                                        </button>
                                                    ))
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 justify-end pt-1">
                            <button
                                type="button"
                                onClick={() => {
                                    setImportKey('');
                                    setTenantId('');
                                    setKeyword('');
                                }}
                                className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-white text-sm inline-flex items-center gap-1"
                            >
                                <X size={16} /> 清空
                            </button>
                            <button
                                type="button"
                                disabled={!importKey || !tenantId || !onBatchUpdate}
                                onClick={handleAddLink}
                                className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                保存关联
                            </button>
                        </div>
                    </>
                )}

                {linksWithLabels.length > 0 && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                            {year} 年已保存的关联（{linksWithLabels.length}）
                        </div>
                        <ul className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
                            {linksWithLabels.map((item) => (
                                <li
                                    key={`${item.importKey}|${item.tenantId}`}
                                    className="px-3 py-2 flex items-start gap-2 text-xs"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="text-slate-800 break-words">
                                            <span className="text-slate-500">预算行</span> {item.importLabel}
                                        </div>
                                        <div className="text-emerald-800 mt-0.5 break-words">
                                            <span className="text-slate-500">→ 合同</span> {item.tenantName}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        title="移除关联"
                                        onClick={() => handleRemoveLink(item.importKey, item.tenantId)}
                                        className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 shrink-0"
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
