import { test, expect, type BrowserContext, type Locator } from '@playwright/test';
import { openShelfAction, openClubAction } from './helpers/shelf';

const origin = 'http://127.0.0.1:8788';
const memberName = 'ParticipanteComUmNomeMuitoLongoParaTeste';
const title = 'UmaHistoriaComUmTituloMuitoLongoSemEspacos'.repeat(4);
let state: Awaited<ReturnType<BrowserContext['storageState']>>;
let movieId: string;
let showId: string;

/** Check the container itself, including overflow hidden by the body's clipping. */
async function fits(container: Locator, checkOverflow = true) {
  await expect(container).toBeVisible();
  await expect
    .poll(() =>
      container.evaluate((element, checkOverflow) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= -1 &&
          bounds.right <= innerWidth + 1 &&
          (!checkOverflow || element.scrollWidth <= element.clientWidth + 1)
        );
      }, checkOverflow),
    )
    .toBe(true);
}

async function headerFits(header: Locator) {
  // The intentional full-bleed backdrop extends beyond the header's content box.
  await fits(header, false);
  await expect
    .poll(() =>
      header.evaluate((element) => {
        const controls = Array.from(
          element.querySelectorAll<HTMLElement>(':scope > .wordmark, button, .search.open input'),
        ).filter((control) => control.getBoundingClientRect().width > 0);
        const boxes = controls.map((control) => control.getBoundingClientRect());
        return boxes.every(
          (box, index) =>
            box.left >= 0 &&
            box.right <= innerWidth &&
            boxes.slice(index + 1).every((other) => {
              const overlapX = Math.min(box.right, other.right) - Math.max(box.left, other.left);
              const overlapY = Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top);
              return overlapX <= 1 || overlapY <= 1;
            }),
        );
      }),
    )
    .toBe(true);
  for (const label of await header.locator('.kind-label').all()) {
    await expect
      .poll(() =>
        label.evaluate((element) => {
          const label = element.getBoundingClientRect();
          const button = element.closest('button')!.getBoundingClientRect();
          return label.left >= button.left && label.right <= button.right;
        }),
      )
      .toBe(true);
  }
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const created = await context.request.post(`${origin}/api/auth/create`, {
    headers: { Origin: origin },
    data: { name: memberName },
  });
  expect(created.ok()).toBe(true);
  const lists = await (await context.request.get(`${origin}/api/club/lists`)).json();
  for (const kind of ['movie', 'tv']) {
    const response = await context.request.post(`${origin}/api/media/manual`, {
      headers: { Origin: origin },
      data: { title, kind, listId: lists[0].id, synopsis: 'Sinopse longa. '.repeat(40) },
    });
    expect(response.ok()).toBe(true);
    const { id } = await response.json();
    if (kind === 'movie') movieId = id;
    else showId = id;
  }
  state = await context.storageState();
  await context.close();
});

for (const width of [320, 360, 390, 520, 600, 760, 768, 840, 900, 1024, 1100, 1101, 1280, 1440]) {
  test(`authenticated layouts fit ${width}px, including expanded search and dialogs`, async ({
    context,
    page,
  }) => {
    await context.addCookies(state.cookies);
    await page.setViewportSize({ width, height: width === 840 ? 390 : 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(`**/api/media/${showId}`, async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({
        response,
        json: {
          ...data,
          seasons: Array.from({ length: 20 }, (_, index) => ({
            number: index + 1,
            name: `Temporada ${index + 1}`,
            episodes: 30,
          })),
        },
      });
    });
    await page.goto('/');
    const header = page.locator('.app-header');
    await expect(page.locator('.card')).toHaveCount(1);
    await headerFits(header);
    await fits(page.locator('.toolbar'));
    await fits(page.locator('.toolbar-end'));
    await page.getByRole('tab', { name: /Animes/ }).click();
    await headerFits(header);
    await page.getByRole('tab', { name: /Séries/ }).click();
    await headerFits(header);
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    const search = page.getByRole('textbox', { name: 'Buscar na estante' });
    await expect(search).toBeFocused();
    await search.fill('UmaHistoria');
    await headerFits(header);
    await fits(page.locator('.search'));
    await page.getByRole('button', { name: 'Limpar busca' }).click();
    await search.press('Escape');
    await headerFits(header);
    await openShelfAction(page, 'Só os meus');
    await fits(page.locator('.toolbar'));
    await fits(page.locator('.toolbar-end'));
    await openShelfAction(page, 'Só os meus');

    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await fits(page.getByRole('dialog'));
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await openClubAction(page, 'Clubes e participantes');
    await fits(page.getByRole('dialog'));
    await fits(page.locator('.club-detail'));
    await page.getByRole('button', { name: /Criar, entrar ou trazer/ }).click();
    await fits(page.getByRole('dialog'));
    await fits(page.locator('.club-add'));
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    await openClubAction(page, 'Ranking do clube');
    await fits(page.getByRole('dialog'));
    await fits(page.locator('.ranking-controls'));
    await fits(page.locator('.ranking-roster'));
    await fits(page.locator('.ranking-badge-grid'));
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    await page.getByRole('button', { name: `Perfil de ${memberName}` }).click();
    await fits(page.getByRole('menu'));
    await page.getByRole('menuitem', { name: 'Meu perfil' }).click();
    await fits(page.getByRole('dialog'));
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('button', { name: `Perfil de ${memberName}` }).click();
    await page.getByRole('menuitem', { name: 'Importar títulos' }).click();
    await fits(page.getByRole('dialog'));
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    for (const [kind, id] of [
      ['movie', movieId],
      ['tv', showId],
    ]) {
      await page.goto(`/?kind=${kind}&media=${id}`);
      await expect(page.locator('.stage-title')).toHaveText(title);
      await fits(page.locator('.stage-scroll'));
      await fits(page.locator('.stage-grid'));
      await fits(page.locator(kind === 'movie' ? '.session' : '.tracker'));
      if (kind === 'tv') await fits(page.locator('.episode-grid'));
      if (kind === 'movie') {
        await page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
        await fits(page.getByRole('dialog', { name: 'Compartilhar' }));
        await page.keyboard.press('Escape');
      }
      await page.keyboard.press('Escape');
    }
    await page.getByRole('tab', { name: /Filmes/ }).click();
    await openShelfAction(page, 'Roleta');
    await expect(page.getByRole('button', { name: 'Abrir título', exact: true })).toBeVisible({
      timeout: 10000,
    });
    await fits(page.getByRole('dialog', { name: 'Roleta' }));
    if (width <= 520) {
      expect((await page.getByRole('dialog', { name: 'Roleta' }).boundingBox())!.width).toBe(width);
    }
  });
}

test('landing and access layouts fit narrow phones, tablets, and landscape', async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    for (const width of [320, 360, 390, 768, 840, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 840 ? 390 : 900 });
      await page.goto('/');
      await expect(page.locator('.landing-page')).toBeVisible();
      await fits(page.locator('.landing-nav'));
      await fits(page.locator('.landing-hero'));
      await fits(page.locator('.landing-shelf'));
      await page.getByRole('tab', { name: /Séries/ }).click();
      await fits(page.locator('.landing-shelf'));
      await fits(page.locator('.landing-episodes'));
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await expect(page.getByLabel('Seu e-mail')).toBeVisible();
      await fits(page.locator('.access-card'));
      await fits(page.locator('.access-brand-header'));
    }
  } finally {
    await context.close();
  }
});
