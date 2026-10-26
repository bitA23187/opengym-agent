import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite } from '../durable.js';
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const random = () => crypto.randomBytes(32).toString('base64url');
export function openStore(dir) {
  const file = path.join(dir, 'plugin-oauth.json');
  let data = { clients: {}, grants: {}, tokens: {} };
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const key of ['clients', 'grants', 'tokens']) if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) throw Error('invalid OAuth store');
  return { data, save() {
    const now = Date.now();
    for (const [id, g] of Object.entries(data.grants)) if (g.revoked || g.exp <= now) delete data.grants[id];
    for (const [id, t] of Object.entries(data.tokens)) if (t.exp <= now || !data.grants[t.grant]) delete data.tokens[id];
    atomicWrite(file, JSON.stringify(data), 0o600);
  } };
}
