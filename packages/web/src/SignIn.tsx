import { API_ORIGIN, apiUrl, paths } from './apiOrigin';

const LOGIN_ERRORS: Record<string, string> = {
  not_allowed: "This Google account isn't allowed to use OfficeXR. Ask an admin to add it.",
  unverified: "Your Google email address isn't verified.",
};

/** The sign-in URL returning to the page at `{ pathname, search }` without its `login_error`. */
export function signInHref({ pathname, search }: Pick<Location, 'pathname' | 'search'>) {
  const params = new URLSearchParams(search);
  params.delete('login_error');
  const rest = params.toString();
  const path = rest ? `${pathname}?${rest}` : pathname;
  // A cross-origin backend can't resolve a relative `next` against the SPA's origin.
  const next = API_ORIGIN ? `${window.location.origin}${path}` : path;
  return apiUrl(`${paths.signIn}?next=${encodeURIComponent(next)}`);
}

/** Starts Google sign-in, returning to the current page. */
export function SignInLink({ className }: { className: string }) {
  return (
    <a href={signInHref(window.location)} className={className}>
      Sign in with Google
    </a>
  );
}

export function SignIn() {
  const loginError = new URLSearchParams(window.location.search).get('login_error');
  return (
    <main className="mx-auto max-w-sm p-6 text-center">
      <h1 className="mb-6 text-2xl font-semibold">OfficeXR</h1>
      {loginError !== null && (
        <p role="alert" className="mb-4 text-red-600">
          {LOGIN_ERRORS[loginError] ?? 'Sign-in failed, please try again.'}
        </p>
      )}
      <SignInLink className="inline-block rounded bg-black px-4 py-2 text-white" />
    </main>
  );
}
