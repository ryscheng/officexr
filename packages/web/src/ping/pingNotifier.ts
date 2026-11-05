import type { PingPrefs } from './pingPrefs';

type NotificationCtor = new (title: string, options?: NotificationOptions) => Pick<Notification, 'close' | 'onclick'>;

export interface PingNotifierEnv {
  Notification?: NotificationCtor & { permission: NotificationPermission };
  document: Pick<Document, 'hidden' | 'hasFocus'>;
  window: Pick<Window, 'focus'>;
}

export type NotificationSeam = NotificationCtor & Pick<typeof Notification, 'permission' | 'requestPermission'>;

export const browserNotification = (): NotificationSeam | null =>
  typeof Notification === 'undefined' ? null : Notification;

const browserEnv = (): PingNotifierEnv => ({
  Notification: browserNotification() ?? undefined,
  document,
  window,
});

export function maybeNotify(prefs: PingPrefs, senderName: string, env: PingNotifierEnv = browserEnv()): void {
  const { Notification: Notify } = env;
  const attending = !env.document.hidden && env.document.hasFocus();
  if (!prefs.notify || !Notify || Notify.permission !== 'granted' || attending) {
    return;
  }
  const notification = new Notify(`${senderName} pinged you`, { tag: 'officexr-ping' });
  notification.onclick = () => {
    env.window.focus();
    notification.close();
  };
}
