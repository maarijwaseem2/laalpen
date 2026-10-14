import { useQuery } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button, Checkbox, Text } from 'react-native-paper';
import { toast, toastError } from '@/components/feedback';
import { Card, Grid, PageHeader, Screen, SectionTitle, Stat, Tag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { openFile } from '@/lib/files';
import { fmtDate } from '@/lib/format';
import { queryClient } from '@/lib/query';

interface Row { line: number; values: Record<string, string>; action: 'new' | 'update' | 'unchanged' | 'error'; errors: string[]; warnings: string[]; changes?: string[] }
interface DryRun {
  id: string;
  summary: { total: number; new: number; updated: number; unchanged: number; errors: number; warnings: number; createClasses: string[]; columns: string[] };
  preview: Row[];
  problems: Row[];
}
interface Job { id: string; fileName: string; status: string; createdAt: string; summary: { result?: { created: number; updated: number } } }

const ACTION: Record<Row['action'], { label: string; tone: 'pass' | 'info' | 'muted' | 'pen' }> = {
  new: { label: 'New', tone: 'pass' },
  update: { label: 'Update', tone: 'info' },
  unchanged: { label: 'Same', tone: 'muted' },
  error: { label: 'Problem', tone: 'pen' },
};

/**
 * Bring the school register in from Excel or CSV. Step 1 only checks the file (nothing is saved);
 * step 2 saves it. Importing the same file again updates students instead of adding them twice.
 */
export default function ImportStudents() {
  const t = useAppTheme();
  const [createMissing, setCreateMissing] = useState(true);
  const [dry, setDry] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState<'check' | 'save' | 'template' | null>(null);
  const jobs = useQuery({ queryKey: ['admin', 'imports'], queryFn: () => api.get<Job[]>('/admin/imports') });

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', '*/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    const form = new FormData();
    const type = a.mimeType || (a.name.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (Platform.OS === 'web') form.append('file', (a as any).file ?? (await (await fetch(a.uri)).blob()), a.name);
    else form.append('file', { uri: a.uri, name: a.name, type } as any);
    setBusy('check');
    try {
      setDry(await api.upload<DryRun>(`/admin/import/students?createMissing=${createMissing}`, form));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!dry) return;
    setBusy('save');
    try {
      const r = await api.post<{ created: number; updated: number; failed: { line: number; error: string }[]; classesCreated: number }>(`/admin/import/${dry.id}/commit`);
      await queryClient.invalidateQueries();
      toast(`${r.created} added, ${r.updated} updated${r.failed.length ? `, ${r.failed.length} could not be saved` : ''}`);
      setDry(null);
      router.push('/admin/students');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const template = async () => {
    setBusy('template');
    try {
      await openFile((await api.get<{ url: string }>('/admin/import/template')).url);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const s = dry?.summary;
  return (
    <Screen>
      <PageHeader back="/admin/students" title="Import students" subtitle="Excel (.xlsx) or CSV. Column names in English or Urdu are understood — GR No, Name, Father Name, Class, Section, Roll No, DOB, Mobile." />
      {!dry ? (
        <Card style={{ gap: 12 }}>
          <Text variant="titleMedium">1. Choose your register file</Text>
          <Text variant="bodyMedium" style={{ color: t.app.muted }}>
            Nothing is saved yet: first you see what will be added, what will change and which rows have problems.
          </Text>
          <Checkbox.Item label="Create classes and sections that do not exist yet" status={createMissing ? 'checked' : 'unchecked'} onPress={() => setCreateMissing((v) => !v)} position="leading" style={{ paddingHorizontal: 0 }} />
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <Button mode="contained" icon="file-upload-outline" onPress={pick} loading={busy === 'check'} disabled={!!busy}>Choose file</Button>
            <Button mode="outlined" icon="download" onPress={template} loading={busy === 'template'} disabled={!!busy}>Download template</Button>
          </View>
        </Card>
      ) : (
        <>
          <Grid max={4} min={2}>
            <Stat label="New students" value={s!.new} tone="pass" />
            <Stat label="Will be updated" value={s!.updated} tone="info" />
            <Stat label="Unchanged" value={s!.unchanged} />
            <Stat label="Rows with problems" value={s!.errors} tone={s!.errors ? 'pen' : undefined} hint={s!.errors ? 'These are skipped' : undefined} />
          </Grid>
          {s!.createClasses.length ? <Card><Text variant="bodyMedium">New classes/sections: {s!.createClasses.join(', ')}</Text></Card> : null}
          {dry.problems.length ? (
            <View>
              <SectionTitle title={`Fix these in Excel (${dry.problems.length})`} action={<Button compact icon="download" onPress={async () => openFile((await api.get<{ url: string }>(`/admin/import/${dry.id}/errors`)).url)}>Download list</Button>} />
              <Card style={{ padding: 0 }}>
                {dry.problems.slice(0, 50).map((r, i) => (
                  <View key={r.line} style={{ paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.outlineVariant }}>
                    <Text variant="labelLarge">Line {r.line}: {r.values.name || '(no name)'} {r.values.rollNo ? `— roll ${r.values.rollNo}` : ''}</Text>
                    {[...r.errors, ...r.warnings].map((m, k) => (
                      <Text key={k} variant="bodySmall" style={{ color: k < r.errors.length ? t.colors.error : t.app.review }}>{m}</Text>
                    ))}
                  </View>
                ))}
              </Card>
            </View>
          ) : null}
          <View>
            <SectionTitle title="Preview" />
            <Card style={{ padding: 0 }}>
              {dry.preview.slice(0, 30).map((r, i) => (
                <View key={r.line} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.outlineVariant }}>
                  <Text variant="bodySmall" style={{ width: 34, color: t.app.muted }}>{r.line}</Text>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium">{r.values.name}</Text>
                    <Text variant="bodySmall" style={{ color: t.app.muted }}>
                      {r.values.className} {r.values.section}, roll {r.values.rollNo}{r.changes?.length ? ` — changes: ${r.changes.join(', ')}` : ''}
                    </Text>
                  </View>
                  <Tag {...ACTION[r.action]} />
                </View>
              ))}
            </Card>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <Button mode="contained" icon="content-save-outline" onPress={save} loading={busy === 'save'} disabled={!!busy || s!.new + s!.updated === 0}>
              2. Save {s!.new + s!.updated} students
            </Button>
            <Button onPress={() => setDry(null)} disabled={!!busy}>Choose another file</Button>
          </View>
        </>
      )}
      {jobs.data?.length ? (
        <View>
          <SectionTitle title="Earlier imports" />
          <Card style={{ padding: 0 }}>
            {jobs.data.map((j, i) => (
              <View key={j.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.outlineVariant }}>
                <Text variant="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>{j.fileName}</Text>
                <Text variant="bodySmall" style={{ color: t.app.muted }}>{fmtDate(j.createdAt)}</Text>
                <Tag tone={j.status === 'DONE' ? 'pass' : j.status === 'FAILED' ? 'pen' : 'muted'} label={j.status === 'DONE' ? `${j.summary.result?.created ?? 0} new, ${j.summary.result?.updated ?? 0} updated` : j.status === 'DRY_RUN' ? 'Checked only' : j.status} />
              </View>
            ))}
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}
