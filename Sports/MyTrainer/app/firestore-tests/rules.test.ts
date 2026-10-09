// Firestore 보안 규칙 테스트(설계 T5, D4·D9·D17).
// 실행: npm run emu  (에뮬레이터를 띄우고 vitest 를 돌린 뒤 내린다)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';

const PID = 'p1';
const CODE = 'gym123';

let env: RulesTestEnvironment;

const db = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

beforeAll(async () => {
  // 거부가 정답인 케이스마다 PERMISSION_DENIED 경고가 찍혀서 끈다.
  setLogLevel('silent');
  env = await initializeTestEnvironment({
    projectId: 'demo-mytrainer',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8085,
    },
  });
});

afterAll(() => env.cleanup());

const member = (over: Record<string, unknown> = {}) => ({
  displayName: '친구',
  joinedAt: 1,
  shareAttendance: true,
  hidden: false,
  ...over,
});

const attendance = (uid: string, day = '2026-10-09', over: Record<string, unknown> = {}) => ({
  uid,
  day,
  enteredAt: 1000,
  exitedAt: null,
  manual: false,
  mock: false,
  ...over,
});

// 파티장 owner, 파티원 alice(공유 동의) / bob(공유 안 함) / carol(숨김), 외부인 mallory.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, `parties/${PID}`), { ownerId: 'owner', name: '우리 헬스장', inviteCode: CODE });
    await setDoc(doc(f, `parties/${PID}/members/owner`), member());
    await setDoc(doc(f, `parties/${PID}/members/alice`), member());
    await setDoc(doc(f, `parties/${PID}/members/bob`), member({ shareAttendance: false }));
    await setDoc(doc(f, `parties/${PID}/members/carol`), member({ hidden: true }));
    await setDoc(doc(f, `parties/${PID}/attendance/alice_2026-10-09`), attendance('alice'));
    await setDoc(doc(f, `users/alice/sets/s1`), { reps: 5 });
    await setDoc(doc(f, `parties/${PID}/machines/m1`), {
      name: '스미스머신',
      exerciseIds: ['squat'],
      createdBy: 'alice',
      createdAt: 1,
    });
    await setDoc(doc(f, `parties/${PID}/machines/m1/photos/ph1`), {
      modelId: 'mnv3-small-100',
      dim: 2,
      vector: [0.1, 0.2],
      createdBy: 'bob',
      createdAt: 1,
    });
  });
});

describe('users/{uid} 개인 데이터(지표 원본)', () => {
  test('본인은 세트를 읽고 쓴다', async () => {
    await assertSucceeds(getDoc(doc(db('alice'), 'users/alice/sets/s1')));
    await assertSucceeds(setDoc(doc(db('alice'), 'users/alice/sets/s2'), { reps: 3 }));
  });

  test('파티원이어도 남의 세트는 읽지도 쓰지도 못한다', async () => {
    await assertFails(getDoc(doc(db('owner'), 'users/alice/sets/s1')));
    await assertFails(setDoc(doc(db('bob'), 'users/alice/sets/s9'), { reps: 1 }));
    await assertFails(getDocs(collection(db('bob'), 'users/alice/geofence_events')));
  });

  test('로그인 안 하면 아무것도 못 한다', async () => {
    await assertFails(getDoc(doc(anon(), 'users/alice/sets/s1')));
    await assertFails(getDoc(doc(anon(), `parties/${PID}`)));
  });
});

