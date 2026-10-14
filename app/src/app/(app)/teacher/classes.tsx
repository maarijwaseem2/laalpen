import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Searchbar } from 'react-native-paper';
import { ClassTile, openClass, type ClassRow } from '@/components/tiles';
import { Empty, ErrorView, Grid, Loading, PageHeader, Screen } from '@/components/ui';
import { api } from '@/lib/api';

export default function TeacherClasses() {
  const q = useQuery({ queryKey: ['teacher', 'classes'], queryFn: () => api.get<ClassRow[]>('/teacher/classes') });
  const [search, setSearch] = useState('');
  const rows = (q.data ?? []).filter((r) => `${r.className} ${r.sectionName} ${r.subjects.map((s) => s.subject).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader title="My classes" subtitle="Open a class to see its subjects, tests and students." />
      <Searchbar placeholder="Search class or subject" value={search} onChangeText={setSearch} style={{ maxWidth: 480 }} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !rows.length ? <Empty title={search ? 'No class matches your search' : 'No classes yet'} body={search ? undefined : 'Your school admin assigns classes to you.'} /> : null}
      <Grid max={3}>
        {rows.map((row) => (
          <ClassTile key={row.sectionId} row={row} onPress={() => openClass(row)} />
        ))}
      </Grid>
    </Screen>
  );
}
