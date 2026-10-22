import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn's standard `cn(...)` helper. Joins class strings with `clsx`,
 * then collapses Tailwind conflicts with `twMerge` so callers can pass
 * overriding utility classes (e.g. `cn('px-2', props.className)`) and
 * the override actually wins.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Hands `blob` to the browser as a download named `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
