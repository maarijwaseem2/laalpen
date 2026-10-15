import { router } from 'expo-router';
import { type ReactNode, useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { IconButton, Text, useTheme } from 'react-native-paper';
import { Button } from '@/components/SafeButton';
import Svg, { Path } from 'react-native-svg';
import { useLayout } from '@/lib/layout';
import { PEN_FONT, radius, space, type AppTheme } from '@/lib/theme';
import { errorText } from '@/lib/query';
import { fmtNum } from '@/lib/format';
import type { ReviewState, SubmissionStatus, TestStatus } from '@/lib/types';

export const useAppTheme = () => useTheme<AppTheme>();

/** Scrollable page body with a readable max width and pull-to-refresh. */
export function Screen({ children, onRefresh, refreshing = false, maxWidth = 1180, padded = true }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean; maxWidth?: number; padded?: boolean }) {
  const t = useAppTheme();
  const { gutter } = useLayout();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={onRefresh && Platform.OS !== 'web' ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: padded ? gutter : 0, paddingTop: space.lg, gap: space.xl }}>{children}</View>
    </ScrollView>
  );
}

/** Page title row: optional back arrow, title, small subtitle, actions on the right. */
export function PageHeader({ title, subtitle, back, actions, color }: { title: string; subtitle?: string; back?: boolean | string; actions?: ReactNode; color?: string | null }) {
  const t = useAppTheme();
  return (
    <View style={styles.header}>
      {back ? (
        <IconButton
          icon="arrow-left"
          accessibilityLabel="Go back"
          style={{ marginLeft: -8, marginRight: 0 }}
          onPress={() => (typeof back === 'string' ? router.replace(back as any) : router.canGoBack() ? router.back() : router.replace('/'))}
        />
      ) : null}
      <View style={{ flex: 1, minWidth: 180 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {color ? <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: color }} /> : null}
          <View style={{ flex: 1 }}>
            <Text variant="headlineSmall" numberOfLines={2} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? (
              <Text variant="bodyMedium" style={{ color: t.app.muted, marginTop: 2 }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
      {actions ? <View style={styles.headerActions}>{actions}</View> : null}
    </View>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md, gap: space.md }}>
      <Text variant="titleMedium">{title}</Text>
      {action}
    </View>
  );
}

/** Flat card with a hairline border — paper on the desk, not floating SaaS cards. */
export function Card({ children, style, onPress, accent, label }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; accent?: string | null; label?: string }) {
  const t = useAppTheme();
  const base: ViewStyle = {
    backgroundColor: t.app.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: t.colors.outlineVariant,
    overflow: 'hidden',
    flexGrow: 1,
  };
  const body = (
    <View style={{ flexDirection: 'row', flex: 1 }}>
      {accent ? <View style={{ width: 5, backgroundColor: accent }} /> : null}
      <View style={[{ flex: 1, padding: space.lg }, style]}>{children}</View>
    </View>
  );
  if (!onPress) return <View style={base}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      // on web a role=button renders a <button>, and a card holds its own buttons (Retake, Check anyway…):
      // <button> inside <button> is invalid HTML, so the card itself is a focusable div there
      accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
      focusable
      accessibilityLabel={label}
      style={({ pressed, hovered }: any) => [base, (hovered || pressed) && { borderColor: t.colors.outline, backgroundColor: t.colors.elevation.level2 }]}
    >
      {body}
    </Pressable>
  );
}

