import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { HelperText, IconButton, SegmentedButtons, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { TextInput } from '@/components/Input';
import { toast } from '@/components/feedback';
import { Card, PageHeader, Screen, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import { errorText, queryClient } from '@/lib/query';

interface Q { text: string; maxMarks: string; answerKey: string }
const blank = (): Q => ({ text: '', maxMarks: '5', answerKey: '' });

export default function NewTest() {
  const t = useAppTheme();
  const { assignmentId } = useLocalSearchParams<{ assignmentId: string }>();
  const a = useQuery({ queryKey: ['teacher', 'assignment', assignmentId], queryFn: () => api.get(`/teacher/assignments/${assignmentId}`) });
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [qs, setQs] = useState<Q[]>([blank(), blank()]);
  const [pages, setPages] = useState('');
  const [language, setLanguage] = useState<'en' | 'ur'>('en');
  const [mode, setMode] = useState<'INSTANT' | 'OVERNIGHT'>('INSTANT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = qs.reduce((n, q) => n + (Number(q.maxMarks) || 0), 0);
  const upd = (i: number, k: keyof Q, v: string) => setQs((all) => all.map((q, j) => (j === i ? { ...q, [k]: v } : q)));

  const save = async () => {
    if (title.trim().length < 2) return setError('Give the test a title');
    const bad = qs.findIndex((q) => !q.text.trim() || !q.answerKey.trim() || !(Number(q.maxMarks) > 0));
    if (bad >= 0) return setError(`Question ${bad + 1}: add the question, its marks and the answer key`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Date must look like 2026-10-10');
    setBusy(true);
    setError(null);
    try {
      const test = await api.post<{ id: string }>(`/teacher/assignments/${assignmentId}/tests`, {
        title: title.trim(),
        description: description.trim() || undefined,
        testDate: new Date(date).toISOString(),
        expectedPages: Number(pages) > 0 ? Number(pages) : undefined,
        language,
        gradingMode: mode,
        questions: qs.map((q, i) => ({ number: i + 1, text: q.text.trim(), maxMarks: Number(q.maxMarks), answerKey: q.answerKey.trim() })),
      });
      await queryClient.invalidateQueries();
      toast('Test created. Now check the answer key.');
      router.replace({ pathname: '/teacher/key/[id]', params: { id: test.id, fresh: '1' } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen maxWidth={860}>
      <PageHeader back title="New test" subtitle={a.data ? `${a.data.subject} — ${a.data.className} ${a.data.sectionName}` : undefined} color={a.data?.color} />
      <Card style={{ gap: 12 }}>
        <TextInput mode="outlined" label="Title *" placeholder="Unit Test 2 — Motion" value={title} onChangeText={setTitle} />
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <TextInput mode="outlined" label="Date" value={date} onChangeText={setDate} style={{ flex: 1, minWidth: 160 }} placeholder="YYYY-MM-DD" />
          <TextInput mode="outlined" label="Chapter or note" value={description} onChangeText={setDescription} style={{ flex: 2, minWidth: 200 }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextInput mode="outlined" label="Pages per copy" value={pages} onChangeText={(v) => setPages(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" style={{ width: 150 }} placeholder="e.g. 2" />
          <View style={{ flex: 1, minWidth: 240, gap: 4 }}>
            <Text variant="labelMedium" style={{ color: t.app.muted }}>Answers are written in</Text>
            <SegmentedButtons value={language} onValueChange={(v) => setLanguage(v as 'en' | 'ur')} buttons={[{ value: 'en', label: 'English' }, { value: 'ur', label: 'اردو Urdu' }]} />
          </View>
        </View>
        <Text variant="bodySmall" style={{ color: t.app.muted }}>Pages per copy lets LaalPen warn you when a page is missing.</Text>
        <View style={{ gap: 4 }}>
          <Text variant="labelMedium" style={{ color: t.app.muted }}>When should copies be checked?</Text>
          <SegmentedButtons
            value={mode}
            onValueChange={(v) => setMode(v as 'INSTANT' | 'OVERNIGHT')}
            buttons={[
              { value: 'INSTANT', label: 'Right away', icon: 'lightning-bolt-outline' },
              { value: 'OVERNIGHT', label: 'Overnight (half cost)', icon: 'weather-night' },
            ]}
          />
          {mode === 'OVERNIGHT' ? <Text variant="bodySmall" style={{ color: t.app.muted }}>Photo checks run at once; the AI checks tonight and results are ready by morning. Any single copy can still be checked now.</Text> : null}
        </View>
      </Card>

      <View style={{ gap: 4 }}>
        <Text variant="titleMedium">Questions and answer key</Text>
        <Text variant="bodyMedium" style={{ color: t.app.muted }}>
          Type each question, its marks and a short key. Next, the AI turns your key into a marking scheme (final answer, step marks, rules) for you to confirm.
        </Text>
      </View>

      {qs.map((q, i) => (
        <Card key={i} style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="titleMedium" style={{ flex: 1 }}>Question {i + 1}</Text>
            <IconButton icon="delete-outline" disabled={qs.length === 1} onPress={() => setQs((all) => all.filter((_, j) => j !== i))} accessibilityLabel={`Remove question ${i + 1}`} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <TextInput mode="outlined" label="Question *" value={q.text} onChangeText={(v) => upd(i, 'text', v)} multiline style={{ flex: 4, minWidth: 220 }} />
            <TextInput mode="outlined" label="Marks *" value={q.maxMarks} onChangeText={(v) => upd(i, 'maxMarks', v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" style={{ flex: 1, minWidth: 90 }} />
          </View>
          <TextInput mode="outlined" label="Answer key *" value={q.answerKey} onChangeText={(v) => upd(i, 'answerKey', v)} multiline numberOfLines={3} />
        </Card>
      ))}
      <Button mode="outlined" icon="plus" onPress={() => setQs((all) => [...all, blank()])} style={{ alignSelf: 'flex-start' }}>
        Add question
      </Button>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Text variant="titleMedium" style={{ flex: 1 }}>
            {qs.length} questions, {fmtNum(total)} marks
          </Text>
          <Button mode="contained" onPress={save} loading={busy} disabled={busy} contentStyle={{ height: 46 }}>
            Create test
          </Button>
        </View>
        {error ? <HelperText type="error" visible>{error}</HelperText> : null}
      </Card>
    </Screen>
  );
}
