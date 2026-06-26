import React from 'react';
import { X } from 'lucide-react';
import type { Building, Unit } from '../types';
import { UnitStatus } from '../types';
import { formatArea } from '../services/numberFormat';

type BuildingMobileStatusTone = 'vacant' | 'self' | 'occupied' | 'reserved';

export type BuildingMobileQuickUnitContext = {
    building: Building;
    unit: Unit;
    locked: boolean;
    statusTone: BuildingMobileStatusTone;
    statusLabel: string;
    tenantLine: string;
};

export type BuildingMobileBatchUnitRow = {
    unit: Unit;
};

type BuildingMobileQuickUnitSheetProps = {
    context: BuildingMobileQuickUnitContext;
    sheetRef: React.Ref<HTMLElement>;
    closeButtonRef: React.Ref<HTMLButtonElement>;
    onClose: () => void;
    onEdit: (unit: Unit) => void;
    onApplyStatus: (unit: Unit, next: { status: UnitStatus; isSelfUse: boolean }) => void;
};

type BuildingMobileBatchStatusSheetProps = {
    activeBuildingName: string;
    selectedRows: BuildingMobileBatchUnitRow[];
    sheetRef: React.Ref<HTMLElement>;
    closeButtonRef: React.Ref<HTMLButtonElement>;
    onClose: () => void;
    onExitBatch: () => void;
    onApplyStatus: (next: { status: UnitStatus; isSelfUse: boolean }, label: string) => void;
};

const buildingMobileGhostButtonClass = 'liquid-glass-control liquid-pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-slate-700 disabled:pointer-events-none disabled:opacity-45';

export const BuildingMobileQuickUnitSheet: React.FC<BuildingMobileQuickUnitSheetProps> = ({
    context,
    sheetRef,
    closeButtonRef,
    onClose,
    onEdit,
    onApplyStatus,
}) => (
    <div className="monthly-detail-backdrop fixed inset-0 z-[86] flex items-end justify-center p-0 lg:hidden">
        <button
            type="button"
            aria-label="关闭单元快速处理"
            className="absolute inset-0 cursor-default"
            onClick={onClose}
        />
        <section
            id="building-mobile-quick-unit-sheet"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="building-mobile-quick-unit-title"
            aria-describedby="building-mobile-quick-unit-description"
            className="monthly-detail-panel liquid-glass-panel relative flex max-h-[86vh] w-full flex-col overflow-hidden rounded-t-[28px]"
        >
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-slate-300/70" aria-hidden />
            <div className="flex items-start justify-between gap-3 border-b border-white/70 px-5 py-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="liquid-mobile-chip-blue rounded-full px-2.5 py-1 text-xs font-black">
                            {context.building.name}
                        </span>
                        <span data-status={context.statusTone} className="liquid-building-status inline-flex rounded-full px-2.5 py-1 text-xs font-black">
                            {context.statusLabel}
                        </span>
                    </div>
                    <h3 id="building-mobile-quick-unit-title" className="mt-2 truncate text-lg font-black text-slate-950">{context.unit.name}</h3>
                    <p
                        id="building-mobile-quick-unit-description"
                        className="mt-1 truncate text-xs font-semibold text-slate-500"
                        title={`${context.unit.floor}F · ${formatArea(context.unit.area)} · ${context.tenantLine}`}
                    >
                        {context.unit.floor}F · {formatArea(context.unit.area)} · {context.tenantLine}
                    </p>
                </div>
                <button
                    type="button"
                    ref={closeButtonRef}
                    onClick={onClose}
                    className="liquid-glass-control liquid-pressable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500"
                    aria-label="关闭单元快速处理"
                >
                    <X size={18} />
                </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {context.locked ? (
                    <div className="liquid-building-mobile-quick-panel rounded-[22px] px-3 py-3 text-xs font-semibold leading-relaxed text-slate-600">
                        已租单元由合同控制。若要释放房源，请先在合同中办理退租或调整房源。
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            type="button"
                            onClick={() => onApplyStatus(context.unit, { status: UnitStatus.Vacant, isSelfUse: false })}
                            className={`liquid-building-mobile-action mobile-pressable min-h-12 rounded-2xl px-2 text-xs font-black ${!context.unit.isSelfUse && context.unit.status === UnitStatus.Vacant ? 'liquid-building-mobile-action-active' : ''}`}
                        >
                            待租
                        </button>
                        <button
                            type="button"
                            onClick={() => onApplyStatus(context.unit, { status: UnitStatus.Reserved, isSelfUse: false })}
                            className={`liquid-building-mobile-action mobile-pressable min-h-12 rounded-2xl px-2 text-xs font-black ${!context.unit.isSelfUse && context.unit.status === UnitStatus.Reserved ? 'liquid-building-mobile-action-active' : ''}`}
                        >
                            预留
                        </button>
                        <button
                            type="button"
                            onClick={() => onApplyStatus(context.unit, { status: UnitStatus.Vacant, isSelfUse: true })}
                            className={`liquid-building-mobile-action mobile-pressable min-h-12 rounded-2xl px-2 text-xs font-black ${context.unit.isSelfUse ? 'liquid-building-mobile-action-active' : ''}`}
                        >
                            自用
                        </button>
                    </div>
                )}
                <div className="liquid-building-mobile-quick-panel rounded-[22px] px-3 py-3 text-xs font-semibold leading-relaxed text-slate-600">
                    快速状态只调整资产台账中的房源状态，不修改合同、面积、租户引用或历史导入记录。完整字段请进入编辑。
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-white/70 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <button
                    type="button"
                    onClick={onClose}
                    className={buildingMobileGhostButtonClass}
                >
                    取消
                </button>
                <button
                    type="button"
                    onClick={() => onEdit(context.unit)}
                    className="liquid-action-strong liquid-pressable rounded-full px-4 py-2.5 text-sm font-black text-white"
                >
                    编辑完整信息
                </button>
            </div>
        </section>
    </div>
);

