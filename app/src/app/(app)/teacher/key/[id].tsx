import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Checkbox, Chip, HelperText, IconButton, SegmentedButtons, Text } from 'react-native-paper';
import { TextInput } from '@/components/Input';
import { toast, toastError } from '@/components/feedback';
import { Card, ErrorView, Loading, PageHeader, Screen, Tag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import { pagesForm, pickPages, type PickedPage } from '@/lib/pick';
import { errorText, queryClient } from '@/lib/query';
import type { KeyQuestion, KeyStatus, QuestionType } from '@/lib/types';

interface KeyData {
  testId: string;
  keyStatus: KeyStatus;
  keyVersion: number;
  questions: KeyQuestion[];
  versions: { version: number; createdAt: string }[];
}

const QUICK_RULES = ['Any correct method gets full marks', '-0.5 if the unit is missing', 'Spelling is not marked', 'Correct method, wrong arithmetic: half marks'];
const OPTIONS = ['A', 'B', 'C', 'D'];

/**
 * "Check answer key": the AI turns the teacher's key into a structured marking scheme
 * (final answer, step marks, numbered rules). The teacher fixes anything and confirms once;
 * every copy is then marked against that exact version. Research: a confirmed text key is the
 * biggest single accuracy gain.
 */
export default function AnswerKeyScreen() {
  const t = useAppTheme();
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const q = useQuery({ queryKey: ['teacher', 'key', id], queryFn: () => api.get<KeyData>(`/teacher/tests/${id}/answer-key`) });
  const [qs, setQs] = useState<KeyQuestion[] | null>(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PickedPage[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recheck, setRecheck] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const auto = useRef(false);

  const draft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const form = photos.length ? await pagesForm(photos) : new FormData();
      form.append('text', text);
      const r = await api.upload<{ questions: KeyQuestion[]; notes: string[] }>(`/teacher/tests/${id}/answer-key/draft`, form);
      if (r.questions.length) setQs(r.questions);
      setNotes(r.notes ?? []);
      toast('The AI prepared the marking scheme. Check it and confirm.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setDrafting(false);
    }
  };

  useEffect(() => {
    if (!q.data || qs) return;
    setQs(q.data.questions);
    // a brand-new test: let the AI structure the key straight away
    if (!auto.current && q.data.keyStatus === 'DRAFT' && (fresh === '1' || q.data.questions.every((x) => !x.rules.length))) {
      auto.current = true;
      void draft();
    }
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading || !qs) return <Screen><Loading label="Loading the answer key…" /></Screen>;
  if (q.error || !q.data) return <Screen><ErrorView error={q.error} onRetry={() => q.refetch()} /></Screen>;

  const upd = (i: number, patch: Partial<KeyQuestion>) => setQs((all) => all!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const total = qs.reduce((n, x) => n + (Number(x.maxMarks) || 0), 0);
  const checked = q.data.keyStatus === 'CONFIRMED';

  const confirm = async () => {
    for (const x of qs) {
      if (x.type === 'MCQ' && !x.finalAnswer) return setError(`Q${x.number}: choose the correct option`);
      const steps = x.steps.reduce((n, s) => n + (Number(s.marks) || 0), 0);
      if (steps > x.maxMarks) return setError(`Q${x.number}: step marks (${fmtNum(steps)}) are more than ${fmtNum(x.maxMarks)}`);
    }
    setSaving(true);
    setError(null);
    try {
      const r = await api.put<KeyData & { rechecking: number }>(`/teacher/tests/${id}/answer-key`, {
        recheck,
        questions: qs.map((x) => ({
          number: x.number,
          text: x.text,
          maxMarks: Number(x.maxMarks),
          answerKey: x.answerKey ?? '',
          type: x.type,
          finalAnswer: x.finalAnswer || null,
          alternatives: x.alternatives.filter(Boolean),
          steps: x.steps.filter((s) => s.description.trim()).map((s) => ({ marks: Number(s.marks) || 0, description: s.description.trim() })),
          rules: x.rules.filter((r) => r.text.trim()).map((r, k) => ({ id: `R${k + 1}`, text: r.text.trim() })),
          options: x.type === 'MCQ' ? (x.options.length ? x.options : OPTIONS) : [],
          topic: x.topic || null,
        })),
      });
      await queryClient.invalidateQueries();
      toast(r.rechecking ? `Answer key v${r.keyVersion} saved — ${r.rechecking} copies are being re-checked` : `Answer key confirmed (version ${r.keyVersion}). Now add the copies.`);
      router.replace(`/teacher/test/${id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen maxWidth={900}>
      <PageHeader
        back={`/teacher/test/${id}`}
        title="Check the answer key"
        subtitle="The AI marks every copy against this. Fix anything that is wrong, then confirm once."
        actions={<Tag label={checked ? `Confirmed · v${q.data.keyVersion}` : 'Not confirmed yet'} tone={checked ? 'pass' : 'review'} icon={checked ? 'check-decagram-outline' : 'alert-outline'} />}
      />

      <Card style={{ gap: 10 }}>
        <Text variant="titleMedium">Let the AI prepare the scheme</Text>
        <Text variant="bodyMedium" style={{ color: t.app.muted }}>
          It reads your questions and key (and a photo of your key, if you add one) and fills in final answers, step marks and numbered rules.
        </Text>
        <TextInput mode="outlined" label="Paste or type your key (optional)" value={text} onChangeText={setText} multiline numberOfLines={3} placeholder={'Q1 (5) Define speed\nAns: distance per unit time, unit m/s'} />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button icon="camera-outline" onPress={async () => { try { setPhotos([...photos, ...(await pickPages('camera'))].slice(0, 6)); } catch (e) { toastError(e); } }}>Photo of key</Button>
          <Button icon="image-multiple-outline" onPress={async () => { try { setPhotos([...photos, ...(await pickPages('library'))].slice(0, 6)); } catch (e) { toastError(e); } }}>From gallery</Button>
          {photos.length ? <Chip onClose={() => setPhotos([])}>{photos.length} photo{photos.length > 1 ? 's' : ''}</Chip> : null}
          <View style={{ flex: 1 }} />
          <Button mode="contained-tonal" icon="auto-fix" onPress={draft} loading={drafting} disabled={drafting}>
            {drafting ? 'Preparing…' : 'Prepare with AI'}
          </Button>
        </View>
        {notes.map((n) => <HelperText key={n} type="info" visible>{n}</HelperText>)}
      </Card>

      {qs.map((x, i) => (
        <Card key={x.number} style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text variant="titleMedium" style={{ flex: 1, minWidth: 200 }}>Q{x.number}. {x.text}</Text>
            <TextInput mode="outlined" dense label="Marks" value={String(x.maxMarks)} onChangeText={(v) => upd(i, { maxMarks: Number(v.replace(/[^\d.]/g, '')) || 0 })} keyboardType="decimal-pad" style={{ width: 90 }} />
          </View>
          <SegmentedButtons
            value={x.type}
            onValueChange={(v) => upd(i, { type: v as QuestionType, ...(v === 'MCQ' && !x.options.length ? { options: OPTIONS } : {}) })}
            buttons={[
              { value: 'THEORY', label: 'Written', icon: 'text' },
              { value: 'NUMERIC', label: 'Numerical', icon: 'calculator-variant-outline' },
              { value: 'MCQ', label: 'MCQ', icon: 'checkbox-marked-circle-outline' },
            ]}
          />
          {x.type === 'MCQ' ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Text variant="bodyMedium">Correct option:</Text>
              {(x.options.length ? x.options : OPTIONS).map((o) => (
                <Chip key={o} selected={x.finalAnswer === o} onPress={() => upd(i, { finalAnswer: o })} showSelectedCheck mode={x.finalAnswer === o ? 'flat' : 'outlined'}>{o}</Chip>
              ))}
            </View>
          ) : null}
          {x.type === 'NUMERIC' ? (
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <TextInput mode="outlined" dense label="Final answer" value={x.finalAnswer ?? ''} onChangeText={(v) => upd(i, { finalAnswer: v })} style={{ flex: 1, minWidth: 160 }} placeholder="12.5 m/s" />
              <TextInput mode="outlined" dense label="Also accept (comma separated)" value={x.alternatives.join(', ')} onChangeText={(v) => upd(i, { alternatives: v.split(',').map((s) => s.trim()) })} style={{ flex: 2, minWidth: 200 }} />
            </View>
          ) : null}
          <TextInput mode="outlined" dense label="Model answer" value={x.answerKey} onChangeText={(v) => upd(i, { answerKey: v })} multiline />
          {x.type === 'THEORY' ? (
            <TextInput mode="outlined" dense label="Other acceptable answers (comma separated)" value={x.alternatives.join(', ')} onChangeText={(v) => upd(i, { alternatives: v.split(',').map((s) => s.trim()) })} />
          ) : null}

          <Text variant="labelLarge" style={{ marginTop: 4 }}>Step marks {x.steps.length ? `(${fmtNum(x.steps.reduce((n, s) => n + (Number(s.marks) || 0), 0))} of ${fmtNum(x.maxMarks)})` : ''}</Text>
          {x.steps.map((s, k) => (
            <View key={k} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput mode="outlined" dense label="Marks" value={String(s.marks)} onChangeText={(v) => upd(i, { steps: x.steps.map((y, j) => (j === k ? { ...y, marks: Number(v.replace(/[^\d.]/g, '')) || 0 } : y)) })} keyboardType="decimal-pad" style={{ width: 80 }} />
              <TextInput mode="outlined" dense label="For" value={s.description} onChangeText={(v) => upd(i, { steps: x.steps.map((y, j) => (j === k ? { ...y, description: v } : y)) })} style={{ flex: 1 }} />
              <IconButton icon="close" onPress={() => upd(i, { steps: x.steps.filter((_, j) => j !== k) })} accessibilityLabel="Remove step" />
            </View>
          ))}
          <Button compact icon="plus" onPress={() => upd(i, { steps: [...x.steps, { marks: 1, description: '' }] })} style={{ alignSelf: 'flex-start' }}>Add step</Button>

          <Text variant="labelLarge">Rules the AI must follow</Text>
          {x.rules.map((r, k) => (
            <View key={k} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text variant="labelLarge" style={{ width: 30, color: t.colors.primary }}>R{k + 1}</Text>
              <TextInput mode="outlined" dense label="Rule" value={r.text} onChangeText={(v) => upd(i, { rules: x.rules.map((y, j) => (j === k ? { ...y, text: v } : y)) })} style={{ flex: 1 }} />
              <IconButton icon="close" onPress={() => upd(i, { rules: x.rules.filter((_, j) => j !== k) })} accessibilityLabel="Remove rule" />
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {QUICK_RULES.filter((r) => !x.rules.some((y) => y.text === r)).map((r) => (
              <Chip key={r} compact icon="plus" onPress={() => upd(i, { rules: [...x.rules, { id: '', text: r }] })}>{r}</Chip>
            ))}
            <Chip compact icon="pencil-plus-outline" onPress={() => upd(i, { rules: [...x.rules, { id: '', text: '' }] })}>Own rule</Chip>
          </View>
          <TextInput mode="outlined" dense label="Topic (for weak-topic reports)" value={x.topic ?? ''} onChangeText={(v) => upd(i, { topic: v })} placeholder="Kinematics: speed" />
        </Card>
      ))}

      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Text variant="titleMedium" style={{ flex: 1 }}>{qs.length} questions · {fmtNum(total)} marks</Text>
          <Button mode="contained" icon="check-decagram" onPress={confirm} loading={saving} disabled={saving || drafting} contentStyle={{ height: 46 }}>
            {checked ? 'Save as new version' : 'Confirm answer key'}
          </Button>
        </View>
        {checked ? (
          <Checkbox.Item label="Re-check copies that were already checked with the old key" status={recheck ? 'checked' : 'unchecked'} onPress={() => setRecheck((v) => !v)} position="leading" style={{ paddingHorizontal: 0 }} />
        ) : null}
        {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      </Card>
    </Screen>
  );
}
