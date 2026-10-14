import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout } from '@/lib/layout';
import { PEN_FONT, useThemeMode } from '@/lib/theme';
import { Wordmark } from './Shell';
import { PenNote, ScoreRing, useAppTheme } from './ui';
import { IconButton } from 'react-native-paper';
import { LangButton } from './LangButton';

/** A piece of a checked copy: ruled lines, the student's ink, the teacher's red pen. */
function CopyPreview() {
  const t = useAppTheme();
  const ink = t.dark ? '#B9C7E6' : '#1F3A7A';
  const line = (k: number) => <View key={k} style={{ position: 'absolute', left: 0, right: 0, top: 70 + k * 44, height: 1, backgroundColor: t.app.rule }} />;
  return (
    <View style={[styles.copy, { backgroundColor: t.dark ? '#141B2B' : '#FFFFFF', borderColor: t.colors.outlineVariant }]}>
      {Array.from({ length: 9 }, (_, k) => line(k))}
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: 54, width: 1.5, backgroundColor: t.dark ? '#5a2b33' : '#F1B7BF' }} />
      <View style={{ position: 'absolute', right: 18, top: 14 }}>
        <ScoreRing obtained={13} total={15} size={84} />
      </View>
      <View style={{ paddingLeft: 66, paddingTop: 44, paddingRight: 110, gap: 15 }}>
        <Text style={[styles.hand, { color: ink }]}>Q2. v = s / t = 150 / 12</Text>
        <View>
          <Text style={[styles.hand, { color: ink }]}>v = 13.5</Text>
          <View style={{ height: 2, width: 96, backgroundColor: t.app.pen, marginTop: 2, borderRadius: 1, transform: [{ rotate: '-1deg' }] }} />
        </View>
      </View>
      <View style={{ position: 'absolute', left: 178, top: 108, transform: [{ rotate: '-3deg' }] }}>
        <PenNote size={22}>12.5, not 13.5 — add m/s</PenNote>
      </View>
      <View style={{ paddingLeft: 66, paddingTop: 52, gap: 15 }}>
        <Text style={[styles.hand, { color: ink }]}>Q3. A body stays at rest or keeps</Text>
        <Text style={[styles.hand, { color: ink }]}>moving unless a force acts on it.  </Text>
      </View>
      <View style={{ position: 'absolute', right: 34, top: 214 }}>
        <Text style={{ fontFamily: PEN_FONT, color: t.app.pen, fontSize: 30 }}>✓ 5/5</Text>
      </View>
    </View>
  );
}

export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const t = useAppTheme();
  const { wide } = useLayout();
  const insets = useSafeAreaInsets();
  const { dark, toggle } = useThemeMode();

  const form = (
    <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 14 }}>
      {!wide ? <Wordmark size={40} /> : null}
      <View style={{ gap: 4, marginBottom: 6 }}>
        <Text variant="headlineMedium" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodyMedium" style={{ color: t.app.muted }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ position: 'absolute', right: 8, top: insets.top + 4, zIndex: 2, flexDirection: 'row', alignItems: 'center' }}>
        <LangButton />
        <IconButton icon={dark ? 'white-balance-sunny' : 'weather-night'} onPress={toggle} accessibilityLabel="Toggle dark mode" />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {wide ? (
          <View style={{ flex: 1, flexDirection: 'row', minHeight: '100%' as any }}>
            <View style={[styles.left, { backgroundColor: t.dark ? '#121A2A' : '#EEF2FA' }]}>
              <Wordmark size={46} />
              <Text variant="headlineSmall" style={{ marginTop: 18, maxWidth: 440 }}>
                Every copy checked in minutes, every mark explained on the page.
              </Text>
              <Text variant="bodyLarge" style={{ marginTop: 10, color: t.app.muted, maxWidth: 440 }}>
                AI does the first check. Your teachers decide the final marks.
              </Text>
              <View style={{ marginTop: 36 }}>
                <CopyPreview />
              </View>
            </View>
            <View style={{ flex: 1, justifyContent: 'center', padding: 40 }}>{form}</View>
          </View>
        ) : (
          <View style={{ padding: 22, paddingTop: insets.top + 36, paddingBottom: insets.bottom + 24 }}>{form}</View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  left: { flex: 1.1, padding: 56, justifyContent: 'center' },
  copy: { width: 460, maxWidth: '100%', height: 360, borderRadius: 14, borderWidth: 1, overflow: 'hidden', transform: [{ rotate: '-1.2deg' }] },
  hand: { fontFamily: 'Caveat_700Bold', fontSize: 25, lineHeight: 29 },
});
