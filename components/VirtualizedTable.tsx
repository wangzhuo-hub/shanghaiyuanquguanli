/**
 * 通用虚拟滚动表格组件。
 * 适用于数据量大（>100 行）的长表场景，只渲染可视区域内的行。
 */
import React, { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface VirtualizedTableProps<T> {
    /** 数据行 */
    rows: T[];
    /** 行唯一键 */
    getRowKey: (row: T, index: number) => string;
    /** 渲染行内容（返回 <tr>...</tr>） */
    renderRow: (row: T, index: number) => React.ReactNode;
    /** 表头（静态，不参与虚拟滚动） */
    renderHeader: () => React.ReactNode;
    /** 行高度估计（默认 48px） */
    estimateRowHeight?: number;
    /** 预渲染行数（默认 5） */
    overscan?: number;
    /** 表格容器高度 */
    height?: string | number;
    /** 空数据提示 */
    emptyMessage?: string;
    /** className for the scroll container */
    className?: string;
}

export function VirtualizedTable<T>({
    rows,
    getRowKey,
    renderRow,
    renderHeader,
    estimateRowHeight = 48,
    overscan = 5,
    height = '100%',
    emptyMessage = '暂无数据',
    className = '',
}: VirtualizedTableProps<T>) {
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => estimateRowHeight,
        overscan,
        getItemKey: (index) => getRowKey(rows[index], index),
    });

    // 当 rows 变化时滚动到顶部
    useEffect(() => {
        virtualizer.scrollToIndex(0, { behavior: 'auto' });
    }, [rows.length]);

    if (rows.length === 0) {
        return (
            <div className={`flex items-center justify-center py-12 text-gray-400 ${className}`}>
                {emptyMessage}
            </div>
        );
    }

    return (
        <div
            ref={parentRef}
            className={`overflow-auto ${className}`}
            style={{ height }}
        >
            <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-white">
                    {renderHeader()}
                </thead>
                <tbody>
                    {/* 占位空间（非可视行） */}
                    <tr style={{ height: `${virtualizer.getTotalSize()}px` }} />
                    {/* 可视行 */}
                    {virtualizer.getVirtualItems().map((virtualRow) => (
                        <React.Fragment key={virtualRow.key}>
                            {renderRow(rows[virtualRow.index], virtualRow.index)}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
