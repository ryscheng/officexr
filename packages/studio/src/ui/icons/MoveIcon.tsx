import React from 'react';

/** Four-directional move/drag icon — 18×18 monoline. */
export function MoveIcon({ size = 16 }: { size?: number }) {
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
      {/* up arrow */}
      <polyline points="5 9 12 2 19 9" />
      {/* down arrow */}
      <polyline points="5 15 12 22 19 15" />
      {/* left arrow */}
      <polyline points="9 5 2 12 9 19" />
      {/* right arrow */}
      <polyline points="15 5 22 12 15 19" />
    </svg>
  );
}
