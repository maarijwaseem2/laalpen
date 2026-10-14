import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, SegmentedButtons, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fileUrl } from '@/lib/config';
import { radius, space } from '@/lib/theme';
import { Card, Tag, useAppTheme } from './ui';

export interface ClassRow {
  sectionId: string;
  className: string;
  sectionName: string;
  grade: number;
  students: number;
  toReview: number;
  joinRequests?: number;
  subjects: { assignmentId: string; subject: string; color: string | null; tests: number; toReview: number }[];
}

/** One subject in the section → straight to it; several → choose the subject first. */
export function openClass(row: ClassRow) {
  if (row.subjects.length === 1) router.push(`/teacher/assignment/${row.subjects[0]!.assignmentId}`);
  else router.push(`/teacher/section/${row.sectionId}`);
}

/** A class section shown like a school copy cover: the spine carries one stripe per subject. */
export function ClassTile({ row, onPress }: { row: ClassRow; onPress: () => void }) {
  const t = useAppTheme();
  const short = `${row.grade || row.className.replace(/\D/g, '') || row.className}-${row.sectionName}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.className} section ${row.sectionName}, ${row.students} students`}
      style={({ hovered, pressed }: any) => [
        styles.tile,
        { backgroundColor: t.app.card, borderColor: hovered || pressed ? t.colors.outline : t.colors.outlineVariant },
      ]}
    >
      <View style={styles.spine}>
        {row.subjects.map((s) => (
          <View key={s.assignmentId} style={{ flex: 1, backgroundColor: s.color ?? t.colors.secondary }} />
        ))}
      </View>
      <View style={{ flex: 1, padding: space.lg, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ fontFamily: 'Lexend_600SemiBold', fontSize: 34, lineHeight: 40, color: t.colors.onSurface }}>{short}</Text>
            <Text variant="bodyMedium" style={{ color: t.app.muted }}>
              {row.className}, section {row.sectionName}
            </Text>
          </View>
          <View style={{ gap: 4, alignItems: 'flex-end' }}>
            {row.toReview ? <Tag label={`${row.toReview} to review`} tone="review" /> : null}
            {row.joinRequests ? <Tag label={`${row.joinRequests} want to join`} tone="info" icon="account-clock-outline" /> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {row.subjects.map((s) => (
            <View key={s.assignmentId} style={[styles.subjectChip, { backgroundColor: t.colors.surfaceVariant }]}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color ?? t.colors.secondary }} />
              <Text variant="labelMedium">{s.subject}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MaterialCommunityIcons name="account-multiple-outline" size={16} color={t.app.muted} />
          <Text variant="bodySmall" style={{ color: t.app.muted }}>
            {row.students} students
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export function SubjectTile({ name, color, lines, badge, onPress }: { name: string; color?: string | null; lines: string[]; badge?: string | null; onPress?: () => void }) {
  const t = useAppTheme();
  return (
    <Card onPress={onPress} accent={color ?? t.colors.secondary} label={name}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <Text variant="titleLarge" style={{ flex: 1 }}>
          {name}
        </Text>
        {badge ? <Tag label={badge} tone="review" /> : null}
      </View>
      {lines.map((l) => (
        <Text key={l} variant="bodyMedium" style={{ color: t.app.muted, marginTop: 2 }}>
          {l}
        </Text>
      ))}
    </Card>
  );
}

export interface PageImage {
  pageNo: number;
  checkedUrl?: string | null;
  originalUrl?: string | null;
}

/** Shows the student's pages; switch between the red-pen copy and the original photo; tap to enlarge. */
export function CopyViewer({ pages, preferChecked = true, height }: { pages: PageImage[]; preferChecked?: boolean; height?: number }) {
  const t = useAppTheme();
  const [idx, setIdx] = useState(0);
  const hasChecked = pages.some((p) => p.checkedUrl);
  const [view, setView] = useState<'checked' | 'original'>(preferChecked && hasChecked ? 'checked' : 'original');
  const [full, setFull] = useState(false);
  const insets = useSafeAreaInsets();
  const page = pages[idx];
  if (!page) return null;
  const src = fileUrl(view === 'checked' ? (page.checkedUrl ?? page.originalUrl) : page.originalUrl);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {hasChecked ? (
          <SegmentedButtons
            density="small"
            style={{ flexGrow: 1, maxWidth: 320 }}
            value={view}
            onValueChange={(v) => setView(v as 'checked' | 'original')}
            buttons={[
              { value: 'checked', label: 'Checked copy', icon: 'draw-pen' },
              { value: 'original', label: 'Original', icon: 'image-outline' },
            ]}
          />
        ) : null}
        <View style={{ flex: 1 }} />
        {pages.length > 1 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton icon="chevron-left" disabled={idx === 0} onPress={() => setIdx((i) => i - 1)} accessibilityLabel="Previous page" />
            <Text variant="labelLarge">
              Page {idx + 1} of {pages.length}
            </Text>
            <IconButton icon="chevron-right" disabled={idx === pages.length - 1} onPress={() => setIdx((i) => i + 1)} accessibilityLabel="Next page" />
          </View>
        ) : null}
      </View>
      <Pressable onPress={() => setFull(true)} accessibilityRole="imagebutton" accessibilityLabel={`Page ${idx + 1}, tap to enlarge`}>
        <View style={[styles.paper, { borderColor: t.colors.outlineVariant, backgroundColor: t.dark ? '#0B0F18' : '#FFFFFF', height: height ?? undefined }]}>
          <Image source={{ uri: src }} style={{ width: '100%', aspectRatio: height ? undefined : 0.707, height: height ?? undefined }} contentFit="contain" transition={150} />
        </View>
      </Pressable>
      <Modal visible={full} onRequestClose={() => setFull(false)} animationType="fade" transparent={false}>
        <View style={{ flex: 1, backgroundColor: '#111' }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
          >
            <Image source={{ uri: src }} style={{ width: '100%', height: Platform.OS === 'web' ? ('100vh' as any) : 900 }} contentFit="contain" />
          </ScrollView>
          <IconButton icon="close" iconColor="#fff" size={28} onPress={() => setFull(false)} style={{ position: 'absolute', top: insets.top + 8, right: 8, backgroundColor: 'rgba(0,0,0,0.5)' }} accessibilityLabel="Close" />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flexDirection: 'row', borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, overflow: 'hidden', minHeight: 150 },
  spine: { width: 9, flexDirection: 'column' },
  subjectChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  paper: { borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
});
