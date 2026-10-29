import { useCallback, useEffect, useRef, useState } from 'react';
import { browserMediaSession, type DocumentPictureInPicture, type PipMediaSession } from './documentPictureInPicture';

const WINDOW_SIZE = { width: 220, height: 260 };

/** An automatic window closes when the tab is shown again; a manual one stays until closed. */
type Opening = 'auto' | 'manual';

export interface PictureInPicture {
  supported: boolean;
  pipWindow: Window | null;
  /** Must run inside a user gesture, so it requests the window synchronously. */
  open(): void;
  close(): void;
}

export interface PictureInPictureDeps {
  /** `null` when the browser has no Document Picture-in-Picture. */
  api?: DocumentPictureInPicture | null;
  mediaSession?: PipMediaSession;
  doc?: Document;
}

function copyStyleSheets(from: Document, to: Document) {
  for (const sheet of from.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')) {
    const copy = sheet.cloneNode(true) as HTMLLinkElement | HTMLStyleElement;
    if ('href' in sheet && 'href' in copy) {
      // Resolved against the opener, so the copy loads the same file from the PiP document.
      copy.href = sheet.href;
    }
    to.head.append(copy);
  }
}

/**
 * Hosts one Document Picture-in-Picture window: opened manually by `open()`, or automatically by the
 * media session's 'enterpictureinpicture' action when the tab is hidden. Closes it on unmount.
 */
export function usePictureInPicture({
  api = window.documentPictureInPicture ?? null,
  mediaSession = browserMediaSession(),
  doc = document,
}: PictureInPictureDeps = {}): PictureInPicture {
  const [pip, setPip] = useState<{ window: Window; opening: Opening } | null>(null);
  const pendingRequest = useRef<Promise<Window> | null>(null);

  const request = useCallback(
    (opening: Opening) => {
      if (!api || api.window || pendingRequest.current) {
        return;
      }
      const pending = api.requestWindow(WINDOW_SIZE);
      pendingRequest.current = pending;
      pending
        .then(
          (win) => {
            copyStyleSheets(doc, win.document);
            setPip({ window: win, opening });
          },
          (err: unknown) => console.warn('Picture-in-picture window refused', err),
        )
        .finally(() => {
          pendingRequest.current = null;
        });
    },
    [api, doc],
  );

  useEffect(() => {
    if (!api || !mediaSession) {
      return;
    }
    try {
      mediaSession.setActionHandler('enterpictureinpicture', () => request('auto'));
    } catch {
      return;
    }
    return () => mediaSession.setActionHandler('enterpictureinpicture', null);
  }, [api, mediaSession, request]);

  useEffect(() => {
    if (!pip) {
      return;
    }
    const onClosed = () => setPip(null);
    pip.window.addEventListener('pagehide', onClosed);
    return () => {
      pip.window.removeEventListener('pagehide', onClosed);
      pip.window.close();
    };
  }, [pip]);

  useEffect(() => {
    if (pip?.opening !== 'auto') {
      return;
    }
    const onVisibilityChange = () => {
      if (doc.visibilityState === 'visible') {
        setPip(null);
      }
    };
    doc.addEventListener('visibilitychange', onVisibilityChange);
    return () => doc.removeEventListener('visibilitychange', onVisibilityChange);
  }, [pip, doc]);

  // A window still being requested at unmount is closed as soon as it arrives.
  useEffect(
    () => () => {
      void pendingRequest.current?.then(
        (win) => win.close(),
        () => {},
      );
    },
    [],
  );

  const open = useCallback(() => request('manual'), [request]);
  const close = useCallback(() => setPip(null), []);
  return { supported: api !== null, pipWindow: pip?.window ?? null, open, close };
}
