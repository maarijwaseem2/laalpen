import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, HelperText, SegmentedButtons, Text } from 'react-native-paper';
import { AuthFrame } from '@/components/AuthFrame';
import { TextInput } from '@/components/Input';
import { ClassSectionPicker, type SchoolInfo } from '@/components/SchoolPicker';
import { Card, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { errorText } from '@/lib/query';
import { useT } from '@/lib/i18n';

export default function Register() {
  const [kind, setKind] = useState<'student' | 'school'>('student');
  const tr = useT();
  return (
    <AuthFrame
      title={kind === 'student' ? tr('Join your school') : 'Register your school'}
      subtitle={kind === 'student' ? 'Use your class code or the card from your school. Parents: use “Parent login” on the sign-in page.' : 'You become the school admin and add classes and teachers after this.'}
    >
      <SegmentedButtons
        value={kind}
        onValueChange={(v) => setKind(v as 'student' | 'school')}
        buttons={[
          { value: 'student', label: tr('I am a student'), icon: 'account-school-outline' },
          { value: 'school', label: tr('New school'), icon: 'domain' },
        ]}
      />
      {kind === 'student' ? <StudentSignup /> : <SchoolSignup />}
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
        <Text variant="bodyMedium">{tr('Already have an account?')}</Text>
        <Link href="/login" asChild>
          <Button compact>Log in</Button>
        </Link>
      </View>
    </AuthFrame>
  );
}

/** DD/MM/YYYY (how Pakistani schools write it) -> YYYY-MM-DD */
function parseDob(v: string): string | null | 'bad' {
  const t = v.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/) ?? null;
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return d.getUTCMonth() === +m[2] - 1 ? d.toISOString().slice(0, 10) : 'bad';
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : 'bad';
}

