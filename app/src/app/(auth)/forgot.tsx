import { router } from 'expo-router';
import { useState } from 'react';
import { HelperText } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { TextInput } from '@/components/Input';
import { AuthFrame } from '@/components/AuthFrame';
import { api } from '@/lib/api';
import { errorText } from '@/lib/query';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!email.trim()) return setError('Enter your email');
    setBusy(true);
    setError(null);
    try {
      await api.public('/auth/forgot-password', { email: email.trim() });
      router.push({ pathname: '/reset', params: { email: email.trim().toLowerCase() } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Reset your password" subtitle="Enter your account email. If it exists, we send a 6-digit code.">
      <TextInput mode="outlined" label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" onSubmitEditing={send} />
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      <Button mode="contained" onPress={send} loading={busy} disabled={busy} contentStyle={{ height: 48 }}>
        Send code
      </Button>
      <Button onPress={() => router.replace('/login')}>Back to log in</Button>
    </AuthFrame>
  );
}
