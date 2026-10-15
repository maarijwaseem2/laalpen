import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { Dialog, IconButton, List, Menu, Portal, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { Confirm, toast, toastError, useDialog } from '@/components/feedback';
import { Card, ErrorView, Grid, Loading, PageHeader, Screen, ScoreRing, Stat, StatusSegments, SubmissionTag, Tag, TestTag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { StackTools } from '@/components/StackTools';
import { fmtDate, fmtNum } from '@/lib/format';
import { pagesForm, pickPages, type PickedPage } from '@/lib/pick';
import { queryClient, useAction } from '@/lib/query';
import type { Counts, KeyQuestion, KeyStatus, SubmissionStatus, TestStatus } from '@/lib/types';

interface TestDetail {
  id: string;
  title: string;
  description: string | null;
  status: TestStatus;
  testDate: string;
  totalMarks: number;
  subject: string;
  color: string | null;
  className: string;
  sectionName: string;
  assignmentId: string;
  keyStatus: KeyStatus;
  keyVersion: number;
  expectedPages: number | null;
  questions: KeyQuestion[];
  counts: Counts;
  problems: number;
  roster: {
    studentId: string;
    name: string;
    rollNo: string;
    submission: { id: string; status: SubmissionStatus; obtainedMarks: number | null; pages: number; error: string | null; problems: { type: string; details: string }[] } | null;
  }[];
}

const FILTER: Record<string, SubmissionStatus[]> = {
  attention: ['NEEDS_ATTENTION', 'FAILED'],
  pending: ['PENDING', 'PROCESSING'],
  review: ['NEEDS_REVIEW'],
  checked: ['CHECKED'],
  approved: ['APPROVED'],
};

export default function TestScreen() {
  const t = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({
    queryKey: ['teacher', 'test', id],
    queryFn: () => api.get<TestDetail>(`/teacher/tests/${id}`),
    refetchInterval: (query) => ((query.state.data?.counts.pending ?? 0) > 0 ? 2500 : false),
  });
  const [upload, setUpload] = useState<{ studentId: string; name: string; pages: PickedPage[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const del = useDialog();
  const publish = useAction(() => api.post<{ published: number }>(`/teacher/tests/${id}/publish`));
  const approveAll = useAction(() => api.post<{ approved: number }>(`/teacher/tests/${id}/approve-checked`));
  const remove = useAction(() => api.del(`/teacher/tests/${id}`));
  const d = q.data;

  const choose = async (studentId: string, name: string, source: 'camera' | 'library', append = false) => {
    try {
      const pages = await pickPages(source);
      if (!pages.length) return;
      setUpload((u) => ({ studentId, name, pages: append && u ? [...u.pages, ...pages].slice(0, 12) : pages }));
    } catch (e) {
      toastError(e);
    }
  };

  const send = async () => {
    if (!upload) return;
    setSending(true);
    try {
      await api.upload(`/teacher/tests/${id}/students/${upload.studentId}/copy`, await pagesForm(upload.pages));
      toast(`${upload.name}'s copy sent for checking`);
      setUpload(null);
      await queryClient.invalidateQueries();
    } catch (e) {
      toastError(e);
    } finally {
      setSending(false);
    }
  };

  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.error || !d) return <Screen><ErrorView error={q.error} onRetry={() => q.refetch()} /></Screen>;

  const toApprove = d.counts.checked;
  const canPublish = d.counts.approved > 0;
  const keyReady = d.keyStatus === 'CONFIRMED';
  const roster = filter ? d.roster.filter((r) => r.submission && FILTER[filter]?.includes(r.submission.status)) : d.roster;
  const approveSure = () =>
    approveAll.mutate(undefined, {
      onSuccess: (r: any) =>
        toast(`${r.approved} sure ${r.approved === 1 ? 'copy' : 'copies'} approved`, {
          label: 'Undo',
          onPress: async () => {
            try {
              await api.post('/teacher/submissions/unapprove', { ids: r.ids });
              await queryClient.invalidateQueries();
              toast('Approval undone');
            } catch (e) {
              toastError(e);
            }
          },
        }),
      onError: toastError,
    });
  const checkAnyway = async (submissionId: string) => {
    try {
      await api.post(`/teacher/submissions/${submissionId}/check-anyway`);
      await queryClient.invalidateQueries();
      toast('Sent to the AI as it is');
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader
        back
        color={d.color}
        title={d.title}
        subtitle={`${d.subject}, ${d.className} ${d.sectionName} — ${fmtDate(d.testDate)} — ${fmtNum(d.totalMarks)} marks`}
        actions={
          <>
            <TestTag status={d.status} />
            {toApprove ? (
              <Button mode="outlined" icon="check-all" loading={approveAll.isPending} onPress={approveSure}>
                Approve {toApprove} sure {toApprove === 1 ? 'copy' : 'copies'}
              </Button>
            ) : null}
            {canPublish ? (
              <Button mode="contained" icon="send-check" loading={publish.isPending} onPress={() => publish.mutate(undefined, { onSuccess: (r) => toast(`Results published to ${r.published} students`), onError: toastError })}>
                {d.status === 'PUBLISHED' ? 'Publish new approvals' : 'Publish results'}
              </Button>
            ) : null}
            {d.status !== 'PUBLISHED' ? <IconButton icon="delete-outline" onPress={() => del.open()} accessibilityLabel="Delete test" /> : null}
          </>
        }
      />

      {!keyReady ? (
        <Card accent={t.app.review} style={{ gap: 8 }}>
          <Text variant="titleMedium">First, confirm the answer key</Text>
          <Text variant="bodyMedium" style={{ color: t.app.muted }}>
            The AI turns your key into a marking scheme (final answers, step marks, rules). Check it once — then upload the copies.
          </Text>
          <Button mode="contained" icon="key-outline" onPress={() => router.push(`/teacher/key/${d.id}`)} style={{ alignSelf: 'flex-start' }}>
            Check answer key
          </Button>
        </Card>
      ) : null}

      {keyReady ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button mode="contained" icon="camera-burst" onPress={() => router.push(`/teacher/capture/${d.id}`)} contentStyle={{ height: 44 }}>Capture the whole class</Button>
          <StackTools testId={d.id} allMcq={d.questions.every((x) => x.type === 'MCQ')} pages={d.expectedPages} />
          {d.counts.checked + d.counts.review + d.counts.approved ? (
            <Button mode="outlined" icon="format-list-numbered" onPress={() => router.push({ pathname: '/teacher/grade/[id]', params: { id: d.id, q: '1' } })} contentStyle={{ height: 44 }}>Check question by question</Button>
          ) : null}
        </View>
      ) : null}

      <Card style={{ gap: 12 }}>
        <StatusSegments total={d.roster.length} counts={d.counts} active={filter} onPick={setFilter} />
        {d.counts.pending ? <Text variant="bodySmall" style={{ color: t.app.info }}>Checking in the background — you can leave this page. You will get one notification when the class is done.</Text> : null}
      </Card>

      {d.counts.attention ? (
        <Card accent={t.colors.primary} style={{ gap: 6 }}>
          <Text variant="titleMedium">{d.counts.attention} {d.counts.attention === 1 ? 'copy needs' : 'copies need'} your attention</Text>
          <Text variant="bodyMedium" style={{ color: t.app.muted }}>
            Blurry, cut-off, duplicate or missing pages are stopped before the AI, so they cost nothing and never get wrong marks. Retake the photo, or check it anyway.
          </Text>
          <Button compact icon="filter-variant" onPress={() => setFilter('attention')} style={{ alignSelf: 'flex-start' }}>Show only these</Button>
        </Card>
      ) : null}

      <Card style={{ padding: 0 }}>
        <List.Accordion
          title={`Answer key${keyReady ? ` · version ${d.keyVersion}` : ''} (${d.questions.length} questions)`}
          left={(p) => <List.Icon {...p} icon="key-outline" />}
          style={{ backgroundColor: 'transparent' }}
        >
          {d.questions.map((qq) => (
            <View key={qq.id} style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.colors.outlineVariant, gap: 4 }}>
              <Text variant="titleSmall">Q{qq.number}. {qq.text} ({fmtNum(qq.maxMarks)})</Text>
              <Text variant="bodyMedium" style={{ color: t.app.muted }}>
                {qq.type === 'MCQ' ? `Correct option: ${qq.finalAnswer}` : qq.finalAnswer ? `Final answer: ${qq.finalAnswer}` : `Key: ${qq.answerKey}`}
              </Text>
              {qq.rules.length ? <Text variant="bodySmall" style={{ color: t.app.muted }}>{qq.rules.map((r) => `${r.id}: ${r.text}`).join(' · ')}</Text> : null}
            </View>
          ))}
          {d.status !== 'PUBLISHED' ? (
            <Button icon="pencil-outline" onPress={() => router.push(`/teacher/key/${d.id}`)} style={{ alignSelf: 'flex-start', margin: 8 }}>
              Edit answer key
            </Button>
          ) : null}
        </List.Accordion>
      </Card>

      <View style={{ gap: 4 }}>
        <Text variant="titleMedium">Students</Text>
        <Text variant="bodyMedium" style={{ color: t.app.muted }}>
          Photograph each student's pages in order. The AI checks them in the background; you approve the final marks.
        </Text>
      </View>
      {filter ? (
        <Button compact icon="close" onPress={() => setFilter(null)} style={{ alignSelf: 'flex-start' }}>
          Showing {roster.length} — show all students
        </Button>
      ) : null}
      <Grid max={3}>
        {roster.map((r) => (
          <Card key={r.studentId} onPress={r.submission ? () => router.push(`/teacher/submission/${r.submission!.id}`) : undefined} label={`${r.name}, roll ${r.rollNo}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text variant="titleMedium" numberOfLines={1}>{r.name}</Text>
                <Text variant="bodySmall" style={{ color: t.app.muted }}>Roll {r.rollNo}{r.submission ? ` — ${r.submission.pages} ${r.submission.pages === 1 ? 'page' : 'pages'}` : ''}</Text>
                {r.submission ? <SubmissionTag status={r.submission.status} /> : null}
              </View>
              {r.submission && r.submission.obtainedMarks !== null && ['CHECKED', 'NEEDS_REVIEW', 'APPROVED'].includes(r.submission.status) ? (
                <ScoreRing obtained={r.submission.obtainedMarks} total={d.totalMarks} size={62} />
              ) : null}
            </View>
            {r.submission && ['FAILED', 'NEEDS_ATTENTION'].includes(r.submission.status) ? (
              <View style={{ marginTop: 8, gap: 4 }}>
                {(r.submission.problems.length ? r.submission.problems : [{ type: 'CHECK_FAILED', details: r.submission.error ?? 'Checking failed.' }]).map((p, k) => (
                  <Tag key={k} label={p.details} tone="pen" icon="alert-circle-outline" />
                ))}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  <UploadButtons compact label="Retake photos" onPick={(src) => choose(r.studentId, r.name, src)} />
                  <Button compact icon="send-outline" onPress={() => checkAnyway(r.submission!.id)}>Check anyway</Button>
                </View>
              </View>
            ) : null}
            {keyReady && (!r.submission || ['NEEDS_REVIEW', 'CHECKED'].includes(r.submission.status)) ? (
              <UploadButtons
                compact={!!r.submission}
                label={r.submission ? 'Replace pages' : undefined}
                onPick={(src) => choose(r.studentId, r.name, src)}
              />
            ) : null}
          </Card>
        ))}
      </Grid>

      <Portal>
        <Dialog visible={!!upload} onDismiss={() => !sending && setUpload(null)} style={{ maxWidth: 640, alignSelf: 'center', width: '94%' }}>
          <Dialog.Title>{upload?.name}'s copy</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ color: t.app.muted, marginBottom: 10 }}>
              {upload?.pages.length} {upload?.pages.length === 1 ? 'page' : 'pages'} in this order. Make sure every page is sharp and the whole page is visible.
            </Text>
            <ScrollView horizontal contentContainerStyle={{ gap: 10 }}>
              {upload?.pages.map((p, i) => (
                <View key={p.uri + i} style={{ alignItems: 'center', gap: 4 }}>
                  <Image source={{ uri: p.uri }} style={{ width: 110, height: 150, borderRadius: 8, backgroundColor: t.colors.surfaceVariant }} contentFit="cover" />
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text variant="labelMedium">Page {i + 1}</Text>
                    <IconButton icon="close" size={16} onPress={() => setUpload((u) => (u ? { ...u, pages: u.pages.filter((_, j) => j !== i) } : u))} accessibilityLabel={`Remove page ${i + 1}`} />
                  </View>
                </View>
              ))}
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions style={{ flexWrap: 'wrap' }}>
            <UploadButtons compact label="Add more pages" onPick={(src) => upload && choose(upload.studentId, upload.name, src, true)} />
            <View style={{ flex: 1 }} />
            <Button onPress={() => setUpload(null)} disabled={sending}>Cancel</Button>
            <Button mode="contained" onPress={send} loading={sending} disabled={sending || !upload?.pages.length}>
              Send for checking
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Confirm
        visible={del.visible}
        title="Delete this test?"
        body="The test, its uploaded copies and marks will be removed. This cannot be undone."
        confirmLabel="Delete test"
        destructive
        busy={remove.isPending}
        onCancel={del.close}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => { del.close(); toast('Test deleted'); router.back(); }, onError: toastError })}
      />
    </Screen>
  );
}

function UploadButtons({ onPick, label, compact }: { onPick: (src: 'camera' | 'library') => void; label?: string; compact?: boolean }) {
  const [menu, setMenu] = useState(false);
  if (Platform.OS === 'web') {
    return (
      <Button mode={compact ? 'text' : 'outlined'} icon="image-plus" onPress={() => onPick('library')} style={{ marginTop: compact ? 0 : 12, alignSelf: 'flex-start' }}>
        {label ?? 'Upload pages'}
      </Button>
    );
  }
  return (
    <Menu
      visible={menu}
      onDismiss={() => setMenu(false)}
      anchor={
        <Button mode={compact ? 'text' : 'outlined'} icon="camera-plus-outline" onPress={() => setMenu(true)} style={{ marginTop: compact ? 0 : 12, alignSelf: 'flex-start' }}>
          {label ?? 'Add copy'}
        </Button>
      }
    >
      <Menu.Item leadingIcon="camera-outline" title="Take photos" onPress={() => { setMenu(false); onPick('camera'); }} />
      <Menu.Item leadingIcon="image-multiple-outline" title="Choose from gallery" onPress={() => { setMenu(false); onPick('library'); }} />
    </Menu>
  );
}
