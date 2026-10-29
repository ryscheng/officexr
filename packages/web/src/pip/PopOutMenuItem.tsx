import { RoomMenuItem } from '../room/RoomMenu';
import type { PictureInPicture } from './usePictureInPicture';

export function PopOutMenuItem({ pip }: { pip: Pick<PictureInPicture, 'supported' | 'open'> }) {
  return pip.supported ? <RoomMenuItem onSelect={pip.open}>Pop out</RoomMenuItem> : null;
}
