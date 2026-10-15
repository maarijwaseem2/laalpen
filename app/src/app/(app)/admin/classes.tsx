import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Chip, IconButton, Menu, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { Confirm, FormDialog, toast, toastError, useDialog } from '@/components/feedback';
import { Card, Empty, ErrorView, Grid, Loading, PageHeader, Screen, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query';

interface ClassRow {
  id: string; name: string; grade: number;
  sections: { id: string; name: string; students: number; subjects: { assignmentId: string; subject: string; color: string | null; teacher: string }[] }[];
}

export default function AdminClasses() {
  const t = useAppTheme();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const q = useQuery({ queryKey: ['admin', 'classes'], queryFn: () => api.get<ClassRow[]>('/admin/classes') });
  const addClass = useDialog();
  const addSection = useDialog<ClassRow>();
  const edit = useDialog<ClassRow>();
  const del = useDialog<ClassRow>();
  const [menu, setMenu] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries();
  useEffect(() => { if (add) addClass.open(); }, [add]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader title="Classes" subtitle="Each class has sections. Open a section to manage its students and subject teachers." actions={<Button mode="contained" icon="plus" onPress={() => addClass.open()}>Add class</Button>} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <Empty title="No classes yet" body="Add your first class, for example “Class 9” with sections A and B." action={<Button mode="contained" onPress={() => addClass.open()}>Add class</Button>} /> : null}
      <Grid max={3}>
        {(q.data ?? []).map((c) => (
          <Card key={c.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text variant="titleLarge">{c.name}</Text>
                <Text variant="bodySmall" style={{ color: t.app.muted }}>{c.sections.reduce((n, s) => n + s.students, 0)} students</Text>
              </View>
              <Menu visible={menu === c.id} onDismiss={() => setMenu(null)} anchor={<IconButton icon="dots-vertical" onPress={() => setMenu(c.id)} accessibilityLabel={`${c.name} options`} />}>
                <Menu.Item leadingIcon="plus" title="Add section" onPress={() => { setMenu(null); addSection.open(c); }} />
                <Menu.Item leadingIcon="pencil-outline" title="Rename" onPress={() => { setMenu(null); edit.open(c); }} />
                <Menu.Item leadingIcon="delete-outline" title="Delete" onPress={() => { setMenu(null); del.open(c); }} />
              </Menu>
            </View>
            <View style={{ gap: 8, marginTop: 10 }}>
              {c.sections.map((s) => (
                <Card key={s.id} onPress={() => router.push(`/admin/sections/${s.id}`)} label={`Section ${s.name}`} style={{ padding: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text variant="titleMedium" style={{ width: 34 }}>{s.name}</Text>
                    <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      {s.subjects.length ? (<>{s.subjects.map((x) => <View key={x.assignmentId} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: x.color ?? t.colors.secondary, alignSelf: 'center' }} />)}<Text variant="bodySmall" style={{ color: t.app.muted, marginLeft: 4 }}>{s.subjects.length} {s.subjects.length === 1 ? 'subject' : 'subjects'}</Text></>) : <Text variant="bodySmall" style={{ color: t.app.review }}>No teachers yet</Text>}
                    </View>
                    <Text variant="bodySmall" style={{ color: t.app.muted }}>{s.students} students</Text>
                  </View>
                </Card>
              ))}
            </View>
          </Card>
        ))}
      </Grid>

      <FormDialog
        visible={addClass.visible}
        title="Add class"
        submitLabel="Add class"
        initial={{ sections: 'A' }}
        fields={[
          { key: 'name', label: 'Class name', required: true, placeholder: 'Class 9' },
          { key: 'grade', label: 'Grade number', type: 'number', required: true, placeholder: '9' },
          { key: 'sections', label: 'Sections', help: 'Separate with commas, e.g. A, B, C' },
        ]}
        onDismiss={addClass.close}
        onSubmit={async (v) => {
          await api.post('/admin/classes', { name: v.name, grade: Number(v.grade), sections: (v.sections ?? '').split(',').map((s) => s.trim()).filter(Boolean) });
          await refresh();
          toast(`${v.name} added`);
        }}
      />
      <FormDialog
        visible={addSection.visible}
        title={`Add section to ${addSection.value?.name ?? ''}`}
        submitLabel="Add section"
        fields={[{ key: 'name', label: 'Section name', required: true, placeholder: 'C' }]}
        onDismiss={addSection.close}
        onSubmit={async (v) => {
          await api.post(`/admin/classes/${addSection.value!.id}/sections`, { name: v.name.trim() });
          await refresh();
          toast(`Section ${v.name} added`);
        }}
      />
      <FormDialog
        visible={edit.visible}
        title="Rename class"
        submitLabel="Save"
        initial={edit.value ? { name: edit.value.name, grade: String(edit.value.grade) } : undefined}
        fields={[{ key: 'name', label: 'Class name', required: true }, { key: 'grade', label: 'Grade number', type: 'number', required: true }]}
        onDismiss={edit.close}
        onSubmit={async (v) => {
          await api.patch(`/admin/classes/${edit.value!.id}`, { name: v.name, grade: Number(v.grade) });
          await refresh();
          toast('Class updated');
        }}
      />
      <Confirm
        visible={del.visible}
        title={`Delete ${del.value?.name ?? ''}?`}
        body="Only empty classes can be deleted. Move or remove its students first."
        confirmLabel="Delete"
        destructive
        onCancel={del.close}
        onConfirm={async () => {
          try { await api.del(`/admin/classes/${del.value!.id}`); await refresh(); toast('Class deleted'); } catch (e) { toastError(e); }
          del.close();
        }}
      />
    </Screen>
  );
}
