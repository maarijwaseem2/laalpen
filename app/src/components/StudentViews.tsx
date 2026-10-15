import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Share, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { toastError } from './feedback';
import { ResultCard, type ResultRow } from './results';
import { CopyViewer, SubjectTile } from './tiles';
import { Card, Empty, ErrorView, Grid, Loading, PageHeader, PenNote, Screen, ScoreRing, SectionTitle, Stat, Tag, useAppTheme } from './ui';
import { API_URL } from '@/lib/config';
import { api } from '@/lib/api';
import { fmtDate, fmtNum, greeting } from '@/lib/format';
import { useLayout } from '@/lib/layout';
import { useT } from '@/lib/i18n';

export interface Dash {
  student: { name: string; rollNo: string; className: string; sectionName: string };
  stats: { results: number; average: number | null; best: number | null; subjects: number };
  subjects: { assignmentId: string; subject: string; color: string | null; teacher: string; results: number; average: number | null }[];
  recentResults: ResultRow[];
  trend: { title: string; subject: string; percent: number }[];
}

/** Where links go: the student's own pages or a parent's view of one child. */
export interface Paths {
  result: (id: string) => string;
  subject: (assignmentId: string) => string;
}

function Trend({ items, who }: { items: Dash['trend']; who: string }) {
  const t = useAppTheme();
  const tr = useT();
  return (
    <Card>
      <Text variant="titleMedium">{who} last {items.length} results</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 130, marginTop: 14 }} accessibilityLabel={items.map((i) => `${i.title} ${i.percent}%`).join(', ')}>
        {items.map((i, k) => (
          <View key={k} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <Text variant="labelSmall" style={{ color: t.app.muted }}>{Math.round(i.percent)}</Text>
            <View style={{ width: '70%', maxWidth: 34, height: Math.max(4, i.percent), borderRadius: 4, backgroundColor: i.percent >= 60 ? t.app.pass : i.percent >= 40 ? t.app.review : t.colors.primary }} />
          </View>
        ))}
      </View>
      <View style={{ height: 1, backgroundColor: t.colors.outlineVariant, marginTop: 4 }} />
      <Text variant="bodySmall" style={{ color: t.app.muted, marginTop: 6 }}>{tr('Percent per test. Green 60% and above, amber 40–59%, red below 40%.')}</Text>
    </Card>
  );
}

/** Stats, trend, recent results and subjects — for the student, or a parent looking at one child. */
export function DashboardBody({ d, paths, parent }: { d: Dash; paths: Paths; parent?: boolean }) {
  const tr = useT();
  return (
    <>
      <Grid max={4} min={2}>
        <Stat label={tr('Average')} value={d.stats.average === null ? '–' : `${fmtNum(d.stats.average)}%`} tone="pen" />
        <Stat label={tr('Best result')} value={d.stats.best === null ? '–' : `${fmtNum(d.stats.best)}%`} tone="pass" />
        <Stat label={tr('Checked tests')} value={d.stats.results} />
        <Stat label={tr('Subjects')} value={d.stats.subjects} />
      </Grid>
      {d.trend.length > 1 ? <Trend items={d.trend} who={parent ? `${d.student.name.split(' ')[0]}’s` : 'Your'} /> : null}
      <View>
        <SectionTitle title={tr('Recent results')} />
        {d.recentResults.length ? (
          <Grid max={3}>{d.recentResults.map((r) => <ResultCard key={r.submissionId} r={r} href={paths.result(r.submissionId)} />)}</Grid>
        ) : (
          <Empty title={tr('No results yet')} body={tr('When the teacher checks and publishes a test, the marks and the checked copy appear here.')} />
        )}
      </View>
      <View>
        <SectionTitle title={tr('Subjects')} />
        <Grid max={3}>
          {d.subjects.map((s) => (
            <SubjectTile key={s.assignmentId} name={s.subject} color={s.color} lines={[`${tr('Teacher')}: ${s.teacher}`, s.average === null ? 'No results yet' : `Average ${fmtNum(s.average)}% in ${s.results} ${s.results === 1 ? 'test' : 'tests'}`]} onPress={() => router.push(paths.subject(s.assignmentId) as any)} />
          ))}
        </Grid>
      </View>
    </>
  );
}

export function StudentDashboard({ endpoint, queryKey, paths, parent }: { endpoint: string; queryKey: unknown[]; paths: Paths; parent?: boolean }) {
  const q = useQuery({ queryKey, queryFn: () => api.get<Dash>(endpoint) });
  const d = q.data;
  const tr = useT();
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader title={d ? `${tr(greeting())}, ${d.student.name.split(' ')[0]}` : tr('Welcome')} subtitle={d ? `${d.student.className} ${d.student.sectionName}, roll ${d.student.rollNo}` : undefined} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {d ? <DashboardBody d={d} paths={paths} parent={parent} /> : null}
    </Screen>
  );
}

export function SubjectScreen({ endpoint, queryKey, paths }: { endpoint: string; queryKey: unknown[]; paths: Paths }) {
  const q = useQuery({ queryKey, queryFn: () => api.get<{ subject: string; color: string | null; teacher: string; average: number | null; results: ResultRow[] }>(endpoint) });
  const d = q.data;
  const tr = useT();
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader back color={d?.color} title={d?.subject ?? 'Subject'} subtitle={d ? `Teacher: ${d.teacher}${d.average !== null ? ` — average ${fmtNum(d.average)}%` : ''}` : undefined} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {d && !d.results.length ? <Empty title={tr('No checked tests yet')} body={tr('Results appear here once the teacher publishes them.')} /> : null}
      <Grid max={3}>{(d?.results ?? []).map((r) => <ResultCard key={r.submissionId} r={r} href={paths.result(r.submissionId)} />)}</Grid>
    </Screen>
  );
}

