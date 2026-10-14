import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, HelperText, IconButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toast } from '@/components/feedback';
import { TextInput } from '@/components/Input';
import { ClassSectionPicker, type SchoolInfo } from '@/components/SchoolPicker';
import { Wordmark } from '@/components/Shell';
import { Card, PenNote, useAppTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { errorText, queryClient } from '@/lib/query';
import { useThemeMode } from '@/lib/theme';
import { unregisterPush } from '@/lib/push';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { User } from '@/lib/types';
import { useT } from '@/lib/i18n';

interface Enrollment {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason: string | null;
  rollNo: string;
  sectionId: string;
  className: string;
  sectionName: string;
  school: SchoolInfo;
}

/** Where a self-registered student waits until a teacher approves them. Nothing else in the app is reachable. */
export default function Pending() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const { user, setUser, refreshToken, clear } = useAuth();
  const { dark, toggle } = useThemeMode();
  const q = useQuery({ queryKey: ['enrollment'], queryFn: () => api.get<Enrollment>('/student/enrollment'), refetchInterval: 20_000, enabled: !!user });
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [rollNo, setRollNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState('');
  const tr = useT();
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  // the code from a printed claim card links the account at once
  const linkCard = async () => {
    if (card.replace(/[^0-9A-Z]/gi, '').length < 8) return setCardError('Type the 8-letter code from your card');
    setCardBusy(true);
    setCardError(null);
    try {
      await api.post('/student/claim-code', { code: card.trim() });
      const me = await api.get<User>('/auth/me');
      setUser(me);
      toast('Your account is linked. Welcome!');
      router.replace('/student');
    } catch (e) {
      setCardError(errorText(e));
    } finally {
      setCardBusy(false);
    }
  };

  // as soon as the teacher approves, refresh the profile and go in
  useEffect(() => {
    if (q.data?.status === 'APPROVED') {
      void api.get<User>('/auth/me').then((me) => {
        setUser(me);
        toast('You are approved. Welcome!');
        router.replace('/student');
      });
    }
    if (q.data) {
      setSectionId((s) => s ?? q.data.sectionId);
      setRollNo((r) => r || q.data.rollNo);
    }
  }, [q.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return <Redirect href="/login" />;
  if (user.role !== 'STUDENT' || user.student) return <Redirect href={homeFor(user.role, user) as any} />;

  const logout = async () => {
    await unregisterPush();
    if (refreshToken) await api.public('/auth/logout', { refreshToken }).catch(() => undefined);
    queryClient.clear();
    await clear();
    router.replace('/login');
  };

  const resubmit = async () => {
    if (!sectionId || !rollNo.trim()) return setError('Choose your class, section and roll number');
    setBusy(true);
    setError(null);
    try {
      await api.patch('/student/enrollment', { sectionId, rollNo: rollNo.trim() });
      setUser(await api.get<User>('/auth/me'));
      await q.refetch();
      toast('Request sent again');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const e = q.data;
  const rejected = e?.status === 'REJECTED';
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 6, paddingHorizontal: 16 }}>
        <View style={{ flex: 1 }}>
          <Wordmark size={30} />
        </View>
        <IconButton icon={dark ? 'white-balance-sunny' : 'weather-night'} onPress={toggle} accessibilityLabel={dark ? 'Switch to light mode' : 'Switch to dark mode'} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: 520, gap: 16 }}>
          <View style={{ alignItems: 'center', marginTop: 16, gap: 6 }}>
            <View style={{ width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: rejected ? t.colors.primaryContainer : t.app.reviewBg }}>
              <MaterialCommunityIcons name={rejected ? 'account-cancel-outline' : 'timer-sand'} size={40} color={rejected ? t.colors.primary : t.app.review} />
            </View>
            <Text variant="headlineSmall" style={{ textAlign: 'center' }} accessibilityRole="header">
              {tr(rejected ? 'Your details did not match' : 'Waiting for your teacher')}
            </Text>
            <Text variant="bodyLarge" style={{ textAlign: 'center', color: t.app.muted }}>
              {rejected
                ? 'Fix your class, section or roll number below and send the request again — or use the code card from your teacher.'
                : 'Your details did not exactly match the school list, so your class teacher will link your account. This page opens by itself after that.'}
            </Text>
          </View>

          {e ? (
            <Card>
              <Text variant="titleMedium">{e.school.name}</Text>
              <Text variant="bodyMedium" style={{ color: t.app.muted, marginTop: 4 }}>
                {user.name} — {e.className} {e.sectionName}, roll {e.rollNo}
              </Text>
              {rejected && e.rejectReason ? (
                <View style={{ marginTop: 10 }}>
                  <PenNote size={22}>{e.rejectReason}</PenNote>
                </View>
              ) : null}
            </Card>
          ) : null}

          {rejected && e ? (
            <Card style={{ gap: 12 }}>
              <ClassSectionPicker school={e.school} sectionId={sectionId} onChange={setSectionId} />
              <TextInput mode="outlined" label="Roll number" value={rollNo} onChangeText={setRollNo} />
              {error ? <HelperText type="error" visible>{error}</HelperText> : null}
              <Button mode="contained" onPress={resubmit} loading={busy} disabled={busy}>
                Send request again
              </Button>
            </Card>
          ) : (
            <Button mode="contained-tonal" icon="refresh" onPress={() => q.refetch()} loading={q.isFetching}>
              {tr('Check again')}
            </Button>
          )}
          <Card style={{ gap: 10 }}>
            <Text variant="titleSmall">{tr('Have a code card from your teacher?')}</Text>
            <TextInput mode="outlined" label={tr('Code on the card')} placeholder="K7QP-3MXA" value={card} onChangeText={(v) => setCard(v.toUpperCase())} autoCapitalize="characters" onSubmitEditing={linkCard} />
            {cardError ? <HelperText type="error" visible>{cardError}</HelperText> : null}
            <Button mode="outlined" icon="card-account-details-outline" onPress={linkCard} loading={cardBusy} disabled={cardBusy}>
              {tr('Link with card')}
            </Button>
          </Card>
          <Button onPress={logout}>{tr('Log out')}</Button>
        </View>
      </ScrollView>
    </View>
  );
}
