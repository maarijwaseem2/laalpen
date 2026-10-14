import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, HelperText } from 'react-native-paper';
import { TextInput } from '@/components/Input';
import { AuthFrame } from '@/components/AuthFrame';
import { toast } from '@/components/feedback';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/query';
import type { Session } from '@/lib/types';

export default function Verify() {
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const setSession = useAuth((s) => s.setSession);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(45);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const verify = async () => {
    if (code.length !== 6) return setError('Enter the 6-digit code from the email');
    setBusy(true);
    setError(null);
    try {
      await setSession(await api.public<Session>('/auth/verify-email', { email, code }));
      toast('Email verified. Welcome to LaalPen!');
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await api.public('/auth/resend-otp', { email, purpose: 'VERIFY_EMAIL' });
      toast('New code sent');
      setWait(45);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <AuthFrame title="Check your email" subtitle={`We sent a 6-digit code to ${email}. It expires in 10 minutes.`}>
      <TextInput
        mode="outlined"
        label="Verification code"
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
        Verify email
      </Button>
      <Button onPress={resend} disabled={wait > 0}>
        {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
      </Button>
      <Button onPress={() => router.replace('/login')}>Back to log in</Button>
    </AuthFrame>
  );
}
