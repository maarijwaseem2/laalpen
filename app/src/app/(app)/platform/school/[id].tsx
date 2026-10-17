import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Chip, Divider, List, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { Confirm, FormDialog, toast, toastError, useDialog } from '@/components/feedback';
import { Card, ErrorView, Loading, PageHeader, Screen, Tag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query';

interface Detail {
  id: string; name: string; city: string | null; address: string | null; phone: string | null; logoUrl: string | null; joinCode: string | null; createdAt: string;
  profileComplete: boolean; suspended: boolean; suspendReason: string | null; students: number; subjects: number;
  classes: { id: string; name: string; sections: string[] }[];
  staff: { id: string; name: string; email: string | null; role: 'PRINCIPAL' | 'TEACHER'; isActive: boolean; signedIn: boolean; teacherStatus: string | null }[];
}
type Staff = Detail['staff'][number];

const STATUS: Record<string, string> = { PROFILE_INCOMPLETE: 'profile not done', PENDING: 'waiting for approval', APPROVED: 'approved', REJECTED: 'changes asked' };

export default function PlatformSchool() {
  const t = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['platform', 'school', id], queryFn: () => api.get<Detail>(`/platform/schools/${id}`) });
  const addPrincipal = useDialog();
  const suspend = useDialog();
  const restore = useDialog();
  const pauseUser = useDialog<Staff>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform'] });
  const s = q.data;

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching} maxWidth={900}>
      <PageHeader title={s?.name ?? 'School'} subtitle={s ? [s.address, s.city, s.phone].filter(Boolean).join(' · ') || 'The principal has not completed the profile yet.' : undefined} back="/platform"
        actions={s ? (s.suspended
          ? <Button mode="contained" icon="play-circle-outline" onPress={() => restore.open()}>Restore school</Button>
          : <Button mode="outlined" icon="pause-circle-outline" textColor={t.colors.error} onPress={() => suspend.open()} testID="suspend-school">Pause school</Button>) : null} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {s ? (
        <>
          {s.suspended ? <Card><Text variant="bodyMedium" style={{ color: t.colors.error }}>Paused{s.suspendReason ? `: ${s.suspendReason}` : ''}. Its principal and teachers cannot sign in. Parents still see old results.</Text></Card> : null}
          <Card style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {s.profileComplete ? <Tag label="Profile done" tone="pass" /> : <Tag label="Profile not done" tone="review" />}
              <Tag label={`${s.students} students`} />
              <Tag label={`${s.subjects} subjects`} />
              {s.joinCode ? <Tag label={`School code ${s.joinCode}`} tone="info" /> : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {s.classes.map((c) => <Chip key={c.id} compact>{c.name}: {c.sections.join(', ')}</Chip>)}
            </View>
          </Card>
          <Card style={{ padding: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 4 }}>
              <Text variant="titleMedium" style={{ flex: 1 }}>Principal and teachers</Text>
              <Button icon="account-plus-outline" onPress={() => addPrincipal.open()}>Add principal</Button>
            </View>
            {s.staff.map((u, i) => (
              <View key={u.id}>
                {i ? <Divider /> : null}
                <List.Item
                  title={`${u.name}${u.isActive ? '' : ' (paused)'}`}
                  description={`${u.role === 'PRINCIPAL' ? 'Principal' : `Teacher — ${STATUS[u.teacherStatus ?? ''] ?? ''}`} · ${u.email ?? ''}${u.signedIn ? '' : ' · invite not used yet'}`}
                  left={(p) => <List.Icon {...p} icon={u.role === 'PRINCIPAL' ? 'account-tie' : 'human-male-board'} />}
                  right={() => (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {u.role === 'PRINCIPAL' && !u.signedIn ? <Button compact onPress={async () => { try { await api.post(`/platform/principals/${u.id}/resend-invite`); toast('Invite sent again'); } catch (e) { toastError(e); } }}>Resend invite</Button> : null}
                      {u.isActive
                        ? <Button compact textColor={t.colors.error} onPress={() => pauseUser.open(u)}>Pause</Button>
                        : <Button compact onPress={async () => { try { await api.post(`/platform/users/${u.id}/restore`); await refresh(); toast('Account restored'); } catch (e) { toastError(e); } }}>Restore</Button>}
                    </View>
                  )}
                />
              </View>
            ))}
          </Card>
        </>
      ) : null}
      <FormDialog visible={addPrincipal.visible} title="Add a principal" submitLabel="Add and send invite"
        fields={[{ key: 'name', label: 'Full name', required: true }, { key: 'email', label: 'Email', type: 'email', required: true }]}
        onDismiss={addPrincipal.close}
        onSubmit={async (v) => { await api.post(`/platform/schools/${id}/principals`, { name: v.name, email: v.email }); await refresh(); toast(`Invite sent to ${v.email}`); }} />
      <FormDialog visible={suspend.visible} title={`Pause ${s?.name ?? 'school'}?`} submitLabel="Pause school"
        fields={[{ key: 'reason', label: 'Reason (kept in the log)', required: true }]}
        onDismiss={suspend.close}
        onSubmit={async (v) => { await api.post(`/platform/schools/${id}/suspend`, { reason: v.reason }); await refresh(); toast('School paused. Its staff were signed out.'); }} />
      <Confirm visible={restore.visible} title={`Restore ${s?.name ?? 'school'}?`} body="Its principal and teachers can sign in again." confirmLabel="Restore" onCancel={restore.close}
        onConfirm={async () => { try { await api.post(`/platform/schools/${id}/restore`); await refresh(); toast('School restored'); } catch (e) { toastError(e); } restore.close(); }} />
      <Confirm visible={pauseUser.visible} title={`Pause ${pauseUser.value?.name ?? ''}?`} body="They are signed out everywhere and cannot sign in until you restore the account." confirmLabel="Pause account" destructive onCancel={pauseUser.close}
        onConfirm={async () => { try { await api.post(`/platform/users/${pauseUser.value!.id}/suspend`); await refresh(); toast('Account paused'); } catch (e) { toastError(e); } pauseUser.close(); }} />
    </Screen>
  );
}
