// Touch only counts as user activation on release, so pointerdown alone never resumes on a tablet.
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown'];

/**
 * Resumes a context the browser started suspended on the next user gesture, and keeps listening
 * until it is running (a refused resume waits for the following gesture). Returns a remover.
 */
export function resumeOnGesture(context: Pick<AudioContext, 'state' | 'resume'>, target: EventTarget): () => void {
  const remove = () => GESTURES.forEach((type) => target.removeEventListener(type, resume));
  const resume = () => {
    context.resume().then(
      () => context.state === 'running' && remove(),
      () => {},
    );
  };
  if (context.state === 'suspended') {
    GESTURES.forEach((type) => target.addEventListener(type, resume));
  }
  return remove;
}
