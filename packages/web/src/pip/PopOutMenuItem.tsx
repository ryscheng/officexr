import { RoomMenuItem } from '../room/RoomMenu';
import type { PictureInPicture } from './usePictureInPicture';

export function PopOutMenuItem({ pip }: { pip: Pick<PictureInPicture, 'supported' | 'pipWindow' | 'open'> }) {
  return pip.supported && !pip.pipWindow ? <RoomMenuItem onSelect={pip.open}>Pop out</RoomMenuItem> : null;
}
