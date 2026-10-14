import { STUDENT_PATHS, StudentDashboard } from '@/components/StudentViews';

export default function StudentHome() {
  return <StudentDashboard endpoint="/student/dashboard" queryKey={['student', 'dashboard']} paths={STUDENT_PATHS} />;
}
