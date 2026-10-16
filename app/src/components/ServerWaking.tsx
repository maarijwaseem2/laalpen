import { View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServer } from '@/lib/wake';
import { useT } from '@/lib/i18n';
import { useAppTheme } from './ui';

/** Small note at the top while the sleeping API starts (free hosting), so a slow first login does not look broken. */
export function ServerWaking() {
  const waking = useServer((s) => s.waking);
  const insets = useSafeAreaInsets();
  const t = useAppTheme();
  const tr = useT();
  if (!waking) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, alignItems: 'center' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, maxWidth: 560, backgroundColor: t.colors.inverseSurface }}>
        <ActivityIndicator size={16} color={t.colors.inverseOnSurface} />
        <Text variant="bodySmall" style={{ color: t.colors.inverseOnSurface, flexShrink: 1 }}>
          {tr('Starting the LaalPen server… the first visit can take up to a minute.')}
        </Text>
      </View>
    </View>
  );
}
