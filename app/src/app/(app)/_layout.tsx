import { Redirect, Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { Shell } from '@/components/Shell';
import { homeFor, useAuth } from '@/lib/auth';
import { registerForPush } from '@/lib/push';
import { useAppTheme } from '@/components/ui';

const AREA: Record<string, string> = { admin: 'ADMIN', teacher: 'TEACHER', student: 'STUDENT', parent: 'PARENT' };

export default function AppLayout() {
  const user = useAuth((s) => s.user);
  const path = usePathname();
  const t = useAppTheme();
  useEffect(() => {
    if (user) void registerForPush();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return <Redirect href="/login" />;
  // admins see the whole school's data: authenticator app first
  if (user.mfaSetupRequired && !path.startsWith('/security')) return <Redirect href="/security/two-factor" />;
  if (user.role === 'STUDENT' && !user.student) return <Redirect href="/pending" />;
  const area = AREA[path.split('/')[1] ?? ''];
  if (path.startsWith('/requests') && (user.role === 'STUDENT' || user.role === 'PARENT')) return <Redirect href={homeFor(user.role, user) as any} />;
  if (area && area !== user.role) return <Redirect href={homeFor(user.role, user) as any} />;

  return (
    <Shell>
      <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: t.colors.background } }} />
    </Shell>
  );
}