function StudentSignup() {
  const t = useAppTheme();
  const params = useLocalSearchParams<{ code?: string; card?: string }>();
  // "card": the one-time code printed on the claim card (QR opens laalpen://claim?card=XXXX-XXXX)
  const [mode, setMode] = useState<'class' | 'card'>(params.card ? 'card' : 'class');
  const [code, setCode] = useState((params.code ?? '').toUpperCase());
  const [card, setCard] = useState((params.card ?? '').toUpperCase());
  const [school, setSchool] = useState<(SchoolInfo & { section?: { id: string; className: string; name: string } | null }) | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [f, setF] = useState({ rollNo: '', name: '', dob: '', email: '', password: '', guardianPhone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tr = useT();
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const find = async () => {
    if (code.trim().length < 4) return setError('Enter the class code, for example ALN-9A');
    setBusy(true);
    setError(null);
    try {
      const info = await api.get<SchoolInfo & { section?: { id: string; className: string; name: string } | null }>(`/auth/schools/${encodeURIComponent(code.trim())}`);
      setSchool(info);
      setSectionId(info.section?.id ?? null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const dob = parseDob(f.dob);
    if (dob === 'bad') return setError('Write your date of birth like 14/05/2012');
    if (mode === 'class') {
      if (!sectionId) return setError('Choose your class and section');
      if (!f.rollNo.trim() || !f.name.trim()) return setError('Fill in your roll number and name');
    } else if (card.replace(/[^0-9A-Z]/gi, '').length < 8) return setError('Type the 8-letter code from your card');
    if (!f.email.trim() || !f.password) return setError('Fill in your email and a password');
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === 'card'
          ? { claimCode: card.trim(), email: f.email.trim(), password: f.password, dob: dob ?? undefined }
          : { code: school!.joinCode, sectionId, rollNo: f.rollNo.trim(), name: f.name.trim(), dob: dob ?? undefined, email: f.email.trim(), password: f.password, guardianPhone: f.guardianPhone.trim() || undefined };
      const r = await api.public<{ email: string }>('/auth/claim', body);
      router.push({ pathname: '/verify', params: { email: r.email } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const account = (
    <>
      <TextInput mode="outlined" label="Email *" value={f.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <View>
        <TextInput mode="outlined" label="Password *" value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" />
        <HelperText type="info">At least 8 characters. A short sentence is easy to remember and hard to guess.</HelperText>
      </View>
    </>
  );

  return (
    <>
      <SegmentedButtons
        value={mode}
        onValueChange={(v) => { setMode(v as 'class' | 'card'); setError(null); }}
        density="small"
        buttons={[
          { value: 'class', label: tr('Class code'), icon: 'google-classroom' },
          { value: 'card', label: tr('School card'), icon: 'card-account-details-outline' },
        ]}
      />
      {mode === 'card' ? (
        <>
          <TextInput mode="outlined" label="Code on your card *" placeholder="K7QP-3MXA" value={card} onChangeText={(v) => setCard(v.toUpperCase())} autoCapitalize="characters" />
          <HelperText type="info">The card from your teacher already has your name, class and roll number.</HelperText>
          {account}
        </>
      ) : !school ? (
        <>
          <TextInput mode="outlined" label="Class code" placeholder="ALN-9A" value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" onSubmitEditing={find} />
          {error ? <HelperText type="error" visible>{error}</HelperText> : <HelperText type="info">Your class teacher has this code. A school code works too.</HelperText>}
          <Button mode="contained" onPress={find} loading={busy} disabled={busy} contentStyle={{ height: 48 }}>
            {tr('Find my class')}
          </Button>
        </>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium">{school.name}</Text>
                <Text variant="bodySmall" style={{ color: t.app.muted }}>
                  {school.section ? `${school.section.className} ${school.section.name}` : school.city ?? ''}
                </Text>
              </View>
              <Button compact onPress={() => setSchool(null)}>Change</Button>
            </View>
          </Card>
          {school.section ? null : <ClassSectionPicker school={school} sectionId={sectionId} onChange={setSectionId} />}
          <TextInput mode="outlined" label={tr('Roll number *')} value={f.rollNo} onChangeText={set('rollNo')} />
          <TextInput mode="outlined" label={tr('Your full name *')} value={f.name} onChangeText={set('name')} autoComplete="name" />
          <View>
            <TextInput mode="outlined" label={tr('Date of birth')} placeholder="14/05/2012" value={f.dob} onChangeText={set('dob')} keyboardType="numbers-and-punctuation" />
            <HelperText type="info">As on your school record. If it matches, you are in at once — no waiting for approval.</HelperText>
          </View>
          {account}
          <TextInput mode="outlined" label="Parent's mobile (for results)" placeholder="0300 1234567" value={f.guardianPhone} onChangeText={set('guardianPhone')} keyboardType="phone-pad" />
        </>
      )}
      {(mode === 'card' || school) && error ? <HelperText type="error" visible>{error}</HelperText> : null}
      {mode === 'card' || school ? (
        <Button mode="contained" onPress={submit} loading={busy} disabled={busy} contentStyle={{ height: 48 }}>
          {tr('Create my account')}
        </Button>
      ) : null}
    </>
  );
}

function SchoolSignup() {
  const [f, setF] = useState({ schoolName: '', city: '', name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    if (!f.schoolName.trim() || !f.name.trim() || !f.email.trim() || !f.password) return setError('Fill in all the required fields');
    setBusy(true);
    setError(null);
    try {
      const r = await api.public<{ email: string }>('/auth/register', { ...f, city: f.city || undefined });
      router.push({ pathname: '/verify', params: { email: r.email } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TextInput mode="outlined" label="School name *" value={f.schoolName} onChangeText={set('schoolName')} />
      <TextInput mode="outlined" label="City" value={f.city} onChangeText={set('city')} />
      <TextInput mode="outlined" label="Your name *" value={f.name} onChangeText={set('name')} autoComplete="name" />
      <TextInput mode="outlined" label="Email *" value={f.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <View>
        <TextInput mode="outlined" label="Password *" value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" />
        <HelperText type="info">At least 8 characters with a letter and a number</HelperText>
      </View>
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      <Button mode="contained" onPress={submit} loading={busy} disabled={busy} contentStyle={{ height: 48 }}>
        Create school account
      </Button>
    </>
  );
}
