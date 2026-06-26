import React, { useEffect, useRef, useState } from 'react';
import { Check, Filter, Search, X } from 'lucide-react';
import type {
    MobileTenantSearchArrearsFilter,
    MobileTenantSearchPaymentFilter,
    MobileTenantSearchReceivableFilter,
    MobileTenantSearchResult,
} from '../services/mobileTenantSearch';
import { useMobileSheetFocus } from './useMobileSheetFocus';

export type MobileSearchFilter = 'all' | 'active' | 'expiring' | 'pending';
export type MobileSearchBuildingOption = { id: string; name: string };
export type MobileSearchExpiryMonthOption = { key: string; label: string; count: number };

type FilterOption<T extends string> = {
    key: T;
    label: string;
    helper?: string;
};

const mobileSearchFilterOptions: Array<FilterOption<MobileSearchFilter>> = [
    { key: 'all', label: '全部' },
    { key: 'active', label: '履约中' },
    { key: 'expiring', label: '即将到期' },
    { key: 'pending', label: '签约中' },
];

const mobilePaymentFilterOptions: Array<FilterOption<MobileTenantSearchPaymentFilter>> = [
    { key: 'all', label: '全部客户', helper: '不按收款记录过滤' },
    { key: 'paid', label: '有收款记录', helper: '已匹配到已收流水' },
    { key: 'none', label: '暂无收款记录', helper: '便于催收与核对' },
];

const mobileReceivableFilterOptions: Array<FilterOption<MobileTenantSearchReceivableFilter>> = [
    { key: 'all', label: '全部客户', helper: '不按当前账期过滤' },
    { key: 'due', label: '当前账期未收', helper: '本账期应收大于已收' },
    { key: 'clear', label: '当前账期无未收', helper: '本账期暂无待收余额' },
];

const mobileArrearsFilterOptions: Array<FilterOption<MobileTenantSearchArrearsFilter>> = [
    { key: 'all', label: '全部客户', helper: '不按历史欠费过滤' },
    { key: 'historical_due', label: '有历史欠费', helper: '按封账/历史应收口径' },
    { key: 'historical_clear', label: '无历史欠费', helper: '截至上月无历史欠费' },
];

export type MobileTenantSearchPanelProps = {
    projectId?: string;
    parkName: string;
    isManagerView: boolean;
    searchQuery: string;
    searchFilter: MobileSearchFilter;
    searchBuildingFilter: string;
    searchExpiryMonthFilter: string;
    searchPaymentFilter: MobileTenantSearchPaymentFilter;
    searchReceivableFilter: MobileTenantSearchReceivableFilter;
    searchArrearsFilter: MobileTenantSearchArrearsFilter;
    searchArrearsAvailable: boolean;
    searchArrearsUnavailableReason?: string;
    searchAdvancedActiveCount: number;
    searchBuildingOptions: MobileSearchBuildingOption[];
    searchExpiryMonthOptions: MobileSearchExpiryMonthOption[];
    searchResults: MobileTenantSearchResult[];
    searchResultCount: number;
    canCollapseSearchResults: boolean;
    onLoadMoreSearchResults: () => void;
    onCollapseSearchResults: () => void;
    onSearchQueryChange: (value: string) => void;
    onSearchFilterChange: (value: MobileSearchFilter) => void;
    onSearchBuildingFilterChange: (value: string) => void;
    onSearchExpiryMonthFilterChange: (value: string) => void;
    onSearchPaymentFilterChange: (value: MobileTenantSearchPaymentFilter) => void;
    onSearchReceivableFilterChange: (value: MobileTenantSearchReceivableFilter) => void;
    onSearchArrearsFilterChange: (value: MobileTenantSearchArrearsFilter) => void;
    onClearSearchFilters: () => void;
    onGoContracts: (item?: MobileTenantSearchResult) => void;
    onGoFinance: (item?: MobileTenantSearchResult) => void;
    onBackToOverview: () => void;
};

