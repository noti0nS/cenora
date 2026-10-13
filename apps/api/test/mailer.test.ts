import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import type { AppEnv } from '../src/lib';
import { accessCodeMail, mailerFor } from '../src/mailer';

afterEach(() => vi.unstubAllGlobals());

describe('access-code email', () => {
  it('includes a branded HTML version and keeps the plain-text code', () => {
    const mail = accessCodeMail('012345');

    expect(mail.subject).toBe('Seu código de acesso');
    expect(mail.text).toContain('\n012345\n');
    expect(mail.text).toContain('10 minutos');
    expect(mail.html).toContain('lang="pt-BR"');
    expect(mail.html).toContain('012345');
    expect(mail.html).toContain('guardado.');
    expect(mail.html).toContain('#f5f2eb');
    expect(mail.html).toContain('#ffc247');
    expect(mail.html).toContain('Uso único');
    expect(mail.html).toContain('Se não foi você quem pediu');
  });

  it('escapes the code before embedding it in HTML', () => {
    const mail = accessCodeMail('<>&"\'');

    expect(mail.html).toContain('&lt;&gt;&amp;&quot;&#39;');
    expect(mail.text).toContain('<>&"\'');
  });

  it('sends both versions to Resend', async () => {
    const send = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', send);
    const context = {
      env: { RESEND_API_KEY: 'test-key', MAIL_FROM: 'Cenora <test@example.com>' },
    } as unknown as Context<AppEnv>;
    const mail = { to: 'member@example.com', ...accessCodeMail('012345') };

    await mailerFor(context).send(mail);

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({
      from: 'Cenora <test@example.com>',
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  });
});
