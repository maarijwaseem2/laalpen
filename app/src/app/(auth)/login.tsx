import { Link, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Divider, HelperText, Text } from 'react-native-paper';
import { TextInput } from '@/components/Input';
import { AuthFrame } from '@/components/AuthFrame';
import { useAppTheme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { GoogleCancelled, googleIdToken } from '@/lib/google';
import { errorText } from '@/lib/query';
import { deviceInfo } from '@/lib/device';
import { passkeysSupported, signInWithPasskey } from '@/lib/passkeys';
import { isChallenge, type Challenge, type Session } from '@/lib/types';
import { useT } from '@/lib/i18n';

const DEMO = [
  { label: 'Admin', email: 'admin@laalpen.demo' },
  { label: 'Teacher', email: 'sana.teacher@laalpen.demo' },
  { label: 'Student', email: 'ali.raza@laalpen.demo' },
];

export default function Login() {
  const t = useAppTheme();
  const setSession = useAuth((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'password' | 'google' | 'passkey' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tr = useT();

  const login = async () => {
    if (!email.trim() || !password) return setError('Enter your email and password');
    setBusy('password');
    setError(null);
    try {
      const r = await api.public<Session | Challenge>('/auth/login', { email: email.trim(), password, ...(await deviceInfo()) });
      if (isChallenge(r)) return void router.push({ pathname: '/two-step', params: { challengeId: r.challengeId, kind: r.kind, email: r.email ?? '' } });
      await setSession(r);
      router.replace('/');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED') {
        router.push({ pathname: '/verify', params: { email: email.trim().toLowerCase() } });
      } else setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setBusy('google');
    setError(null);
    try {
      const idToken = await googleIdToken();
      const r = await api.public<Session | Challenge>('/auth/google', { idToken, ...(await deviceInfo()) });
      if (isChallenge(r)) return void router.push({ pathname: '/two-step', params: { challengeId: r.challengeId, kind: r.kind, email: r.email ?? '' } });
      await setSession(r);
      router.replace('/');
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
      if (name !== 'NotAllowedError' && name !== 'AbortError') setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthFrame title={tr('Log in')} subtitle={tr('Teachers, students and school admins use the same login.')}>
      <TextInput mode="outlined" label={tr('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <TextInput
        mode="outlined"
        label={tr('Password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!show}
        autoComplete="password"
        onSubmitEditing={login}
        right={<TextInput.Icon icon={show ? 'eye-off' : 'eye'} onPress={() => setShow((s) => !s)} accessibilityLabel={show ? 'Hide password' : 'Show password'} />}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: -6 }}>
        <Link href="/forgot" asChild>
          <Button compact>{tr('Forgot password?')}</Button>
        </Link>
      </View>
      {error ? <HelperText type="error" visible style={{ marginTop: -8 }}>{error}</HelperText> : null}
      <Button mode="contained" onPress={login} loading={busy === 'password'} disabled={!!busy} contentStyle={{ height: 48 }}>
        {tr('Log in')}
      </Button>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 }}>
        <Divider style={{ flex: 1 }} />
        <Text variant="bodySmall" style={{ color: t.app.muted }}>or</Text>
        <Divider style={{ flex: 1 }} />
      </View>
      <Button mode="outlined" icon="google" onPress={google} loading={busy === 'google'} disabled={!!busy} contentStyle={{ height: 48 }}>
        {tr('Continue with Google')}
      </Button>
      {passkeysSupported() ? (
        <Button mode="outlined" icon="fingerprint" onPress={passkey} loading={busy === 'passkey'} disabled={!!busy} contentStyle={{ height: 48 }}>
          {tr('Sign in with a passkey')}
        </Button>
      ) : null}
      <Link href="/parent-login" asChild>
        <Button mode="text" icon="cellphone-message" contentStyle={{ height: 44 }}>
          {tr('Parent? Sign in with your mobile number')}
        </Button>
      </Link>
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <Text variant="bodyMedium">{tr('New here?')}</Text>
        <Link href="/register" asChild>
          <Button compact>{tr('Sign up as student or school')}</Button>
        </Link>
      </View>
      {__DEV__ ? (
        <View style={{ marginTop: 18, padding: 14, borderRadius: 12, backgroundColor: t.colors.surfaceVariant, gap: 8 }}>
          <Text variant="labelLarge">Demo accounts (password Demo@1234)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {DEMO.map((d) => (
              <Chip key={d.email} compact onPress={() => { setEmail(d.email); setPassword('Demo@1234'); }}>
                {d.label}
              </Chip>
            ))}
          </View>
        </View>
      ) : null}
    </AuthFrame>
  );
}
