import {
  SIZE, SHOGI, CHESS, other, HAND_ORDER, SHOGI_LABEL, SHOGI_PROMOTED_LABEL, CHESS_GLYPH, CHESS_NAME,
  createInitialState, legalMoves, makeMove, resign, isInCheck, chooseCpuMove, pieceLabel, squareName,
} from './engine.js';
import { Net, normalizeCode } from './net.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const TEXT_VS = '︎'; // チェスの記号を絵文字ではなく文字として表示させる
const SIDE_NAME = { S: '将棋軍', C: 'チェス軍' };
const SIDE_ICON = { S: '玉', C: CHESS_GLYPH.K + TEXT_VS };

const ui = {
  mode: null, // 'local' | 'cpu' | 'online'
  game: createInitialState(),
  mySide: null, // null = 両方操作できる（ふたりで対戦）
  flipped: false,
  sel: null, // { kind: 'sq', r, c } | { kind: 'hand', t }
  moves: [], // 現局面の合法手キャッシュ
  cpuTimer: null,
  // オンライン
  hostSide: 'R',
  rematchMine: false,
  rematchTheirs: false,
};

const net = new Net({
  onOpen: () => {
    setNetStatus('接続しました');
    $('chat').hidden = false;
    if (net.isHost) startOnlineGame();
  },
  onMessage: handleNetMessage,
  onClose: () => {
    setNetStatus('相手との接続が切れました');
    ui.rematchMine = ui.rematchTheirs = false;
    $('rematch-btn').hidden = true;
    render();
  },
  onError: (err) => {
    const msg = err.type === 'peer-unavailable'
      ? 'その部屋は見つかりませんでした（コードを確認してください）'
      : `通信エラー: ${err.message || err.type}`;
    setNetStatus(msg);
    setStatus(msg);
  },
});

// ---------- 状態更新 ----------

function setGame(state) {
  ui.game = state;
  ui.moves = legalMoves(state);
  ui.sel = null;
  render();
  scheduleCpu();
  if (ui.mode === 'online' && state.result) showRematch();
}

function canAct(side) {
  const g = ui.game;
  if (!ui.mode || g.result || g.turn !== side) return false;
  if (ui.mode === 'online' && !net.connected) return false;
  return ui.mySide === null || ui.mySide === side;
}

function play(move) {
  const next = makeMove(ui.game, move);
  if (!next) return false;
  if (ui.mode === 'online') net.send({ t: 'move', move, ply: ui.game.ply });
  setGame(next);
  return true;
}

function scheduleCpu() {
  clearTimeout(ui.cpuTimer);
  const g = ui.game;
  if (ui.mode !== 'cpu' || g.result || g.turn === ui.mySide) return;
  ui.cpuTimer = setTimeout(() => {
    const m = chooseCpuMove(ui.game);
    if (m) play(m);
  }, 350);
}

// ---------- 入力 ----------

function onSquare(r, c) {
  const g = ui.game;
  if (ui.sel) {
    const cands = ui.moves.filter((m) => m.to[0] === r && m.to[1] === c && matchesSel(m));
    if (cands.length === 1) { play(cands[0]); return; }
    if (cands.length > 1) { choosePromotion(cands).then((m) => m && play(m)); return; }
  }
  const p = g.board[r][c];
  if (p && canAct(p.side) && !(ui.sel && ui.sel.kind === 'sq' && ui.sel.r === r && ui.sel.c === c)) {
    ui.sel = { kind: 'sq', r, c };
  } else {
    ui.sel = null;
  }
  render();
}

function onHand(t) {
  if (!canAct(SHOGI)) return;
  ui.sel = ui.sel && ui.sel.kind === 'hand' && ui.sel.t === t ? null : { kind: 'hand', t };
  render();
}

function matchesSel(m) {
  const s = ui.sel;
  if (!s) return false;
  if (s.kind === 'hand') return m.drop === s.t;
  return !!m.from && m.from[0] === s.r && m.from[1] === s.c;
}

function choosePromotion(cands) {
  const dlg = $('promo-dialog');
  const box = $('promo-choices');
  box.replaceChildren();
  const chess = typeof cands[0].promote === 'string';
  $('promo-title').textContent = chess ? 'ポーンを何に昇格しますか？' : '成りますか？';
  return new Promise((resolve) => {
    let chosen = null;
    for (const m of cands) {
      const label = chess ? `${CHESS_GLYPH[m.promote]}${TEXT_VS} ${CHESS_NAME[m.promote]}` : (m.promote ? '成る' : '成らない');
      const b = el('button', m.promote === false ? 'ghost' : '', label);
      b.type = 'submit';
      b.addEventListener('click', () => { chosen = m; });
      box.append(b);
    }
    dlg.addEventListener('close', () => resolve(chosen), { once: true });
    dlg.showModal();
  });
}

