import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = path.join(root, 'apps', 'api');
const remote = process.argv.includes('--remote');
const staging = process.argv.includes('--staging');
const database = remote ? process.env.D1_DATABASE_ID || '' : '11111111-1111-4111-8111-111111111111';
if (process.argv[2] !== 'migrate' || !database) {
  console.error('Use migrate. Para --remote, defina D1_DATABASE_ID.');
  process.exit(1);
}
const flags = [
  ...(staging ? ['--mode', 'staging'] : []),
  ...(!remote ? ['--local', '--persist-to', path.join(api, '.wrangler', 'state')] : []),
];
const child = spawn(
  process.execPath,
  [
    path.join(api, 'node_modules', 'cf', 'bin', 'cf'),
    'd1',
    'migrations',
    'apply',
    database,
    '--dir',
    'migrations',
    ...flags,
  ],
  { cwd: api, windowsHide: true, stdio: 'inherit' },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code === 0 ? 0 : 1;
});
