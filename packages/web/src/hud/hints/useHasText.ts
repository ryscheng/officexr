import { useEffect, useState } from 'react';

export function useHasText(el: HTMLElement | null): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!el) {
      setHas(false);
      return;
    }
    const sync = () => setHas((el.textContent ?? '').trim() !== '');
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [el]);
  return has;
}
