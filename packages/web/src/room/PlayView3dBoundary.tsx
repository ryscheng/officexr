import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Blocked } from '../page/Blocked';

const STALE_CHUNK = /dynamically imported module|Loading chunk|Importing a module script failed/i;

/** Last line of defence for the world view (3D and overhead 2D alike): an error that escapes the scene's
 * own boundaries (or a failed load of the lazy chunk) lands here, and the user can try again. */
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

  private retry = () => {
    const { error } = this.state;
    // React caches a failed lazy import, so only a page load fetches the chunk again.
    if (error && STALE_CHUNK.test(error.message)) {
      (this.props.reload ?? (() => window.location.reload()))();
      return;
    }
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return <Blocked surface="cover" variant="crashed" details={error.message} onPrimary={this.retry} />;
  }
}