describe('parties / members', () => {
  test('파티원만 파티와 멤버 목록을 읽는다', async () => {
    await assertSucceeds(getDoc(doc(db('bob'), `parties/${PID}`)));
    await assertSucceeds(getDocs(collection(db('bob'), `parties/${PID}/members`)));
    await assertFails(getDoc(doc(db('mallory'), `parties/${PID}`)));
    await assertFails(getDocs(collection(db('mallory'), `parties/${PID}/members`)));
  });

  test('파티와 파티장 멤버 문서를 한 배치로 만든다', async () => {
    const f = db('dave');
    const b = writeBatch(f);
    b.set(doc(f, 'parties/p2'), { ownerId: 'dave', name: '새 파티', inviteCode: 'abcdef' });
    b.set(doc(f, 'parties/p2/members/dave'), member());
    await assertSucceeds(b.commit());
  });

  test('남을 파티장으로 적어 파티를 만들 수 없다', async () => {
    await assertFails(
      setDoc(doc(db('dave'), 'parties/p3'), { ownerId: 'alice', name: 'x', inviteCode: 'abcdef' }),
    );
  });

  test('가입 코드가 맞아야 들어온다', async () => {
    await assertFails(
      setDoc(doc(db('mallory'), `parties/${PID}/members/mallory`), member({ inviteCode: 'wrong!' })),
    );
    await assertFails(setDoc(doc(db('mallory'), `parties/${PID}/members/mallory`), member()));
    await assertSucceeds(
      setDoc(doc(db('mallory'), `parties/${PID}/members/mallory`), member({ inviteCode: CODE })),
    );
  });

  test('남을 대신 가입시킬 수 없다', async () => {
    await assertFails(
      setDoc(doc(db('alice'), `parties/${PID}/members/mallory`), member({ inviteCode: CODE })),
    );
  });

  test('본인은 동의·숨김·이름만 바꾼다', async () => {
    await assertSucceeds(updateDoc(doc(db('alice'), `parties/${PID}/members/alice`), { hidden: true }));
    await assertFails(updateDoc(doc(db('alice'), `parties/${PID}/members/alice`), { joinedAt: 99 }));
    await assertFails(updateDoc(doc(db('alice'), `parties/${PID}/members/bob`), { hidden: true }));
  });

  test('파티장만 파티 설정을 바꾸고, 파티장을 넘길 수 없다', async () => {
    await assertFails(updateDoc(doc(db('alice'), `parties/${PID}`), { name: '바꿈' }));
    await assertSucceeds(updateDoc(doc(db('owner'), `parties/${PID}`), { name: '바꿈' }));
    await assertFails(updateDoc(doc(db('owner'), `parties/${PID}`), { ownerId: 'alice' }));
  });

  test('탈퇴는 본인, 내보내기는 파티장', async () => {
    await assertFails(deleteDoc(doc(db('alice'), `parties/${PID}/members/bob`)));
    await assertSucceeds(deleteDoc(doc(db('alice'), `parties/${PID}/members/alice`)));
    await assertSucceeds(deleteDoc(doc(db('owner'), `parties/${PID}/members/bob`)));
    await assertFails(deleteDoc(doc(db('owner'), `parties/${PID}/members/owner`)));
  });
});

describe('초대 코드 invites/{code}', () => {
  test('파티장은 파티·멤버·초대 문서를 한 배치로 만든다', async () => {
    const f = db('dave');
    const b = writeBatch(f);
    b.set(doc(f, 'parties/p9'), { ownerId: 'dave', name: '새 파티', inviteCode: 'ABCDEFGH' });
    b.set(doc(f, 'parties/p9/members/dave'), member());
    b.set(doc(f, 'invites/ABCDEFGH'), { partyId: 'p9', ownerId: 'dave' });
    await assertSucceeds(b.commit());
  });

  test('남의 파티를 가리키는 초대, 파티 코드와 다른 초대는 만들 수 없다', async () => {
    await assertFails(setDoc(doc(db('mallory'), `invites/${CODE}`), { partyId: PID, ownerId: 'mallory' }));
    await assertFails(setDoc(doc(db('owner'), 'invites/OTHERCOD'), { partyId: PID, ownerId: 'owner' }));
    await assertSucceeds(setDoc(doc(db('owner'), `invites/${CODE}`), { partyId: PID, ownerId: 'owner' }));
  });

  test('코드를 알면 한 건 읽고 가입한다. 목록은 못 본다', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), `invites/${CODE}`), { partyId: PID, ownerId: 'owner' }),
    );
    const f = db('erin');
    const inv = await assertSucceeds(getDoc(doc(f, `invites/${CODE}`)));
    const pid = inv.data()!.partyId;
    const b = writeBatch(f);
    b.set(doc(f, `parties/${pid}/members/erin`), member({ inviteCode: CODE }));
    b.set(doc(f, 'users/erin'), { partyId: pid }, { merge: true });
    await assertSucceeds(b.commit());
    await assertFails(getDocs(collection(f, 'invites')));
    await assertFails(getDoc(doc(anon(), `invites/${CODE}`)));
  });

  test('파티장은 초대 문서를 같은 값으로 다시 쓸 수 있지만 바꿀 수는 없다', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), `invites/${CODE}`), { partyId: PID, ownerId: 'owner' }),
    );
    await assertSucceeds(setDoc(doc(db('owner'), `invites/${CODE}`), { partyId: PID, ownerId: 'owner' }));
    await assertFails(setDoc(doc(db('owner'), `invites/${CODE}`), { partyId: 'p2', ownerId: 'owner' }));
  });
});

