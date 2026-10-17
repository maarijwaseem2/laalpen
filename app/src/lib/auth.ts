import { create } from 'zustand';
import { secure } from './storage';
import type { Session, User } from './types';

const KEY = 'laalpen.session';
/** a class / card code (from a QR) waiting to be linked once the family account exists */
export const PENDING_CODE_KEY = 'laalpen.pending.code';

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

export const isStaffRole = (role?: string) => role === 'SUPER_ADMIN' || role === 'PRINCIPAL' || role === 'TEACHER';

/** Where an account lands: setup steps first (school profile, teacher approval), then its home. */
export const homeFor = (role?: string, user?: User | null) => {
  if (role === 'SUPER_ADMIN') return '/platform';
  if (role === 'PRINCIPAL' && user?.school && user.school.profileComplete === false) return '/school-setup';
  if (role === 'TEACHER' && user?.teacher && user.teacher.status !== 'APPROVED') return '/teacher-setup';
  if (role === 'STUDENT' && user && !user.student) return '/pending';
  return role === 'PRINCIPAL' ? '/admin' : role === 'TEACHER' ? '/teacher' : role === 'PARENT' ? '/parent' : '/student';
};
