/**
 * 通用虚拟滚动表格组件。
 * 适用于数据量大（>100 行）的长表场景，只渲染可视区域内的行。
 *
 * 实现要点：
 * - 用 tbody 内「顶/底占位 <tr>」承载非可视行的总高度，可视行落在正确滚动位置（旧实现缺少底部占位，
 *   会把可视行错误地堆在一个巨大空行之后，已修正）。
 * - dynamicHeight=true 时启用 @tanstack/react-virtual 的 measureElement 动态测高，适配变高行
 *   （备注换行、徽标等导致行高不一）；estimateRowHeight 仅作初值。
 * - renderColgroup + tableClassName='... table-fixed' 可固定列宽，避免滚动时可视行变化导致列宽跳动。
 */
import React, { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface VirtualizedTableProps<T> {
    /** 数据行 */
    rows: T[];
    /** 行唯一键 */
    getRowKey: (row: T, index: number) => string;
    /** 渲染行内容（必须返回单个 <tr>...</tr>） */
    renderRow: (row: T, index: number) => React.ReactNode;
    /** 表头（静态，不参与虚拟滚动；返回 <tr>） */
    renderHeader: () => React.ReactNode;
    /** 可选 <colgroup>，配合 table-fixed 固定列宽 */
    renderColgroup?: () => React.ReactNode;
    /** 行高度估计（默认 48px） */
    estimateRowHeight?: number;
    /** 行高不固定时启用动态测量 */
    dynamicHeight?: boolean;
    /** 预渲染行数（默认 8） */
    overscan?: number;
    /** 表格容器高度 */
    height?: string | number;
    /** 空数据提示 */
    emptyMessage?: string;
    /** 滚动容器 className */
    className?: string;
    /** <table> 的 className */
    tableClassName?: string;
}

export function VirtualizedTable<T>({
    rows,
    getRowKey,
    renderRow,
    renderHeader,
    renderColgroup,
    estimateRowHeight = 48,
    dynamicHeight = false,
    overscan = 8,
    height = '100%',
    emptyMessage = '暂无数据',
    className = '',
    tableClassName = 'w-full border-collapse',
}: VirtualizedTableProps<T>) {
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => estimateRowHeight,
        overscan,
        getItemKey: (index) => getRowKey(rows[index], index),
    });

    // 当 rows 长度变化（切月/切年/筛选）时回到顶部
    useEffect(() => {
        virtualizer.scrollToIndex(0, { behavior: 'auto' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows.length]);

    if (rows.length === 0) {
        return (
            <div className={`flex items-center justify-center py-12 text-gray-400 ${className}`}>
                {emptyMessage}
            </div>
        );
    }

    const virtualItems = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();
    const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
    const paddingBottom =
        virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;
    const measureRef = dynamicHeight ? virtualizer.measureElement : undefined;

    return (
        <div ref={parentRef} className={`overflow-auto ${className}`} style={{ height }}>
            <table className={tableClassName}>
                {renderColgroup ? renderColgroup() : null}
                <thead className="sticky top-0 z-10 bg-white">
                    {renderHeader()}
                </thead>
                <tbody>
                    {paddingTop > 0 && <tr aria-hidden="true" style={{ height: paddingTop }} />}
                    {virtualItems.map((virtualRow) => {
                        const rowEl = renderRow(rows[virtualRow.index], virtualRow.index) as React.ReactElement;
                        // 注入虚拟定位所需的 data-index 与测量 ref（动态高时），保留行自身的 props/children
                        return React.cloneElement(rowEl, {
                            key: virtualRow.key,
                            'data-index': virtualRow.index,
                            ref: measureRef,
                        } as Partial<unknown> & React.Attributes);
                    })}
                    {paddingBottom > 0 && <tr aria-hidden="true" style={{ height: paddingBottom }} />}
                </tbody>
            </table>
        </div>
    );
}
