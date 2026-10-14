import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, IconButton, ProgressBar, Text } from 'react-native-paper';
import { toast, toastError } from '@/components/feedback';
import { Card, ErrorView, Grid, Loading, PageHeader, Screen, Stat, SubmissionTag, Tag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { pickPages } from '@/lib/pick';
import { queryClient } from '@/lib/query';
import type { SubmissionStatus } from '@/lib/types';
import { newPage, useUploadQueue, type QPage } from '@/lib/uploadQueue';

interface TestInfo {
  id: string; title: string; subject: string; className: string; sectionName: string; expectedPages: number | null; gradingMode?: 'INSTANT' | 'OVERNIGHT';
  roster: { studentId: string; name: string; rollNo: string; submission: { id: string; status: SubmissionStatus } | null }[];
}
interface Progress { id: string; status: 'OPEN' | 'CLOSED' | 'DONE'; uploaded: number; total: number; checking: number; done: number; failed: number; problems: number; ready: number; review: number }

/**
 * Class capture: go down the roll list, photograph each copy, move on. Uploading and checking run
 * in the background; only copies with a problem need you again. One alert when the class is done.
 */
export default function Capture() {
  const t = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const test = useQuery({ queryKey: ['teacher', 'test', id], queryFn: () => api.get<TestInfo>(`/teacher/tests/${id}`) });
  const [batchId, setBatchId] = useState<string | null>(null);
  const progress = useQuery({
    queryKey: ['capture', batchId],
    queryFn: () => api.get<Progress>(`/teacher/batches/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (q) => (q.state.data?.status === 'DONE' ? false : 4000),
  });
  const queue = useUploadQueue();
  const [current, setCurrent] = useState<{ studentId: string; name: string; pages: QPage[] } | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    void queue.load().then(() => queue.run());
    api.post<Progress>(`/teacher/tests/${id}/batches`).then((b) => setBatchId(b.id)).catch(toastError);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = queue.items.filter((i) => i.testId === id);
  const local = useMemo(() => new Map(mine.map((i) => [i.studentId, i])), [mine]);
  const roster = test.data?.roster ?? [];
  const nextStudent = roster.find((r) => !r.submission && !local.has(r.studentId) && r.studentId !== current?.studentId);

  const shoot = async (studentId: string, name: string, source: 'camera' | 'library' = 'camera') => {
    try {
      const picked = await pickPages(source);
      if (!picked.length) return;
      const base = current?.studentId === studentId ? current.pages : [];
      const pages = [...base];
      for (const p of picked) pages.push(await newPage(p.uri, pages.length + 1));
      setCurrent({ studentId, name, pages: pages.slice(0, 12) });
    } catch (e) {
      toastError(e);
    }
  };

  const finishStudent = () => {
    if (!current?.pages.length) return;
    queue.add({ testId: id, batchId, studentId: current.studentId, name: current.name, pages: current.pages });
    const exp = test.data?.expectedPages;
    if (exp && current.pages.length !== exp) toast(`${current.name}: ${current.pages.length} of ${exp} pages — saved anyway`);
    setCurrent(null);
  };

  const close = async () => {
    if (!batchId) return;
    if (mine.some((i) => i.state !== 'done')) return toast('Some pages are still uploading. Keep the app open a moment.');
    setClosing(true);
    try {
      await api.post(`/teacher/batches/${batchId}/close`);
      await queryClient.invalidateQueries({ queryKey: ['teacher'] });
      await progress.refetch();
      toast('Done! You get one alert when the whole class is checked.');
    } catch (e) {
      toastError(e);
    } finally {
      setClosing(false);
    }
  };

  const d = test.data;
  const p = progress.data;
  const waiting = mine.filter((i) => i.state === 'waiting' || i.state === 'uploading').length;
  const errors = mine.filter((i) => i.state === 'error');

  return (
    <Screen onRefresh={() => { void test.refetch(); void progress.refetch(); }} refreshing={test.isRefetching}>
      <PageHeader back={`/teacher/test/${id}`} title={d ? `Capture: ${d.title}` : 'Capture'} subtitle={d ? `${d.className} ${d.sectionName} — ${d.subject}${d.expectedPages ? ` — ${d.expectedPages} pages per copy` : ''}` : undefined} />
      {test.isLoading ? <Loading /> : null}
      {test.error ? <ErrorView error={test.error} onRetry={() => test.refetch()} /> : null}
      {d ? (
        <>
          <Grid max={4} min={2}>
            <Stat label="Uploaded" value={`${p?.uploaded ?? 0}/${roster.length}`} hint={waiting ? `${waiting} still on this phone` : undefined} />
            <Stat label="Checking now" value={p?.checking ?? 0} tone="info" />
            <Stat label="Checked" value={(p?.ready ?? 0) + (p?.review ?? 0)} tone="pass" />
            <Stat label="Need a retake" value={p?.problems ?? 0} tone={p?.problems ? 'pen' : undefined} />
          </Grid>
          {d.gradingMode === 'OVERNIGHT' ? <Tag tone="info" icon="weather-night" label="Overnight test: copies are checked tonight at half price" /> : null}

          {current ? (
            <Card style={{ gap: 12 }} accent={t.colors.primary}>
              <Text variant="titleMedium">{current.name} — {current.pages.length} {current.pages.length === 1 ? 'page' : 'pages'}</Text>
              <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
                {current.pages.map((pg, i) => (
                  <View key={pg.localId}>
                    <Image source={{ uri: pg.uri }} style={{ width: 90, height: 124, borderRadius: 8, backgroundColor: t.colors.surfaceVariant }} contentFit="cover" accessibilityLabel={`Page ${i + 1}`} />
                    <IconButton icon="close" size={16} mode="contained" style={{ position: 'absolute', top: -6, right: -6 }} onPress={() => setCurrent({ ...current, pages: current.pages.filter((x) => x !== pg).map((x, k) => ({ ...x, pageNo: k + 1 })) })} accessibilityLabel={`Remove page ${i + 1}`} />
                  </View>
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Button mode="outlined" icon="camera-plus-outline" onPress={() => shoot(current.studentId, current.name)}>Next page</Button>
                <Button mode="contained" icon="check" onPress={finishStudent}>Done — next student</Button>
                <Button onPress={() => setCurrent(null)}>Cancel</Button>
              </View>
            </Card>
          ) : nextStudent ? (
            <Card style={{ gap: 10 }}>
              <Text variant="bodyMedium" style={{ color: t.app.muted }}>Next on the roll list</Text>
              <Text variant="headlineSmall">{nextStudent.rollNo}. {nextStudent.name}</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Button mode="contained" icon="camera" onPress={() => shoot(nextStudent.studentId, nextStudent.name)} contentStyle={{ height: 48 }}>Photograph copy</Button>
                <Button icon="image-multiple-outline" onPress={() => shoot(nextStudent.studentId, nextStudent.name, 'library')}>From gallery</Button>
              </View>
            </Card>
          ) : null}

          {errors.length ? (
            <Card accent={t.colors.error} style={{ gap: 6 }}>
              <Text variant="titleSmall">Could not upload</Text>
              {errors.map((e) => (
                <View key={e.studentId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="bodyMedium" style={{ flex: 1 }}>{e.name}: {e.error}</Text>
                  <Button compact onPress={() => queue.retry(e.studentId, id)}>Try again</Button>
                </View>
              ))}
            </Card>
          ) : null}

          <Card style={{ padding: 0 }}>
            {roster.map((r, i) => {
              const q = local.get(r.studentId);
              const icon = q?.state === 'uploading' ? 'cloud-upload-outline' : q?.state === 'waiting' ? 'cellphone-arrow-down' : q?.state === 'error' ? 'alert-circle-outline' : null;
              return (
                <View key={r.studentId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.outlineVariant }}>
                  <Text variant="labelLarge" style={{ width: 30, color: t.app.muted }}>{r.rollNo}</Text>
                  <Text variant="bodyLarge" style={{ flex: 1 }}>{r.name}</Text>
                  {icon ? <MaterialCommunityIcons name={icon as any} size={20} color={q?.state === 'error' ? t.colors.error : t.app.muted} accessibilityLabel={q?.state} /> : null}
                  {r.submission ? <SubmissionTag status={r.submission.status} /> : null}
                  <IconButton icon={r.submission || q ? 'camera-retake-outline' : 'camera-outline'} onPress={() => shoot(r.studentId, r.name)} accessibilityLabel={`Photograph ${r.name}'s copy`} />
                </View>
              );
            })}
          </Card>
          {waiting ? <ProgressBar indeterminate /> : null}
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            {p?.status === 'OPEN' ? (
              <Button mode="contained" icon="flag-checkered" onPress={close} loading={closing} disabled={closing || !p.uploaded}>Done with this class</Button>
            ) : p ? (
              <Tag tone={p.status === 'DONE' ? 'pass' : 'info'} label={p.status === 'DONE' ? 'Whole class checked' : `Checking ${p.total} copies…`} />
            ) : null}
            <Button onPress={() => router.push(`/teacher/test/${id}`)}>See results</Button>
          </View>
        </>
      ) : null}
    </Screen>
  );
}
