import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { Card, Empty, ErrorView, Loading, PageHeader, Screen, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { queryClient } from '@/lib/query';
import type { Notification } from '@/lib/types';
import { webAlerts } from '@/lib/webNotify';

const ICON = { INFO: 'information-outline', ACCOUNT: 'account-outline', CHECKING: 'robot-outline', RESULT: 'draw-pen' } as const;

export default function Notifications() {
  const t = useAppTheme();
  const role = useAuth((s) => s.user?.role);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/notifications'), refetchInterval: 30_000 });

  const open = async (n: Notification) => {
    if (!n.readAt) {
      await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ['unread'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
    const d = n.data ?? {};
    if (d.joinRequests && role !== 'STUDENT') router.push('/requests');
    else if (d.submissionId && role === 'PARENT') router.push(`/parent/result/${d.submissionId}` as any);
    else if (d.submissionId) router.push((role === 'STUDENT' ? `/student/result/${d.submissionId}` : `/teacher/submission/${d.submissionId}`) as any);
    else if (d.testId && role === 'TEACHER') router.push(`/teacher/test/${d.testId}`);
    else if (d.assignmentId && role === 'TEACHER') router.push(`/teacher/assignment/${d.assignmentId}`);
  };

  const readAll = async () => {
    await api.post('/notifications/read-all');
    await queryClient.invalidateQueries();
  };

  const unread = q.data?.filter((n) => !n.readAt).length ?? 0;
  const [alerts, setAlerts] = useState(webAlerts.state());
  return (
    <Screen maxWidth={760} onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader title="Notifications" subtitle={unread ? `${unread} unread` : 'You are all caught up.'} actions={unread ? <Button onPress={readAll}>Mark all read</Button> : null} />
      {alerts === 'default' ? (
        <Card>
          <Text variant="bodyMedium">Get a pop-up in this browser when a copy is checked or a result is published.</Text>
          <Button mode="outlined" icon="bell-ring-outline" style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={async () => setAlerts((await webAlerts.enable()) as any)}>Turn on browser alerts</Button>
        </Card>
      ) : null}
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <Empty title="No notifications yet" body="Results, checking updates and account news show up here." /> : null}
      {q.data?.length ? (
        <Card style={{ padding: 0 }}>
          {q.data.map((n, i) => (
            <Pressable key={n.id} onPress={() => open(n)} accessibilityRole="button" style={({ hovered }: any) => ({ backgroundColor: hovered ? t.colors.surfaceVariant : n.readAt ? 'transparent' : t.colors.primaryContainer + '55', borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.outlineVariant })}>
              <View style={{ flexDirection: 'row', gap: 14, padding: 16, alignItems: 'flex-start' }}>
                <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: n.type === 'RESULT' ? t.colors.primaryContainer : n.type === 'CHECKING' ? t.app.infoBg : t.colors.surfaceVariant }}>
                  <MaterialCommunityIcons name={ICON[n.type]} size={20} color={n.type === 'RESULT' ? t.colors.primary : n.type === 'CHECKING' ? t.app.info : t.colors.onSurfaceVariant} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="titleSmall">{n.title}</Text>
                  <Text variant="bodyMedium" style={{ color: t.colors.onSurfaceVariant }}>{n.body}</Text>
                  <Text variant="bodySmall" style={{ color: t.app.muted, marginTop: 2 }}>{timeAgo(n.createdAt)}</Text>
                </View>
                {!n.readAt ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.colors.primary, marginTop: 6 }} accessibilityLabel="Unread" /> : null}
              </View>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
