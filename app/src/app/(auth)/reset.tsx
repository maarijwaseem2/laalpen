import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, HelperText } from 'react-native-paper';
import { TextInput } from '@/components/Input';
import { AuthFrame } from '@/components/AuthFrame';
import { toast } from '@/components/feedback';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/query';
import type { Session } from '@/lib/types';

export default function Reset() {
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const setSession = useAuth((s) => s.setSession);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    if (code.length !== 6 || !password) return setError('Enter the code and a new password');
    setBusy(true);
    setError(null);
    try {
      await setSession(await api.public<Session>('/auth/reset-password', { email, code, password }));
      toast('Password changed');
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Set a new password" subtitle={`Enter the code we sent to ${email}.`}>
      <TextInput mode="outlined" label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" />
      <TextInput mode="outlined" label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" onSubmitEditing={reset} />
      <HelperText type="info">At least 8 characters with a letter and a number</HelperText>
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      <Button mode="contained" onPress={reset} loading={busy} disabled={busy} contentStyle={{ height: 48 }}>
        Change password
      </Button>
    </AuthFrame>
  );
}