interface Result {
  id: string; title: string; subject: string; color: string | null; teacher: string; testDate: string;
  student?: { name: string; rollNo: string; className: string; sectionName: string };
  obtained: number; total: number; percent: number; summary: string | null;
  strength?: string | null; practise?: string | null; voiceNoteUrl?: string | null;
  pages: { pageNo: number; url: string; originalUrl: string }[];
  answers: { number: number; question: string; topic?: string | null; maxMarks: number; marks: number; comment: string | null; reason: string | null }[];
}

const abs = (u: string) => (u.startsWith('http') ? u : `${API_URL}${u}`);

function VoiceNote({ url }: { url: string }) {
  const t = useAppTheme();
  const tr = useT();
  const player = useAudioPlayer({ uri: abs(url) });
  const status = useAudioPlayerStatus(player);
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <MaterialCommunityIcons name="account-voice" size={28} color={t.colors.primary} />
        <Text variant="titleSmall" style={{ flex: 1 }}>{tr('A voice note from the teacher')}</Text>
        <Button
          mode="contained-tonal"
          icon={status.playing ? 'pause' : 'play'}
          onPress={() => {
            if (status.playing) player.pause();
            else {
              if (status.didJustFinish || (status.duration && status.currentTime >= status.duration)) void player.seekTo(0);
              player.play();
            }
          }}
        >
          {tr(status.playing ? 'Pause' : 'Listen')}
        </Button>
      </View>
    </Card>
  );
}

/** Share the result as a WhatsApp-friendly message with a link to the red-pen copy (opens without the app). */
async function shareResult(id: string) {
  const { text, url } = await api.post<{ text: string; url: string }>(`/share/results/${id}`);
  if (Platform.OS === 'web') {
    const nav = globalThis.navigator as Navigator & { share?: (d: { text: string; url?: string }) => Promise<void> };
    if (nav?.share) return nav.share({ text }).catch(() => undefined);
    return Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
  }
  return Share.share({ message: text, url });
}

export function ResultScreen({ endpoint, queryKey, parent }: { endpoint: string; queryKey: unknown[]; parent?: boolean }) {
  const t = useAppTheme();
  const { wide } = useLayout();
  const [sharing, setSharing] = useState(false);
  const tr = useT();
  const q = useQuery({ queryKey, queryFn: () => api.get<Result>(endpoint) });
  const r = q.data;
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.error || !r) return <Screen><ErrorView error={q.error} onRetry={() => q.refetch()} /></Screen>;

  const share = async () => {
    setSharing(true);
    try {
      await shareResult(r.id);
    } catch (e) {
      toastError(e);
    } finally {
      setSharing(false);
    }
  };

  const breakdown = (
    <View style={{ gap: 12 }}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <ScoreRing obtained={r.obtained} total={r.total} size={104} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="headlineMedium" style={{ color: r.percent >= 60 ? t.app.pass : r.percent >= 40 ? t.app.review : t.colors.primary }}>{fmtNum(r.percent)}%</Text>
            {r.summary ? <Text variant="bodyMedium" style={{ color: t.app.muted }}>{r.summary}</Text> : null}
          </View>
        </View>
        {r.strength || r.practise ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {r.strength ? <Tag tone="pass" icon="star-outline" label={`Strong: ${r.strength}`} /> : null}
            {r.practise ? <Tag tone="review" icon="dumbbell" label={`Practise: ${r.practise}`} /> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          <Button mode="outlined" icon="share-variant" onPress={share} loading={sharing} disabled={sharing}>
            {tr(parent ? 'Share' : 'Share with family')}
          </Button>
        </View>
      </Card>
      {r.voiceNoteUrl ? <VoiceNote url={r.voiceNoteUrl} /> : null}
      {r.answers.map((a) => {
        const full = a.marks >= a.maxMarks;
        return (
          <Card key={a.number} accent={full ? t.app.pass : a.marks === 0 ? t.colors.primary : t.app.review}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <Text variant="titleMedium" style={{ flex: 1 }}>Q{a.number}. {a.question}</Text>
              <Text style={{ fontFamily: 'Caveat_700Bold', fontSize: 28, color: t.app.pen }}>{full ? '✓ ' : ''}{fmtNum(a.marks)}/{fmtNum(a.maxMarks)}</Text>
            </View>
            {a.comment ? <View style={{ marginTop: 6 }}><PenNote>{a.comment}</PenNote></View> : null}
            {!full && a.reason && a.reason !== a.comment ? <Text variant="bodyMedium" style={{ color: t.app.muted, marginTop: 4 }}>{a.reason}</Text> : null}
          </Card>
        );
      })}
    </View>
  );
  const pages = r.pages.map((p) => ({ pageNo: p.pageNo, checkedUrl: p.url, originalUrl: p.originalUrl }));
  const who = parent && r.student ? `${r.student.name} — ` : '';

  return (
    <Screen maxWidth={1320}>
      <PageHeader back color={r.color} title={r.title} subtitle={`${who}${r.subject} — ${r.teacher} — ${fmtDate(r.testDate)}`} />
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
          <View style={{ flex: 1.15 }}><CopyViewer pages={pages} /></View>
          <View style={{ flex: 1 }}>{breakdown}</View>
        </View>
      ) : (
        <>
          {breakdown}
          <Text variant="titleMedium">{tr('Checked copy')}</Text>
          <CopyViewer pages={pages} />
        </>
      )}
    </Screen>
  );
}

export const STUDENT_PATHS: Paths = { result: (id) => `/student/result/${id}`, subject: (a) => `/student/subject/${a}` };
export const parentPaths = (childId: string): Paths => ({ result: (id) => `/parent/result/${id}`, subject: (a) => `/parent/subject/${a}?child=${childId}` });
