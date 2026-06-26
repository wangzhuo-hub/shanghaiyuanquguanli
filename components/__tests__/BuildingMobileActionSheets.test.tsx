import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
    BuildingMobileBatchStatusSheet,
    BuildingMobileQuickUnitSheet,
    type BuildingMobileQuickUnitContext,
} from '../BuildingMobileActionSheets';
import { UnitStatus, type Building, type Unit } from '../../types';

const building: Building = {
    id: 'building-1',
    name: '1号楼',
    type: 'Building',
    units: [],
};

const unit: Unit = {
    id: 'unit-401',
    name: '401-1',
    floor: 4,
    area: 44,
    status: UnitStatus.Vacant,
};

const quickContext: BuildingMobileQuickUnitContext = {
    building,
    unit,
    locked: false,
    statusTone: 'vacant',
    statusLabel: '待租',
    tenantLine: '暂无租户',
};

describe('BuildingMobileActionSheets', () => {
    it('renders the quick unit action sheet with dialog semantics and status actions', () => {
        const html = renderToStaticMarkup(
            <BuildingMobileQuickUnitSheet
                context={quickContext}
                sheetRef={React.createRef<HTMLElement>()}
                closeButtonRef={React.createRef<HTMLButtonElement>()}
                onClose={() => undefined}
                onEdit={() => undefined}
                onApplyStatus={() => undefined}
            />,
        );

        expect(html).toContain('role="dialog"');
        expect(html).toContain('aria-modal="true"');
        expect(html).toContain('id="building-mobile-quick-unit-sheet"');
        expect(html).toContain('aria-labelledby="building-mobile-quick-unit-title"');
        expect(html).toContain('aria-describedby="building-mobile-quick-unit-description"');
        expect(html).toContain('id="building-mobile-quick-unit-description"');
        expect(html).toContain('title="4F · 44.00㎡ · 暂无租户"');
        expect(html).toContain('aria-label="关闭单元快速处理"');
        expect(html).toContain('h-11 w-11');
        expect(html).toContain('min-h-11');
        expect(html).toContain('401-1');
        expect(html).toContain('待租');
        expect(html).toContain('预留');
        expect(html).toContain('自用');
        expect(html).toContain('快速状态只调整资产台账中的房源状态');
        expect(html).toContain('编辑完整信息');
    });

    it('renders the batch status action sheet with selected unit context', () => {
        const html = renderToStaticMarkup(
            <BuildingMobileBatchStatusSheet
                activeBuildingName="1号楼"
                selectedRows={[{ unit }, { unit: { ...unit, id: 'unit-402', name: '402' } }]}
                sheetRef={React.createRef<HTMLElement>()}
                closeButtonRef={React.createRef<HTMLButtonElement>()}
                onClose={() => undefined}
                onExitBatch={() => undefined}
                onApplyStatus={() => undefined}
            />,
        );

        expect(html).toContain('role="dialog"');
        expect(html).toContain('aria-modal="true"');
        expect(html).toContain('id="building-mobile-batch-status-sheet"');
        expect(html).toContain('aria-labelledby="building-mobile-batch-status-title"');
        expect(html).toContain('aria-describedby="building-mobile-batch-status-description"');
        expect(html).toContain('id="building-mobile-batch-status-description"');
        expect(html).toContain('aria-label="关闭批量状态处理"');
        expect(html).toContain('h-11 w-11');
        expect(html).toContain('min-h-11');
        expect(html).toContain('已选 2');
        expect(html).toContain('批量调整房源状态');
        expect(html).toContain('仅处理未出租且无当前租户的单元');
        expect(html).toContain('批量状态只更新资产台账中的房源状态');
        expect(html).toContain('401-1');
        expect(html).toContain('402');
        expect(html).toContain('退出批量');
    });
});
