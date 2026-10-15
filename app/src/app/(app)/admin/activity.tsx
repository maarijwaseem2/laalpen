import { useInfiniteQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { Card, Empty, ErrorView, Loading, PageHeader, Screen, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

interface Log { id: string; createdAt: string; action: string; entity: string; entityId: string | null; actorRole: string | null; reason: string | null; after: Record<string, unknown> | null; ip: string | null }

const LABEL: Record<string, string> = {
  'answer.edit': 'Changed a mark', 'answer.revert': 'Undid a mark change', 'copy.approve': 'Approved a copy', 'copy.unapprove': 'Took back an approval', 'copy.reopen': 'Re-opened published marks',
  'test.publish': 'Published results', 'answer-key.confirm': 'Confirmed an answer key', 'student.create': 'Added a student', 'student.update': 'Edited a student', 'student.left': 'Marked a student as left',
  'student.rejoin': 'Student back in school', 'student.delete': 'Deleted a student', 'roster.import': 'Imported the register', 'roster.promote': 'Promoted a class', 'roster.quick-add': 'Added students (quick add)',
  'claim.approved': 'Linked a student account', 'claim.auto-linked': 'Student account linked automatically', 'claim.rejected': 'Rejected a join request', 'parent.login': 'Parent signed in', 'parent.linked-by-code': 'Parent added a child',
  'session.token-reuse': 'Signed out a device (copied sign-in)',
};

/** Who changed what — kept forever and cannot be edited (also not by the database user). */
export default function Activity() {
  const t = useAppTheme();
  const q = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => api.get<Log[]>(`/admin/audit${pageParam ? `?cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.length === 50 ? last.at(-1)!.id : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader title="Activity log" subtitle="Every mark change, approval, import and promotion — who did it and why. Nobody can edit this list." />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !rows.length ? <Empty title="Nothing yet" /> : null}
      {rows.length ? (
        <Card style={{ padding: 0 }}>
          {rows.map((r, i) => (
            <View key={r.id} style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.outlineVariant, flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyLarge">{LABEL[r.action] ?? r.action}</Text>
                <Text variant="bodySmall" style={{ color: t.app.muted }}>
                  {(r.actorRole ?? 'System').toLowerCase()}{r.reason ? ` — “${r.reason}”` : ''}
                </Text>
              </View>
              <Text variant="bodySmall" style={{ color: t.app.muted }}>{timeAgo(r.createdAt)}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      {q.hasNextPage ? <Button onPress={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>Show older</Button> : null}
    </Screen>
  );
}
