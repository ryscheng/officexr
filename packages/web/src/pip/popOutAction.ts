import type { SettingsAction } from '../room/Settings';
import { closingAction } from '../room/SettingsModal';
import type { PictureInPicture } from './usePictureInPicture';

export const popOutActions = (pip: Pick<PictureInPicture, 'supported' | 'pipWindow' | 'open'>): SettingsAction[] =>
  pip.supported && !pip.pipWindow ? [closingAction('pop-out', 'Pop out', pip.open)] : [];
