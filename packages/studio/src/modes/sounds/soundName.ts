import { isValidSceneName } from '@officexr/world';

const MP3_SUFFIX = /\.mp3$/i;

export type SoundNameCheck =
  | { type: 'ok'; name: string }
  | { type: 'invalid'; error: string; suggestion: string };

/** Derives a sound name from a file name; the server rejects names that are not scene-safe or that keep a dot after `.mp3` is stripped. */
export function soundNameFromFile(fileName: string): SoundNameCheck {
  if (!MP3_SUFFIX.test(fileName)) {
    return { type: 'invalid', error: `"${fileName}" is not an .mp3 file.`, suggestion: '' };
  }
  const name = fileName.replace(MP3_SUFFIX, '');
  if (isValidSceneName(name) && !name.includes('.')) {
    return { type: 'ok', name };
  }
  const suggestion = name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return {
    type: 'invalid',
    error: `"${name}" is not a valid sound name: use letters, digits, "_" or "-" (max 64 chars).`,
    suggestion,
  };
}
