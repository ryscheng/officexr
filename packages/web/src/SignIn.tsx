import { useEffect, useState, type MouseEvent } from 'react';
import { TriangleAlert, WifiOff } from 'lucide-react';
import { API_ORIGIN, apiUrl, paths } from './apiOrigin';
import { Panel } from './hud/ui/Panel';
import { BrandMark, PageShell } from './page/PageShell';
import { pageButton } from './page/pageButton';
import { useOfficeName } from './useOfficeName';
import { readSignInNext, saveSignInNext } from './signInNext';

type SignInProblem = { tone: 'rose' | 'amber'; title: string; text: string };

const PROBLEMS: Record<string, SignInProblem> = {
  not_allowed: {
    tone: 'rose',
    title: 'This account is not on the list yet.',
    text: 'Ask the person who invited you, or an admin, to add your Google address. Then try again.',
  },
  unverified: {
    tone: 'rose',
    title: 'Google says this email is not verified.',
    text: 'Verify it in your Google account, then try again.',
  },
  failed: { tone: 'rose', title: 'Sign-in did not finish.', text: 'This is usually a short problem. Try again.' },
};

const OFFLINE: SignInProblem = { tone: 'amber', title: 'You are offline.', text: 'Connect to the internet, then try again.' };

export const problemFor = (loginError: string): SignInProblem => PROBLEMS[loginError] ?? PROBLEMS.failed;

const pathOf = ({ pathname, search }: Pick<Location, 'pathname' | 'search'>) => {
  const params = new URLSearchParams(search);
  params.delete('login_error');
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
};

/** The sign-in URL returning to the page at `{ pathname, search }` without its `login_error`. */
export function signInHref(location: Pick<Location, 'pathname' | 'search'>) {
  const path = pathOf(location);
  // A cross-origin backend can't resolve a relative `next` against the SPA's origin.
  const next = API_ORIGIN ? `${window.location.origin}${path}` : path;
  return apiUrl(`${paths.signIn}?next=${encodeURIComponent(next)}`);
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function SignInError({ problem }: { problem: SignInProblem }) {
  const Icon = problem.tone === 'amber' ? WifiOff : TriangleAlert;
  const tone = problem.tone === 'amber' ? 'bg-hud-amber text-hud-amber-text' : 'bg-hud-rose text-hud-rose-text';
  return (
    <div role="alert" className={`flex w-full items-start gap-3 rounded-hud-control px-4 py-3 text-left text-sm/5 ${tone}`}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <p>
        <strong className="font-semibold">{problem.title}</strong> {problem.text}
      </p>
    </div>
  );
}

const OPENING_MS = 5000;

function ContinueButton({ target }: { target: Pick<Location, 'pathname' | 'search'> }) {
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    if (!opening) {
      return;
    }
    const timer = setTimeout(() => setOpening(false), OPENING_MS);
    return () => clearTimeout(timer);
  }, [opening]);
  const onClick = (e: MouseEvent) => {
    if (opening) {
      e.preventDefault();
      return;
    }
    saveSignInNext(pathOf(target));
    setOpening(true);
  };
  return (
    <a href={signInHref(target)} aria-disabled={opening} className={pageButton('primary', 'w-full')} onClick={onClick}>
      {opening ? 'Opening Google…' : 'Continue with Google'}
    </a>
  );
}

const roomIdOf = (path: string) => path.match(/^\/room\/([^/]+)/)?.[1] ?? null;

export function SignIn() {
  const [loginError] = useState(() => new URLSearchParams(window.location.search).get('login_error'));
  const [keptLink] = useState(() => {
    const saved = loginError !== null ? readSignInNext() : null;
    return saved && saved !== pathOf(window.location) ? saved : null;
  });
  useEffect(() => {
    if (keptLink) {
      window.history.replaceState(window.history.state, '', keptLink);
    }
  }, [keptLink]);
  const target = keptLink ? new URL(keptLink, window.location.origin) : window.location;
  const online = useOnline();
  const problem = !online ? OFFLINE : loginError !== null ? problemFor(loginError) : null;
  const roomId = roomIdOf(target.pathname);
  const room = roomId !== null;
  const officeName = useOfficeName(roomId);
  return (
    <PageShell centred>
      <main className="w-full max-w-100">
        <Panel className="flex flex-col items-center gap-5 px-6 py-8 text-center max-[359px]:px-4">
          <BrandMark size="lg" />
          {room && (
            <p className="flex min-h-12 w-full items-center justify-center rounded-hud-control bg-hud-inset px-3 text-base text-hud-text [overflow-wrap:anywhere]">
              {officeName === null ? (
                'You opened an office link'
              ) : (
                <span className="line-clamp-2">
                  You are invited to <strong className="font-semibold">{officeName}</strong>
                </span>
              )}
            </p>
          )}
          <p className="text-base/6 text-hud-text-2">
            {room ? 'Sign in with Google to walk in.' : "Your team's office, one walk away. Sign in to join."}
          </p>
          {problem && <SignInError problem={problem} />}
          <ContinueButton target={target} />
          {keptLink && (
            <a href={keptLink} className={pageButton('text', 'w-full')}>
              Back to your office link
            </a>
          )}
        </Panel>
      </main>
    </PageShell>
  );
}