describe('공개 출석(D17)', () => {
  const ref = (f: ReturnType<typeof db>, id: string) => doc(f, `parties/${PID}/attendance/${id}`);

  test('파티원은 공개 출석을 읽고, 외부인은 못 읽는다', async () => {
    await assertSucceeds(getDocs(collection(db('bob'), `parties/${PID}/attendance`)));
    await assertFails(getDocs(collection(db('mallory'), `parties/${PID}/attendance`)));
  });

  test('동의했고 숨기지 않은 본인만 출석을 올린다', async () => {
    await assertSucceeds(setDoc(ref(db('alice'), 'alice_2026-10-10'), attendance('alice', '2026-10-10')));
  });

  test('공유에 동의하지 않은 파티원은 못 올린다', async () => {
    await assertFails(setDoc(ref(db('bob'), 'bob_2026-10-09'), attendance('bob')));
  });

  test('숨김 상태면 못 올린다', async () => {
    await assertFails(setDoc(ref(db('carol'), 'carol_2026-10-09'), attendance('carol')));
  });

  test('남의 출석은 만들 수 없다(문서 ID·uid 둘 다)', async () => {
    await assertFails(setDoc(ref(db('alice'), 'owner_2026-10-09'), attendance('owner')));
    await assertFails(setDoc(ref(db('alice'), 'alice_2026-10-11'), attendance('owner', '2026-10-11')));
    await assertFails(setDoc(ref(db('alice'), 'alice_2026-10-12'), attendance('alice', '2026-10-11')));
  });

  test('좌표 같은 다른 필드는 올릴 수 없다', async () => {
    await assertFails(
      setDoc(ref(db('alice'), 'alice_2026-10-10'), attendance('alice', '2026-10-10', { lat: 37.5 })),
    );
  });

  test('숨기면 본인 공개 출석을 지울 수 있다', async () => {
    const f = db('alice');
    await assertSucceeds(updateDoc(doc(f, `parties/${PID}/members/alice`), { hidden: true }));
    await assertSucceeds(deleteDoc(ref(f, 'alice_2026-10-09')));
  });

  test('탈퇴: 공개 출석 지운 뒤 멤버십 제거, 이후 읽기 거부', async () => {
    const f = db('alice');
    await assertSucceeds(deleteDoc(ref(f, 'alice_2026-10-09')));
    await assertSucceeds(deleteDoc(doc(f, `parties/${PID}/members/alice`)));
    await assertFails(getDocs(collection(f, `parties/${PID}/attendance`)));
    await assertFails(setDoc(ref(f, 'alice_2026-10-10'), attendance('alice', '2026-10-10')));
  });

  test('남의 공개 출석은 못 지우지만, 파티장은 지울 수 있다', async () => {
    await assertFails(deleteDoc(ref(db('bob'), 'alice_2026-10-09')));
    await assertSucceeds(deleteDoc(ref(db('owner'), 'alice_2026-10-09')));
  });
});

