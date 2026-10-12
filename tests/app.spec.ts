import { test, expect, type BrowserContext } from '@playwright/test';
import { mkdir, readFile, readdir } from 'node:fs/promises';
test.describe.configure({ mode: 'serial' });
let state: Awaited<ReturnType<BrowserContext['storageState']>>;
let clubToken = '',
  recoveryCode = '';
test.beforeAll(async ({ browser }) => {
  const publicFiles = await readdir('apps/web/out', { recursive: true });
  for (const file of publicFiles.filter((name) => name.endsWith('.js'))) {
    const source = await readFile(`apps/web/out/${file}`, 'utf8');
    expect(source).not.toContain('Seven - os 7 pecados capitais');
    expect(source).not.toContain('Fullmetal Alquimist Brotherhood');
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8788');
  await expect(page.getByRole('heading', { name: 'Boas histórias. Boa companhia.' })).toBeVisible();
  await page.getByLabel('Como podemos chamar você?').fill('Ana');
  await expect(page.getByLabel('Código de configuração')).toHaveCount(0);
  await expect(page.getByLabel('Código do clube')).toHaveCount(0);
  await page.getByRole('button', { name: 'Criar meu clube' }).click();
  await expect(page.getByRole('heading', { name: 'Seu clube está pronto.' })).toBeVisible();
  const codes = await page.locator('.code-block code').allTextContents();
  clubToken = codes[0];
  recoveryCode = codes[1];
  await page.getByRole('checkbox', { name: 'Guardei meus códigos em um lugar seguro.' }).check();
  await page.getByRole('button', { name: 'Ir para a Cenora' }).click();
  await expect(page.getByRole('button', { name: 'Selecionar lista' })).toBeVisible();
  await page.getByRole('button', { name: 'Trazer nossa lista do documento' }).click();
  await expect(page.getByRole('heading', { name: 'Do documento para cá' })).toBeVisible();
  await page.getByRole('button', { name: 'Importar arquivo', exact: true }).click();
  await page.getByLabel('Escolha sua lista').setInputFiles('imports/google-docs.json');
  await page.getByRole('button', { name: 'Separar Zootopia 1 e 2' }).click();
  await page
    .getByRole('checkbox', {
      name: 'Conferi os títulos. Os não vinculados serão guardados manualmente.',
    })
    .check();
  await page.getByRole('button', { name: 'Guardar 41 títulos' }).click();
  await expect(page.getByRole('heading', { name: 'Do documento para cá' })).not.toBeVisible();
  await expect(page.locator('.media-card')).toHaveCount(30);
  state = await context.storageState();
  await context.close();
});
test.beforeEach(async ({ context }) => {
  await context.addCookies(state.cookies);
});
test('quiet gallery, details, personal rating, refresh, and browser Back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.media-card')).toHaveCount(30);
  await expect(page.locator('.header-actions')).toBeVisible();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({
    path: 'artifacts/gallery-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Abrir A Origem', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A Origem' })).toBeVisible();
  await page.getByLabel('Minha nota · /10').fill('8.5');
  await page.getByLabel('Meu progresso', { exact: true }).selectOption('watched');
  await page.getByRole('button', { name: 'Guardar meu progresso' }).click();
  await expect(page.getByText('Seu progresso foi guardado.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'A Origem' })).toBeVisible();
  await expect(page.getByLabel('Minha nota · /10')).toHaveValue('8.5');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Abrir A Origem', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});
test('mobile gallery and full-screen details fit 360px, with reduced motion and keyboard focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.media-card')).toHaveCount(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page
      .locator('.gallery')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
  ).toBe(2);
  await expect
    .poll(async () => {
      const posters = page.locator('.gallery .poster');
      const first = await posters.nth(0).boundingBox();
      const second = await posters.nth(1).boundingBox();
      return Math.abs((first?.y || 0) - (second?.y || 0));
    })
    .toBeLessThan(1);
  await page.screenshot({ path: 'artifacts/gallery-mobile.png', animations: 'disabled' });
  await page.keyboard.press('Tab');
  await expect(page.getByText('Ir para os títulos')).toBeFocused();
  await page.getByRole('button', { name: 'Abrir A Origem', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A Origem' })).toBeVisible();
  const box = await page.getByRole('dialog', { name: 'A Origem' }).boundingBox();
  expect(box?.width).toBe(360);
  await page.screenshot({ path: 'artifacts/details-mobile.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Perfil de Ana' }).click();
  await page.getByRole('menuitem', { name: 'Usar tema escuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
test('catalog-unavailable manual entry, custom list, and TV checkpoint', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Selecionar lista' }).click();
  await page.getByRole('menuitem', { name: 'Criar lista' }).click();
  await page.getByLabel('Nome da lista').fill('Domingo à noite');
  await page.getByRole('button', { name: 'Salvar lista' }).click();
  await expect(page.getByRole('button', { name: 'Selecionar lista' })).toContainText(
    'Domingo à noite',
  );
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Nossa série de domingo');
  await page.getByLabel('Tipo', { exact: true }).selectOption('tv');
  await page.getByRole('button', { name: 'Guardar na lista' }).click();
  await expect(page.getByRole('dialog', { name: 'Nossa série de domingo' })).toBeVisible();
  await page.getByLabel('Temporada', { exact: true }).fill('2');
  await page.getByLabel('Episódio', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Guardar meu progresso' }).click();
  await expect(page.getByText('Seu progresso foi guardado.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Temporada', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Episódio', { exact: true })).toHaveValue('4');
});
test('a second device recovers the same profile without losing ratings', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8788');
  await page.getByRole('button', { name: 'Tenho um código de convite' }).click();
  await page.getByRole('button', { name: 'Já tenho um perfil em outro dispositivo' }).click();
  await page.getByLabel('Como podemos chamar você?').fill('Ana');
  await page.getByLabel('Código do clube', { exact: true }).fill(clubToken);
  await page.getByLabel('Seu código de recuperação', { exact: true }).fill(recoveryCode);
  await page.getByRole('button', { name: 'Recuperar meu perfil' }).click();
  await expect(page.getByRole('button', { name: 'Perfil de Ana' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir A Origem', exact: true }).click();
  await expect(page.getByLabel('Minha nota · /10')).toHaveValue('8.5');
  await context.close();
});
test('a new creator gets a private code and friends join only that club', async ({
  browser,
  page,
}) => {
  const creatorContext = await browser.newContext();
  const friendContext = await browser.newContext();
  try {
    const creator = await creatorContext.newPage();
    await creator.goto('http://127.0.0.1:8788');
    await creator.getByLabel('Como podemos chamar você?').fill('Bia');
    await expect(creator.getByLabel('Código do clube')).toHaveCount(0);
    await creator.getByRole('button', { name: 'Criar meu clube' }).click();
    await expect(creator.getByRole('heading', { name: 'Seu clube está pronto.' })).toBeVisible();
    const invite = await creator.locator('.code-block code').first().textContent();
    expect(invite).not.toBe(clubToken);
    expect(invite).toMatch(/^[a-f0-9]{48}$/);
    await creator
      .getByRole('checkbox', { name: 'Guardei meus códigos em um lugar seguro.' })
      .check();
    await creator.getByRole('button', { name: 'Ir para a Cenora' }).click();
    await expect(creator.getByRole('button', { name: 'Selecionar lista' })).toBeVisible();
    await expect(creator.locator('.media-card')).toHaveCount(0);
    await creator.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await creator.getByLabel('Título', { exact: true }).fill('Só no clube da Bia');
    await creator.getByRole('button', { name: 'Guardar na lista' }).click();
    await expect(creator.getByRole('dialog', { name: 'Só no clube da Bia' })).toBeVisible();
    const friend = await friendContext.newPage();
    await friend.goto('http://127.0.0.1:8788');
    await friend.getByRole('button', { name: 'Tenho um código de convite' }).click();
    await friend.getByLabel('Como podemos chamar você?').fill('Beto');
    await friend.getByLabel('Código do clube', { exact: true }).fill(invite!);
    await friend.getByRole('button', { name: 'Entrar no clube' }).click();
    await expect(friend.getByRole('heading', { name: 'Seu lugar está guardado.' })).toBeVisible();
    await friend
      .getByRole('checkbox', { name: 'Guardei meus códigos em um lugar seguro.' })
      .check();
    await friend.getByRole('button', { name: 'Ir para a Cenora' }).click();
    await expect(
      friend.getByRole('button', { name: 'Abrir Só no clube da Bia', exact: true }),
    ).toBeVisible();
    await friend.getByRole('button', { name: 'Perfil de Beto' }).click();
    await expect(friend.getByText('Clube de Bia', { exact: true })).toBeVisible();
    await page.goto('/');
    await expect(page.locator('.media-card')).toHaveCount(30);
    await expect(
      page.getByRole('button', { name: 'Abrir Só no clube da Bia', exact: true }),
    ).toHaveCount(0);
  } finally {
    await creatorContext.close();
    await friendContext.close();
  }
});
