import { Redirect, Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { Shell } from '@/components/Shell';
import { homeFor, useAuth } from '@/lib/auth';
import { registerForPush } from '@/lib/push';
import { useAppTheme } from '@/components/ui';

const AREA: Record<string, string> = { platform: 'SUPER_ADMIN', admin: 'PRINCIPAL', teacher: 'TEACHER', student: 'STUDENT', parent: 'PARENT' };

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
  // setup steps: a principal completes the school profile; a teacher completes theirs and waits for approval
  if (user.role === 'PRINCIPAL' && user.school?.profileComplete === false && !path.startsWith('/security')) return <Redirect href="/school-setup" />;
  if (user.role === 'TEACHER' && user.teacher && user.teacher.status !== 'APPROVED' && !path.startsWith('/security') && !path.startsWith('/profile') && !path.startsWith('/notifications')) return <Redirect href="/teacher-setup" />;
  const area = AREA[path.split('/')[1] ?? ''];
  if (path.startsWith('/requests') && (user.role === 'STUDENT' || user.role === 'PARENT' || user.role === 'SUPER_ADMIN')) return <Redirect href={homeFor(user.role, user) as any} />;
  if (area && area !== user.role) return <Redirect href={homeFor(user.role, user) as any} />;

  return (
    <Shell>
      <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: t.colors.background } }} />
    </Shell>
  );
}
