import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Chip, HelperText, IconButton, Menu, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { TextInput } from '@/components/Input';
import { SetupFrame } from '@/components/SetupFrame';
import { toast } from '@/components/feedback';
import { Card, ErrorView, Loading, PenNote, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { errorText } from '@/lib/query';
import type { TeacherStatus, User } from '@/lib/types';
import { useT } from '@/lib/i18n';

interface Opt { id: string; label: string }
interface Profile {
  name: string; phone: string | null; qualification: string | null; subjects: string[];
  sections: { sectionId: string; subject: string; label: string }[];
  status: TeacherStatus; rejectReason: string | null; submittedAt: string | null; school: string;
  options: { sections: Opt[]; subjects: string[] };
}
interface Pair { sectionId: string; subject: string }

/**
 * A teacher's first sign-in: full name, phone, qualification, subjects and which class/section they teach which
 * subject in. Then the profile waits for the principal; no student data opens until it is approved.
 */
export default function TeacherSetup() {
  const t = useAppTheme();
  const tr = useT();
  const { user, setUser } = useAuth();
  const q = useQuery({ queryKey: ['teacher', 'profile'], queryFn: () => api.get<Profile>('/teacher/profile'), enabled: user?.role === 'TEACHER' });
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState('');
  const [qualification, setQualification] = useState('');
  const [subjects, setSubjects] = useState('');
  const [pairs, setPairs] = useState<Pair[]>([{ sectionId: '', subject: '' }]);
  const [menu, setMenu] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // while waiting, check every 20 s whether the principal approved
  const me = useQuery({ queryKey: ['me', 'teacher-status'], queryFn: () => api.get<User>('/auth/me'), refetchInterval: 20_000, enabled: user?.role === 'TEACHER' });
  useEffect(() => {
    if (!me.data) return;
    setUser(me.data);
    if (me.data.teacher?.status === 'APPROVED') {
      toast(tr('Your principal approved your profile. Welcome!'));
      router.replace('/teacher');
    }
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = q.data;
    if (!p) return;
    setName(p.name ?? '');
    setPhone(p.phone ?? '');
    setQualification(p.qualification ?? '');
    setSubjects(p.subjects.join(', '));
    if (p.sections.length) setPairs(p.sections.map((s) => ({ sectionId: s.sectionId, subject: s.subject })));
  }, [q.data]);

  if (!user) return <Redirect href="/login" />;
  if (user.role !== 'TEACHER') return <Redirect href={homeFor(user.role, user) as any} />;
  const status = q.data?.status ?? user.teacher?.status ?? 'PROFILE_INCOMPLETE';
  const options = q.data?.options.sections ?? [];
  const label = (id: string) => options.find((o) => o.id === id)?.label ?? tr('Choose class');
  const subjectChoices = [...new Set([...(q.data?.options.subjects ?? []), ...subjects.split(',').map((s) => s.trim()).filter(Boolean)])];

  const submit = async () => {
    const clean = pairs.filter((p) => p.sectionId && p.subject.trim());
    const subs = subjects.split(',').map((s) => s.trim()).filter(Boolean);
    if (name.trim().length < 3) return setError(tr('Enter your full name'));
    if (phone.replace(/\D/g, '').length < 10) return setError(tr('Enter your mobile number, e.g. 0300 1234567'));
    if (qualification.trim().length < 2) return setError(tr('Enter your education, e.g. MSc Physics, B.Ed'));
    if (!clean.length) return setError(tr('Choose at least one class and its subject, e.g. 9-A Maths'));
    setBusy(true);
    setError(null);
    try {
      await api.put('/teacher/profile', { name: name.trim(), phone: phone.trim(), qualification: qualification.trim(), subjects: subs.length ? subs : [...new Set(clean.map((p) => p.subject.trim()))], sections: clean.map((p) => ({ sectionId: p.sectionId, subject: p.subject.trim() })) });
      await q.refetch();
      setUser(await api.get<User>('/auth/me'));
      setEditing(false);
      toast(tr('Sent to your principal for approval'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <SetupFrame title={tr('Your teacher profile')}><Loading /></SetupFrame>;
  if (q.error) return <SetupFrame title={tr('Your teacher profile')}><ErrorView error={q.error} onRetry={() => q.refetch()} /></SetupFrame>;

  if (status === 'PENDING' && !editing) {
    const p = q.data!;
    return (
      <SetupFrame title={tr('Waiting for principal approval')} subtitle={tr('Your profile was sent. Student lists and copies open as soon as your principal approves it. We will email you and show a notification.')}>
        <View style={{ alignItems: 'center', marginVertical: 8 }}>
          <View style={{ width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: t.app.reviewBg }}>
            <MaterialCommunityIcons name="timer-sand" size={44} color={t.app.review} />
          </View>
        </View>
        <Card style={{ gap: 6 }}>
          <Text variant="titleMedium">{p.name}</Text>
          <Text variant="bodyMedium" style={{ color: t.app.muted }}>{p.school} · {p.qualification}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {p.sections.map((s) => <Chip key={`${s.sectionId}${s.subject}`} compact>{s.label} — {s.subject}</Chip>)}
          </View>
        </Card>
        <Button mode="contained-tonal" icon="refresh" onPress={() => me.refetch()} loading={me.isFetching}>{tr('Check again')}</Button>
        <Button icon="pencil-outline" onPress={() => setEditing(true)}>{tr('Change my profile')}</Button>
      </SetupFrame>
    );
  }

  const rejected = status === 'REJECTED';
  return (
    <SetupFrame
      step={tr('Teacher profile')}
      title={rejected ? tr('Your principal asked for changes') : `${tr('Welcome')}, ${user.name.split(' ')[0]}!`}
      subtitle={rejected ? undefined : `${q.data?.school ?? ''} — ${tr('complete your profile. Your principal checks it before your classes open.')}`}
    >
      {rejected && q.data?.rejectReason ? <Card><PenNote size={22}>{q.data.rejectReason}</PenNote></Card> : null}
      <Card style={{ gap: 10 }}>
        <TextInput mode="outlined" label={tr('Full name *')} value={name} onChangeText={setName} testID="tp-name" />
        <TextInput mode="outlined" label={tr('Mobile number *')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0300 1234567" testID="tp-phone" />
        <TextInput mode="outlined" label={tr('Qualification *')} value={qualification} onChangeText={setQualification} placeholder="MSc Physics, B.Ed" testID="tp-qual" />
        <TextInput mode="outlined" label={tr('Subjects you teach')} value={subjects} onChangeText={setSubjects} placeholder="Physics, Mathematics" testID="tp-subjects" />
      </Card>
      <Card style={{ gap: 10 }}>
        <Text variant="titleMedium">{tr('Your classes')}</Text>
        <Text variant="bodySmall" style={{ color: t.app.muted }}>{tr('For each class and section, the subject you teach there.')}</Text>
        {!options.length ? <Text variant="bodyMedium" style={{ color: t.app.review }}>{tr('Your school has no classes yet. Ask your principal to add them.')}</Text> : null}
        {pairs.map((p, i) => (
          <View key={i} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Menu visible={menu === i} onDismiss={() => setMenu(null)} anchor={
                <Button mode="outlined" icon="google-classroom" onPress={() => setMenu(i)} style={{ minWidth: 140 }} testID={`tp-sec-${i}`}>{p.sectionId ? label(p.sectionId) : tr('Choose class')}</Button>
              }>
                {options.map((o) => <Menu.Item key={o.id} title={o.label} onPress={() => { setPairs((x) => x.map((y, j) => (j === i ? { ...y, sectionId: o.id } : y))); setMenu(null); }} />)}
              </Menu>
              <TextInput mode="outlined" dense label={tr('Subject')} value={p.subject} onChangeText={(v) => setPairs((x) => x.map((y, j) => (j === i ? { ...y, subject: v } : y)))} style={{ flex: 1 }} testID={`tp-subj-${i}`} />
              <IconButton icon="close" onPress={() => setPairs((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : x))} accessibilityLabel="Remove" />
            </View>
            {subjectChoices.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {subjectChoices.slice(0, 8).map((s) => <Chip key={s} compact selected={p.subject === s} onPress={() => setPairs((x) => x.map((y, j) => (j === i ? { ...y, subject: s } : y)))}>{s}</Chip>)}
              </View>
            ) : null}
          </View>
        ))}
        <Button icon="plus" onPress={() => setPairs((x) => [...x, { sectionId: '', subject: x[x.length - 1]?.subject ?? '' }])} style={{ alignSelf: 'flex-start' }}>{tr('Add another class')}</Button>
      </Card>
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      <Button mode="contained" onPress={submit} loading={busy} disabled={busy} contentStyle={{ height: 52 }} labelStyle={{ fontSize: 16 }} testID="tp-submit">
        {tr('Send to principal for approval')}
      </Button>
      {editing ? <Button onPress={() => setEditing(false)}>{tr('Cancel')}</Button> : null}
    </SetupFrame>
  );
}
