/** macOS segmented control: a recessed track with a raised white thumb on the chosen item. */
export const SEGMENT_GROUP = 'rounded-[10px] bg-hud-inset p-0.5';

export const SEGMENT_ITEM =
  'rounded-[8px] px-3 py-1 font-hud-body text-[13px] font-medium text-hud-text-2 transition-colors pointer-coarse:min-h-12 pointer-coarse:min-w-12 ' +
  'hover:text-hud-text data-[state=active]:bg-hud-thumb data-[state=on]:bg-hud-thumb data-[state=active]:text-hud-text data-[state=on]:text-hud-text ' +
  'data-[state=active]:shadow-hud-control data-[state=on]:shadow-hud-control focus-visible:outline-2 focus-visible:outline-hud-accent';
