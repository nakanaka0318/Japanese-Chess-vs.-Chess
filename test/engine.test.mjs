// node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, legalMoves, makeMove, chooseCpuMove, isInCheck,
  SHOGI, CHESS, SIZE,
} from '../js/engine.js';

const empty = (turn) => {
  const s = createInitialState();
  s.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  s.turn = turn;
  return s;
};
const put = (s, r, c, side, type, promoted = false) => { s.board[r][c] = { side, type, promoted }; };

test('初期局面: チェス先手で合法手がある', () => {
  const s = createInitialState();
  assert.equal(s.turn, CHESS);
  const moves = legalMoves(s);
  // ポーン 9 本 × 2 + ナイト（b,d,h 列）の跳ね
  assert.ok(moves.length > 18);
  assert.ok(moves.some((m) => m.from[0] === 1 && m.to[0] === 3), 'ポーンの2マス前進');
});

test('将棋側がチェスの駒を取ると持ち駒になる', () => {
  const s = empty(SHOGI);
  put(s, 8, 4, SHOGI, 'OU');
  put(s, 0, 0, CHESS, 'K');
  put(s, 5, 4, SHOGI, 'FU');
  put(s, 4, 4, CHESS, 'Q');
  const n = makeMove(s, { from: [5, 4], to: [4, 4] });
  assert.ok(n);
  assert.equal(n.hand.HI, 1, 'クイーンは飛車になる');
});

test('二歩は打てない', () => {
  const s = empty(SHOGI);
  put(s, 8, 4, SHOGI, 'OU');
  put(s, 0, 0, CHESS, 'K');
  put(s, 6, 2, SHOGI, 'FU');
  s.hand.FU = 1;
  const drops = legalMoves(s).filter((m) => m.drop === 'FU');
  assert.ok(drops.length > 0);
  assert.ok(drops.every((m) => m.to[1] !== 2));
  assert.ok(drops.every((m) => m.to[0] !== 0), '最上段には打てない');
});

test('打ち歩詰めは禁止', () => {
  const s = empty(SHOGI);
  put(s, 8, 8, SHOGI, 'OU');
  put(s, 0, 4, CHESS, 'K');
  put(s, 0, 3, CHESS, 'R'); // 逃げ道を自駒で塞ぐ
  put(s, 0, 5, CHESS, 'R');
  put(s, 2, 4, SHOGI, 'KI'); // 歩を守る金
  put(s, 2, 3, SHOGI, 'GI'); // d8/f8 への逃げを塞ぐ（銀の利き）
  put(s, 2, 5, SHOGI, 'GI');
  s.hand.FU = 1;
  const n = makeMove(s, { drop: 'FU', to: [1, 4] });
  assert.equal(n, null);
});

test('チェックメイトで勝敗が決まる', () => {
  const s = empty(CHESS);
  put(s, 8, 0, SHOGI, 'OU');
  put(s, 6, 0, SHOGI, 'FU');
  put(s, 6, 1, SHOGI, 'FU');
  put(s, 0, 8, CHESS, 'K');
  put(s, 7, 8, CHESS, 'R');
  put(s, 0, 7, CHESS, 'R');
  const n1 = makeMove(s, { from: [0, 7], to: [8, 7] });
  assert.ok(n1);
  assert.ok(isInCheck(n1, SHOGI));
  assert.deepEqual(n1.result, { winner: CHESS, reason: 'checkmate' });
});

test('将棋の駒は敵陣で成れる・行き所のない駒は強制成り', () => {
  const s = empty(SHOGI);
  put(s, 8, 4, SHOGI, 'OU');
  put(s, 0, 0, CHESS, 'K');
  put(s, 1, 8, SHOGI, 'FU');
  const ms = legalMoves(s).filter((m) => m.from && m.from[0] === 1);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].promote, true);
});

test('チェスのポーンは最終段で昇格', () => {
  const s = empty(CHESS);
  put(s, 8, 0, SHOGI, 'OU');
  put(s, 0, 8, CHESS, 'K');
  put(s, 7, 5, CHESS, 'P');
  const ms = legalMoves(s).filter((m) => m.from && m.from[0] === 7);
  assert.deepEqual(ms.map((m) => m.promote).sort(), ['B', 'N', 'Q', 'R']);
});

test('CPU 同士で数手進めても破綻しない', () => {
  let s = createInitialState();
  for (let i = 0; i < 20 && !s.result; i++) {
    const m = chooseCpuMove(s, () => 0.5);
    assert.ok(m);
    s = makeMove(s, m);
    assert.ok(s, `手 ${i} が合法`);
  }
});
