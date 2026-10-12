import type { Context } from 'hono';
import type { Member, Club } from '@cenora/shared';
import type { ZodType } from 'zod';
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TMDB_TOKEN?: string;
  OMDB_KEY?: string;
  ENVIRONMENT?: string;
  AUTH_PEPPER?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  TURNSTILE_SECRET?: string;
}
export type AppEnv = {
  Bindings: Env;
  Variables: { member: Member; club: Club; clubOwnerId: string; sessionHash: string };
};
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
export async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (x) => x.toString(16).padStart(2, '0')).join('');
}
export function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
  if (c.get('member').role !== 'owner' || c.get('clubOwnerId') !== c.get('member').id)
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
export async function hit(
  c: Context<AppEnv>,
  key: string,
  windowSeconds: number,
  limit: number,
  message = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
) {
  const now = Math.floor(Date.now() / 1000),
    slot = Math.floor(now / windowSeconds);
  const bucket = await hash(`${key}:${slot}`);
  const row = await c.env.DB.prepare(
    'INSERT INTO auth_attempts (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
  )
    .bind(bucket, now + windowSeconds * 2)
    .first<{ count: number }>();
  if ((row?.count || 0) > limit) throw new ApiError(429, 'RATE_LIMIT', message);
}
export async function rateLimit(c: Context<AppEnv>) {
  await hit(c, `ip:${c.req.header('CF-Connecting-IP') || 'local'}`, 300, 12);
}