/** Responsive grid: 1 column on phones, up to 4 on wide screens. */
export function Grid({ children, min = 1, max = 4 }: { children: ReactNode; min?: number; max?: number }) {
  const { cols } = useLayout();
  const n = Math.max(min, Math.min(max, cols));
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : [children];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.sm }}>
      {items.map((c, i) => (
        <View key={i} style={{ width: `${100 / n}%`, padding: space.sm }}>
          {c}
        </View>
      ))}
    </View>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'pen' | 'pass' | 'review' | 'info' }) {
  const t = useAppTheme();
  const color = tone === 'pen' ? t.colors.primary : tone === 'pass' ? t.app.pass : tone === 'review' ? t.app.review : tone === 'info' ? t.app.info : t.colors.onSurface;
  return (
    <Card>
      <Text variant="bodyMedium" style={{ color: t.app.muted }}>
        {label}
      </Text>
      <Text variant="headlineMedium" style={{ color, marginTop: 4 }}>
        {value}
      </Text>
      {hint ? (
        <Text variant="bodySmall" style={{ color: t.app.muted, marginTop: 2 }}>
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

/** The signature element: a score written inside a hand-drawn red ring, like on a checked copy. */
export function ScoreRing({ obtained, total, size = 76, color }: { obtained: number | null | undefined; total: number; size?: number; color?: string }) {
  const t = useAppTheme();
  const c = color ?? t.app.pen;
  const path = useMemo(() => {
    const r = size / 2 - 4;
    const cx = size / 2;
    let d = '';
    for (let k = 0; k <= 350; k += 10) {
      const a = ((k - 95) * Math.PI) / 180;
      const rr = r * (1 + 0.03 * Math.sin(k / 31));
      const x = cx + rr * Math.cos(a);
      const y = cx + rr * Math.sin(a) * 0.96;
      d += `${k === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    return d;
  }, [size]);
  const big = size * 0.36;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`${fmtNum(obtained)} out of ${fmtNum(total)}`}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Path d={path} stroke={c} strokeWidth={Math.max(2, size / 34)} fill="none" strokeLinecap="round" />
      </Svg>
      <Text style={{ fontFamily: PEN_FONT, color: c, fontSize: big, lineHeight: big * 1.02 }}>{fmtNum(obtained)}</Text>
      <View style={{ height: 2, width: size * 0.42, backgroundColor: c, borderRadius: 1, marginVertical: 1 }} />
      <Text style={{ fontFamily: PEN_FONT, color: c, fontSize: big * 0.82, lineHeight: big * 0.9 }}>{fmtNum(total)}</Text>
    </View>
  );
}

/** Handwritten red-pen note, used for teacher comments. */
export function PenNote({ children, size = 20 }: { children: ReactNode; size?: number }) {
  const t = useAppTheme();
  return <Text style={{ fontFamily: PEN_FONT, color: t.app.pen, fontSize: size, lineHeight: size * 1.15 }}>{children}</Text>;
}

const SUB_STATUS: Record<SubmissionStatus, { label: string; tone: 'muted' | 'info' | 'pass' | 'review' | 'pen' }> = {
  PENDING: { label: 'In queue', tone: 'info' },
  PROCESSING: { label: 'Checking…', tone: 'info' },
  CHECKED: { label: 'Ready to approve', tone: 'pass' },
  NEEDS_REVIEW: { label: 'Needs review', tone: 'review' },
  APPROVED: { label: 'Approved', tone: 'pass' },
  FAILED: { label: 'Could not check', tone: 'pen' },
  NEEDS_ATTENTION: { label: 'Retake needed', tone: 'pen' },
};

const REVIEW: Record<ReviewState, { label: string; tone: 'pass' | 'review' | 'pen'; icon: string }> = {
  SURE: { label: 'Sure', tone: 'pass', icon: 'check-circle-outline' },
  CHECK: { label: 'Check', tone: 'review', icon: 'eye-outline' },
  UNREADABLE: { label: "Couldn't read", tone: 'pen', icon: 'help-circle-outline' },
};
/** How sure the AI is — words with an action, never a percentage (Google PAIR guidance). */
export const ReviewBadge = ({ state }: { state: ReviewState }) => <Tag {...REVIEW[state]} />;
const TEST_STATUS: Record<TestStatus, { label: string; tone: 'muted' | 'info' | 'pass' }> = {
  DRAFT: { label: 'Draft', tone: 'muted' },
  ACTIVE: { label: 'In progress', tone: 'info' },
  PUBLISHED: { label: 'Results out', tone: 'pass' },
};

export function Tag({ label, tone = 'muted', icon }: { label: string; tone?: 'muted' | 'info' | 'pass' | 'review' | 'pen'; icon?: string }) {
  const t = useAppTheme();
  const map = {
    muted: [t.colors.surfaceVariant, t.colors.onSurfaceVariant],
    info: [t.app.infoBg, t.app.info],
    pass: [t.app.passBg, t.app.pass],
    review: [t.app.reviewBg, t.app.review],
    pen: [t.colors.primaryContainer, t.colors.primary],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {icon ? <IconLabel icon={icon} color={fg} /> : null}
      <Text variant="labelMedium" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

function IconLabel({ icon, color }: { icon: string; color: string }) {
  // lazy import keeps this file free of icon font coupling
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MaterialCommunityIcons } = require('@expo/vector-icons');
  return <MaterialCommunityIcons name={icon} size={13} color={color} />;
}

export const SubmissionTag = ({ status }: { status: SubmissionStatus }) => <Tag {...SUB_STATUS[status]} />;
export const TestTag = ({ status }: { status: TestStatus }) => <Tag {...TEST_STATUS[status]} />;

export function Loading({ label = 'Loading…' }: { label?: string }) {
  const t = useAppTheme();
  return (
    <View style={{ padding: 48, alignItems: 'center', gap: 12 }}>
      <ActivityIndicator color={t.colors.primary} />
      <Text variant="bodyMedium" style={{ color: t.app.muted }}>
        {label}
      </Text>
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useAppTheme();
  return (
    <Card>
      <Text variant="titleMedium" style={{ color: t.colors.error }}>
        Could not load this page
      </Text>
      <Text variant="bodyMedium" style={{ marginTop: 6, color: t.app.muted }}>
        {errorText(error)}
      </Text>
      {onRetry ? (
        <Button mode="outlined" onPress={onRetry} style={{ alignSelf: 'flex-start', marginTop: 12 }}>
          Try again
        </Button>
      ) : null}
    </Card>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  const t = useAppTheme();
  return (
    <View style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.colors.outline, borderRadius: radius.md, padding: space.xl, alignItems: 'flex-start', gap: 6 }}>
      <Text variant="titleMedium">{title}</Text>
      {body ? (
        <Text variant="bodyMedium" style={{ color: t.app.muted, maxWidth: 520 }}>
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}

/** Segmented status of a class test: uploaded → checking → needs a look → ready → approved. Tap a segment to filter. */
export function StatusSegments({ total, counts, onPick, active }: {
  total: number;
  counts: { pending: number; review: number; checked: number; approved: number; attention: number };
  onPick?: (k: string | null) => void;
  active?: string | null;
}) {
  const t = useAppTheme();
  const parts = [
    { key: 'attention', label: 'Retake', n: counts.attention, color: t.colors.primary },
    { key: 'pending', label: 'Checking', n: counts.pending, color: t.app.info },
    { key: 'review', label: 'Needs a look', n: counts.review, color: t.app.review },
    { key: 'checked', label: 'Ready', n: counts.checked, color: t.app.pass },
    { key: 'approved', label: 'Approved', n: counts.approved, color: t.colors.onSurfaceVariant },
  ];
  const uploaded = parts.reduce((n, p) => n + p.n, 0);
  const missing = Math.max(0, total - uploaded);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ height: 10, borderRadius: 5, overflow: 'hidden', flexDirection: 'row', backgroundColor: t.colors.surfaceVariant }}>
        {parts.map((p) => (p.n > 0 ? <View key={p.key} style={{ flex: p.n, backgroundColor: p.color, opacity: active && active !== p.key ? 0.35 : 1 }} /> : null))}
        {missing > 0 ? <View style={{ flex: missing }} /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Text variant="labelMedium" style={{ color: t.app.muted, marginRight: 4, alignSelf: 'center' }}>{uploaded}/{total} uploaded</Text>
        {parts.filter((p) => p.n > 0).map((p) => (
          <Pressable key={p.key} onPress={() => onPick?.(active === p.key ? null : p.key)} accessibilityRole="button" accessibilityState={{ selected: active === p.key }} accessibilityLabel={`${p.n} ${p.label}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, minHeight: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: active === p.key ? p.color : t.colors.outlineVariant, backgroundColor: active === p.key ? t.colors.surfaceVariant : 'transparent' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.color }} />
            <Text variant="labelMedium">{p.n} {p.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Thin progress bar of a test: approved / to review / checking. */
export function CountsBar({ total, approved, toReview, pending }: { total: number; approved: number; toReview: number; pending: number }) {
  const t = useAppTheme();
  const seg = (n: number, color: string) => (n > 0 ? <View style={{ flex: n, backgroundColor: color }} /> : null);
  const rest = Math.max(0, total - approved - toReview - pending);
  return (
    <View style={{ height: 6, borderRadius: 3, overflow: 'hidden', flexDirection: 'row', backgroundColor: t.colors.surfaceVariant }} accessibilityLabel={`${approved} approved, ${toReview} to review, ${pending} checking`}>
      {seg(approved, t.app.pass)}
      {seg(toReview, t.app.review)}
      {seg(pending, t.app.info)}
      {seg(rest, 'transparent')}
    </View>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const t = useAppTheme();
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.secondaryContainer, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: t.colors.onSecondaryContainer, fontFamily: 'Lexend_600SemiBold', fontSize: size * 0.38 }}>{letters}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.md },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
