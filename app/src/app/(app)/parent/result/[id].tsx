import { useLocalSearchParams } from 'expo-router';
import { ResultScreen } from '@/components/StudentViews';

export default function ParentResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ResultScreen endpoint={`/parent/results/${id}`} queryKey={['parent', 'result', id]} parent />;
}
