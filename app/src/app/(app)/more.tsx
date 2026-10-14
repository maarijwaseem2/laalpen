import { router } from 'expo-router';
import { Divider, List } from 'react-native-paper';
import { NAV } from '@/components/Shell';
import { Card, PageHeader, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** Phones: the pages that do not fit in the tab bar. */
export default function More() {
  const user = useAuth((s) => s.user);
  if (!user) return null;
  const rest = [...NAV[user.role].slice(3), { href: '/notifications', label: 'Notifications', icon: 'bell-outline' }];
  return (
    <Screen maxWidth={640}>
      <PageHeader title="More" />
      <Card style={{ padding: 0 }}>
        {rest.map((it, i) => (
          <List.Item key={it.href} title={it.label} left={(p) => <List.Icon {...p} icon={it.icon} />} right={(p) => <List.Icon {...p} icon="chevron-right" />} onPress={() => router.push(it.href as any)} style={i ? { borderTopWidth: 0 } : undefined} />
        )).flatMap((el, i) => (i ? [<Divider key={`d${i}`} />, el] : [el]))}
      </Card>
    </Screen>
  );
}
