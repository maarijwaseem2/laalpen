import { MD3DarkTheme, MD3LightTheme, configureFonts, type MD3Theme } from 'react-native-paper';
import { create } from 'zustand';
import { prefs } from './storage';

/**
 * LaalPen design tokens.
 * Red pen on a school copy: the teacher's red is the brand, the student's navy ink is the text,
 * and the copy's blue ruled line is the secondary colour.
 */
export const brand = {
  laal: '#C8102E',
  ink: '#1B2A4A',
  ruled: '#3D6FB6',
  paper: '#F6F7FB',
  pass: '#1F8A5B',
  review: '#B86E00',
};

const font = (family: string, size: number, line: number, letterSpacing = 0) => ({ fontFamily: family, fontSize: size, lineHeight: line, letterSpacing, fontWeight: 'normal' as const });
const R = 'Lexend_400Regular';
const M = 'Lexend_500Medium';
const S = 'Lexend_600SemiBold';
const fonts = configureFonts({
  config: {
    displayLarge: font(S, 52, 60, -0.5),
    displayMedium: font(S, 42, 50, -0.4),
    displaySmall: font(S, 34, 42, -0.3),
    headlineLarge: font(S, 30, 38, -0.3),
    headlineMedium: font(S, 26, 34, -0.2),
    headlineSmall: font(S, 22, 30, -0.1),
    titleLarge: font(M, 20, 28),
    titleMedium: font(M, 16, 24),
    titleSmall: font(M, 14, 20),
    labelLarge: font(M, 14, 20, 0.1),
    labelMedium: font(M, 12, 16, 0.2),
    labelSmall: font(M, 11, 16, 0.3),
    bodyLarge: font(R, 16, 24),
    bodyMedium: font(R, 14, 21),
    bodySmall: font(R, 12, 17),
    default: { fontFamily: R, letterSpacing: 0, fontWeight: 'normal' },
  } as any,
});

export interface AppColors {
  pass: string;
  passBg: string;
  review: string;
  reviewBg: string;
  info: string;
  infoBg: string;
  rule: string;
  paper: string;
  card: string;
  muted: string;
  pen: string;
}

export type AppTheme = MD3Theme & { app: AppColors; dark: boolean };

// Urdu: Noto Nastaliq needs much taller lines than Latin text
const UR = 'NotoNastaliqUrdu_400Regular';
const UB = 'NotoNastaliqUrdu_700Bold';
const urduFonts = configureFonts({
  config: {
    displayLarge: font(UB, 44, 96),
    displayMedium: font(UB, 36, 80),
    displaySmall: font(UB, 30, 66),
    headlineLarge: font(UB, 26, 58),
    headlineMedium: font(UB, 23, 52),
    headlineSmall: font(UB, 20, 46),
    titleLarge: font(UB, 18, 42),
    titleMedium: font(UB, 15, 36),
    titleSmall: font(UB, 13, 32),
    labelLarge: font(UR, 13, 30),
    labelMedium: font(UR, 11, 26),
    labelSmall: font(UR, 10, 24),
    bodyLarge: font(UR, 15, 36),
    bodyMedium: font(UR, 13, 32),
    bodySmall: font(UR, 11, 27),
    default: { fontFamily: UR, letterSpacing: 0, fontWeight: 'normal' },
  } as never,
});

/** Same colours, Urdu fonts. */
export const withUrdu = (t: AppTheme): AppTheme => ({ ...t, fonts: urduFonts });

export const lightTheme: AppTheme = {
  ...MD3LightTheme,
  dark: false,
  roundness: 3,
  fonts,
  colors: {
    ...MD3LightTheme.colors,
    primary: brand.laal,
    onPrimary: '#FFFFFF',
    primaryContainer: '#FDE3E6',
    onPrimaryContainer: '#5E0613',
    secondary: brand.ruled,
    onSecondary: '#FFFFFF',
    secondaryContainer: '#DCE8F8',
    onSecondaryContainer: '#0E2A55',
    tertiary: brand.pass,
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#D4F0E2',
    onTertiaryContainer: '#08361F',
    background: brand.paper,
    onBackground: brand.ink,
    surface: '#FFFFFF',
    onSurface: brand.ink,
    surfaceVariant: '#ECEFF6',
    onSurfaceVariant: '#4A5672',
    outline: '#C5CCDB',
    outlineVariant: '#DFE4EE',
    error: '#B3261E',
    elevation: { level0: 'transparent', level1: '#FFFFFF', level2: '#F9FAFD', level3: '#F3F5FA', level4: '#F0F2F8', level5: '#ECEFF6' },
  },
  app: {
    pass: brand.pass,
    passBg: '#E3F4EB',
    review: brand.review,
    reviewBg: '#FCEFD9',
    info: brand.ruled,
    infoBg: '#E6EEF9',
    rule: '#D6E2F3',
    paper: brand.paper,
    card: '#FFFFFF',
    muted: '#6B7690',
    pen: brand.laal,
  },
};

export const darkTheme: AppTheme = {
  ...MD3DarkTheme,
  dark: true,
  roundness: 3,
  fonts,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#FF6B7A',
    onPrimary: '#3F0009',
    primaryContainer: '#5C0E1A',
    onPrimaryContainer: '#FFD9DD',
    secondary: '#8FB4EC',
    onSecondary: '#0B2547',
    secondaryContainer: '#1D3A63',
    onSecondaryContainer: '#D8E6FB',
    tertiary: '#6FD3A2',
    onTertiary: '#003920',
    tertiaryContainer: '#0E4F31',
    onTertiaryContainer: '#C9F2DC',
    background: '#0F1420',
    onBackground: '#E4E8F1',
    surface: '#171E2E',
    onSurface: '#E4E8F1',
    surfaceVariant: '#222B3F',
    onSurfaceVariant: '#AEB8CE',
    outline: '#3A4560',
    outlineVariant: '#2A3349',
    elevation: { level0: 'transparent', level1: '#171E2E', level2: '#1B2335', level3: '#1F283B', level4: '#212B3F', level5: '#243046' },
  },
  app: {
    pass: '#6FD3A2',
    passBg: '#123A28',
    review: '#F2B35A',
    reviewBg: '#3D2C0F',
    info: '#8FB4EC',
    infoBg: '#1B2C47',
    rule: '#26314A',
    paper: '#0F1420',
    card: '#171E2E',
    muted: '#8E99B3',
    pen: '#FF6B7A',
  },
};

/** Light by default; the moon/sun button switches and remembers the choice. */
export const useThemeMode = create<{ dark: boolean; ready: boolean; toggle: () => void; load: () => Promise<void> }>((set, get) => ({
  dark: false,
  ready: false,
  toggle() {
    const dark = !get().dark;
    set({ dark });
    void prefs.set('laalpen.dark', dark ? '1' : '0');
  },
  async load() {
    set({ dark: (await prefs.get('laalpen.dark')) === '1', ready: true });
  },
}));

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };
export const PEN_FONT = 'Caveat_700Bold';
