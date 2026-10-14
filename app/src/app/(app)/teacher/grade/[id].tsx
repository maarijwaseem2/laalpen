import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { Button, Chip, IconButton, Text } from 'react-native-paper';
import { toast, toastError } from '@/components/feedback';
import { Card, Empty, ErrorView, Loading, PageHeader, ReviewBadge, Screen, Tag, useAppTheme } from '@/components/ui';
import { API_URL } from '@/lib/config';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import { queryClient } from '@/lib/query';
import type { KeyQuestion, ReviewState, SubmissionStatus } from '@/lib/types';

interface Ans {
  id: string; submissionId: string; submissionStatus: SubmissionStatus; student: { id: string; name: string; rollNo: string };
  studentText: string | null; isBlank: boolean; aiMarks: number | null; finalMarks: number | null; reason: string | null; comment: string | null;
  reviewState: ReviewState; needsReview: boolean; teacherEdited: boolean; region: { y0: number; y1: number } | null; imageUrl: string | null; group: string | null;
}
interface ByQuestion {
  test: { id: string; title: string; status: string; questionCount: number };
  question: KeyQuestion;
  answers: Ans[];
  groups: { text: string; count: number; answerIds: string[] }[];
}

const steps = (max: number) => (max <= 10 ? Array.from({ length: max * 2 + 1 }, (_, i) => i / 2).filter((v) => max <= 5 || Number.isInteger(v)) : [0, max / 4, max / 2, (3 * max) / 4, max].map((v) => Math.round(v * 2) / 2));

/**
 * Grade one question across the whole class: the same rubric in your head, answers side by side,
 * identical answers marked together in one tap. On a computer: number keys give marks, J/K move.
 */
