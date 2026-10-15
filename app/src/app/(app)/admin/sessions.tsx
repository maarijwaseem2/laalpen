import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Checkbox, Chip, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { FormDialog, toast, toastError, useDialog } from '@/components/feedback';
import { TextInput } from '@/components/Input';
import { Card, ErrorView, Loading, PageHeader, Screen, SectionTitle, Tag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { queryClient } from '@/lib/query';

interface SessionRow { id: string; name: string; startsOn: string; isCurrent: boolean; enrollments: number; tests: number }
interface ClassRow { id: string; name: string; grade: number; sections: { id: string; name: string; students: number }[] }
interface Plan { from: string; to: string; session: string; promote: number; repeat: number; students: { id: string; name: string; rollNo: string; action: 'promote' | 'repeat' | 'graduate' }[] }

const nextSession = (cur?: string) => {
  const y = Number(cur?.slice(0, 4)) || new Date().getFullYear();
  return `${y + 1}-${String((y + 2) % 100).padStart(2, '0')}`;
};

/**
 * School year (session) and year-end promotion. Start with the top class: promote Class 10 (they pass out),
 * then 9 → 10, and so on. Untick students who repeat the class. Old marks stay with each year.
 */
export default function Sessions() {
  const t = useAppTheme();
  const sessions = useQuery({ queryKey: ['admin', 'sessions'], queryFn: () => api.get<SessionRow[]>('/admin/sessions') });
  const classes = useQuery({ queryKey: ['admin', 'classes'], queryFn: () => api.get<ClassRow[]>('/admin/classes') });
  const current = sessions.data?.find((s) => s.isCurrent);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null | 'graduate'>(null);
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [repeat, setRepeat] = useState<Set<string>>(new Set());
  const [renumber, setRenumber] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = useDialog();
  const sorted = [...(classes.data ?? [])].sort((a, b) => b.grade - a.grade);
  const sessionName = name || nextSession(current?.name);

  const preview = async () => {
    if (!from || !to) return toast('Choose the class and where it goes');
    setBusy(true);
    try {
      const p = await api.post<Plan>('/admin/promote/preview', { fromClassId: from, toClassId: to === 'graduate' ? null : to, sessionName });
      setPlan(p);
      setRepeat(new Set());
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    setBusy(true);
    try {
      const p = await api.post<Plan>('/admin/promote', { fromClassId: from, toClassId: to === 'graduate' ? null : to, sessionName, retainIds: [...repeat], renumber });
      await queryClient.invalidateQueries();
      toast(`${p.from}: ${p.students.length - repeat.size} moved to ${p.to}${repeat.size ? `, ${repeat.size} repeat` : ''}`);
      setPlan(null);
      setFrom(null);
      setTo(null);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen onRefresh={() => { void sessions.refetch(); void classes.refetch(); }} refreshing={sessions.isRefetching}>
      <PageHeader title="School year" subtitle={current ? `Current session: ${current.name}` : undefined} actions={<Button icon="plus" onPress={() => add.open()}>New session</Button>} />
      {sessions.isLoading ? <Loading /> : null}
      {sessions.error ? <ErrorView error={sessions.error} onRetry={() => sessions.refetch()} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(sessions.data ?? []).map((s) => (
          <Card key={s.id} style={{ minWidth: 200 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="titleMedium" style={{ flex: 1 }}>{s.name}</Text>
              {s.isCurrent ? <Tag tone="pass" label="Current" /> : null}
            </View>
            <Text variant="bodySmall" style={{ color: t.app.muted }}>From {fmtDate(s.startsOn)} · {s.enrollments} students · {s.tests} tests</Text>
          </Card>
        ))}
      </View>

      <SectionTitle title="Promote a class (year end)" />
      <Card style={{ gap: 12 }}>
        <Text variant="bodyMedium" style={{ color: t.app.muted }}>Start with the highest class so the next class is empty when its students arrive.</Text>
        <Text variant="labelLarge">Class</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {sorted.map((c) => (
            <Chip key={c.id} selected={from === c.id} showSelectedOverlay onPress={() => { setFrom(c.id); setPlan(null); const next = sorted.find((x) => x.grade === c.grade + 1); setTo(next?.id ?? 'graduate'); }}>
              {c.name} ({c.sections.reduce((n, s) => n + s.students, 0)})
            </Chip>
          ))}
        </View>
        {from ? (
          <>
            <Text variant="labelLarge">Goes to</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {sorted.filter((c) => c.id !== from).map((c) => (
                <Chip key={c.id} selected={to === c.id} showSelectedOverlay onPress={() => { setTo(c.id); setPlan(null); }}>{c.name}</Chip>
              ))}
              <Chip icon="school-outline" selected={to === 'graduate'} showSelectedOverlay onPress={() => { setTo('graduate'); setPlan(null); }}>Passed out (leaves school)</Chip>
            </View>
            <TextInput mode="outlined" label="New session" value={sessionName} onChangeText={(v) => { setName(v); setPlan(null); }} style={{ maxWidth: 220 }} />
            <Button mode="contained-tonal" icon="eye-outline" onPress={preview} loading={busy && !plan} disabled={busy} style={{ alignSelf: 'flex-start' }}>See who moves</Button>
          </>
        ) : null}
        {plan ? (
          <>
            <Text variant="titleSmall">{plan.from} → {plan.to} in {plan.session}. Untick students who repeat {plan.from}.</Text>
            <View style={{ borderWidth: 1, borderColor: t.colors.outlineVariant, borderRadius: 12 }}>
              {plan.students.map((s) => (
                <Checkbox.Item
                  key={s.id}
                  label={`${s.rollNo}  ${s.name}${repeat.has(s.id) ? ' — repeats' : ''}`}
                  status={repeat.has(s.id) ? 'unchecked' : 'checked'}
                  onPress={() => setRepeat((r) => { const n = new Set(r); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
                  position="leading"
                />
              ))}
            </View>
            {to !== 'graduate' ? <Checkbox.Item label="Give new roll numbers (01, 02, …) in the new class" status={renumber ? 'checked' : 'unchecked'} onPress={() => setRenumber((v) => !v)} position="leading" style={{ paddingHorizontal: 0 }} /> : null}
            <Button mode="contained" icon="arrow-up-bold-circle-outline" onPress={promote} loading={busy} disabled={busy} style={{ alignSelf: 'flex-start' }}>
              {to === 'graduate' ? `Pass out ${plan.students.length - repeat.size} students` : `Promote ${plan.students.length - repeat.size} students`}
            </Button>
          </>
        ) : null}
      </Card>

      <FormDialog
        visible={add.visible}
        title="New session"
        submitLabel="Create"
        initial={{ name: nextSession(current?.name), startsOn: '' }}
        fields={[
          { key: 'name', label: 'Session', required: true, placeholder: '2027-28' },
          { key: 'startsOn', label: 'Starts on (YYYY-MM-DD)', placeholder: '2027-04-01' },
        ]}
        onDismiss={add.close}
        onSubmit={async (v) => {
          await api.post('/admin/sessions', { name: v.name, startsOn: v.startsOn || undefined, makeCurrent: true });
          await queryClient.invalidateQueries({ queryKey: ['admin', 'sessions'] });
          toast(`Session ${v.name} started`);
        }}
      />
    </Screen>
  );
}
