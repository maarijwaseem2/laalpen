import { Caveat_700Bold } from '@expo-google-fonts/caveat';
import { Lexend_400Regular, Lexend_500Medium, Lexend_600SemiBold, useFonts } from '@expo-google-fonts/lexend';
import { NotoNastaliqUrdu_400Regular, NotoNastaliqUrdu_700Bold } from '@expo-google-fonts/noto-nastaliq-urdu';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Toaster } from '@/components/feedback';
import { StepUpDialog, askStepUp } from '@/components/StepUp';
import { useAuth } from '@/lib/auth';
import { setMfaSetupHandler, setStepUpHandler } from '@/lib/api';
import { queryClient } from '@/lib/query';
import { darkTheme, lightTheme, useThemeMode, withUrdu } from '@/lib/theme';
import { useLang } from '@/lib/i18n';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

// sensitive actions: ask for the password / authenticator code, then the request is retried
setStepUpHandler(askStepUp);

// the server says an admin must set up the authenticator app first
setMfaSetupHandler(() => {
  const { user, setUser } = useAuth.getState();
  if (user && !user.mfaSetupRequired) setUser({ ...user, mfaSetupRequired: true });
  router.replace('/security/two-factor');
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Lexend_400Regular, Lexend_500Medium, Lexend_600SemiBold, Caveat_700Bold, NotoNastaliqUrdu_400Regular, NotoNastaliqUrdu_700Bold, ...MaterialCommunityIcons.font });
  const { dark, ready: themeReady, load: loadTheme } = useThemeMode();
  const { ready: authReady, load: loadAuth } = useAuth();
  const { lang, ready: langReady, load: loadLang } = useLang();

  useEffect(() => {
    void loadTheme();
    void loadAuth();
    void loadLang();
  }, [loadTheme, loadAuth, loadLang]);

  const ready = fontsLoaded && themeReady && authReady && langReady;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  if (!ready) return null;

  const base = dark ? darkTheme : lightTheme;
  const theme = lang === 'ur' ? withUrdu(base) : base;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <PaperProvider theme={theme} settings={{ icon: (p) => <MaterialCommunityIcons {...(p as any)} /> }}>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }} />
          <Toaster />
          <StepUpDialog />
        </PaperProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
