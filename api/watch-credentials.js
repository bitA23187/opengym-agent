import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = s => crypto.createHash('sha256').update(s).digest('hex');
export class WatchError extends Error {
  constructor(message, status = 400, code = 'invalid_watch_request') { super(message); this.status = status; this.code = code; }
}

// Separate from the account-wide Shortcut credential: issuing/revoking one never rotates another.
export function createWatchCredentials({ dataDir, getUser, now = Date.now }) {
  const root = path.join(dataDir, 'watch-devices');
  const file = uid => path.join(root, hash(uid) + '.json');
  const key = digest => path.join(root, 'keys', digest + '.json');
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const write = (f, value) => {
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    const tmp = f + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, f); }
    finally { fs.rmSync(tmp, { force: true }); }
  };
  const valid = (entry, user) => !!(entry && user && !user.disabled && entry.uid === user.id && entry.sv === (user.sv || 0) && (entry.expiresAt == null || entry.expiresAt > now()));
  const rows = uid => read(file(uid)) || [];
  return {
    issue(user, name, pendingUntil = null) {
      if (!valid({ uid: user.id, sv: user.sv || 0 }, getUser(user.id))) throw new WatchError('登录已失效。', 401);
      const previous = rows(user.id);
      for (const r of previous) if (!valid(r, user)) fs.rmSync(key(r.keyHash), { force: true });
      if (previous.filter(r => valid(r, user)).length >= 20) throw new WatchError('已绑定 20 台设备，请先移除不用的设备。', 409, 'watch_device_limit');
      const token = 'ogw_' + crypto.randomBytes(32).toString('base64url');
      const entry = { id: crypto.randomUUID(), uid: user.id, sv: user.sv || 0, name, createdAt: now(), expiresAt: pendingUntil, keyHash: hash(token) };
      write(key(entry.keyHash), entry);
      try { write(file(user.id), [...previous.filter(r => valid(r, user)), entry]); }
      catch (e) { fs.rmSync(key(entry.keyHash), { force: true }); throw e; }
      return { token, device_id: entry.id };
    },
    list(user) { return rows(user.id).filter(r => valid(r, user)).map(({ id, name, createdAt }) => ({ id, name, createdAt })); },
    claim(uid, id) {
      const entries = rows(uid), entry = entries.find(r => r.id === id);
      if (!valid(entry, getUser(uid)) || !valid(read(key(entry.keyHash)), getUser(uid))) throw new WatchError('手表连接已失效，请重新扫码。', 401, 'invalid_watch_credential');
      const claimed = { ...entry, expiresAt: null };
      write(file(uid), entries.map(r => r.id === id ? claimed : r));
      write(key(entry.keyHash), claimed);
    },
    revoke(uid, id) {
      const entries = rows(uid), entry = entries.find(r => r.id === id);
      if (!entry) return;
      // Remove lookup before changing the list: any interrupted revoke fails closed.
      fs.rmSync(key(entry.keyHash), { force: true });
      write(file(uid), entries.filter(r => r.id !== id));
    },
    removeUser(uid) {
      for (const entry of rows(uid)) fs.rmSync(key(entry.keyHash), { force: true });
      fs.rmSync(file(uid), { force: true });
    },
    authenticate(req) {
      const token = /^Bearer (ogw_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
      if (!token) throw new WatchError('需要手表上传凭证。', 401, 'invalid_watch_credential');
      const digest = hash(token), entry = read(key(digest)), user = entry && getUser(entry.uid);
      if (!valid(entry, user) || entry.keyHash !== digest || !rows(entry.uid).some(r => valid(r, user) && r.id === entry.id && r.keyHash === digest)) {
        throw new WatchError('手表连接已失效，请重新扫码绑定。', 401, 'invalid_watch_credential');
      }
      return user;
    }
  };
}
