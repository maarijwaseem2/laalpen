import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Button, Dialog, Divider, List, Portal, Switch, Text } from 'react-native-paper';
import { Confirm, FormDialog, toast, toastError, useDialog } from '@/components/feedback';
import { Avatar, Card, PageHeader, Screen, Tag, useAppTheme } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { api } from '@/lib/api';
import { useLang } from '@/lib/i18n';
import { LangButton } from '@/components/LangButton';
import { PasskeysCard } from '@/components/Passkeys';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { queryClient } from '@/lib/query';
import { useThemeMode } from '@/lib/theme';
import { unregisterPush } from '@/lib/push';
import type { User } from '@/lib/types';

export default function Profile() {
  const t = useAppTheme();
  const { user, setUser, setSession, refreshToken, clear } = useAuth();
  const { dark, toggle } = useThemeMode();
  const lang = useLang((s) => s.lang);
  const edit = useDialog();
  const pass = useDialog();
  const off2fa = useDialog();
  const newCodes = useDialog();
  const everywhere = useDialog();
  const [shownCodes, setShownCodes] = useState<string[] | null>(null);
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get<{ id: string; label: string | null; lastIp: string | null; lastSeenAt: string }[]>('/auth/devices') });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ id: string; deviceLabel: string | null; ip: string | null; method: string; lastSeenAt: string; current: boolean }[]>('/auth/sessions') });
  if (!user) return null;
  const role = user.role === 'ADMIN' ? 'School admin' : user.role === 'TEACHER' ? 'Teacher' : user.role === 'PARENT' ? 'Parent' : `Student — ${user.student?.className} ${user.student?.sectionName}, roll ${user.student?.rollNo}`;
  const isParent = user.role === 'PARENT';

  const logout = async () => {
    await unregisterPush();
    if (refreshToken) await api.public('/auth/logout', { refreshToken }).catch(() => undefined);
    queryClient.clear();
    await clear();
    router.replace('/login');
  };

  return (
    <Screen maxWidth={720}>
      <PageHeader title="Profile" />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Avatar name={user.name} size={60} />
          <View style={{ flex: 1 }}>
            <Text variant="titleLarge">{user.name}</Text>
            <Text variant="bodyMedium" style={{ color: t.app.muted }}>{user.email ?? user.phone}</Text>
            <Text variant="bodyMedium" style={{ color: t.app.muted }}>{role}</Text>
            {user.school ? <Text variant="bodyMedium" style={{ color: t.app.muted }}>{user.school.name}</Text> : null}
          </View>
        </View>
      </Card>
      <Card style={{ padding: 0 }}>
        <List.Item title="Language / زبان" description={lang === 'ur' ? 'اردو' : 'English'} left={(p) => <List.Icon {...p} icon="translate" />} right={() => <LangButton />} />
        <Divider />
        <List.Item title="Dark mode" description="Light is the default. Your choice is remembered on this device." left={(p) => <List.Icon {...p} icon="weather-night" />} right={() => <Switch value={dark} onValueChange={toggle} accessibilityLabel="Dark mode" />} />
        <Divider />
        <List.Item title="Edit name and phone" left={(p) => <List.Icon {...p} icon="account-edit-outline" />} onPress={() => edit.open()} />
        <Divider />
        {!isParent ? <List.Item title="Change password" left={(p) => <List.Icon {...p} icon="lock-reset" />} onPress={() => pass.open()} /> : null}
        {!isParent ? <Divider /> : null}
        <List.Item title="Log out" titleStyle={{ color: t.colors.primary }} left={(p) => <List.Icon {...p} color={t.colors.primary} icon="logout" />} onPress={logout} />
      </Card>
      {!isParent ? <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Text variant="titleMedium" style={{ flex: 1 }}>Two-step sign-in</Text>
          <Tag label={user.twoFactor ? 'On' : 'Off'} tone={user.twoFactor ? 'pass' : 'muted'} icon={user.twoFactor ? 'shield-check-outline' : 'shield-outline'} />
        </View>
        <Text variant="bodyMedium" style={{ color: t.app.muted }}>
          {user.twoFactor
            ? 'Signing in needs your password and the code from your authenticator app.'
            : 'Add an authenticator app so a stolen password alone cannot open your account.'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {!user.twoFactor ? <Button mode="contained-tonal" icon="shield-key-outline" onPress={() => router.push('/security/two-factor')}>Turn on</Button> : null}
          {user.twoFactor ? <Button mode="outlined" icon="key-chain-variant" onPress={() => newCodes.open()}>New backup codes</Button> : null}
          {user.twoFactor && user.role !== 'ADMIN' ? <Button onPress={() => off2fa.open()}>Turn off</Button> : null}
        </View>
      </Card> : null}
      {!isParent ? <PasskeysCard /> : null}
      <Card style={{ gap: 6 }}>
        <Text variant="titleMedium">Signed in now</Text>
        <Text variant="bodySmall" style={{ color: t.app.muted }}>Don’t recognise one? Sign it out — and change your password.</Text>
        {(sessions.data ?? []).map((x) => (
          <List.Item key={x.id} title={`${x.deviceLabel ?? 'Unknown device'}${x.current ? ' (this device)' : ''}`} description={`Active ${fmtDate(x.lastSeenAt)}${x.ip ? ` · ${x.ip}` : ''} · ${x.method}`} left={(p) => <List.Icon {...p} icon={x.current ? 'cellphone-check' : 'devices'} />}
            right={() => (x.current ? null : <Button compact onPress={async () => { await api.del(`/auth/sessions/${x.id}`).catch(toastError); await sessions.refetch(); }}>Sign out</Button>)} />
        ))}
      </Card>
      <Card style={{ gap: 6 }}>
        <Text variant="titleMedium">Devices that signed in</Text>
        <Text variant="bodySmall" style={{ color: t.app.muted }}>We email you when a new phone or computer signs in.</Text>
        {(devices.data ?? []).map((d) => (
          <List.Item key={d.id} title={d.label ?? 'Unknown device'} description={`Last used ${fmtDate(d.lastSeenAt)}${d.lastIp ? ` · ${d.lastIp}` : ''}`} left={(p) => <List.Icon {...p} icon="cellphone" />}
            right={() => <Button compact onPress={async () => { await api.del(`/auth/devices/${d.id}`).catch(toastError); await devices.refetch(); }}>Forget</Button>} />
        ))}
        <Button mode="text" icon="logout-variant" textColor={t.colors.primary} onPress={() => everywhere.open()} style={{ alignSelf: 'flex-start' }}>
          Sign out on all devices
        </Button>
      </Card>
      <Text variant="bodySmall" style={{ color: t.app.muted }}>Connected to {API_URL}</Text>

      <FormDialog visible={edit.visible} title="Edit profile" submitLabel="Save" initial={{ name: user.name, phone: user.phone ?? '' }}
        fields={[{ key: 'name', label: 'Full name', required: true }, { key: 'phone', label: 'Phone' }]}
        onDismiss={edit.close}
        onSubmit={async (v) => { setUser(await api.patch<User>('/auth/me', { name: v.name, phone: v.phone || undefined })); toast('Profile saved'); }} />
      <FormDialog visible={pass.visible} title="Change password" submitLabel="Change password"
        fields={[
          { key: 'currentPassword', label: 'Current password', type: 'password', required: true },
          { key: 'newPassword', label: 'New password', type: 'password', required: true, help: 'At least 8 characters. A short sentence is easy to remember, e.g. "meri chai thandi hai"' },
        ]}
        onDismiss={pass.close}
        onSubmit={async (v) => { await setSession(await api.post('/auth/change-password', v)); toast('Password changed. Other devices were logged out.'); }} />
      <Button mode="text" onPress={() => router.push('/notifications')} style={{ alignSelf: 'flex-start' }}>Open notifications</Button>
      <FormDialog visible={off2fa.visible} title="Turn off two-step sign-in" submitLabel="Turn off"
        fields={[{ key: 'code', label: 'Code from your authenticator app (or a backup code)', required: true }]}
        onDismiss={off2fa.close}
        onSubmit={async (v) => { await api.post('/auth/2fa/disable', { code: v.code.trim() }); setUser(await api.get<User>('/auth/me')); toast('Two-step sign-in is off'); }} />
      <FormDialog visible={newCodes.visible} title="New backup codes" submitLabel="Create new codes"
        fields={[{ key: 'code', label: 'Code from your authenticator app', required: true, help: 'Your old backup codes stop working.' }]}
        onDismiss={newCodes.close}
        onSubmit={async (v) => { const r = await api.post<{ backupCodes: string[] }>('/auth/2fa/backup-codes', { code: v.code.trim() }); setShownCodes(r.backupCodes); }} />
      <Portal>
        <Dialog visible={!!shownCodes} onDismiss={() => setShownCodes(null)} style={{ maxWidth: 460, alignSelf: 'center', width: '92%' }}>
          <Dialog.Title>Your new backup codes</Dialog.Title>
          <Dialog.Content style={{ gap: 6 }}>
            <Text variant="bodyMedium">Each code signs you in once if you lose your phone. Keep them safe.</Text>
            {shownCodes?.map((c) => <Text key={c} selectable style={{ fontFamily: 'monospace', fontSize: 16 }}>{c}</Text>)}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={async () => { await Clipboard.setStringAsync(shownCodes?.join('\n') ?? ''); toast('Copied'); }}>Copy</Button>
            <Button mode="contained" onPress={() => setShownCodes(null)}>Done</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <Confirm visible={everywhere.visible} title="Sign out everywhere?" body="Every phone and computer (this one too) will need to sign in again. Use this if a phone was lost or someone else knows your password."
        confirmLabel="Sign out everywhere" destructive onCancel={everywhere.close}
        onConfirm={async () => { everywhere.close(); await api.post('/auth/logout-all').catch(toastError); await logout(); }} />
    </Screen>
  );
}
