import { useLocalSearchParams } from 'expo-router';
import { STUDENT_PATHS, SubjectScreen } from '@/components/StudentViews';

export default function StudentSubject() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SubjectScreen endpoint={`/student/subjects/${id}`} queryKey={['student', 'subject', id]} paths={STUDENT_PATHS} />;
}
