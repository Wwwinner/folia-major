const fs = require('node:fs');
const path = require('node:path');

// 桌面 Chromium 网络设置；旧饭角覆盖只迁移一次，后续统一由设置页管理。
const NETWORK_PROXY_KEY = 'NETWORK_PROXY';
const DEFAULT_PROXY_SETTINGS = { mode: 'system', address: '' };
function normalizeProxySettings(value) {
  const invalid = () => { throw new Error('INVALID_PROXY_SETTINGS'); };
  if (!value || Array.isArray(value) || !['system', 'direct', 'custom'].includes(value.mode)) return invalid();
  if (value.mode !== 'custom') return { mode: value.mode, address: '' };
  if (typeof value.address !== 'string') return invalid();
  const address = value.address.trim();
  if (!address || address.length > 2048 || /\s/.test(address)) return invalid();
  try {
    const url = new URL(address.includes('://') ? address : `http://${address}`);
    if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || !url.hostname || url.username || url.password
      || url.search || url.hash || (url.pathname && url.pathname !== '/') || url.port === '0') return invalid();
    return { mode: 'custom', address: `${url.protocol}//${url.host}` };
  } catch { return invalid(); }
}

function loadProxySettings(store, { appPath, userData, isDev, env = process.env }) {
  let value = store.get(NETWORK_PROXY_KEY);
  if (value === undefined) {
    let legacy = env.FANJIAO_MEDIA_PROXY;
    if (legacy === undefined) {
      try { legacy = fs.readFileSync(path.join(isDev ? appPath : userData, '.fanjiao.proxy.local'), 'utf8'); }
      catch { legacy = ''; }
    }
    legacy = legacy.trim();
    value = !legacy || legacy === 'system' ? DEFAULT_PROXY_SETTINGS
      : legacy === 'direct' ? { mode: 'direct', address: '' } : { mode: 'custom', address: legacy };
  }
  let settings;
  try { settings = normalizeProxySettings(value); } catch { settings = { ...DEFAULT_PROXY_SETTINGS }; }
  store.set(NETWORK_PROXY_KEY, settings);
  return Object.freeze(settings);
}

function toChromiumProxyConfig(settings) {
  const normalized = normalizeProxySettings(settings);
  return normalized.mode === 'custom'
    ? { mode: 'fixed_servers', proxyRules: normalized.address }
    : { mode: normalized.mode };
}

module.exports = { NETWORK_PROXY_KEY, DEFAULT_PROXY_SETTINGS, normalizeProxySettings, loadProxySettings, toChromiumProxyConfig };