// ---------- 描画 ----------

function render() {
  renderBoard();
  renderBars();
  renderLog();
  renderStatus();
  $('resign-btn').disabled = !ui.mode || !!ui.game.result
    || (ui.mode === 'online' && !net.connected);
  $('new-btn').hidden = ui.mode === 'online';
}

function renderBoard() {
  const g = ui.game;
  const board = $('board');
  board.replaceChildren();
  const selMoves = ui.sel ? ui.moves.filter(matchesSel) : [];
  const last = g.lastMove;
  const checkSide = !g.result || g.result.reason === 'checkmate' ? g.turn : null;
  const checkKing = checkSide && isInCheck(g, checkSide) ? checkSide : null;

  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE; j++) {
      const r = ui.flipped ? SIZE - 1 - i : i;
      const c = ui.flipped ? SIZE - 1 - j : j;
      const sq = el('div', 'sq');
      if (r <= 2) sq.classList.add('zone-c');
      if (r >= SIZE - 3) sq.classList.add('zone-s');
      if (last && ((last.from && last.from[0] === r && last.from[1] === c) || (last.to[0] === r && last.to[1] === c))) {
        sq.classList.add('last');
      }
      if (ui.sel && ui.sel.kind === 'sq' && ui.sel.r === r && ui.sel.c === c) sq.classList.add('sel');
      const p = g.board[r][c];
      if (selMoves.some((m) => m.to[0] === r && m.to[1] === c)) {
        sq.classList.add('target');
        if (p) sq.classList.add('capture');
      }
      if (p) {
        if (checkKing && p.side === checkKing && (p.type === 'OU' || p.type === 'K')) sq.classList.add('check');
        sq.append(pieceEl(p));
      }
      if (i === SIZE - 1) sq.append(el('span', 'coord file', 'abcdefghi'[c]));
      if (j === 0) sq.append(el('span', 'coord rank', String(SIZE - r)));
      sq.title = squareName([r, c]);
      sq.addEventListener('click', () => onSquare(r, c));
      board.append(sq);
    }
  }
}

function pieceEl(p) {
  if (p.side === SHOGI) {
    const k = el('div', 'koma', pieceLabel(p));
    if (p.promoted) k.classList.add('promoted');
    if (ui.flipped) k.classList.add('down');
    return k;
  }
  return el('div', 'chessman', CHESS_GLYPH[p.type] + TEXT_VS);
}

function sideTag(side) {
  if (ui.mode === 'cpu') return side === ui.mySide ? 'あなた' : 'CPU';
  if (ui.mode === 'online') return side === ui.mySide ? 'あなた' : '相手';
  return '';
}

function renderBars() {
  const g = ui.game;
  const topSide = ui.flipped ? SHOGI : CHESS;
  for (const [id, side] of [['bar-top', topSide], ['bar-bottom', other(topSide)]]) {
    const bar = $(id);
    bar.replaceChildren();
    bar.classList.toggle('to-move', !g.result && g.turn === side);
    const name = el('span', 'side-name', `${SIDE_ICON[side]} ${SIDE_NAME[side]}`);
    bar.append(name);
    const tag = sideTag(side);
    if (tag) bar.append(el('span', 'side-tag', tag));

    if (side === SHOGI) {
      const hand = el('div', 'hand');
      for (const t of HAND_ORDER) {
        const n = g.hand[t];
        if (!n) continue;
        const b = el('button', 'hand-piece');
        b.title = `持ち駒: ${SHOGI_LABEL[t]}`;
        const k = el('div', 'koma', SHOGI_LABEL[t]);
        b.append(k);
        if (n > 1) b.append(el('span', 'count', String(n)));
        if (ui.sel && ui.sel.kind === 'hand' && ui.sel.t === t) b.classList.add('sel');
        b.addEventListener('click', () => onHand(t));
        hand.append(b);
      }
      if (!hand.childElementCount) hand.append(el('span', 'side-tag', '持ち駒なし'));
      bar.append(hand);
    } else if (g.captured.length) {
      const caps = g.captured.map((t) => SHOGI_LABEL[t]).join('');
      bar.append(el('span', 'captured', `取った駒: ${caps}`));
    }
  }
}

function renderLog() {
  const log = $('log');
  log.replaceChildren();
  ui.game.history.forEach((h, i) => {
    const li = el('li', i % 2 === 0 ? 'c' : 's', h.notation.replace(/[♚♛♜♝♞♟]/g, (ch) => ch + TEXT_VS));
    log.append(li);
  });
  log.scrollTop = log.scrollHeight;
}

