import { Component, type ReactNode } from 'react';
import { storeViewMode } from './viewMode';

/** Catches a failed load of the lazy 3D chunk and offers the 2D view instead. */
export class PlayView3dBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <div role="alert" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black text-white">
        <p>The 3D view could not be loaded.</p>
        <button
          type="button"
          className="rounded bg-white/10 px-3 py-2 hover:bg-white/20"
          onClick={() => {
            storeViewMode('2d');
            window.location.reload();
          }}
        >
          Switch to 2D
        </button>
      </div>
    );
  }
}