export default function GradeByQuestion() {
  const t = useAppTheme();
  const { id, q: qParam } = useLocalSearchParams<{ id: string; q?: string }>();
  const n = Number(qParam) || 1;
  const q = useQuery({ queryKey: ['teacher', 'byq', id, n], queryFn: () => api.get<ByQuestion>(`/teacher/tests/${id}/questions/${n}`) });
  const comments = useQuery({ queryKey: ['teacher', 'comments'], queryFn: () => api.get<{ id: string; text: string }[]>('/teacher/comments') });
  const [focus, setFocus] = useState(0);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const d = q.data;
  const list = (d?.answers ?? []).filter((a) => !onlyOpen || a.needsReview);
  const max = d?.question.maxMarks ?? 0;

  const setMark = async (a: Ans, finalMarks: number, comment?: string) => {
    if (a.submissionStatus === 'APPROVED') return toast('This copy is approved. Take the approval back first.');
    setBusy(a.id);
    try {
      await api.patch(`/teacher/answers/${a.id}`, { finalMarks, ...(comment !== undefined ? { comment } : {}), overrideReason: finalMarks !== a.aiMarks ? 'Marked by question' : undefined });
      await q.refetch();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const markGroup = async (g: ByQuestion['groups'][number], marks: number) => {
    setBusy(g.text);
    try {
      const r = await api.post<{ updated: number }>(`/teacher/tests/${id}/group-marks`, { answerIds: g.answerIds, finalMarks: marks });
      toast(`${r.updated} answers marked ${fmtNum(marks)}/${fmtNum(max)}`);
      await q.refetch();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  // keyboard: 0-9 marks (shift = .5), j/k next/previous, n next question
  useEffect(() => {
    if (Platform.OS !== 'web' || !d) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const a = list[focus];
      if (/^[0-9]$/.test(e.key) && a) {
        const v = Number(e.key) + (e.shiftKey ? 0.5 : 0);
        if (v <= max) void setMark(a, v).then(() => setFocus((f) => Math.min(f + 1, list.length - 1)));
      } else if (e.key === 'j') setFocus((f) => Math.min(f + 1, list.length - 1));
      else if (e.key === 'k') setFocus((f) => Math.max(f - 1, 0));
      else if (e.key === 'n' && n < d.test.questionCount) router.setParams({ q: String(n + 1) });
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching} maxWidth={1100}>
      <PageHeader back={`/teacher/test/${id}`} title={d ? `Q${n} across the class` : 'Question by question'} subtitle={d ? `${d.test.title} — ${d.answers.length} answers` : undefined} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {d ? (
        <>
          <ScrollView horizontal contentContainerStyle={{ gap: 6 }}>
            {Array.from({ length: d.test.questionCount }, (_, i) => i + 1).map((k) => (
              <Chip key={k} selected={k === n} showSelectedOverlay onPress={() => { setFocus(0); router.setParams({ q: String(k) }); }}>Q{k}</Chip>
            ))}
          </ScrollView>
          <Card style={{ gap: 6 }}>
            <Text variant="titleMedium">Q{n}. {d.question.text} <Text style={{ color: t.app.muted }}>({fmtNum(max)} marks)</Text></Text>
            <Text variant="bodyMedium"><Text style={{ fontWeight: '600' }}>Key: </Text>{d.question.finalAnswer ?? d.question.answerKey}</Text>
            {d.question.rules?.length ? d.question.rules.map((r) => <Text key={r.id} variant="bodySmall" style={{ color: t.app.muted }}>{r.id}: {r.text}</Text>) : null}
            {Platform.OS === 'web' ? <Text variant="bodySmall" style={{ color: t.app.muted }}>Keys: 0–9 give marks (Shift for +½), J/K next/previous, N next question.</Text> : null}
          </Card>
          {d.groups.length ? (
            <Card style={{ gap: 8 }}>
              <Text variant="titleSmall">Same answers — mark them together</Text>
              {d.groups.map((g) => (
                <View key={g.text} style={{ gap: 6 }}>
                  <Text variant="bodyMedium">“{g.text}” — {g.count} students</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {steps(max).map((v) => <Chip key={v} compact onPress={() => markGroup(g, v)} disabled={busy === g.text}>{fmtNum(v)}</Chip>)}
                  </View>
                </View>
              ))}
            </Card>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip selected={onlyOpen} showSelectedOverlay icon="eye-check-outline" onPress={() => { setOnlyOpen((v) => !v); setFocus(0); }}>Only “check” answers</Chip>
          </View>
          {!list.length ? <Empty title="Nothing to look at" body="Every answer here is marked Sure." /> : null}
          {list.map((a, i) => {
            const marks = a.finalMarks ?? 0;
            const locked = a.submissionStatus === 'APPROVED';
            return (
              <Card key={a.id} accent={i === focus ? t.colors.primary : marks >= max ? t.app.pass : marks === 0 ? t.colors.error : t.app.review} onPress={() => setFocus(i)} label={`${a.student.name}, ${marks} of ${max}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Text variant="titleSmall" style={{ flex: 1 }}>{a.student.rollNo}. {a.student.name}</Text>
                  <ReviewBadge state={a.reviewState} />
                  {a.group ? <Tag tone="info" label="Same as others" /> : null}
                  {locked ? <Tag tone="pass" label="Approved" /> : null}
                  <Text style={{ fontFamily: 'Caveat_700Bold', fontSize: 26, color: t.app.pen }}>{fmtNum(marks)}/{fmtNum(max)}</Text>
                  <IconButton icon="file-document-outline" size={18} onPress={() => router.push(`/teacher/submission/${a.submissionId}`)} accessibilityLabel="Open the whole copy" />
                </View>
                {a.imageUrl ? (
                  <View style={{ height: 150, overflow: 'hidden', borderRadius: 8, marginTop: 8, backgroundColor: t.colors.surfaceVariant }}>
                    <Image source={{ uri: `${API_URL}${a.imageUrl}` }} style={{ width: '100%', height: '100%' }} contentFit="cover" contentPosition={{ top: `${Math.round(((a.region?.y0 ?? 0) * 100))}%` }} accessibilityLabel={`${a.student.name}'s answer`} />
                  </View>
                ) : null}
                <Text variant="bodyMedium" style={{ marginTop: 6 }}>{a.isBlank ? '(left blank)' : a.studentText ? `“${a.studentText}”` : ''}</Text>
                {a.reason ? <Text variant="bodySmall" style={{ color: t.app.muted }}>AI: {a.reason}</Text> : null}
                {!locked ? (
                  <>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {steps(max).map((v) => (
                        <Chip key={v} compact selected={a.finalMarks === v} showSelectedOverlay disabled={busy === a.id} onPress={() => setMark(a, v)} accessibilityLabel={`Give ${v} marks`}>{fmtNum(v)}</Chip>
                      ))}
                    </View>
                    <ScrollView horizontal contentContainerStyle={{ gap: 6, marginTop: 6 }}>
                      {(comments.data ?? []).slice(0, 10).map((c) => (
                        <Chip key={c.id} compact icon="comment-outline" onPress={() => setMark(a, marks, c.text)}>{c.text}</Chip>
                      ))}
                    </ScrollView>
                  </>
                ) : null}
              </Card>
            );
          })}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {n > 1 ? <Button icon="chevron-left" onPress={() => router.setParams({ q: String(n - 1) })}>Q{n - 1}</Button> : null}
            {n < d.test.questionCount ? <Button mode="contained" icon="chevron-right" contentStyle={{ flexDirection: 'row-reverse' }} onPress={() => { setFocus(0); router.setParams({ q: String(n + 1) }); }}>Next: Q{n + 1}</Button> : (
              <Button mode="contained" icon="check" onPress={async () => { await queryClient.invalidateQueries({ queryKey: ['teacher', 'test', id] }); router.replace(`/teacher/test/${id}`); }}>Done — back to the test</Button>
            )}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
