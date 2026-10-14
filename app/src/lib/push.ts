import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api, request } from './api';
import { secure } from './storage';

const PUSH_KEY = 'laalpen.pushToken';

/** On logout: this phone stops receiving the user's notifications. */
export async function unregisterPush() {
  try {
    const token = await secure.get(PUSH_KEY);
    if (token) await request('/notifications/push-token', { method: 'DELETE', body: { token } });
    await secure.remove(PUSH_KEY);
  } catch {
    /* best effort */
  }
}

/**
 * Registers this phone for push notifications (free, via Expo Push).
 * Skipped on web, emulators and Expo Go — the in-app bell still shows every notification there.
 */
export async function registerForPush() {
  try {
    if (Platform.OS === 'web' || !Device.isDevice || Constants.executionEnvironment === 'storeClient') return;
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'LaalPen', importance: Notifications.AndroidImportance.HIGH, lightColor: '#C8102E' });
    }
    const current = await Notifications.getPermissionsAsync();
    const status = current.granted ? 'granted' : (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) return; // run `npx eas init` once to enable remote push
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api.post('/notifications/push-token', { token, platform: Platform.OS });
    await secure.set(PUSH_KEY, token);
  } catch {
    /* push is optional */
  }
}
