import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { PENDING_CODE_KEY, useAuth } from '@/lib/auth';
import { prefs } from '@/lib/storage';

/** QR on a claim card: laalpen://claim?code=K7QP3MXA → the Parent / Student account links it from the one code box. */
export default function Claim() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const user = useAuth((s) => s.user);
  useEffect(() => {
    if (code) void prefs.set(PENDING_CODE_KEY, code);
  }, [code]);
  if (user?.role === 'PARENT') return <Redirect href={{ pathname: '/parent', params: code ? { code } : {} }} />;
  return <Redirect href={{ pathname: '/register', params: code ? { code } : {} }} />;
}
