import { I18nManager, Platform } from 'react-native';
import { create } from 'zustand';
import { prefs } from './storage';

export type Lang = 'en' | 'ur';
const KEY = 'laalpen.lang';

/**
 * English / اردو. Strings are written in English in the code and looked up here; anything not yet
 * translated simply stays English. Parents and students see the most-used screens in Urdu.
 * Urdu is right-to-left and uses the Noto Nastaliq Urdu font.
 */
const UR: Record<string, string> = {
  // navigation
  Home: 'ہوم',
  Dashboard: 'ڈیش بورڈ',
  Insights: 'جائزہ',
  Classes: 'کلاسیں',
  Teachers: 'اساتذہ',
  Students: 'طلبہ',
  'School year': 'تعلیمی سال',
  Subjects: 'مضامین',
  'Join requests': 'شمولیت کی درخواستیں',
  'Activity log': 'سرگرمی کا ریکارڈ',
  'My classes': 'میری کلاسیں',
  'My children': 'میرے بچے',
  Notifications: 'اطلاعات',
  Profile: 'پروفائل',
  More: 'مزید',
  // sign in
  'Starting the LaalPen server… the first visit can take up to a minute.': 'لال پین سرور شروع ہو رہا ہے… پہلی بار ایک منٹ تک لگ سکتا ہے۔',
  'Log in': 'لاگ اِن',
  Email: 'ای میل',
  Password: 'پاس ورڈ',
  'Forgot password?': 'پاس ورڈ بھول گئے؟',
  'Continue with Google': 'گوگل کے ساتھ جاری رکھیں',
  'Sign in with a passkey': 'پاس کی سے سائن اِن',
  'Parent? Sign in with your mobile number': 'والدین؟ اپنے موبائل نمبر سے سائن اِن کریں',
  'New here?': 'نئے ہیں؟',
  'Sign up as student or school': 'طالب علم یا اسکول کے طور پر رجسٹر ہوں',
  'Teachers, students and school admins use the same login.': 'اساتذہ، طلبہ اور اسکول ایڈمن ایک ہی لاگ اِن استعمال کرتے ہیں۔',
  'Parent login': 'والدین کا لاگ اِن',
  'Use the mobile number you gave the school. We send a code by SMS or WhatsApp.': 'وہی موبائل نمبر لکھیں جو اسکول کو دیا تھا۔ ہم SMS یا واٹس ایپ پر کوڈ بھیجیں گے۔',
  'Mobile number': 'موبائل نمبر',
  '6-digit code': '6 ہندسوں کا کوڈ',
  'Send code': 'کوڈ بھیجیں',
  'Open my children’s results': 'میرے بچوں کے نتائج کھولیں',
  'Use another number': 'دوسرا نمبر استعمال کریں',
  'Number not working? Ask the school to update it, or for a parent code card.': 'نمبر کام نہیں کر رہا؟ اسکول سے نمبر درست کروائیں یا والدین کا کوڈ کارڈ لیں۔',
  'Teacher, student or admin?': 'استاد، طالب علم یا ایڈمن؟',
  'Log in with email': 'ای میل سے لاگ اِن',
  // student / parent home
  'Good morning': 'صبح بخیر',
  'Good afternoon': 'سہ پہر بخیر',
  'Good evening': 'شام بخیر',
  Welcome: 'خوش آمدید',
  Average: 'اوسط',
  'Best result': 'بہترین نتیجہ',
  'Checked tests': 'چیک شدہ ٹیسٹ',
  'Recent results': 'حالیہ نتائج',
  'No results yet': 'ابھی کوئی نتیجہ نہیں',
  'When the teacher checks and publishes a test, the marks and the checked copy appear here.': 'جب استاد ٹیسٹ چیک کر کے شائع کریں گے تو نمبر اور چیک شدہ کاپی یہاں نظر آئے گی۔',
  'Percent per test. Green 60% and above, amber 40–59%, red below 40%.': 'ہر ٹیسٹ کا فیصد۔ سبز 60% یا زیادہ، پیلا 40–59%، سرخ 40% سے کم۔',
  'Add child': 'بچہ شامل کریں',
  'Add a child': 'بچہ شامل کریں',
  Add: 'شامل کریں',
  'Parent code from the school': 'اسکول کا دیا ہوا والدین کا کوڈ',
  'Use this when the school has a different number on file.': 'جب اسکول کے ریکارڈ میں کوئی اور نمبر ہو تو یہ استعمال کریں۔',
  'No children linked yet': 'ابھی کوئی بچہ منسلک نہیں',
  'Ask the school to add your mobile number to your child’s record, or use the parent code card.': 'اسکول سے کہیں کہ آپ کا موبائل نمبر بچے کے ریکارڈ میں شامل کریں، یا والدین کا کوڈ کارڈ استعمال کریں۔',
  'Enter parent code': 'والدین کا کوڈ لکھیں',
  'Child added': 'بچہ شامل ہو گیا',
  'Your children’s checked copies and results': 'آپ کے بچوں کی چیک شدہ کاپیاں اور نتائج',
  // result
  'Checked copy': 'چیک شدہ کاپی',
  Share: 'شیئر کریں',
  'Share with family': 'گھر والوں کو بھیجیں',
  'A voice note from the teacher': 'استاد کا صوتی پیغام',
  Listen: 'سنیں',
  Pause: 'روکیں',
  'No checked tests yet': 'ابھی کوئی چیک شدہ ٹیسٹ نہیں',
  'Results appear here once the teacher publishes them.': 'استاد کے شائع کرنے کے بعد نتائج یہاں آئیں گے۔',
  Teacher: 'استاد',
  // pending
  'Waiting for your teacher': 'آپ کے استاد کا انتظار',
  'Your details did not match': 'آپ کی تفصیلات میل نہیں کھائیں',
  'Check again': 'دوبارہ دیکھیں',
  'Log out': 'لاگ آؤٹ',
  'Have a code card from your teacher?': 'کیا استاد نے کوڈ کارڈ دیا ہے؟',
  'Code on the card': 'کارڈ پر لکھا کوڈ',
  'Link with card': 'کارڈ سے منسلک کریں',
  'Send request again': 'درخواست دوبارہ بھیجیں',
  'Roll number': 'رول نمبر',
  // sign up
  'Join your school': 'اپنے اسکول میں شامل ہوں',
  'I am a student': 'میں طالب علم ہوں',
  'New school': 'نیا اسکول',
  'Class code': 'کلاس کوڈ',
  'School card': 'اسکول کارڈ',
  'Find my class': 'میری کلاس تلاش کریں',
  'Create my account': 'میرا اکاؤنٹ بنائیں',
  'Your full name *': 'آپ کا پورا نام *',
  'Roll number *': 'رول نمبر *',
  'Date of birth': 'تاریخ پیدائش',
  'Already have an account?': 'پہلے سے اکاؤنٹ ہے؟',
  // profile
  'Dark mode': 'ڈارک موڈ',
  Language: 'زبان',
  'Edit name and phone': 'نام اور فون تبدیل کریں',
  'Change password': 'پاس ورڈ تبدیل کریں',
  'Signed in now': 'ابھی سائن اِن آلات',
  'Sign out': 'سائن آؤٹ',
  Parent: 'والدین',
  'Restart the app to finish switching the text direction.': 'تحریر کی سمت مکمل بدلنے کے لیے ایپ دوبارہ کھولیں۔',
  // roles & sign-in (2026-10)
  "Enter your school email": "اپنی اسکول والی ای میل لکھیں",
  "Enter your email or mobile number and password": "اپنی ای میل یا موبائل نمبر اور پاس ورڈ لکھیں",
  "Principals and teachers do not use a password. Tap “Email me a sign-in code”.": "پرنسپل اور اساتذہ پاس ورڈ استعمال نہیں کرتے۔ ”مجھے سائن اِن کوڈ ای میل کریں“ دبائیں۔",
  "No account uses this Google email yet.": "اس گوگل ای میل سے ابھی کوئی اکاؤنٹ نہیں بنا۔",
  "Passkey sign-in is paused after 3 failed tries. Sign in with the emailed code (staff) or your password to turn it back on.": "3 ناکام کوششوں کے بعد پاس کی سے سائن اِن روک دیا گیا ہے۔ دوبارہ چالو کرنے کے لیے ای میل کوڈ (اسٹاف) یا اپنے پاس ورڈ سے سائن اِن کریں۔",
  "or": "یا",
  "Who is signing in?": "کون سائن اِن کر رہا ہے؟",
  "Staff": "اسٹاف",
  "Principal / Teacher": "پرنسپل / استاد",
  "Sign in with a code sent to your email": "ای میل پر آنے والے کوڈ سے سائن اِن",
  "Parent / Student": "والدین / طالب علم",
  "See checked copies and results": "چیک شدہ کاپیاں اور نتائج دیکھیں",
  "Email or mobile number + password": "ای میل یا موبائل نمبر + پاس ورڈ",
  "New parent or student?": "نئے والدین یا طالب علم؟",
  "Create an account": "اکاؤنٹ بنائیں",
  "Schools are added by LaalPen. Principals get an invite email.": "اسکول لال پین شامل کرتا ہے۔ پرنسپل کو دعوتی ای میل ملتی ہے۔",
  "Staff log in": "اسٹاف لاگ اِن",
  "Parent / Student log in": "والدین / طالب علم لاگ اِن",
  "Principal / Teacher — no password needed.": "پرنسپل / استاد — پاس ورڈ کی ضرورت نہیں۔",
  "Use the email or mobile number you signed up with.": "وہی ای میل یا موبائل نمبر لکھیں جس سے اکاؤنٹ بنایا تھا۔",
  "Not staff? Parent / Student": "اسٹاف نہیں؟ والدین / طالب علم",
  "Staff? Principal / Teacher": "اسٹاف؟ پرنسپل / استاد",
  "School email": "اسکول والی ای میل",
  "Email me a sign-in code": "مجھے سائن اِن کوڈ ای میل کریں",
  "We email a 6-digit code every time you sign in. It works once and expires in 10 minutes.": "ہر بار سائن اِن پر ہم 6 ہندسوں کا کوڈ ای میل کرتے ہیں۔ یہ ایک ہی بار چلتا ہے اور 10 منٹ میں ختم ہو جاتا ہے۔",
  "Google works only for staff your school already added, with the same email.": "گوگل صرف اُس اسٹاف کے لیے ہے جسے اسکول نے اسی ای میل سے پہلے ہی شامل کیا ہو۔",
  "Email or mobile number": "ای میل یا موبائل نمبر",
  "Create a Parent / Student account with this Google email": "اس گوگل ای میل سے والدین / طالب علم کا اکاؤنٹ بنائیں",
  "Create a Parent / Student account": "والدین / طالب علم کا اکاؤنٹ بنائیں",
  "Enter the 6-digit code from the email": "ای میل والا 6 ہندسوں کا کوڈ لکھیں",
  "Open the link from the email again, or go back and type your email.": "ای میل والا لنک دوبارہ کھولیں، یا واپس جا کر اپنی ای میل لکھیں۔",
  "New code sent": "نیا کوڈ بھیج دیا گیا",
  "Check your email": "اپنی ای میل دیکھیں",
  "If this email belongs to LaalPen staff, we sent a 6-digit sign-in code to": "اگر یہ ای میل لال پین اسٹاف کی ہے تو ہم نے 6 ہندسوں کا سائن اِن کوڈ بھیجا ہے:",
  "Demo school account: emails are not sent. Your code is": "ڈیمو اسکول اکاؤنٹ: ای میل نہیں جاتی۔ آپ کا کوڈ ہے",
  "Use this code": "یہ کوڈ استعمال کریں",
  "Sign in": "سائن اِن",
  "Send a new code in": "نیا کوڈ بھیجیں، باقی وقت",
  "Send a new code": "نیا کوڈ بھیجیں",
  "No email? Check spam, or ask your principal to check the email address on your account.": "ای میل نہیں آئی؟ اسپام دیکھیں، یا پرنسپل سے اپنے اکاؤنٹ کی ای میل چیک کروائیں۔",
  "Back to log in": "واپس لاگ اِن پر",
  "Enter your name": "اپنا نام لکھیں",
  "Enter a valid email. We send a code to check it.": "درست ای میل لکھیں۔ تصدیق کے لیے ہم کوڈ بھیجیں گے۔",
  "Enter a mobile number like 0300 1234567, or leave it empty": "موبائل نمبر جیسے 0300 1234567 لکھیں، یا خالی چھوڑ دیں",
  "Password must be at least 8 characters": "پاس ورڈ کم از کم 8 حروف کا ہو",
  "See your child’s checked copies and results. After signing up, add your child with the code from the school.": "اپنے بچے کی چیک شدہ کاپیاں اور نتائج دیکھیں۔ اکاؤنٹ بنانے کے بعد اسکول کے کوڈ سے بچہ شامل کریں۔",
  "Your name *": "آپ کا نام *",
  "Email *": "ای میل *",
  "Mobile number (optional)": "موبائل نمبر (اختیاری)",
  "Password *": "پاس ورڈ *",
  "At least 8 characters. You can sign in with your email or mobile number.": "کم از کم 8 حروف۔ آپ ای میل یا موبائل نمبر سے سائن اِن کر سکتے ہیں۔",
  "Sign up with Google": "گوگل سے اکاؤنٹ بنائیں",
  "Principals and teachers do not sign up here: LaalPen or your principal sends you an invite.": "پرنسپل اور اساتذہ یہاں اکاؤنٹ نہیں بناتے: لال پین یا آپ کے پرنسپل آپ کو دعوت بھیجتے ہیں۔",
  "Email verified. Welcome to LaalPen!": "ای میل کی تصدیق ہو گئی۔ لال پین میں خوش آمدید!",
  "We sent a 6-digit code to": "ہم نے 6 ہندسوں کا کوڈ بھیجا ہے:",
  "your email": "آپ کی ای میل",
  "It expires in 10 minutes.": "یہ 10 منٹ میں ختم ہو جائے گا۔",
  "Verification code": "تصدیقی کوڈ",
  "Verify email": "ای میل کی تصدیق کریں",
  "Type the code from the school, e.g. ALN-9A": "اسکول کا دیا ہوا کوڈ لکھیں، مثلاً ALN-9A",
  "Enter your child’s full name": "بچے کا پورا نام لکھیں",
  "Enter the roll number": "رول نمبر لکھیں",
  "Choose the class and section": "کلاس اور سیکشن چنیں",
  "Write the date of birth like 05/03/2014": "تاریخ پیدائش ایسے لکھیں: 05/03/2014",
  "Sent to the class teacher. You get a notification when it is confirmed.": "کلاس ٹیچر کو بھیج دیا گیا۔ تصدیق ہونے پر آپ کو اطلاع ملے گی۔",
  "Enter your child’s name and roll number": "بچے کا نام اور رول نمبر لکھیں",
  "Class code or card code": "کلاس کوڈ یا کارڈ کوڈ",
  "The class code is like ALN-9A (from the teacher or school). A card code is like K7QP-3MXA (printed card). We work out which one it is.": "کلاس کوڈ ALN-9A جیسا ہوتا ہے (استاد یا اسکول سے)۔ کارڈ کوڈ K7QP-3MXA جیسا ہوتا ہے (چھپا ہوا کارڈ)۔ کون سا ہے، یہ ہم خود پہچان لیتے ہیں۔",
  "Child’s full name *": "بچے کا پورا نام *",
  "Date of birth (DD/MM/YYYY)": "تاریخ پیدائش (دن/مہینہ/سال)",
  "With the right name and date of birth it links at once. Otherwise the class teacher confirms it.": "صحیح نام اور تاریخ پیدائش سے بچہ فوراً شامل ہو جاتا ہے، ورنہ کلاس ٹیچر تصدیق کرتے ہیں۔",
  "Cancel": "منسوخ",
  "Yes, add this child": "ہاں، یہ بچہ شامل کریں",
  "Next": "آگے",
  "Enter the school name": "اسکول کا نام لکھیں",
  "Enter the school address": "اسکول کا پتہ لکھیں",
  "Enter the city": "شہر لکھیں",
  "Enter the school phone number, e.g. 021 34567890": "اسکول کا فون نمبر لکھیں، مثلاً 021 34567890",
  "Add at least one class with a section": "کم از کم ایک کلاس اور سیکشن شامل کریں",
  "Every class needs at least one section, e.g. A": "ہر کلاس کا کم از کم ایک سیکشن ہو، مثلاً A",
  "The logo must be an https:// link": "لوگو https:// والا لنک ہو",
  "School profile saved": "اسکول پروفائل محفوظ ہو گیا",
  "Step 1 of 2 — your school": "مرحلہ 1 از 2 — آپ کا اسکول",
  "School profile": "اسکول پروفائل",
  "You are the principal. Fill in your school’s details and classes. Next, you add your teachers.": "آپ پرنسپل ہیں۔ اسکول کی تفصیل اور کلاسیں لکھیں۔ اس کے بعد اپنے اساتذہ شامل کریں۔",
  "School details": "اسکول کی تفصیل",
  "School name *": "اسکول کا نام *",
  "Address *": "پتہ *",
  "City *": "شہر *",
  "School phone *": "اسکول کا فون *",
  "Board (optional)": "بورڈ (اختیاری)",
  "Logo link (optional)": "لوگو کا لنک (اختیاری)",
  "Classes and sections": "کلاسیں اور سیکشن",
  "One row per class. Sections separated by commas, e.g. A, B, C. You can add more later.": "ہر کلاس کی ایک لائن۔ سیکشن کوما سے الگ کریں، مثلاً A, B, C۔ بعد میں مزید شامل کر سکتے ہیں۔",
  "Class": "کلاس",
  "Sections": "سیکشن",
  "Add class": "کلاس شامل کریں",
  "Subjects (optional)": "مضامین (اختیاری)",
  "Subjects, separated by commas": "مضامین، کوما سے الگ",
  "Teachers also add the subjects they teach in their profile.": "اساتذہ بھی اپنی پروفائل میں اپنے مضامین شامل کرتے ہیں۔",
  "Save": "محفوظ کریں",
  "Save and continue": "محفوظ کر کے آگے بڑھیں",
  "Your principal approved your profile. Welcome!": "پرنسپل نے آپ کی پروفائل منظور کر دی۔ خوش آمدید!",
  "Choose class": "کلاس چنیں",
  "Enter your full name": "اپنا پورا نام لکھیں",
  "Enter your mobile number, e.g. 0300 1234567": "اپنا موبائل نمبر لکھیں، مثلاً 0300 1234567",
  "Enter your education, e.g. MSc Physics, B.Ed": "اپنی تعلیم لکھیں، مثلاً MSc Physics، B.Ed",
  "Choose at least one class and its subject, e.g. 9-A Maths": "کم از کم ایک کلاس اور اس کا مضمون چنیں، مثلاً 9-A ریاضی",
  "Sent to your principal for approval": "منظوری کے لیے پرنسپل کو بھیج دیا گیا",
  "Your teacher profile": "آپ کی استاد پروفائل",
  "Waiting for principal approval": "پرنسپل کی منظوری کا انتظار",
  "Your profile was sent. Student lists and copies open as soon as your principal approves it. We will email you and show a notification.": "آپ کی پروفائل بھیج دی گئی۔ پرنسپل کی منظوری کے فوراً بعد طلبہ کی فہرست اور کاپیاں کھل جائیں گی۔ ہم آپ کو ای میل اور اطلاع بھیجیں گے۔",
  "Change my profile": "میری پروفائل تبدیل کریں",
  "Teacher profile": "استاد کی پروفائل",
  "Your principal asked for changes": "پرنسپل نے تبدیلی کا کہا ہے",
  "complete your profile. Your principal checks it before your classes open.": "اپنی پروفائل مکمل کریں۔ کلاسیں کھلنے سے پہلے پرنسپل اسے چیک کریں گے۔",
  "Full name *": "پورا نام *",
  "Mobile number *": "موبائل نمبر *",
  "Qualification *": "تعلیمی قابلیت *",
  "Subjects you teach": "آپ کے مضامین",
  "Your classes": "آپ کی کلاسیں",
  "For each class and section, the subject you teach there.": "ہر کلاس اور سیکشن کے لیے وہ مضمون جو آپ وہاں پڑھاتے ہیں۔",
  "Your school has no classes yet. Ask your principal to add them.": "آپ کے اسکول میں ابھی کلاسیں نہیں ہیں۔ پرنسپل سے شامل کروائیں۔",
  "Subject": "مضمون",
  "Add another class": "ایک اور کلاس شامل کریں",
  "Send to principal for approval": "منظوری کے لیے پرنسپل کو بھیجیں",
  "Type the class code (e.g. ALN-9A) or the card code from the school.": "کلاس کوڈ (مثلاً ALN-9A) یا اسکول کا کارڈ کوڈ لکھیں۔",
  "waiting for the class teacher to confirm": "کلاس ٹیچر کی تصدیق کا انتظار",
  "not confirmed": "تصدیق نہیں ہوئی",
  "Schools": "اسکول",
};

