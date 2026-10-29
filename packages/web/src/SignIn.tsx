const LOGIN_ERRORS: Record<string, string> = {
  not_allowed: "This Google account isn't allowed to use OfficeXR. Ask an admin to add it.",
  unverified: "Your Google email address isn't verified.",
};

/** Starts Google sign-in, returning to the current page without its `login_error`. */
export function SignInLink({ className }: { className: string }) {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  params.delete('login_error');
  const rest = params.toString();
  const next = rest ? `${pathname}?${rest}` : pathname;
  return (
    <a href={`/auth/google?next=${encodeURIComponent(next)}`} className={className}>
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
