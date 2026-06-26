import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MobileNavigation, type MobileMoreItem, type MobileNavItem } from '../MobileNavigation';

const bottomItems: MobileNavItem[] = [
    {
        key: 'dashboard',
        label: '工作台',
        icon: <span>面板</span>,
        active: true,
        onClick: () => undefined,
    },
    {
        key: 'contracts',
        label: '合同',
        icon: <span>合同</span>,
        active: false,
        onClick: () => undefined,
    },
    {
        key: 'more',
        label: '更多',
        icon: <span>更多</span>,
        active: true,
        onClick: () => undefined,
    },
];

const moreItems: MobileMoreItem[] = [
    {
        key: 'budget',
        label: '预算管理',
        description: '预算执行',
        icon: <span>预算</span>,
        active: false,
        onClick: () => undefined,
    },
    {
        key: 'buildings',
        label: '楼宇资管',
        description: '房源与面积',
        icon: <span>楼宇</span>,
        active: true,
        onClick: () => undefined,
    },
];

describe('MobileNavigation', () => {
    it('exposes current mobile entries to assistive technology', () => {
        const html = renderToStaticMarkup(
            <MobileNavigation
                bottomItems={bottomItems}
                moreItems={moreItems}
                isMoreOpen
                parkName="上海园区"
                selectedYear={2026}
                onCloseMore={() => undefined}
            />,
        );

        expect(html.match(/aria-current="page"/g)).toHaveLength(2);
        expect(html).toContain('id="mobile-more-management-sheet"');
        expect(html).toContain('aria-expanded="true"');
        expect(html).toContain('aria-controls="mobile-more-management-sheet"');
        expect(html).toContain('aria-modal="true"');
        expect(html).toContain('aria-labelledby="mobile-more-management-title"');
        expect(html).toContain('aria-describedby="mobile-more-management-context"');
        expect(html).toContain('id="mobile-more-management-context"');
        expect(html).toContain('aria-label="移动端主导航"');
        expect(html).toContain('上海园区 · 2026 年');
        expect(html).toContain('aria-label="预算管理，预算执行"');
        expect(html).toContain('title="当前页面，楼宇资管，房源与面积"');
        expect(html).toContain('h-11 w-11');
    });
});