const isRtl = (l: Lang) => l === 'ur';

function applyDirection(lang: Lang) {
  if (Platform.OS === 'web') {
    const el = globalThis.document?.documentElement;
    if (el) {
      el.setAttribute('dir', isRtl(lang) ? 'rtl' : 'ltr');
      el.setAttribute('lang', lang);
    }
    return false;
  }
  const want = isRtl(lang);
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== want) {
    I18nManager.forceRTL(want);
    return true; // takes effect on the next app start
  }
  return false;
}

export const useLang = create<{ lang: Lang; ready: boolean; load: () => Promise<void>; set: (l: Lang) => boolean }>((set) => ({
  lang: 'en',
  ready: false,
  async load() {
    const v = (await prefs.get(KEY)) as Lang | null;
    const lang: Lang = v === 'ur' ? 'ur' : 'en';
    applyDirection(lang);
    set({ lang, ready: true });
  },
  set(lang) {
    set({ lang });
    void prefs.set(KEY, lang);
    return applyDirection(lang);
  },
}));

export const translate = (lang: Lang, s: string) => (lang === 'ur' ? (UR[s] ?? s) : s);

/** const t = useT(); t('Log in') */
export function useT() {
  const lang = useLang((s) => s.lang);
  return (s: string) => translate(lang, s);
}

export const URDU_KEYS = Object.keys(UR);
