importScripts(
  'shared/namespace.js',
  'shared/limits.js',
  'shared/url-policy.js',
  'shared/rich-text.js',
  'shared/model.js'
);

(function registerBackground(root) {
  const ns = root.YktQuestionExporter;
  const limits = ns.limits;
  const urlPolicy = ns.urlPolicy;
  const model = ns.model;
  const LEASE_SCHEMA_VERSION = 1;
  const CONTENT_FILES = Object.freeze([
    'shared/namespace.js',
    'shared/limits.js',
    'shared/url-policy.js',
    'shared/rich-text.js',
    'shared/model.js',
    'content/source-normalizer.js',
    'content/font-decoder.js',
    'content/question-extractors.js',
    'content/content-script.js'
  ]);
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
  const FONT_PATH_PATTERN = /\/exam_font_[^/]+\.(?:ttf|otf|woff2?|eot)$/i;
  const FONT_MIME_SIGNATURES = Object.freeze({
    'font/ttf': Object.freeze(['sfnt']),
    'font/otf': Object.freeze(['otf']),
    'font/woff': Object.freeze(['woff']),
    'font/woff2': Object.freeze(['woff2']),
    'application/font-sfnt': Object.freeze(['sfnt', 'otf']),
    'application/x-font-ttf': Object.freeze(['sfnt']),
    'application/x-font-opentype': Object.freeze(['otf']),
    'application/x-font-woff': Object.freeze(['woff']),
    'application/vnd.ms-fontobject': Object.freeze(['eot'])
  });
  let mutationTail = Promise.resolve();

  function withSessionMutation(work) {
    const result = mutationTail.then(work, work);
    mutationTail = result.catch(() => undefined);
    return result;
  }

  function own(value, key) {
    return value !== null && typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, key);
  }

  function dataRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    let descriptors;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch (_error) {
      return false;
    }
    return Object.values(descriptors).every((descriptor) => own(descriptor, 'value'));
  }

  function exactKeys(value, expected) {
    if (!dataRecord(value)) return false;
    const keys = Object.keys(value);
    return keys.length === expected.length && expected.every((key) => keys.includes(key));
  }

  function callChrome(target, method, ...args) {
    return new Promise((resolve, reject) => {
      if (!target || typeof target[method] !== 'function') {
        reject(new Error('CHROME_API_FAILED'));
        return;
      }
      try {
        target[method](...args, (value) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) reject(new Error(lastError.message || 'CHROME_API_FAILED'));
          else resolve(value);
        });
      } catch (_error) {
        reject(new Error('CHROME_API_FAILED'));
      }
    });
  }

  const sessionGet = (keys) => callChrome(chrome.storage.session, 'get', keys);
  const sessionSet = (items) => callChrome(chrome.storage.session, 'set', items);
  const sessionRemove = (keys) => callChrome(chrome.storage.session, 'remove', keys);
  const sessionBytes = (keys) => callChrome(chrome.storage.session, 'getBytesInUse', keys);
  const alarmCreate = (name, info) => callChrome(chrome.alarms, 'create', name, info);
  const alarmClear = (name) => callChrome(chrome.alarms, 'clear', name);
  const tabMessage = (tabId, message) => callChrome(chrome.tabs, 'sendMessage', tabId, message);
  const tabCreate = (properties) => callChrome(chrome.tabs, 'create', properties);
  const executeScript = (details) => callChrome(chrome.scripting, 'executeScript', details);

  function leaseAlarm(tabId) {
    return `expire:lease:${tabId}`;
  }

  function sessionAlarm(sessionId) {
    return `expire:session:${sessionId}`;
  }

  function canonicalTab(tab) {
    if (!dataRecord(tab) || !Number.isSafeInteger(tab.id) || tab.id < 0 ||
        typeof tab.url !== 'string') {
      return null;
    }
    try {
      const canonical = urlPolicy.normalizeRemoteUrl(tab.url);
      const parsed = new URL(canonical);
      return { tabId: tab.id, host: parsed.hostname.toLowerCase() };
    } catch (_error) {
      return null;
    }
  }

  function validLease(value, now, requireActive = true) {
    if (!exactKeys(value, [
      'schemaVersion',
      'requestId',
      'tabId',
      'sourceHost',
      'createdAt',
      'expiresAt',
      'fontRequests',
      'fontBytes',
      'fontInFlight'
    ])) {
      return false;
    }
    if (value.schemaVersion !== LEASE_SCHEMA_VERSION || !model.isUuid(value.requestId) ||
        !Number.isSafeInteger(value.tabId) || value.tabId < 0 ||
        typeof value.sourceHost !== 'string' || !urlPolicy.isAllowedHost(value.sourceHost) ||
        !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 ||
        !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt !== value.createdAt + limits.LEASE_TTL_MS ||
        value.createdAt > now || (requireActive && now >= value.expiresAt) ||
        !Number.isSafeInteger(value.fontRequests) || value.fontRequests < 0 ||
        value.fontRequests > limits.MAX_REMOTE_FONTS_PER_REQUEST ||
        !Number.isSafeInteger(value.fontBytes) || value.fontBytes < 0 ||
        value.fontBytes > limits.MAX_REMOTE_FONT_TOTAL_BYTES ||
        typeof value.fontInFlight !== 'boolean') {
      return false;
    }
    return true;
  }

  async function removeLease(tabId) {
    await sessionRemove(model.leaseKey(tabId));
    await alarmClear(leaseAlarm(tabId));
  }

  async function cleanExpired(now = Date.now()) {
    const stored = await sessionGet(null);
    const removals = [];
    const alarmNames = [];
    for (const [key, value] of Object.entries(stored || {})) {
      if (key.startsWith('extractLease:')) {
        const tabId = Number(key.slice('extractLease:'.length));
        if (!Number.isSafeInteger(tabId) || tabId < 0 || !validLease(value, now, true) ||
            value.tabId !== tabId) {
          removals.push(key);
          if (Number.isSafeInteger(tabId) && tabId >= 0) alarmNames.push(leaseAlarm(tabId));
        }
      } else if (key.startsWith('questionSession:')) {
        const sessionId = key.slice('questionSession:'.length);
        try {
          if (!model.isUuid(sessionId)) throw new Error('MODEL_INVALID');
          model.validateSessionEnvelope(value, now);
        } catch (_error) {
          removals.push(key);
          if (model.isUuid(sessionId)) alarmNames.push(sessionAlarm(sessionId));
        }
      }
    }
    if (removals.length > 0) await sessionRemove(removals);
    for (const name of alarmNames) {
      try {
        await alarmClear(name);
      } catch (_error) {
        // Expired storage is already removed; a stale alarm is harmless.
      }
    }
  }

  function isNoReceiver(error) {
    const message = error && typeof error.message === 'string' ? error.message : '';
    return /receiving end does not exist|could not establish connection/i.test(message);
  }

  async function notifyOutcome(tabId, requestId, code) {
    if (!model.isUuid(requestId)) return;
    try {
      await tabMessage(tabId, {
        type: 'YKT_EXTRACTION_OUTCOME',
        requestId,
        code
      });
    } catch (_error) {
      // Source status is best effort after persistent state has been settled.
    }
  }

  async function onActionClicked(tab) {
    const source = canonicalTab(tab);
    if (!source) return;
    let ping;
    try {
      ping = await tabMessage(source.tabId, { type: 'YKT_PING' });
    } catch (error) {
      if (!isNoReceiver(error)) return;
      try {
        await executeScript({
          target: { tabId: source.tabId },
          files: CONTENT_FILES
        });
        ping = await tabMessage(source.tabId, { type: 'YKT_PING' });
      } catch (_error) {
        return;
      }
    }
    if (!dataRecord(ping) || !['idle', 'busy'].includes(ping.state)) return;
    if (ping.state === 'busy') {
      await notifyOutcome(source.tabId, ping.requestId, 'EXTRACTION_BUSY');
      return;
    }

    const decision = await withSessionMutation(async () => {
      const now = Date.now();
      await cleanExpired(now);
      const key = model.leaseKey(source.tabId);
      const stored = await sessionGet(key);
      const current = stored && stored[key];
      if (validLease(current, now, true)) return { busy: current };
      const requestId = crypto.randomUUID();
      if (!model.isUuid(requestId)) return { error: 'EXTRACTION_FAILED' };
      const lease = {
        schemaVersion: LEASE_SCHEMA_VERSION,
        requestId,
        tabId: source.tabId,
        sourceHost: source.host,
        createdAt: now,
        expiresAt: now + limits.LEASE_TTL_MS,
        fontRequests: 0,
        fontBytes: 0,
        fontInFlight: false
      };
      await sessionSet({ [key]: lease });
      try {
        await alarmCreate(leaseAlarm(source.tabId), { when: lease.expiresAt });
      } catch (_error) {
        await sessionRemove(key);
        return { error: 'SESSION_STORAGE_FAILED' };
      }
      return { lease };
    });

    if (decision.busy) {
      await notifyOutcome(source.tabId, decision.busy.requestId, 'EXTRACTION_BUSY');
      return;
    }
    if (!decision.lease) return;
    let start;
    try {
      start = await tabMessage(source.tabId, {
        type: 'YKT_EXTRACTION_START',
        requestId: decision.lease.requestId
      });
    } catch (_error) {
      start = null;
    }
    if (!dataRecord(start) || start.accepted !== true ||
        start.requestId !== decision.lease.requestId) {
      await withSessionMutation(() => removeLease(source.tabId));
      await notifyOutcome(source.tabId, decision.lease.requestId, 'EXTRACTION_FAILED');
    }
  }

  function validSender(sender) {
    if (!dataRecord(sender) || sender.id !== chrome.runtime.id || !dataRecord(sender.tab)) return null;
    return canonicalTab(sender.tab);
  }

  async function settleNoQuestions(source, requestId) {
    await removeLease(source.tabId);
    return { ok: true, code: 'NO_QUESTIONS', notify: true, requestId, tabId: source.tabId };
  }

  async function handleCompletion(message, sender) {
    if (!exactKeys(message, ['type', 'requestId', 'payload'])) {
      return { ok: false, code: 'MESSAGE_REJECTED' };
    }
    const source = validSender(sender);
    if (!source || !model.isUuid(message.requestId)) {
      return { ok: false, code: 'MESSAGE_REJECTED' };
    }
    let payload;
    try {
      payload = model.validatePayload(message.payload);
    } catch (error) {
      return {
        ok: false,
        code: error && typeof error.code === 'string' ? error.code : 'MODEL_INVALID'
      };
    }
    const outcome = await withSessionMutation(async () => {
      const now = Date.now();
      await cleanExpired(now);
      const leaseKey = model.leaseKey(source.tabId);
      const stored = await sessionGet(leaseKey);
      const lease = stored && stored[leaseKey];
      if (!validLease(lease, now, true) || lease.requestId !== message.requestId ||
          lease.tabId !== source.tabId || lease.sourceHost !== source.host) {
        return { ok: false, code: 'LEASE_MISMATCH' };
      }
      if (!payload.questions.some((question) => question.status !== 'failed')) {
        return settleNoQuestions(source, message.requestId);
      }

      const sessionId = crypto.randomUUID();
      if (!model.isUuid(sessionId)) return { ok: false, code: 'SESSION_STORAGE_FAILED' };
      let envelope;
      try {
        envelope = model.createSessionEnvelope(payload, now);
      } catch (_error) {
        await removeLease(source.tabId);
        return { ok: false, code: 'SESSION_LIMIT_EXCEEDED', notify: true };
      }
      const envelopeBytes = model.serializedBytes(envelope);
      const currentBytes = await sessionBytes(null);
      if (envelopeBytes > limits.MAX_SESSION_BYTES ||
          currentBytes + envelopeBytes > limits.MAX_ALL_SESSION_BYTES) {
        await removeLease(source.tabId);
        return { ok: false, code: 'SESSION_LIMIT_EXCEEDED', notify: true };
      }
      const sessionKey = model.sessionKey(sessionId);
      let sessionWritten = false;
      try {
        await sessionSet({ [sessionKey]: envelope });
        sessionWritten = true;
        await alarmCreate(sessionAlarm(sessionId), { when: envelope.expiresAt });
        await sessionRemove(leaseKey);
        await alarmClear(leaseAlarm(source.tabId));
      } catch (_error) {
        if (sessionWritten) {
          try {
            await sessionRemove(sessionKey);
          } catch (_removeError) {
            // The read-time validator still rejects any malformed or expired residue.
          }
        }
        try {
          await alarmClear(sessionAlarm(sessionId));
        } catch (_alarmError) {
          // A stale alarm cannot recreate removed data.
        }
        try {
          await removeLease(source.tabId);
        } catch (_leaseError) {
          // Lease TTL remains the final recovery boundary.
        }
        return { ok: false, code: 'SESSION_STORAGE_FAILED', notify: true };
      }
      return { ok: true, sessionId };
    });

    if (outcome.notify) {
      await notifyOutcome(source.tabId, message.requestId, outcome.code);
      return { ok: outcome.ok, code: outcome.code };
    }
    if (!outcome.ok) return { ok: false, code: outcome.code };
    try {
      await tabCreate({
        url: `${chrome.runtime.getURL('results/results.html')}?session=${encodeURIComponent(outcome.sessionId)}`
      });
    } catch (_error) {
      await notifyOutcome(source.tabId, message.requestId, 'SESSION_STORAGE_FAILED');
      return { ok: false, code: 'SESSION_STORAGE_FAILED' };
    }
    return { ok: true, sessionId: outcome.sessionId };
  }

  async function handleFailure(message, sender) {
    if (!exactKeys(message, ['type', 'requestId', 'code'])) {
      return { ok: false, code: 'MESSAGE_REJECTED' };
    }
    const source = validSender(sender);
    if (!source || !model.isUuid(message.requestId) ||
        typeof message.code !== 'string' || !FAILURE_CODES.has(message.code)) {
      return { ok: false, code: 'MESSAGE_REJECTED' };
    }
    const result = await withSessionMutation(async () => {
      const key = model.leaseKey(source.tabId);
      const stored = await sessionGet(key);
      const lease = stored && stored[key];
      if (!validLease(lease, Date.now(), true) || lease.requestId !== message.requestId ||
          lease.sourceHost !== source.host) {
        return { ok: false, code: 'LEASE_MISMATCH' };
      }
      await removeLease(source.tabId);
      return { ok: true };
    });
    if (result.ok) await notifyOutcome(source.tabId, message.requestId, message.code);
    return result;
  }

  function canonicalFontUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const canonical = urlPolicy.normalizeRemoteUrl(value);
      const parsed = new URL(canonical);
      return FONT_PATH_PATTERN.test(parsed.pathname) ? canonical : null;
    } catch (_error) {
      return null;
    }
  }

  function fontSignature(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return '';
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) {
      return 'sfnt';
    }
    if (tag === 'OTTO') return 'otf';
    if (tag === 'wOFF') return 'woff';
    if (tag === 'wOF2') return 'woff2';
    if (bytes.byteLength >= 82 && bytes[34] === 0x4c && bytes[35] === 0x50) return 'eot';
    return '';
  }

  function base64Bytes(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(
        offset,
        Math.min(offset + chunkSize, bytes.byteLength)
      ));
    }
    return btoa(binary);
  }

  function fontFailure(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function stableFontCode(error) {
    if (error && typeof error.code === 'string' && /^FONT_[A-Z_]+$/.test(error.code)) {
      return error.code;
    }
    return 'FONT_FETCH_FAILED';
  }

  async function reserveFont(source, requestId) {
    return withSessionMutation(async () => {
      const now = Date.now();
      await cleanExpired(now);
      const key = model.leaseKey(source.tabId);
      const stored = await sessionGet(key);
      const lease = stored && stored[key];
      if (!validLease(lease, now, true) || lease.requestId !== requestId ||
          lease.sourceHost !== source.host) {
        return { ok: false, code: 'LEASE_MISMATCH' };
      }
      if (lease.fontInFlight) return { ok: false, code: 'FONT_BUSY' };
      if (lease.fontRequests >= limits.MAX_REMOTE_FONTS_PER_REQUEST) {
        return { ok: false, code: 'FONT_REQUEST_LIMIT' };
      }
      const remaining = limits.MAX_REMOTE_FONT_TOTAL_BYTES - lease.fontBytes;
      if (remaining <= 0) return { ok: false, code: 'FONT_LIMIT_EXCEEDED' };
      const reserved = {
        ...lease,
        fontRequests: lease.fontRequests + 1,
        fontInFlight: true
      };
      await sessionSet({ [key]: reserved });
      return {
        ok: true,
        key,
        maxBytes: Math.min(limits.MAX_REMOTE_FONT_BYTES, remaining)
      };
    });
  }

  async function releaseFont(source, requestId, addedBytes) {
    return withSessionMutation(async () => {
      const key = model.leaseKey(source.tabId);
      const stored = await sessionGet(key);
      const lease = stored && stored[key];
      if (!validLease(lease, Date.now(), true) || lease.requestId !== requestId ||
          lease.sourceHost !== source.host || lease.fontInFlight !== true) {
        return { ok: false, code: 'LEASE_MISMATCH' };
      }
      if (!Number.isSafeInteger(addedBytes) || addedBytes < 0 ||
          lease.fontBytes + addedBytes > limits.MAX_REMOTE_FONT_TOTAL_BYTES) {
        const released = { ...lease, fontInFlight: false };
        await sessionSet({ [key]: released });
        return { ok: false, code: 'FONT_LIMIT_EXCEEDED' };
      }
      const released = {
        ...lease,
        fontBytes: lease.fontBytes + addedBytes,
        fontInFlight: false
      };
      await sessionSet({ [key]: released });
      return { ok: true };
    });
  }

  function chunkBytes(value) {
    try {
      if (!value || !ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1 ||
          !Number.isSafeInteger(value.byteLength) || value.byteLength < 0) {
        return null;
      }
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } catch (_error) {
      return null;
    }
  }

  async function streamFont(response, maximumBytes, controller) {
    if (!response || response.ok !== true) fontFailure('FONT_FETCH_FAILED');
    if (response.redirected === true) fontFailure('FONT_REDIRECTED');
    const mimeValue = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-type')
      : null;
    const mime = typeof mimeValue === 'string'
      ? mimeValue.split(';', 1)[0].trim().toLowerCase()
      : '';
    if (!own(FONT_MIME_SIGNATURES, mime)) fontFailure('FONT_MIME_INVALID');
    const declaredValue = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-length')
      : null;
    if (declaredValue !== null) {
      if (typeof declaredValue !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(declaredValue)) {
        fontFailure('FONT_LIMIT_EXCEEDED');
      }
      const declared = Number(declaredValue);
      if (!Number.isSafeInteger(declared) || declared <= 0 || declared > maximumBytes) {
        controller.abort();
        fontFailure('FONT_LIMIT_EXCEEDED');
      }
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      fontFailure('FONT_FETCH_FAILED');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const result = await reader.read();
      if (!result || result.done) break;
      const view = chunkBytes(result.value);
      if (!view) fontFailure('FONT_FETCH_FAILED');
      total += view.byteLength;
      if (!Number.isSafeInteger(total) || total > maximumBytes) {
        controller.abort();
        if (typeof reader.cancel === 'function') {
          try {
            await reader.cancel();
          } catch (_error) {
            // Cancellation is best effort after the hard byte limit is reached.
          }
        }
        fontFailure('FONT_LIMIT_EXCEEDED');
      }
      chunks.push(new Uint8Array(view));
    }
    if (total <= 0) fontFailure('FONT_FETCH_FAILED');
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const signature = fontSignature(bytes);
    if (!signature || !FONT_MIME_SIGNATURES[mime].includes(signature)) {
      fontFailure('FONT_SIGNATURE_INVALID');
    }
    return { mime, bytes };
  }

  async function handleFontFetch(message, sender) {
    if (!exactKeys(message, ['type', 'requestId', 'url'])) {
      return { ok: false, code: 'FONT_REQUEST_REJECTED' };
    }
    const source = validSender(sender);
    if (!source || !model.isUuid(message.requestId)) {
      return { ok: false, code: 'FONT_REQUEST_REJECTED' };
    }
    const fontUrl = canonicalFontUrl(message.url);
    if (!fontUrl) return { ok: false, code: 'FONT_URL_NOT_ALLOWED' };
    const reservation = await reserveFont(source, message.requestId);
    if (!reservation.ok) return { ok: false, code: reservation.code };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), limits.RESOURCE_TIMEOUT_MS);
    let loaded;
    let failureCode = null;
    try {
      const response = await fetch(fontUrl, {
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: controller.signal
      });
      loaded = await streamFont(response, reservation.maxBytes, controller);
    } catch (error) {
      failureCode = stableFontCode(error);
    } finally {
      clearTimeout(timeout);
    }
    if (failureCode) {
      try {
        await releaseFont(source, message.requestId, 0);
      } catch (_error) {
        // Lease expiry or tab closure is already a terminal request state.
      }
      return { ok: false, code: failureCode };
    }
    const released = await releaseFont(source, message.requestId, loaded.bytes.byteLength);
    if (!released.ok) return { ok: false, code: released.code };
    return {
      ok: true,
      mime: loaded.mime,
      byteLength: loaded.bytes.byteLength,
      base64: base64Bytes(loaded.bytes)
    };
  }

  async function handleAlarm(alarm) {
    if (!dataRecord(alarm) || typeof alarm.name !== 'string') return;
    const sessionMatch = /^expire:session:([0-9a-f-]+)$/i.exec(alarm.name);
    if (sessionMatch && model.isUuid(sessionMatch[1])) {
      const sessionId = sessionMatch[1];
      const key = model.sessionKey(sessionId);
      const stored = await sessionGet(key);
      const envelope = stored && stored[key];
      if (!envelope) return;
      if (Number.isSafeInteger(envelope.expiresAt) && Date.now() < envelope.expiresAt) {
        await alarmCreate(sessionAlarm(sessionId), { when: envelope.expiresAt });
      } else {
        await sessionRemove(key);
      }
      return;
    }
    const leaseMatch = /^expire:lease:([0-9]+)$/.exec(alarm.name);
    if (leaseMatch) {
      const tabId = Number(leaseMatch[1]);
      const key = model.leaseKey(tabId);
      const stored = await sessionGet(key);
      const lease = stored && stored[key];
      if (!lease) return;
      if (validLease(lease, Date.now(), true)) {
        await alarmCreate(leaseAlarm(tabId), { when: lease.expiresAt });
      } else {
        await sessionRemove(key);
      }
    }
  }

  function onRuntimeMessage(message, sender, sendResponse) {
    const type = dataRecord(message) ? message.type : null;
    if (type === 'YKT_EXTRACTION_COMPLETE') {
      void handleCompletion(message, sender).then(sendResponse, () => {
        sendResponse({ ok: false, code: 'SESSION_STORAGE_FAILED' });
      });
      return true;
    }
    if (type === 'YKT_EXTRACTION_FAILED') {
      void handleFailure(message, sender).then(sendResponse, () => {
        sendResponse({ ok: false, code: 'SESSION_STORAGE_FAILED' });
      });
      return true;
    }
    if (type === 'YKT_FONT_FETCH') {
      void handleFontFetch(message, sender).then(sendResponse, () => {
        sendResponse({ ok: false, code: 'FONT_FETCH_FAILED' });
      });
      return true;
    }
    return false;
  }

  chrome.action.onClicked.addListener(onActionClicked);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.alarms.onAlarm.addListener((alarm) => {
    void withSessionMutation(() => handleAlarm(alarm));
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (Number.isSafeInteger(tabId) && tabId >= 0) {
      void withSessionMutation(() => removeLease(tabId));
    }
  });
  void withSessionMutation(() => cleanExpired(Date.now()));
})(globalThis);
