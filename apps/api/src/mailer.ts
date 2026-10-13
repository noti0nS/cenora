import type { Context } from 'hono';
import { ApiError, type AppEnv } from './lib';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
export interface Mailer {
  send(mail: Mail): Promise<void>;
}
export function accessCodeMail(code: string): Pick<Mail, 'subject' | 'text' | 'html'> {
  const safeCode = code.replace(/[&<>"']/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!;
  });
  return {
    subject: 'Seu código de acesso',
    html: `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Seu código de acesso · Cenora</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f2eb;color:#17161b;font-family:'Nunito Sans',Arial,sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Seu lugar na Cenora está guardado. Use seu código para entrar; ele vale por 10 minutos.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f2eb">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;">
            <tr>
              <td style="padding:0 8px 24px;">
                <p style="margin:0;font-family:'Space Grotesk',Arial,sans-serif;font-size:30px;line-height:1.2;font-weight:700;letter-spacing:-1.5px;">cenora<span style="color:#f2a900;">.</span></p>
                <p style="margin:8px 0 0;color:#6d6a74;font-size:12px;line-height:1.6;">Filmes, séries e gente próxima.</p>
              </td>
            </tr>
            <tr>
              <td bgcolor="#fffdf8" style="padding:32px 24px;border:1px solid #e0dbcf;border-top:4px solid #f2a900;border-radius:14px;">
                <p style="margin:0 0 16px;color:#8f5a00;font-size:10px;line-height:1.5;font-weight:700;letter-spacing:2px;">SEU ACESSO À CENORA</p>
                <h1 style="margin:0;font-family:'Space Grotesk',Arial,sans-serif;font-size:34px;line-height:1.15;font-weight:500;letter-spacing:-1.5px;">Seu lugar está<br /><em style="font-family:Georgia,serif;color:#8f5a00;font-weight:400;">guardado.</em></h1>
                <p style="margin:20px 0 24px;color:#6d6a74;font-size:14px;line-height:1.8;">Volte à Cenora e digite o código abaixo para continuar. Sua próxima sessão está logo ali.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#17161b" style="border-radius:10px;">
                  <tr>
                    <td align="center" style="padding:22px 12px 20px;">
                      <p style="margin:0 0 12px;color:#f3f0ea;font-size:10px;line-height:1.5;font-weight:700;letter-spacing:2px;">CÓDIGO DE ACESSO</p>
                      <p style="margin:0;color:#ffc247;font-family:'Courier New',monospace;font-size:36px;line-height:1.3;font-weight:700;letter-spacing:6px;">${safeCode}</p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:14px 12px;border-top:1px dashed #6d6a74;">
                      <p style="margin:0;color:#f3f0ea;font-size:12px;line-height:1.6;">Válido por <strong style="color:#ffc247;">10 minutos</strong> · Uso único</p>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;color:#6d6a74;font-size:12px;line-height:1.8;">Este código é só seu. Não compartilhe com ninguém.<br />Se não foi você quem pediu, ignore este e-mail.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 8px 0;">
                <p style="margin:0;color:#6d6a74;font-size:11px;line-height:1.8;">Sua estante de filmes e séries, entre amigos.</p>
                <p style="margin:4px 0 0;color:#6d6a74;font-size:11px;line-height:1.8;">— Cenora</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
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
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          ...(mail.html ? { html: mail.html } : {}),
        }),
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
