import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Searchbar, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { FormDialog, toast, useDialog } from '@/components/feedback';
import { Card, Empty, ErrorView, Grid, Loading, PageHeader, Screen, Stat, Tag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query';

interface Overview { schools: number; suspended: number; principals: number; teachers: number; pendingTeachers: number; students: number; families: number }
interface School {
  id: string; name: string; city: string | null; joinCode: string | null; createdAt: string; profileComplete: boolean; suspended: boolean; suspendReason: string | null;
  principals: { id: string; name: string; email: string | null; isActive: boolean; signedIn: boolean }[]; teachers: number; students: number;
}

/** LaalPen owner: every school, add a school with its principal, pause / restore. */
export default function PlatformHome() {
  const t = useAppTheme();
  const [search, setSearch] = useState('');
  const ov = useQuery({ queryKey: ['platform', 'overview'], queryFn: () => api.get<Overview>('/platform/overview') });
  const q = useQuery({ queryKey: ['platform', 'schools', search], queryFn: () => api.get<School[]>(`/platform/schools${search ? `?search=${encodeURIComponent(search)}` : ''}`) });
  const add = useDialog();

  return (
    <Screen onRefresh={() => { void ov.refetch(); void q.refetch(); }} refreshing={q.isRefetching}>
      <PageHeader title="Schools" subtitle="Only you can add schools. Each school’s principal gets an invite email and signs in with an emailed code." actions={<Button mode="contained" icon="plus" onPress={() => add.open()} testID="add-school">Add school</Button>} />
      {ov.data ? (
        <Grid max={4} min={2}>
          <Stat label="Schools" value={ov.data.schools} hint={ov.data.suspended ? `${ov.data.suspended} paused` : undefined} />
          <Stat label="Teachers" value={ov.data.teachers} hint={ov.data.pendingTeachers ? `${ov.data.pendingTeachers} waiting for approval` : undefined} tone="info" />
          <Stat label="Students" value={ov.data.students} tone="pass" />
          <Stat label="Parent / Student accounts" value={ov.data.families} />
        </Grid>
      ) : null}
      <Searchbar placeholder="Search by school, city or code" value={search} onChangeText={setSearch} style={{ maxWidth: 480 }} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <Empty title={search ? 'No school matches' : 'No schools yet'} body={search ? undefined : 'Add the first school and its principal.'} /> : null}
      <Grid max={3}>
        {(q.data ?? []).map((s) => (
          <Card key={s.id} onPress={() => router.push(`/platform/school/${s.id}`)} label={`Open ${s.name}`}>
            <View style={{ gap: 4, opacity: s.suspended ? 0.6 : 1 }}>
              <Text variant="titleMedium">{s.name}</Text>
              <Text variant="bodySmall" style={{ color: t.app.muted }}>{[s.city, s.joinCode].filter(Boolean).join(' · ')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {s.suspended ? <Tag label="Paused" tone="pen" icon="pause-circle-outline" /> : null}
                {!s.profileComplete ? <Tag label="Profile not done" tone="review" /> : <Tag label="Profile done" tone="pass" />}
                <Tag label={`${s.teachers} teachers`} />
                <Tag label={`${s.students} students`} />
              </View>
              {s.principals.map((p) => (
                <Text key={p.id} variant="bodySmall" style={{ marginTop: 4 }}>
                  Principal: {p.name} ({p.email}) {p.signedIn ? '' : '— invite not used yet'}
                </Text>
              ))}
            </View>
          </Card>
        ))}
      </Grid>
      <FormDialog visible={add.visible} title="Add a school" submitLabel="Add school and invite principal"
        fields={[
          { key: 'name', label: 'School name', required: true },
          { key: 'city', label: 'City' },
          { key: 'principalName', label: 'Principal’s full name', required: true },
          { key: 'principalEmail', label: 'Principal’s email', type: 'email', required: true, help: 'They get an invite email and sign in with a code sent to this email (no password).' },
        ]}
        onDismiss={add.close}
        onSubmit={async (v) => {
          const r = await api.post<{ id: string; name: string }>('/platform/schools', { name: v.name, city: v.city || undefined, principalName: v.principalName, principalEmail: v.principalEmail });
          await queryClient.invalidateQueries({ queryKey: ['platform'] });
          toast(`${r.name} added. Invite sent to ${v.principalEmail}.`);
        }} />
    </Screen>
  );
}
