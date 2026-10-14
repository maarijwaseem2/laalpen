import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { secure } from './storage';

const KEY = 'laalpen.deviceId';
let cached: string | null = null;

const random = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');

/**
 * A random id kept in secure storage: lets the server recognise "this phone" (new-device alerts)
 * without fingerprinting. Clearing app data simply makes it a new device.
 */
export async function deviceInfo(): Promise<{ deviceId: string; deviceName: string }> {
  if (!cached) {
    cached = (await secure.get(KEY)) ?? null;
    if (!cached) {
      cached = `${Platform.OS}-${random()}`;
      await secure.set(KEY, cached);
    }
  }
  const name = Platform.OS === 'web' ? webName() : [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || Platform.OS;
  return { deviceId: cached, deviceName: name.slice(0, 80) };
}

function webName() {
  const ua = (globalThis.navigator?.userAgent ?? '').toLowerCase();
  const browser = ua.includes('edg/') ? 'Edge' : ua.includes('chrome') ? 'Chrome' : ua.includes('firefox') ? 'Firefox' : ua.includes('safari') ? 'Safari' : 'Browser';
  const os = ua.includes('windows') ? 'Windows' : ua.includes('android') ? 'Android' : ua.includes('iphone') ? 'iPhone' : ua.includes('mac') ? 'Mac' : ua.includes('linux') ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}
