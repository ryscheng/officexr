import type { Response } from 'express';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

/** Values that can be taken out once, before they expire; expired ones are dropped as new ones arrive. */
export class TakeOnce<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => Date,
  ) {}

  put(key: string, value: V) {
    const now = this.now().getTime();
    for (const [k, entry] of this.entries) {
      if (entry.expires <= now) {
        this.entries.delete(k);
      }
    }
    this.entries.set(key, { value, expires: now + this.ttlMs });
  }

  take(key: string): V | null {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    return entry && entry.expires > this.now().getTime() ? entry.value : null;
  }
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function sendHtml(res: Response, status: number, title: string, body: string) {
  // Framing is refused so the Allow button can't be clickjacked. No form-action: browsers apply it to the consent
  // POST's redirect, which goes to the client's redirect_uri.
  res
    .status(status)
    .set({ 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Cache-Control': 'no-store' })
    .type('html')
    .send(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`);
}

export function sendConsentPage(res: Response, client: OAuthClientInformationFull, redirectUri: string, csrfToken: string) {
  sendHtml(
    res,
    200,
    'Authorize MCP client',
    `<h1>Allow ${escapeHtml(client.client_name ?? client.client_id)} to use the OfficeXR studio MCP?</h1>
<p>It will be sent back to <code>${escapeHtml(redirectUri)}</code>.</p>
<form method="post" action="/authorize/consent">
<input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
<button type="submit">Allow</button>
</form>`,
  );
}

export function sendForbidden(res: Response, message: string) {
  sendHtml(res, 403, 'Forbidden', `<p>${escapeHtml(message)}</p>`);
}
