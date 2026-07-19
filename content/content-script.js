(function registerContentScript(root) {
  const ns = root.YktQuestionExporter;
  if (ns.contentScriptRegistered) return;

  const runtime = root.chrome && root.chrome.runtime;
  if (!runtime || !runtime.onMessage || typeof runtime.onMessage.addListener !== 'function') return;

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STATUS_ID = 'ykt-question-exporter-status';
  const FAILURE_CODES = new Set([
    'MODEL_INVALID',
    'MODEL_LIMIT_EXCEEDED',
    'QUESTION_LIMIT_EXCEEDED',
    'IMAGE_LIMIT_EXCEEDED',
    'SESSION_LIMIT_EXCEEDED',
    'FONT_FETCH_FAILED',
    'URL_NOT_ALLOWED',
    'EXTRACTION_FAILED'
  ]);
  const OUTCOME_TEXT = Object.freeze({
    NO_QUESTIONS: '未识别到题目，请等待页面加载后重试',
    EXTRACTION_BUSY: '正在识别题目，请稍候',
    UNSUPPORTED_PAGE: '当前页面暂不支持，请在雨课堂或学堂在线题目页重试',
    SESSION_LIMIT_EXCEEDED: '识别结果过大，请减少题目或图片后重试',
    SESSION_STORAGE_FAILED: '无法保存识别结果，请稍后重试',
    MODEL_INVALID: '识别结果无效，请刷新页面后重试',
    FONT_FETCH_FAILED: '加密字体还原失败，请等待页面加载后重试',
    EXTRACTION_FAILED: '识别失败，请刷新页面后重试'
  });

  if (!ns.contentState) {
    ns.contentState = Object.seal({ activeRequestId: null, startedAt: 0 });
  }

  function dataKeys(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    let descriptors;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch (_error) {
      return null;
    }
    if (!Object.values(descriptors).every((descriptor) =>
      Object.prototype.hasOwnProperty.call(descriptor, 'value')
    )) {
      return null;
    }
    return Object.keys(descriptors);
  }

  function exactMessage(message, expectedKeys) {
    const keys = dataKeys(message);
    if (!keys || keys.length !== expectedKeys.length) return false;
    return expectedKeys.every((key) => keys.includes(key));
  }

  function dataValue(value, key) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? descriptor.value
        : undefined;
    } catch (_error) {
      return undefined;
    }
  }

  function statusBadge() {
    const document = root.document;
    if (!document || typeof document.createElement !== 'function') return null;
    let badge = typeof document.getElementById === 'function'
      ? document.getElementById(STATUS_ID)
      : null;
    if (badge) return badge;
    badge = document.createElement('div');
    badge.setAttribute('id', STATUS_ID);
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    badge.setAttribute('aria-atomic', 'true');
    badge.style.all = 'initial';
    badge.style.position = 'fixed';
    badge.style.right = '20px';
    badge.style.bottom = '20px';
    badge.style.zIndex = '2147483647';
    badge.style.maxWidth = 'min(360px, calc(100vw - 40px))';
    badge.style.boxSizing = 'border-box';
    badge.style.padding = '12px 16px';
    badge.style.border = '1px solid rgba(255,255,255,.28)';
    badge.style.borderRadius = '10px';
    badge.style.background = '#172033';
    badge.style.color = '#ffffff';
    badge.style.boxShadow = '0 8px 24px rgba(15,23,42,.22)';
    badge.style.font = '500 14px/1.55 system-ui, sans-serif';
    badge.style.wordBreak = 'break-word';
    const parent = document.body || document.documentElement;
    if (parent && typeof parent.appendChild === 'function') parent.appendChild(badge);
    return badge;
  }

  function showStatus(text) {
    const badge = statusBadge();
    if (badge) badge.textContent = text;
  }

  function stableFailureCode(error) {
    const code = error && typeof error === 'object' ? dataValue(error, 'code') : undefined;
    return typeof code === 'string' && FAILURE_CODES.has(code) ? code : 'EXTRACTION_FAILED';
  }

  async function sendToBackground(message) {
    if (typeof runtime.sendMessage !== 'function') throw new Error('EXTRACTION_FAILED');
    return runtime.sendMessage(message);
  }

  async function readInlineSource(source, options) {
    if (typeof source !== 'string' || !/^(?:data:|blob:)/i.test(source) ||
        !options || !Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0 ||
        typeof root.fetch !== 'function') {
      return null;
    }
    const response = await root.fetch(source, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error'
    });
    if (!response || response.ok !== true || !response.body ||
        typeof response.body.getReader !== 'function') {
      return null;
    }
    const declaredText = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-length')
      : null;
    if (declaredText !== null) {
      const declared = Number(declaredText);
      if (!Number.isSafeInteger(declared) || declared < 0 || declared > options.maxBytes) return null;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const result = await reader.read();
      if (!result || result.done) break;
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) return null;
      total += chunk.byteLength;
      if (total > options.maxBytes) {
        if (typeof reader.cancel === 'function') await reader.cancel();
        return null;
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const mime = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-type') || ''
      : '';
    return { mime: String(mime).split(';', 1)[0].trim().toLowerCase(), bytes };
  }

  async function extract(requestId) {
    try {
      if (!ns.questionExtractors || typeof ns.questionExtractors.create !== 'function' ||
          !ns.model || typeof ns.model.validatePayload !== 'function') {
        throw new Error('EXTRACTION_FAILED');
      }
      const decoder = ns.fontDecoder && typeof ns.fontDecoder.create === 'function'
        ? ns.fontDecoder.create({
          chrome: root.chrome,
          document: root.document,
          performance: root.performance,
          now: Date.now
        })
        : ns.fontDecoder;
      const adapter = ns.questionExtractors.create({
        document: root.document,
        location: root.location,
        localStorage: root.localStorage,
        normalizer: ns.sourceNormalizer,
        fontDecoder: decoder,
        fetchBlob: readInlineSource,
        requestId,
        now: Date.now
      });
      const extracted = await adapter.extractAll();
      const payload = ns.model.validatePayload(extracted);
      await sendToBackground({
        type: 'YKT_EXTRACTION_COMPLETE',
        requestId,
        payload
      });
      showStatus('题目识别完成，正在打开结果页…');
    } catch (error) {
      const code = stableFailureCode(error);
      try {
        await sendToBackground({
          type: 'YKT_EXTRACTION_FAILED',
          requestId,
          code
        });
      } catch (_sendError) {
        // The visible recovery text remains available even if the worker is unavailable.
      }
      showStatus(OUTCOME_TEXT[code] || OUTCOME_TEXT.EXTRACTION_FAILED);
    } finally {
      if (ns.contentState.activeRequestId === requestId) {
        ns.contentState.activeRequestId = null;
        ns.contentState.startedAt = 0;
      }
    }
  }

  function listener(message, _sender, sendResponse) {
    const type = dataValue(message, 'type');
    if (type === 'YKT_PING') {
      if (!exactMessage(message, ['type'])) return false;
      sendResponse({
        state: ns.contentState.activeRequestId === null ? 'idle' : 'busy',
        requestId: ns.contentState.activeRequestId
      });
      return false;
    }
    if (type === 'YKT_EXTRACTION_START') {
      if (!exactMessage(message, ['type', 'requestId'])) return false;
      const requestId = dataValue(message, 'requestId');
      if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
        sendResponse({ accepted: false, code: 'REQUEST_INVALID', requestId: null });
        return true;
      }
      if (ns.contentState.activeRequestId !== null) {
        sendResponse({
          accepted: false,
          code: 'EXTRACTION_BUSY',
          requestId: ns.contentState.activeRequestId
        });
        return true;
      }
      ns.contentState.activeRequestId = requestId;
      ns.contentState.startedAt = Date.now();
      showStatus('正在识别题目…');
      sendResponse({ accepted: true, requestId });
      void extract(requestId);
      return true;
    }
    if (type === 'YKT_EXTRACTION_OUTCOME') {
      if (!exactMessage(message, ['type', 'requestId', 'code'])) return false;
      const requestId = dataValue(message, 'requestId');
      const code = dataValue(message, 'code');
      if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId) || typeof code !== 'string') {
        return false;
      }
      showStatus(OUTCOME_TEXT[code] || '识别未完成，请刷新页面后重试');
      sendResponse({ accepted: true });
      return false;
    }
    return false;
  }

  runtime.onMessage.addListener(listener);
  ns.contentScriptRegistered = true;
})(globalThis);
