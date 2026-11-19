import { Dialog } from '../Dialog';
import { Button } from '../hud/ui/Button';

export function JoinPrompt({ onJoin, onCancel }: { onJoin: () => void; onCancel: () => void }) {
  return (
    <Dialog title="Already in this office" onClose={onCancel}>
      <p className="mb-5 text-hud-text-2">You're already in this office in another window or device. Joining here will disconnect it.</p>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button tone="primary" onClick={onJoin}>
          Join anyway
        </Button>
      </div>
    </Dialog>
  );
}
