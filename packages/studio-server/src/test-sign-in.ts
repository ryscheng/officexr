import { createHmac, randomUUID } from 'node:crypto';
import type session from 'express-session';

/** A session cookie for `login`, stored the way the web backend's sign-in leaves it. */
export async function signIn(store: session.Store, secret: string, login: string) {
  const sid = randomUUID();
  const sess = { cookie: { originalMaxAge: null, path: '/' }, passport: { user: { login, name: login } } };
  await new Promise<void>((resolve, reject) => store.set(sid, sess as unknown as session.SessionData, (err) => (err ? reject(err) : resolve())));
  const signature = createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return `officexr.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}
