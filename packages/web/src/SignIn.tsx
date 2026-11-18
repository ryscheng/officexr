import { API_ORIGIN, apiUrl, paths } from './apiOrigin';
import { buttonClass } from './hud/ui/Button';
import { InlineAlert } from './hud/ui/InlineAlert';
import { Panel } from './hud/ui/Panel';
import { BrandMark, PageShell } from './page/PageShell';

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
    <PageShell centred>
      <main className="w-full max-w-sm">
        <Panel className="flex flex-col items-center gap-5 px-6 py-8 text-center">
          <BrandMark size="lg" />
          <p className="text-sm text-hud-text-2">Your team's office, one walk away. Sign in to join.</p>
          {loginError !== null && (
            <InlineAlert className="w-full text-left">{LOGIN_ERRORS[loginError] ?? 'Sign-in failed, please try again.'}</InlineAlert>
          )}
          <SignInLink className={buttonClass('primary', 'lg', 'w-full')} />
        </Panel>
      </main>
    </PageShell>
  );
}
