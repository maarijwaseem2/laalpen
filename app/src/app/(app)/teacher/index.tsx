import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { ClassTile, openClass, type ClassRow } from '@/components/tiles';
import { Card, CountsBar, Empty, ErrorView, Grid, Loading, PageHeader, Screen, SectionTitle, Stat, Tag, TestTag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtShort, greeting } from '@/lib/format';
import type { Counts, TestStatus } from '@/lib/types';

interface Dash {
  stats: { sections: number; students: number; tests: number; toReview: number; checking: number; approved: number; joinRequests: number; attention: number; keysToConfirm: number };
  recentTests: { id: string; title: string; status: TestStatus; keyStatus: 'DRAFT' | 'CONFIRMED'; testDate: string; subject: string; color: string | null; className: string; sectionName: string; counts: Counts }[];
}

export default function TeacherHome() {
  const t = useAppTheme();
  const user = useAuth((s) => s.user);
  const dash = useQuery({ queryKey: ['teacher', 'dashboard'], queryFn: () => api.get<Dash>('/teacher/dashboard') });
  const classes = useQuery({ queryKey: ['teacher', 'classes'], queryFn: () => api.get<ClassRow[]>('/teacher/classes') });
  const refresh = () => { void dash.refetch(); void classes.refetch(); };

  return (
    <Screen onRefresh={refresh} refreshing={dash.isRefetching}>
      <PageHeader title={`${greeting()}, ${user?.name.split(' ')[0]}`} subtitle={dash.data ? (dash.data.stats.toReview ? `${dash.data.stats.toReview} checked copies are waiting for your approval.` : 'Nothing is waiting for you right now.') : undefined} />
      {dash.error ? <ErrorView error={dash.error} onRetry={refresh} /> : null}
      {dash.data?.stats.joinRequests ? (
        <Card accent={t.app.info} onPress={() => router.push('/requests')} label="Open join requests">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 200 }}>
              <Text variant="titleMedium">{dash.data.stats.joinRequests} {dash.data.stats.joinRequests === 1 ? 'student wants' : 'students want'} to join your classes</Text>
              <Text variant="bodyMedium" style={{ color: t.app.muted }}>Check their roll numbers and approve them.</Text>
            </View>
            <Button mode="contained" onPress={() => router.push('/requests')}>Review requests</Button>
          </View>
        </Card>
      ) : null}
 {dash.data?.stats.attention ? (
        <Card accent={t.colors.primary}>
          <Text variant="titleMedium">{dash.data.stats.attention} {dash.data.stats.attention === 1 ? 'copy needs' : 'copies need'} a retake or a second try</Text>
          <Text variant="bodyMedium" style={{ color: t.app.muted }}>Blurry or missing pages were stopped before the AI. Open the test to retake them.</Text>
        </Card>
      ) : null}
      {dash.data ? (
        <Grid max={4} min={2}>
          <Stat label="To approve" value={dash.data.stats.toReview} tone="review" />
          <Stat label="Being checked" value={dash.data.stats.checking} tone="info" />
          <Stat label="Approved copies" value={dash.data.stats.approved} tone="pass" />
          <Stat label="Students" value={dash.data.stats.students} hint={`${dash.data.stats.sections} sections`} />
        </Grid>
      ) : null}

      <View>
        <SectionTitle title="My classes" action={<Button compact onPress={() => router.push('/teacher/classes')}>See all</Button>} />
        {classes.isLoading ? <Loading /> : null}
        {classes.data && !classes.data.length ? <Empty title="No classes yet" body="Your school admin assigns you to a class and subject. They will appear here." /> : null}
        {classes.data?.length ? (
          <Grid max={3}>
            {classes.data.map((row) => (
              <ClassTile key={row.sectionId} row={row} onPress={() => openClass(row)} />
            ))}
          </Grid>
        ) : null}
      </View>

      {dash.data?.recentTests.length ? (
        <View>
          <SectionTitle title="Recent tests" />
          <View style={{ gap: 10 }}>
            {dash.data.recentTests.map((x) => (
              <Card key={x.id} accent={x.color} onPress={() => router.push(x.keyStatus === 'DRAFT' ? `/teacher/key/${x.id}` : `/teacher/test/${x.id}`)} label={x.title}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <View style={{ flex: 1, minWidth: 200 }}>
                    <Text variant="titleMedium">{x.title}</Text>
                    <Text variant="bodySmall" style={{ color: t.app.muted }}>
                      {x.subject}, {x.className} {x.sectionName} — {fmtShort(x.testDate)}
                    </Text>
                  </View>
                  {x.keyStatus === 'DRAFT' ? <Tag label="Confirm answer key" tone="review" icon="key-outline" /> : <TestTag status={x.status} />}
                </View>
                <View style={{ marginTop: 12, gap: 6 }}>
                  <CountsBar total={x.counts.uploaded} approved={x.counts.approved} toReview={x.counts.checked + x.counts.review} pending={x.counts.pending} />
                  <Text variant="bodySmall" style={{ color: t.app.muted }}>
                    {x.counts.uploaded} copies uploaded, {x.counts.approved} approved{x.counts.checked + x.counts.review ? `, ${x.counts.checked + x.counts.review} to approve` : ''}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
