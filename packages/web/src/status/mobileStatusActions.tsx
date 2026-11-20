import { useMemo } from 'react';
import { Hand, SmilePlus } from 'lucide-react';
import { useMobileActions, type MobileAction } from '@officexr/world/react';
import { useStatusHud } from './SelfStatusProvider';

/** The hand and emote buttons of the touch pad; they call what H and R call. */
export function statusMobileActions(status: {
  handRaised: boolean;
  toggleHand: () => void;
  toggleEmotePicker: () => void;
}): MobileAction[] {
  return [
    {
      id: 'emote',
      slot: 4,
      icon: <SmilePlus aria-hidden size={22} />,
      label: 'Emote',
      onPress: status.toggleEmotePicker,
    },
    {
      id: 'hand',
      slot: 5,
      icon: <Hand aria-hidden size={22} />,
      label: status.handRaised ? 'Lower hand' : 'Hand',
      active: () => status.handRaised,
      onPress: status.toggleHand,
    },
  ];
}

/** Adds the status buttons to the touch action pad; renders nothing. */
export function StatusMobileActions() {
  const hud = useStatusHud();
  const handRaised = hud?.handRaised ?? false;
  const toggleHand = hud?.toggleHand;
  const toggleEmotePicker = hud?.toggleEmotePicker;
  const actions = useMemo(
    () => (toggleHand && toggleEmotePicker ? statusMobileActions({ handRaised, toggleHand, toggleEmotePicker }) : []),
    [handRaised, toggleHand, toggleEmotePicker],
  );
  useMobileActions(actions);
  return null;
}