const REASON = {
  checkmate: '詰み', resign: '投了', stalemate: 'ステイルメイト（引き分け）',
  'move-limit': '手数上限（引き分け）', disconnect: '切断',
};

function renderStatus() {
  const g = ui.game;
  if (!ui.mode) { setStatus('上のボタンからモードを選んでください'); return; }
  if (ui.mode === 'online' && !net.connected && !g.history.length && !g.result) {
    setStatus('対戦相手を待っています…');
    return;
  }
  if (g.result) {
    const { winner, reason } = g.result;
    if (!winner) { setStatus(`${REASON[reason]}`); return; }
    const who = ui.mySide ? (winner === ui.mySide ? 'あなたの勝ち！' : 'あなたの負け…') : `${SIDE_NAME[winner]}の勝ち！`;
    setStatus(`${REASON[reason]}で${who}`);
    return;
  }
  const check = isInCheck(g, g.turn) ? '　王手！' : '';
  if (ui.mySide) {
    const mine = g.turn === ui.mySide;
    setStatus(`${mine ? 'あなた' : (ui.mode === 'cpu' ? 'CPU' : '相手')}の番（${SIDE_NAME[g.turn]}）${check}`);
  } else {
    setStatus(`${SIDE_NAME[g.turn]}の番${check}`);
  }
}

function setStatus(text) { $('status').textContent = text; }
function setNetStatus(text) { $('net-status').textContent = text; }

// ---------- モード ----------

function setMode(mode) {
  if (ui.mode === 'online' && mode !== 'online') leaveOnline();
  ui.mode = mode;
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('online-box').hidden = mode !== 'online';
  $('cpu-box').hidden = mode !== 'cpu';
  if (mode === 'local') {
    ui.mySide = null;
    ui.flipped = false;
    setGame(createInitialState());
  } else if (mode === 'cpu') {
    startCpu();
  } else if (mode === 'online') {
    ui.mySide = null;
    showLobby(true);
    clearTimeout(ui.cpuTimer);
    setGame(createInitialState());
  }
}

function startCpu() {
  ui.mySide = $('cpu-side').value;
  ui.flipped = ui.mySide === CHESS;
  setGame(createInitialState());
}

// ---------- オンライン ----------

function showLobby(lobby) {
  $('online-lobby').hidden = !lobby;
  $('online-room').hidden = lobby;
  if (lobby) {
    $('chat').hidden = true;
    $('chat-log').replaceChildren();
  }
}

function inviteLink(code) {
  const u = new URL(location.href);
  u.searchParams.delete('room');
  u.searchParams.set('room', code);
  u.hash = '';
  return u.toString();
}

async function hostRoom() {
  ui.hostSide = $('host-side').value;
  showLobby(false);
  $('room-code').textContent = '……';
  setNetStatus('部屋を作成中…');
  try {
    const code = await net.host();
    $('room-code').textContent = code;
    setNetStatus('招待リンクかコードを相手に送ってください。相手の参加を待っています…');
    render();
  } catch (err) {
    setNetStatus(`部屋を作れませんでした: ${err.message || err.type || err}`);
  }
}

async function joinRoom(raw) {
  const code = normalizeCode(raw || '');
  if (code.length < 4) { setNetStatus('部屋コードを入力してください'); return; }
  showLobby(false);
  $('room-code').textContent = code;
  setNetStatus('接続中…');
  try {
    await net.join(code);
  } catch {
    // エラー内容は onError で表示済み。「退出」でロビーに戻れる
  }
}

function leaveOnline() {
  net.close();
  ui.rematchMine = ui.rematchTheirs = false;
  $('rematch-btn').hidden = true;
  showLobby(true);
  setNetStatus('');
  const u = new URL(location.href);
  if (u.searchParams.has('room')) {
    u.searchParams.delete('room');
    history.replaceState(null, '', u);
  }
}

// ホストが陣営を決めて対局開始を通知する
function startOnlineGame(moves = []) {
  if (!net.isHost) return;
  if (!moves.length && (ui.mySide === null || ui.hostSide === 'R')) {
    ui.mySide = ui.hostSide === 'R' ? (Math.random() < 0.5 ? SHOGI : CHESS) : ui.hostSide;
    ui.hostSide = ui.mySide; // 再戦時はここから交代
  }
  net.send({ t: 'start', guestSide: other(ui.mySide), moves });
  beginOnline(ui.mySide, moves);
}

