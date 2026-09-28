'use strict';
const {createHmac, timingSafeEqual, randomBytes} = require('node:crypto');
class HttpError extends Error {
  constructor(status, message) {super(message); this.status = status;}
}
function constantEqual(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}
// https://dev.max.ru/docs/webapps/validation — checked 2026-09-26.
function verifyInitData(raw, botToken, now = Date.now()) {
  const invalid = () => {throw new HttpError(401, 'Не удалось подтвердить вход MAX. Откройте приложение заново из бота.');};
  if (!botToken || typeof raw !== 'string' || !raw || Buffer.byteLength(raw) > 16384) invalid();
  // URLSearchParams performs exactly one decoding pass (including + as space).
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length || keys.some(k => !/^[a-zA-Z0-9_]+$/.test(k))) invalid();
  const hash = params.get('hash');
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) invalid();
  params.delete('hash');
  const checkString = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', key).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) invalid();
  const authDate = params.get('auth_date');
  if (!authDate || !/^\d+$/.test(authDate)) invalid();
  const issuedAt = Number(authDate) * 1000;
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now + 30000 || now - issuedAt > 3600000) invalid();
  let user;
  try {user = JSON.parse(params.get('user'));} catch (_) {invalid();}
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot === true) invalid();
  // Discard everything except the verified ID and bounded expiry. No raw initData retained.
  return {id: String(user.id), expiresAt: Math.min(now + 3600000, issuedAt + 3600000)};
}
const userKey = (id, secret) => createHmac('sha256', secret).update('dompulse-user:' + id).digest('hex');
class Sessions {
  constructor(config) {this.config = config; this.items = new Map();}
  create(identity, now = Date.now()) {
    for (const [key, s] of this.items) if (s.expiresAt <= now) this.items.delete(key);
    if (this.items.size >= 10000) throw new HttpError(503, 'Слишком много активных сессий. Попробуйте позже.');
    const token = randomBytes(32).toString('hex');
    this.items.set(token, identity);
    return token;
  }
  token(req) {
    const bearer = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
    if (bearer) return bearer[1];
    return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('dompulse_session='))?.slice('dompulse_session='.length);
  }
  get(req) {
    const token = this.token(req), s = this.items.get(token);
    if (!s || s.expiresAt <= Date.now()) {if (token) this.items.delete(token); return null;}
    return s;
  }
  remove(req) {this.items.delete(this.token(req));}
  cookie(token) {return `dompulse_session=${token}; Path=/; HttpOnly; Max-Age=3600; ${this.config.development ? 'SameSite=Lax' : 'SameSite=None; Secure'}`;}
}
module.exports = {HttpError, verifyInitData, constantEqual, userKey, Sessions};
