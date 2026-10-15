import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { SvgXml } from 'react-native-svg';
import { TextInput } from '@/components/Input';
import { toast, toastError } from '@/components/feedback';
import { Card, PageHeader, Screen, useAppTheme } from '@/components/ui';
import { passkeysSupported } from '@/lib/passkeys';
import { PasskeysCard } from '@/components/Passkeys';
import { api } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { errorText } from '@/lib/query';
import type { User } from '@/lib/types';

/**
 * Turn on the authenticator app (TOTP). Required for principals/admins because they can see the whole
 * school's data; optional for teachers. Free: no SMS, works without signal.
 */
export default function TwoFactorSetup() {
  const t = useAppTheme();
  const { user, setUser } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; uri: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const required = user?.mfaSetupRequired;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.post('/auth/2fa/setup'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from the app');
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ backupCodes: string[]; user: User }>('/auth/2fa/enable', { code });
      setCodes(r.backupCodes);
      setUser(r.user);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <Screen maxWidth={640}>
        <PageHeader title="Save your backup codes" subtitle="Two-step sign-in is on." />
        <Card style={{ gap: 12 }}>
          <Text variant="bodyMedium">
            If you lose your phone, each of these codes lets you sign in once. Write them down or keep them somewhere safe — they are shown only now.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {codes.map((c) => (
              <Text key={c} selectable style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 16, padding: 8, borderRadius: 8, backgroundColor: t.colors.surfaceVariant, minWidth: 130, textAlign: 'center' }}>
                {c}
              </Text>
            ))}
          </View>
          <Button mode="outlined" icon="content-copy" onPress={async () => { await Clipboard.setStringAsync(codes.join('\n')); toast('Backup codes copied'); }} style={{ alignSelf: 'flex-start' }}>
            Copy codes
          </Button>
          <Button mode="contained" onPress={() => router.replace((user ? homeFor(user.role, user) : '/') as any)}>
            I saved them — continue
          </Button>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={640}>
      <PageHeader back={!required} title="Protect your account" subtitle={required ? 'Principals and admins must use an authenticator app before opening school data.' : 'Add an authenticator app for two-step sign-in.'} />
      <Card style={{ gap: 12 }}>
        <Text variant="titleMedium">1. Install an authenticator app</Text>
        <Text variant="bodyMedium" style={{ color: t.app.muted }}>
          Google Authenticator or Microsoft Authenticator (free on Play Store / App Store). It shows a new 6-digit code every 30 seconds, even without internet.
        </Text>
        <Text variant="titleMedium">2. Add LaalPen to the app</Text>
        {!setup ? (
          <Button mode="contained" icon="qrcode" onPress={start} loading={busy} disabled={busy} style={{ alignSelf: 'flex-start' }}>
            Show my QR code
          </Button>
        ) : (
          <View style={{ gap: 10 }}>
            <Text variant="bodyMedium" style={{ color: t.app.muted }}>In the app tap “+”, then “Scan a QR code”. On this phone itself? Copy the key and choose “Enter a setup key”.</Text>
            <View style={{ alignSelf: 'center', padding: 8, backgroundColor: '#fff', borderRadius: 12 }}>
              <SvgXml xml={setup.qrSvg} width={220} height={220} />
            </View>
            <Text selectable style={{ textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 1 }}>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</Text>
            <Button mode="outlined" icon="content-copy" onPress={async () => { await Clipboard.setStringAsync(setup.secret); toast('Setup key copied'); }} style={{ alignSelf: 'center' }}>
              Copy setup key
            </Button>
            <Text variant="titleMedium">3. Type the code the app shows</Text>
            <TextInput mode="outlined" label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" onSubmitEditing={enable} style={{ fontSize: 22, letterSpacing: 6 }} />
            <Button mode="contained" onPress={enable} loading={busy} disabled={busy}>
              Turn on two-step sign-in
            </Button>
          </View>
        )}
        {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      </Card>
      {passkeysSupported() ? (
        <>
          <Text variant="bodyMedium" style={{ color: t.app.muted, textAlign: 'center' }}>— or —</Text>
          <PasskeysCard onAdded={() => { if (required) router.replace('/admin'); }} />
        </>
      ) : null}
      {required ? (
        <Button onPress={async () => { const { clear } = useAuth.getState(); await clear().catch(toastError); router.replace('/login'); }}>
          Log out
        </Button>
      ) : null}
    </Screen>
  );
}
