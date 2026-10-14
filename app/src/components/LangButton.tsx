import { Button } from 'react-native-paper';
import { toast } from './feedback';
import { translate, useLang } from '@/lib/i18n';

/** English ⇄ اردو. On phones the right-to-left layout fully applies after the app restarts. */
export function LangButton({ style }: { style?: object }) {
  const { lang, set } = useLang();
  const next = lang === 'ur' ? 'en' : 'ur';
  return (
    <Button
      compact
      icon="translate"
      style={style}
      accessibilityLabel={lang === 'ur' ? 'Switch to English' : 'اردو میں دیکھیں'}
      onPress={() => {
        if (set(next)) toast(translate(next, 'Restart the app to finish switching the text direction.'));
      }}
    >
      {lang === 'ur' ? 'English' : 'اردو'}
    </Button>
  );
}
