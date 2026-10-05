// オンライン対戦: PeerJS（WebRTC）で 1 対 1 の P2P 接続を張る。
// シグナリングには PeerJS の公開サーバーを使うので、自前サーバー不要（GitHub Pages だけで動く）。

const PREFIX = 'shogi-vs-chess-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字（I, O, 0, 1）を除く

const randomCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
// ?peerHost=example.com&peerPort=443&peerPath=/ で自前の PeerJS サーバーを使える（テスト・自前運用向け）
function peerOptions() {
  const q = new URLSearchParams(location.search);
  const host = q.get('peerHost');
  if (!host) return {};
  const port = Number(q.get('peerPort') || 443);
  return { host, port, path: q.get('peerPath') || '/', secure: port === 443 };
}

export const normalizeCode = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export class Net {
  // handlers: { onOpen(conn), onMessage(msg), onClose(), onError(err) }
  constructor(handlers) {
    this.h = handlers;
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.code = null;
  }

  ensureLib() {
    if (!window.Peer) throw new Error('通信ライブラリ（PeerJS）を読み込めませんでした。ネットワークを確認してください。');
  }

  host(attempt = 0) {
    this.ensureLib();
    this.close();
    this.isHost = true;
    this.code = randomCode();
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(PREFIX + this.code, peerOptions());
      this.peer = peer;
      peer.on('open', () => resolve(this.code));
      peer.on('connection', (conn) => {
        if (this.conn && this.conn.open) {
          conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); });
          return;
        }
        this.attach(conn);
      });
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id' && attempt < 3) {
          this.host(attempt + 1).then(resolve, reject);
          return;
        }
        reject(err);
        this.h.onError?.(err);
      });
    });
  }

  join(code) {
    this.ensureLib();
    this.close();
    this.isHost = false;
    this.code = normalizeCode(code);
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(peerOptions());
      this.peer = peer;
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + this.code, { reliable: true });
        this.attach(conn);
        conn.on('open', () => resolve());
      });
      peer.on('error', (err) => {
        reject(err);
        this.h.onError?.(err);
      });
    });
  }

  attach(conn) {
    this.conn = conn;
    conn.on('open', () => this.h.onOpen?.(conn));
    conn.on('data', (msg) => {
      if (msg && typeof msg === 'object' && typeof msg.t === 'string') this.h.onMessage?.(msg);
    });
    conn.on('close', () => {
      if (this.conn === conn) {
        this.conn = null;
        this.h.onClose?.();
      }
    });
  }

  get connected() {
    return !!(this.conn && this.conn.open);
  }

  send(msg) {
    if (this.connected) this.conn.send(msg);
  }

  close() {
    const peer = this.peer;
    this.conn = null;
    this.peer = null;
    if (peer) {
      try { peer.destroy(); } catch { /* 既に閉じている */ }
    }
  }
}
