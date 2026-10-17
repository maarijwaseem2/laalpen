import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { TextInput } from '@/components/Input';
import { AuthFrame } from '@/components/AuthFrame';
import { toast } from '@/components/feedback';
import { useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { deviceInfo } from '@/lib/device';
import { errorText } from '@/lib/query';
import { isChallenge, type Challenge, type Session } from '@/lib/types';
import { useT } from '@/lib/i18n';

/**
 * Staff sign-in, step 2: the 6-digit code from the email (or the "Sign in" button in that email, which opens this
 * page with the code filled in). Single use, expires in 10 minutes, 5 tries.
 */
export default function EmailCode() {
  const params = useLocalSearchParams<{ email?: string; masked?: string; code?: string; demo?: string }>();
  const email = (params.email ?? '').toString().toLowerCase();
  const t = useAppTheme();
  const tr = useT();
  const setSession = useAuth((s) => s.setSession);
  const [code, setCode] = useState((params.code ?? '').toString().replace(/\D/g, '').slice(0, 6));
  const [demo, setDemo] = useState((params.demo ?? '').toString());
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(params.code ? 0 : 45);
  const [error, setError] = useState<string | null>(null);
  const auto = useRef(false);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const verify = async (value = code) => {
    if (!/^\d{6}$/.test(value)) return setError(tr('Enter the 6-digit code from the email'));
    if (!email) return setError(tr('Open the link from the email again, or go back and type your email.'));
    setBusy(true);
    setError(null);
    try {
      const r = await api.public<Session | Challenge>('/auth/email-code/verify', { email, code: value, ...(await deviceInfo()) });
      if (isChallenge(r)) return void router.replace({ pathname: '/two-step', params: { challengeId: r.challengeId, kind: r.kind, email: r.email ?? '' } });
      await setSession(r);
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // the email's button opens /email-code?email=…&code=…: sign in straight away
  useEffect(() => {
    if (params.code && !auto.current) {
      auto.current = true;
      void verify(code);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resend = async () => {
    setError(null);
    try {
      const r = await api.public<{ demoCode?: string }>('/auth/email-code/start', { email });
      if (r.demoCode) setDemo(r.demoCode);
      toast(tr('New code sent'));
      setWait(45);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const shown = (params.masked ?? '').toString() || email;
  return (
    <AuthFrame title={tr('Check your email')} subtitle={`${tr('If this email belongs to LaalPen staff, we sent a 6-digit sign-in code to')} ${shown}.`}>
      {demo ? (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: t.colors.secondaryContainer }}>
          <Text variant="bodyMedium">{tr('Demo school account: emails are not sent. Your code is')} <Text style={{ fontWeight: '700', letterSpacing: 2 }} testID="demo-code">{demo}</Text></Text>
          <Button compact onPress={() => { setCode(demo); void verify(demo); }}>{tr('Use this code')}</Button>
        </View>
      ) : null}
      <TextInput
        mode="outlined"
        label={tr('6-digit code')}
        value={code}
        onChangeText={(v) => {
          const c = v.replace(/\D/g, '').slice(0, 6);
          setCode(c);
          if (c.length === 6 && !busy) void verify(c);
        }}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        onSubmitEditing={() => verify()}
        style={{ fontSize: 26, letterSpacing: 10 }}
        testID="email-code"
      />
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      <Button mode="contained" onPress={() => verify()} loading={busy} disabled={busy} contentStyle={{ height: 52 }} labelStyle={{ fontSize: 16 }}>
        {tr('Sign in')}
      </Button>
      <Button onPress={resend} disabled={wait > 0 || !email}>
        {wait > 0 ? `${tr('Send a new code in')} ${wait}s` : tr('Send a new code')}
      </Button>
      <Text variant="bodySmall" style={{ color: t.app.muted }}>{tr('No email? Check spam, or ask your principal to check the email address on your account.')}</Text>
      <Button onPress={() => router.replace({ pathname: '/login', params: { mode: 'staff', email } })}>{tr('Back to log in')}</Button>
    </AuthFrame>
  );
}
