export async function copyLink(text: string, field: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    field?.focus();
    field?.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export const canShare = () => typeof navigator.share === 'function';
