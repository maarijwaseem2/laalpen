import type { ExpoConfig } from 'expo/config';

const iosGoogleScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;

const config: ExpoConfig = {
  name: 'LaalPen',
  slug: 'laalpen',
  scheme: 'laalpen',
  version: '1.0.0',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: { supportsTablet: true, bundleIdentifier: 'pk.laalpen.app' },
  android: {
    package: 'pk.laalpen.app',
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#C8102E' },
  },
  web: { bundler: 'metro', output: 'single', favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    'expo-font',
    ['expo-splash-screen', { image: './assets/splash-mark.png', imageWidth: 180, resizeMode: 'contain', backgroundColor: '#F6F7FB', dark: { backgroundColor: '#0F1420' } }],
    'expo-secure-store',
    ['expo-image-picker', { cameraPermission: 'LaalPen uses the camera to photograph answer copies.', photosPermission: 'LaalPen uses your photos to upload answer copies.' }],
    ['expo-notifications', { color: '#C8102E' }],
    ['expo-audio', { microphonePermission: 'LaalPen records short voice notes for students when you allow it.' }],
    ...(iosGoogleScheme ? [['@react-native-google-signin/google-signin', { iosUrlScheme: iosGoogleScheme }] as [string, object]] : []),
  ],
  experiments: { typedRoutes: false },
};

export default config;
