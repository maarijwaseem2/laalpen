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

interface Teacher { id: string; name: string; email: string; phone: string | null; isActive: boolean; signedIn?: boolean; status?: 'PROFILE_INCOMPLETE' | 'PENDING' | 'APPROVED' | 'REJECTED' | null; qualification?: string | null; subjects?: string[]; rejectReason?: string | null; assignments: { id: string; subject: string; color: string | null; className: string; sectionName: string }[] }
interface Pending { id: string; name: string; email: string; phone: string | null; qualification: string | null; subjects: string[]; submittedAt: string | null; sections: { sectionId: string; subject: string; label: string }[] }
const STATUS_TAG: Record<string, { label: string; tone: 'muted' | 'info' | 'pass' | 'review' | 'pen' }> = {
  PROFILE_INCOMPLETE: { label: 'Profile not filled yet', tone: 'muted' },
  PENDING: { label: 'Waiting for your approval', tone: 'review' },
  REJECTED: { label: 'Changes asked', tone: 'pen' },
};
interface ClassRow { id: string; name: string; sections: { id: string; name: string }[] }

export default function AdminTeachers() {
  const t = useAppTheme();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['admin', 'teachers', search], queryFn: () => api.get<Teacher[]>(`/admin/teachers${search ? `?search=${encodeURIComponent(search)}` : ''}`) });
  const classes = useQuery({ queryKey: ['admin', 'classes'], queryFn: () => api.get<ClassRow[]>('/admin/classes') });
  const subjects = useQuery({ queryKey: ['admin', 'subjects'], queryFn: () => api.get<{ id: string; name: string }[]>('/admin/subjects') });
  const pending = useQuery({ queryKey: ['admin', 'teachers', 'pending'], queryFn: () => api.get<Pending[]>('/admin/teachers/pending'), refetchInterval: 60_000 });
  const reject = useDialog<Pending>();
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
      <PageHeader title="Teachers" subtitle="Add a teacher with their email. They get an invite, fill in their profile, and you approve it." actions={<Button mode="contained" icon="plus" onPress={() => create.open()}>Add teacher</Button>} />
      {(pending.data ?? []).length ? (
        <Card style={{ gap: 10, borderColor: t.app.review, borderWidth: 1.5 }}>
          <Text variant="titleMedium">Waiting for your approval ({pending.data!.length})</Text>
          {pending.data!.map((p) => (
            <View key={p.id} style={{ gap: 6, paddingVertical: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar name={p.name} />
                <View style={{ flex: 1 }}>
                  <Text variant="titleSmall">{p.name}</Text>
                  <Text variant="bodySmall" style={{ color: t.app.muted }}>{p.email}{p.phone ? ` · ${p.phone}` : ''}</Text>
                  <Text variant="bodySmall">{p.qualification}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {p.sections.map((x) => <Chip key={`${x.sectionId}${x.subject}`} compact>{x.label} — {x.subject}</Chip>)}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button mode="contained" icon="check" testID={`approve-${p.id}`} onPress={async () => {
                  try {
                    const r = await api.post<{ created: string[]; skipped: string[] }>(`/admin/teachers/${p.id}/approve`);
                    await refresh();
                    toast(`${p.name} approved${r.created.length ? ` — ${r.created.join(', ')}` : ''}${r.skipped.length ? `. Skipped (already taught): ${r.skipped.join(', ')}` : ''}`);
                  } catch (e) { toastError(e); }
                }}>Approve</Button>
                <Button mode="outlined" icon="close" onPress={() => reject.open(p)}>Ask for changes</Button>
              </View>
            </View>
          ))}
        </Card>
      ) : null}
      <Searchbar placeholder="Search by name or email" value={search} onChangeText={setSearch} style={{ maxWidth: 480 }} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <Empty title={search ? 'No teacher matches' : 'No teachers yet'} body={search ? undefined : 'Add a teacher with their email. They get an invite and sign in with an emailed code.'} /> : null}
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
                {x.signedIn === false ? <Menu.Item leadingIcon="email-sync-outline" title="Resend invite" onPress={async () => {
                  setMenu(null);
                  try { await api.post(`/admin/teachers/${x.id}/resend-invite`); toast('Invite sent again'); } catch (e) { toastError(e); }
                }} /> : null}
                <Menu.Item leadingIcon={x.isActive ? 'account-off-outline' : 'account-check-outline'} title={x.isActive ? 'Disable login' : 'Enable login'} onPress={async () => {
                  setMenu(null);
                  try { await api.patch(`/admin/teachers/${x.id}`, { isActive: !x.isActive }); await refresh(); toast(x.isActive ? 'Login disabled' : 'Login enabled'); } catch (e) { toastError(e); }
                }} />
                <Menu.Item leadingIcon="delete-outline" title="Delete" onPress={() => { setMenu(null); del.open(x); }} />
              </Menu>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {!x.isActive ? <Tag label="Login disabled" /> : null}
              {x.status && STATUS_TAG[x.status] ? <Tag {...STATUS_TAG[x.status]!} /> : null}
              {x.signedIn === false ? <Tag label="Invite not used yet" /> : null}
            </View>
            {x.qualification ? <Text variant="bodySmall" style={{ color: t.app.muted, marginTop: 4 }}>{x.qualification}</Text> : null}
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
        ]}
        onDismiss={create.close}
        onSubmit={async (v) => { await api.post('/admin/teachers', { name: v.name, email: v.email, phone: v.phone || undefined }); await refresh(); toast(`${v.name} added. An invite was emailed — no password needed.`); }} />
      <FormDialog visible={reject.visible} title={`Ask ${reject.value?.name ?? ''} for changes`} submitLabel="Send"
        fields={[{ key: 'reason', label: 'What should they fix? (they see this)', required: true, type: 'multiline' }]}
        onDismiss={reject.close}
        onSubmit={async (v) => { await api.post(`/admin/teachers/${reject.value!.id}/reject`, { reason: v.reason }); await refresh(); toast('Sent. The teacher got an email.'); }} />
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
