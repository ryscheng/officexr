import { useId, type ComponentProps, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Fold } from '../foldPrefs';
import { Panel, PanelTitle } from './Panel';

type FoldablePanelProps = Omit<ComponentProps<typeof Panel>, 'title'> & {
  fold: Fold;
  title: ReactNode;
  label: string;
  headerExtra?: ReactNode;
  titleClassName?: string;
};

export function FoldablePanel({ fold, title, label, headerExtra, titleClassName, children, ...panel }: FoldablePanelProps) {
  const bodyId = useId();
  return (
    <Panel {...panel}>
      <div className="flex shrink-0 items-center gap-2">
        <PanelTitle className={titleClassName}>{title}</PanelTitle>
        <span className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          {headerExtra}
          <button
            type="button"
            aria-label={`${fold.folded ? 'Expand' : 'Collapse'} ${label}`}
            aria-expanded={!fold.folded}
            aria-controls={fold.folded ? undefined : bodyId}
            onMouseDown={(e) => e.preventDefault()}
            onClick={fold.toggle}
            className="flex items-center rounded-lg p-1 text-hud-text-2 hover:bg-hud-hover hover:text-hud-text focus-visible:outline-2 focus-visible:outline-hud-accent pointer-coarse:min-h-12 pointer-coarse:min-w-12 pointer-coarse:justify-center"
          >
            {fold.folded ? <ChevronUp aria-hidden className="size-4" /> : <ChevronDown aria-hidden className="size-4" />}
          </button>
        </span>
      </div>
      {!fold.folded && (
        <div id={bodyId} className="contents">
          {children}
        </div>
      )}
    </Panel>
  );
}
