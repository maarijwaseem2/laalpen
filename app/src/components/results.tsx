import { router } from 'expo-router';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { Card, ScoreRing, useAppTheme } from './ui';
import { fmtNum, fmtShort } from '@/lib/format';

export interface ResultRow { submissionId: string; title: string; subject: string; color: string | null; obtained: number; total: number; percent: number; testDate: string; publishedAt: string }
export function ResultCard({ r, href }: { r: ResultRow; href?: string }) {
  const t = useAppTheme();
  return (
    <Card accent={r.color} onPress={() => router.push((href ?? `/student/result/${r.submissionId}`) as any)} label={`${r.title}, ${r.obtained} out of ${r.total}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium">{r.title}</Text>
          <Text variant="bodySmall" style={{ color: t.app.muted }}>{r.subject} — {fmtShort(r.testDate)}</Text>
          <Text variant="labelLarge" style={{ marginTop: 6, color: r.percent >= 60 ? t.app.pass : r.percent >= 40 ? t.app.review : t.colors.primary }}>{fmtNum(r.percent)}%</Text>
        </View>
        <ScoreRing obtained={r.obtained} total={r.total} size={64} />
      </View>
    </Card>
  );
}

