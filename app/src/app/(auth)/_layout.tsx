import { Redirect, Stack } from 'expo-router';
import { homeFor, useAuth } from '@/lib/auth';

export default function AuthLayout() {
  const user = useAuth((s) => s.user);
  if (user) return <Redirect href={homeFor(user.role, user) as any} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
