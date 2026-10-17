export type Role = 'SUPER_ADMIN' | 'PRINCIPAL' | 'TEACHER' | 'STUDENT' | 'PARENT';
export type TeacherStatus = 'PROFILE_INCOMPLETE' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type SubmissionStatus = 'PENDING' | 'PROCESSING' | 'CHECKED' | 'NEEDS_REVIEW' | 'APPROVED' | 'FAILED' | 'NEEDS_ATTENTION';
export type ReviewState = 'SURE' | 'CHECK' | 'UNREADABLE';
export type QuestionType = 'THEORY' | 'NUMERIC' | 'MCQ';
export type KeyStatus = 'DRAFT' | 'CONFIRMED';
export type TestStatus = 'DRAFT' | 'ACTIVE' | 'PUBLISHED';

export interface User {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  role: Role;
  emailVerified: boolean;
  twoFactor?: boolean;
  passkeys?: number;
  mfaSetupRequired?: boolean;
  /** principal, teacher or super admin: signs in with an emailed code / passkey / Google, never a password */
  staff?: boolean;
  usesPassword?: boolean;
  hasPassword?: boolean;
  passkeyBlocked?: boolean;
  school: {
    id: string; name: string; city?: string | null; board?: string | null; joinCode?: string;
    address?: string | null; phone?: string | null; logoUrl?: string | null; profileComplete?: boolean; suspended?: boolean;
  } | null;
  /** a teacher's own profile approval */
  teacher?: { status: TeacherStatus; rejectReason: string | null } | null;
  /** the roster student this account is linked to */
  student: { id: string; name?: string; rollNo: string; sectionId: string; sectionName?: string; className?: string; status: 'APPROVED' } | null;
  /** a student account that is not linked to the roster yet */
  claim?: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; rejectReason: string | null; rollNo: string; className?: string; sectionName?: string; sectionId: string } | null;
  parent?: { guardians: number } | null;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface Counts {
  uploaded: number;
  pending: number;
  checked: number;
  review: number;
  approved: number;
  failed: number;
  attention: number;
}

/** Login needs a second step (authenticator code or emailed new-device code). */
export interface Challenge {
  mfaRequired: true;
  kind: 'TOTP' | 'EMAIL_DEVICE';
  challengeId: string;
  email?: string;
}

export const isChallenge = (r: Session | Challenge): r is Challenge => (r as Challenge).mfaRequired === true;

export interface KeyStep { marks: number; description: string }
export interface KeyRule { id: string; text: string }
export interface KeyQuestion {
  id?: string;
  number: number;
  text: string;
  maxMarks: number;
  answerKey: string;
  type: QuestionType;
  finalAnswer: string | null;
  alternatives: string[];
  steps: KeyStep[];
  rules: KeyRule[];
  options: string[];
  topic: string | null;
}

export interface Problem {
  id: string;
  type: string;
  pageNo: number | null;
  details: string;
  submissionId?: string;
  studentName?: string;
  rollNo?: string;
  status?: SubmissionStatus;
}

export interface Notification {
  id: string;
  type: 'INFO' | 'ACCOUNT' | 'CHECKING' | 'RESULT';
  title: string;
  body: string;
  data?: Record<string, string> | null;
  readAt: string | null;
  createdAt: string;
}
