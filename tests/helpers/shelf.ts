import type { Page } from '@playwright/test';

export async function openShelfAction(page: Page, name: string) {
  const shortcut = page.getByRole('button', { name, exact: true });
  if (await shortcut.isVisible()) {
    await shortcut.click();
    return;
  }
  await page.getByRole('button', { name: 'Opções da estante', exact: true }).click();
  await page
    .getByRole(name === 'Só os meus' ? 'menuitemcheckbox' : 'menuitem', { name, exact: true })
    .click();
}

export async function openClubAction(
  page: Page,
  name: 'Clubes e participantes' | 'Ranking do clube',
) {
  const shortcut = page.getByRole('button', {
    name: name === 'Clubes e participantes' ? /^Clubes e participantes/ : name,
    exact: name !== 'Clubes e participantes',
  });
  if (await shortcut.isVisible()) {
    await shortcut.click();
    return;
  }
  await page.getByRole('button', { name: /^Perfil de/ }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
