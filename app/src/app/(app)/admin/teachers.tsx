import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Chip, IconButton, Menu, Searchbar, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { Confirm, FormDialog, toast, toastError, useDialog } from '@/components/feedback';
import { Avatar, Card, Empty, ErrorView, Grid, Loading, PageHeader, Screen, Tag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query';

interface Teacher { id: string; name: string; email: string; phone: string | null; isActive: boolean; assignments: { id: string; subject: string; color: string | null; className: string; sectionName: string }[] }
interface ClassRow { id: string; name: string; sections: { id: string; name: string }[] }

export default function AdminTeachers() {
  const t = useAppTheme();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['admin', 'teachers', search], queryFn: () => api.get<Teacher[]>(`/admin/teachers${search ? `?search=${encodeURIComponent(search)}` : ''}`) });
  const classes = useQuery({ queryKey: ['admin', 'classes'], queryFn: () => api.get<ClassRow[]>('/admin/classes') });
  const subjects = useQuery({ queryKey: ['admin', 'subjects'], queryFn: () => api.get<{ id: string; name: string }[]>('/admin/subjects') });
  const create = useDialog();
  const edit = useDialog<Teacher>();
  const assign = useDialog<Teacher>();
  const del = useDialog<Teacher>();
  const [menu, setMenu] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries();
  useEffect(() => { if (add) create.open(); }, [add]); // eslint-disable-line react-hooks/exhaustive-deps
  const sectionOptions = (classes.data ?? []).flatMap((c) => c.sections.map((s) => ({ value: s.id, label: `${c.name} ${s.name}` })));

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader title="Teachers" subtitle="Add teachers and give each one the subjects and sections they teach." actions={<Button mode="contained" icon="plus" onPress={() => create.open()}>Add teacher</Button>} />
      <Searchbar placeholder="Search by name or email" value={search} onChangeText={setSearch} style={{ maxWidth: 480 }} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <Empty title={search ? 'No teacher matches' : 'No teachers yet'} body={search ? undefined : 'Add a teacher. They get an email with their login details.'} /> : null}
      <Grid max={3}>
        {(q.data ?? []).map((x) => (
          <Card key={x.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: x.isActive ? 1 : 0.55 }}>
              <Avatar name={x.name} />
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium">{x.name}</Text>
                <Text variant="bodySmall" style={{ color: t.app.muted }} numberOfLines={1}>{x.email}</Text>
              </View>
              <Menu visible={menu === x.id} onDismiss={() => setMenu(null)} anchor={<IconButton icon="dots-vertical" onPress={() => setMenu(x.id)} accessibilityLabel={`${x.name} options`} />}>
                <Menu.Item leadingIcon="link-variant" title="Assign class" onPress={() => { setMenu(null); assign.open(x); }} />
                <Menu.Item leadingIcon="pencil-outline" title="Edit" onPress={() => { setMenu(null); edit.open(x); }} />
                <Menu.Item leadingIcon={x.isActive ? 'account-off-outline' : 'account-check-outline'} title={x.isActive ? 'Disable login' : 'Enable login'} onPress={async () => {
                  setMenu(null);
                  try { await api.patch(`/admin/teachers/${x.id}`, { isActive: !x.isActive }); await refresh(); toast(x.isActive ? 'Login disabled' : 'Login enabled'); } catch (e) { toastError(e); }
                }} />
                <Menu.Item leadingIcon="delete-outline" title="Delete" onPress={() => { setMenu(null); del.open(x); }} />
              </Menu>
            </View>
            {!x.isActive ? <View style={{ marginTop: 8 }}><Tag label="Login disabled" /></View> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {x.assignments.length ? x.assignments.map((a) => (
                <Chip key={a.id} compact icon={() => <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: a.color ?? t.colors.secondary }} />}>
                  {a.subject} — {a.className} {a.sectionName}
                </Chip>
              )) : <Button compact icon="link-variant" onPress={() => assign.open(x)}>Assign a class</Button>}
            </View>
          </Card>
        ))}
      </Grid>

      <FormDialog visible={create.visible} title="Add teacher" submitLabel="Add teacher"
        fields={[
          { key: 'name', label: 'Full name', required: true },
          { key: 'email', label: 'Email', type: 'email', required: true },
          { key: 'phone', label: 'Phone' },
          { key: 'password', label: 'Password', type: 'password', help: 'Leave empty to email a temporary password.' },
        ]}
        onDismiss={create.close}
        onSubmit={async (v) => { await api.post('/admin/teachers', { name: v.name, email: v.email, phone: v.phone || undefined, password: v.password || undefined }); await refresh(); toast(`${v.name} added. Login details were emailed.`); }} />
      <FormDialog visible={edit.visible} title="Edit teacher" submitLabel="Save" initial={edit.value ? { name: edit.value.name, phone: edit.value.phone ?? '' } : undefined}
        fields={[{ key: 'name', label: 'Full name', required: true }, { key: 'phone', label: 'Phone' }]}
        onDismiss={edit.close}
        onSubmit={async (v) => { await api.patch(`/admin/teachers/${edit.value!.id}`, { name: v.name, phone: v.phone || undefined }); await refresh(); toast('Teacher updated'); }} />
      <FormDialog visible={assign.visible} title={`Assign ${assign.value?.name ?? ''}`} submitLabel="Assign"
        fields={[
          { key: 'sectionId', label: 'Class and section', type: 'select', required: true, options: sectionOptions },
          { key: 'subjectId', label: 'Subject', type: 'select', required: true, options: (subjects.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
        ]}
        onDismiss={assign.close}
        onSubmit={async (v) => { await api.post('/admin/assignments', { teacherId: assign.value!.id, sectionId: v.sectionId, subjectId: v.subjectId }); await refresh(); toast('Class assigned'); }} />
      <Confirm visible={del.visible} title={`Delete ${del.value?.name ?? ''}?`} body="Teachers who already have tests cannot be deleted — disable their login instead." confirmLabel="Delete" destructive onCancel={del.close}
        onConfirm={async () => { try { await api.del(`/admin/teachers/${del.value!.id}`); await refresh(); toast('Teacher deleted'); } catch (e) { toastError(e); } del.close(); }} />
    </Screen>
  );
}
