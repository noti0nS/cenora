import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Emergência do operador: emite um código de reacesso escopado para um perfil,
// sem passar pela interface (por exemplo, quando o dono do clube perdeu aparelho,
// e-mail e código de recuperação). O código abre apenas o clube daquele perfil,
// uma única vez, por 7 dias — igual ao reacesso que o dono gera na interface.
//
// Uso: node scripts/recover.mjs <memberId> [--remote] [--staging]
// O id do perfil aparece em Configurações do clube → Quem faz parte.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = path.join(root, 'apps', 'api');
const remote = process.argv.includes('--remote');
const staging = process.argv.includes('--staging');
const memberId = process.argv[2];
const database = remote ? process.env.D1_DATABASE_ID || '' : '11111111-1111-4111-8111-111111111111';
if (!memberId || !/^[0-9a-f-]{36}$/i.test(memberId)) {
  console.error('Use: node scripts/recover.mjs <memberId> [--remote] [--staging]');
  console.error('Sem uma credencial válida, nada é emitido.');
  process.exit(1);
}
if (remote && !database) {
  console.error('Para --remote, defina D1_DATABASE_ID.');
  process.exit(1);
}
const code = randomBytes(24).toString('hex');
const hash = createHash('sha256').update(code).digest('hex');
const now = Math.floor(Date.now() / 1000);
const sql = [
  `DELETE FROM member_claims WHERE member_id='${memberId}';`,
  `INSERT INTO member_claims (id,member_id,code_hash,created_by,expires_at,used_at)`,
  `SELECT lower(hex(randomblob(16))),'${memberId}','${hash}','operator',${now + 7 * 86400},NULL`,
  `WHERE EXISTS (SELECT 1 FROM members WHERE id='${memberId}' AND active=1);`,
].join(' ');
const flags = [
  ...(staging ? ['--mode', 'staging'] : []),
  ...(remote ? ['--remote'] : ['--local', '--persist-to', path.join(api, '.wrangler', 'state')]),
];
console.log('');
console.log('Código de reacesso (aparece só agora):');
console.log('  ' + code);
console.log('');
console.log('Vale por 7 dias, abre apenas o clube deste perfil e só pode ser usado uma vez.');
console.log('Entregue em mão à pessoa certa; o hash vai para o banco agora.');
console.log('');
const child = spawn(
  process.execPath,
  [
    path.join(api, 'node_modules', 'cf', 'bin', 'cf'),
    'd1',
    'execute',
    database,
    '--command',
    sql,
    ...flags,
  ],
  { cwd: api, windowsHide: true, stdio: 'inherit' },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (exitCode) => {
  if (exitCode !== 0) {
    console.error('O código acima NÃO foi gravado. Confira o banco e tente de novo.');
    process.exitCode = 1;
    return;
  }
  console.log('Pronto. Peça para a pessoa entrar em "Tenho um código de reacesso".');
});
