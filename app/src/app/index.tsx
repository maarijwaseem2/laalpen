import { Redirect } from 'expo-router';
import { homeFor, useAuth } from '@/lib/auth';

export default function Index() {
  const user = useAuth((s) => s.user);
  return <Redirect href={(user ? homeFor(user.role, user) : '/login') as any} />;
}
