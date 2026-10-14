import { Platform } from 'react-native';
import { api } from './api';
import type { Notification } from './types';

/** Browser (web app) alerts: the bell polls every 30 s; new unread items also pop up as a desktop notification. */
const supported = () => Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window;

export const webAlerts = {
  supported,
  state: (): 'granted' | 'denied' | 'default' | 'unsupported' => (supported() ? (window.Notification.permission as any) : 'unsupported'),
  async enable() {
    if (!supported()) return 'unsupported';
    return window.Notification.requestPermission();
  },
};

let lastSeen: string | null = null;

/** Called when the unread count changes; shows each notification at most once per tab. */
export async function popNewOnWeb(count: number) {
  if (!supported() || window.Notification.permission !== 'granted' || !count) return;
  try {
    const list = await api.get<Notification[]>('/notifications');
    const unread = list.filter((n) => !n.readAt);
    const seen = lastSeen;
    lastSeen = unread[0]?.createdAt ?? lastSeen;
    if (seen === null) return; // first poll after load: don't replay old items
    for (const n of unread.filter((x) => x.createdAt > seen).slice(0, 3).reverse()) {
      const pop = new window.Notification(n.title, { body: n.body, tag: n.id, icon: '/favicon.ico' });
      pop.onclick = () => { window.focus(); window.location.assign('/notifications'); };
    }
  } catch {
    /* alerts are optional */
  }
}
