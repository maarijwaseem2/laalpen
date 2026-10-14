import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the backend lives.
 * - EXPO_PUBLIC_API_URL wins when set (production).
 * - In development on a phone, we reuse the IP of the computer running `expo start`,
 *   so the phone reaches the backend on port 4000 over the same Wi-Fi with no setup.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.hostname) return `${window.location.protocol}//${window.location.hostname}:4000`;
    return 'http://localhost:4000';
  }
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:4000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}

export const API_URL = resolveApiUrl();

/** Turns a relative signed file link from the API into a full URL. */
export const fileUrl = (path?: string | null) => (path ? (path.startsWith('http') ? path : `${API_URL}${path}`) : undefined);

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};
export const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
export const googleEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
