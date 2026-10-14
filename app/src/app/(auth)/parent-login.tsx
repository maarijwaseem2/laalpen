import { Link, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, HelperText, Text } from 'react-native-paper';
import { AuthFrame } from '@/components/AuthFrame';
import { TextInput } from '@/components/Input';
import { useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { deviceInfo } from '@/lib/device';
import { errorText } from '@/lib/query';
import type { Session } from '@/lib/types';
import { useT } from '@/lib/i18n';

/**
 * Parents sign in with the mobile number the school has on file — no email or password.
 * One number opens every child with that number (brothers and sisters together).
 */
export default function ParentLogin() {
  const t = useAppTheme();
  const setSession = useAuth((s) => s.setSession);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tr = useT();

  const start = async () => {
    if (phone.replace(/\D/g, '').length < 10) return setError('Enter your mobile number like 0300 1234567');
    setBusy(true);
    setError(null);
    try {
      const r = await api.public<{ phone: string; message: string }>('/auth/phone/start', { phone });
      setSent(r.message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError('Type the 6-digit code');
    setBusy(true);
    setError(null);
    try {
      const s = await api.public<Session>('/auth/phone/verify', { phone, code: code.trim(), ...(await deviceInfo()) });
      await setSession(s);
      router.replace('/parent');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title={tr('Parent login')} subtitle={tr('Use the mobile number you gave the school. We send a code by SMS or WhatsApp.')}>
      <TextInput mode="outlined" label={tr('Mobile number')} placeholder="0300 1234567" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" editable={!sent} onSubmitEditing={start} />
      {sent ? (
        <>
          <Text variant="bodyMedium" style={{ color: t.app.muted }}>{sent}</Text>
          <TextInput mode="outlined" label={tr('6-digit code')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" textContentType="oneTimeCode" onSubmitEditing={verify} />
        </>
      ) : null}
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      <Button mode="contained" onPress={sent ? verify : start} loading={busy} disabled={busy} contentStyle={{ height: 48 }}>
        {tr(sent ? 'Open my children’s results' : 'Send code')}
      </Button>
      {sent ? (
        <Button onPress={() => { setSent(null); setCode(''); }} disabled={busy}>{tr('Use another number')}</Button>
      ) : (
        <HelperText type="info">{tr('Number not working? Ask the school to update it, or for a parent code card.')}</HelperText>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
        <Text variant="bodyMedium">{tr('Teacher, student or admin?')}</Text>
        <Link href="/login" asChild>
          <Button compact>{tr('Log in with email')}</Button>
        </Link>
      </View>
    </AuthFrame>
  );
}
