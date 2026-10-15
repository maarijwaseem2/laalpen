import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
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
import type { Session } from '@/lib/types';

/** Second sign-in step: authenticator / backup code, or the code emailed for a new device. */
export default function TwoStep() {
  const t = useAppTheme();
  const { challengeId = '', kind = 'TOTP', email = '' } = useLocalSearchParams<{ challengeId: string; kind: string; email: string }>();
  const setSession = useAuth((s) => s.setSession);
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totp = kind === 'TOTP';

  const verify = async () => {
    const clean = code.trim();
    if (!backup && !/^\d{6}$/.test(clean)) return setError('Enter the 6-digit code');
    if (backup && clean.length < 8) return setError('Backup codes look like ab12c-3de45');
    setBusy(true);
    setError(null);
    try {
      await setSession(await api.public<Session>('/auth/login/verify', { challengeId, code: clean, ...(await deviceInfo()) }));
      if (backup) toast('Backup code used. Each code works only once.');
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title={totp ? 'Enter your authenticator code' : 'Confirm this new device'}
      subtitle={
        totp
          ? 'Open Google Authenticator (or Microsoft Authenticator) on your phone and type the 6-digit code for LaalPen.'
          : `This phone or computer is new for your account. We emailed a 6-digit code to ${email || 'your email'}.`
      }
    >
      <TextInput
        mode="outlined"
        label={backup ? 'Backup code' : '6-digit code'}
        value={code}
        onChangeText={(v) => setCode(backup ? v.slice(0, 20) : v.replace(/\D/g, '').slice(0, 6))}
        keyboardType={backup ? 'default' : 'number-pad'}
        autoCapitalize="none"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        onSubmitEditing={verify}
        style={backup ? undefined : { fontSize: 24, letterSpacing: 8 }}
      />
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      <Button mode="contained" onPress={verify} loading={busy} disabled={busy} contentStyle={{ height: 48 }}>
        {totp ? 'Sign in' : 'Confirm and sign in'}
      </Button>
      {totp ? (
        <Button onPress={() => { setBackup((b) => !b); setCode(''); setError(null); }}>
          {backup ? 'Use the authenticator app instead' : 'Lost your phone? Use a backup code'}
        </Button>
      ) : (
        <Text variant="bodySmall" style={{ color: t.app.muted }}>
          If you did not try to sign in, someone knows your password. Change it right away.
        </Text>
      )}
      <Button onPress={() => router.replace('/login')}>Back to log in</Button>
    </AuthFrame>
  );
}
