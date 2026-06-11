import { useEffect, useState } from 'react';

/** 订阅 CSS media query，与 Tailwind `md:` 断点一致（768px） */
export function useMinMdViewport(): boolean {
    const [matches, setMatches] = useState(() =>
        typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true
    );
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 768px)');
        const sync = () => setMatches(mq.matches);
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    }, []);
    return matches;
}
