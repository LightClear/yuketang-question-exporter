(function registerUrlPolicy(root) {
  const ns = root.YktQuestionExporter;
  if (ns.urlPolicy) return;

  const suffixes = Object.freeze(['yuketang.cn', 'xuetangx.com']);

  function fail(message) {
    const error = new Error(message);
    error.code = 'URL_NOT_ALLOWED';
    throw error;
  }

  function normalizeHost(hostname) {
    try {
      return String(hostname || '').toLowerCase().replace(/\.$/, '');
    } catch {
      return '';
    }
  }

  function isAllowedHost(hostname) {
    const host = normalizeHost(hostname);
    return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  }

  function normalizeRemoteUrl(value) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      fail('invalid URL');
    }
    if (parsed.protocol !== 'https:') fail('HTTPS required');
    if (parsed.username || parsed.password) fail('userinfo forbidden');
    if (parsed.port && parsed.port !== '443') fail('non-default port forbidden');
    if (!isAllowedHost(parsed.hostname)) fail('host forbidden');
    parsed.hostname = normalizeHost(parsed.hostname);
    parsed.hash = '';
    return parsed.href;
  }

  function redactForDisplay(value) {
    const parsed = new URL(normalizeRemoteUrl(value));
    parsed.search = '';
    return parsed.href;
  }

  ns.urlPolicy = Object.freeze({ isAllowedHost, normalizeRemoteUrl, redactForDisplay });
})(globalThis);
