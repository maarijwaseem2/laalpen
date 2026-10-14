import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { SubjectTile, type ClassRow } from '@/components/tiles';
import { ErrorView, Grid, Loading, PageHeader, Screen } from '@/components/ui';
import { api } from '@/lib/api';

/** A section where the teacher teaches more than one subject: pick the subject first. */
export default function TeacherSection() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['teacher', 'classes'], queryFn: () => api.get<ClassRow[]>('/teacher/classes') });
  const row = q.data?.find((r) => r.sectionId === id);
  return (
    <Screen>
      <PageHeader back title={row ? `${row.className} — ${row.sectionName}` : 'Class'} subtitle={row ? `${row.students} students. Choose a subject.` : undefined} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {row ? (
        <Grid max={3}>
          {row.subjects.map((s) => (
            <SubjectTile
              key={s.assignmentId}
              name={s.subject}
              color={s.color}
              lines={[`${s.tests} ${s.tests === 1 ? 'test' : 'tests'}`]}
              badge={s.toReview ? `${s.toReview} to review` : null}
              onPress={() => router.push(`/teacher/assignment/${s.assignmentId}`)}
            />
          ))}
        </Grid>
      ) : null}
    </Screen>
  );
}
