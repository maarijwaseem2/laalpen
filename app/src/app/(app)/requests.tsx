import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { FormDialog, toast, toastError, useDialog } from '@/components/feedback';
import { Avatar, Card, Empty, ErrorView, Grid, Loading, PageHeader, Screen, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { queryClient } from '@/lib/query';

interface Request {
  id: string; name: string; email: string; phone: string | null; rollNo: string; dob: string | null; className: string; sectionName: string;
  guardianPhone: string | null; requestedAt: string;
  /** roster students this probably is (same roll / similar name / same birthday) */
  suggestions: { id: string; name: string; rollNo: string; taken: boolean }[];
  rollTakenBy: string | null;
}

/** Students who signed up with the school code and wait for approval. Teachers see their own sections; admins see all. */
export default function Requests() {
  const t = useAppTheme();
  const role = useAuth((s) => s.user?.role);
  const q = useQuery({ queryKey: ['requests'], queryFn: () => api.get<Request[]>('/requests'), refetchInterval: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const reject = useDialog<Request>();

  const approve = async (r: Request, studentId?: string, label?: string) => {
    setBusy(r.id);
    try {
      await api.post(`/requests/${r.id}/approve`, studentId ? { studentId } : {});
      await queryClient.invalidateQueries();
      toast(studentId ? `${r.name}’s account is linked to ${label}` : `${r.name} added to ${r.className} ${r.sectionName}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader
        title="Join requests"
        subtitle={role === 'ADMIN' ? 'Sign-ups whose details did not exactly match the school list. Link each one to the right student.' : 'Students whose details did not exactly match your class list. Link each account to the right student — no duplicates.'}
      />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <Empty title="No requests right now" body="Students whose class, roll number and date of birth match your list are linked automatically. Only mismatches come here." /> : null}
      <Grid max={3}>
        {(q.data ?? []).map((r) => (
          <Card key={r.id}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <Avatar name={r.name} size={42} />
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium">{r.name}</Text>
                <Text variant="bodyMedium">{r.className} {r.sectionName}, roll {r.rollNo}</Text>
              </View>
            </View>
            <View style={{ marginTop: 10, gap: 2 }}>
              <Text variant="bodySmall" style={{ color: t.app.muted }}>{r.email}{r.phone ? ` — ${r.phone}` : ''}</Text>
              {r.dob ? <Text variant="bodySmall" style={{ color: t.app.muted }}>Date of birth they typed: {new Date(r.dob).toLocaleDateString('en-GB')}</Text> : null}
              {r.guardianPhone ? <Text variant="bodySmall" style={{ color: t.app.muted }}>Parent’s mobile: {r.guardianPhone}</Text> : null}
              <Text variant="bodySmall" style={{ color: t.app.muted }}>Asked {timeAgo(r.requestedAt)}</Text>
            </View>
            {r.suggestions.length ? (
              <View style={{ marginTop: 12, gap: 6 }}>
                <Text variant="labelLarge">Is this…</Text>
                {r.suggestions.map((s) => (
                  <Button
                    key={s.id}
                    mode={s === r.suggestions[0] ? 'contained' : 'outlined'}
                    icon="link-variant"
                    disabled={!!busy || s.taken}
                    loading={busy === r.id && s === r.suggestions[0]}
                    onPress={() => approve(r, s.id, `${s.name} (roll ${s.rollNo})`)}
                    accessibilityLabel={`Link ${r.name} to ${s.name}, roll ${s.rollNo}`}
                    contentStyle={{ justifyContent: 'flex-start' }}
                  >
                    {s.name}, roll {s.rollNo}{s.taken ? ' — already has an account' : ''}
                  </Button>
                ))}
              </View>
            ) : (
              <Text variant="bodySmall" style={{ color: t.app.review, marginTop: 10 }}>No one on the list looks like this student.</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Button mode="text" icon="account-plus-outline" onPress={() => approve(r)} disabled={!!busy || !!r.rollTakenBy} accessibilityLabel={`Add ${r.name} as a new student`}>
                {r.rollTakenBy ? `Roll ${r.rollNo} is ${r.rollTakenBy}` : 'New student — add to list'}
              </Button>
              <Button mode="text" textColor={t.colors.error} onPress={() => reject.open(r)} disabled={!!busy} accessibilityLabel={`Reject ${r.name}`}>
                Reject
              </Button>
            </View>
          </Card>
        ))}
      </Grid>
      <FormDialog
        visible={reject.visible}
        title={`Reject ${reject.value?.name ?? ''}?`}
        submitLabel="Reject request"
        initial={{ reason: '' }}
        fields={[{ key: 'reason', label: 'Reason the student will see', type: 'multiline', placeholder: 'Your roll number is 12, not 21.', help: 'The student can fix the details and ask again.' }]}
        onDismiss={reject.close}
        onSubmit={async (v) => {
          await api.post(`/requests/${reject.value!.id}/reject`, { reason: v.reason || undefined });
          await queryClient.invalidateQueries();
          toast('Request rejected');
        }}
      />
    </Screen>
  );
}
