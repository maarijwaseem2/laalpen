import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { Card, Empty, ErrorView, Grid, Loading, PageHeader, Screen, SectionTitle, Stat, TestTag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtShort, greeting } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';
import { toast } from '@/components/feedback';
import { AiCostCard } from '@/components/AiCost';
import type { TestStatus } from '@/lib/types';

interface Dash {
  school: { name: string; city: string | null; joinCode: string };
  stats: { classes: number; sections: number; teachers: number; students: number; subjects: number; tests: number; copiesChecked: number; pendingReview: number; joinRequests: number };
  recentTests: { id: string; title: string; status: TestStatus; testDate: string; subject: string; subjectColor: string | null; className: string; sectionName: string; teacher: string; submissions: number }[];
  classes: { id: string; name: string; students: number; sections: number }[];
}

export default function AdminHome() {
  const t = useAppTheme();
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => api.get<Dash>('/admin/dashboard') });
  const d = q.data;
  const firstRun = d && !d.stats.classes;
  const maxStudents = Math.max(1, ...(d?.classes.map((c) => c.students) ?? [1]));

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader title={`${greeting()}, ${user?.name.split(' ')[0]}`} subtitle={d ? `${d.school.name}${d.school.city ? `, ${d.school.city}` : ''}` : undefined} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {firstRun ? (
        <Card>
          <Text variant="titleLarge">Set up your school in three steps</Text>
          <View style={{ gap: 10, marginTop: 12 }}>
            {[
              ['1. Add classes and sections', '/admin/classes'],
              ['2. Add teachers and give them their classes', '/admin/teachers'],
              ['3. Add students to each section', '/admin/students'],
            ].map(([label, href]) => (
              <Button key={href} mode="outlined" onPress={() => router.push(href as any)} style={{ alignSelf: 'flex-start' }}>{label}</Button>
            ))}
          </View>
        </Card>
      ) : null}
      {d ? (
        <>
          <Grid max={4} min={2}>
            <Stat label="Students" value={d.stats.students} hint={`${d.stats.classes} classes, ${d.stats.sections} sections`} />
            <Stat label="Teachers" value={d.stats.teachers} hint={`${d.stats.subjects} subjects`} />
            <Stat label="Copies checked" value={d.stats.copiesChecked} tone="pass" hint={`${d.stats.tests} tests`} />
            <Stat label="Waiting for teachers" value={d.stats.pendingReview} tone="review" hint="checked, not approved yet" />
          </Grid>
          <JoinCodeCard code={d.school.joinCode} requests={d.stats.joinRequests} />
          <AiCostCard />
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <Button mode="contained" icon="account-plus-outline" onPress={() => router.push({ pathname: '/admin/students', params: { add: '1' } })}>Add student</Button>
            <Button mode="outlined" icon="human-male-board" onPress={() => router.push({ pathname: '/admin/teachers', params: { add: '1' } })}>Add teacher</Button>
            <Button mode="outlined" icon="google-classroom" onPress={() => router.push({ pathname: '/admin/classes', params: { add: '1' } })}>Add class</Button>
          </View>
          <View>
            <SectionTitle title="Students per class" />
            <Card>
              {d.classes.length ? d.classes.map((c) => (
                <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
                  <Text variant="labelLarge" style={{ width: 90 }}>{c.name}</Text>
                  <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: t.colors.surfaceVariant, overflow: 'hidden' }}>
                    <View style={{ width: `${(c.students / maxStudents) * 100}%`, height: '100%', backgroundColor: t.colors.secondary, borderRadius: 5 }} />
                  </View>
                  <Text variant="bodyMedium" style={{ width: 150, textAlign: 'right', color: t.app.muted }}>{c.students} in {c.sections} {c.sections === 1 ? 'section' : 'sections'}</Text>
                </View>
              )) : <Text style={{ color: t.app.muted }}>No classes yet.</Text>}
            </Card>
          </View>
          <View>
            <SectionTitle title="Latest tests" />
            {d.recentTests.length ? (
              <View style={{ gap: 10 }}>
                {d.recentTests.map((x) => (
                  <Card key={x.id} accent={x.subjectColor}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <View style={{ flex: 1, minWidth: 200 }}>
                        <Text variant="titleMedium">{x.title}</Text>
                        <Text variant="bodySmall" style={{ color: t.app.muted }}>{x.subject}, {x.className} {x.sectionName} — {x.teacher} — {fmtShort(x.testDate)}</Text>
                      </View>
                      <Text variant="bodyMedium" style={{ color: t.app.muted }}>{x.submissions} copies</Text>
                      <TestTag status={x.status} />
                    </View>
                  </Card>
                ))}
              </View>
            ) : (
              <Empty title="No tests yet" body="Tests appear here when teachers create them." />
            )}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

/** The code students type when they sign up. Shown big so the admin can read it out or share it. */
function JoinCodeCard({ code, requests }: { code: string; requests: number }) {
  const t = useAppTheme();
  const message = `Join our school on LaalPen: open the app, tap "Sign up", choose "I am a student" and enter the school code ${code}.`;
  return (
    <Card accent={t.colors.primary}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Text variant="bodyMedium" style={{ color: t.app.muted }}>School code for student sign-up</Text>
          <Text style={{ fontFamily: 'Lexend_600SemiBold', fontSize: 34, lineHeight: 44, letterSpacing: 3, color: t.colors.primary }} selectable accessibilityLabel={`School code ${code.split('').join(' ')}`}>{code}</Text>
          <Text variant="bodySmall" style={{ color: t.app.muted }}>Students enter this code, pick their class and roll number. Their teacher approves them.</Text>
        </View>
        <View style={{ gap: 8 }}>
          <Button mode="outlined" icon="content-copy" onPress={async () => { await Clipboard.setStringAsync(code); toast('Code copied'); }}>Copy code</Button>
          <Button mode="outlined" icon="share-variant" onPress={() => Share.share({ message }).catch(() => undefined)}>Share with parents</Button>
          {requests ? <Button mode="contained" icon="account-clock-outline" onPress={() => router.push('/requests')}>{requests} join {requests === 1 ? 'request' : 'requests'}</Button> : null}
        </View>
      </View>
    </Card>
  );
}