export const BuildingMobileBatchStatusSheet: React.FC<BuildingMobileBatchStatusSheetProps> = ({
    activeBuildingName,
    selectedRows,
    sheetRef,
    closeButtonRef,
    onClose,
    onExitBatch,
    onApplyStatus,
}) => (
    <div className="monthly-detail-backdrop fixed inset-0 z-[86] flex items-end justify-center p-0 lg:hidden">
        <button
            type="button"
            aria-label="关闭批量状态处理"
            className="absolute inset-0 cursor-default"
            onClick={onClose}
        />
        <section
            id="building-mobile-batch-status-sheet"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="building-mobile-batch-status-title"
            aria-describedby="building-mobile-batch-status-description"
            className="monthly-detail-panel liquid-glass-panel relative flex max-h-[86vh] w-full flex-col overflow-hidden rounded-t-[28px]"
        >
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-slate-300/70" aria-hidden />
            <div className="flex items-start justify-between gap-3 border-b border-white/70 px-5 py-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="liquid-mobile-chip-blue rounded-full px-2.5 py-1 text-xs font-black">
                            {activeBuildingName || '当前楼宇'}
                        </span>
                        <span className="liquid-building-mobile-select liquid-building-mobile-select-active inline-flex rounded-full px-2.5 py-1 text-xs font-black">
                            已选 {selectedRows.length}
                        </span>
                    </div>
                    <h3 id="building-mobile-batch-status-title" className="mt-2 truncate text-lg font-black text-slate-950">批量调整房源状态</h3>
                    <p id="building-mobile-batch-status-description" className="mt-1 text-xs font-semibold leading-relaxed text-slate-500">
                        仅处理未出租且无当前租户的单元，合同控制房源会自动跳过。
                    </p>
                </div>
                <button
                    type="button"
                    ref={closeButtonRef}
                    onClick={onClose}
                    className="liquid-glass-control liquid-pressable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500"
                    aria-label="关闭批量状态处理"
                >
                    <X size={18} />
                </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-3 gap-2">
                    <button
                        type="button"
                        onClick={() => onApplyStatus({ status: UnitStatus.Vacant, isSelfUse: false }, '待租')}
                        className="liquid-building-mobile-action mobile-pressable min-h-12 rounded-2xl px-2 text-xs font-black"
                    >
                        待租
                    </button>
                    <button
                        type="button"
                        onClick={() => onApplyStatus({ status: UnitStatus.Reserved, isSelfUse: false }, '预留')}
                        className="liquid-building-mobile-action mobile-pressable min-h-12 rounded-2xl px-2 text-xs font-black"
                    >
                        预留
                    </button>
                    <button
                        type="button"
                        onClick={() => onApplyStatus({ status: UnitStatus.Vacant, isSelfUse: true }, '自用')}
                        className="liquid-building-mobile-action mobile-pressable min-h-12 rounded-2xl px-2 text-xs font-black"
                    >
                        自用
                    </button>
                </div>
                <div className="liquid-building-mobile-quick-panel rounded-[22px] px-3 py-3 text-xs font-semibold leading-relaxed text-slate-600">
                    批量状态只更新资产台账中的房源状态，不修改合同、面积、租户引用或历史导入记录。保存到云端仍需点击系统「保存」。
                </div>
                <div className="liquid-building-mobile-quick-panel rounded-[22px] px-3 py-3">
                    <div className="mb-2 text-xs font-black text-slate-500">已选单元</div>
                    <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                        {selectedRows.map(({ unit }) => (
                            <span key={unit.id} className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-black text-slate-700">
                                {unit.name}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-white/70 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <button
                    type="button"
                    onClick={onClose}
                    className={buildingMobileGhostButtonClass}
                >
                    返回选择
                </button>
                <button
                    type="button"
                    onClick={onExitBatch}
                    className={buildingMobileGhostButtonClass}
                >
                    退出批量
                </button>
            </div>
        </section>
    </div>
);
