import { useState } from 'react';
import { View } from 'react-native';
import { Chip, Text } from 'react-native-paper';
import { useAppTheme } from './ui';

export interface SchoolInfo {
  name: string;
  city?: string | null;
  joinCode: string;
  classes: { id: string; name: string; sections: { id: string; name: string }[] }[];
}

/** Pick class, then section, as chips — quick on a phone, no tiny dropdowns. */
export function ClassSectionPicker({ school, sectionId, onChange }: { school: SchoolInfo; sectionId: string | null; onChange: (sectionId: string) => void }) {
  const t = useAppTheme();
  const initialClass = school.classes.find((c) => c.sections.some((s) => s.id === sectionId))?.id ?? null;
  const [classId, setClassId] = useState<string | null>(initialClass);
  const cls = school.classes.find((c) => c.id === classId);
  if (!school.classes.length) {
    return <Text variant="bodyMedium" style={{ color: t.app.review }}>This school has not added any classes yet. Ask your school admin.</Text>;
  }
  return (
    <View style={{ gap: 10 }}>
      <Text variant="labelLarge">Your class</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {school.classes.map((c) => (
          <Chip
            key={c.id}
            selected={c.id === classId}
            showSelectedOverlay
            onPress={() => {
              setClassId(c.id);
              if (c.sections.length === 1) onChange(c.sections[0]!.id);
            }}
          >
            {c.name}
          </Chip>
        ))}
      </View>
      {cls ? (
        <>
          <Text variant="labelLarge">Your section</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {cls.sections.map((s) => (
              <Chip key={s.id} selected={s.id === sectionId} showSelectedOverlay onPress={() => onChange(s.id)}>
                Section {s.name}
              </Chip>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}
