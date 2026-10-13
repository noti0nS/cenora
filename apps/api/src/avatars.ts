import { Hono } from 'hono';
import type { Context } from 'hono';
import { avatarSelectionSchema, AVATAR_SIZE, type Member } from '@cenora/shared';
import { ApiError, avatarFields, body, hit, id, type AppEnv } from './lib';
import { currentMember } from './auth';

// Accept only small, static WebP containers produced by our canvas encoder.
// Check actual bytes, chunk boundaries and dimensions, never filenames or MIME alone.
export function validateAvatar(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  const view = new DataView(bytes);
  const text = (at: number, length: number) =>
    String.fromCharCode(...data.subarray(at, at + length));
  const invalid = () => {
    throw new ApiError(400, 'INVALID_IMAGE', 'Escolha uma imagem válida e tente novamente.');
  };
  if (
    data.length < 30 ||
    text(0, 4) !== 'RIFF' ||
    text(8, 4) !== 'WEBP' ||
    view.getUint32(4, true) !== data.length - 8
  )
    invalid();
  let image = false;
  let canvas: [number, number] | null = null;
  for (let at = 12; at < data.length;) {
    if (at + 8 > data.length) invalid();
    const kind = text(at, 4),
      length = view.getUint32(at + 4, true),
      start = at + 8;
    const end = start + length + (length % 2);
    if (end > data.length) invalid();
    let width = 0,
      height = 0;
    if (kind === 'VP8X') {
      if (at !== 12 || length !== 10 || (data[start] & ~0x10) !== 0) invalid();
      const uint24 = (n: number) => data[n] | (data[n + 1] << 8) | (data[n + 2] << 16);
      canvas = [uint24(start + 4) + 1, uint24(start + 7) + 1];
    } else if (kind === 'ALPH') {
      if (!canvas || image || length < 1) invalid();
    } else if (kind === 'VP8 ' || kind === 'VP8L') {
      if (image) invalid();
      image = true;
      if (kind === 'VP8 ') {
        if (length < 10 || data[start] & 1 || text(start + 3, 3) !== '\x9d\x01\x2a') invalid();
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
      } else {
        if (length < 5 || data[start] !== 0x2f || data[start + 4] >> 5 !== 0) invalid();
        const bits = view.getUint32(start + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      if (
        !width ||
        width !== height ||
        width > AVATAR_SIZE ||
        (canvas && (canvas[0] !== width || canvas[1] !== height))
      )
        invalid();
    } else invalid();
    at = end;
  }
  if (!image) invalid();
}

function storage(c: Context<AppEnv>) {
  if (!c.env.AVATARS)
    throw new ApiError(
      503,
      'AVATAR_UNAVAILABLE',
      'O envio de fotos está indisponível. Escolha um avatar da coleção.',
    );
  return c.env.AVATARS;
}
function discard(c: Context<AppEnv>, key: string | null) {
  if (key?.startsWith('uploads/') && c.env.AVATARS)
    c.executionCtx.waitUntil(
      c.env.AVATARS.delete(key).catch(() => console.error('avatar_cleanup_failed')),
    );
}
async function replace(
  c: Context<AppEnv>,
  avatar: string | null,
  revision: number,
): Promise<Member> {
  const member = c.get('member');
  const previous = await c.env.DB.prepare(
    'SELECT avatar FROM members WHERE id=? AND club_id=? AND active=1 AND avatar_revision=?',
  )
    .bind(member.id, c.get('club').id, revision)
    .first<{ avatar: string | null }>();
  const conflict = new ApiError(
    409,
    'CONFLICT',
    'Sua foto mudou em outro aparelho. Atualize e tente novamente.',
  );
  if (!previous) throw conflict;
  const result = await c.env.DB.prepare(
    'UPDATE members SET avatar=?,avatar_revision=avatar_revision+1 WHERE id=? AND club_id=? AND active=1 AND avatar_revision=?',
  )
    .bind(avatar, member.id, c.get('club').id, revision)
    .run();
  if (!result.meta.changes) throw conflict;
  discard(c, previous.avatar);
  return { ...member, ...avatarFields(member.id, avatar, revision + 1) };
}

export const avatarRoutes = new Hono<AppEnv>();
avatarRoutes.use('*', async (c, next) => {
  if (!(await currentMember(c)))
    throw new ApiError(401, 'UNAUTHORIZED', 'Entre no clube para continuar.');
  await next();
});
avatarRoutes.patch('/', async (c) => {
  const input = await body(c, avatarSelectionSchema);
  await hit(c, `avatar:${c.get('member').id}`, 3600, 30);
  return c.json(await replace(c, input.preset ? `preset:${input.preset}` : null, input.revision));
});
avatarRoutes.put('/', async (c) => {
  const revisionHeader = c.req.header('If-Match');
  if (!revisionHeader || !/^\d{1,10}$/.test(revisionHeader))
    throw new ApiError(400, 'VALIDATION', 'Atualize o perfil antes de enviar a foto.');
  if (c.req.header('Content-Type') !== 'image/webp')
    throw new ApiError(415, 'IMAGE_TYPE', 'Envie a foto pelo seletor de imagens do perfil.');
  await hit(c, `avatar:${c.get('member').id}`, 3600, 30);
  const bucket = storage(c);
  const bytes = await c.req.arrayBuffer();
  validateAvatar(bytes);
  const key = `uploads/${c.get('club').id}/${c.get('member').id}/${id()}.webp`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/webp' } });
  try {
    return c.json(await replace(c, key, Number(revisionHeader)));
  } catch (error) {
    discard(c, key);
    throw error;
  }
});

export async function serveAvatar(c: Context<AppEnv>) {
  const row = await c.env.DB.prepare(
    'SELECT avatar FROM members WHERE id=? AND club_id=? AND active=1',
  )
    .bind(c.req.param('id'), c.get('club').id)
    .first<{ avatar: string | null }>();
  if (!row?.avatar?.startsWith('uploads/'))
    throw new ApiError(404, 'NOT_FOUND', 'Esta foto não foi encontrada.');
  const object = await storage(c).get(row.avatar);
  if (!object) throw new ApiError(404, 'NOT_FOUND', 'Esta foto não foi encontrada.');
  c.header('Content-Type', 'image/webp');
  c.header('Content-Length', String(object.size));
  c.header('Content-Disposition', 'inline; filename="avatar.webp"');
  return c.body(object.body);
}
