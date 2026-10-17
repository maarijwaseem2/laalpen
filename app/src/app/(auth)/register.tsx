import { Link, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { AuthFrame } from '@/components/AuthFrame';
import { TextInput } from '@/components/Input';
import { useAppTheme } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { PENDING_CODE_KEY, useAuth } from '@/lib/auth';
import { deviceInfo } from '@/lib/device';
import { GoogleCancelled, googleIdToken } from '@/lib/google';
import { errorText } from '@/lib/query';
import { prefs } from '@/lib/storage';
import { isChallenge, type Challenge, type Session } from '@/lib/types';
import { useT } from '@/lib/i18n';

/**
 * The only public sign-up: one Parent / Student account (read-only). Name, email (verified with a code),
 * optional mobile number (can be used to sign in), password. The child is linked afterwards with one code box.
 * Schools, principals and teachers are never created here.
 */
export default function Register() {
  const params = useLocalSearchParams<{ code?: string; card?: string }>();
  const t = useAppTheme();
  const tr = useT();
  const setSession = useAuth((s) => s.setSession);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'form' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // a class / card code from a QR is kept and linked after sign-up
  useEffect(() => {
    const code = params.code ?? params.card;
    if (code) void prefs.set(PENDING_CODE_KEY, String(code));
  }, [params.code, params.card]);

  const submit = async () => {
    if (name.trim().length < 2) return setError(tr('Enter your name'));
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(tr('Enter a valid email. We send a code to check it.'));
    if (phone.trim() && phone.replace(/\D/g, '').length < 10) return setError(tr('Enter a mobile number like 0300 1234567, or leave it empty'));
    if (password.length < 8) return setError(tr('Password must be at least 8 characters'));
    setBusy('form');
    setError(null);
    try {
      const r = await api.public<{ email: string }>('/auth/signup', { name: name.trim(), email: email.trim(), phone: phone.trim() || undefined, password });
      router.replace({ pathname: '/verify', params: { email: r.email } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setBusy('google');
    setError(null);
    try {
      const idToken = await googleIdToken();
      const r = await api.public<Session | Challenge>('/auth/google', { idToken, signup: true, ...(await deviceInfo()) });
      if (isChallenge(r)) return void router.push({ pathname: '/two-step', params: { challengeId: r.challengeId, kind: r.kind, email: r.email ?? '' } });
      await setSession(r);
      router.replace('/');
    } catch (e) {
      if (!(e instanceof GoogleCancelled)) setError(e instanceof ApiError ? e.message : errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthFrame title={tr('Create a Parent / Student account')} subtitle={tr('See your child’s checked copies and results. After signing up, add your child with the code from the school.')}>
      <TextInput mode="outlined" label={tr('Your name *')} value={name} onChangeText={setName} autoComplete="name" testID="su-name" />
      <TextInput mode="outlined" label={tr('Email *')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" testID="su-email" />
      <TextInput mode="outlined" label={tr('Mobile number (optional)')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="0300 1234567" testID="su-phone" />
      <TextInput
        mode="outlined"
        label={tr('Password *')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!show}
        autoComplete="new-password"
        onSubmitEditing={submit}
        testID="su-password"
        right={<TextInput.Icon icon={show ? 'eye-off' : 'eye'} onPress={() => setShow((s) => !s)} accessibilityLabel={show ? 'Hide password' : 'Show password'} />}
      />
      <Text variant="bodySmall" style={{ color: t.app.muted, marginTop: -6 }}>{tr('At least 8 characters. You can sign in with your email or mobile number.')}</Text>
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      <Button mode="contained" onPress={submit} loading={busy === 'form'} disabled={!!busy} contentStyle={{ height: 52 }} labelStyle={{ fontSize: 16 }} testID="su-submit">
        {tr('Create my account')}
      </Button>
      <Button mode="outlined" icon="google" onPress={google} loading={busy === 'google'} disabled={!!busy} contentStyle={{ height: 48 }}>
        {tr('Sign up with Google')}
      </Button>
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
        <Text variant="bodyMedium">{tr('Already have an account?')}</Text>
        <Link href={{ pathname: '/login', params: { mode: 'family' } }} asChild>
          <Button compact>{tr('Log in')}</Button>
        </Link>
      </View>
      <Text variant="bodySmall" style={{ color: t.app.muted, textAlign: 'center' }}>{tr('Principals and teachers do not sign up here: LaalPen or your principal sends you an invite.')}</Text>
    </AuthFrame>
  );
}
