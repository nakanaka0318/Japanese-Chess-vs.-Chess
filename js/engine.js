// 将棋 vs チェス — ルールエンジン（UI・通信から独立。Node でもブラウザでも動く）
//
// 盤面: 9x9。row 0 が上（チェス陣）、row 8 が下（将棋陣）。
// 陣営: 'S' = 将棋（上方向に進む）、'C' = チェス（下方向に進む）。
// 先手はチェス（白番の伝統に合わせる）。将棋側は持ち駒を打てるのが最大の武器。

export const SIZE = 9;
export const SHOGI = 'S';
export const CHESS = 'C';

export const other = (side) => (side === SHOGI ? CHESS : SHOGI);
const forward = (side) => (side === SHOGI ? -1 : 1);
const inBoard = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

// 将棋の駒: OU 玉, HI 飛, KA 角, KI 金, GI 銀, KE 桂, KY 香, FU 歩
// チェスの駒: K, Q, R, B, N, P
export const SHOGI_LABEL = {
  OU: '玉', HI: '飛', KA: '角', KI: '金', GI: '銀', KE: '桂', KY: '香', FU: '歩',
};
export const SHOGI_PROMOTED_LABEL = {
  HI: '龍', KA: '馬', GI: '全', KE: '圭', KY: '杏', FU: 'と',
};
export const CHESS_GLYPH = {
  K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟',
};
export const CHESS_NAME = {
  K: 'キング', Q: 'クイーン', R: 'ルーク', B: 'ビショップ', N: 'ナイト', P: 'ポーン',
};

// 将棋側がチェスの駒を取ったとき、何の持ち駒になるか
export const CAPTURE_TO_HAND = { P: 'FU', N: 'KE', B: 'KA', R: 'HI', Q: 'HI' };
export const HAND_ORDER = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU'];
export const CHESS_PROMOTIONS = ['Q', 'R', 'B', 'N'];
const PROMOTABLE = new Set(['HI', 'KA', 'GI', 'KE', 'KY', 'FU']);
export const MAX_PLIES = 400;

const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const KNIGHT_JUMPS = [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]];

const goldSteps = (f) => [[f, -1], [f, 0], [f, 1], [0, -1], [0, 1], [-f, 0]];
const silverSteps = (f) => [[f, -1], [f, 0], [f, 1], [-f, -1], [-f, 1]];

const piece = (side, type, promoted = false) => ({ side, type, promoted });

export function createInitialState() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  // チェス陣（上）: ルーク・ナイト・ビショップ・ナイト・キング・クイーン・ビショップ・ナイト・ルーク
  const back = ['R', 'N', 'B', 'N', 'K', 'Q', 'B', 'N', 'R'];
  back.forEach((t, c) => { board[0][c] = piece(CHESS, t); });
  for (let c = 0; c < SIZE; c++) board[1][c] = piece(CHESS, 'P');
  // 将棋陣（下）: 通常の平手配置
  const shogiBack = ['KY', 'KE', 'GI', 'KI', 'OU', 'KI', 'GI', 'KE', 'KY'];
  shogiBack.forEach((t, c) => { board[8][c] = piece(SHOGI, t); });
  board[7][1] = piece(SHOGI, 'KA');
  board[7][7] = piece(SHOGI, 'HI');
  for (let c = 0; c < SIZE; c++) board[6][c] = piece(SHOGI, 'FU');
  return {
    board,
    hand: { HI: 0, KA: 0, KI: 0, GI: 0, KE: 0, KY: 0, FU: 0 }, // 将棋側の持ち駒
    captured: [], // チェス側が取った将棋の駒（表示用）
    turn: CHESS,
    ply: 0,
    lastMove: null,
    result: null, // { winner: 'S'|'C'|null, reason }
    history: [],
  };
}

export function cloneState(s) {
  return {
    board: s.board.map((row) => row.map((p) => (p ? { ...p } : null))),
    hand: { ...s.hand },
    captured: [...s.captured],
    turn: s.turn,
    ply: s.ply,
    lastMove: s.lastMove,
    result: s.result,
    history: [...s.history],
  };
}

