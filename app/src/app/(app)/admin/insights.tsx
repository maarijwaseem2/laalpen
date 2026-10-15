import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SegmentedButtons, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { toast, toastError } from '@/components/feedback';
import { Card, Empty, ErrorView, Grid, Loading, PageHeader, Screen, SectionTitle, Stat, Tag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { openFile } from '@/lib/files';
import { fmtNum } from '@/lib/format';

interface Insights {
  turnaround: { aiHours: number; teacherHours: number | null; totalHours: number | null; copies: number };
  pending: { checking: number; withTeachers: number; problems: number; approved: number };
  teachers: { id: string; name: string; tests: number; copies: number; waiting: number; problems: number; turnaroundHours: number | null; changedByTeacher: number | null }[];
  classes: { sectionId: string; name: string; students: number; tests: number; average: number | null }[];
  heatmap: { sections: { id: string; name: string }[]; topics: { subject: string; topic: string }[]; cells: { sectionId: string; subject: string; topic: string; percent: number; answers: number }[] };
  weakest: { section: string; subject: string; topic: string; percent: number }[];
}

// one-hue sequential ramp (light = low, dark = high); the number is always printed in the cell
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const cellColor = (p: number) => RAMP[Math.min(RAMP.length - 1, Math.floor((p / 100) * RAMP.length))];
const hours = (h: number | null) => (h === null ? '–' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${fmtNum(h)} h` : `${fmtNum(h / 24)} days`);

/** Principal dashboard: is checking keeping up, how are classes doing, which topics need re-teaching. */
export default function InsightsScreen() {
  const t = useAppTheme();
  const [days, setDays] = useState('30');
  const q = useQuery({ queryKey: ['admin', 'insights', days], queryFn: () => api.get<Insights>(`/admin/insights?days=${days}`) });
  const [busy, setBusy] = useState<string | null>(null);
  const d = q.data;

  const exportFile = async (format: 'xlsx' | 'csv') => {
    setBusy(format);
    try {
      const r = await api.get<{ url: string; rows: number; session: string }>(`/admin/export/results?format=${format}`);
      toast(`${r.rows} results from ${r.session}`);
      await openFile(r.url);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader
        title="Insights"
        subtitle="Checking speed, what is waiting, and the topics each class finds hard."
        actions={
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button mode="outlined" icon="microsoft-excel" onPress={() => exportFile('xlsx')} loading={busy === 'xlsx'} disabled={!!busy}>Export Excel</Button>
            <Button icon="file-delimited-outline" onPress={() => exportFile('csv')} loading={busy === 'csv'} disabled={!!busy}>CSV for ERP</Button>
          </View>
        }
      />
      <SegmentedButtons value={days} onValueChange={setDays} style={{ maxWidth: 360 }} buttons={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {d ? (
        <>
          <Grid max={4} min={2}>
            <Stat label="Photo to result (median)" value={hours(d.turnaround.totalHours)} hint={`AI ${hours(d.turnaround.aiHours)} · teacher ${hours(d.turnaround.teacherHours)}`} tone="info" />
            <Stat label="Waiting for teachers" value={d.pending.withTeachers} tone={d.pending.withTeachers ? 'review' : undefined} hint="checked, not approved" />
            <Stat label="Need a retake" value={d.pending.problems} tone={d.pending.problems ? 'pen' : undefined} />
            <Stat label="Published copies" value={d.pending.approved} tone="pass" />
          </Grid>

          <View>
            <SectionTitle title="Lowest-scoring topics (re-teach these first)" />
            {d.weakest.length ? (
              <Card style={{ gap: 6 }}>
                {d.weakest.map((w, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text variant="bodyLarge" style={{ flex: 1 }}>{w.topic} <Text style={{ color: t.app.muted }}>— {w.subject}, {w.section}</Text></Text>
                    <Text variant="titleMedium" style={{ color: w.percent < 40 ? t.colors.primary : w.percent < 60 ? t.app.review : t.app.pass }}>{fmtNum(w.percent)}%</Text>
                  </View>
                ))}
              </Card>
            ) : <Empty title="No published marks in this period yet" />}
          </View>

          {d.heatmap.cells.length ? (
            <View>
              <SectionTitle title="Average marks by topic and class" />
              <Card style={{ padding: 12 }}>
                <ScrollView horizontal>
                  <View accessibilityRole="none">
                    <View style={{ flexDirection: 'row' }}>
                      <View style={{ width: 200 }} />
                      {d.heatmap.sections.map((s) => <Text key={s.id} variant="labelMedium" style={{ width: 92, textAlign: 'center', color: t.app.muted }}>{s.name}</Text>)}
                    </View>
                    {d.heatmap.topics.map((tp) => (
                      <View key={`${tp.subject}|${tp.topic}`} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                        <Text variant="bodySmall" numberOfLines={2} style={{ width: 200, paddingRight: 8 }}>{tp.topic} <Text style={{ color: t.app.muted }}>({tp.subject})</Text></Text>
                        {d.heatmap.sections.map((s) => {
                          const c = d.heatmap.cells.find((x) => x.sectionId === s.id && x.subject === tp.subject && x.topic === tp.topic);
                          return (
                            <View key={s.id} style={{ width: 90, height: 34, marginHorizontal: 1, borderRadius: 4, backgroundColor: c ? cellColor(c.percent) : t.colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={c ? `${tp.topic}, ${s.name}: ${c.percent} percent from ${c.answers} answers` : `${tp.topic}, ${s.name}: no data`}>
                              <Text variant="labelMedium" style={{ color: c && c.percent >= 50 ? '#ffffff' : '#0d1b2e' }}>{c ? `${Math.round(c.percent)}%` : '–'}</Text>
                            </View>
                          );
                        })}
                      </View>
                    ))}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 }}>
                      <Text variant="bodySmall" style={{ color: t.app.muted, marginRight: 6 }}>0%</Text>
                      {RAMP.map((c) => <View key={c} style={{ width: 22, height: 10, borderRadius: 2, backgroundColor: c }} />)}
                      <Text variant="bodySmall" style={{ color: t.app.muted, marginLeft: 6 }}>100%</Text>
                    </View>
                  </View>
                </ScrollView>
              </Card>
            </View>
          ) : null}

          <View>
            <SectionTitle title="Teachers" />
            <Card style={{ padding: 0 }}>
              {d.teachers.map((x, i) => (
                <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.outlineVariant, flexWrap: 'wrap' }}>
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <Text variant="bodyLarge">{x.name}</Text>
                    <Text variant="bodySmall" style={{ color: t.app.muted }}>{x.tests} {x.tests === 1 ? 'test' : 'tests'} · {x.copies} {x.copies === 1 ? 'copy' : 'copies'} · result in {hours(x.turnaroundHours)}{x.changedByTeacher !== null ? ` · changed ${fmtNum(x.changedByTeacher)}% of AI marks` : ''}</Text>
                  </View>
                  {x.waiting ? <Tag tone="review" label={`${x.waiting} waiting`} /> : <Tag tone="pass" label="Up to date" />}
                  {x.problems ? <Tag tone="pen" label={`${x.problems} retakes`} /> : null}
                </View>
              ))}
            </Card>
          </View>

          <View>
            <SectionTitle title="Classes" />
            <Grid max={4} min={2}>
              {d.classes.map((c) => (
                <Stat key={c.sectionId} label={c.name} value={c.average === null ? '–' : `${fmtNum(c.average)}%`} hint={`${c.students} students · ${c.tests} published tests`} />
              ))}
            </Grid>
          </View>
        </>
      ) : null}
    </Screen>
  );
}
