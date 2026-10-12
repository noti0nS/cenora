import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { auth, currentMember } from './auth';
import { mediaRoutes } from './media';
import { clubRoutes } from './club';
import { outboxEnabled } from './mailer';
import { ApiError, type AppEnv } from './lib';

const app = new Hono<AppEnv>();
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 128 * 1024,
    onError: (c) =>
      c.json(
        { error: { code: 'TOO_LARGE', message: 'Os dados enviados são grandes demais.' } },
        413,
      ),
  }),
);
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    const own = new URL(c.req.url).origin;
    const dev =
      c.env.ENVIRONMENT === 'development' &&
      ['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin || '');
    if (!origin || (origin !== own && !dev))
      throw new ApiError(403, 'ORIGIN', 'Reabra o aplicativo para continuar.');
  }
  await next();
});
app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', auth);
app.get('/api/dev/outbox', async (c) => {
  if (!outboxEnabled(c)) throw new ApiError(404, 'NOT_FOUND', 'Esta ação não foi encontrada.');
  const rows = await c.env.DB.prepare(
    'SELECT to_email,subject,text,created_at FROM mail_outbox ORDER BY created_at DESC,rowid DESC LIMIT 20',
  ).all();
  return c.json({ messages: rows.results });
});
app.use('/api/*', async (c, next) => {
  if (!(await currentMember(c)))
    throw new ApiError(401, 'UNAUTHORIZED', 'Entre no clube para continuar.');
  await next();
});
app.route('/api/media', mediaRoutes);
app.route('/api/club', clubRoutes);
app.all('/api/*', (c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Esta ação não foi encontrada.' } }, 404),
);
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((err, c) => {
  if (err instanceof ApiError)
    return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
  console.error('request_failed', {
    path: c.req.path,
    name: err.name,
    ...(c.env.ENVIRONMENT === 'development' ? { message: err.message } : {}),
  });
  return c.json(
    {
      error: {
        code: 'INTERNAL',
        message: 'Não foi possível concluir. Tente novamente em instantes.',
      },
    },
    500,
  );
});
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    const now = Math.floor(Date.now() / 1000);
    ctx.waitUntil(
      env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now),
        env.DB.prepare('DELETE FROM auth_attempts WHERE expires_at<?').bind(now),
        env.DB.prepare('DELETE FROM login_codes WHERE expires_at<?').bind(now),
        env.DB.prepare('DELETE FROM member_claims WHERE expires_at<? OR used_at IS NOT NULL').bind(
          now,
        ),
        env.DB.prepare('DELETE FROM mail_outbox WHERE created_at<?').bind(now - 30 * 86400),
        env.DB.prepare('DELETE FROM provider_cache WHERE expires_at<?').bind(
          Date.now() - 30 * 86400000,
        ),
      ]),
    );
  },
};
