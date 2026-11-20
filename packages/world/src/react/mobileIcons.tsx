import React from 'react';

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const JumpIcon = () => (
  <Glyph>
    <path d="m17 11-5-5-5 5" />
    <path d="m17 18-5-5-5 5" />
  </Glyph>
);

export const SprintIcon = () => (
  <Glyph>
    <path d="m6 17 5-5-5-5" />
    <path d="m13 17 5-5-5-5" />
  </Glyph>
);

export const PokeIcon = () => (
  <Glyph>
    <path d="M4 12h11" />
    <path d="m11 7 5 5-5 5" />
    <circle cx="20" cy="12" r="1" />
  </Glyph>
);

export const RideIcon = () => (
  <Glyph>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <path d="m10 17 5-5-5-5" />
    <path d="M15 12H3" />
  </Glyph>
);

export const DismountIcon = () => (
  <Glyph>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </Glyph>
);

export const SitIcon = () => (
  <Glyph>
    <path d="M7 4v10" />
    <path d="M7 14h10" />
    <path d="M7 9h6a3 3 0 0 1 3 3v2" />
    <path d="M7 14v6" />
    <path d="M17 14v6" />
  </Glyph>
);
