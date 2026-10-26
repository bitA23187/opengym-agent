import crypto from 'node:crypto';
import { createWindow } from './rate-limit.js';
import { createWatchCredentials, WatchError } from './watch-credentials.js';
import { generate, correction } from './vendor/lean-qr-nano.mjs';

const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const normalizeCode = value => typeof value === 'string' ? value.toUpperCase().replace(/[ -]/g, '') : '';

export function createWatchPairing({ dataDir, getUser, readSession, readBody, json, origin, address = req => req.socket?.remoteAddress || 'unknown', now = Date.now }) {
  const credentials = createWatchCredentials({ dataDir, getUser, now });
  const sessions = new Map(); // Only short-lived redemption material; never health data.
  const starts = createWindow({ max: 8, windowMs: 60000, maxKeys: 10000, now });
  const actions = createWindow({ max: 60, windowMs: 60000, maxKeys: 10000, now });
  const ttl = 5 * 60000, interval = 5;
  const sweep = () => {
    starts.sweep(); actions.sweep();
    for (const [id, s] of sessions) if (s.expires <= now()) {
      if (s.issued && !s.claimed) credentials.revoke(s.uid, s.issued.device_id);
      sessions.delete(id);
    }
  };
  // Expiry also cleans up approved but never received device credentials without further traffic.
  const timer = setInterval(() => {
    try { sweep(); } catch { console.error('Watch pairing cleanup failed; will retry.'); }
  }, 30000); timer.unref();
  const user = req => { const u = readSession(req); if (!u) throw new WatchError('请先登录 OpenGym。', 401, 'not_signed_in'); return u; };
  const authorized = s => {
    const u = s.uid && getUser(s.uid);
    return u && !u.disabled && (u.sv || 0) === s.sv;
  };
  const limited = (window, req) => { const wait = window.take(address(req)); if (wait) throw new WatchError('请求过于频繁，请稍后重试。', 429, 'slow_down'); };
  const find = code => {
    sweep();
    const normalized = normalizeCode(code);
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(normalized)) throw new WatchError('绑定码无效或已过期，请在手表重新生成。', 410, 'expired_token');
    const s = [...sessions.values()].find(v => v.code === normalized);
    if (!s) throw new WatchError('绑定码无效或已过期，请在手表重新生成。', 410, 'expired_token');
    return s;
  };
  const device = input => {
    sweep();
    const secret = input?.device_code;
    const s = typeof secret === 'string' && /^[A-Za-z0-9_-]{43}$/.test(secret) ? sessions.get(hash(secret)) : null;
    if (!s) throw new WatchError('绑定已过期，请重新扫码。', 410, 'expired_token');
    return s;
  };
  const checkOwner = (s, u) => {
    if (s.uid && s.uid !== u.id) throw new WatchError('此绑定已由其他账户处理，请在手表重新生成。', 409, 'account_mismatch');
  };
  const wrap = fn => async (req, res) => {
    try { sweep(); await fn(req, res); }
    catch (e) {
      if (!(e instanceof WatchError)) throw e;
      json(res, e.status, { error: e.message, code: e.code }, { 'Cache-Control': 'no-store', ...(e.status === 429 ? { 'Retry-After': '5' } : {}) });
    }
  };
  const routes = {
    'POST /api/watch-pair/start': wrap(async (req, res) => {
      limited(starts, req);
      const input = await readBody(req);
      if (sessions.size >= 1000) throw new WatchError('绑定服务繁忙，请稍后再试。', 503, 'busy');
      const name = typeof input.name === 'string' ? input.name.trim() : 'Apple Watch';
      if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) throw new WatchError('设备名称无效。');
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code;
      do { code = [...crypto.randomBytes(8)].map(b => alphabet[b % alphabet.length]).join(''); }
      while ([...sessions.values()].some(s => s.code === code));
      const secret = crypto.randomBytes(32).toString('base64url');
      const expires = now() + ttl;
      sessions.set(hash(secret), { code, name, expires, state: 'pending', lastPoll: null });
      const verification = new URL('/#/watch-pair?code=' + code, origin).href;
      const qr = generate(verification, { minCorrectionLevel: correction.M });
      const matrix = Array.from({ length: qr.size }, (_, y) => Array.from({ length: qr.size }, (_, x) => qr.get(x, y) ? '1' : '0').join(''));
      json(res, 200, { device_code: secret, user_code: code.slice(0, 4) + '-' + code.slice(4), verification_uri_complete: verification, expires_in: ttl / 1000, interval, qr: matrix });
    }),
    'GET /api/watch-pair': wrap(async (req, res) => {
      const u = user(req); limited(actions, req);
      const s = find(new URL(req.url, 'http://x').searchParams.get('code'));
      checkOwner(s, u);
      if (s.state === 'pending') s.scanned = true;
      json(res, 200, { name: s.name, user_code: s.code.slice(0, 4) + '-' + s.code.slice(4), expires_at: s.expires, status: s.state, scopes: ['健康数据上传', '最小待补训练查询'] });
    }),
    'POST /api/watch-pair/approve': wrap(async (req, res) => {
      const u = user(req); limited(actions, req);
      const input = await readBody(req);
      if (readSession(req) !== u) throw new WatchError('登录已失效。', 401, 'not_signed_in');
      const s = find(input.code); checkOwner(s, u);
      if (typeof input.approve !== 'boolean') throw new WatchError('请选择允许或拒绝绑定。');
      if (s.state !== 'pending') {
        if ((s.state === 'approved' && input.approve) || (s.state === 'denied' && !input.approve)) return json(res, 200, { ok: true, status: s.state });
        throw new WatchError('此绑定已处理，请在手表重新生成。', 409, 'already_decided');
      }
      if (input.approve && input.name !== undefined) {
        if (typeof input.name !== 'string') throw new WatchError('设备名称无效。');
        const name = input.name.trim() || 'Apple Watch';
        if (name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) throw new WatchError('设备名称无效。');
        s.name = name;
      }
      s.uid = u.id; s.sv = u.sv || 0;
      if (input.approve) { s.issued = credentials.issue(u, s.name, s.expires); s.state = 'approved'; }
      else { s.state = 'denied'; }
      json(res, 200, { ok: true, status: s.state });
    }),
    'POST /api/watch-pair/poll': wrap(async (req, res) => {
      limited(actions, req);
      const s = device(await readBody(req));
      if (s.lastPoll != null && now() - s.lastPoll < interval * 1000) throw new WatchError('请稍后再查询。', 429, 'slow_down');
      s.lastPoll = now();
      if (s.state === 'denied' || (s.uid && !authorized(s))) return json(res, 200, { status: 'denied' });
      if (s.state === 'pending') return json(res, 200, { status: 'pending', scanned: !!s.scanned, interval });
      credentials.authenticate({ headers: { authorization: 'Bearer ' + s.issued.token } });
      json(res, 200, { status: 'approved', owner: s.uid, token: s.issued.token, device_id: s.issued.device_id });
    }),
    'POST /api/watch-pair/ack': wrap(async (req, res) => {
      limited(actions, req);
      const s = device(await readBody(req));
      if (s.state !== 'approved' || !authorized(s)) throw new WatchError('绑定尚未批准或已失效。', 409, 'not_approved');
      // Retain replay material until session expiry: lost ACK or Keychain failure can retry safely.
      credentials.claim(s.uid, s.issued.device_id);
      s.claimed = true;
      json(res, 200, { ok: true });
    }),
    'POST /api/watch-pair/cancel': wrap(async (req, res) => {
      limited(actions, req);
      const input = await readBody(req);
      const s = device(input);
      if (s.issued) credentials.revoke(s.uid, s.issued.device_id);
      sessions.delete(hash(input.device_code));
      json(res, 200, { ok: true });
    }),
    'GET /api/watch-devices': wrap(async (req, res) => { json(res, 200, { devices: credentials.list(user(req)) }); }),
    'POST /api/watch-devices/verify': wrap(async (req, res) => {
      const u = credentials.authenticate(req), input = await readBody(req);
      if (credentials.authenticate(req) !== u) throw new WatchError('凭证已失效。', 401);
      if (input.expected_owner !== u.id) throw new WatchError('凭证与账户不匹配。', 403, 'account_mismatch');
      json(res, 200, { owner: u.id });
    }),
    'POST /api/watch-devices/revoke': wrap(async (req, res) => {
      const u = user(req), input = await readBody(req);
      if (readSession(req) !== u) throw new WatchError('登录已失效。', 401, 'not_signed_in');
      if (typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/.test(input.id)) throw new WatchError('设备标识无效。');
      credentials.revoke(u.id, input.id);
      // A revoked token must not be resurrected by a replayable pairing session.
      for (const [id, s] of sessions) if (s.uid === u.id && s.issued?.device_id === input.id) sessions.delete(id);
      json(res, 200, { ok: true });
    })
  };
  return { routes, close() { clearInterval(timer); }, credentials, removeUser(uid) {
    credentials.removeUser(uid);
    for (const [id, s] of sessions) if (s.uid === uid) sessions.delete(id);
  } };
}
