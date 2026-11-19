import type { ComponentProps } from 'react';
import { PresenceList } from '../hud/PresenceList';
import { useStatusHud } from './SelfStatusProvider';

export function PresenceListWithStatus(props: Omit<ComponentProps<typeof PresenceList>, 'onEditSelf'>) {
  const hud = useStatusHud();
  return <PresenceList {...props} onEditSelf={hud ? () => hud.setStatusMenuOpen(true) : undefined} />;
}
