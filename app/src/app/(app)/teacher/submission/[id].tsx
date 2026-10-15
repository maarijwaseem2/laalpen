import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Chip, IconButton, Switch, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { TextInput } from '@/components/Input';
import { toast, toastError } from '@/components/feedback';
import { CopyViewer } from '@/components/tiles';
import { CopyExtras } from '@/components/CopyExtras';
import { Card, ErrorView, Loading, PageHeader, PenNote, ReviewBadge, Screen, ScoreRing, SubmissionTag, Tag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import { useLayout } from '@/lib/layout';
import { queryClient } from '@/lib/query';
import type { QuestionType, ReviewState, SubmissionStatus, TestStatus } from '@/lib/types';

interface Answer {
  id: string | null;
  number: number;
  question: string;
  answerKey: string;
  finalAnswer: string | null;
  type: QuestionType;
  maxMarks: number;
  studentText: string | null;
  isBlank: boolean;
  legibility: string | null;
  aiMarks: number | null;
  finalMarks: number | null;
  reason: string | null;
  comment: string | null;
  aiComment: string | null;
  reviewState: ReviewState | null;
  needsReview: boolean;
  teacherEdited: boolean;
  overrideReason: string | null;
  rulesApplied: { id: string; text: string }[];
  method: string | null;
  samples: number[] | null;
}
interface Sub {
  id: string;
  status: SubmissionStatus;
  obtainedMarks: number | null;
  aiSummary: string | null;
  error: string | null;
  model: string | null;
  keyVersion: number | null;
  voiceNoteUrl?: string | null;
  student: { id: string; name: string; rollNo: string };
  test: { id: string; title: string; totalMarks: number; status: TestStatus; subject: string; className: string; sectionName: string };
  problems: { id: string; type: string; pageNo: number | null; details: string }[];
  pages: { pageNo: number; originalUrl: string | null; checkedUrl: string | null; flags: string[] }[];
  answers: Answer[];
  prevId: string | null;
  nextId: string | null;
  nextNeedsReviewId: string | null;
}

const OVERRIDE_REASONS = ['AI misread', 'Alternative method', 'Too strict', 'Too lenient', 'Partly correct'];

export default function ReviewScreen() {
  const t = useAppTheme();
  const { wide } = useLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({
    queryKey: ['teacher', 'submission', id],
    queryFn: () => api.get<Sub>(`/teacher/submissions/${id}`),
    refetchInterval: (query) => (['PENDING', 'PROCESSING'].includes(query.state.data?.status ?? '') ? 2500 : false),
  });
  const [busy, setBusy] = useState<'approve' | 'recheck' | 'anyway' | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const s = q.data;
  const locked = s?.status === 'APPROVED';
  const checking = s && ['PENDING', 'PROCESSING'].includes(s.status);

  const act = async (kind: 'approve' | 'recheck' | 'anyway') => {
    setBusy(kind);
    try {
      await api.post(`/teacher/submissions/${id}/${kind === 'anyway' ? 'check-anyway' : kind}`);
      await queryClient.invalidateQueries();
      if (kind === 'approve') {
        const next = s?.nextNeedsReviewId ?? s?.nextId;
        toast(`${s?.student.name}'s marks approved`, {
          label: 'Undo',
          onPress: async () => {
            await api.post('/teacher/submissions/unapprove', { ids: [id] }).catch(toastError);
            await queryClient.invalidateQueries();
            router.replace(`/teacher/submission/${id}`);
          },
        });
        if (next) router.replace(`/teacher/submission/${next}`);
      } else toast(kind === 'recheck' ? 'Sent for checking again' : 'Sent to the AI as it is');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.error || !s) return <Screen><ErrorView error={q.error} onRetry={() => q.refetch()} /></Screen>;

  const open = s.answers.filter((a) => a.needsReview);
  const shown = onlyOpen && open.length && !locked ? open : s.answers;
  const problem = s.status === 'NEEDS_ATTENTION' || s.status === 'FAILED';
  const panel = (
    <View style={{ gap: 12 }}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <ScoreRing obtained={s.obtainedMarks} total={s.test.totalMarks} size={88} />
          <View style={{ flex: 1, gap: 6 }}>
            <SubmissionTag status={s.status} />
            {open.length ? (
              <Text variant="bodyMedium" style={{ color: t.app.review }}>
                {open.length} {open.length === 1 ? 'answer needs' : 'answers need'} a look. The rest the AI is sure about.
              </Text>
            ) : !locked && !checking && !problem ? (
              <Text variant="bodyMedium" style={{ color: t.app.pass }}>The AI is sure about every answer.</Text>
            ) : null}
            {s.aiSummary ? <Text variant="bodyMedium" style={{ color: t.app.muted }}>{s.aiSummary}</Text> : null}
          </View>
        </View>
        {problem ? (
          <View style={{ marginTop: 12, gap: 6 }}>
            {(s.problems.length ? s.problems : [{ id: 'x', type: 'CHECK_FAILED', pageNo: null, details: s.error ?? 'Checking failed.' }]).map((p) => (
              <Tag key={p.id} label={p.details} tone="pen" icon="alert-circle-outline" />
            ))}
            <Text variant="bodySmall" style={{ color: t.app.muted }}>Retake the photo from the class page, or send it to the AI as it is.</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button mode="contained-tonal" icon="send-outline" onPress={() => act('anyway')} loading={busy === 'anyway'} disabled={!!busy}>Check anyway</Button>
              <Button icon="camera-retake-outline" onPress={() => router.replace(`/teacher/test/${s.test.id}`)}>Retake photos</Button>
            </View>
          </View>
        ) : null}
        {!locked && !checking && !problem ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <Button mode="contained" icon="check" onPress={() => act('approve')} loading={busy === 'approve'} disabled={!!busy} contentStyle={{ height: 44 }}>
              Approve{s.nextNeedsReviewId ? ' — next to check' : s.nextId ? ' and next' : ''}
            </Button>
            <Button mode="outlined" icon="refresh" onPress={() => act('recheck')} loading={busy === 'recheck'} disabled={!!busy}>
              Check again
            </Button>
          </View>
        ) : null}
        {locked ? <Text variant="bodySmall" style={{ color: t.app.muted, marginTop: 10 }}>Approved — marks are locked{s.test.status === 'PUBLISHED' ? ' and visible to the student.' : '. Publish the test to show them to students.'}</Text> : null}
        {checking ? <Text variant="bodyMedium" style={{ color: t.app.info, marginTop: 10 }}>The AI is checking this copy. This page updates by itself.</Text> : null}
      </Card>
      {open.length && !locked ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Switch value={onlyOpen} onValueChange={setOnlyOpen} accessibilityLabel="Only show what needs checking" />
          <Text variant="bodyMedium" style={{ flex: 1 }}>Only show what needs checking ({open.length} of {s.answers.length})</Text>
        </View>
      ) : null}
      {shown.map((a) => <AnswerCard key={a.number} a={a} locked={locked || !!checking || problem} subId={s.id} />)}
      {s.model ? <Text variant="bodySmall" style={{ color: t.app.muted }}>Checked by {s.model} with answer key v{s.keyVersion ?? '–'}. Totals are added up by LaalPen, not the AI.</Text> : null}
    </View>
  );

  return (
    <Screen maxWidth={1320} onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader
        back
        title={`${s.student.name} (roll ${s.student.rollNo})`}
        subtitle={`${s.test.title} — ${s.test.subject}, ${s.test.className} ${s.test.sectionName}`}
        actions={
          <View style={{ flexDirection: 'row' }}>
            <IconButton icon="chevron-left" mode="outlined" disabled={!s.prevId} onPress={() => router.replace(`/teacher/submission/${s.prevId}`)} accessibilityLabel="Previous student" />
            <IconButton icon="chevron-right" mode="outlined" disabled={!s.nextId} onPress={() => router.replace(`/teacher/submission/${s.nextId}`)} accessibilityLabel="Next student" />
          </View>
        }
      />
      <CopyExtras submissionId={s.id} status={s.status} published={s.test.status === 'PUBLISHED'} hasVoice={!!s.voiceNoteUrl} />
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
          <View style={{ flex: 1.15 }}>{s.pages.length ? <CopyViewer pages={s.pages} /> : null}</View>
          <View style={{ flex: 1 }}>{panel}</View>
        </View>
      ) : (
        <>
          {s.pages.length ? <CopyViewer pages={s.pages} /> : null}
          {panel}
        </>
      )}
    </Screen>
  );
}