describe('기구(D9)', () => {
  const machine = (by: string) => ({ name: '레그프레스', kind: 'machine', exerciseIds: ['leg_press'], createdBy: by, createdAt: 2 });
  const photo = (by: string, over: Record<string, unknown> = {}) => ({
    modelId: 'mnv3-small-100',
    dim: 3,
    vector: [0.1, 0.2, 0.3],
    createdBy: by,
    createdAt: 2,
    ...over,
  });

  test('파티원은 기구를 등록하고, 외부인은 못 본다', async () => {
    await assertSucceeds(setDoc(doc(db('bob'), `parties/${PID}/machines/m2`), machine('bob')));
    await assertFails(setDoc(doc(db('bob'), `parties/${PID}/machines/m3`), machine('alice')));
    await assertFails(getDoc(doc(db('mallory'), `parties/${PID}/machines/m1`)));
    await assertFails(setDoc(doc(db('mallory'), `parties/${PID}/machines/m4`), machine('mallory')));
  });

  test('삭제는 등록자 또는 파티장만', async () => {
    await assertFails(deleteDoc(doc(db('bob'), `parties/${PID}/machines/m1`)));
    await assertSucceeds(deleteDoc(doc(db('owner'), `parties/${PID}/machines/m1`)));
  });

  test('등록자는 수정하지만 등록자 필드는 못 바꾼다', async () => {
    const r = doc(db('alice'), `parties/${PID}/machines/m1`);
    await assertSucceeds(updateDoc(r, { exerciseIds: ['squat', 'bench_press'] }));
    await assertFails(updateDoc(r, { createdBy: 'bob' }));
    await assertFails(updateDoc(doc(db('bob'), `parties/${PID}/machines/m1`), { name: '바꿈' }));
  });

  test('탈퇴자가 등록한 기구는 남고, 파티장이 관리한다', async () => {
    await assertSucceeds(deleteDoc(doc(db('alice'), `parties/${PID}/members/alice`)));
    await assertSucceeds(getDoc(doc(db('bob'), `parties/${PID}/machines/m1`)));
    await assertSucceeds(updateDoc(doc(db('owner'), `parties/${PID}/machines/m1`), { name: '스미스 1' }));
  });

  test('사진은 파티원 누구나 추가, model_id·dim·벡터 길이가 맞아야 한다(D5·D16)', async () => {
    const r = (id: string) => doc(db('bob'), `parties/${PID}/machines/m1/photos/${id}`);
    await assertSucceeds(setDoc(r('ph2'), photo('bob')));
    await assertFails(setDoc(r('ph3'), photo('bob', { dim: 4 })));
    const { modelId: _, ...noModel } = photo('bob');
    await assertFails(setDoc(r('ph4'), noModel));
    await assertFails(setDoc(r('ph5'), photo('alice')));
    // 썸네일·사진은 공유하지 않는다(D1).
    await assertFails(setDoc(r('ph6'), photo('bob', { thumb: 'data:image/jpeg;base64,AAAA' })));
    await assertFails(setDoc(doc(db('bob'), `parties/${PID}/machines/none/photos/x`), photo('bob')));
  });

  test('사진은 고치지 않고, 찍은 사람·기구 등록자·파티장만 지운다', async () => {
    await assertFails(
      updateDoc(doc(db('bob'), `parties/${PID}/machines/m1/photos/ph1`), { vector: [0, 0] }),
    );
    await assertFails(deleteDoc(doc(db('carol'), `parties/${PID}/machines/m1/photos/ph1`)));
    await assertSucceeds(deleteDoc(doc(db('alice'), `parties/${PID}/machines/m1/photos/ph1`)));
  });
});

