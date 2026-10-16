import Constants from 'expo-constants';
import { getApps, initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, signInWithCredential, signInWithPopup } from 'firebase/auth';
import { Platform } from 'react-native';
import { firebaseConfig, googleEnabled, googleWebClientId } from './config';

export class GoogleCancelled extends Error {}

/**
 * Signs in with Google through Firebase and returns a Firebase ID token for our backend.
 * Web: Google popup. Android/iOS: native Google account picker (needs the development build, not Expo Go).
 */
export async function googleIdToken(): Promise<string> {
  if (!googleEnabled) throw new Error('Google login is not set up yet. Add the Firebase keys in app/.env.');
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  const auth = getAuth(app);

  if (Platform.OS === 'web') {
    try {
      const r = await signInWithPopup(auth, new GoogleAuthProvider());
      return r.user.getIdToken();
    } catch (e: any) {
      if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') throw new GoogleCancelled();
      throw new Error('Google sign-in failed. Please try again.');
    }
  }

  if (Constants.executionEnvironment === 'storeClient') {
    throw new Error('Google login needs the LaalPen development build (npx expo run:android). It does not work inside Expo Go.');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GoogleSignin, isSuccessResponse } = require('@react-native-google-signin/google-signin');
  const { statusCodes } = require('@react-native-google-signin/google-signin');
  GoogleSignin.configure({ webClientId: googleWebClientId });
  let idToken: string | undefined;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res) || !res.data?.idToken) throw new GoogleCancelled();
    idToken = res.data.idToken;
  } catch (e: any) {
    if (e instanceof GoogleCancelled || e?.code === statusCodes?.SIGN_IN_CANCELLED || e?.code === statusCodes?.IN_PROGRESS) throw new GoogleCancelled();
    if (e?.code === statusCodes?.PLAY_SERVICES_NOT_AVAILABLE) throw new Error('Google login needs Google Play services on this phone. Please log in with your email and password.');
    // DEVELOPER_ERROR (10): this app's signing certificate (SHA-1) is not registered in Firebase yet
    if (String(e?.code) === '10' || /DEVELOPER_ERROR/i.test(String(e?.message))) throw new Error('Google login is not switched on for this app yet. Please log in with your email and password.');
    throw new Error('Google sign-in failed. Please try again or use your email and password.');
  }
  try {
    const cred = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    return cred.user.getIdToken();
  } catch {
    throw new Error('Google sign-in failed. Please try again or use your email and password.');
  }
}
