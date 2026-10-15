import { useState } from 'react';
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
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = (ok: boolean) => {
    resolve?.(ok);
    useStepUp.setState({ resolve: null });
    setSecret('');
    setError(null);
  };

  const submit = async () => {
    const v = secret.trim();
    if (!v) return setError('Type your password or the 6-digit code');
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/step-up', /^\d{6}$|^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(v) && user?.twoFactor ? { code: v } : { password: v });
      done(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <Dialog visible={!!resolve} onDismiss={() => done(false)} style={{ maxWidth: 440, alignSelf: 'center', width: '92%' }}>
        <Dialog.Icon icon="shield-lock-outline" />
        <Dialog.Title style={{ textAlign: 'center' }}>Confirm it’s you</Dialog.Title>
        <Dialog.Content style={{ gap: 10 }}>
          <Text variant="bodyMedium">
            This changes important school records. {user?.twoFactor ? 'Type your password or the code from your authenticator app.' : 'Type your password again.'}
          </Text>
          <TextInput
            mode="outlined"
            label={user?.twoFactor ? 'Password or 6-digit code' : 'Password'}
            value={secret}
            onChangeText={setSecret}
            secureTextEntry={!/^\d+$/.test(secret)}
            autoFocus
            autoCapitalize="none"
            onSubmitEditing={submit}
          />
          {error ? <HelperText type="error" visible>{error}</HelperText> : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => done(false)}>Cancel</Button>
          <Button mode="contained" onPress={submit} loading={busy} disabled={busy}>Confirm</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
