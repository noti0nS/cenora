import type { Context } from 'hono';
import type { Member } from '@watchlist/shared';
import type { ZodType } from 'zod';
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TMDB_TOKEN?: string;
  OMDB_KEY?: string;
  ENVIRONMENT?: string;
}
export type AppEnv = { Bindings: Env; Variables: { member: Member; sessionHash: string } };
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, '0')).join('');
}
export function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}
export const id = () => crypto.randomUUID();
export async function body<T>(c: Context<AppEnv>, schema: ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Não foi possível ler os dados enviados.');
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(400, 'VALIDATION', result.error.issues[0]?.message || 'Confira os campos.');
  return result.data;
}
export function owner(c: Context<AppEnv>) {
  if (c.get('member').role !== 'owner')
    throw new ApiError(403, 'FORBIDDEN', 'Esta ação é reservada à pessoa responsável pelo clube.');
}
export function checkpoint(kind: string, season: number | null, episode: number | null) {
  if ((season === null) !== (episode === null) || (kind === 'movie' && season !== null))
    throw new ApiError(
      400,
      'CHECKPOINT',
      'Informe temporada e episódio juntos, apenas para séries.',
    );
}
export async function rateLimit(c: Context<AppEnv>) {
  const now = Math.floor(Date.now() / 1000),
    slot = Math.floor(now / 300);
  const key = await hash(`${c.req.header('CF-Connecting-IP') || 'local'}:${slot}`);
  const row = await c.env.DB.prepare(
    'INSERT INTO auth_attempts (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
  )
    .bind(key, now + 600)
    .first<{ count: number }>();
  if ((row?.count || 0) > 12)
    throw new ApiError(
      429,
      'RATE_LIMIT',
      'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    );
}
