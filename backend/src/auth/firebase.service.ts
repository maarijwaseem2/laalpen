import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from '../config/env.js';

/**
 * Verifies Firebase ID tokens from "Sign in with Google".
 * Only FIREBASE_PROJECT_ID is needed — no service-account key.
 */
@Injectable()
export class FirebaseService {
  private readonly log = new Logger('Firebase');

  async verifyGoogleToken(idToken: string): Promise<{ email: string; uid: string; name?: string }> {
    if (env.isTest && idToken.startsWith('test-google:')) {
      const email = idToken.slice('test-google:'.length);
      return { email, uid: `uid-${email}` };
    }
    if (!env.firebaseProjectId) throw new ServiceUnavailableException('Google login is not configured on the server');
    if (!getApps().length) initializeApp({ projectId: env.firebaseProjectId });
    try {
      const t = await getAuth().verifyIdToken(idToken);
      if (!t.email || !t.email_verified) throw new Error('Google email not verified');
      return { email: t.email.toLowerCase(), uid: t.uid, name: t.name as string | undefined };
    } catch (e) {
      this.log.warn(`Google token rejected: ${(e as Error).message}`);
      throw new UnauthorizedException('Google sign-in failed, please try again');
    }
  }
}
