import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Dialog, Menu, Portal, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { toast, toastError } from './feedback';
import { useAppTheme } from './ui';
import { api } from '@/lib/api';
import { openFile } from '@/lib/files';
import { pickPages } from '@/lib/pick';
import { queryClient } from '@/lib/query';

interface StackResult {
  copies: { studentId: string; name: string; rollNo: string; pages: number; missing: number[] }[];
  omr: { studentId: string; name: string; rollNo: string; obtained: number; total: number; review: number }[];
  unmatched: { index: number; filename: string; reason: string }[];
}

/**
 * Print sheets with a QR code (booklets, stickers, OMR) and upload the whole pile of photos in any order.
 */
export function StackTools({ testId, allMcq, pages }: { testId: string; allMcq: boolean; pages: number | null }) {
  const t = useAppTheme();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<StackResult | null>(null);

  const print = async (kind: 'booklet' | 'stickers' | 'omr') => {
    setMenu(false);
    setBusy(kind);
    try {
      const r = kind === 'omr'
        ? await api.post<{ url: string; students: number }>(`/teacher/tests/${testId}/omr-sheets`, {})
        : await api.post<{ url: string; students: number }>(`/teacher/tests/${testId}/booklets`, { format: kind, pages: pages ?? undefined });
      toast(`Ready to print for ${r.students} students`);
      await openFile(r.url);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const upload = async () => {
    try {
      const photos = await pickPages('library', 80);
      if (!photos.length) return;
      setBusy('stack');
      const form = new FormData();
      for (const p of photos) {
        if (Platform.OS === 'web') form.append('pages', await (await fetch(p.uri)).blob(), p.name);
        else form.append('pages', { uri: p.uri, name: p.name, type: p.type } as any);
      }
      const r = await api.upload<StackResult>(`/teacher/tests/${testId}/stack`, form);
      setResult(r);
      await queryClient.invalidateQueries({ queryKey: ['teacher'] });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      <Menu
        visible={menu}
        onDismiss={() => setMenu(false)}
        anchor={<Button mode="outlined" icon="printer-outline" onPress={() => setMenu(true)} loading={['booklet', 'stickers', 'omr'].includes(busy ?? '')} contentStyle={{ height: 44 }}>Print with QR</Button>}
      >
        <Menu.Item leadingIcon="book-open-page-variant-outline" title="Answer booklets (name + QR on every page)" onPress={() => print('booklet')} />
        <Menu.Item leadingIcon="sticker-outline" title="QR stickers for your own sheets" onPress={() => print('stickers')} />
        <Menu.Item leadingIcon="checkbox-multiple-blank-circle-outline" title={allMcq ? 'OMR bubble sheets' : 'OMR sheets (all questions must be MCQ)'} disabled={!allMcq} onPress={() => print('omr')} />
      </Menu>
      <Button mode="outlined" icon="image-multiple-outline" onPress={upload} loading={busy === 'stack'} disabled={!!busy} contentStyle={{ height: 44 }}>Upload a pile of photos</Button>

      <Portal>
        <Dialog visible={!!result} onDismiss={() => setResult(null)} style={{ maxWidth: 520, alignSelf: 'center', width: '94%' }}>
          <Dialog.Title>Sorted your photos</Dialog.Title>
          <Dialog.Content style={{ gap: 6 }}>
            {result?.copies.length ? <Text variant="bodyMedium">{result.copies.length} copies matched and sent for checking.</Text> : null}
            {result?.copies.filter((c) => c.missing.length).map((c) => (
              <Text key={c.studentId} variant="bodySmall" style={{ color: t.app.review }}>{c.rollNo} {c.name}: page {c.missing.join(', ')} missing</Text>
            ))}
            {result?.omr.length ? <Text variant="bodyMedium">{result.omr.length} OMR sheets marked{result.omr.some((o) => o.review) ? ` (${result.omr.filter((o) => o.review).length} with two circles filled — please look)` : ''}.</Text> : null}
            {result?.unmatched.length ? (
              <>
                <Text variant="bodyMedium" style={{ color: t.colors.error }}>{result.unmatched.length} photos could not be used:</Text>
                {result.unmatched.slice(0, 8).map((u) => <Text key={u.index} variant="bodySmall">Photo {u.index + 1}{u.filename ? ` (${u.filename})` : ''}: {u.reason}</Text>)}
              </>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions><Button onPress={() => setResult(null)}>OK</Button></Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}
