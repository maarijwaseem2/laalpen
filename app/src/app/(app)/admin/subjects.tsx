import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { IconButton, Menu, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { Confirm, FormDialog, toast, toastError, useDialog } from '@/components/feedback';
import { Card, Empty, ErrorView, Grid, Loading, PageHeader, Screen, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query';

interface Subject { id: string; name: string; code: string | null; color: string | null; sections: number }

export default function AdminSubjects() {
  const t = useAppTheme();
  const q = useQuery({ queryKey: ['admin', 'subjects'], queryFn: () => api.get<Subject[]>('/admin/subjects') });
  const add = useDialog();
  const edit = useDialog<Subject>();
  const del = useDialog<Subject>();
  const [menu, setMenu] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries();
  const fields = [
    { key: 'name', label: 'Subject name', required: true, placeholder: 'Physics' },
    { key: 'code', label: 'Short code', placeholder: 'PHY' },
    { key: 'color', label: 'Colour (optional)', placeholder: '#1E6FB3', help: 'Used for the subject stripe. Leave empty to pick one automatically.' },
  ];
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader title="Subjects" subtitle="Subjects taught in your school. Assign teachers to them from a section." actions={<Button mode="contained" icon="plus" onPress={() => add.open()}>Add subject</Button>} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <Empty title="No subjects yet" body="Add the subjects your school teaches, for example Physics, Mathematics, English." /> : null}
      <Grid max={4}>
        {(q.data ?? []).map((s) => (
          <Card key={s.id} accent={s.color}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium">{s.name}</Text>
                <Text variant="bodySmall" style={{ color: t.app.muted }}>{s.code ? `${s.code} — ` : ''}taught in {s.sections} {s.sections === 1 ? 'section' : 'sections'}</Text>
              </View>
              <Menu visible={menu === s.id} onDismiss={() => setMenu(null)} anchor={<IconButton icon="dots-vertical" onPress={() => setMenu(s.id)} accessibilityLabel={`${s.name} options`} />}>
                <Menu.Item leadingIcon="pencil-outline" title="Edit" onPress={() => { setMenu(null); edit.open(s); }} />
                <Menu.Item leadingIcon="delete-outline" title="Delete" onPress={() => { setMenu(null); del.open(s); }} />
              </Menu>
            </View>
          </Card>
        ))}
      </Grid>
      <FormDialog visible={add.visible} title="Add subject" submitLabel="Add subject" fields={fields} onDismiss={add.close}
        onSubmit={async (v) => { await api.post('/admin/subjects', { name: v.name, code: v.code || undefined, color: v.color || undefined }); await refresh(); toast(`${v.name} added`); }} />
      <FormDialog visible={edit.visible} title="Edit subject" submitLabel="Save" fields={fields} initial={edit.value ? { name: edit.value.name, code: edit.value.code ?? '', color: edit.value.color ?? '' } : undefined} onDismiss={edit.close}
        onSubmit={async (v) => { await api.patch(`/admin/subjects/${edit.value!.id}`, { name: v.name, code: v.code || undefined, color: v.color || undefined }); await refresh(); toast('Subject updated'); }} />
      <Confirm visible={del.visible} title={`Delete ${del.value?.name ?? ''}?`} body="Subjects that already have tests cannot be deleted." confirmLabel="Delete" destructive onCancel={del.close}
        onConfirm={async () => { try { await api.del(`/admin/subjects/${del.value!.id}`); await refresh(); toast('Subject deleted'); } catch (e) { toastError(e); } del.close(); }} />
    </Screen>
  );
}
