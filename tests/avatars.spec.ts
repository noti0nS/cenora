import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openClubAction } from './helpers/shelf';

async function createProfile(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar meu clube' }).click();
  await page.getByLabel('Como podemos chamar você?').fill('Cinefila');
  await page.getByRole('button', { name: 'Criar meu clube' }).click();
  await page.getByRole('checkbox', { name: 'Guardei meus códigos em um lugar seguro.' }).check();
  await page.getByRole('button', { name: 'Ir para a Cenora' }).click();
  await expect(page.getByRole('tab', { name: /Filmes/ })).toBeVisible();
}
async function openProfile(page: Page) {
  await page.getByRole('button', { name: 'Perfil de Cinefila', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Meu perfil', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sua foto', exact: true })).toBeVisible();
}

test('choose a preset, keep it across reloads, show it to participants and remove it on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await createProfile(page);
  await openProfile(page);
  await expect(
    page.getByRole('group', { name: 'Coleção de avatares' }).getByRole('button'),
  ).toHaveCount(8);
  await page.getByRole('button', { name: 'Usar avatar Gato', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Usar avatar Gato', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.locator('.header-avatar img')).toHaveAttribute('src', '/avatars/gato.svg');
  await page.reload();
  await expect(page.locator('.header-avatar img')).toHaveAttribute('src', '/avatars/gato.svg');
  await openClubAction(page, 'Clubes e participantes');
  await expect(page.locator('.roster-row .profile-avatar img')).toHaveAttribute(
    'src',
    '/avatars/gato.svg',
  );
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await openProfile(page);
  expect(
    await page
      .getByRole('dialog')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.getByRole('button', { name: 'Usar minha inicial', exact: true }).click();
  await expect(page.locator('.avatar-preview')).toHaveText('C');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.locator('.header-avatar')).toHaveText('C');
});

for (const format of ['png', 'jpeg', 'webp'] as const) {
  test(`normalize and upload ${format}, cancel drafts, persist the photo and replace with a preset`, async ({
    page,
  }) => {
    await createProfile(page);
    await openProfile(page);
    const base64 = await page.evaluate((format) => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#b74850';
      context.fillRect(0, 0, 800, 600);
      // Exercise the alpha WebP path as well as ordinary opaque images.
      if (format === 'webp') context.clearRect(0, 0, 500, 300);
      return canvas.toDataURL(`image/${format}`).split(',')[1];
    }, format);
    const file = {
      name: `photo.${format}`,
      mimeType: `image/${format}`,
      buffer: Buffer.from(base64, 'base64'),
    };
    await page.getByLabel('Escolha sua foto').setInputFiles(file);
    await expect(page.getByRole('button', { name: 'Salvar foto', exact: true })).toBeVisible();
    await expect(page.locator('.avatar-preview img')).toHaveAttribute('src', /^blob:/);
    await page.getByRole('button', { name: 'Cancelar imagem', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Salvar foto', exact: true })).toHaveCount(0);
    await page.getByLabel('Escolha sua foto').setInputFiles(file);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/auth/profile/avatar') &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Salvar foto', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    const profile = await response.json();
    await expect(page.locator('.avatar-preview img')).toHaveAttribute('src', profile.avatarUrl);
    await expect
      .poll(() =>
        page
          .locator('.avatar-preview img')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(512);
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.reload();
    await expect(page.locator('.header-avatar img')).toHaveAttribute('src', profile.avatarUrl);
    await openProfile(page);
    await page.getByRole('button', { name: 'Usar avatar Pipoca', exact: true }).click();
    await expect(page.locator('.avatar-preview img')).toHaveAttribute('src', '/avatars/pipoca.svg');
  });
}

const avifFixture = Buffer.from(
  'AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAACQAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAsbWRhdBIACgc4ADaQENBpMhcZQmMEwAA0AACQQMkcYIxHZZ2Ub8v1oA==',
  'base64',
);
const gifFixture = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);
const bmpFixture = Buffer.alloc(70);
bmpFixture.write('BM');
bmpFixture.writeUInt32LE(70, 2);
bmpFixture.writeUInt32LE(54, 10);
bmpFixture.writeUInt32LE(40, 14);
bmpFixture.writeInt32LE(2, 18);
bmpFixture.writeInt32LE(2, 22);
bmpFixture.writeUInt16LE(1, 26);
bmpFixture.writeUInt16LE(24, 28);
bmpFixture.writeUInt32LE(16, 34);
bmpFixture.fill(128, 54);

for (const format of ['gif', 'avif', 'bmp', 'ico'] as const) {
  test(`convert ${format} to a static WebP photo`, async ({ page }) => {
    await createProfile(page);
    await openProfile(page);
    let buffer: Buffer;
    if (format === 'ico') {
      const png = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 2;
        canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      const pixels = Buffer.from(png, 'base64');
      const header = Buffer.alloc(22);
      header.writeUInt16LE(1, 2);
      header.writeUInt16LE(1, 4);
      header[6] = header[7] = 2;
      header.writeUInt16LE(1, 10);
      header.writeUInt16LE(32, 12);
      header.writeUInt32LE(pixels.length, 14);
      header.writeUInt32LE(22, 18);
      buffer = Buffer.concat([header, pixels]);
    } else buffer = { gif: gifFixture, avif: avifFixture, bmp: bmpFixture }[format];
    await page.getByLabel('Escolha sua foto').setInputFiles({
      name: `photo.${format}`,
      mimeType: format === 'ico' ? 'image/x-icon' : `image/${format}`,
      buffer,
    });
    await expect(page.getByRole('button', { name: 'Salvar foto', exact: true })).toBeVisible();
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/auth/profile/avatar') &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Salvar foto', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect
      .poll(() =>
        page
          .locator('.avatar-preview img')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(format === 'gif' ? 1 : 2);
  });
}

test('uploads and previews images with the production content security policy', async ({
  page,
}) => {
  const headers = await readFile('apps/web/public/_headers', 'utf8');
  const policy = headers.match(/Content-Security-Policy: (.+)/)![1];
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'Content-Security-Policy': policy },
    });
  });
  await createProfile(page);
  await openProfile(page);
  await page
    .getByLabel('Escolha sua foto')
    .setInputFiles({ name: 'foto.avif', mimeType: 'image/avif', buffer: avifFixture });
  await expect(page.getByRole('button', { name: 'Salvar foto', exact: true })).toBeVisible();
  await expect(page.locator('.avatar-preview img')).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() =>
      page.locator('.avatar-preview img').evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(2);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auth/profile/avatar') && response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Salvar foto', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('.avatar-preview img')).toHaveAttribute(
    'src',
    /^\/api\/club\/members\//,
  );
});

test('invalid and oversized uploads keep the current avatar unchanged', async ({ page }) => {
  await createProfile(page);
  await openProfile(page);
  await page.getByRole('button', { name: 'Usar avatar Robô', exact: true }).click();
  await expect(page.locator('.avatar-preview img')).toHaveAttribute('src', '/avatars/robo.svg');
  await page.getByLabel('Escolha sua foto').setInputFiles({
    name: 'unsafe.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(
    page.getByText('Escolha uma imagem PNG, JPEG, WebP, GIF, AVIF, BMP ou ICO.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Escolha sua foto').setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(
    page.getByText('Não foi possível abrir essa imagem. Tente outro arquivo.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Escolha sua foto').setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.getByText('Escolha uma imagem de até 10 MB.', { exact: true })).toBeVisible();
  await expect(page.locator('.avatar-preview img')).toHaveAttribute('src', '/avatars/robo.svg');
  await expect(page.getByRole('button', { name: 'Salvar foto', exact: true })).toHaveCount(0);
});
