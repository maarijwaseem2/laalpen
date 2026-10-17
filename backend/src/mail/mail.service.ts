import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env.js';

interface MailInput {
  to: string;
  toName?: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  code?: string;
  button?: { label: string; url: string };
}

/**
 * Sends email through Brevo (free plan: 300 emails/day).
 * Without BREVO_API_KEY the email is printed to the console, so development works with no account.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  /** Last emails sent — used by automated tests. */
  readonly outbox: { to: string; subject: string; code?: string }[] = [];

  async send(input: MailInput): Promise<void> {
    this.outbox.push({ to: input.to, subject: input.subject, code: input.code });
    if (this.outbox.length > 50) this.outbox.shift();

    const consoleLine = () => this.log.log(`[console email] to=${input.to} subject="${input.subject}"${input.code ? ` code=${input.code}` : ''}`);
    // demo/test addresses (*.demo, *.test, example.com …) can never receive mail: sending them through Brevo
    // only bounces and hurts the sender's reputation, so they stay in the console like development mail
    if (!env.brevoApiKey || undeliverable(input.to)) {
      consoleLine();
      return;
    }
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: env.mailFromEmail, name: env.mailFromName },
          to: [{ email: input.to, name: input.toName }],
          subject: input.subject,
          htmlContent: this.render(input),
        }),
      });
      if (!res.ok) {
        this.log.error(`Brevo error ${res.status}: ${await res.text()}`);
        if (!env.isProd) consoleLine(); // development: the code is still usable from the log
      }
    } catch (e) {
      this.log.error(`Brevo request failed: ${(e as Error).message}`);
      if (!env.isProd) consoleLine();
    }
  }

  sendOtp(to: string, name: string, code: string, purpose: 'verify' | 'reset' | 'device', link?: string) {
    const verify = purpose === 'verify';
    if (purpose === 'device') {
      return this.send({
        to,
        toName: name,
        subject: `${code} — confirm your new sign-in to LaalPen`,
        heading: 'Is this you signing in?',
        paragraphs: [
          `Assalam o Alaikum ${name},`,
          'Someone signed in to your LaalPen account with the correct password from a phone or computer we have not seen before.',
          `If it was you, enter this code there. It expires in ${env.otpTtlMinutes} minutes.`,
          'If it was NOT you, do not share the code and change your password now.',
        ],
        code,
      });
    }
    return this.send({
      to,
      toName: name,
      subject: verify ? `${code} is your LaalPen verification code` : `${code} is your LaalPen password reset code`,
      heading: verify ? 'Verify your email' : 'Reset your password',
      paragraphs: [
        `Assalam o Alaikum ${name},`,
        verify
          ? 'Use this code to verify your email address and activate your LaalPen account.'
          : 'Use this code to set a new password for your LaalPen account.',
        `The code expires in ${env.otpTtlMinutes} minutes. If you did not request it, you can ignore this email.`,
      ],
      code,
      button: verify && link ? { label: 'Verify my email', url: link } : undefined,
    });
  }

  /** Staff sign-in: a one-time code plus a link that signs in on the device that opens it. */
  loginCode(to: string, name: string, code: string, link: string, purpose: 'login' | 'step-up' = 'login') {
    const login = purpose === 'login';
    return this.send({
      to,
      toName: name,
      subject: login ? `${code} is your LaalPen sign-in code` : `${code} confirms your LaalPen action`,
      heading: login ? 'Your sign-in code' : 'Confirm it is you',
      paragraphs: [
        `Assalam o Alaikum ${name},`,
        login ? 'Type this code on the LaalPen sign-in screen, or tap the button below on the same phone or computer.' : 'Type this code in LaalPen to confirm the action you started.',
        `It works once and expires in ${env.otpTtlMinutes} minutes. LaalPen staff never ask for this code: do not share it.`,
        'If you did not try to sign in, ignore this email. Your account is safe.',
      ],
      code,
      button: login ? { label: 'Sign in to LaalPen', url: link } : undefined,
    });
  }

  /** Invite for a principal (from the super admin) or a teacher (from the principal). */
  invite(to: string, name: string, role: 'PRINCIPAL' | 'TEACHER', schoolName: string, invitedBy: string, link: string) {
    const principal = role === 'PRINCIPAL';
    return this.send({
      to,
      toName: name,
      subject: principal ? `You are the principal of ${schoolName} on LaalPen` : `${schoolName} added you as a teacher on LaalPen`,
      heading: principal ? 'Welcome, Principal' : 'Welcome to your school on LaalPen',
      paragraphs: [
        `Assalam o Alaikum ${name},`,
        principal
          ? `${invitedBy} added you as the principal of ${schoolName}. First complete your school profile (address, phone, classes and sections), then add your teachers.`
          : `${invitedBy} added you as a teacher at ${schoolName}. First complete your profile (qualification, subjects and the classes you teach). Your principal approves it, then your classes open.`,
        `Sign in with this email address (${to}). There is no password: LaalPen emails you a one-time code each time, or you can use Google with this same email, or a passkey after your first sign-in.`,
      ],
      button: { label: 'Open LaalPen', url: link },
    });
  }

  /** Short security notice with a "this wasn't me" button. */
  securityAlert(to: string, name: string, title: string, lines: string[], panicUrl?: string) {
    return this.send({
      to,
      toName: name,
      subject: `LaalPen security: ${title}`,
      heading: title,
      paragraphs: [`Assalam o Alaikum ${name},`, ...lines, 'If this was you, you can ignore this email.'],
      button: panicUrl ? { label: "This wasn't me — sign out everywhere", url: panicUrl } : undefined,
    });
  }

  private render(m: MailInput): string {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const paras = m.paragraphs.map((p) => `<p style="margin:0 0 14px;color:#3d3a37;font-size:15px;line-height:1.55">${esc(p)}</p>`).join('');
    const code = m.code
      ? `<div style="margin:22px 0;padding:16px;border-radius:12px;background:#fdf1f0;text-align:center;font-size:32px;letter-spacing:10px;font-weight:700;color:#b3261e;font-family:monospace">${m.code}</div>`
      : '';
    const button = m.button
      ? `<a href="${esc(m.button.url)}" style="display:inline-block;margin-top:8px;padding:12px 22px;border-radius:999px;background:#b3261e;color:#fff;text-decoration:none;font-weight:600">${esc(m.button.label)}</a>`
      : '';
    return `<!doctype html><html><body style="margin:0;background:#f6f3ef;font-family:Segoe UI,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 16px">
<div style="font-size:22px;font-weight:800;color:#b3261e;margin-bottom:18px">LaalPen</div>
<div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #ece6df">
<h1 style="margin:0 0 16px;font-size:21px;color:#1f1b18">${esc(m.heading)}</h1>${paras}${code}${button}
</div><p style="color:#8a837c;font-size:12px;text-align:center;margin-top:18px">LaalPen · AI copy checking for schools</p></div></body></html>`;
  }
}

/** Reserved / demo domains that no mailbox can exist on (RFC 2606 + the demo school). */
export function undeliverable(email: string) {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return /(^|\.)(demo|test|example|invalid|localhost)$/.test(domain) || /(^|\.)example\.(com|net|org)$/.test(domain);
}
