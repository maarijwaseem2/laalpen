import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, SegmentedButtons, Text } from 'react-native-paper';
import { Avatar, Card, CountsBar, Empty, ErrorView, Loading, PageHeader, Screen, TestTag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { ClassTools } from '@/components/ClassTools';
import { fmtDate, fmtNum } from '@/lib/format';
import type { Counts, TestStatus } from '@/lib/types';

interface Detail {
  id: string;
  subject: string;
  color: string | null;
  className: string;
  sectionName: string;
  sectionId: string;
  otherSubjects: { assignmentId: string; subject: string; color: string | null }[];
  students: { id: string; name: string; rollNo: string; hasAccount: boolean; average: number | null; testsTaken: number }[];
  tests: { id: string; title: string; status: TestStatus; testDate: string; totalMarks: number; counts: Counts }[];
}

export default function AssignmentScreen() {
  const t = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<'tests' | 'students'>('tests');
  const q = useQuery({ queryKey: ['teacher', 'assignment', id], queryFn: () => api.get<Detail>(`/teacher/assignments/${id}`) });
  const d = q.data;

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader
        back
        color={d?.color}
        title={d ? d.subject : 'Subject'}
        subtitle={d ? `${d.className} ${d.sectionName} — ${d.students.length} students` : undefined}
        actions={d ? <Button mode="contained" icon="plus" onPress={() => router.push({ pathname: '/teacher/test/new', params: { assignmentId: id } })}>New test</Button> : null}
      />
      {d?.otherSubjects.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Text variant="bodySmall" style={{ color: t.app.muted }}>You also teach this class:</Text>
          {d.otherSubjects.map((s) => (
            <Chip key={s.assignmentId} compact onPress={() => router.replace(`/teacher/assignment/${s.assignmentId}`)} icon={() => <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color ?? t.colors.secondary }} />}>
              {s.subject}
            </Chip>
          ))}
        </View>
      ) : null}
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {d ? (
        <>
          <SegmentedButtons
            value={tab}
            onValueChange={(v) => setTab(v as any)}
            style={{ maxWidth: 420 }}
            buttons={[
              { value: 'tests', label: `Tests (${d.tests.length})`, icon: 'file-document-multiple-outline' },
              { value: 'students', label: `Students (${d.students.length})`, icon: 'account-multiple-outline' },
            ]}
          />
          {tab === 'tests' ? (
            d.tests.length ? (
              <View style={{ gap: 10 }}>
                {d.tests.map((x) => {
                  const toReview = x.counts.checked + x.counts.review;
                  return (
                    <Card key={x.id} onPress={() => router.push(`/teacher/test/${x.id}`)} label={x.title}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <View style={{ flex: 1, minWidth: 180 }}>
                          <Text variant="titleMedium">{x.title}</Text>
                          <Text variant="bodySmall" style={{ color: t.app.muted }}>
                            {fmtDate(x.testDate)} — {fmtNum(x.totalMarks)} marks
                          </Text>
                        </View>
                        <TestTag status={x.status} />
                      </View>
                      <View style={{ marginTop: 12, gap: 6 }}>
                        <CountsBar total={d.students.length} approved={x.counts.approved} toReview={toReview} pending={x.counts.pending} />
                        <Text variant="bodySmall" style={{ color: t.app.muted }}>
                          {x.counts.uploaded}/{d.students.length} copies uploaded, {x.counts.approved} approved{toReview ? `, ${toReview} to approve` : ''}
                          {x.counts.failed ? `, ${x.counts.failed} failed` : ''}
                        </Text>
                      </View>
                    </Card>
                  );
                })}
              </View>
            ) : (
              <Empty
                title="No tests yet"
                body="Create a test with its questions and answer key. Then photograph each student's copy and the AI checks it for you."
                action={<Button mode="contained" icon="plus" onPress={() => router.push({ pathname: '/teacher/test/new', params: { assignmentId: id } })}>Create the first test</Button>}
              />
            )
          ) : (
            <View style={{ gap: 12 }}>
            <ClassTools sectionId={d.sectionId} role="TEACHER" />
            <Card style={{ padding: 0 }}>
              {d.students.map((s, i) => (
                <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.outlineVariant }}>
                  <Text variant="labelLarge" style={{ width: 30, color: t.app.muted }}>{s.rollNo}</Text>
                  <Avatar name={s.name} size={32} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyLarge">{s.name}</Text>
                    {!s.hasAccount ? <Text variant="bodySmall" style={{ color: t.app.muted }}>No app yet</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="titleMedium" style={{ color: s.average === null ? t.app.muted : s.average >= 60 ? t.app.pass : s.average >= 40 ? t.app.review : t.colors.primary }}>
                      {s.average === null ? '–' : `${fmtNum(s.average)}%`}
                    </Text>
                    <Text variant="bodySmall" style={{ color: t.app.muted }}>{s.testsTaken} tests</Text>
                  </View>
                </View>
              ))}
              {!d.students.length ? <View style={{ padding: 16 }}><Text>No students in this section yet. Use “Quick add students” above.</Text></View> : null}
            </Card>
            </View>
          )}
        </>
      ) : null}
    </Screen>
  );
}
