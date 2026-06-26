import React from 'react';
import { ChevronRight, X } from 'lucide-react';
import { useMobileSheetFocus } from './useMobileSheetFocus';

export type MobileNavItem = {
    key: string;
    label: string;
    icon: React.ReactNode;
    active: boolean;
    onClick: () => void;
};

export type MobileMoreItem = MobileNavItem & {
    description: string;
    disabled?: boolean;
};

type MobileNavigationProps = {
    bottomItems: MobileNavItem[];
    moreItems: MobileMoreItem[];
    isMoreOpen: boolean;
    parkName: string;
    selectedYear: number;
    onCloseMore: () => void;
};

export const MobileNavigation: React.FC<MobileNavigationProps> = ({
    bottomItems,
    moreItems,
    isMoreOpen,
    parkName,
    selectedYear,
    onCloseMore,
}) => {
    const {
        triggerRef: moreButtonRef,
        initialFocusRef: moreCloseButtonRef,
        sheetRef: moreSheetRef,
    } = useMobileSheetFocus<HTMLButtonElement, HTMLButtonElement, HTMLElement>({
        isOpen: isMoreOpen,
        onEscape: onCloseMore,
    });

    return (
        <>
            {isMoreOpen && (
                <div className="fixed inset-0 z-40 lg:hidden" onClick={onCloseMore}>
                    <div className="absolute inset-0 bg-slate-950/16 backdrop-blur-[2px]" />
                    <section
                        id="mobile-more-management-sheet"
                        ref={moreSheetRef}
                        className="liquid-mobile-more-sheet absolute inset-x-3 bottom-[calc(var(--mobile-bottom-nav-height)+1.15rem)] mx-auto max-w-md rounded-[28px] p-3"
                        onClick={(event) => event.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="mobile-more-management-title"
                        aria-describedby="mobile-more-management-context"
                    >
                        <div className="mb-2 flex items-center justify-between px-1">
                            <div>
                                <div id="mobile-more-management-title" className="text-sm font-black text-slate-950">更多管理</div>
                                <div id="mobile-more-management-context" className="mt-0.5 text-xs font-semibold text-slate-500">{parkName} · {selectedYear} 年</div>
                            </div>
	                            <button
	                                type="button"
	                                ref={moreCloseButtonRef}
	                                className="liquid-glass-control liquid-pressable flex h-11 w-11 items-center justify-center rounded-full text-slate-500"
	                                onClick={onCloseMore}
	                                aria-label="关闭更多管理入口"
	                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="grid gap-2">
	                            {moreItems.map((item) => {
	                                const itemLabel = `${item.active ? '当前页面，' : ''}${item.label}，${item.description}`;
	                                return (
	                                    <button
	                                        key={item.key}
	                                        type="button"
	                                        disabled={item.disabled}
	                                        onClick={item.onClick}
	                                        aria-current={item.active ? 'page' : undefined}
	                                        aria-label={itemLabel}
	                                        title={itemLabel}
	                                        className={`liquid-mobile-more-item mobile-pressable flex min-h-[64px] items-center gap-3 rounded-[22px] px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
	                                            item.active ? 'liquid-mobile-more-item-active' : ''
	                                        }`}
	                                    >
	                                        <span className="liquid-mobile-more-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px]">
	                                            {item.icon}
	                                        </span>
	                                        <span className="min-w-0 flex-1">
	                                            <span className="block text-sm font-black text-slate-900">{item.label}</span>
	                                            <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{item.description}</span>
	                                        </span>
	                                        <ChevronRight size={17} className="shrink-0 text-slate-500" />
	                                    </button>
	                                );
	                            })}
                        </div>
                    </section>
                </div>
            )}
            <nav
                className="liquid-mobile-bottom-nav liquid-mobile-bottom-readable fixed inset-x-3 bottom-3 z-30 rounded-[22px] px-1.5 pb-[calc(env(safe-area-inset-bottom)+0.3rem)] pt-1.5 lg:hidden"
                aria-label="移动端主导航"
            >
                <div className={`mx-auto grid max-w-md gap-1 ${bottomItems.length === 5 ? 'grid-cols-5' : bottomItems.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                    {bottomItems.map((item) => {
                        const isMoreItem = item.key === 'more';
                        return (
                            <button
                                key={item.key}
                                type="button"
                                ref={isMoreItem ? moreButtonRef : undefined}
                                onClick={item.onClick}
                                aria-current={item.active && !isMoreItem ? 'page' : undefined}
                                aria-expanded={isMoreItem ? isMoreOpen : undefined}
                                aria-controls={isMoreItem ? 'mobile-more-management-sheet' : undefined}
                                className={`liquid-mobile-bottom-item mobile-pressable flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-[16px] text-xs font-black transition ${
                                    item.active
                                        ? 'liquid-mobile-bottom-item-active'
                                        : 'liquid-mobile-bottom-item-idle'
                                }`}
                            >
                                {item.icon}
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </div>
            </nav>
        </>
    );
};
