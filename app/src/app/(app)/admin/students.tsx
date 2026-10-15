import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Chip, IconButton, Menu, Searchbar, SegmentedButtons, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { Confirm, FormDialog, toast, toastError, useDialog, type Field } from '@/components/feedback';
import { Avatar, Card, Empty, ErrorView, Loading, PageHeader, Screen, Tag, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { openFile } from '@/lib/files';
import { useLayout } from '@/lib/layout';
import { queryClient } from '@/lib/query';
import { fmtPhone } from '@/lib/format';

type Status = 'ACTIVE' | 'LEFT' | 'GRADUATED';
interface Student {
  id: string; name: string; email: string | null; hasAccount: boolean; isActive: boolean; rollNo: string; admissionNo: string | null; fatherName: string | null; dob: string | null;
  sectionId: string; className: string; sectionName: string; guardianName: string | null; guardianEmail: string | null; guardianPhone: string | null; parentsLinked: number; status: Status;
}
interface ClassRow { id: string; name: string; sections: { id: string; name: string; students: number }[] }

const dmy = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const toIso = (v?: string) => {
  const m = v?.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v?.trim() || undefined;
};

/**
 * The school roster. Students do not need an app account to have copies checked —
 * accounts link later (class code + roll + date of birth, or a printed claim card).
 */
export default function AdminStudents() {
  const t = useAppTheme();
  const { wide } = useLayout();
  const params = useLocalSearchParams<{ add?: string; sectionId?: string }>();
  const [section, setSection] = useState<string>(params.sectionId ?? '');
  const [status, setStatus] = useState<Status>('ACTIVE');
  const [search, setSearch] = useState('');
  const classes = useQuery({ queryKey: ['admin', 'classes'], queryFn: () => api.get<ClassRow[]>('/admin/classes') });
  const q = useQuery({
    queryKey: ['admin', 'students', section, search, status],
    queryFn: () => api.get<Student[]>(`/admin/students?${new URLSearchParams({ status, ...(section ? { sectionId: section } : {}), ...(search ? { search } : {}) })}`),
  });
  const create = useDialog();
  const edit = useDialog<Student>();
  const del = useDialog<Student>();
  const leave = useDialog<Student>();
  const [menu, setMenu] = useState<string | null>(null);
  const [cardsBusy, setCardsBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries();
  useEffect(() => { if (params.add) create.open(); }, [params.add]); // eslint-disable-line react-hooks/exhaustive-deps

  const sectionOptions = (classes.data ?? []).flatMap((c) => c.sections.map((s) => ({ value: s.id, label: `${c.name} ${s.name}` })));
  const fields = (isNew: boolean): Field[] => [
    { key: 'name', label: 'Full name', required: true },
    { key: 'sectionId', label: 'Class and section', type: 'select', required: true, options: sectionOptions },
    { key: 'rollNo', label: 'Roll number', required: true },
    { key: 'admissionNo', label: 'Admission / GR number', help: 'Used to update students when you import the register again.' },
    { key: 'fatherName', label: 'Father’s name' },
    { key: 'dob', label: 'Date of birth', placeholder: '14/05/2012', help: 'Students who type the same date are linked automatically.' },
    { key: 'guardianPhone', label: 'Parent’s mobile', placeholder: '0300 1234567', help: 'Parents sign in with this number and get results on it.' },
    { key: 'guardianEmail', label: 'Parent email', type: 'email' },
    ...(isNew ? [{ key: 'email', label: 'Student email (optional)', type: 'email' as const, help: 'Only if the student should get a login now. Otherwise they can join later with the class code.' }] : []),
  ];
  const clean = (v: Record<string, string>) => {
    const out = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== undefined));
    if (out.dob) out.dob = toIso(out.dob)!;
    return out;
  };

  const cards = async () => {
    if (!section) return toast('Choose a section first, then print its claim cards');
    setCardsBusy(true);
    try {
      const r = await api.post<{ url: string; count: number }>('/admin/claim-cards', { sectionId: section });
      toast(`${r.count} claim cards ready`);
      await openFile(r.url);
    } catch (e) {
      toastError(e);
    } finally {
      setCardsBusy(false);
    }
  };

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <PageHeader
        title="Students"
        subtitle="Your school list. Import it once from Excel; students and parents link to it later."
        actions={
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button mode="outlined" icon="microsoft-excel" onPress={() => router.push('/admin/import')}>Import from Excel</Button>
            <Button mode="contained" icon="plus" onPress={() => create.open()}>Add student</Button>
          </View>
        }
      />
      <SegmentedButtons
        value={status}
        onValueChange={(v) => setStatus(v as Status)}
        style={{ maxWidth: 480 }}
        buttons={[
          { value: 'ACTIVE', label: 'In school' },
          { value: 'LEFT', label: 'Left' },
          { value: 'GRADUATED', label: 'Passed out' },
        ]}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip selected={!section} showSelectedOverlay onPress={() => setSection('')}>All sections</Chip>
        {sectionOptions.map((s) => (
          <Chip key={s.value} selected={section === s.value} showSelectedOverlay onPress={() => setSection(s.value)}>{s.label}</Chip>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Searchbar placeholder="Search name, roll or admission no." value={search} onChangeText={setSearch} style={{ flex: 1, minWidth: 240, maxWidth: 480 }} />
        {section && status === 'ACTIVE' ? (
          <Button icon="card-account-details-outline" onPress={cards} loading={cardsBusy} disabled={cardsBusy}>Print claim cards</Button>
        ) : null}
      </View>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? (
        <Empty
          title="No students here"
          body={status !== 'ACTIVE' ? 'Nobody in this list.' : sectionOptions.length ? 'Import your register from Excel, or add students one by one.' : 'Add classes and sections first — or import the register and tick “create missing classes”.'}
          action={status === 'ACTIVE' ? <Button mode="contained" icon="microsoft-excel" onPress={() => router.push('/admin/import')}>Import from Excel</Button> : undefined}
        />
      ) : null}
      {q.data?.length ? (
        <Card style={{ padding: 0 }}>
          {q.data.map((s, i) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.outlineVariant }}>
              <Avatar name={s.name} size={34} />
              <View style={{ flex: 1, opacity: s.isActive ? 1 : 0.55 }}>
                <Text variant="bodyLarge">{s.name}{s.fatherName && wide ? <Text variant="bodySmall" style={{ color: t.app.muted }}>{`  s/o ${s.fatherName}`}</Text> : null}</Text>
                <Text variant="bodySmall" style={{ color: t.app.muted }} numberOfLines={1}>
                  {s.className} {s.sectionName}, roll {s.rollNo}{s.admissionNo ? ` · GR ${s.admissionNo}` : ''}{wide && s.email ? ` — ${s.email}` : ''}
                </Text>
              </View>
              {s.hasAccount ? <Tag tone="pass" icon="cellphone-check" label={wide ? 'Has app' : 'App'} /> : <Tag label={wide ? 'No app yet' : '—'} />}
              {wide ? <Tag tone={s.parentsLinked ? 'info' : 'muted'} icon="account-child-outline" label={s.guardianPhone ? fmtPhone(s.guardianPhone) : 'No parent phone'} /> : null}
              {s.hasAccount && !s.isActive ? <Tag label="Login off" /> : null}
              <Menu visible={menu === s.id} onDismiss={() => setMenu(null)} anchor={<IconButton icon="dots-vertical" onPress={() => setMenu(s.id)} accessibilityLabel={`${s.name} options`} />}>
                <Menu.Item leadingIcon="pencil-outline" title="Edit" onPress={() => { setMenu(null); edit.open(s); }} />
                {s.status === 'ACTIVE' ? (
                  <Menu.Item leadingIcon="exit-run" title="Mark as left" onPress={() => { setMenu(null); leave.open(s); }} />
                ) : (
                  <Menu.Item leadingIcon="backup-restore" title="Back in school" onPress={async () => {
                    setMenu(null);
                    try { await api.post(`/admin/students/${s.id}/rejoin`); await refresh(); toast(`${s.name} is back on the list`); } catch (e) { toastError(e); }
                  }} />
                )}
                {s.hasAccount ? (
                  <Menu.Item leadingIcon={s.isActive ? 'account-off-outline' : 'account-check-outline'} title={s.isActive ? 'Turn login off' : 'Turn login on'} onPress={async () => {
                    setMenu(null);
                    try { await api.patch(`/admin/students/${s.id}`, { isActive: !s.isActive }); await refresh(); } catch (e) { toastError(e); }
                  }} />
                ) : null}
                <Menu.Item leadingIcon="delete-outline" title="Delete (no marks only)" onPress={() => { setMenu(null); del.open(s); }} />
              </Menu>
            </View>
          ))}
        </Card>
      ) : null}

      <FormDialog visible={create.visible} title="Add student" submitLabel="Add student" fields={fields(true)} initial={section ? { sectionId: section } : undefined} onDismiss={create.close}
        onSubmit={async (v) => { await api.post('/admin/students', clean(v)); await refresh(); toast(`${v.name} added`); }} />
      <FormDialog visible={edit.visible} title="Edit student" submitLabel="Save" fields={fields(false)}
        initial={edit.value ? { name: edit.value.name, sectionId: edit.value.sectionId, rollNo: edit.value.rollNo, admissionNo: edit.value.admissionNo ?? '', fatherName: edit.value.fatherName ?? '', dob: dmy(edit.value.dob), guardianEmail: edit.value.guardianEmail ?? '', guardianPhone: edit.value.guardianPhone ?? '' } : undefined}
        onDismiss={edit.close}
        onSubmit={async (v) => { await api.patch(`/admin/students/${edit.value!.id}`, clean(v)); await refresh(); toast('Student updated'); }} />
      <FormDialog visible={leave.visible} title={`${leave.value?.name ?? ''} left the school?`} submitLabel="Mark as left"
        fields={[{ key: 'reason', label: 'Reason (optional)', placeholder: 'Moved to another city' }]}
        onDismiss={leave.close}
        onSubmit={async (v) => { await api.post(`/admin/students/${leave.value!.id}/leave`, { reason: v.reason || undefined }); await refresh(); toast('Marked as left. Old marks are kept.'); }} />
      <Confirm visible={del.visible} title={`Delete ${del.value?.name ?? ''}?`} body="Only for a student added by mistake. Students with checked copies cannot be deleted — mark them as left instead." confirmLabel="Delete" destructive onCancel={del.close}
        onConfirm={async () => { try { await api.del(`/admin/students/${del.value!.id}`); await refresh(); toast('Student deleted'); } catch (e) { toastError(e); } del.close(); }} />
    </Screen>
  );
}
