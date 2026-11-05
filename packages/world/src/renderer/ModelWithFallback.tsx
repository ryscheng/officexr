import type { ReactNode } from 'react';
import { ResetKeyErrorBoundary } from './ResetKeyErrorBoundary.tsx';

/** Renders `render(url)`, swapping to `render(fallbackUrl)` if loading `url` throws. */
export function ModelWithFallback(props: {
  url: string;
  fallbackUrl: string;
  render: (url: string) => ReactNode;
}) {
  const { url, fallbackUrl, render } = props;
  if (url === fallbackUrl) {
    return <>{render(url)}</>;
  }
  // Required even though callers remount on a URL change: the boundary records a failure as the
  // caught resetKey, so an undefined key would read as "not failed" and retry the throw forever.
  return (
    <ResetKeyErrorBoundary resetKey={url} fallback={render(fallbackUrl)}>
      {render(url)}
    </ResetKeyErrorBoundary>
  );
}
