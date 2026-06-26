import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardCustomFieldSettings, DashboardCustomFields } from '../DashboardCustomFields';
import type { DashboardData } from '../../types';

describe('DashboardCustomFields', () => {
    it('renders the account sync status in the field header', () => {
        const html = renderToStaticMarkup(
            <DashboardCustomFields
                compact
                data={{} as DashboardData}
                selectedYear={2026}
                selectedFieldIds={['annualLeasedArea']}
                settingsOpen
                syncLabel="已同步到账号"
                syncTone="cyan"
                onConfigure={() => undefined}
            />,
        );

        expect(html).toContain('最多显示 5 个字段');
        expect(html).toContain('已同步到账号');
        expect(html).toContain('text-cyan-700');
        expect(html).toContain('liquid-mobile-readable');
        expect(html).toContain('liquid-mobile-custom-fields-track');
        expect(html).toContain('min-h-[84px]');
        expect(html).toContain('aria-expanded="true"');
        expect(html).toContain('aria-controls="dashboard-custom-field-settings-panel"');
        expect(html).toContain('role="list"');
        expect(html).toContain('aria-label="我的关注字段，横向滚动，最多显示 5 个字段"');
        expect(html).toContain('role="listitem"');
        expect(html).toContain('aria-label="本年累计出租 0㎡，0 份合同起租"');
        expect(html).toContain('title="本年累计出租 0㎡，0 份合同起租"');
        expect(html).toContain('title="本年累计出租"');
        expect(html).toContain('title="0㎡"');
        expect(html).toContain('title="0 份合同起租"');
    });

    it('keeps the empty custom field call-to-action connected to the settings panel', () => {
        const html = renderToStaticMarkup(
            <DashboardCustomFields
                compact
                data={{} as DashboardData}
                selectedYear={2026}
                selectedFieldIds={[]}
                onConfigure={() => undefined}
            />,
        );

        expect(html).toContain('点击添加个人关注字段');
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('aria-controls="dashboard-custom-field-settings-panel"');
        expect(html).toContain('title="点击添加个人关注字段"');
    });

    it('renders custom field settings as a described modal with selectable field semantics', () => {
        const html = renderToStaticMarkup(
            <DashboardCustomFieldSettings
                open
                selectedFieldIds={['annualLeasedArea']}
                onClose={() => undefined}
                onSave={() => undefined}
            />,
        );

        expect(html).toContain('role="dialog"');
        expect(html).toContain('id="dashboard-custom-field-settings-panel"');
        expect(html).toContain('aria-modal="true"');
        expect(html).toContain('aria-labelledby="dashboard-custom-field-settings-title"');
        expect(html).toContain('aria-describedby="dashboard-custom-field-settings-description"');
        expect(html).toContain('id="dashboard-custom-field-settings-description"');
        expect(html).toContain('aria-label="关闭自定义字段设置"');
        expect(html).toContain('aria-pressed="true"');
        expect(html).toContain('aria-pressed="false"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('aria-atomic="true"');
    });
});
