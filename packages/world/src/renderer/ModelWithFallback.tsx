import type { ReactNode } from 'react';
import { ResetKeyErrorBoundary } from './ResetKeyErrorBoundary.tsx';

/** Renders `render(url)`, swapping to `render(fallbackUrl)` if loading `url` throws, and to nothing
 * if the fallback throws too, so one bad model never unwinds the whole canvas. */
export function ModelWithFallback(props: {
  url: string;
  fallbackUrl: string;
  render: (url: string) => ReactNode;
}) {
  const { url, fallbackUrl, render } = props;
  // A resetKey is required even though callers remount on a URL change: the boundary records a
  // failure as the caught resetKey, so an undefined key would read as "not failed" and retry forever.
  return (
    <ResetKeyErrorBoundary resetKey={fallbackUrl} fallback={null} onError={logModelError(fallbackUrl)}>
      {url === fallbackUrl ? (
        render(url)
      ) : (
        <ResetKeyErrorBoundary resetKey={url} fallback={render(fallbackUrl)} onError={logModelError(url)}>
          {render(url)}
        </ResetKeyErrorBoundary>
      )}
    </ResetKeyErrorBoundary>
  );
}

export function logModelError(url: string) {
  return (err: Error) => console.warn(`[renderer] model ${url} failed to load`, err);
}
