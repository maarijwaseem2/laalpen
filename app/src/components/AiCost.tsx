import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { api } from '@/lib/api';
import { Card, useAppTheme } from './ui';

interface Usage {
  days: number;
  costUsd: number;
  copiesChecked: number;
  costPerCopyUsd: number;
  cachedShare: number;
  calls: number;
  topTests: { testId: string; title: string; className: string | null; costUsd: number }[];
}

const PKR_PER_USD = 280;
const rs = (usd: number) => `Rs ${(usd * PKR_PER_USD).toFixed(usd * PKR_PER_USD < 10 ? 2 : 0)}`;

/** What AI checking cost this school in the last 30 days (from the provider's own token counts). */
export function AiCostCard() {
  const t = useAppTheme();
  const q = useQuery({ queryKey: ['admin', 'ai-usage'], queryFn: () => api.get<Usage>('/admin/ai-usage?days=30') });
  const d = q.data;
  if (!d) return null;
  return (
    <Card style={{ gap: 8 }}>
      <Text variant="titleMedium">AI checking cost · last {d.days} days</Text>
      <View style={{ flexDirection: 'row', gap: 24, flexWrap: 'wrap' }}>
        <View>
          <Text variant="headlineSmall">{rs(d.costUsd)}</Text>
          <Text variant="bodySmall" style={{ color: t.app.muted }}>${d.costUsd.toFixed(2)} total</Text>
        </View>
        <View>
          <Text variant="headlineSmall">{d.copiesChecked}</Text>
          <Text variant="bodySmall" style={{ color: t.app.muted }}>copies checked</Text>
        </View>
        <View>
          <Text variant="headlineSmall">{rs(d.costPerCopyUsd)}</Text>
          <Text variant="bodySmall" style={{ color: t.app.muted }}>per copy</Text>
        </View>
        <View>
          <Text variant="headlineSmall">{Math.round(d.cachedShare * 100)}%</Text>
          <Text variant="bodySmall" style={{ color: t.app.muted }}>input at cache discount</Text>
        </View>
      </View>
      <Text variant="bodySmall" style={{ color: t.app.muted }}>
        Rupee figures use Rs {PKR_PER_USD} per dollar. Blurry photos are stopped before the AI, so they cost nothing.
      </Text>
    </Card>
  );
}
