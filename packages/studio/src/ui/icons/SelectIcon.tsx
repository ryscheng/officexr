import React from 'react';

/** Cursor/arrow icon — Zest Interface style, 24×24 monoline. */
export function SelectIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 3l16 9-7 2-2 8z" />
    </svg>
  );
}
