import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = path.join(root, 'apps', 'api');
const action = process.argv[2];
const remote = process.argv.includes('--remote');
const staging = process.argv.includes('--staging');
// A remote database selection must never change the local dev binding's identity.
const database = remote ? process.env.D1_DATABASE_ID || '' : '11111111-1111-4111-8111-111111111111';
if (!['migrate', 'bootstrap'].includes(action) || !database) {
  console.error('Use migrate ou bootstrap. Para --remote, defina D1_DATABASE_ID.');
  process.exit(1);
}
const state = path.join(root, '.local');
await mkdir(state, { recursive: true });
// cf's static-assets builder persists dev D1 here. cf resource commands otherwise use a different global store.
const flags = [
  ...(staging ? ['--mode', 'staging'] : []),
  ...(!remote ? ['--local', '--persist-to', path.join(api, '.wrangler', 'state')] : []),
];
async function cf(args, capture = false) {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(api, 'node_modules', 'cf', 'bin', 'cf'), ...args],
      { cwd: api, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' },
    );
    let output = '';
    child.stdout?.on('data', (d) => (output += d));
    child.stderr?.on('data', (d) => (output += d));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(capture ? output : `cf terminou com código ${code}`)),
    );
  });
}
try {
  if (action === 'migrate') {
    await cf(['d1', 'migrations', 'apply', database, '--dir', 'migrations', ...flags]);
  } else {
    // This statement never overwrites an existing club, including a completed setup.
    const setupCode = randomBytes(24).toString('hex');
    const digest = createHash('sha256').update(setupCode).digest('hex');
    const batchFile = path.join(state, 'bootstrap-query.json');
    await writeFile(
      batchFile,
      JSON.stringify([
        {
          sql: 'INSERT INTO club (id,setup_hash) VALUES (1,?) ON CONFLICT(id) DO NOTHING',
          params: [digest],
        },
        { sql: 'SELECT setup_hash FROM club WHERE id=1' },
      ]),
    );
    const output = await cf(['d1', 'raw', database, '--batch', `@${batchFile}`, ...flags], true);
    if (!output.includes(digest))
      throw new Error(
        'O clube já foi preparado. Use o código existente; a configuração não foi alterada.',
      );
    if (!remote) {
      await writeFile(path.join(state, 'setup-code.txt'), setupCode, { mode: 0o600 });
      console.log('Código local salvo em .local/setup-code.txt (ignorado pelo Git).');
    } else console.log(`Código de configuração — guarde agora:\n${setupCode}`);
    console.log('Abra o aplicativo e finalize a configuração do clube.');
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
