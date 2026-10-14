import { useLocalSearchParams } from 'expo-router';
import { ResultScreen } from '@/components/StudentViews';

export default function StudentResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ResultScreen endpoint={`/student/results/${id}`} queryKey={['student', 'result', id]} />;
}
