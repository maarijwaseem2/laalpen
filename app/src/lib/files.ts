import { Linking, Platform } from 'react-native';
import { API_URL } from './config';

/** Signed file links from the API (PDF cards, Excel template, CSV of problems) open in the browser / viewer. */
export async function openFile(url: string) {
  const full = url.startsWith('http') ? url : `${API_URL}${url}`;
  if (Platform.OS === 'web') {
    globalThis.open?.(full, '_blank', 'noopener');
    return;
  }
  await Linking.openURL(full);
}
