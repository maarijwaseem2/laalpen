import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Dialog, HelperText, Portal, Text } from 'react-native-paper';
import { Button } from './SafeButton';
import { TextInput } from './Input';
import { ClassSectionPicker, type SchoolInfo } from './SchoolPicker';
import { toast } from './feedback';
import { useAppTheme } from './ui';
import { ApiError, api } from '@/lib/api';
import { parseDob } from '@/lib/format';
import { errorText, queryClient } from '@/lib/query';
import { useT } from '@/lib/i18n';

type Detected =
  | { kind: 'card'; child: { name: string; className: string; sectionName: string; rollNo: string; school: string } }
  | { kind: 'class'; school: SchoolInfo & { section: { id: string; name: string; className: string } | null } };

/**
 * One code box for parents and students: the app works out whether it is a class code (ALN-9A) or the code on a
 * printed card (K7QP-3MXA). A card links at once; a class code also needs the child's name, roll number and
 * date of birth (then it links automatically, or goes to the class teacher to confirm).
 */
export function LinkChild({ visible, initialCode, onDismiss }: { visible: boolean; initialCode?: string; onDismiss: () => void }) {
  const t = useAppTheme();
  const tr = useT();
  const [code, setCode] = useState((initialCode ?? '').toUpperCase());
  const [found, setFound] = useState<Detected | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [childName, setChildName] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [dob, setDob] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFound(null);
    setSectionId(null);
    setChildName('');
    setRollNo('');
    setDob('');
    setError(null);
  };
  const close = () => {
    reset();
    setCode('');
    onDismiss();
  };

  const check = async () => {
    const c = code.trim();
    if (c.replace(/[^0-9A-Z]/gi, '').length < 4) return setError(tr('Type the code from the school, e.g. ALN-9A'));
    setBusy(true);
    setError(null);
    try {
      const d = await api.get<Detected>(`/parent/code/${encodeURIComponent(c)}`);
      setFound(d);
      if (d.kind === 'class' && d.school.section) setSectionId(d.school.section.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    if (!found) return;
    const body: Record<string, string> = { code: code.trim() };
    if (found.kind === 'class') {
      if (childName.trim().length < 2) return setError(tr('Enter your child’s full name'));
      if (!rollNo.trim()) return setError(tr('Enter the roll number'));
      if (!sectionId) return setError(tr('Choose the class and section'));
      const d = parseDob(dob);
      if (d === 'bad') return setError(tr('Write the date of birth like 05/03/2014'));
      Object.assign(body, { childName: childName.trim(), rollNo: rollNo.trim(), sectionId, ...(d ? { dob: d } : {}) });
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ status: 'LINKED' | 'PENDING'; child: string }>('/parent/link', body);
      await queryClient.invalidateQueries({ queryKey: ['parent'] });
      toast(r.status === 'LINKED' ? `${r.child} — ${tr('Child added')}` : tr('Sent to the class teacher. You get a notification when it is confirmed.'));
      close();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NEED_CHILD_DETAILS') setError(tr('Enter your child’s name and roll number'));
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={close} style={{ maxWidth: 520, alignSelf: 'center', width: '94%', maxHeight: '90%' }}>
        <Dialog.Title>{tr('Add a child')}</Dialog.Title>
        <Dialog.ScrollArea style={{ paddingHorizontal: 0, borderColor: 'transparent' }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, gap: 10, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            <TextInput
              mode="outlined"
              label={tr('Class code or card code')}
              value={code}
              onChangeText={(v) => { setCode(v.toUpperCase()); if (found) reset(); }}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="ALN-9A"
              onSubmitEditing={check}
              style={{ fontSize: 22, letterSpacing: 2 }}
              testID="link-code"
            />
            <Text variant="bodySmall" style={{ color: t.app.muted }}>
              {tr('The class code is like ALN-9A (from the teacher or school). A card code is like K7QP-3MXA (printed card). We work out which one it is.')}
            </Text>
            {found?.kind === 'card' ? (
              <View style={{ padding: 12, borderRadius: 12, backgroundColor: t.colors.secondaryContainer, gap: 2 }}>
                <Text variant="titleMedium">{found.child.name}</Text>
                <Text variant="bodyMedium">{found.child.className} {found.child.sectionName} · {tr('Roll number')} {found.child.rollNo}</Text>
                <Text variant="bodySmall">{found.child.school}</Text>
              </View>
            ) : null}
            {found?.kind === 'class' ? (
              <View style={{ gap: 10 }}>
                <Text variant="titleSmall">{found.school.name}{found.school.section ? ` — ${found.school.section.className} ${found.school.section.name}` : ''}</Text>
                {!found.school.section ? <ClassSectionPicker school={found.school} sectionId={sectionId} onChange={setSectionId} /> : null}
                <TextInput mode="outlined" label={tr('Child’s full name *')} value={childName} onChangeText={setChildName} testID="link-name" />
                <TextInput mode="outlined" label={tr('Roll number *')} value={rollNo} onChangeText={setRollNo} keyboardType="number-pad" testID="link-roll" />
                <TextInput mode="outlined" label={tr('Date of birth (DD/MM/YYYY)')} value={dob} onChangeText={setDob} placeholder="05/03/2014" keyboardType="numbers-and-punctuation" testID="link-dob" />
                <Text variant="bodySmall" style={{ color: t.app.muted }}>{tr('With the right name and date of birth it links at once. Otherwise the class teacher confirms it.')}</Text>
              </View>
            ) : null}
            {error ? <HelperText type="error" visible>{error}</HelperText> : null}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={close}>{tr('Cancel')}</Button>
          {found ? (
            <Button mode="contained" onPress={link} loading={busy} disabled={busy} testID="link-submit">{found.kind === 'card' ? tr('Yes, add this child') : tr('Add child')}</Button>
          ) : (
            <Button mode="contained" onPress={check} loading={busy} disabled={busy} testID="link-check">{tr('Next')}</Button>
          )}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
