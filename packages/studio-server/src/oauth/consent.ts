import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

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

export function sendError(res: Response, status: 401 | 403, message: string) {
  sendHtml(res, status, STATUS_CODES[status]!, `<p>${escapeHtml(message)}</p>`);
}
