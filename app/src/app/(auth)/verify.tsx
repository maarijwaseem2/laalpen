import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { HelperText } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { TextInput } from '@/components/Input';
import { AuthFrame } from '@/components/AuthFrame';
import { toast } from '@/components/feedback';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/query';
import type { Session } from '@/lib/types';
import { useT } from '@/lib/i18n';

export default function Verify() {
  const { email = '', code: linkCode = '' } = useLocalSearchParams<{ email: string; code?: string }>();
  const tr = useT();
  const setSession = useAuth((s) => s.setSession);
  const [code, setCode] = useState(String(linkCode).replace(/\D/g, '').slice(0, 6));
  const auto = useRef(false);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(45);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const verify = async () => {
    if (code.length !== 6) return setError(tr('Enter the 6-digit code from the email'));
    setBusy(true);
    setError(null);
    try {
      await setSession(await api.public<Session>('/auth/verify-email', { email, code }));
      toast(tr('Email verified. Welcome to LaalPen!'));
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // the "Verify my email" button in the email opens /verify?email=…&code=…
  useEffect(() => {
    if (linkCode && email && !auto.current) {
      auto.current = true;
      void verify();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resend = async () => {
    try {
      await api.public('/auth/resend-otp', { email, purpose: 'VERIFY_EMAIL' });
      toast(tr('New code sent'));
      setWait(45);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <AuthFrame title={tr('Check your email')} subtitle={`${tr('We sent a 6-digit code to')} ${email || tr('your email')}. ${tr('It expires in 10 minutes.')}`}>
      <TextInput
        mode="outlined"
        label={tr('Verification code')}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        onSubmitEditing={verify}
        style={{ fontSize: 24, letterSpacing: 8 }}
      />
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      <Button mode="contained" onPress={verify} loading={busy} disabled={busy} contentStyle={{ height: 48 }}>
        {tr('Verify email')}
      </Button>
      <Button onPress={resend} disabled={wait > 0}>
        {wait > 0 ? `${tr('Send a new code in')} ${wait}s` : tr('Send a new code')}
      </Button>
      <Button onPress={() => router.replace({ pathname: '/login', params: { mode: 'family' } })}>{tr('Back to log in')}</Button>
    </AuthFrame>
  );
}
