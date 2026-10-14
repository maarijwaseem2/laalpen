import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Text } from 'react-native-paper';
import { FormDialog, toast, useDialog } from '@/components/feedback';
import { DashboardBody, parentPaths, type Dash } from '@/components/StudentViews';
import { Empty, ErrorView, Loading, PageHeader, Screen, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { greeting } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { prefs } from '@/lib/storage';
import { useT } from '@/lib/i18n';

interface Child { id: string; name: string; rollNo: string; className: string; sectionName: string; school: string; status: string }
const KEY = 'laalpen.parent.child';

/** Parent home: every child linked to this phone number, one tap to switch. */
export default function ParentHome() {
  const t = useAppTheme();
  const params = useLocalSearchParams<{ code?: string }>();
  const kids = useQuery({ queryKey: ['parent', 'children'], queryFn: () => api.get<Child[]>('/parent/children') });
  const [childId, setChildId] = useState<string | null>(null);
  const add = useDialog();
  const tr = useT();

  useEffect(() => {
    void prefs.get(KEY).then((v) => setChildId((c) => c ?? v));
  }, []);
  // QR on a parent code card: laalpen://parent?code=XXXX
  useEffect(() => {
    if (params.code) add.open();
  }, [params.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = kids.data ?? [];
  const current = list.find((c) => c.id === childId) ?? list[0];
  const pick = (id: string) => {
    setChildId(id);
    void prefs.set(KEY, id);
  };
  const dash = useQuery({ queryKey: ['parent', 'dashboard', current?.id], queryFn: () => api.get<Dash>(`/parent/children/${current!.id}/dashboard`), enabled: !!current });

  return (
    <Screen onRefresh={() => { void kids.refetch(); void dash.refetch(); }} refreshing={kids.isRefetching || dash.isRefetching}>
      <PageHeader
        title={tr(greeting())}
        subtitle={current ? `${current.name} — ${current.className} ${current.sectionName}, roll ${current.rollNo} · ${current.school}` : tr('Your children’s checked copies and results')}
        actions={<Button icon="account-plus-outline" onPress={() => add.open()}>{tr('Add child')}</Button>}
      />
      {kids.isLoading ? <Loading /> : null}
      {kids.error ? <ErrorView error={kids.error} onRetry={() => kids.refetch()} /> : null}
      {kids.data && !list.length ? (
        <Empty title={tr('No children linked yet')} body={tr('Ask the school to add your mobile number to your child’s record, or use the parent code card.')} action={<Button mode="contained" onPress={() => add.open()}>{tr('Enter parent code')}</Button>} />
      ) : null}
      {list.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="tablist">
          {list.map((c) => (
            <Chip key={c.id} selected={c.id === current?.id} showSelectedOverlay icon="account-school-outline" onPress={() => pick(c.id)} accessibilityLabel={`Show ${c.name}`}>
              {c.name.split(' ')[0]} · {c.className.replace('Class ', '')}{c.sectionName}
            </Chip>
          ))}
        </View>
      ) : null}
      {current && current.status !== 'ACTIVE' ? <Text variant="bodyMedium" style={{ color: t.app.muted }}>{current.name} is no longer on the school list; old results stay here.</Text> : null}
      {dash.isLoading && current ? <Loading /> : null}
      {dash.error ? <ErrorView error={dash.error} onRetry={() => dash.refetch()} /> : null}
      {dash.data && current ? <DashboardBody d={dash.data} paths={parentPaths(current.id)} parent /> : null}
      <FormDialog
        visible={add.visible}
        title={tr('Add a child')}
        submitLabel={tr('Add')}
        initial={{ code: params.code ?? '' }}
        fields={[{ key: 'code', label: tr('Parent code from the school'), required: true, placeholder: 'K7QP-3MXA', help: tr('Use this when the school has a different number on file.') }]}
        onDismiss={() => { add.close(); if (params.code) router.setParams({ code: undefined as any }); }}
        onSubmit={async (v) => {
          await api.post('/parent/link', { code: v.code });
          await queryClient.invalidateQueries({ queryKey: ['parent'] });
          toast(tr('Child added'));
        }}
      />
    </Screen>
  );
}
