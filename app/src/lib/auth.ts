import { create } from 'zustand';
import { secure } from './storage';
import type { Session, User } from './types';

const KEY = 'laalpen.session';

interface AuthState {
  ready: boolean;
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  load: () => Promise<void>;
  setSession: (s: Session) => Promise<void>;
  setUser: (u: User) => void;
  clear: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  ready: false,
  user: null,
  accessToken: null,
  refreshToken: null,
  async load() {
    try {
      const raw = await secure.get(KEY);
      if (raw) {
        const s = JSON.parse(raw) as Session;
        set({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken });
      }
    } finally {
      set({ ready: true });
    }
  },
  async setSession(s) {
    set({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken });
    await secure.set(KEY, JSON.stringify(s));
  },
  setUser(user) {
    set({ user });
    const { accessToken, refreshToken } = get();
    if (accessToken && refreshToken) void secure.set(KEY, JSON.stringify({ user, accessToken, refreshToken }));
  },
  async clear() {
    set({ user: null, accessToken: null, refreshToken: null });
    await secure.remove(KEY);
  },
}));

export const homeFor = (role?: string, user?: User | null) => {
  if (role === 'STUDENT' && user && !user.student) return '/pending';
  return role === 'ADMIN' ? '/admin' : role === 'TEACHER' ? '/teacher' : role === 'PARENT' ? '/parent' : '/student';
};
