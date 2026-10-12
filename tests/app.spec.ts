import { test, expect, type BrowserContext, type Page } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Criar meu clube' }).click();
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
  await expect(page.getByRole('tab', { name: /Filmes/ })).toBeVisible();
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
  await expect(page.locator('.card')).toHaveCount(30);
  state = await context.storageState();
  await context.close();
});
test.beforeEach(async ({ context }) => {
  await context.addCookies(state.cookies);
});
const detailUrl = /\/api\/media\/[0-9a-f-]{36}$/;
/** Resolves when a tracking write containing `fragment` has been accepted by the API. */
const savedAs = (page: Page, fragment: string) =>
  page.waitForResponse(
    (r) =>
      r.request().method() === 'PUT' &&
      /\/(personal|group)$/.test(r.url()) &&
      (r.request().postData() || '').includes(fragment) &&
      r.ok(),
  );
test('one shelf: switch between movies and shows, rate a movie, refresh, and browser Back', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && !m.text().includes('favicon')) {
      errors.push(`${m.type()}: ${m.text()}`);
    }
  });
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(30);
  await expect(page.getByRole('tab', { name: /Filmes/ })).toHaveAttribute('aria-selected', 'true');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/shelf-movies.png', animations: 'disabled' });
  await page.getByRole('tab', { name: /Séries/ }).click();
  await expect(page.locator('.card')).toHaveCount(11);
  await expect(page.locator('.card.kind-tv')).toHaveCount(11);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'artifacts/shelf-shows.png', animations: 'disabled' });
  await page.getByRole('tab', { name: /Filmes/ }).click();
  await expect(page.locator('.card')).toHaveCount(30);
  await page.getByRole('button', { name: 'Abrir A Origem', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A Origem' })).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(0);
  await page.getByRole('button', { name: 'Já vi', exact: true }).click();
  const track = page.locator('.dial-track');
  await expect(track).toBeVisible();
  await page.waitForTimeout(600);
  const box = (await track.boundingBox())!;
  const rated = savedAs(page, '"rating":8.5');
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2);
  await expect(page.getByRole('slider', { name: 'Minha nota' })).toHaveAttribute(
    'aria-valuenow',
    '8.5',
  );
  await rated;
  await page.screenshot({ path: 'artifacts/movie-session.png', animations: 'disabled' });
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'A Origem' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Minha nota' })).toHaveAttribute(
    'aria-valuenow',
    '8.5',
  );
  await expect(page.getByRole('button', { name: 'Já vi', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Abrir A Origem', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});
test('rating dial works from the keyboard and can be cleared', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir A Origem', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Minha nota' });
  await expect(slider).toHaveAttribute('aria-valuenow', '8.5');
  await slider.focus();
  const low = savedAs(page, '"rating":1.5');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '9');
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuenow', '10');
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '0.5');
  await page.keyboard.press('PageUp');
  await expect(slider).toHaveAttribute('aria-valuenow', '1.5');
  await low;
  const cleared = savedAs(page, '"rating":null');
  await page.getByRole('button', { name: 'Limpar nota' }).click();
  await expect(slider).not.toHaveAttribute('aria-valuenow', /.+/);
  await cleared;
  await slider.focus();
  const final = savedAs(page, '"rating":6.5');
  await page.keyboard.press('End');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuenow', '6.5');
  await final;
});
test('mobile shelf and full-screen stage fit 360px, with reduced motion and keyboard focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page
      .locator('.shelf')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
  ).toBe(2);
  await expect
    .poll(async () => {
      const posters = page.locator('.shelf .poster');
      const first = await posters.nth(0).boundingBox();
      const second = await posters.nth(1).boundingBox();
      return Math.abs((first?.y || 0) - (second?.y || 0));
    })
    .toBeLessThan(1);
  await page.screenshot({ path: 'artifacts/shelf-mobile.png', animations: 'disabled' });
  await page.keyboard.press('Tab');
  await expect(page.getByText('Ir para os títulos')).toBeFocused();
  await page.getByRole('button', { name: 'Abrir A Origem', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A Origem' })).toBeVisible();
  await expect
    .poll(async () => (await page.getByRole('dialog', { name: 'A Origem' }).boundingBox())?.width)
    .toBe(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/movie-mobile.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Perfil de Ana' }).click();
  await page.getByRole('menuitem', { name: 'Usar tema claro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.card')).toHaveCount(30);
  await page.screenshot({ path: 'artifacts/shelf-light-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Abrir A Origem', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A Origem' })).toBeVisible();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'artifacts/movie-light-mobile.png', animations: 'disabled' });
});
test('catalog-unavailable manual show keeps a simple counter that survives a refresh', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByRole('button', { name: 'Série', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('Nossa série de domingo');
  await page.getByRole('button', { name: 'Guardar na estante' }).click();
  await expect(page.getByRole('dialog', { name: 'Nossa série de domingo' })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-kind', 'tv');
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Vi mais um episódio' }).click();
  }
  const counted = savedAs(page, '"season":2,"episode":3');
  await page.getByRole('button', { name: 'Mais temporada' }).click();
  await expect(page.locator('.progress-ring-center strong')).toHaveText('T2 · E3');
  await counted;
  await page.reload();
  await expect(page.locator('.progress-ring-center strong')).toHaveText('T2 · E3');
  await expect(page.getByRole('status', { name: 'Temporada' })).toHaveText('2');
  await expect(page.getByRole('status', { name: 'Episódio' })).toHaveText('3');
});
test('season tracker marks episodes up to a point, advances, undoes, and tracks the group apart', async ({
  page,
}) => {
  await page.route(detailUrl, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        seasons: [
          { number: 1, name: 'Temporada 1', episodes: 8 },
          { number: 2, name: 'Temporada 2', episodes: 10 },
        ],
      },
    });
  });
  await page.goto('/?kind=tv');
  await page.getByRole('button', { name: 'Abrir Nossa série de domingo', exact: true }).click();
  const ring = page.locator('.progress-ring-center');
  await expect(ring.locator('strong')).toHaveText('T2 · E3');
  await expect(ring.locator('small')).toHaveText('11 de 18 episódios');
  await page.getByRole('button', { name: 'Vi o T2 · E4' }).click();
  await expect(ring.locator('strong')).toHaveText('T2 · E4');
  await page.getByRole('button', { name: 'Episódio 4', exact: true }).click();
  await expect(ring.locator('strong')).toHaveText('T2 · E3');
  await page.getByRole('button', { name: 'Temporada 1', exact: true }).click();
  const personal = savedAs(page, '"season":1,"episode":5');
  await page.getByRole('button', { name: 'Episódio 5', exact: true }).click();
  await expect(ring.locator('strong')).toHaveText('T1 · E5');
  await expect(ring.locator('small')).toHaveText('5 de 18 episódios');
  await expect(page.getByRole('button', { name: 'Episódio 5', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Episódio 6', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await personal;
  await page.screenshot({ path: 'artifacts/show-tracker.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'O grupo', exact: true }).click();
  await expect(ring.locator('strong')).toHaveText('Não começou');
  const shared = savedAs(page, '"season":1,"episode":2');
  await page.getByRole('button', { name: 'Episódio 2', exact: true }).click();
  await expect(ring.locator('strong')).toHaveText('T1 · E2');
  await shared;
  await page.reload();
  await expect(ring.locator('strong')).toHaveText('T1 · E5');
  await page.getByRole('button', { name: 'O grupo', exact: true }).click();
  await expect(ring.locator('strong')).toHaveText('T1 · E2');
  await page.getByRole('button', { name: 'Temporada 2', exact: true }).click();
  const finished = savedAs(page, '"season":2,"episode":10');
  await page.getByRole('button', { name: 'Episódio 10', exact: true }).click();
  await expect(page.getByText('Série concluída')).toBeVisible();
  await finished;
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
  await expect(page.getByRole('slider', { name: 'Minha nota' })).toHaveAttribute(
    'aria-valuenow',
    '6.5',
  );
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
    await creator.getByRole('button', { name: 'Criar meu clube' }).click();
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
    await expect(creator.getByRole('tab', { name: /Filmes/ })).toBeVisible();
    await expect(creator.locator('.card')).toHaveCount(0);
    await creator.screenshot({ path: 'artifacts/empty-shelf.png', animations: 'disabled' });
    await creator.getByRole('button', { name: 'Adicionar', exact: true }).first().click();
    await creator.getByLabel('Título', { exact: true }).fill('Só no clube da Bia');
    await creator.getByRole('button', { name: 'Guardar na estante' }).click();
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
    await expect(page.locator('.card')).toHaveCount(30);
    await expect(
      page.getByRole('button', { name: 'Abrir Só no clube da Bia', exact: true }),
    ).toHaveCount(0);
  } finally {
    await creatorContext.close();
    await friendContext.close();
  }
});

test('private codes can be revealed without submitting, with spaced mobile access actions', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8788');
  await page.getByRole('button', { name: 'Tenho um código de convite' }).click();
  const code = page.getByLabel('Código do clube', { exact: true });
  await code.fill('codigo-privado-teste');
  await expect(code).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Mostrar código do clube', exact: true }).click();
  await expect(code).toHaveAttribute('type', 'text');
  await expect(code).toHaveValue('codigo-privado-teste');
  await page.getByRole('button', { name: 'Ocultar código do clube', exact: true }).click();
  await expect(code).toHaveAttribute('type', 'password');
  const create = await page
    .getByRole('button', { name: 'Quero criar um clube', exact: true })
    .boundingBox();
  const recover = page.getByRole('button', { name: 'Já tenho um perfil em outro dispositivo' });
  const recoveryLink = await recover.boundingBox();
  expect(recoveryLink!.y).toBeGreaterThanOrEqual(create!.y + create!.height + 8);
  await recover.click();
  const recovery = page.getByLabel('Seu código de recuperação', { exact: true });
  await recovery.fill('recuperacao-privada-teste');
  await page.getByRole('button', { name: 'Mostrar código de recuperação', exact: true }).click();
  await expect(recovery).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Quero criar um perfil novo' }).click();
  await expect(code).toHaveAttribute('type', 'password');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});
test('the roleta picks a title to open, and the title can be shared as a branded image', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(30);
  await page.getByRole('button', { name: 'Roleta', exact: true }).click();
  const roleta = page.getByRole('dialog', { name: 'Roleta' });
  await expect(roleta).toBeVisible();
  const open = roleta.getByRole('button', { name: 'Abrir título' });
  await expect(open).toBeVisible({ timeout: 10000 });
  await expect(roleta.getByRole('button', { name: 'Girar de novo' })).toBeEnabled();
  await open.click();
  await expect(roleta).not.toBeVisible();
  const stage = page.locator('.stage');
  await expect(stage).toBeVisible();
  await page.addInitScript(() => {
    (window as any).__opened = [];
    window.open = ((url: string) => ((window as any).__opened.push(String(url)), null)) as any;
  });
  await page.reload();
  await page.getByRole('button', { name: 'Compartilhar' }).click();
  const sheet = page.getByRole('dialog', { name: 'Compartilhar' });
  await expect(sheet.getByRole('img', { name: /Prévia do cartão/ })).toBeVisible();
  for (const app of ['WhatsApp', 'Instagram', 'Copiar']) {
    await expect(sheet.getByRole('button', { name: app, exact: true })).toBeVisible();
  }
  await sheet.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__opened.at(-1)))
    .toContain('https://wa.me/?text=');
  await expect(sheet.getByRole('button', { name: 'Discord' })).toHaveCount(0);
});
test('titles the group is watching, movies and shows, get a compact "Assistindo agora" section', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(30);
  await expect(page.getByRole('button', { name: 'Continuar A Origem' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir A Origem', exact: true }).click();
  const stage = page.getByRole('dialog', { name: 'A Origem' });
  const saved = savedAs(page, '"status":"watching"');
  await stage.getByRole('button', { name: 'Rolando', exact: true }).click();
  await saved;
  const mineSaved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith('/personal') && r.ok(),
  );
  await stage.getByRole('button', { name: 'Assistindo', exact: true }).click();
  await mineSaved;
  await page.keyboard.press('Escape');
  const section = page.getByRole('region', { name: 'Assistindo agora' });
  const resume = { name: 'Continuar A Origem', exact: true };
  await expect(section.getByRole('button', resume)).toBeVisible();
  await page.getByRole('tab', { name: /Séries/ }).click();
  await expect(section.getByRole('button', resume)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assistindo', exact: true })).toHaveCount(0);
  await expect(section.getByRole('button', resume)).toContainText('Você');
  await page.getByRole('tab', { name: /Filmes/ }).click();
  await section.getByRole('button', resume).click();
  const back = savedAs(page, '"status":"planned"');
  await page
    .getByRole('dialog', { name: 'A Origem' })
    .getByRole('button', { name: 'Vamos ver', exact: true })
    .click();
  await back;
  const mineBack = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith('/personal') && r.ok(),
  );
  await page
    .getByRole('dialog', { name: 'A Origem' })
    .getByRole('button', { name: 'Quero ver', exact: true })
    .click();
  await mineBack;
  await page.keyboard.press('Escape');
  await expect(section.getByRole('button', resume)).toHaveCount(0);
});

/** Lê o código de 6 dígitos do outbox de desenvolvimento do Worker de teste. */
async function outboxCodeFor(email: string) {
  const response = await fetch('http://127.0.0.1:8788/api/dev/outbox');
  const data = (await response.json()) as { messages: { to_email: string; text: string }[] };
  const message = data.messages.find((item) => item.to_email === email);
  return message!.text.match(/(\d{6})/)![1];
}
test('signs in with an email code, creates a club, and switches between clubs', async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8788');
    await page.getByLabel('Seu e-mail').fill('zoe@cenora.test');
    await page.getByRole('button', { name: 'Enviar código' }).click();
    await page.getByLabel('Código de 6 dígitos').fill(await outboxCodeFor('zoe@cenora.test'));
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('button', { name: 'Criar um clube novo' }).click();
    await page.getByLabel('Como podemos chamar você?').fill('Zoe');
    await page.getByRole('button', { name: 'Criar meu clube' }).click();
    await expect(page.getByRole('tab', { name: /Filmes/ })).toBeVisible();
    await page.getByRole('button', { name: 'Perfil de Zoe' }).click();
    await page.getByRole('menuitem', { name: 'Meu perfil' }).click();
    await page.getByText('Meus clubes').click();
    await page.getByLabel('Criar um clube novo').fill('Zoe B');
    await page.getByRole('button', { name: 'Criar clube' }).click();
    await expect(page.getByText('Clube de Zoe B foi criado.')).toBeVisible();
    await page.getByRole('button', { name: 'Fechar' }).click();
    await page.getByRole('button', { name: 'Perfil de Zoe' }).click();
    await page.getByRole('menuitem', { name: /Clube de Zoe B/ }).click();
    await expect(page.getByRole('button', { name: 'Perfil de Zoe B' })).toBeVisible();
    await page.getByRole('button', { name: 'Perfil de Zoe B' }).click();
    await expect(page.getByRole('menuitem', { name: /Clube de Zoe B/ })).toContainText('atual');
    await expect(page.getByRole('menuitem', { name: /Clube de Zoe$/ })).toBeVisible();
  } finally {
    await context.close();
  }
});
test('an owner claim code opens a scoped session with a clear notice', async ({
  browser,
  page,
}) => {
  const members = (await (
    await page.request.get('http://127.0.0.1:8788/api/club/members')
  ).json()) as { id: string }[];
  const claimed = (await (
    await page.request.post(`http://127.0.0.1:8788/api/club/members/${members[0].id}/claim`, {
      headers: { Origin: 'http://127.0.0.1:8788' },
    })
  ).json()) as { claimCode: string };
  expect(claimed.claimCode).toMatch(/^[a-f0-9]{48}$/);
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await fresh.goto('http://127.0.0.1:8788');
    await fresh.getByRole('button', { name: 'Tenho um código de convite' }).click();
    await fresh.getByRole('button', { name: 'Tenho um código de reacesso' }).click();
    await fresh.getByLabel('Código de reacesso').fill(claimed.claimCode);
    await fresh.getByRole('button', { name: 'Abrir meu acesso' }).click();
    await expect(fresh.getByRole('tab', { name: /Filmes/ })).toBeVisible();
    await expect(fresh.getByText(/Este acesso vale só para este clube/)).toBeVisible();
    await fresh.getByRole('button', { name: 'Perfil de Ana' }).click();
    await expect(fresh.getByRole('menuitem', { name: /Clube de Zoe B/ })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a guest profile links an email from settings', async ({ browser }) => {
  const email = 'gina@cenora.test';
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8788');
    await page.getByRole('button', { name: 'Criar meu clube' }).click();
    await page.getByLabel('Como podemos chamar você?').fill('Gina');
    await page.getByRole('button', { name: 'Criar meu clube' }).click();
    await page.getByRole('checkbox', { name: 'Guardei meus códigos em um lugar seguro.' }).check();
    await page.getByRole('button', { name: 'Ir para a Cenora' }).click();
    await expect(page.getByRole('tab', { name: /Filmes/ })).toBeVisible();
    await page.getByRole('button', { name: 'Perfil de Gina' }).click();
    await page.getByRole('menuitem', { name: 'Meu perfil' }).click();
    await page.getByRole('button', { name: 'Vincular um e-mail' }).click();
    await page.getByLabel('Seu e-mail').fill(email);
    await page.getByRole('button', { name: 'Enviar código' }).click();
    await page.getByLabel('Código de 6 dígitos').fill(await outboxCodeFor(email));
    await page.getByRole('button', { name: 'Vincular e-mail' }).click();
    await expect(page.getByText(`Conta: ${email}`)).toBeVisible();
  } finally {
    await context.close();
  }
});
