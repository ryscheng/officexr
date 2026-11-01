import React, { useEffect, useState, type ReactNode } from 'react';
import { paths, STUDIO_API_ORIGIN, studioApiUrl, studioFetch, WEB_API_ORIGIN } from './apiOrigin.ts';

type GateState =
  | { type: 'checking' }
  | { type: 'signedOut' }
  | { type: 'forbidden' }
  | { type: 'allowed' }
  | { type: 'failed' };

const assertNever = (value: never): never => {
  throw new Error(`unhandled gate state: ${JSON.stringify(value)}`);
};

/** Web-backend Google sign-in returning to `location` without its `login_error`. */
function signInHref({ origin, pathname, search, hash }: Pick<Location, 'origin' | 'pathname' | 'search' | 'hash'>) {
  const params = new URLSearchParams(search);
  params.delete('login_error');
  const rest = params.toString();
  const next = `${origin}${pathname}${rest ? `?${rest}` : ''}${hash}`;
  return `${WEB_API_ORIGIN}/auth/google?next=${encodeURIComponent(next)}`;
}

/** Renders `children` once the studio API accepts the session; no gate without a studio API origin. */
export function SignInGate({ bypass, children }: { bypass: boolean; children: ReactNode }) {
  if (bypass || !STUDIO_API_ORIGIN) {
    return <>{children}</>;
  }
  return <MeGate>{children}</MeGate>;
}

function MeGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ type: 'checking' });

  useEffect(() => {
    let live = true;
    studioFetch(studioApiUrl(paths.me))
      .then(({ status }): GateState =>
        status === 200
          ? { type: 'allowed' }
          : status === 401
            ? { type: 'signedOut' }
            : status === 403
              ? { type: 'forbidden' }
              : { type: 'failed' },
      )
      .catch((): GateState => ({ type: 'failed' }))
      .then((next) => {
        if (live) {
          setState(next);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  if (state.type === 'allowed') {
    return <>{children}</>;
  }
  const message: ReactNode =
    state.type === 'checking'
      ? 'Loading…'
      : state.type === 'signedOut'
        ? <a href={signInHref(window.location)} className="underline">Sign in with Google</a>
        : state.type === 'forbidden'
          ? "Your account isn't allowed to use the studio"
          : state.type === 'failed'
            ? "Couldn't reach the studio server"
            : assertNever(state);
  return <main className="p-6 text-center">{message}</main>;
}
