import { Dialog } from '../Dialog';

export function JoinPrompt({ onJoin, onCancel }: { onJoin: () => void; onCancel: () => void }) {
  return (
    <Dialog title="Already in this office" onClose={onCancel}>
      <p className="mb-4">You're already in this office in another window or device. Joining here will disconnect it.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded border px-3 py-1" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="rounded bg-black px-3 py-1 text-white" onClick={onJoin}>
          Join anyway
        </button>
      </div>
    </Dialog>
  );
}
