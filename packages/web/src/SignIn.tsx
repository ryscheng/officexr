const LOGIN_ERRORS: Record<string, string> = {
  not_allowed: "This Google account isn't allowed to use OfficeXR. Ask an admin to add it.",
  unverified: "Your Google email address isn't verified.",
};

export function SignIn() {
  const { pathname, search } = window.location;
  const loginError = new URLSearchParams(search).get('login_error');
  return (
    <main className="mx-auto max-w-sm p-6 text-center">
      <h1 className="mb-6 text-2xl font-semibold">OfficeXR</h1>
      {loginError !== null && (
        <p role="alert" className="mb-4 text-red-600">
          {LOGIN_ERRORS[loginError] ?? 'Sign-in failed, please try again.'}
        </p>
      )}
      <a
        href={`/auth/google?next=${encodeURIComponent(pathname + search)}`}
        className="inline-block rounded bg-black px-4 py-2 text-white"
      >
        Sign in with Google
      </a>
    </main>
  );
}
