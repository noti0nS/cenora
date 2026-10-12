import { bindings, defineConfig, triggers } from 'cf/config';
export default defineConfig(({ mode }) => ({
  accountId: '87b9bb14c33d5cf43f13b7cb7d776014',
  worker: {
    name: mode === 'staging' ? 'cenora-staging' : 'cenora',
    entrypoint: './src/index.ts',
    compatibilityDate: '2026-10-11',
    workersDev: true,
    domains: mode === 'development' || mode === 'staging' ? [] : ['cenora.club'],
    assets: {
      htmlHandling: 'auto-trailing-slash',
      notFoundHandling: '404-page',
      runWorkerFirst: ['/api/*'],
    },
    env: {
      DB: bindings.d1({
        id:
          mode === 'development'
            ? '11111111-1111-4111-8111-111111111111'
            : process.env.D1_DATABASE_ID ||
              (mode === 'staging' ? undefined : 'd2c212f4-8d89-4f78-b72e-f0a0befa6a74'),
        name: mode === 'staging' ? 'cenora-staging' : 'cenora',
      }),
      ASSETS: bindings.assets(),
      ENVIRONMENT: bindings.text(mode === 'development' ? 'development' : 'production'),
      // Camada extra de rate limit por localidade. Fica fora do desenvolvimento
      // porque os testes e o dev local rodam em Miniflare, que não simula o binding.
      ...(mode === 'development'
        ? {}
        : {
            RL_AUTH: bindings.rateLimit({
              namespace: '1001',
              simple: { limit: 30, period: 60 },
            }),
          }),
      // Optional catalog credentials are uploaded with cf deploy --secrets-file.
      // Declaring them here would require keys even for manual-only clubs.
    },
    triggers: [triggers.scheduled({ schedule: '0 4 * * *' })],
  },
}));
