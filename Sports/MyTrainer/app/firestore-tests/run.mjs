// 규칙 테스트 실행기. 윈도우에서 emulators:exec 가 끝난 뒤에도 에뮬레이터(java)가
// 8085 포트에 남는 일이 있어서, 이미 떠 있으면 그대로 쓰고 없을 때만 띄운다.
// 규칙은 테스트가 매번 새로 올리므로 남아 있던 에뮬레이터를 써도 된다.
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';

const PORT = 8085;

const open = await new Promise((done) => {
  const s = createConnection({ host: '127.0.0.1', port: PORT });
  s.once('connect', () => (s.end(), done(true)));
  s.once('error', () => done(false));
});

const cmd = open
  ? 'npx vitest run'
  : 'firebase emulators:exec --only firestore --project demo-mytrainer --config ../firebase.json "npx vitest run"';
const r = spawnSync(cmd, { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
