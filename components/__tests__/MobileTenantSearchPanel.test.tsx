import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MobileTenantSearchPanel } from '../MobileTenantSearchPanel';
import type { MobileTenantSearchResult } from '../../services/mobileTenantSearch';

const baseResults: MobileTenantSearchResult[] = [
    {
        id: 'tenant-1',
        name: '上海蓝湖科技有限公司',
        location: '1号楼 · 301',
        statusLabel: '在租',
        helper: '合同正常',
    },
    {
        id: 'tenant-2',
        name: '上海辰星智能有限公司',
        location: '2号楼 · 402',
        statusLabel: '在租',
        helper: '合同正常',
    },
];

const renderPanel = (overrides: Partial<React.ComponentProps<typeof MobileTenantSearchPanel>> = {}) =>
    renderToStaticMarkup(
        <MobileTenantSearchPanel
            projectId="shanghai"
            parkName="上海园区"
            isManagerView={false}
            searchQuery=""
            searchFilter="all"
            searchBuildingFilter="all"
            searchExpiryMonthFilter="all"
            searchPaymentFilter="all"
            searchReceivableFilter="all"
            searchArrearsFilter="all"
            searchArrearsAvailable={false}
            searchAdvancedActiveCount={0}
            searchBuildingOptions={[]}
            searchExpiryMonthOptions={[]}
            searchResults={baseResults}
            searchResultCount={5}
            canCollapseSearchResults={false}
            onLoadMoreSearchResults={() => undefined}
            onCollapseSearchResults={() => undefined}
            onSearchQueryChange={() => undefined}
            onSearchFilterChange={() => undefined}
            onSearchBuildingFilterChange={() => undefined}
            onSearchExpiryMonthFilterChange={() => undefined}
            onSearchPaymentFilterChange={() => undefined}
            onSearchReceivableFilterChange={() => undefined}
            onSearchArrearsFilterChange={() => undefined}
            onClearSearchFilters={() => undefined}
            onGoContracts={() => undefined}
            onGoFinance={() => undefined}
            onBackToOverview={() => undefined}
            {...overrides}
        />,
    );

describe('MobileTenantSearchPanel', () => {
    it('renders progressive result feedback and a load-more action', () => {
        const html = renderPanel();

        expect(html).toContain('已显示 2 / 5 条');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('type="search"');
        expect(html).toContain('aria-label="搜索客户、联系人、房号"');
        expect(html).toContain('liquid-mobile-hero px-3.5 py-3');
        expect(html).toContain('text-sm font-black text-slate-950');
        expect(html).toContain('text-xs font-semibold text-slate-500');
        expect(html).toContain('liquid-mobile-control mobile-pressable inline-flex min-h-11 items-center rounded-full px-4 py-2 text-xs font-black text-blue-700');
        expect(html).toContain('liquid-mobile-search-chips');
        expect(html).toContain('role="group"');
        expect(html).toContain('aria-label="合同状态筛选"');
        expect(html).toContain('aria-pressed="true"');
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('aria-controls="mobile-tenant-filter-sheet"');
        expect(html).toContain('liquid-mobile-filter-button mobile-pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black');
        expect(html).toContain('aria-label="上海蓝湖科技有限公司，1号楼 · 301，在租，合同正常"');
        expect(html).toContain('title="上海蓝湖科技有限公司，1号楼 · 301，在租，合同正常"');
        expect(html).toContain('aria-label="查看 上海蓝湖科技有限公司 合同"');
        expect(html).toContain('aria-label="核销 上海蓝湖科技有限公司 收款"');
        expect(html).toContain('liquid-mobile-inline-action mobile-pressable inline-flex min-h-11 items-center rounded-xl px-3 py-2 text-xs font-black');
        expect(html).toContain('liquid-mobile-inline-action-strong mobile-pressable inline-flex min-h-11 items-center rounded-xl px-3 py-2 text-xs font-black');
        expect(html).toContain('显示更多');
    });

    it('renders a collapse action after all paged results are visible', () => {
        const html = renderPanel({
            searchResults: [
                ...baseResults,
                {
                    id: 'tenant-3',
                    name: '上海云启数据有限公司',
                    location: '3号楼 · 501',
                    statusLabel: '在租',
                    helper: '合同正常',
                },
            ],
            searchResultCount: 3,
            canCollapseSearchResults: true,
        });

        expect(html).toContain('已显示 3 / 3 条');
        expect(html).toContain('收起结果');
        expect(html).toContain('liquid-mobile-inline-action mobile-pressable inline-flex min-h-11 items-center rounded-xl px-3 py-2 text-xs font-black');
        expect(html).not.toContain('显示更多');
    });

    it('renders a readable empty state when filters have no matches', () => {
        const html = renderPanel({
            searchQuery: '不存在的客户',
            searchResults: [],
            searchResultCount: 0,
        });

        expect(html).toContain('liquid-mobile-empty-state');
        expect(html).toContain('未找到匹配客户');
        expect(html).toContain('当前关键词或筛选组合没有命中客户');
        expect(html).toContain('清除筛选');
        expect(html).toContain('liquid-mobile-inline-action mobile-pressable mt-4 inline-flex min-h-11 items-center rounded-xl px-4 py-2 text-xs font-black');
    });

    it('renders a labelled touch-safe clear action when filters are active', () => {
        const html = renderPanel({
            searchFilter: 'active',
        });

        expect(html).toContain('aria-label="清除当前查询筛选"');
        expect(html).toContain('liquid-mobile-filter-clear mobile-pressable inline-flex min-h-11 items-center justify-center rounded-full px-2.5 py-1 text-xs font-black');
        expect(html).toContain('清除');
    });

    it('names the advanced filter trigger with the active filter count', () => {
        const html = renderPanel({
            searchAdvancedActiveCount: 2,
        });

        expect(html).toContain('aria-label="打开筛选，已启用 2 项高级筛选"');
        expect(html).toContain('h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs');
    });
});