function findKing(board, side) {
  const kt = side === SHOGI ? 'OU' : 'K';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (p && p.side === side && p.type === kt) return [r, c];
    }
  }
  return null;
}

// 駒が (r,c) から到達できるマス（自駒のマスは除く）。attackOnly=true なら利きのみ（ポーン前進を除く）
function pieceTargets(board, r, c, attackOnly = false) {
  const p = board[r][c];
  const f = forward(p.side);
  const out = [];
  const step = (dr, dc) => {
    const nr = r + dr, nc = c + dc;
    if (!inBoard(nr, nc)) return;
    const t = board[nr][nc];
    if (!t || t.side !== p.side) out.push([nr, nc]);
  };
  const slide = (dr, dc) => {
    let nr = r + dr, nc = c + dc;
    while (inBoard(nr, nc)) {
      const t = board[nr][nc];
      if (t) {
        if (t.side !== p.side) out.push([nr, nc]);
        break;
      }
      out.push([nr, nc]);
      nr += dr; nc += dc;
    }
  };

  if (p.side === SHOGI) {
    const gold = p.promoted && ['GI', 'KE', 'KY', 'FU'].includes(p.type);
    if (gold || p.type === 'KI') goldSteps(f).forEach(([a, b]) => step(a, b));
    else if (p.type === 'OU') KING_STEPS.forEach(([a, b]) => step(a, b));
    else if (p.type === 'GI') silverSteps(f).forEach(([a, b]) => step(a, b));
    else if (p.type === 'KE') { step(2 * f, -1); step(2 * f, 1); }
    else if (p.type === 'KY') slide(f, 0);
    else if (p.type === 'FU') step(f, 0);
    else if (p.type === 'HI') {
      ORTHO.forEach(([a, b]) => slide(a, b));
      if (p.promoted) DIAG.forEach(([a, b]) => step(a, b));
    } else if (p.type === 'KA') {
      DIAG.forEach(([a, b]) => slide(a, b));
      if (p.promoted) ORTHO.forEach(([a, b]) => step(a, b));
    }
    return out;
  }

  switch (p.type) {
    case 'K': KING_STEPS.forEach(([a, b]) => step(a, b)); break;
    case 'Q': ORTHO.concat(DIAG).forEach(([a, b]) => slide(a, b)); break;
    case 'R': ORTHO.forEach(([a, b]) => slide(a, b)); break;
    case 'B': DIAG.forEach(([a, b]) => slide(a, b)); break;
    case 'N': KNIGHT_JUMPS.forEach(([a, b]) => step(a, b)); break;
    case 'P': {
      // 斜め取り
      for (const dc of [-1, 1]) {
        const nr = r + f, nc = c + dc;
        if (!inBoard(nr, nc)) continue;
        const t = board[nr][nc];
        if (attackOnly || (t && t.side !== p.side)) out.push([nr, nc]);
      }
      if (!attackOnly) {
        const nr = r + f;
        if (inBoard(nr, c) && !board[nr][c]) {
          out.push([nr, c]);
          const startRow = p.side === CHESS ? 1 : SIZE - 2;
          if (r === startRow && !board[nr + f][c]) out.push([nr + f, c]);
        }
      }
      break;
    }
    default: break;
  }
  return out;
}

export function isSquareAttacked(board, r, c, bySide) {
  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE; j++) {
      const p = board[i][j];
      if (!p || p.side !== bySide) continue;
      if (pieceTargets(board, i, j, true).some(([a, b]) => a === r && b === c)) return true;
    }
  }
  return false;
}

export function isInCheck(state, side) {
  const k = findKing(state.board, side);
  if (!k) return true;
  return isSquareAttacked(state.board, k[0], k[1], other(side));
}

const inZone = (side, r) => (side === SHOGI ? r <= 2 : r >= SIZE - 3);
// その段に置くと二度と動けない駒か（強制成り・打ち禁止の判定）
function isDeadEnd(type, side, r) {
  const last = side === SHOGI ? 0 : SIZE - 1;
  const dist = Math.abs(r - last);
  if (type === 'FU' || type === 'KY') return dist === 0;
  if (type === 'KE') return dist <= 1;
  return false;
}

