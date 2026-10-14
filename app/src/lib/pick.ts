import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export interface PickedPage {
  uri: string;
  name: string;
  type: string;
  width?: number;
  height?: number;
}

/** Photograph or choose answer-copy pages. Works on Android, iOS and web. */
export async function pickPages(source: 'camera' | 'library', limit = 12): Promise<PickedPage[]> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Allow camera access in settings to photograph copies.');
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: source === 'library', selectionLimit: limit };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled) return [];
  return res.assets.map((a, i) => {
    const type = a.mimeType && a.mimeType.startsWith('image/') ? a.mimeType : 'image/jpeg';
    const ext = type.split('/')[1] === 'png' ? 'png' : type.split('/')[1] === 'webp' ? 'webp' : 'jpg';
    return { uri: a.uri, name: a.fileName || `page-${i + 1}.${ext}`, type, width: a.width, height: a.height };
  });
}

export async function pagesForm(pages: PickedPage[]): Promise<FormData> {
  const form = new FormData();
  for (const p of pages) {
    if (Platform.OS === 'web') {
      const blob = await (await fetch(p.uri)).blob();
      form.append('pages', blob, p.name);
    } else {
      form.append('pages', { uri: p.uri, name: p.name, type: p.type } as any);
    }
  }
  return form;
}
