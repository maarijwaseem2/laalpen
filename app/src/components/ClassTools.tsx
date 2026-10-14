import * as Clipboard from 'expo-clipboard';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Dialog, HelperText, Portal, Text } from 'react-native-paper';
import { toast, toastError } from './feedback';
import { TextInput } from './Input';
import { Card, useAppTheme } from './ui';
import { api } from '@/lib/api';
import { openFile } from '@/lib/files';
import { fmtDate } from '@/lib/format';
import { queryClient } from '@/lib/query';

/**
 * Getting a class onto LaalPen: the class code students type, printed claim cards,
 * and quick-add for academies that have no register file.
 */
export function ClassTools({ sectionId, role, joinCode, expiresAt }: { sectionId: string; role: 'ADMIN' | 'TEACHER'; joinCode?: string | null; expiresAt?: string | null }) {
  const t = useAppTheme();
  const base = role === 'ADMIN' ? '/admin' : '/teacher';
  const code = useQuery({
    queryKey: ['join-code', sectionId],
    queryFn: () => (role === 'TEACHER' ? api.get<{ joinCode: string; joinCodeExpiresAt: string }>(`/teacher/sections/${sectionId}/join-code`) : Promise.resolve({ joinCode: joinCode ?? '', joinCodeExpiresAt: expiresAt ?? '' })),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [quick, setQuick] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ created: { rollNo: string; name: string }[]; skipped: { line: string; reason: string }[] } | null>(null);
  const current = code.data?.joinCode;

  const rotate = async () => {
    setBusy('rotate');
    try {
      const r = await api.post<{ joinCode: string; joinCodeExpiresAt: string }>(`${base}/sections/${sectionId}/join-code`);
      queryClient.setQueryData(['join-code', sectionId], r);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'section', sectionId] });
      toast(current ? 'New class code made. The old one stopped working.' : 'Class code ready');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const cards = async (kind: 'STUDENT' | 'PARENT') => {
    setBusy(kind);
    try {
      const r = await api.post<{ url: string; count: number }>(`${base}/claim-cards`, { sectionId, kind });
      toast(`${r.count} ${kind === 'PARENT' ? 'parent' : 'student'} cards ready to print`);
      await openFile(r.url);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    setBusy('quick');
    try {
      const r = await api.post<NonNullable<typeof result>>(`${base}/sections/${sectionId}/students`, { text });
      setResult(r);
      if (r.created.length) {
        await queryClient.invalidateQueries();
        setText(r.skipped.map((s) => s.line).join('\n'));
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <Text variant="titleMedium">Bring this class onto LaalPen</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text variant="bodySmall" style={{ color: t.app.muted }}>Class code for students</Text>
          {current ? (
            <Text variant="headlineSmall" selectable style={{ letterSpacing: 1 }} accessibilityLabel={`Class code ${current.split('').join(' ')}`}>{current}</Text>
          ) : (
            <Text variant="bodyMedium">No code yet</Text>
          )}
          {code.data?.joinCodeExpiresAt ? <Text variant="bodySmall" style={{ color: t.app.muted }}>Works until {fmtDate(code.data.joinCodeExpiresAt)}</Text> : null}
        </View>
        {current ? <Button compact icon="content-copy" onPress={async () => { await Clipboard.setStringAsync(current); toast('Code copied'); }}>Copy</Button> : null}
        <Button compact icon="refresh" onPress={rotate} loading={busy === 'rotate'} disabled={!!busy}>{current ? 'New code' : 'Make code'}</Button>
      </View>
      <Text variant="bodySmall" style={{ color: t.app.muted }}>
        Students type the code, their roll number and date of birth. If it matches your list, they are in — no approval needed.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button mode="outlined" icon="card-account-details-outline" onPress={() => cards('STUDENT')} loading={busy === 'STUDENT'} disabled={!!busy}>Student cards</Button>
        <Button mode="outlined" icon="account-child-outline" onPress={() => cards('PARENT')} loading={busy === 'PARENT'} disabled={!!busy}>Parent cards</Button>
        <Button mode="outlined" icon="playlist-plus" onPress={() => { setQuick(true); setResult(null); }} disabled={!!busy}>Quick add students</Button>
      </View>

      <Portal>
        <Dialog visible={quick} onDismiss={() => setQuick(false)} style={{ maxWidth: 560, alignSelf: 'center', width: '94%' }}>
          <Dialog.Title>Quick add students</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <Text variant="bodyMedium">One student per line: roll number, name, and the parent’s mobile if you have it.</Text>
            <TextInput mode="outlined" label="Students" multiline numberOfLines={8} value={text} onChangeText={setText} placeholder={'01 Ali Raza, 0300 1234567\n02 Sara Khan\n03 Hamza Iqbal'} style={{ minHeight: 160 }} />
            {result ? (
              <HelperText type={result.skipped.length ? 'error' : 'info'} visible>
                {result.created.length} added.{result.skipped.length ? ` Not added: ${result.skipped.map((s) => `“${s.line}” (${s.reason})`).join('; ')}` : ''}
              </HelperText>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setQuick(false)}>Close</Button>
            <Button mode="contained" onPress={add} loading={busy === 'quick'} disabled={!!busy || text.trim().length < 3}>Add</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Card>
  );
}