// 疑似合法手（自玉の安全は未確認）
function pseudoMoves(state, side, withDrops = true) {
  const { board } = state;
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p || p.side !== side) continue;
      for (const [tr, tc] of pieceTargets(board, r, c)) {
        const base = { from: [r, c], to: [tr, tc] };
        if (side === SHOGI) {
          const canPromote = !p.promoted && PROMOTABLE.has(p.type) && (inZone(side, r) || inZone(side, tr));
          if (canPromote) {
            moves.push({ ...base, promote: true });
            if (!isDeadEnd(p.type, side, tr)) moves.push({ ...base, promote: false });
          } else {
            moves.push(base);
          }
        } else if (p.type === 'P' && tr === SIZE - 1) {
          CHESS_PROMOTIONS.forEach((pt) => moves.push({ ...base, promote: pt }));
        } else {
          moves.push(base);
        }
      }
    }
  }
  if (side === SHOGI && withDrops) {
    for (const t of HAND_ORDER) {
      if (!state.hand[t]) continue;
      for (let r = 0; r < SIZE; r++) {
        if (isDeadEnd(t, side, r)) continue;
        for (let c = 0; c < SIZE; c++) {
          if (board[r][c]) continue;
          if (t === 'FU' && hasUnpromotedPawnInFile(board, c)) continue; // 二歩
          moves.push({ drop: t, to: [r, c] });
        }
      }
    }
  }
  return moves;
}

function hasUnpromotedPawnInFile(board, c) {
  for (let r = 0; r < SIZE; r++) {
    const p = board[r][c];
    if (p && p.side === SHOGI && p.type === 'FU' && !p.promoted) return true;
  }
  return false;
}

// 盤面のみ更新（履歴・勝敗判定はしない）
function applyRaw(state, move) {
  const s = cloneState(state);
  const side = s.turn;
  const [tr, tc] = move.to;
  if (move.drop) {
    s.board[tr][tc] = piece(SHOGI, move.drop);
    s.hand[move.drop] -= 1;
  } else {
    const [fr, fc] = move.from;
    const p = s.board[fr][fc];
    const target = s.board[tr][tc];
    if (target) {
      if (side === SHOGI) {
        const h = CAPTURE_TO_HAND[target.type];
        if (h) s.hand[h] += 1;
      } else {
        s.captured.push(target.type);
      }
    }
    let moved = { ...p };
    if (side === SHOGI && move.promote) moved.promoted = true;
    if (side === CHESS && p.type === 'P' && typeof move.promote === 'string') moved = piece(CHESS, move.promote);
    s.board[tr][tc] = moved;
    s.board[fr][fc] = null;
  }
  s.turn = other(side);
  s.ply += 1;
  s.lastMove = move;
  return s;
}

function hasAnyLegalMove(state, side) {
  const s = state.turn === side ? state : { ...state, turn: side };
  for (const m of pseudoMoves(s, side)) {
    const next = applyRaw(s, m);
    if (!isInCheck(next, side)) return true;
  }
  return false;
}

export function legalMoves(state) {
  if (state.result) return [];
  const side = state.turn;
  const out = [];
  for (const m of pseudoMoves(state, side)) {
    const next = applyRaw(state, m);
    if (isInCheck(next, side)) continue;
    // 打ち歩詰め禁止
    if (m.drop === 'FU' && isInCheck(next, CHESS) && !hasAnyLegalMove(next, CHESS)) continue;
    out.push(m);
  }
  return out;
}

const sameSq = (a, b) => (!a && !b) || (a && b && a[0] === b[0] && a[1] === b[1]);
export function sameMove(a, b) {
  return sameSq(a.from, b.from) && sameSq(a.to, b.to)
    && (a.drop || null) === (b.drop || null)
    && (a.promote ?? false) === (b.promote ?? false);
}

export function isLegal(state, move) {
  return legalMoves(state).some((m) => sameMove(m, move));
}

// 手を適用し、勝敗まで判定した新しい状態を返す。不正な手なら null。
export function makeMove(state, move) {
  if (!isLegal(state, move)) return null;
  return commit(state, move);
}

