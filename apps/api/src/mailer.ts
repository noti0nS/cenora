import type { Context } from 'hono';
import { ApiError, type AppEnv } from './lib';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}
export interface Mailer {
  send(mail: Mail): Promise<void>;
}
export function accessCodeMail(code: string): Pick<Mail, 'subject' | 'text'> {
  return {
    subject: 'Seu código de acesso',
    text: [
      'Seu código para entrar na Cenora é:',
      '',
      code,
      '',
      'Ele vale por 10 minutos e só pode ser usado uma vez.',
      'Se não foi você quem pediu, ignore este e-mail.',
      '',
      '— Cenora',
    ].join('\n'),
  };
}
function captureMailer(c: Context<AppEnv>): Mailer {
  return {
    async send(mail) {
      await c.env.DB.prepare(
        'INSERT INTO mail_outbox (id,to_email,subject,text,created_at) VALUES (?,?,?,?,?)',
      )
        .bind(crypto.randomUUID(), mail.to, mail.subject, mail.text, Math.floor(Date.now() / 1000))
        .run();
      console.log('mail_captured', { to: mail.to, subject: mail.subject });
    },
  };
}
function resendMailer(c: Context<AppEnv>, key: string): Mailer {
  const from = c.env.MAIL_FROM || 'Cenora <nao-responda@cenora.club>';
  return {
    async send(mail) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
      });
      if (!response.ok) {
        console.error('mail_provider_failed', { status: response.status });
        throw new Error('mail_provider_failed');
      }
    },
  };
}
export function mailerFor(c: Context<AppEnv>): Mailer {
  if (c.env.RESEND_API_KEY) return resendMailer(c, c.env.RESEND_API_KEY);
  if (c.env.ENVIRONMENT === 'development') return captureMailer(c);
  throw new ApiError(
    503,
    'MAIL_UNAVAILABLE',
    'O envio de e-mail ainda não está configurado. Tente novamente mais tarde.',
  );
}
export function outboxEnabled(c: Context<AppEnv>) {
  return c.env.ENVIRONMENT === 'development' && !c.env.RESEND_API_KEY;
}
