import { useId, type ReactNode } from 'react';
import { Modal } from './hud/ui/Modal';
import { PanelTitle } from './hud/ui/Panel';

/** A modal over the room. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  return (
    <Modal
      labelledBy={titleId}
      onEscape={onClose}
      className="z-50 bg-black/50"
      panelClassName="w-full max-w-md p-4 text-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <PanelTitle id={titleId} className="mb-3 text-base">
        {title}
      </PanelTitle>
      {children}
    </Modal>
  );
}
