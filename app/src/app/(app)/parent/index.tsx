import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Chip, Text } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import { useDialog } from '@/components/feedback';
import { LinkChild } from '@/components/LinkChild';
import { DashboardBody, parentPaths, type Dash } from '@/components/StudentViews';
import { Empty, ErrorView, Loading, PageHeader, Screen, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { greeting } from '@/lib/format';
import { prefs } from '@/lib/storage';
import { PENDING_CODE_KEY } from '@/lib/auth';
import { useT } from '@/lib/i18n';

interface Req { id: string; name: string; rollNo: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; rejectReason: string | null; className: string; sectionName: string; school: string }
interface Child { id: string; name: string; rollNo: string; className: string; sectionName: string; school: string; status: string }
const KEY = 'laalpen.parent.child';

/** Parent home: every child linked to this phone number, one tap to switch. */
export default function ParentHome() {
  const t = useAppTheme();
  const params = useLocalSearchParams<{ code?: string }>();
  const kids = useQuery({ queryKey: ['parent', 'children'], queryFn: () => api.get<Child[]>('/parent/children') });
  const requests = useQuery({ queryKey: ['parent', 'requests'], queryFn: () => api.get<Req[]>('/parent/requests') });
  const [pendingCode, setPendingCode] = useState<string | undefined>(params.code);
  const [childId, setChildId] = useState<string | null>(null);
  const add = useDialog();
  const tr = useT();

  useEffect(() => {
    void prefs.get(KEY).then((v) => setChildId((c) => c ?? v));
  }, []);
  // QR on a card (laalpen://parent?code=XXXX) or a code kept from sign-up
  useEffect(() => {
    if (params.code) return void add.open();
    void prefs.get(PENDING_CODE_KEY).then((c) => {
      if (!c) return;
      void prefs.remove(PENDING_CODE_KEY);
      setPendingCode(c);
      add.open();
    });
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
        <Empty title={tr('No children linked yet')} body={tr('Type the class code (e.g. ALN-9A) or the card code from the school.')} action={<Button mode="contained" icon="account-plus-outline" onPress={() => add.open()} testID="add-child">{tr('Add child')}</Button>} />
      ) : null}
      {(requests.data ?? []).filter((r) => r.status !== 'APPROVED').map((r) => (
        <View key={r.id} style={{ padding: 12, borderRadius: 12, backgroundColor: r.status === 'REJECTED' ? t.colors.errorContainer : t.colors.surfaceVariant }}>
          <Text variant="bodyMedium">
            {r.name} ({r.className} {r.sectionName}, {tr('Roll number')} {r.rollNo}) — {r.status === 'PENDING' ? tr('waiting for the class teacher to confirm') : `${tr('not confirmed')}: ${r.rejectReason ?? ''}`}
          </Text>
        </View>
      ))}
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
      <LinkChild
        visible={add.visible}
        initialCode={pendingCode}
        onDismiss={() => { add.close(); setPendingCode(undefined); if (params.code) router.setParams({ code: undefined as any }); }}
      />
    </Screen>
  );
}