/** One question: what the student wrote, why marks were cut, one-tap marks, reason chips, undo. */
function AnswerCard({ a, locked, subId }: { a: Answer; locked: boolean; subId: string }) {
  const t = useAppTheme();
  const [marks, setMarks] = useState(a.finalMarks ?? 0);
  const [comment, setComment] = useState(a.comment ?? '');
  const [why, setWhy] = useState<string | null>(a.overrideReason);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setMarks(a.finalMarks ?? 0);
    setComment(a.comment ?? '');
    setWhy(a.overrideReason);
  }, [a.finalMarks, a.comment, a.overrideReason, subId]);
  const dirty = marks !== (a.finalMarks ?? 0) || comment !== (a.comment ?? '') || why !== a.overrideReason;
  const changedFromAi = a.aiMarks !== null && marks !== a.aiMarks;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['teacher'] });
  const save = async () => {
    if (!a.id) return;
    setSaving(true);
    try {
      const r = await api.patch<{ previous: { finalMarks: number | null; comment: string | null; overrideReason: string | null; teacherEdited: boolean } }>(`/teacher/answers/${a.id}`, {
        finalMarks: marks,
        comment,
        ...(why ? { overrideReason: why } : {}),
      });
      await refresh();
      const prev = r.previous;
      toast(`Q${a.number} saved`, {
        label: 'Undo',
        onPress: async () => {
          try {
            await api.patch(`/teacher/answers/${a.id}`, prev.teacherEdited ? { finalMarks: prev.finalMarks ?? 0, comment: prev.comment ?? '', overrideReason: prev.overrideReason ?? '' } : { revert: true });
            await refresh();
          } catch (e) {
            toastError(e);
          }
        },
      });
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  const looksRight = async () => {
    if (!a.id) return;
    setSaving(true);
    try {
      await api.post(`/teacher/answers/${a.id}/confirm`);
      await refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  const revert = async () => {
    if (!a.id) return;
    await api.patch(`/teacher/answers/${a.id}`, { revert: true }).catch(toastError);
    await refresh();
  };
  const step = (d: number) => setMarks((m) => Math.max(0, Math.min(a.maxMarks, Math.round((m + d) * 2) / 2)));
  const chips = a.maxMarks <= 10 ? Array.from({ length: a.maxMarks * 2 + 1 }, (_, k) => k / 2).filter((v) => a.maxMarks <= 5 || Number.isInteger(v)) : null;

  return (
    <Card accent={a.needsReview ? (a.reviewState === 'UNREADABLE' ? t.colors.primary : t.app.review) : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text variant="titleMedium">Q{a.number}. {a.question}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {a.reviewState && !a.teacherEdited ? <ReviewBadge state={a.reviewState} /> : null}
            {a.isBlank ? <Tag label="Left blank" icon="file-outline" /> : null}
            {a.teacherEdited ? <Tag label="Edited by you" tone="info" icon="pencil-outline" /> : null}
            {a.method === 'numeric' ? <Tag label="Final answer re-calculated" tone="info" icon="calculator-variant-outline" /> : null}
            {a.method === 'mcq' ? <Tag label="MCQ checked exactly" tone="info" icon="checkbox-marked-circle-outline" /> : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: 'Caveat_700Bold', fontSize: 30, color: t.app.pen, minWidth: 64, textAlign: 'center' }}>
            {fmtNum(marks)}/{fmtNum(a.maxMarks)}
          </Text>
          {a.teacherEdited && a.aiMarks !== null && a.aiMarks !== a.finalMarks ? (
            <Text variant="bodySmall" style={{ color: t.app.muted, textDecorationLine: 'line-through' }}>AI: {fmtNum(a.aiMarks)}</Text>
          ) : null}
        </View>
      </View>

      {a.studentText ? (
        <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: t.colors.surfaceVariant }}>
          <Text variant="labelMedium" style={{ color: t.app.muted }}>What the student wrote (as the AI read it)</Text>
          <Text variant="bodyMedium" style={{ marginTop: 2 }}>{a.studentText}</Text>
          {a.legibility === 'poor' ? <Text variant="bodySmall" style={{ color: t.app.review, marginTop: 4 }}>Hard to read — compare with the photo.</Text> : null}
        </View>
      ) : null}
      {a.reason ? <Text variant="bodyMedium" style={{ marginTop: 10 }}>{a.reason}</Text> : null}
      {a.rulesApplied.length ? (
        <Text variant="bodySmall" style={{ color: t.app.muted, marginTop: 4 }}>
          Rules used: {a.rulesApplied.map((r) => `${r.id} — ${r.text}`).join('; ')}
        </Text>
      ) : null}
      {a.samples && a.samples.length > 1 ? (
        <Text variant="bodySmall" style={{ color: t.app.muted, marginTop: 4 }}>
          Checked {a.samples.length} times: {a.samples.map(fmtNum).join(', ')} marks{new Set(a.samples).size > 1 ? ' — the AI was not consistent, so please decide.' : '.'}
        </Text>
      ) : null}

      {locked ? (
        a.comment ? <View style={{ marginTop: 8 }}><PenNote>{a.comment}</PenNote></View> : null
      ) : (
        <>
          {chips ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 10 }}>
              {chips.map((v) => (
                <Chip key={v} selected={marks === v} showSelectedCheck={false} mode={marks === v ? 'flat' : 'outlined'} onPress={() => setMarks(v)} style={{ minWidth: 48 }} textStyle={{ textAlign: 'center' }} accessibilityLabel={`${fmtNum(v)} marks`}>
                  {fmtNum(v)}
                </Chip>
              ))}
            </ScrollView>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <IconButton icon="minus" size={18} mode="outlined" onPress={() => step(-0.5)} accessibilityLabel="Half mark less" />
              <IconButton icon="plus" size={18} mode="outlined" onPress={() => step(0.5)} accessibilityLabel="Half mark more" />
            </View>
          )}
          {changedFromAi ? (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <Text variant="labelMedium" style={{ color: t.app.muted, alignSelf: 'center' }}>Why? (helps LaalPen learn)</Text>
              {OVERRIDE_REASONS.map((r) => (
                <Chip key={r} compact selected={why === r} onPress={() => setWhy(why === r ? null : r)}>{r}</Chip>
              ))}
            </View>
          ) : null}
          <TextInput mode="outlined" dense label="Comment on the copy (red pen)" value={comment} onChangeText={setComment} maxLength={120} />
        </>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
        <Button compact icon={showKey ? 'chevron-up' : 'key-outline'} onPress={() => setShowKey((v) => !v)}>
          {showKey ? 'Hide answer key' : 'Answer key'}
        </Button>
        {!locked && a.teacherEdited ? <Button compact icon="undo" onPress={revert}>Back to AI marks</Button> : null}
        <View style={{ flex: 1 }} />
        {!locked && dirty ? (
          <Button mode="contained-tonal" onPress={save} loading={saving} disabled={saving || !a.id}>Save change</Button>
        ) : !locked && a.needsReview ? (
          <Button mode="text" icon="check" onPress={looksRight} loading={saving} disabled={saving || !a.id}>Marks are right</Button>
        ) : null}
      </View>
      {showKey ? (
        <Text variant="bodyMedium" style={{ color: t.app.muted, marginTop: 4 }}>
          {a.type === 'MCQ' ? `Correct option: ${a.finalAnswer}` : a.finalAnswer ? `Final answer: ${a.finalAnswer}. ${a.answerKey}` : a.answerKey}
        </Text>
      ) : null}
    </Card>
  );
}
