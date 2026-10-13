import { test, expect } from '@playwright/test';

test.beforeEach(() => {
  test.skip(
    !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    'Build with a Turnstile site key to exercise the widget.',
  );
});

for (const failure of ['script', 'widget', 'render', 'stalled'] as const) {
  test(`email security check explains ${failure} failure and can retry`, async ({ page }) => {
    let loads = 0;
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', async (route) => {
      loads++;
      if (failure === 'script' && loads === 1) {
        await route.abort();
        return;
      }
      await route.fulfill({
        contentType: 'application/javascript',
        body: `
          let renders = 0;
          window.turnstile = {
            render(element, options) {
              renders++;
              if (${JSON.stringify(failure)} !== 'script' && renders === 1) {
                if (${JSON.stringify(failure)} === 'render') throw new Error('Render failed');
                if (${JSON.stringify(failure)} === 'widget') {
                  queueMicrotask(() => options['error-callback']());
                }
              } else {
                queueMicrotask(() => options.callback('verified-test-token'));
              }
              return 'widget-' + renders;
            },
            remove() {},
          };
        `,
      });
    });
    const tokens: string[] = [];
    await page.route('**/api/auth/email/start', async (route) => {
      tokens.push(route.request().postDataJSON().turnstileToken);
      await route.fulfill({ json: { ok: true } });
    });
    if (failure === 'stalled') await page.clock.install();
    await page.goto('/');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByLabel('Seu e-mail').fill('security@cenora.test');
    const send = page.getByRole('button', { name: 'Enviar código' });
    await expect(send).toBeDisabled();
    if (failure === 'stalled') {
      await expect(page.getByRole('status')).toContainText('Aguardando a verificação');
      await page.clock.runFor(31000);
    }
    const failureNote = page.getByRole('alert').filter({ hasText: 'verificação de segurança' });
    await expect(failureNote).toBeVisible();
    // Pressionar Enter também não pode enviar sem uma verificação concluída.
    await page.getByLabel('Seu e-mail').press('Enter');
    expect(tokens).toEqual([]);
    await page.getByRole('button', { name: 'Tentar verificação novamente' }).click();
    await expect(send).toBeEnabled();
    await expect(failureNote).toHaveCount(0);
    await send.click();
    await expect(page.getByLabel('Código de 6 dígitos')).toBeVisible();
    expect(tokens).toEqual(['verified-test-token']);
    if (failure === 'script') expect(loads).toBe(2);
  });
}
