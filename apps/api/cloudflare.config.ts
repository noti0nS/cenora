import { bindings, defineConfig, triggers } from 'cf/config';
export default defineConfig(({ mode }) => ({
  worker: {
    name: mode === 'staging' ? 'cenora-staging' : 'cenora',
    entrypoint: './src/index.ts',
    compatibilityDate: '2026-10-11',
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
            : process.env.D1_DATABASE_ID,
        name: mode === 'staging' ? 'cenora-staging' : 'cenora',
      }),
      ASSETS: bindings.assets(),
      ENVIRONMENT: bindings.text(mode === 'development' ? 'development' : 'production'),
      TMDB_TOKEN: bindings.secret(),
      OMDB_KEY: bindings.secret(),
    },
    triggers: [triggers.scheduled({ schedule: '0 4 * * *' })],
  },
}));
