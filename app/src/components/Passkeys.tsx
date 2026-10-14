import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, List, Text } from 'react-native-paper';
import { toast, toastError } from './feedback';
import { Card, useAppTheme } from './ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { addPasskey, passkeysSupported } from '@/lib/passkeys';
import type { User } from '@/lib/types';

/** Add / remove passkeys (browser). A passkey also counts as two-step sign-in for admins. */
export function PasskeysCard({ onAdded }: { onAdded?: () => void }) {
  const t = useAppTheme();
  const setUser = useAuth((s) => s.setUser);
  const q = useQuery({ queryKey: ['passkeys'], queryFn: () => api.get<{ id: string; name: string | null; createdAt: string; lastUsedAt: string | null }[]>('/auth/passkeys') });
  const [busy, setBusy] = useState(false);
  const supported = passkeysSupported();

  const add = async () => {
    setBusy(true);
    try {
      const ua = (globalThis.navigator?.userAgent ?? '').toLowerCase();
      await addPasskey(ua.includes('android') ? 'Android phone' : ua.includes('iphone') ? 'iPhone' : ua.includes('mac') ? 'Mac' : ua.includes('windows') ? 'Windows PC' : 'Passkey');
      await q.refetch();
      setUser(await api.get<User>('/auth/me'));
      toast('Passkey added. Next time just use your fingerprint or face.');
      onAdded?.();
    } catch (e) {
      const name = (e as Error)?.name;
      if (name !== 'NotAllowedError' && name !== 'AbortError') toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 6 }}>
      <Text variant="titleMedium">Passkeys</Text>
      <Text variant="bodySmall" style={{ color: t.app.muted }}>
        Sign in with your fingerprint, face or screen lock — no password to steal, and fake LaalPen pages cannot use it.
      </Text>
      {(q.data ?? []).map((p) => (
        <List.Item key={p.id} title={p.name ?? 'Passkey'} description={`Added ${fmtDate(p.createdAt)}${p.lastUsedAt ? ` · used ${fmtDate(p.lastUsedAt)}` : ''}`} left={(pp) => <List.Icon {...pp} icon="fingerprint" />}
          right={() => <Button compact onPress={async () => { await api.del(`/auth/passkeys/${p.id}`).catch(toastError); await q.refetch(); setUser(await api.get<User>('/auth/me')); }}>Remove</Button>} />
      ))}
      <View style={{ flexDirection: 'row' }}>
        {supported ? (
          <Button mode="contained-tonal" icon="fingerprint" onPress={add} loading={busy} disabled={busy}>Add a passkey</Button>
        ) : (
          <Text variant="bodySmall" style={{ color: t.app.muted }}>Open LaalPen in Chrome, Edge or Safari to add a passkey.</Text>
        )}
      </View>
    </Card>
  );
}
