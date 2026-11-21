const KEY = 'officexr:signInNext';

export function saveSignInNext(path: string): void {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // a blocked store only loses the saved room link
  }
}

export function readSignInNext(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    return path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : null;
  } catch {
    return null;
  }
}

export function clearSignInNext(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    return;
  }
}
