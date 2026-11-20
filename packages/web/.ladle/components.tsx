import { useEffect } from 'react';
import type { GlobalProvider } from '@ladle/react';
import './styles.css';

/** Mirrors Ladle's light/dark toggle onto the HUD's `data-theme`, and paints the page wallpaper the glass refracts. */
export const Provider: GlobalProvider = ({ children, globalState }) => {
  const theme = globalState.theme === 'dark' ? 'dark' : 'light';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <div className="min-h-screen bg-hud-page p-4 font-hud-body">{children}</div>;
};
