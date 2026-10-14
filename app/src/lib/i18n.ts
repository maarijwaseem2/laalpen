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
