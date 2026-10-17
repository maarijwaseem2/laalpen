import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { HelperText, IconButton, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { TextInput } from '@/components/Input';
import { SetupFrame } from '@/components/SetupFrame';
import { toast } from '@/components/feedback';
import { Card, ErrorView, Loading, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { errorText } from '@/lib/query';
import type { User } from '@/lib/types';
import { useT } from '@/lib/i18n';

interface Profile {
  id: string; name: string; city: string | null; address: string | null; phone: string | null; board: string | null; logoUrl: string | null; joinCode: string | null;
  profileComplete: boolean; classes: { id: string; name: string; grade: number | null; sections: string[] }[]; subjects: string[];
}
interface Row { name: string; sections: string; existing?: boolean }

/** A principal's first sign-in: complete the school profile and add classes / sections (and subjects). */
export default function SchoolSetup() {
  const t = useAppTheme();
  const tr = useT();
  const { user, setUser } = useAuth();
  const q = useQuery({ queryKey: ['school', 'profile'], queryFn: () => api.get<Profile>('/school/profile'), enabled: user?.role === 'PRINCIPAL' });
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [board, setBoard] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [rows, setRows] = useState<Row[]>([{ name: '', sections: 'A' }]);
  const [subjects, setSubjects] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = q.data;
    if (!p) return;
    setName(p.name ?? '');
    setAddress(p.address ?? '');
    setCity(p.city ?? '');
    setPhone(p.phone ?? '');
    setBoard(p.board ?? '');
    setLogoUrl(p.logoUrl ?? '');
    if (p.classes.length) setRows(p.classes.map((c) => ({ name: c.name, sections: c.sections.join(', '), existing: true })));
    if (p.subjects.length) setSubjects(p.subjects.join(', '));
  }, [q.data]);

  if (!user) return <Redirect href="/login" />;
  if (user.role !== 'PRINCIPAL') return <Redirect href={homeFor(user.role, user) as any} />;
  const editing = !!q.data?.profileComplete;

  const save = async () => {
    const classes = rows
      .filter((r) => r.name.trim())
      .map((r) => {
        const grade = Number((r.name.match(/\d+/) ?? [])[0]);
        return { name: r.name.trim(), ...(Number.isFinite(grade) && grade <= 20 ? { grade } : {}), sections: r.sections.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) };
      });
    if (name.trim().length < 2) return setError(tr('Enter the school name'));
    if (address.trim().length < 3) return setError(tr('Enter the school address'));
    if (city.trim().length < 2) return setError(tr('Enter the city'));
    if (phone.replace(/\D/g, '').length < 7) return setError(tr('Enter the school phone number, e.g. 021 34567890'));
    if (!classes.length) return setError(tr('Add at least one class with a section'));
    if (classes.some((c) => !c.sections.length)) return setError(tr('Every class needs at least one section, e.g. A'));
    if (logoUrl.trim() && !/^https:\/\//.test(logoUrl.trim())) return setError(tr('The logo must be an https:// link'));
    setBusy(true);
    setError(null);
    try {
      await api.put('/school/profile', {
        name: name.trim(), address: address.trim(), city: city.trim(), phone: phone.trim(),
        board: board.trim() || undefined, logoUrl: logoUrl.trim() || undefined, classes,
        subjects: subjects.split(',').map((s) => s.trim()).filter(Boolean),
      });
      const me = await api.get<User>('/auth/me');
      setUser(me);
      toast(tr('School profile saved'));
      router.replace(editing ? '/admin' : '/admin/teachers');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SetupFrame
      step={editing ? undefined : tr('Step 1 of 2 — your school')}
      title={editing ? tr('School profile') : `${tr('Welcome')}, ${user.name.split(' ')[0]}!`}
      subtitle={editing ? undefined : tr('You are the principal. Fill in your school’s details and classes. Next, you add your teachers.')}
    >
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      <Card style={{ gap: 10 }}>
        <Text variant="titleMedium">{tr('School details')}</Text>
        <TextInput mode="outlined" label={tr('School name *')} value={name} onChangeText={setName} testID="sch-name" />
        <TextInput mode="outlined" label={tr('Address *')} value={address} onChangeText={setAddress} placeholder="12 Main Boulevard, Gulberg" testID="sch-address" />
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <TextInput mode="outlined" label={tr('City *')} value={city} onChangeText={setCity} style={{ flex: 1, minWidth: 160 }} testID="sch-city" />
          <TextInput mode="outlined" label={tr('School phone *')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="042 35761234" style={{ flex: 1, minWidth: 160 }} testID="sch-phone" />
        </View>
        <TextInput mode="outlined" label={tr('Board (optional)')} value={board} onChangeText={setBoard} placeholder="BISE Lahore / Federal / Cambridge" />
        <TextInput mode="outlined" label={tr('Logo link (optional)')} value={logoUrl} onChangeText={setLogoUrl} autoCapitalize="none" placeholder="https://…/logo.png" />
      </Card>
      <Card style={{ gap: 10 }}>
        <Text variant="titleMedium">{tr('Classes and sections')}</Text>
        <Text variant="bodySmall" style={{ color: t.app.muted }}>{tr('One row per class. Sections separated by commas, e.g. A, B, C. You can add more later.')}</Text>
        {rows.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput mode="outlined" label={tr('Class')} value={r.name} onChangeText={(v) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: v } : y)))} placeholder="Class 9" style={{ flex: 1 }} disabled={r.existing} testID={`cls-name-${i}`} />
            <TextInput mode="outlined" label={tr('Sections')} value={r.sections} onChangeText={(v) => setRows((x) => x.map((y, j) => (j === i ? { ...y, sections: v } : y)))} placeholder="A, B" style={{ flex: 1 }} testID={`cls-sec-${i}`} />
            {!r.existing ? <IconButton icon="close" onPress={() => setRows((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : x))} accessibilityLabel="Remove class" /> : <View style={{ width: 48 }} />}
          </View>
        ))}
        <Button icon="plus" onPress={() => setRows((x) => [...x, { name: '', sections: 'A' }])} style={{ alignSelf: 'flex-start' }}>{tr('Add class')}</Button>
      </Card>
      <Card style={{ gap: 10 }}>
        <Text variant="titleMedium">{tr('Subjects (optional)')}</Text>
        <TextInput mode="outlined" label={tr('Subjects, separated by commas')} value={subjects} onChangeText={setSubjects} placeholder="Mathematics, Physics, English, Urdu" testID="sch-subjects" />
        <Text variant="bodySmall" style={{ color: t.app.muted }}>{tr('Teachers also add the subjects they teach in their profile.')}</Text>
      </Card>
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      <Button mode="contained" onPress={save} loading={busy} disabled={busy} contentStyle={{ height: 52 }} labelStyle={{ fontSize: 16 }} testID="sch-save">
        {editing ? tr('Save') : tr('Save and continue')}
      </Button>
    </SetupFrame>
  );
}
