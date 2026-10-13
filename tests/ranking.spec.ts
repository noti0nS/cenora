import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('private ranking: movies, episodes, badges, opt-out, themes and mobile layout', async ({
  page,
  browser,
}) => {
  const origin = 'http://127.0.0.1:8788';
  const headers = { Origin: origin };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const created = await page.request.post('/api/auth/create', {
    headers,
    data: { name: 'Marina' },
  });
  expect(created.status()).toBe(201);
  const club = await created.json();
  const lists = await (await page.request.get('/api/club/lists')).json();
  const movie = await (
    await page.request.post('/api/media/manual', {
      headers,
      data: { title: 'Uma boa sessão', kind: 'movie', listId: lists[0].id },
    })
  ).json();
  const show = await (
    await page.request.post('/api/media/manual', {
      headers,
      data: { title: 'Um episódio por vez', kind: 'tv', listId: lists[0].id },
    })
  ).json();
  const anime = await (
    await page.request.post('/api/media/manual', {
      headers,
      data: { title: 'Uma nova história', kind: 'tv', isAnime: true, listId: lists[0].id },
    })
  ).json();
  const friend = await browser.newContext();
  try {
    expect(
      (
        await friend.request.post(`${origin}/api/auth/join`, {
          headers,
          data: { name: 'Lucas', token: club.clubToken },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await friend.request.put(`${origin}/api/media/${movie.id}/personal`, {
          headers,
          data: { status: 'watched', rating: 8, season: null, episode: null, revision: 0 },
        })
      ).status(),
    ).toBe(200);
    await page.goto('/');
    await page.getByRole('button', { name: 'Abrir Uma boa sessão', exact: true }).click();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/personal') && r.request().method() === 'PUT' && r.ok(),
    );
    await page.getByRole('button', { name: 'Já vi', exact: true }).click();
    await saved;
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('button', { name: 'Ranking do clube', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Ranking do clube' });
    await expect(dialog.locator('.ranking-row')).toHaveCount(2);
    await expect(dialog.getByLabel('1º lugar', { exact: true })).toHaveCount(2);
    await expect(dialog.locator('.ranking-mine')).toContainText('Marina');
    await expect(dialog.locator('.ranking-mine')).toContainText('1 filme');
    await expect(dialog.locator('.ranking-collective')).toContainText('1 título diferente');
    const debut = dialog.getByRole('button', { name: /Sessão de estreia/ });
    await debut.click();
    await expect(debut).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.locator('.ranking-mine .ranking-badge')).toHaveText('Sessão de estreia');
    await expect(dialog.getByRole('button', { name: /Créditos finais/ })).toBeDisabled();
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/ranking-desktop-dark.png', animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Séries', exact: true }).click();
    await expect(dialog.locator('.ranking-mine')).toContainText('0 episódios');
    await dialog.getByRole('button', { name: 'Animes', exact: true }).click();
    await expect(dialog.locator('.ranking-mine')).toContainText('0 episódios');
    await dialog.getByRole('button', { name: 'Filmes', exact: true }).click();
    await dialog.getByRole('button', { name: 'Desde sempre', exact: true }).click();
    await expect(dialog.locator('.ranking-mine')).toContainText('1 filme');
    await dialog.getByRole('checkbox', { name: 'Participar do ranking deste clube' }).uncheck();
    await expect(dialog.locator('.ranking-row')).toHaveCount(1);
    await expect(dialog.locator('.ranking-mine')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Ranking do clube', exact: true }).click();
    await expect(
      dialog.getByRole('checkbox', { name: 'Participar do ranking deste clube' }),
    ).not.toBeChecked();
    await dialog.getByRole('checkbox', { name: 'Participar do ranking deste clube' }).check();
    await expect(dialog.locator('.ranking-row')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('tab', { name: /Séries/ }).click();
    await page.getByRole('button', { name: 'Abrir Um episódio por vez', exact: true }).click();
    const episodeSaved = page.waitForResponse(
      (r) => r.url().endsWith('/personal') && r.request().method() === 'PUT' && r.ok(),
    );
    await page.getByRole('button', { name: 'Vi mais um episódio', exact: true }).click();
    await episodeSaved;
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('button', { name: 'Ranking do clube', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Séries', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(dialog.locator('.ranking-mine')).toContainText('1 episódio');
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('button', { name: 'Perfil de Marina' }).click();
    await page.getByRole('menuitem', { name: 'Usar tema claro' }).click();
    await page.getByRole('button', { name: 'Ranking do clube', exact: true }).click();
    await page.screenshot({ path: 'artifacts/ranking-desktop-light.png', animations: 'disabled' });
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'artifacts/ranking-mobile-light.png', animations: 'disabled' });
    await dialog.getByText('Como funciona', { exact: true }).click();
    await expect(dialog.getByText(/O mês segue o horário de Brasília/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('button', { name: 'Ranking do clube', exact: true }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(errors).toEqual([]);
    expect((await page.request.get(`/api/media/${show.id}`)).ok()).toBe(true);
    expect((await page.request.get(`/api/media/${anime.id}`)).ok()).toBe(true);
  } finally {
    await friend.close();
  }
});

test('ranking has a recoverable loading and error state', async ({ page }) => {
  const headers = { Origin: 'http://127.0.0.1:8788' };
  expect(
    (await page.request.post('/api/auth/create', { headers, data: { name: 'Bia' } })).status(),
  ).toBe(201);
  await page.goto('/');
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/club/ranking?*', async (route) => {
    await blocked;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Tente de novo em instantes.' },
      }),
    });
  });
  await page.getByRole('button', { name: 'Ranking do clube', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ranking do clube' });
  await expect(dialog.getByRole('status')).toHaveText('Preparando o placar…');
  release!();
  await expect(dialog.getByRole('alert')).toContainText('Tente de novo em instantes.');
  await page.unroute('**/api/club/ranking?*');
  await dialog.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(dialog.locator('.ranking-row')).toHaveCount(1);
});