describe('스포터 결과 pending_spots(D4)', () => {
  const spot = (spotter: string, lifter: string, over: Record<string, unknown> = {}) => ({
    spotterId: spotter,
    lifterId: lifter,
    exerciseId: 'squat',
    variant: 'barbell',
    weightKg: 60,
    reps: 8,
    status: 'pending',
    createdAt: serverTimestamp(),
    ...over,
  });

  // 만료 경계는 createdAt 을 과거로 돌려 넣어 확인한다(규칙 검사를 끈 채).
  const seed = (id: string, ageMs: number, status = 'pending') =>
    env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), `parties/${PID}/pending_spots/${id}`), {
        ...spot('bob', 'alice', { status }),
        createdAt: Timestamp.fromMillis(Date.now() - ageMs),
      }),
    );

  test('촬영자가 파티원 리프터에게 만든다. createdAt 은 서버 시각이어야 한다', async () => {
    const f = db('bob');
    await assertSucceeds(setDoc(doc(f, `parties/${PID}/pending_spots/x0`), spot('bob', 'alice')));
    // 클라이언트 시계로 적으면(만료를 늦추려는 경우 포함) 거부.
    await assertFails(
      setDoc(doc(f, `parties/${PID}/pending_spots/x1`), {
        ...spot('bob', 'alice'),
        createdAt: Timestamp.fromMillis(Date.now() + 3600e3),
      }),
    );
    await assertFails(
      setDoc(doc(f, `parties/${PID}/pending_spots/x2`), spot('bob', 'alice', { status: 'confirmed' })),
    );
  });

  test('남을 촬영자로 적거나, 외부인·본인을 리프터로 지정할 수 없다', async () => {
    const f = db('bob');
    await assertFails(setDoc(doc(f, `parties/${PID}/pending_spots/y1`), spot('alice', 'owner')));
    await assertFails(setDoc(doc(f, `parties/${PID}/pending_spots/y2`), spot('bob', 'mallory')));
    await assertFails(setDoc(doc(f, `parties/${PID}/pending_spots/y3`), spot('bob', 'bob')));
    await assertFails(
      setDoc(doc(db('mallory'), `parties/${PID}/pending_spots/y4`), spot('mallory', 'alice')),
    );
  });

  test('촬영자와 리프터만 읽는다. 리프터는 자기 대기 목록을 쿼리한다', async () => {
    await seed('s1', 3600e3);
    await assertSucceeds(getDoc(doc(db('bob'), `parties/${PID}/pending_spots/s1`)));
    await assertSucceeds(getDoc(doc(db('alice'), `parties/${PID}/pending_spots/s1`)));
    await assertFails(getDoc(doc(db('owner'), `parties/${PID}/pending_spots/s1`)));
    await assertSucceeds(
      getDocs(query(collection(db('alice'), `parties/${PID}/pending_spots`), where('lifterId', '==', 'alice'))),
    );
    await assertFails(getDocs(collection(db('alice'), `parties/${PID}/pending_spots`)));
  });

  test('리프터만 확정하고, 확정하며 횟수를 고칠 수 있다', async () => {
    await seed('s1', 3600e3);
    await assertFails(updateDoc(doc(db('bob'), `parties/${PID}/pending_spots/s1`), { status: 'confirmed' }));
    await assertFails(
      updateDoc(doc(db('alice'), `parties/${PID}/pending_spots/s1`), { status: 'confirmed', weightKg: 100 }),
    );
    await assertSucceeds(
      updateDoc(doc(db('alice'), `parties/${PID}/pending_spots/s1`), { status: 'confirmed', reps: 7 }),
    );
  });

  test('한 번 확정한 것은 다시 못 바꾼다', async () => {
    await seed('s1', 3600e3, 'confirmed');
    await assertFails(updateDoc(doc(db('alice'), `parties/${PID}/pending_spots/s1`), { status: 'rejected' }));
  });

  test('24시간이 지나면 확정할 수 없다', async () => {
    await seed('s1', 24 * 3600e3 + 1000);
    await assertFails(updateDoc(doc(db('alice'), `parties/${PID}/pending_spots/s1`), { status: 'confirmed' }));
    // 만료된 것은 지워서 정리한다.
    await assertSucceeds(deleteDoc(doc(db('alice'), `parties/${PID}/pending_spots/s1`)));
  });
});
