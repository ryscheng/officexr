const images = new Map<string, string>();

export const cachedCharacterPortrait = (url: string): string | null => images.get(url) ?? null;

export const storeCharacterPortrait = (url: string, image: string): void => {
  images.set(url, image);
};
