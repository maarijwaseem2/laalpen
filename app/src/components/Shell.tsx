import { popNewOnWeb } from '@/lib/webNotify';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLayout } from '@/lib/layout';
import { PEN_FONT, radius, useThemeMode } from '@/lib/theme';
import type { Role } from '@/lib/types';
import { Avatar, useAppTheme } from './ui';
import { LangButton } from './LangButton';
import { useT } from '@/lib/i18n';

type Item = { href: string; label: string; icon: string; exact?: boolean; also?: string[] };

export const NAV: Record<Role, Item[]> = {
  SUPER_ADMIN: [
    { href: '/platform', label: 'Schools', icon: 'domain', also: ['/platform/school'] },
  ],
  PRINCIPAL: [
    { href: '/admin', label: 'Dashboard', icon: 'view-dashboard-outline', exact: true },
    { href: '/admin/insights', label: 'Insights', icon: 'chart-box-outline' },
    { href: '/admin/classes', label: 'Classes', icon: 'google-classroom', also: ['/admin/sections'] },
    { href: '/admin/teachers', label: 'Teachers', icon: 'human-male-board' },
    { href: '/admin/students', label: 'Students', icon: 'account-school-outline', also: ['/admin/import'] },
    { href: '/admin/sessions', label: 'School year', icon: 'calendar-sync-outline' },
    { href: '/admin/subjects', label: 'Subjects', icon: 'book-open-page-variant-outline' },
    { href: '/requests', label: 'Join requests', icon: 'account-clock-outline' },
    { href: '/admin/activity', label: 'Activity log', icon: 'history' },
    { href: '/school-setup', label: 'School profile', icon: 'domain' },
  ],
  TEACHER: [
    { href: '/teacher', label: 'Home', icon: 'home-outline', exact: true },
    { href: '/teacher/classes', label: 'My classes', icon: 'google-classroom', also: ['/teacher/section', '/teacher/assignment', '/teacher/test', '/teacher/submission', '/teacher/key', '/teacher/capture', '/teacher/grade'] },
    { href: '/requests', label: 'Join requests', icon: 'account-clock-outline' },
  ],
  STUDENT: [
    { href: '/student', label: 'Home', icon: 'home-outline', exact: true },
    { href: '/student/subjects', label: 'Subjects', icon: 'book-open-page-variant-outline', also: ['/student/subject', '/student/result'] },
  ],
  PARENT: [{ href: '/parent', label: 'My children', icon: 'account-child-outline', also: ['/parent/result', '/parent/subject'] }],
};

const COMMON: Item[] = [
  { href: '/notifications', label: 'Notifications', icon: 'bell-outline' },
  { href: '/profile', label: 'Profile', icon: 'account-circle-outline' },
];

function isActive(path: string, item: Item) {
  if (item.also?.some((p) => path.startsWith(p))) return true;
  if (item.exact) return path === item.href;
  return path === item.href || path.startsWith(`${item.href}/`);
}

export function Wordmark({ size = 30 }: { size?: number }) {
  const t = useAppTheme();
  return (
    <Text style={{ fontFamily: PEN_FONT, fontSize: size, lineHeight: size * 1.1, color: t.colors.primary }} accessibilityRole="header">
      LaalPen
    </Text>
  );
}

function useRequestCount(enabled: boolean) {
  const role = useAuth((s) => s.user?.role);
  const q = useQuery({ queryKey: ['requests', 'count'], queryFn: () => api.get<{ count: number }>('/requests/count'), enabled: enabled && (role === 'PRINCIPAL' || role === 'TEACHER'), refetchInterval: 60_000 });
  return enabled ? (q.data?.count ?? 0) : 0;
}

function useUnread() {
  const q = useQuery({ queryKey: ['unread'], queryFn: () => api.get<{ count: number }>('/notifications/unread-count'), refetchInterval: 30_000 });
  const count = q.data?.count ?? 0;
  useEffect(() => { void popNewOnWeb(count); }, [count, q.dataUpdatedAt]);
  return count;
}

function ThemeButton() {
  const { dark, toggle } = useThemeMode();
  return <IconButton icon={dark ? 'white-balance-sunny' : 'weather-night'} accessibilityLabel={dark ? 'Switch to light mode' : 'Switch to dark mode'} onPress={toggle} />;
}

