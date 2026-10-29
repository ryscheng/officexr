/** The part of the Document Picture-in-Picture API used here; TypeScript's DOM lib has none of it. */
export interface DocumentPictureInPicture {
  /** The open picture-in-picture window, if any. */
  readonly window: Window | null;
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

/** `navigator.mediaSession` with the action the DOM lib's `MediaSessionAction` lacks. */
export interface PipMediaSession {
  /** Throws on browsers that don't know the action. */
  setActionHandler(action: 'enterpictureinpicture', handler: (() => void) | null): void;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export const browserMediaSession = (): PipMediaSession | undefined =>
  navigator.mediaSession as unknown as PipMediaSession | undefined;
