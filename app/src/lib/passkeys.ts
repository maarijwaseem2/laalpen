import { Platform } from 'react-native';
import { api } from './api';
import { deviceInfo } from './device';
import type { Session } from './types';

/**
 * Passkeys (fingerprint / face / Windows Hello / security key) — in the browser for now.
 * The Android/iOS app keeps password + authenticator app; native passkeys need a store build.
 */
export const passkeysSupported = () => Platform.OS === 'web' && typeof (globalThis as any).PublicKeyCredential === 'function';

export async function addPasskey(name: string) {
  const { startRegistration } = await import('@simplewebauthn/browser');
  const { challengeId, options } = await api.post<{ challengeId: string; options: any }>('/auth/passkeys/register/options');
  const response = await startRegistration({ optionsJSON: options });
  return api.post<{ id: string; name: string }>('/auth/passkeys/register/verify', { challengeId, response, name });
}

export async function signInWithPasskey(email?: string): Promise<Session> {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const { challengeId, options } = await api.public<{ challengeId: string; options: any }>('/auth/passkeys/login/options', email ? { email } : {});
  const response = await startAuthentication({ optionsJSON: options });
  return api.public<Session>('/auth/passkeys/login/verify', { challengeId, response, ...(await deviceInfo()) });
}