export const MobileTenantSearchPanel: React.FC<MobileTenantSearchPanelProps> = ({
    projectId,
    parkName,
    isManagerView,
    searchQuery,
    searchFilter,
    searchBuildingFilter,
    searchExpiryMonthFilter,
    searchPaymentFilter,
    searchReceivableFilter,
    searchArrearsFilter,
    searchArrearsAvailable,
    searchArrearsUnavailableReason,
    searchAdvancedActiveCount,
    searchBuildingOptions,
    searchExpiryMonthOptions,
    searchResults,
    searchResultCount,
    canCollapseSearchResults,
    onLoadMoreSearchResults,
    onCollapseSearchResults,
    onSearchQueryChange,
    onSearchFilterChange,
    onSearchBuildingFilterChange,
    onSearchExpiryMonthFilterChange,
    onSearchPaymentFilterChange,
    onSearchReceivableFilterChange,
    onSearchArrearsFilterChange,
    onClearSearchFilters,
    onGoContracts,
    onGoFinance,
    onBackToOverview,
}) => {
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const [isSearchFilterSheetOpen, setSearchFilterSheetOpen] = useState(false);
    const hasHiddenSearchResults = searchResultCount > searchResults.length;
    const selectedBuildingName =
        searchBuildingFilter === 'all'
            ? '全部楼栋'
            : searchBuildingOptions.find((option) => option.id === searchBuildingFilter)?.name || '当前楼栋';
    const selectedExpiryMonthLabel =
        searchExpiryMonthFilter === 'all'
            ? '全部月份'
            : searchExpiryMonthOptions.find((option) => option.key === searchExpiryMonthFilter)?.label || searchExpiryMonthFilter;
    const selectedPaymentLabel =
        mobilePaymentFilterOptions.find((option) => option.key === searchPaymentFilter)?.label || '全部客户';
    const selectedReceivableLabel =
        mobileReceivableFilterOptions.find((option) => option.key === searchReceivableFilter)?.label || '全部客户';
    const selectedArrearsLabel =
        mobileArrearsFilterOptions.find((option) => option.key === searchArrearsFilter)?.label || '全部客户';
    const activeSearchFilterLabels = [
        searchBuildingFilter !== 'all' ? selectedBuildingName : null,
        searchExpiryMonthFilter !== 'all' ? selectedExpiryMonthLabel : null,
        searchPaymentFilter !== 'all' ? selectedPaymentLabel : null,
        searchReceivableFilter !== 'all' ? selectedReceivableLabel : null,
        searchArrearsFilter !== 'all' ? selectedArrearsLabel : null,
    ].filter(Boolean).join(' · ');
    const hasSearchFilters = searchFilter !== 'all' || searchQuery.trim() || searchAdvancedActiveCount > 0;
    const closeSearchFilterSheet = React.useCallback(() => setSearchFilterSheetOpen(false), []);
    const {
        triggerRef: filterButtonRef,
        initialFocusRef: filterCloseButtonRef,
        sheetRef: filterSheetRef,
    } = useMobileSheetFocus<HTMLButtonElement, HTMLButtonElement, HTMLElement>({
        isOpen: isSearchFilterSheetOpen,
        onEscape: closeSearchFilterSheet,
    });

    useEffect(() => {
        const focusTimer = window.setTimeout(() => searchInputRef.current?.focus(), 80);
        return () => window.clearTimeout(focusTimer);
    }, []);

    return (
        <section className="liquid-mobile-card mobile-card-enter lg:hidden overflow-hidden rounded-[24px]">
            <div className="liquid-mobile-hero px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-black text-slate-950">{isManagerView ? '客户收款查询' : '快速查询'}</div>
                        <div className="mt-0.5 text-xs font-semibold text-slate-500">{parkName || projectId || '当前园区'}</div>
                    </div>
                    <button
                        type="button"
                        onClick={onBackToOverview}
                        className="liquid-mobile-control mobile-pressable inline-flex min-h-11 items-center rounded-full px-4 py-2 text-xs font-black text-blue-700"
                    >
                        指标
                    </button>
                </div>
                <label className="liquid-mobile-readable mt-2.5 flex items-center gap-2 rounded-xl px-3 py-2 text-slate-900">
                    <Search size={16} className="shrink-0 text-slate-500" />
                    <input
                        type="search"
                        enterKeyHint="search"
                        aria-label={isManagerView ? '搜索客户、收款、房号' : '搜索客户、联系人、房号'}
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={(event) => onSearchQueryChange(event.target.value)}
                        placeholder={isManagerView ? '搜客户、收款、房号' : '搜客户、联系人、房号'}
                        className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-500"
                    />
                </label>
                <div className="mt-2 flex items-center gap-2">
                    <div
                        className="liquid-mobile-search-chips min-w-0 flex flex-1 gap-1.5 overflow-x-auto pb-0.5"
                        role="group"
                        aria-label="合同状态筛选"
                    >
                        {mobileSearchFilterOptions.map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                onClick={() => onSearchFilterChange(option.key)}
                                aria-pressed={searchFilter === option.key}
                                className={`liquid-mobile-search-chip mobile-pressable shrink-0 rounded-full px-3 py-1.5 text-xs font-black ${
                                    searchFilter === option.key ? 'liquid-mobile-search-chip-active' : ''
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        ref={filterButtonRef}
                        onClick={() => setSearchFilterSheetOpen(true)}
                        aria-label={searchAdvancedActiveCount > 0 ? `打开筛选，已启用 ${searchAdvancedActiveCount} 项高级筛选` : '打开筛选'}
                        aria-expanded={isSearchFilterSheetOpen}
                        aria-controls="mobile-tenant-filter-sheet"
                        className="liquid-mobile-filter-button mobile-pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black"
                    >
                        <Filter size={13} />
                        <span>筛选</span>
                        {searchAdvancedActiveCount > 0 && (
                            <span className="liquid-mobile-filter-count inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs">
                                {searchAdvancedActiveCount}
                            </span>
                        )}
                    </button>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                    <span className="min-w-0 truncate">
                        已筛 {searchResultCount} 条
                        {activeSearchFilterLabels && ` · ${activeSearchFilterLabels}`}
                    </span>
                    {hasSearchFilters && (
                        <button
                            type="button"
                            onClick={onClearSearchFilters}
                            aria-label="清除当前查询筛选"
                            className="liquid-mobile-filter-clear mobile-pressable inline-flex min-h-11 items-center justify-center rounded-full px-2.5 py-1 text-xs font-black"
                        >
                            清除
                        </button>
                    )}
                </div>
            </div>
            {isSearchFilterSheetOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <button
                        type="button"
                        aria-label="关闭筛选"
                        className="liquid-mobile-filter-backdrop absolute inset-0"
                        onClick={closeSearchFilterSheet}
                    />
                    <section
                        id="mobile-tenant-filter-sheet"
                        ref={filterSheetRef}
                        className="liquid-mobile-filter-sheet absolute inset-x-3 top-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] overflow-y-auto rounded-[28px] p-4"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="mobile-tenant-filter-title"
                    >
                        <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                                <div id="mobile-tenant-filter-title" className="text-base font-black text-slate-950">筛选客户</div>
                                <div className="mt-0.5 text-xs font-semibold text-slate-500">楼栋、到期、收款、当前账期与历史欠费</div>
                            </div>
                            <button
                                type="button"
                                ref={filterCloseButtonRef}
                                onClick={closeSearchFilterSheet}
                                className="liquid-mobile-inline-action mobile-pressable inline-flex h-11 w-11 items-center justify-center rounded-full"
                                aria-label="关闭筛选"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <div id="mobile-tenant-filter-building-title" className="mb-2 text-xs font-black text-slate-500">楼栋</div>
                                <div
                                    className="liquid-mobile-filter-options max-h-44 space-y-1.5 overflow-y-auto rounded-[20px] p-1.5"
                                    role="group"
                                    aria-labelledby="mobile-tenant-filter-building-title"
                                >
	                                    <button
	                                        type="button"
	                                        onClick={() => onSearchBuildingFilterChange('all')}
	                                        aria-pressed={searchBuildingFilter === 'all'}
	                                        className={`liquid-mobile-filter-option mobile-pressable flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-black ${
	                                            searchBuildingFilter === 'all' ? 'liquid-mobile-filter-option-active' : ''
	                                        }`}
                                    >
                                        <span>全部楼栋</span>
                                        {searchBuildingFilter === 'all' && <Check size={15} />}
                                    </button>
                                    {searchBuildingOptions.map((option) => (
                                        <button
	                                            key={option.id}
	                                            type="button"
	                                            onClick={() => onSearchBuildingFilterChange(option.id)}
	                                            aria-pressed={searchBuildingFilter === option.id}
	                                            className={`liquid-mobile-filter-option mobile-pressable flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-black ${
	                                                searchBuildingFilter === option.id ? 'liquid-mobile-filter-option-active' : ''
	                                            }`}
                                        >
                                            <span className="min-w-0 truncate">{option.name}</span>
                                            {searchBuildingFilter === option.id && <Check size={15} className="shrink-0" />}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div id="mobile-tenant-filter-expiry-title" className="mb-2 text-xs font-black text-slate-500">到期月份</div>
                                <div
                                    className="liquid-mobile-filter-months -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5"
                                    role="group"
                                    aria-labelledby="mobile-tenant-filter-expiry-title"
                                >
	                                    <button
	                                        type="button"
	                                        onClick={() => onSearchExpiryMonthFilterChange('all')}
	                                        aria-pressed={searchExpiryMonthFilter === 'all'}
	                                        className={`liquid-mobile-filter-option mobile-pressable shrink-0 rounded-full px-3 py-2 text-xs font-black ${
	                                            searchExpiryMonthFilter === 'all' ? 'liquid-mobile-filter-option-active' : ''
	                                        }`}
                                    >
                                        全部月份
                                    </button>
                                    {searchExpiryMonthOptions.map((option) => (
                                        <button
	                                            key={option.key}
	                                            type="button"
	                                            onClick={() => onSearchExpiryMonthFilterChange(option.key)}
	                                            aria-pressed={searchExpiryMonthFilter === option.key}
	                                            className={`liquid-mobile-filter-option mobile-pressable shrink-0 rounded-full px-3 py-2 text-xs font-black ${
	                                                searchExpiryMonthFilter === option.key ? 'liquid-mobile-filter-option-active' : ''
	                                            }`}
                                        >
                                            {option.label}
                                            <span className="ml-1 font-black text-slate-500">{option.count}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div id="mobile-tenant-filter-payment-title" className="mb-2 text-xs font-black text-slate-500">收款记录</div>
                                <div
                                    className="grid gap-2"
                                    role="group"
                                    aria-labelledby="mobile-tenant-filter-payment-title"
                                >
                                    {mobilePaymentFilterOptions.map((option) => (
                                        <button
	                                            key={option.key}
	                                            type="button"
	                                            onClick={() => onSearchPaymentFilterChange(option.key)}
	                                            aria-pressed={searchPaymentFilter === option.key}
	                                            className={`liquid-mobile-filter-option mobile-pressable flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left ${
	                                                searchPaymentFilter === option.key ? 'liquid-mobile-filter-option-active' : ''
	                                            }`}
                                        >
                                            <span className="min-w-0">
                                                <span className="block text-sm font-black text-slate-950">{option.label}</span>
                                                <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{option.helper}</span>
                                            </span>
                                            {searchPaymentFilter === option.key && <Check size={15} className="shrink-0 text-blue-700" />}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div id="mobile-tenant-filter-receivable-title" className="mb-2 text-xs font-black text-slate-500">当前账期</div>
                                <div
                                    className="grid gap-2"
                                    role="group"
                                    aria-labelledby="mobile-tenant-filter-receivable-title"
                                >
                                    {mobileReceivableFilterOptions.map((option) => (
                                        <button
	                                            key={option.key}
	                                            type="button"
	                                            onClick={() => onSearchReceivableFilterChange(option.key)}
	                                            aria-pressed={searchReceivableFilter === option.key}
	                                            className={`liquid-mobile-filter-option mobile-pressable flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left ${
	                                                searchReceivableFilter === option.key ? 'liquid-mobile-filter-option-active' : ''
	                                            }`}
                                        >
                                            <span className="min-w-0">
                                                <span className="block text-sm font-black text-slate-950">{option.label}</span>
                                                <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{option.helper}</span>
                                            </span>
                                            {searchReceivableFilter === option.key && <Check size={15} className="shrink-0 text-blue-700" />}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div id="mobile-tenant-filter-arrears-title" className="mb-2 flex items-center justify-between gap-2 text-xs font-black text-slate-500">
                                    <span>历史欠费</span>
                                    {!searchArrearsAvailable && (
                                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700">需封账明细</span>
                                    )}
                                </div>
                                <div
                                    className="grid gap-2"
                                    role="group"
                                    aria-labelledby="mobile-tenant-filter-arrears-title"
                                >
                                    {mobileArrearsFilterOptions.map((option) => (
                                        <button
                                            key={option.key}
	                                            type="button"
	                                            onClick={() => searchArrearsAvailable && onSearchArrearsFilterChange(option.key)}
	                                            disabled={!searchArrearsAvailable}
	                                            aria-pressed={searchArrearsFilter === option.key}
	                                            className={`liquid-mobile-filter-option mobile-pressable flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left disabled:opacity-55 ${
	                                                searchArrearsFilter === option.key ? 'liquid-mobile-filter-option-active' : ''
	                                            }`}
                                        >
                                            <span className="min-w-0">
                                                <span className="block text-sm font-black text-slate-950">{option.label}</span>
                                                <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">
                                                    {searchArrearsAvailable ? option.helper : searchArrearsUnavailableReason || '当前数据缺少客户级历史欠费明细'}
                                                </span>
                                            </span>
                                            {searchArrearsFilter === option.key && searchArrearsAvailable && <Check size={15} className="shrink-0 text-blue-700" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={onClearSearchFilters}
                                className="liquid-mobile-inline-action mobile-pressable min-h-11 rounded-2xl px-3 text-sm font-black"
                            >
                                重置
                            </button>
                            <button
                                type="button"
                                onClick={closeSearchFilterSheet}
                                className="liquid-mobile-inline-action-strong mobile-pressable min-h-11 rounded-2xl px-3 text-sm font-black"
                            >
                                完成
                            </button>
                        </div>
                    </section>
                </div>
            )}
            <div className="divide-y divide-slate-100/80">
                {searchResults.length > 0 ? searchResults.map((item) => {
                    const itemSummary = isManagerView
                        ? (searchArrearsFilter !== 'all'
                            ? item.historicalArrearsSummary || '无历史欠费'
                            : searchReceivableFilter !== 'all'
                              ? item.receivableSummary || '当前账期无未收'
                              : item.paymentSummary || '暂无收款记录')
                        : item.helper;
                    const itemContext = `${item.name}，${item.location}，${item.statusLabel}，${itemSummary}`;
                    return (
                    <div
                        key={item.id}
                        className="mobile-card-enter flex items-center justify-between gap-3 px-3 py-3"
                        role="group"
                        aria-label={itemContext}
                        title={itemContext}
                    >
                        <div className="min-w-0">
                            <div className="truncate text-sm font-black text-slate-900" title={item.name}>{item.name}</div>
                            <div className="mt-0.5 truncate text-xs font-semibold text-slate-500" title={`${item.location} · ${item.statusLabel}`}>
                                {item.location} · {item.statusLabel}
                            </div>
                            <div
                                className={`mt-0.5 truncate text-xs ${isManagerView ? 'font-bold text-blue-600' : 'text-slate-500'}`}
                                title={itemSummary}
                            >
                                {itemSummary}
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <button
                                type="button"
                                onClick={() => onGoContracts(item)}
                                aria-label={`查看 ${item.name} 合同`}
                                className="liquid-mobile-inline-action mobile-pressable inline-flex min-h-11 items-center rounded-xl px-3 py-2 text-xs font-black"
                            >
                                合同
                            </button>
                            {!isManagerView && (
                                <button
                                    type="button"
                                    onClick={() => onGoFinance(item)}
                                    aria-label={`核销 ${item.name} 收款`}
                                    className="liquid-mobile-inline-action-strong mobile-pressable inline-flex min-h-11 items-center rounded-xl px-3 py-2 text-xs font-black"
                                >
                                    核销
                                </button>
                            )}
                        </div>
                    </div>
                    );
                }) : (
                    <div className="px-3 py-4">
                        <div className="liquid-mobile-empty-state rounded-[24px] px-4 py-6 text-center">
                            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[18px] bg-white/72 text-blue-700 shadow-sm shadow-blue-900/5">
                                <Search size={20} />
                            </div>
                            <div className="mt-3 text-sm font-black text-slate-950">
                                {hasSearchFilters ? '未找到匹配客户' : '暂无可查询客户'}
                            </div>
                            <div className="mx-auto mt-1 max-w-[18rem] text-xs font-semibold leading-relaxed text-slate-500">
                                {hasSearchFilters
                                    ? '当前关键词或筛选组合没有命中客户，可以清除条件后重新查看。'
                                    : '当前园区暂无可展示的客户记录，客户同步完成后会出现在这里。'}
                            </div>
                            <button
                                type="button"
                                onClick={hasSearchFilters ? onClearSearchFilters : onBackToOverview}
                                className="liquid-mobile-inline-action mobile-pressable mt-4 inline-flex min-h-11 items-center rounded-xl px-4 py-2 text-xs font-black"
                            >
                                {hasSearchFilters ? '清除筛选' : '回到指标'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
            {searchResults.length > 0 && (
                <div className="border-t border-white/70 px-3 py-3">
                    <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
                        <span aria-live="polite">已显示 {searchResults.length} / {searchResultCount} 条</span>
                        {hasHiddenSearchResults ? (
                            <button
                                type="button"
                                onClick={onLoadMoreSearchResults}
                                className="liquid-mobile-inline-action-strong mobile-pressable inline-flex min-h-11 items-center rounded-xl px-3 py-2 text-xs font-black"
                            >
                                显示更多
                            </button>
                        ) : canCollapseSearchResults ? (
                            <button
                                type="button"
                                onClick={onCollapseSearchResults}
                                className="liquid-mobile-inline-action mobile-pressable inline-flex min-h-11 items-center rounded-xl px-3 py-2 text-xs font-black"
                            >
                                收起结果
                            </button>
                        ) : null}
                    </div>
                </div>
            )}
        </section>
    );
};
