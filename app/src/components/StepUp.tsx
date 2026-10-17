import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Dialog, HelperText, Portal, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { create } from 'zustand';
import { TextInput } from './Input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/query';

interface StepUpState {
  resolve: ((ok: boolean) => void) | null;
  ask: () => Promise<boolean>;
}

const useStepUp = create<StepUpState>((set, get) => ({
  resolve: null,
  ask: () =>
    new Promise<boolean>((resolve) => {
      get().resolve?.(false);
      set({ resolve });
    }),
}));

/** Used by the API client when the server answers STEP_UP_REQUIRED. */
export const askStepUp = () => useStepUp.getState().ask();

/**
 * "Confirm it's you": before sensitive actions (re-opening published marks, year-end promotion,
 * importing a register, deleting) the person types their password or authenticator code again.
 */
export function StepUpDialog() {
  const resolve = useStepUp((s) => s.resolve);
  const user = useAuth((s) => s.user);
  const staff = !!user?.staff;
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** staff: 'email' (default, code sent to their email) or 'app' (authenticator) */
  const [via, setVia] = useState<'email' | 'app'>('email');
  const [sent, setSent] = useState<{ demo?: string } | null>(null);
  const [sending, setSending] = useState(false);

  const done = (ok: boolean) => {
    resolve?.(ok);
    useStepUp.setState({ resolve: null });
    setSecret('');
    setError(null);
    setSent(null);
    setVia('email');
  };

  const sendEmail = async () => {
    setSending(true);
    setError(null);
    try {
      const r = await api.post<{ ok: boolean; demoCode?: string }>('/auth/step-up/email', {});
      setSent({ demo: r.demoCode });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  // staff have no password: email the code as soon as the dialog opens
  useEffect(() => {
    if (resolve && staff && via === 'email' && !sent && !sending) void sendEmail();
  }, [resolve, staff, via]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const v = secret.trim();
    if (!v) return setError(staff ? 'Type the 6-digit code' : 'Type your password or the 6-digit code');
    setBusy(true);
    setError(null);
    try {
      const body = staff
        ? via === 'email' ? { emailCode: v } : { code: v }
        : /^\d{6}$|^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(v) && user?.twoFactor ? { code: v } : { password: v };
      await api.post('/auth/step-up', body);
      done(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const explain = staff
    ? via === 'email'
      ? `This changes important school records. We emailed a 6-digit code to ${user?.email ?? 'your email'}.`
      : 'This changes important school records. Type the code from your authenticator app.'
    : `This changes important school records. ${user?.twoFactor ? 'Type your password or the code from your authenticator app.' : 'Type your password again.'}`;

  return (
    <Portal>
      <Dialog visible={!!resolve} onDismiss={() => done(false)} style={{ maxWidth: 440, alignSelf: 'center', width: '92%' }}>
        <Dialog.Icon icon="shield-lock-outline" />
        <Dialog.Title style={{ textAlign: 'center' }}>Confirm it’s you</Dialog.Title>
        <Dialog.Content style={{ gap: 10 }}>
          <Text variant="bodyMedium">{explain}</Text>
          {staff && via === 'email' && sent?.demo ? <Text variant="bodyMedium">Demo school: your code is <Text style={{ fontWeight: '700' }}>{sent.demo}</Text></Text> : null}
          <TextInput
            mode="outlined"
            label={staff ? '6-digit code' : user?.twoFactor ? 'Password or 6-digit code' : 'Password'}
            value={secret}
            onChangeText={setSecret}
            secureTextEntry={!staff && !/^\d+$/.test(secret)}
            keyboardType={staff ? 'number-pad' : 'default'}
            autoFocus
            autoCapitalize="none"
            onSubmitEditing={submit}
          />
          {error ? <HelperText type="error" visible>{error}</HelperText> : null}
          {staff ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {via === 'email' ? <Button compact onPress={sendEmail} loading={sending} disabled={sending}>Send a new code</Button> : null}
              {user?.twoFactor ? <Button compact onPress={() => { setVia(via === 'email' ? 'app' : 'email'); setSecret(''); setError(null); }}>{via === 'email' ? 'Use authenticator app' : 'Email me a code'}</Button> : null}
            </View>
          ) : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => done(false)}>Cancel</Button>
          <Button mode="contained" onPress={submit} loading={busy} disabled={busy}>Confirm</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