function Bell() {
  const unread = useUnread();
  return (
    <View>
      <IconButton icon={unread ? 'bell-badge-outline' : 'bell-outline'} accessibilityLabel={`Notifications, ${unread} unread`} onPress={() => router.push('/notifications')} />
      {unread ? (
        <Badge size={18} style={{ position: 'absolute', top: 4, right: 4 }}>
          {unread > 99 ? '99+' : unread}
        </Badge>
      ) : null}
    </View>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { wide } = useLayout();
  const user = useAuth((s) => s.user);
  const path = usePathname();
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const tr = useT();
  if (!user) return <>{children}</>;
  const items = NAV[user.role];

  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.background }}>
        <View style={[styles.sidebar, { backgroundColor: t.app.card, borderRightColor: t.colors.outlineVariant }]}>
          <View style={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18 }}>
            <Wordmark size={34} />
            <Text variant="bodySmall" style={{ color: t.app.muted }} numberOfLines={2}>
              {user.role === 'SUPER_ADMIN' ? 'All schools' : user.role === 'PARENT' ? 'Parent / Student' : user.school?.name ?? 'Your school'}
            </Text>
          </View>
          <View style={{ paddingHorizontal: 10, gap: 2 }}>
            {[...items, ...COMMON].map((it, i) => (
              <View key={it.href}>
                {i === items.length ? <View style={{ height: 1, backgroundColor: t.colors.outlineVariant, marginVertical: 10, marginHorizontal: 10 }} /> : null}
                <SideLink item={it} active={isActive(path, it)} />
              </View>
            ))}
          </View>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => router.push('/profile')} style={[styles.me, { borderTopColor: t.colors.outlineVariant }]} accessibilityRole="button" accessibilityLabel="Open profile">
            <Avatar name={user.name} size={34} />
            <View style={{ flex: 1 }}>
              <Text variant="labelLarge" numberOfLines={1}>
                {user.name}
              </Text>
              <Text variant="bodySmall" style={{ color: t.app.muted }}>
                {user.role === 'SUPER_ADMIN' ? 'LaalPen admin' : user.role === 'PRINCIPAL' ? 'Principal' : user.role === 'TEACHER' ? 'Teacher' : user.role === 'PARENT' ? 'Parent' : `Student · ${user.student?.className ?? ''} ${user.student?.sectionName ?? ''}`}
              </Text>
            </View>
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>
          <View style={[styles.topbar, { borderBottomColor: t.colors.outlineVariant }]}>
            <View style={{ flex: 1 }} />
            <LangButton />
            <ThemeButton />
            <Bell />
          </View>
          <View style={{ flex: 1 }}>{children}</View>
        </View>
      </View>
    );
  }

  // phones: 4 tabs + Profile; everything else sits under "More"
  const tabs = items.length > 4 ? [...items.slice(0, 3), { href: '/more', label: 'More', icon: 'dots-horizontal-circle-outline', also: items.slice(3).map((i) => i.href) }, COMMON[1]] : [...items.slice(0, 4), COMMON[1]];
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={[styles.mobileTop, { paddingTop: insets.top + 4, backgroundColor: t.app.card, borderBottomColor: t.colors.outlineVariant }]}>
        <View style={{ flex: 1, paddingLeft: 16 }}>
          <Wordmark size={28} />
        </View>
        <LangButton />
        <ThemeButton />
        <Bell />
      </View>
      <View style={{ flex: 1 }}>{children}</View>
      <View style={[styles.tabbar, { paddingBottom: Math.max(insets.bottom, 6), backgroundColor: t.app.card, borderTopColor: t.colors.outlineVariant }]}>
        {tabs.map((it) => {
          const active = isActive(path, it);
          return (
            <TouchableRipple key={it.href} onPress={() => router.navigate(it.href as any)} style={{ flex: 1 }} borderless accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={tr(it.label)}>
              <View style={{ alignItems: 'center', paddingTop: 8, gap: 3 }}>
                <View style={{ backgroundColor: active ? t.colors.primaryContainer : 'transparent', borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 3 }}>
                  <MaterialCommunityIcons name={it.icon as any} size={22} color={active ? t.colors.primary : t.app.muted} />
                </View>
                <Text variant="labelSmall" style={{ color: active ? t.colors.primary : t.app.muted }} numberOfLines={1}>
                  {tr(it.label)}
                </Text>
              </View>
            </TouchableRipple>
          );
        })}
      </View>
    </View>
  );
}

function SideLink({ item, active }: { item: Item; active: boolean }) {
  const t = useAppTheme();
  const tr = useT();
  const count = useRequestCount(item.href === '/requests');
  return (
    <Pressable
      onPress={() => router.navigate(item.href as any)}
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      style={({ hovered }: any) => [
        styles.link,
        { backgroundColor: active ? t.colors.primaryContainer : hovered ? t.colors.surfaceVariant : 'transparent' },
      ]}
    >
      <MaterialCommunityIcons name={item.icon as any} size={20} color={active ? t.colors.primary : t.colors.onSurfaceVariant} />
      <Text variant="labelLarge" style={{ color: active ? t.colors.onPrimaryContainer : t.colors.onSurface, flex: 1 }}>
        {tr(item.label)}
      </Text>
      {count ? <Badge size={20} style={{ backgroundColor: t.app.review }}>{count}</Badge> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: { width: 256, borderRightWidth: StyleSheet.hairlineWidth * 2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  me: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  topbar: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  mobileTop: { flexDirection: 'row', alignItems: 'center', paddingRight: 4, paddingBottom: 2, borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  tabbar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
