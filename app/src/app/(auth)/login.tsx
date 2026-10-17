import { Link, router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Chip, Divider, HelperText, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { TextInput } from '@/components/Input';
import { AuthFrame } from '@/components/AuthFrame';
import { useAppTheme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { GoogleCancelled, googleIdToken } from '@/lib/google';
import { errorText } from '@/lib/query';
import { deviceInfo } from '@/lib/device';
import { passkeysSupported, signInWithPasskey } from '@/lib/passkeys';
import { prefs } from '@/lib/storage';
import { isChallenge, type Challenge, type Session } from '@/lib/types';
import { useT } from '@/lib/i18n';

type Mode = 'staff' | 'family';
const MODE_KEY = 'laalpen.login.mode';

const DEMO_STAFF = [
  { label: 'Principal', email: 'admin@laalpen.demo' },
  { label: 'Teacher', email: 'sana.teacher@laalpen.demo' },
];

/** One big choice first: Staff (principal / teacher) or Parent / Student. Staff never type a password. */
export default function Login() {
  const params = useLocalSearchParams<{ staff?: string; mode?: string; email?: string }>();
  const t = useAppTheme();
  const tr = useT();
  const setSession = useAuth((s) => s.setSession);
  const initial: Mode | null = params.staff === '1' || params.mode === 'staff' ? 'staff' : params.mode === 'family' ? 'family' : null;
  const [mode, setMode] = useState<Mode | null>(initial);
  const [email, setEmail] = useState((params.email ?? '').toString());
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'code' | 'password' | 'google' | 'passkey' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [googleSignup, setGoogleSignup] = useState<string | null>(null);

  useEffect(() => {
    if (!initial) void prefs.get(MODE_KEY).then((v) => setMode((m) => m ?? (v === 'staff' || v === 'family' ? v : null)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (m: Mode | null) => {
    setMode(m);
    setError(null);
    setGoogleSignup(null);
    if (m) void prefs.set(MODE_KEY, m);
  };

  const finish = async (r: Session | Challenge) => {
    if (isChallenge(r)) return void router.push({ pathname: '/two-step', params: { challengeId: r.challengeId, kind: r.kind, email: r.email ?? '' } });
    await setSession(r);
    router.replace('/');
  };

  /** staff: email a one-time sign-in code */
  const sendCode = async () => {
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) return setError(tr('Enter your school email'));
    setBusy('code');
    setError(null);
    try {
      const r = await api.public<{ ok: true; email: string; demoCode?: string }>('/auth/email-code/start', { email: e });
      router.push({ pathname: '/email-code', params: { email: e, masked: r.email, ...(r.demoCode ? { demo: r.demoCode } : {}) } });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  /** parent / student: email or mobile number + password */
  const login = async () => {
    const id = email.trim();
    if (!id || !password) return setError(tr('Enter your email or mobile number and password'));
    setBusy('password');
    setError(null);
    const byPhone = !id.includes('@');
    try {
      await finish(await api.public<Session | Challenge>('/auth/login', { ...(byPhone ? { phone: id } : { email: id }), password, ...(await deviceInfo()) }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED') {
        const to: string = e.body?.email ?? (byPhone ? '' : id.toLowerCase());
        router.push({ pathname: '/verify', params: { email: to } });
      } else if (e instanceof ApiError && e.code === 'STAFF_USE_EMAIL_CODE') {
        choose('staff');
        setError(tr('Principals and teachers do not use a password. Tap “Email me a sign-in code”.'));
      } else setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const google = async (signupToken?: string) => {
    setBusy('google');
    setError(null);
    try {
      const idToken = signupToken ?? (await googleIdToken());
      try {
        await finish(await api.public<Session | Challenge>('/auth/google', { idToken, ...(signupToken ? { signup: true } : {}), ...(await deviceInfo()) }));
        setGoogleSignup(null);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'ACCOUNT_NOT_FOUND' && mode === 'family') {
          setGoogleSignup(idToken);
          setError(tr('No account uses this Google email yet.'));
        } else throw e;
      }
    } catch (e) {
      if (!(e instanceof GoogleCancelled)) setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const passkey = async () => {
    setBusy('passkey');
    setError(null);
    try {
      await setSession(await signInWithPasskey(email.trim() || undefined));
      router.replace('/');
    } catch (e) {
      const name = (e as Error)?.name;
      if (e instanceof ApiError && e.code === 'PASSKEY_BLOCKED') setError(tr('Passkey sign-in is paused after 3 failed tries. Sign in with the emailed code (staff) or your password to turn it back on.'));
      else if (name !== 'NotAllowedError' && name !== 'AbortError') setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const orLine = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 }}>
      <Divider style={{ flex: 1 }} />
      <Text variant="bodySmall" style={{ color: t.app.muted }}>{tr('or')}</Text>
      <Divider style={{ flex: 1 }} />
    </View>
  );

  if (!mode) {
    return (
      <AuthFrame title={tr('Log in')} subtitle={tr('Who is signing in?')}>
        <RoleCard icon="human-male-board" title={tr('Staff')} body={tr('Principal / Teacher')} hint={tr('Sign in with a code sent to your email')} onPress={() => choose('staff')} testID="pick-staff" />
        <RoleCard icon="account-child-outline" title={tr('Parent / Student')} body={tr('See checked copies and results')} hint={tr('Email or mobile number + password')} onPress={() => choose('family')} testID="pick-family" />
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          <Text variant="bodyMedium">{tr('New parent or student?')}</Text>
          <Link href="/register" asChild>
            <Button compact>{tr('Create an account')}</Button>
          </Link>
        </View>
        <Text variant="bodySmall" style={{ color: t.app.muted, textAlign: 'center' }}>
          {tr('Schools are added by LaalPen. Principals get an invite email.')}
        </Text>
      </AuthFrame>
    );
  }

  const staff = mode === 'staff';
  return (
    <AuthFrame title={staff ? tr('Staff log in') : tr('Parent / Student log in')} subtitle={staff ? tr('Principal / Teacher — no password needed.') : tr('Use the email or mobile number you signed up with.')}>
      <Button compact icon="arrow-left" onPress={() => choose(null)} style={{ alignSelf: 'flex-start', marginTop: -8 }}>
        {staff ? tr('Not staff? Parent / Student') : tr('Staff? Principal / Teacher')}
      </Button>
      {staff ? (
        <>
          <TextInput mode="outlined" label={tr('School email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" onSubmitEditing={sendCode} testID="staff-email" />
          {error ? <HelperText type="error" visible style={{ marginTop: -8 }}>{error}</HelperText> : null}
          <Button mode="contained" icon="email-fast-outline" onPress={sendCode} loading={busy === 'code'} disabled={!!busy} contentStyle={{ height: 52 }} labelStyle={{ fontSize: 16 }} testID="send-code">
            {tr('Email me a sign-in code')}
          </Button>
          <Text variant="bodySmall" style={{ color: t.app.muted }}>{tr('We email a 6-digit code every time you sign in. It works once and expires in 10 minutes.')}</Text>
          {orLine}
          {passkeysSupported() ? (
            <Button mode="outlined" icon="fingerprint" onPress={passkey} loading={busy === 'passkey'} disabled={!!busy} contentStyle={{ height: 48 }}>
              {tr('Sign in with a passkey')}
            </Button>
          ) : null}
          <Button mode="outlined" icon="google" onPress={() => google()} loading={busy === 'google'} disabled={!!busy} contentStyle={{ height: 48 }}>
            {tr('Continue with Google')}
          </Button>
          <Text variant="bodySmall" style={{ color: t.app.muted }}>{tr('Google works only for staff your school already added, with the same email.')}</Text>
        </>
      ) : (
        <>
          <TextInput mode="outlined" label={tr('Email or mobile number')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="username" testID="family-id" />
          <TextInput
            mode="outlined"
            label={tr('Password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!show}
            autoComplete="password"
            onSubmitEditing={login}
            testID="family-password"
            right={<TextInput.Icon icon={show ? 'eye-off' : 'eye'} onPress={() => setShow((s) => !s)} accessibilityLabel={show ? 'Hide password' : 'Show password'} />}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: -6 }}>
            <Link href="/forgot" asChild>
              <Button compact>{tr('Forgot password?')}</Button>
            </Link>
          </View>
          {error ? <HelperText type="error" visible style={{ marginTop: -8 }}>{error}</HelperText> : null}
          {googleSignup ? (
            <Button mode="contained-tonal" icon="account-plus-outline" onPress={() => google(googleSignup)} disabled={!!busy}>
              {tr('Create a Parent / Student account with this Google email')}
            </Button>
          ) : null}
          <Button mode="contained" onPress={login} loading={busy === 'password'} disabled={!!busy} contentStyle={{ height: 52 }} labelStyle={{ fontSize: 16 }} testID="family-login">
            {tr('Log in')}
          </Button>
          {orLine}
          <Button mode="outlined" icon="google" onPress={() => google()} loading={busy === 'google'} disabled={!!busy} contentStyle={{ height: 48 }}>
            {tr('Continue with Google')}
          </Button>
          {passkeysSupported() ? (
            <Button mode="outlined" icon="fingerprint" onPress={passkey} loading={busy === 'passkey'} disabled={!!busy} contentStyle={{ height: 48 }}>
              {tr('Sign in with a passkey')}
            </Button>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <Text variant="bodyMedium">{tr('New here?')}</Text>
            <Link href="/register" asChild>
              <Button compact>{tr('Create a Parent / Student account')}</Button>
            </Link>
          </View>
        </>
      )}
      {__DEV__ ? (
        <View style={{ marginTop: 18, padding: 14, borderRadius: 12, backgroundColor: t.colors.surfaceVariant, gap: 8 }}>
          <Text variant="labelLarge">{staff ? 'Demo staff (code shown on screen)' : 'Demo family (password Demo@1234)'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {staff
              ? DEMO_STAFF.map((d) => <Chip key={d.email} compact onPress={() => setEmail(d.email)}>{d.label}</Chip>)
              : <Chip compact onPress={() => { setEmail('parent@laalpen.demo'); setPassword('Demo@1234'); }}>Parent</Chip>}
          </View>
        </View>
      ) : null}
    </AuthFrame>
  );
}

function RoleCard({ icon, title, body, hint, onPress, testID }: { icon: string; title: string; body: string; hint: string; onPress: () => void; testID?: string }) {
  const t = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${body}`}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18, borderRadius: 16, borderWidth: 1.5,
        borderColor: pressed ? t.colors.primary : t.colors.outlineVariant, backgroundColor: pressed ? t.colors.primaryContainer : t.colors.surface,
      })}
    >
      <View style={{ width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.primaryContainer }}>
        <MaterialCommunityIcons name={icon as any} size={32} color={t.colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="titleLarge" style={{ fontWeight: '600' }}>{title}</Text>
        <Text variant="bodyLarge">{body}</Text>
        <Text variant="bodySmall" style={{ color: t.app.muted }}>{hint}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={28} color={t.app.muted} />
    </Pressable>
  );
}
