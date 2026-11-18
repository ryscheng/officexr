import { Component, type ErrorInfo, type ReactNode } from 'react';
import { storeViewMode } from './viewMode';

/** Last line of defence for the 3D view: an error that escapes the scene's own boundaries (or a failed
 * load of the lazy 3D chunk) lands here. It never changes the view by itself; the user picks
 * between reloading into 3D and switching to 2D. */
export class PlayView3dBoundary extends Component<
  { children: ReactNode; reload?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('3D view crashed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    const reload = this.props.reload ?? (() => window.location.reload());
    return (
      <div role="alert" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#eef1f6] font-hud-body text-hud-text">
        <p className="text-lg font-semibold">The 3D view hit an error.</p>
        <p className="max-w-md px-4 text-center text-xs text-hud-text-2">{error.message}</p>
        <div className="flex gap-2">
          <button type="button" className="rounded-hud-control bg-hud-accent px-4 py-2 text-sm font-semibold text-white hover:bg-hud-accent-edge" onClick={reload}>
            Reload
          </button>
          <button
            type="button"
            className="rounded-hud-control bg-white px-4 py-2 text-sm font-semibold shadow-hud-control hover:bg-white/80"
            onClick={() => {
              storeViewMode('2d');
              reload();
            }}
          >
            Switch to 2D
          </button>
        </div>
      </div>
    );
  }
}
