import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SubjectTile } from '@/components/tiles';
import { Empty, ErrorView, Grid, Loading, PageHeader, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';

export default function StudentSubjects() {
  const q = useQuery({ queryKey: ['student', 'dashboard'], queryFn: () => api.get<any>('/student/dashboard') });
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader title="My subjects" subtitle="Open a subject to see every checked test." />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.subjects.length ? <Empty title="No subjects yet" body="Your school has not assigned teachers to your class yet." /> : null}
      <Grid max={3}>
        {(q.data?.subjects ?? []).map((s: any) => (
          <SubjectTile key={s.assignmentId} name={s.subject} color={s.color} lines={[`Teacher: ${s.teacher}`, s.average === null ? 'No results yet' : `Average ${fmtNum(s.average)}%`]} onPress={() => router.push(`/student/subject/${s.assignmentId}`)} />
        ))}
      </Grid>
    </Screen>
  );
}
