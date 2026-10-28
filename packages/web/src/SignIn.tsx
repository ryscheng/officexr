const LOGIN_ERRORS: Record<string, string> = {
  not_allowed: "This Google account isn't allowed to use OfficeXR. Ask an admin to add it.",
  unverified: "Your Google email address isn't verified.",
};

export function SignIn() {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  const loginError = params.get('login_error');
  params.delete('login_error');
  const rest = params.toString();
  const next = rest ? `${pathname}?${rest}` : pathname;
  return (
    <main className="mx-auto max-w-sm p-6 text-center">
      <h1 className="mb-6 text-2xl font-semibold">OfficeXR</h1>
      {loginError !== null && (
        <p role="alert" className="mb-4 text-red-600">
          {LOGIN_ERRORS[loginError] ?? 'Sign-in failed, please try again.'}
        </p>
      )}
      <a
        href={`/auth/google?next=${encodeURIComponent(next)}`}
        className="inline-block rounded bg-black px-4 py-2 text-white"
      >
        Sign in with Google
      </a>
    </main>
  );
}