// 合法性確認済みの手を適用
function commit(state, move) {
  const s = applyRaw(state, move);
  s.history.push({ move, notation: notate(state, move) });
  const toMove = s.turn;
  if (!hasAnyLegalMove(s, toMove)) {
    s.result = isInCheck(s, toMove)
      ? { winner: other(toMove), reason: 'checkmate' }
      : { winner: null, reason: 'stalemate' };
  } else if (s.ply >= MAX_PLIES) {
    s.result = { winner: null, reason: 'move-limit' };
  }
  return s;
}

export function resign(state, side) {
  const s = cloneState(state);
  s.result = { winner: other(side), reason: 'resign' };
  return s;
}

// --- 表記 ---
// 列は左から a..i、段は下から 1..9（チェス風の座標で両陣営共通）
export const squareName = ([r, c]) => `${'abcdefghi'[c]}${SIZE - r}`;

export function pieceLabel(p) {
  if (p.side === SHOGI) return p.promoted ? SHOGI_PROMOTED_LABEL[p.type] : SHOGI_LABEL[p.type];
  return CHESS_GLYPH[p.type];
}

export function notate(state, move) {
  const to = squareName(move.to);
  if (move.drop) return `${SHOGI_LABEL[move.drop]}打 ${to}`;
  const p = state.board[move.from[0]][move.from[1]];
  const cap = state.board[move.to[0]][move.to[1]] ? 'x' : '-';
  let s = `${pieceLabel(p)} ${squareName(move.from)}${cap}${to}`;
  if (p.side === SHOGI && PROMOTABLE.has(p.type) && !p.promoted
    && (inZone(SHOGI, move.from[0]) || inZone(SHOGI, move.to[0]))) {
    s += move.promote ? ' 成' : ' 不成';
  }
  if (typeof move.promote === 'string') s += `=${CHESS_GLYPH[move.promote]}`;
  return s;
}

// --- 簡易 CPU ---
const VALUE = {
  S: { OU: 0, HI: 10, KA: 8, KI: 6, GI: 5, KE: 4, KY: 3, FU: 1 },
  SP: { HI: 13, KA: 11, GI: 6, KE: 6, KY: 6, FU: 6 },
  C: { K: 0, Q: 14, R: 10, B: 7, N: 6, P: 1.5 },
};
const HAND_VALUE = { HI: 11, KA: 9, KI: 7, GI: 6, KE: 4.5, KY: 3.5, FU: 1.3 };

export function evaluate(state, side) {
  let score = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = state.board[r][c];
      if (!p) continue;
      let v;
      if (p.side === SHOGI) v = p.promoted ? VALUE.SP[p.type] : VALUE.S[p.type];
      else v = VALUE.C[p.type];
      // 前進ボーナス（少しだけ）
      const adv = p.side === SHOGI ? (SIZE - 1 - r) : r;
      v += adv * 0.03;
      score += p.side === side ? v : -v;
    }
  }
  let hand = 0;
  for (const t of HAND_ORDER) hand += state.hand[t] * HAND_VALUE[t];
  score += side === SHOGI ? hand : -hand;
  return score;
}

// 2手読み（自分の手 → 相手の最善応手）。rand で軽くばらつかせる。
export function chooseCpuMove(state, rand = Math.random) {
  const side = state.turn;
  const moves = legalMoves(state);
  if (!moves.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const s1 = commit(state, m);
    let score;
    if (s1.result) {
      score = s1.result.winner === side ? 1e6 : s1.result.winner === null ? 0 : -1e6;
    } else {
      let worst = Infinity;
      for (const r of pseudoMoves(s1, s1.turn, false)) {
        const s2 = applyRaw(s1, r);
        if (isInCheck(s2, s1.turn)) continue;
        if (!findKing(s2.board, side)) { worst = -1e5; break; }
        const v = evaluate(s2, side);
        if (v < worst) worst = v;
      }
      score = worst === Infinity ? 0 : worst;
      if (isInCheck(s1, s1.turn)) score += 0.3;
    }
    score += rand() * 0.25;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
