import { useEffect, useRef } from 'react';

const mobileSheetFocusableSelector = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

const getMobileSheetFocusableElements = (container: HTMLElement | null) =>
    Array.from(container?.querySelectorAll<HTMLElement>(mobileSheetFocusableSelector) ?? []).filter(
        (element) => element.getAttribute('aria-hidden') !== 'true',
    );

const keepFocusInsideMobileSheet = (event: KeyboardEvent, container: HTMLElement | null) => {
    if (event.key !== 'Tab') return;

    const focusableElements = getMobileSheetFocusableElements(container);
    if (!focusableElements.length) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (!container?.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus();
        return;
    }

    if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
    }
};

export function useMobileSheetFocus<
    TriggerElement extends HTMLElement,
    InitialFocusElement extends HTMLElement,
    SheetElement extends HTMLElement,
>({
    isOpen,
    onEscape,
}: {
    isOpen: boolean;
    onEscape: () => void;
}) {
    const triggerRef = useRef<TriggerElement | null>(null);
    const initialFocusRef = useRef<InitialFocusElement | null>(null);
    const sheetRef = useRef<SheetElement | null>(null);
    const wasOpenRef = useRef(false);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onEscape();
                return;
            }
            keepFocusInsideMobileSheet(event, sheetRef.current);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onEscape]);

    useEffect(() => {
        const wasOpen = wasOpenRef.current;
        wasOpenRef.current = isOpen;

        if (!wasOpen && isOpen) {
            const focusTimer = window.setTimeout(() => initialFocusRef.current?.focus(), 0);
            return () => window.clearTimeout(focusTimer);
        }

        if (wasOpen && !isOpen) {
            const focusTimer = window.setTimeout(() => triggerRef.current?.focus(), 0);
            return () => window.clearTimeout(focusTimer);
        }

        return undefined;
    }, [isOpen]);

    return { triggerRef, initialFocusRef, sheetRef };
}