function beginOnline(side, moves) {
  ui.mySide = side;
  ui.flipped = side === CHESS;
  ui.rematchMine = ui.rematchTheirs = false;
  $('rematch-btn').hidden = true;
  $('rematch-btn').textContent = '再戦（陣営を交代）';
  let s = createInitialState();
  for (const m of moves) {
    const n = makeMove(s, m);
    if (!n) break;
    s = n;
  }
  setGame(s);
}

function requestSync() {
  if (net.isHost) startOnlineGame(ui.game.history.map((h) => h.move));
  else net.send({ t: 'sync-req' });
}

function handleNetMessage(msg) {
  switch (msg.t) {
    case 'start':
      if (!net.isHost && (msg.guestSide === SHOGI || msg.guestSide === CHESS) && Array.isArray(msg.moves)) {
        beginOnline(msg.guestSide, msg.moves);
        setNetStatus(`接続中 — あなたは${SIDE_NAME[msg.guestSide]}です`);
      }
      break;
    case 'move': {
      if (msg.ply !== ui.game.ply || ui.game.turn === ui.mySide) { requestSync(); break; }
      const next = makeMove(ui.game, msg.move);
      if (!next) { requestSync(); break; }
      setGame(next);
      break;
    }
    case 'sync-req':
      if (net.isHost) requestSync();
      break;
    case 'resign':
      if (!ui.game.result && ui.mySide) {
        setGame(resign(ui.game, other(ui.mySide)));
        showRematch();
      }
      break;
    case 'rematch':
      ui.rematchTheirs = true;
      if (ui.rematchMine) doRematch();
      else {
        showRematch();
        $('rematch-btn').textContent = '再戦を受ける';
        addChat('system', '相手が再戦を希望しています');
      }
      break;
    case 'chat':
      if (typeof msg.text === 'string') addChat('them', msg.text.slice(0, 200));
      break;
    case 'full':
      setNetStatus('その部屋はすでに満員です');
      break;
    default:
      break;
  }
}

function showRematch() {
  if (net.connected) $('rematch-btn').hidden = false;
}

function doRematch() {
  if (net.isHost) {
    ui.hostSide = other(ui.mySide);
    ui.mySide = ui.hostSide;
    startOnlineGame();
  }
}

function addChat(who, text) {
  const line = el('div', who === 'me' ? 'me' : '');
  const name = who === 'me' ? 'あなた' : who === 'them' ? '相手' : '＊';
  line.textContent = `${name}: ${text}`;
  $('chat-log').append(line);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}

// ---------- イベント ----------

document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('rules-btn').addEventListener('click', () => $('rules-dialog').showModal());
$('flip-btn').addEventListener('click', () => { ui.flipped = !ui.flipped; render(); });
$('new-btn').addEventListener('click', () => {
  if (ui.mode === 'cpu') startCpu();
  else setMode(ui.mode || 'local');
});
$('cpu-start-btn').addEventListener('click', startCpu);
$('resign-btn').addEventListener('click', () => {
  const g = ui.game;
  if (g.result || !ui.mode) return;
  const side = ui.mySide || g.turn;
  if (!confirm(`${SIDE_NAME[side]}が投了しますか？`)) return;
  if (ui.mode === 'online') { net.send({ t: 'resign' }); showRematch(); }
  setGame(resign(g, side));
});
$('host-btn').addEventListener('click', hostRoom);
$('join-btn').addEventListener('click', () => joinRoom($('join-code').value));
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('join-code').value); });
$('leave-btn').addEventListener('click', () => { leaveOnline(); ui.mySide = null; setGame(createInitialState()); });
$('copy-link-btn').addEventListener('click', async () => {
  const link = inviteLink(net.code || $('room-code').textContent);
  try {
    await navigator.clipboard.writeText(link);
    setNetStatus('招待リンクをコピーしました');
  } catch {
    prompt('このリンクを相手に送ってください', link);
  }
});
$('rematch-btn').addEventListener('click', () => {
  ui.rematchMine = true;
  net.send({ t: 'rematch' });
  $('rematch-btn').textContent = '相手の返事を待っています…';
  if (ui.rematchTheirs) doRematch();
});
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text || !net.connected) return;
  net.send({ t: 'chat', text });
  addChat('me', text);
  $('chat-input').value = '';
});

// ---------- 起動 ----------

const params = new URLSearchParams(location.search);
const room = params.get('room');
render();
if (room) {
  setMode('online');
  $('join-code').value = room;
  // PeerJS は defer 読み込みなので load 後に接続
  if (window.Peer) joinRoom(room);
  else window.addEventListener('load', () => joinRoom(room), { once: true });
} else {
  setMode('local');
}
