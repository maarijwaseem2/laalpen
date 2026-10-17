import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './SafeButton';
import { Wordmark } from './Shell';
import { LangButton } from './LangButton';
import { useAppTheme } from './ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/query';
import { useThemeMode } from '@/lib/theme';
import { unregisterPush } from '@/lib/push';
import { useT } from '@/lib/i18n';

/** Full-page frame for first-sign-in steps (school profile, teacher profile / waiting): nothing else is reachable. */
export function SetupFrame({ title, subtitle, children, step }: { title: string; subtitle?: string; children: ReactNode; step?: string }) {
  const t = useAppTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { dark, toggle } = useThemeMode();
  const { refreshToken, clear } = useAuth();
  const logout = async () => {
    await unregisterPush();
    if (refreshToken) await api.public('/auth/logout', { refreshToken }).catch(() => undefined);
    queryClient.clear();
    await clear();
    router.replace('/login');
  };
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 6, paddingHorizontal: 16 }}>
        <View style={{ flex: 1 }}>
          <Wordmark size={30} />
        </View>
        <LangButton />
        <IconButton icon={dark ? 'white-balance-sunny' : 'weather-night'} onPress={toggle} accessibilityLabel={dark ? 'Switch to light mode' : 'Switch to dark mode'} />
        <Button compact icon="logout" onPress={logout}>{tr('Log out')}</Button>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 720, gap: 16 }}>
          {step ? <Text variant="labelLarge" style={{ color: t.colors.primary }}>{step}</Text> : null}
          <Text variant="headlineSmall" accessibilityRole="header">{title}</Text>
          {subtitle ? <Text variant="bodyLarge" style={{ color: t.app.muted, marginTop: -8 }}>{subtitle}</Text> : null}
          {children}
        </View>
      </ScrollView>
    </View>
  );
}
