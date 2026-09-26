const { pathToFileURL, fileURLToPath } = require('node:url');
const path = require('node:path');

// 主进程入口保持 CommonJS，协议实现延迟加载为 ESM；错误跨 IPC 时保留稳定分类。
const FANJIAO_SCHEME = 'folia-hls';
function isTrustedFanjiaoPage(value, appPath, isDev) {
  try {
    const url = new URL(value);
    return isDev ? url.origin === 'http://localhost:3000'
      : url.protocol === 'file:' && path.resolve(fileURLToPath(url)) === path.resolve(appPath, 'dist/index.html');
  } catch { return false; }
}
function createFanjiaoBridge({ app }) {
  let service;
  let loading;
  let disposed = false;
  const initialize = () => loading ||= import(pathToFileURL(path.join(__dirname, 'service.mjs')).href).then(async module => {
    const { createMediaTransport } = await import(pathToFileURL(path.join(__dirname, 'mediaTransport.mjs')).href);
    const locations = {
      appPath: app.getAppPath(), userData: app.getPath('userData'), isDev: !app.isPackaged,
    };
    const { session, net } = require('electron');
    const mediaTransport = await createMediaTransport('system', session, net);
    service = module.createFanjiaoService({ secret: module.readSigningSecret(locations), mediaTransport });
    if (disposed) service.dispose();
    return service;
  });
  return {
    initialize,
    status: async () => (await initialize()).status(),
    request: async (operation, params) => {
      try { return { ok: true, data: await (await initialize()).request(operation, params) }; }
      catch (error) { return { ok: false, code: error.code === 'not-playable' ? 'not-playable' : error.code === 'unavailable' ? 'unavailable' : 'network',
        message: error.code === 'not-playable' || error.code === 'unavailable' ? error.message : '饭角请求失败，请稍后重试' }; }
    },
    handleProtocol: async request => (await initialize()).handleProtocol(request),
    dispose: () => { disposed = true; service?.dispose(); },
  };
}
module.exports = { createFanjiaoBridge, FANJIAO_SCHEME, isTrustedFanjiaoPage };
