import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env.js';

export interface OutMessage {
  to: string;
  channel: 'whatsapp' | 'sms' | 'console';
  kind: 'code' | 'result' | 'text';
  text: string;
  code?: string;
}

/**
 * Text messages to parents' phones.
 * - WhatsApp Cloud API (Meta) when WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID are set (approved templates);
 * - otherwise SMS through Twilio or any HTTP SMS gateway (most Pakistani SMS companies);
 * - otherwise printed in the backend terminal (free, for development).
 * WhatsApp is used for convenience, never as a security factor (SIM-swap risk): parent accounts are read-only.
 */
@Injectable()
export class MessagingService {
  private readonly log = new Logger('Messaging');
  /** last messages — used by automated tests */
  readonly outbox: OutMessage[] = [];

  private keep(m: OutMessage) {
    this.outbox.push(m);
    if (this.outbox.length > 100) this.outbox.shift();
  }

  get whatsappReady() {
    return !!(env.whatsappToken && env.whatsappPhoneNumberId);
  }

  get smsReady() {
    return (env.smsProvider === 'twilio' && !!env.twilioAccountSid) || (env.smsProvider === 'http' && !!env.smsHttpUrl);
  }

  async sendCode(to: string, code: string) {
    const text = `${code} is your LaalPen code. It expires in ${env.otpTtlMinutes} minutes. Do not share it.`;
    if (this.whatsappReady && (await this.whatsappTemplate(to, env.whatsappOtpTemplate, [code], true))) return this.keep({ to, channel: 'whatsapp', kind: 'code', text, code });
    if (this.smsReady && (await this.sms(to, text))) return this.keep({ to, channel: 'sms', kind: 'code', text, code });
    this.log.log(`[console sms] to=${to} code=${code}`);
    this.keep({ to, channel: 'console', kind: 'code', text, code });
  }

  /** Result message: name, class, test, marks and a link to the red-pen copy (works without the app). */
  async sendResult(to: string, p: { student: string; className: string; test: string; marks: string; link: string }) {
    const text = `LaalPen: ${p.student} (${p.className}) scored ${p.marks} in ${p.test}. Checked copy: ${p.link}`;
    if (this.whatsappReady && (await this.whatsappTemplate(to, env.whatsappResultTemplate, [p.student, p.className, p.test, p.marks, p.link]))) {
      return this.keep({ to, channel: 'whatsapp', kind: 'result', text });
    }
    if (this.smsReady && (await this.sms(to, text.slice(0, 300)))) return this.keep({ to, channel: 'sms', kind: 'result', text });
    this.log.log(`[console sms] to=${to} ${text}`);
    this.keep({ to, channel: 'console', kind: 'result', text });
  }

  private async whatsappTemplate(to: string, template: string, params: string[], otpButton = false): Promise<boolean> {
    try {
      const components: object[] = [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }];
      if (otpButton) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: params[0] }] });
      const res = await fetch(`https://graph.facebook.com/v21.0/${env.whatsappPhoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.whatsappToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace('+', ''), type: 'template', template: { name: template, language: { code: 'en' }, components } }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) this.log.warn(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.ok;
    } catch (e) {
      this.log.warn(`WhatsApp failed: ${(e as Error).message}`);
      return false;
    }
  }

  private async sms(to: string, text: string): Promise<boolean> {
    try {
      if (env.smsProvider === 'twilio') {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`, {
          method: 'POST',
          headers: { authorization: `Basic ${Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: to, From: env.twilioFrom, Body: text }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) this.log.warn(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return res.ok;
      }
      const url = env.smsHttpUrl.replace('{to}', encodeURIComponent(to)).replace('{text}', encodeURIComponent(text));
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) this.log.warn(`SMS gateway ${res.status}`);
      return res.ok;
    } catch (e) {
      this.log.warn(`SMS failed: ${(e as Error).message}`);
      return false;
    }
  }
}
