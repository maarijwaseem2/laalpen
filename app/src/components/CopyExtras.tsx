import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import { FormDialog, toast, toastError, useDialog } from './feedback';
import { useAppTheme } from './ui';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { queryClient } from '@/lib/query';
import type { SubmissionStatus } from '@/lib/types';

interface HistoryRow { id: string; at: string; action: string; by: string; before: any; after: any; reason: string | null }

const WHAT: Record<string, string> = {
  'answer.edit': 'changed a mark', 'answer.revert': 'went back to the AI mark', 'copy.approve': 'approved the copy',
  'copy.unapprove': 'took back the approval', 'copy.reopen': 're-opened the published copy',
};

function describe(h: HistoryRow) {
  const q = h.after?.question ? `Q${h.after.question}: ` : '';
  if (h.action === 'answer.edit' || h.action === 'answer.revert') return `${q}${h.before?.finalMarks ?? '–'} → ${h.after?.finalMarks ?? '–'}`;
  if (h.action === 'copy.approve') return `${h.after?.obtainedMarks ?? ''} marks`;
  return '';
}

/** Mark history, re-open after publishing, "check now" for overnight copies, and a teacher voice note. */
export function CopyExtras({ submissionId, status, published, hasVoice }: { submissionId: string; status: SubmissionStatus; published: boolean; hasVoice?: boolean }) {
  const t = useAppTheme();
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery({ queryKey: ['teacher', 'history', submissionId], queryFn: () => api.get<HistoryRow[]>(`/teacher/submissions/${submissionId}/history`), enabled: showHistory });
  const reopen = useDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rec = useAudioRecorderState(recorder);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['teacher'] });

  const checkNow = async () => {
    setBusy('now');
    try {
      await api.post(`/teacher/submissions/${submissionId}/check-now`);
      toast('Checking this copy now');
      await refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const record = async () => {
    try {
      if (rec.isRecording) {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) return;
        setBusy('voice');
        const form = new FormData();
        if (Platform.OS === 'web') {
          const blob = await (await fetch(uri)).blob();
          form.append('audio', blob, `note.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`);
        } else form.append('audio', { uri, name: 'note.m4a', type: 'audio/mp4' } as any);
        await api.upload(`/teacher/submissions/${submissionId}/voice-note`, form);
        toast('Voice note saved. The student and parents hear it with the result.');
        await refresh();
        return;
      }
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return toast('Allow the microphone to record a voice note');
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const secs = Math.round((rec.durationMillis ?? 0) / 1000);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Button compact icon="history" onPress={() => setShowHistory(true)}>Mark history</Button>
      {status === 'APPROVED' && published ? <Button compact icon="lock-open-variant-outline" onPress={() => reopen.open()}>Re-open marks</Button> : null}
      {['PENDING', 'NEEDS_ATTENTION', 'FAILED'].includes(status) ? <Button compact icon="lightning-bolt-outline" onPress={checkNow} loading={busy === 'now'} disabled={!!busy}>Check now</Button> : null}
      {status !== 'PENDING' && status !== 'PROCESSING' ? (
        <Button compact icon={rec.isRecording ? 'stop-circle-outline' : 'microphone-outline'} textColor={rec.isRecording ? t.colors.error : undefined} onPress={record} loading={busy === 'voice'} disabled={busy === 'voice'}>
          {rec.isRecording ? `Stop and save (${secs}s)` : hasVoice ? 'Record a new voice note' : 'Voice note'}
        </Button>
      ) : null}

      <Portal>
        <Dialog visible={showHistory} onDismiss={() => setShowHistory(false)} style={{ maxWidth: 520, alignSelf: 'center', width: '94%', maxHeight: '85%' }}>
          <Dialog.Title>Mark history</Dialog.Title>
          <Dialog.ScrollArea style={{ paddingHorizontal: 24 }}>
            <ScrollView contentContainerStyle={{ paddingVertical: 8, gap: 10 }}>
              {history.isLoading ? <Text>Loading…</Text> : null}
              {history.data && !history.data.length ? <Text>No changes yet. The marks are the AI’s.</Text> : null}
              {(history.data ?? []).map((h) => (
                <View key={h.id}>
                  <Text variant="bodyMedium"><Text style={{ fontWeight: '600' }}>{h.by}</Text> {WHAT[h.action] ?? h.action} {describe(h)}</Text>
                  <Text variant="bodySmall" style={{ color: t.app.muted }}>{timeAgo(h.at)}{h.reason ? ` — “${h.reason}”` : ''}</Text>
                </View>
              ))}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions><Button onPress={() => setShowHistory(false)}>Close</Button></Dialog.Actions>
        </Dialog>
      </Portal>
      <FormDialog
        visible={reopen.visible}
        title="Re-open published marks?"
        submitLabel="Re-open"
        fields={[{ key: 'reason', label: 'Why do the marks need to change?', required: true, type: 'multiline', placeholder: 'Parent showed that Q3 was answered on page 2', help: 'This is saved in the history and the principal is told.' }]}
        onDismiss={reopen.close}
        onSubmit={async (v) => {
          await api.post(`/teacher/submissions/${submissionId}/reopen`, { reason: v.reason });
          await refresh();
          toast('Re-opened. Change the marks, then approve again.');
        }}
      />
    </View>
  );
}
