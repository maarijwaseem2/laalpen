import { useLocalSearchParams } from 'expo-router';
import { SubjectScreen, parentPaths } from '@/components/StudentViews';

export default function ParentSubject() {
  const { id, child } = useLocalSearchParams<{ id: string; child: string }>();
  return <SubjectScreen endpoint={`/parent/children/${child}/subjects/${id}`} queryKey={['parent', 'subject', child, id]} paths={parentPaths(child)} />;
}
