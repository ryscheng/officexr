export const LOOK_DRAG_THRESHOLD_PX = 4;

const LEFT = 0;
const RIGHT = 2;

export interface DesktopLookOptions {
  canvas: HTMLElement;
  onLook: (movementX: number, movementY: number) => void;
  thresholdPx?: number;
}

/**
 * Mouse look that leaves the cursor free: the right button turns the view at once, the left button
 * after a drag past the threshold. Pointer lock is requested only while turning; a refused lock
 * falls back to the unlocked movement deltas, which the browser still reports with a button down.
 */
export function attachDesktopLook({ canvas, onLook, thresholdPx = LOOK_DRAG_THRESHOLD_PX }: DesktopLookOptions): () => void {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView ?? window;
  const held = new Set<number>();
  let origin = { x: 0, y: 0 };
  let turning = false;
  let suppressClick = false;

  const beginTurn = () => {
    turning = true;
    if (doc.pointerLockElement === canvas) return;
    try {
      void Promise.resolve(canvas.requestPointerLock?.()).catch(() => undefined);
    } catch {
      // lock refused: the unlocked deltas keep turning the view
    }
  };

  const endTurn = () => {
    if (turning && doc.pointerLockElement === canvas) doc.exitPointerLock?.();
    turning = false;
  };

  const release = (button: number) => {
    held.delete(button);
    if (held.size === 0) endTurn();
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== LEFT && e.button !== RIGHT) return;
    if (held.size === 0) {
      origin = { x: e.clientX, y: e.clientY };
      suppressClick = false;
    }
    held.add(e.button);
    if (e.button === RIGHT && !turning) beginTurn();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (held.size === 0) return;
    if (!turning && held.has(LEFT) && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) >= thresholdPx) {
      beginTurn();
    }
    if (!turning) return;
    suppressClick = true;
    onLook(e.movementX, e.movementY);
  };

  const onMouseUp = (e: MouseEvent) => release(e.button);

  const onClick = (e: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopPropagation();
  };

  const onContextMenu = (e: MouseEvent) => e.preventDefault();

  const onBlur = () => {
    held.clear();
    endTurn();
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('click', onClick, true);
  doc.addEventListener('mousemove', onMouseMove);
  win.addEventListener('mouseup', onMouseUp);
  win.addEventListener('blur', onBlur);
  return () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('click', onClick, true);
    doc.removeEventListener('mousemove', onMouseMove);
    win.removeEventListener('mouseup', onMouseUp);
    win.removeEventListener('blur', onBlur);
    held.clear();
    endTurn();
  };
}
