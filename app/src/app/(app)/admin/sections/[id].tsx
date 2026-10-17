import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { FormDialog, toast, toastError, useDialog } from '@/components/feedback';
import { Avatar, Card, Empty, ErrorView, Loading, PageHeader, Screen, SectionTitle, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { ClassTools } from '@/components/ClassTools';
import { useLayout } from '@/lib/layout';
import { queryClient } from '@/lib/query';

interface SectionDetail {
  id: string; name: string; className: string; classId: string; joinCode: string | null; joinCodeExpiresAt: string | null;
  students: { id: string; name: string; email: string | null; hasAccount: boolean; rollNo: string; guardianPhone: string | null; guardianEmail: string | null; isActive: boolean }[];
  subjects: { assignmentId: string; subjectId: string; subject: string; color: string | null; teacher: { id: string; name: string; email: string } }[];
}

export default function AdminSection() {
  const t = useAppTheme();
  const { wide } = useLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['admin', 'section', id], queryFn: () => api.get<SectionDetail>(`/admin/sections/${id}`) });
  const teachers = useQuery({ queryKey: ['admin', 'teachers', ''], queryFn: () => api.get<{ id: string; name: string }[]>('/admin/teachers') });
  const subjects = useQuery({ queryKey: ['admin', 'subjects'], queryFn: () => api.get<{ id: string; name: string }[]>('/admin/subjects') });
  const assign = useDialog();
  const d = q.data;

  const subjectsBlock = (
    <View style={{ flex: 1 }}>
      <SectionTitle title="Subjects and teachers" action={<Button compact icon="plus" onPress={() => assign.open()}>Assign teacher</Button>} />
      {d?.subjects.length ? (
        <View style={{ gap: 8 }}>
          {d.subjects.map((s) => (
            <Card key={s.assignmentId} accent={s.color} style={{ paddingVertical: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text variant="titleMedium">{s.subject}</Text>
                  <Text variant="bodySmall" style={{ color: t.app.muted }}>{s.teacher.name}</Text>
                </View>
                <IconButton icon="link-variant-off" accessibilityLabel={`Remove ${s.teacher.name} from ${s.subject}`} onPress={async () => {
                  try { await api.del(`/admin/assignments/${s.assignmentId}`); await queryClient.invalidateQueries(); toast('Teacher removed from subject'); } catch (e) { toastError(e); }
                }} />
              </View>
            </Card>
          ))}
        </View>
      ) : <Empty title="No subjects assigned" body="Assign a teacher for each subject taught in this section." />}
    </View>
  );

  const studentsBlock = (
    <View style={{ flex: 1.5 }}>
      <SectionTitle title={`Students (${d?.students.length ?? 0})`} action={<Button compact icon="account-plus-outline" onPress={() => router.push({ pathname: '/admin/students', params: { add: '1', sectionId: id } })}>Add student</Button>} />
      {d?.students.length ? (
        <Card style={{ padding: 0 }}>
          {d.students.map((s, i) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.outlineVariant, opacity: s.isActive ? 1 : 0.5 }}>
              <Text variant="labelLarge" style={{ width: 28, color: t.app.muted }}>{s.rollNo}</Text>
              <Avatar name={s.name} size={30} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyLarge">{s.name}</Text>
                <Text variant="bodySmall" style={{ color: t.app.muted }} numberOfLines={1}>{s.hasAccount ? s.email ?? 'Has the app' : 'No app account yet'}{s.guardianPhone ? ` — parent: ${s.guardianPhone}` : ''}</Text>
              </View>
            </View>
          ))}
        </Card>
      ) : <Empty title="No students yet" body="Add students to this section." />}
    </View>
  );

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader back title={d ? `${d.className} — Section ${d.name}` : 'Section'} subtitle={d ? `${d.students.length} students, ${d.subjects.length} subjects` : undefined} />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {d ? <ClassTools key={d.joinCode ?? 'none'} sectionId={d.id} role="PRINCIPAL" joinCode={d.joinCode} expiresAt={d.joinCodeExpiresAt} /> : null}
      {d ? (wide ? <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>{studentsBlock}{subjectsBlock}</View> : <>{subjectsBlock}{studentsBlock}</>) : null}
      <FormDialog
        visible={assign.visible}
        title="Assign a teacher"
        submitLabel="Assign"
        fields={[
          { key: 'subjectId', label: 'Subject', type: 'select', required: true, options: (subjects.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
          { key: 'teacherId', label: 'Teacher', type: 'select', required: true, options: (teachers.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
        ]}
        onDismiss={assign.close}
        onSubmit={async (v) => {
          await api.post('/admin/assignments', { sectionId: id, subjectId: v.subjectId, teacherId: v.teacherId });
          await queryClient.invalidateQueries();
          toast('Teacher assigned');
        }}
      />
    </Screen>
  );
}
