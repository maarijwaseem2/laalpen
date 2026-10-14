import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { api, ApiError } from './api';
import { prefs } from './storage';

/**
 * Class capture upload queue. Every page is saved on the phone first (compressed to ~1600px JPEG),
 * then uploaded straight to storage with a presigned link and confirmed per student. Retries survive
 * bad Wi-Fi and app restarts (the queue is stored on the phone); the server ignores repeats.
 */
export interface QPage { localId: string; pageNo: number; uri: string; key?: string }
export interface QItem {
  testId: string;
  batchId: string | null;
  studentId: string;
  name: string;
  pages: QPage[];
  state: 'waiting' | 'uploading' | 'done' | 'error';
  error?: string;
  tries: number;
  nextTry: number;
}

const KEY = 'laalpen.capture.queue';
const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Shrinks a camera photo: enough for reading handwriting, ~200–400 KB instead of 3–5 MB. */
export async function compress(uri: string) {
  try {
    const r = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG });
    return r.uri;
  } catch {
    return uri;
  }
}

interface QueueState {
  items: QItem[];
  loaded: boolean;
  running: boolean;
  load: () => Promise<void>;
  add: (item: Omit<QItem, 'state' | 'tries' | 'nextTry'>) => void;
  retry: (studentId: string, testId: string) => void;
  clearDone: (testId: string) => void;
  run: () => Promise<void>;
}

const save = (items: QItem[]) => {
  // web blob: links die on reload, so only phones keep the queue across restarts
  if (Platform.OS !== 'web') void prefs.set(KEY, JSON.stringify(items.filter((i) => i.state !== 'done')));
};

export const useUploadQueue = create<QueueState>((set, get) => ({
  items: [],
  loaded: false,
  running: false,
  async load() {
    if (get().loaded) return;
    const raw = Platform.OS === 'web' ? null : await prefs.get(KEY);
    const items = raw ? (JSON.parse(raw) as QItem[]).map((i) => ({ ...i, state: i.state === 'uploading' ? ('waiting' as const) : i.state })) : [];
    set({ items, loaded: true });
  },
  add(item) {
    const items = [...get().items.filter((i) => !(i.testId === item.testId && i.studentId === item.studentId)), { ...item, state: 'waiting' as const, tries: 0, nextTry: 0 }];
    set({ items });
    save(items);
    void get().run();
  },
  retry(studentId, testId) {
    const items = get().items.map((i) => (i.studentId === studentId && i.testId === testId ? { ...i, state: 'waiting' as const, nextTry: 0, error: undefined } : i));
    set({ items });
    save(items);
    void get().run();
  },
  clearDone(testId) {
    set({ items: get().items.filter((i) => !(i.testId === testId && i.state === 'done')) });
  },
  async run() {
    if (get().running) return;
    set({ running: true });
    try {
      for (;;) {
        const now = Date.now();
        const next = get().items.find((i) => i.state === 'waiting' && i.nextTry <= now);
        if (!next) break;
        const patch = (p: Partial<QItem>) => {
          const items = get().items.map((i) => (i.studentId === next.studentId && i.testId === next.testId ? { ...i, ...p } : i));
          set({ items });
          save(items);
        };
        patch({ state: 'uploading' });
        try {
          const pages: QPage[] = [];
          for (const p of next.pages) {
            if (p.key) {
              pages.push(p);
              continue;
            }
            const pre = await api.post<{ alreadyUploaded: boolean; key: string; url?: string; headers?: Record<string, string> }>('/teacher/uploads/presign', { testId: next.testId, studentId: next.studentId, pageNo: p.pageNo, localId: p.localId, contentType: 'image/jpeg' });
            if (!pre.alreadyUploaded && pre.url) {
              const blob = await (await fetch(p.uri)).blob();
              const res = await fetch(pre.url, { method: 'PUT', headers: pre.headers ?? { 'content-type': 'image/jpeg' }, body: blob });
              if (!res.ok) throw new ApiError(res.status, `Upload failed (${res.status})`);
            }
            pages.push({ ...p, key: pre.key });
            patch({ pages: [...pages, ...next.pages.slice(pages.length)] });
          }
          await api.post('/teacher/uploads/confirm', { testId: next.testId, studentId: next.studentId, batchId: next.batchId ?? undefined, pages: pages.map((p) => ({ pageNo: p.pageNo, localId: p.localId, key: p.key! })) });
          patch({ state: 'done', error: undefined });
        } catch (e) {
          const status = e instanceof ApiError ? e.status : 0;
          const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
          const tries = next.tries + 1;
          patch({ state: permanent ? 'error' : 'waiting', tries, error: (e as Error).message, nextTry: Date.now() + Math.min(60_000, 2000 * 2 ** tries) });
          if (!permanent) await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } finally {
      set({ running: false });
      // something is still waiting for its retry time
      const later = get().items.filter((i) => i.state === 'waiting').map((i) => i.nextTry);
      if (later.length) setTimeout(() => void get().run(), Math.max(500, Math.min(...later) - Date.now()));
    }
  },
}));

export const newPage = async (uri: string, pageNo: number): Promise<QPage> => ({ localId: id(), pageNo, uri: await compress(uri) });
