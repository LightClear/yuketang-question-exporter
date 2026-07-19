(function registerModel(root) {
  const ns = root.YktQuestionExporter;
  if (ns.model) return;

  const limits = ns.limits;
  const richText = ns.richText;
  const urlPolicy = ns.urlPolicy;
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const QUESTION_ID = /^q-[1-9][0-9]{0,5}$/;
  const PAGE_KINDS = Object.freeze({ standard: true, 'cloud-exercise': true, result: true });
  const STATUSES = Object.freeze({ ok: true, incomplete: true, failed: true });
  const WARNING_RULES = Object.freeze({
    PARTIAL_EXTRACTION: Object.freeze({ messageKey: 'partialExtraction', ordinal: true, resource: 'none' }),
    CLOUD_CACHE_PARTIAL: Object.freeze({ messageKey: 'cloudCachePartial', ordinal: false, resource: 'none' }),
    IMAGE_ALT_MISSING: Object.freeze({ messageKey: 'imageAltMissing', ordinal: true, resource: 'image' }),
    IMAGE_BLOCKED: Object.freeze({ messageKey: 'imageBlocked', ordinal: true, resource: 'optional-image' }),
    FONT_FETCH_FAILED: Object.freeze({ messageKey: 'fontFetchFailed', ordinal: false, resource: 'none' })
  });
  const RASTER_MIME = Object.freeze({
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/gif': 'gif',
    'image/webp': 'webp'
  });
  const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const BLANK_TEXT = '\u00a0'.repeat(8);
  const FUNCTION_TO_STRING = Function.prototype.toString;
  const NATIVE_CONSTRUCTOR_SOURCE = Object.freeze({
    Object: FUNCTION_TO_STRING.call(Object),
    Array: FUNCTION_TO_STRING.call(Array)
  });
  const MAX_SAFE_TEXT_BYTES = limits.MAX_QUESTION_BYTES;
  const MAX_DATA_TREE_VALUES = (limits.MAX_AST_NODES_PER_QUESTION * 4) + 32;
  const MAX_SERIALIZABLE_VALUES = (limits.MAX_AST_NODES_PER_SESSION * 20) +
    (limits.MAX_QUESTIONS * 20);
  const FAILED_QUESTION_KEYS = new Set(['id', 'ordinal', 'status', 'metaText', 'images', 'math']);

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function ownDescriptor(value, key, code = 'MODEL_INVALID') {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_error) {
      fail(code);
    }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail(code);
    return descriptor;
  }

  function ownValue(value, key, code = 'MODEL_INVALID') {
    return ownDescriptor(value, key, code).value;
  }

  function ownDataKeys(value, code = 'MODEL_INVALID') {
    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch (_error) {
      fail(code);
    }
    for (const key of keys) {
      if (typeof key !== 'string') fail(code);
      ownDescriptor(value, key, code);
    }
    return keys;
  }

  function nativeConstructorMatches(constructor, constructorName, prototype) {
    if (typeof constructor !== 'function') return false;
    let source;
    let nameDescriptor;
    let prototypeDescriptor;
    try {
      source = FUNCTION_TO_STRING.call(constructor);
      nameDescriptor = Object.getOwnPropertyDescriptor(constructor, 'name');
      prototypeDescriptor = Object.getOwnPropertyDescriptor(constructor, 'prototype');
    } catch (_error) {
      return false;
    }
    return source === NATIVE_CONSTRUCTOR_SOURCE[constructorName] &&
      Boolean(nameDescriptor && Object.prototype.hasOwnProperty.call(nameDescriptor, 'value') &&
        nameDescriptor.value === constructorName) &&
      Boolean(prototypeDescriptor && Object.prototype.hasOwnProperty.call(prototypeDescriptor, 'value') &&
        prototypeDescriptor.value === prototype);
  }

  function isStandardObjectPrototype(prototype) {
    if (prototype === null || Array.isArray(prototype)) return false;
    let constructorDescriptor;
    let toJsonDescriptor;
    let parent;
    try {
      constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
      toJsonDescriptor = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
      parent = Object.getPrototypeOf(prototype);
    } catch (_error) {
      return false;
    }
    return parent === null && toJsonDescriptor === undefined &&
      Boolean(constructorDescriptor && Object.prototype.hasOwnProperty.call(constructorDescriptor, 'value')) &&
      nativeConstructorMatches(constructorDescriptor.value, 'Object', prototype);
  }

  function isStandardArrayPrototype(prototype) {
    if (!Array.isArray(prototype)) return false;
    let constructorDescriptor;
    let toJsonDescriptor;
    let parent;
    try {
      constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
      toJsonDescriptor = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
      parent = Object.getPrototypeOf(prototype);
    } catch (_error) {
      return false;
    }
    return toJsonDescriptor === undefined &&
      Boolean(constructorDescriptor && Object.prototype.hasOwnProperty.call(constructorDescriptor, 'value')) &&
      nativeConstructorMatches(constructorDescriptor.value, 'Array', prototype) &&
      isStandardObjectPrototype(parent);
  }

  function hasStandardPrototype(value, constructorName) {
    let prototype;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch (_error) {
      return false;
    }
    if (constructorName === 'Object' && prototype === null) return true;
    if (constructorName === 'Object') return isStandardObjectPrototype(prototype);
    if (constructorName === 'Array') return isStandardArrayPrototype(prototype);
    return false;
  }

  function requireRecord(value, required, allowed, code = 'MODEL_INVALID') {
    if (value === null || typeof value !== 'object' || Array.isArray(value) ||
        !hasStandardPrototype(value, 'Object')) fail(code);
    const keys = ownDataKeys(value, code);
    for (const key of keys) {
      if (!allowed.has(key)) fail(code);
    }
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) fail(code);
    }
    return value;
  }

  function requireDenseArray(value, maxLength, limitCode = 'MODEL_LIMIT_EXCEEDED') {
    if (!Array.isArray(value) || !hasStandardPrototype(value, 'Array')) fail('MODEL_INVALID');
    const length = ownValue(value, 'length');
    if (!Number.isSafeInteger(length) || length < 0) fail('MODEL_INVALID');
    if (length > maxLength) fail(limitCode);
    const keys = ownDataKeys(value);
    for (const key of keys) {
      if (key === 'length') continue;
      if (!/^(0|[1-9][0-9]*)$/.test(key)) fail('MODEL_INVALID');
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index >= length) fail('MODEL_INVALID');
    }
    for (let index = 0; index < length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) fail('MODEL_INVALID');
    }
    return value;
  }

  function assertPlainDataTree(value, limitCode = 'AST_LIMIT_EXCEEDED') {
    const seen = new WeakSet();
    const stack = [value];
    let count = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === null || typeof current === 'string' || typeof current === 'boolean' ||
          typeof current === 'number') continue;
      if (typeof current !== 'object') fail('MODEL_INVALID');
      if (seen.has(current)) fail('MODEL_INVALID');
      seen.add(current);
      count += 1;
      if (count > MAX_DATA_TREE_VALUES) fail(limitCode);
      if (Array.isArray(current)) {
        requireDenseArray(current, limits.MAX_AST_NODES_PER_QUESTION, limitCode);
        for (let index = current.length - 1; index >= 0; index -= 1) stack.push(ownValue(current, String(index)));
      } else {
        if (!hasStandardPrototype(current, 'Object')) fail('MODEL_INVALID');
        for (const key of ownDataKeys(current)) stack.push(ownValue(current, key));
      }
    }
  }

  function assertSerializableTree(value) {
    const seen = new WeakSet();
    const stack = [value];
    let count = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
      if (typeof current === 'number') {
        if (!Number.isFinite(current)) fail('MODEL_INVALID');
        continue;
      }
      if (typeof current !== 'object') fail('MODEL_INVALID');
      if (seen.has(current)) continue;
      seen.add(current);
      count += 1;
      if (count > MAX_SERIALIZABLE_VALUES) fail('MODEL_INVALID');
      if (Array.isArray(current)) {
        if (!hasStandardPrototype(current, 'Array')) fail('MODEL_INVALID');
        const length = ownValue(current, 'length');
        if (!Number.isSafeInteger(length) || length < 0) fail('MODEL_INVALID');
        const keys = ownDataKeys(current);
        for (const key of keys) {
          if (key === 'length') continue;
          if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) fail('MODEL_INVALID');
        }
        for (let index = 0; index < length; index += 1) {
          if (!Object.prototype.hasOwnProperty.call(current, index)) fail('MODEL_INVALID');
          stack.push(ownValue(current, String(index)));
        }
      } else {
        if (!hasStandardPrototype(current, 'Object')) fail('MODEL_INVALID');
        for (const key of ownDataKeys(current)) stack.push(ownValue(current, key));
      }
    }
  }

  function serializedBytes(value) {
    assertSerializableTree(value);
    let json;
    try {
      json = JSON.stringify(value);
    } catch (_error) {
      fail('MODEL_INVALID');
    }
    if (typeof json !== 'string') fail('MODEL_INVALID');
    return new TextEncoder().encode(json).byteLength;
  }

  function hasForbiddenControl(value) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if ((code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
          code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true;
    }
    return false;
  }

  function requireString(value, options = {}) {
    const allowEmpty = options.allowEmpty !== false;
    const maxBytes = options.maxBytes === undefined ? MAX_SAFE_TEXT_BYTES : options.maxBytes;
    const limitCode = options.limitCode || 'MODEL_LIMIT_EXCEEDED';
    if (typeof value !== 'string' || hasForbiddenControl(value)) fail('MODEL_INVALID');
    if (!allowEmpty && value.trim().length === 0) fail('MODEL_INVALID');
    if (new TextEncoder().encode(value).byteLength > maxBytes) fail(limitCode);
    return value;
  }

  function isUuid(value) {
    return typeof value === 'string' && UUID_V4.test(value);
  }

  function sessionKey(uuid) {
    if (!isUuid(uuid)) fail('MODEL_INVALID');
    return `questionSession:${uuid}`;
  }

  function leaseKey(tabId) {
    if (!Number.isSafeInteger(tabId) || tabId < 0) fail('MODEL_INVALID');
    return `extractLease:${tabId}`;
  }

  function isCanonicalIso(value) {
    if (typeof value !== 'string') return false;
    try {
      const parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
    } catch (_error) {
      return false;
    }
  }

  function validateSource(value) {
    requireRecord(
      value,
      new Set(['host', 'pageKind', 'extractedAt']),
      new Set(['host', 'pageKind', 'extractedAt'])
    );
    const host = ownValue(value, 'host');
    const pageKind = ownValue(value, 'pageKind');
    const extractedAt = ownValue(value, 'extractedAt');
    if (typeof host !== 'string' || host !== host.toLowerCase() || host.endsWith('.') ||
        !urlPolicy.isAllowedHost(host)) fail('MODEL_INVALID');
    try {
      if (new URL(`https://${host}/`).hostname !== host) fail('MODEL_INVALID');
    } catch (_error) {
      fail('MODEL_INVALID');
    }
    if (typeof pageKind !== 'string' || !Object.prototype.hasOwnProperty.call(PAGE_KINDS, pageKind)) {
      fail('MODEL_INVALID');
    }
    if (!isCanonicalIso(extractedAt)) fail('MODEL_INVALID');
    return { host, pageKind, extractedAt };
  }

  function parseCanonicalDataImage(value) {
    if (typeof value !== 'string') fail('MODEL_INVALID');
    const marker = ';base64,';
    const markerIndex = value.indexOf(marker);
    if (!value.startsWith('data:image/') || markerIndex < 0 || value.indexOf(',', markerIndex + marker.length) >= 0) {
      fail('MODEL_INVALID');
    }
    const mime = value.slice(5, markerIndex);
    if (!Object.prototype.hasOwnProperty.call(RASTER_MIME, mime)) fail('MODEL_INVALID');
    const encoded = value.slice(markerIndex + marker.length);
    if (encoded.length === 0 || encoded.length % 4 !== 0) fail('MODEL_INVALID');
    const maximumEncoded = Math.ceil(limits.MAX_INLINE_IMAGE_BYTES / 3) * 4;
    if (encoded.length > maximumEncoded) fail('IMAGE_LIMIT_EXCEEDED');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('MODEL_INVALID');
    const firstPadding = encoded.indexOf('=');
    if (firstPadding >= 0 && firstPadding < encoded.length - 2) fail('MODEL_INVALID');
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    const lastData = BASE64_ALPHABET.indexOf(encoded[encoded.length - padding - 1]);
    if (lastData < 0 || (padding === 2 && (lastData & 15) !== 0) ||
        (padding === 1 && (lastData & 3) !== 0)) fail('MODEL_INVALID');
    const byteLength = (encoded.length / 4 * 3) - padding;
    if (byteLength > limits.MAX_INLINE_IMAGE_BYTES) fail('IMAGE_LIMIT_EXCEEDED');
    const prefix = [];
    for (let offset = 0; offset < encoded.length && prefix.length < 12; offset += 4) {
      const a = BASE64_ALPHABET.indexOf(encoded[offset]);
      const b = BASE64_ALPHABET.indexOf(encoded[offset + 1]);
      const c = encoded[offset + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(encoded[offset + 2]);
      const d = encoded[offset + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(encoded[offset + 3]);
      if (a < 0 || b < 0 || c < 0 || d < 0) fail('MODEL_INVALID');
      prefix.push((a << 2) | (b >> 4));
      if (encoded[offset + 2] !== '=') prefix.push(((b & 15) << 4) | (c >> 2));
      if (encoded[offset + 3] !== '=') prefix.push(((c & 3) << 6) | d);
    }
    const ascii = (start, text) => {
      for (let index = 0; index < text.length; index += 1) {
        if (prefix[start + index] !== text.charCodeAt(index)) return false;
      }
      return true;
    };
    const signatureMatches =
      (mime === 'image/png' && prefix.length >= 8 &&
        prefix[0] === 0x89 && ascii(1, 'PNG') && prefix[4] === 0x0d && prefix[5] === 0x0a &&
        prefix[6] === 0x1a && prefix[7] === 0x0a) ||
      (mime === 'image/jpeg' && prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) ||
      (mime === 'image/gif' && prefix.length >= 6 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) ||
      (mime === 'image/webp' && prefix.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP'));
    if (!signatureMatches) fail('MODEL_INVALID');
    return byteLength;
  }

  function validateImages(value, ordinal) {
    requireDenseArray(value, limits.MAX_IMAGES, 'IMAGE_LIMIT_EXCEEDED');
    const result = [];
    let inlineBytes = 0;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = ownValue(value, String(index));
      requireRecord(
        descriptor,
        new Set(['id', 'kind', 'src', 'alt', 'decorative']),
        new Set(['id', 'kind', 'src', 'alt', 'decorative'])
      );
      const id = ownValue(descriptor, 'id');
      const kind = ownValue(descriptor, 'kind');
      const source = ownValue(descriptor, 'src');
      const alt = requireString(ownValue(descriptor, 'alt'));
      const decorative = ownValue(descriptor, 'decorative');
      if (id !== `q-${ordinal}-img-${index + 1}` || (kind !== 'remote' && kind !== 'data') ||
          typeof decorative !== 'boolean') fail('MODEL_INVALID');
      if ((decorative && alt !== '') || (!decorative && alt.trim().length === 0)) fail('MODEL_INVALID');
      let canonicalSource;
      if (kind === 'remote') {
        requireString(source, { allowEmpty: false });
        try {
          canonicalSource = urlPolicy.normalizeRemoteUrl(source);
        } catch (_error) {
          fail('MODEL_INVALID');
        }
      } else {
        inlineBytes += parseCanonicalDataImage(source);
        canonicalSource = source;
      }
      result.push({ id, kind, src: canonicalSource, alt, decorative });
    }
    return { images: result, inlineBytes };
  }

  function validateMath(value, ordinal) {
    requireDenseArray(value, limits.MAX_AST_NODES_PER_QUESTION, 'AST_LIMIT_EXCEEDED');
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = ownValue(value, String(index));
      requireRecord(
        descriptor,
        new Set(['id', 'tex', 'display', 'fallbackText']),
        new Set(['id', 'tex', 'display', 'fallbackText'])
      );
      const id = ownValue(descriptor, 'id');
      const tex = requireString(ownValue(descriptor, 'tex'), {
        allowEmpty: false, maxBytes: limits.MAX_TEX_BYTES, limitCode: 'MODEL_LIMIT_EXCEEDED'
      });
      const display = ownValue(descriptor, 'display');
      const fallbackText = requireString(ownValue(descriptor, 'fallbackText'));
      if (id !== `q-${ordinal}-math-${index + 1}` || typeof display !== 'boolean') fail('MODEL_INVALID');
      result.push({ id, tex, display, fallbackText });
    }
    return result;
  }

  function inspectAst(nodes) {
    assertPlainDataTree(nodes);
    const imageIds = new Set();
    const mathIds = new Set();
    const stack = [];
    for (let index = nodes.length - 1; index >= 0; index -= 1) stack.push(ownValue(nodes, String(index)));
    let count = 0;
    while (stack.length > 0) {
      const node = stack.pop();
      count += 1;
      if (count > limits.MAX_AST_NODES_PER_QUESTION) fail('AST_LIMIT_EXCEEDED');
      if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
        const typeDescriptor = Object.getOwnPropertyDescriptor(node, 'type');
        if (typeDescriptor && Object.prototype.hasOwnProperty.call(typeDescriptor, 'value')) {
          if (typeDescriptor.value === 'image') {
            const descriptor = Object.getOwnPropertyDescriptor(node, 'imageId');
            if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') && typeof descriptor.value === 'string') {
              imageIds.add(descriptor.value);
            }
          } else if (typeDescriptor.value === 'math') {
            const descriptor = Object.getOwnPropertyDescriptor(node, 'mathId');
            if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') && typeof descriptor.value === 'string') {
              mathIds.add(descriptor.value);
            }
          } else if (typeDescriptor.value === 'element') {
            const childrenDescriptor = Object.getOwnPropertyDescriptor(node, 'children');
            if (childrenDescriptor && Object.prototype.hasOwnProperty.call(childrenDescriptor, 'value') &&
                Array.isArray(childrenDescriptor.value)) {
              const children = childrenDescriptor.value;
              for (let index = children.length - 1; index >= 0; index -= 1) {
                if (Object.prototype.hasOwnProperty.call(children, index)) stack.push(ownValue(children, String(index)));
              }
            }
          }
        }
      }
    }
    richText.validate(nodes, { imageIds, mathIds });
    return { imageIds, mathIds, count, nodes: cloneAst(nodes) };
  }

  function cloneAst(nodes) {
    return nodes.map((node) => {
      if (node.type === 'text') return { type: 'text', value: node.value };
      if (node.type === 'image') return { type: 'image', imageId: node.imageId };
      if (node.type === 'math') return { type: 'math', mathId: node.mathId };
      const attrs = {};
      if (Object.prototype.hasOwnProperty.call(node.attrs, 'rowspan')) attrs.rowspan = node.attrs.rowspan;
      if (Object.prototype.hasOwnProperty.call(node.attrs, 'colspan')) attrs.colspan = node.attrs.colspan;
      if (Object.prototype.hasOwnProperty.call(node.attrs, 'display')) attrs.display = node.attrs.display;
      return { type: 'element', tag: node.tag, attrs, children: cloneAst(node.children) };
    });
  }

  function astHasContent(nodes) {
    const stack = nodes.slice();
    while (stack.length > 0) {
      const node = stack.pop();
      if (node.type === 'text' && node.value.trim().length > 0) return true;
      if (node.type === 'image' || node.type === 'math') return true;
      if (node.type === 'element') {
        if (node.tag === 'hr' || (
          node.tag === 'u' &&
          node.children.length === 1 &&
          node.children[0].type === 'text' &&
          node.children[0].value === BLANK_TEXT
        )) return true;
        for (const child of node.children) stack.push(child);
      }
    }
    return false;
  }

  function mergeReferences(target, source) {
    for (const id of source) {
      if (target.has(id)) fail('AST_RESOURCE_MISMATCH');
      target.add(id);
    }
  }

  function validateQuestion(value, expectedOrdinal) {
    requireRecord(
      value,
      new Set(['id', 'ordinal', 'status', 'metaText', 'images', 'math']),
      new Set([
        'id', 'ordinal', 'status', 'metaText', 'body', 'options', 'correctAnswer', 'explanation', 'images', 'math'
      ])
    );
    const id = ownValue(value, 'id');
    const ordinal = ownValue(value, 'ordinal');
    const status = ownValue(value, 'status');
    const metaText = requireString(ownValue(value, 'metaText'));
    if (typeof id !== 'string' || !QUESTION_ID.test(id) || ordinal !== expectedOrdinal || id !== `q-${ordinal}` ||
        typeof status !== 'string' || !Object.prototype.hasOwnProperty.call(STATUSES, status)) fail('MODEL_INVALID');
    const imageResult = validateImages(ownValue(value, 'images'), ordinal);
    const math = validateMath(ownValue(value, 'math'), ordinal);

    if (status === 'failed') {
      const keys = ownDataKeys(value);
      for (const key of keys) {
        if (!FAILED_QUESTION_KEYS.has(key)) fail('MODEL_INVALID');
      }
      if (imageResult.images.length !== 0 || math.length !== 0) fail('MODEL_INVALID');
      return {
        question: { id, ordinal, status, metaText, images: [], math: [] },
        astNodes: 0,
        inlineBytes: 0,
        resourceOwners: []
      };
    }

    if (!Object.prototype.hasOwnProperty.call(value, 'body') ||
        !Object.prototype.hasOwnProperty.call(value, 'options')) fail('MODEL_INVALID');
    const allImageRefs = new Set();
    const allMathRefs = new Set();
    let astNodes = 0;
    const bodyResult = inspectAst(ownValue(value, 'body'));
    if (!astHasContent(bodyResult.nodes)) fail('MODEL_INVALID');
    mergeReferences(allImageRefs, bodyResult.imageIds);
    mergeReferences(allMathRefs, bodyResult.mathIds);
    astNodes += bodyResult.count;
    let richAstBytes = serializedBytes(bodyResult.nodes);

    const optionsValue = ownValue(value, 'options');
    requireDenseArray(optionsValue, limits.MAX_AST_NODES_PER_QUESTION, 'AST_LIMIT_EXCEEDED');
    const options = [];
    for (let index = 0; index < optionsValue.length; index += 1) {
      const option = ownValue(optionsValue, String(index));
      requireRecord(option, new Set(['label', 'content']), new Set(['label', 'content']));
      const label = requireString(ownValue(option, 'label'), { allowEmpty: false });
      const contentResult = inspectAst(ownValue(option, 'content'));
      if (!astHasContent(contentResult.nodes)) fail('MODEL_INVALID');
      mergeReferences(allImageRefs, contentResult.imageIds);
      mergeReferences(allMathRefs, contentResult.mathIds);
      astNodes += contentResult.count;
      richAstBytes += serializedBytes(contentResult.nodes);
      options.push({ label, content: contentResult.nodes });
    }
    const question = {
      id, ordinal, status, metaText, body: bodyResult.nodes, options
    };
    for (const key of ['correctAnswer', 'explanation']) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const result = inspectAst(ownValue(value, key));
      if (!astHasContent(result.nodes)) fail('MODEL_INVALID');
      mergeReferences(allImageRefs, result.imageIds);
      mergeReferences(allMathRefs, result.mathIds);
      astNodes += result.count;
      richAstBytes += serializedBytes(result.nodes);
      question[key] = result.nodes;
    }
    if (richAstBytes > limits.MAX_QUESTION_BYTES) fail('AST_LIMIT_EXCEEDED');
    if (astNodes > limits.MAX_AST_NODES_PER_QUESTION) fail('AST_LIMIT_EXCEEDED');
    const imageIds = new Set(imageResult.images.map((descriptor) => descriptor.id));
    const mathIds = new Set(math.map((descriptor) => descriptor.id));
    for (const descriptorId of imageIds) if (mathIds.has(descriptorId)) fail('MODEL_INVALID');
    if (allImageRefs.size !== imageIds.size || allMathRefs.size !== mathIds.size) fail('AST_RESOURCE_MISMATCH');
    for (const idValue of allImageRefs) if (!imageIds.has(idValue) || mathIds.has(idValue)) fail('AST_RESOURCE_MISMATCH');
    for (const idValue of allMathRefs) if (!mathIds.has(idValue) || imageIds.has(idValue)) fail('AST_RESOURCE_MISMATCH');
    question.images = imageResult.images;
    question.math = math;
    const resourceOwners = [
      ...imageResult.images.map((descriptor) => [descriptor.id, { ordinal, kind: 'image' }]),
      ...math.map((descriptor) => [descriptor.id, { ordinal, kind: 'math' }])
    ];
    return { question, astNodes, inlineBytes: imageResult.inlineBytes, resourceOwners };
  }

  function validateWarnings(value, questions, resourceOwners) {
    requireDenseArray(value, limits.MAX_AST_NODES_PER_SESSION, 'MODEL_LIMIT_EXCEEDED');
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const warning = ownValue(value, String(index));
      requireRecord(
        warning,
        new Set(['code', 'questionOrdinal', 'resourceId', 'messageKey']),
        new Set(['code', 'questionOrdinal', 'resourceId', 'messageKey'])
      );
      const code = ownValue(warning, 'code');
      const questionOrdinal = ownValue(warning, 'questionOrdinal');
      const resourceId = ownValue(warning, 'resourceId');
      const messageKey = ownValue(warning, 'messageKey');
      if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(WARNING_RULES, code)) {
        fail('MODEL_INVALID');
      }
      const rule = WARNING_RULES[code];
      if (messageKey !== rule.messageKey) fail('MODEL_INVALID');
      if (rule.ordinal) {
        if (!Number.isSafeInteger(questionOrdinal) || questionOrdinal < 1 || questionOrdinal > questions.length) {
          fail('MODEL_INVALID');
        }
      } else if (questionOrdinal !== null) fail('MODEL_INVALID');
      if (rule.resource === 'none') {
        if (resourceId !== null) fail('MODEL_INVALID');
      } else if (rule.resource === 'optional-image') {
        if (resourceId !== null) {
          if (typeof resourceId !== 'string') fail('MODEL_INVALID');
          const owner = resourceOwners.get(resourceId);
          if (!owner || owner.kind !== 'image' || owner.ordinal !== questionOrdinal) fail('MODEL_INVALID');
        }
      } else {
        if (typeof resourceId !== 'string') fail('MODEL_INVALID');
        const owner = resourceOwners.get(resourceId);
        if (!owner || owner.kind !== rule.resource || owner.ordinal !== questionOrdinal) fail('MODEL_INVALID');
      }
      result.push({ code, questionOrdinal, resourceId, messageKey });
    }
    return result;
  }

  function deepFreeze(value) {
    const stack = [value];
    const seen = new WeakSet();
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === null || typeof current !== 'object' || seen.has(current)) continue;
      seen.add(current);
      for (const key of Object.keys(current)) stack.push(current[key]);
      Object.freeze(current);
    }
    return value;
  }

  function validatePayload(value) {
    requireRecord(
      value,
      new Set(['schemaVersion', 'source', 'questions', 'warnings']),
      new Set(['schemaVersion', 'source', 'questions', 'warnings'])
    );
    if (ownValue(value, 'schemaVersion') !== 1) fail('MODEL_INVALID');
    const source = validateSource(ownValue(value, 'source'));
    const questionValues = ownValue(value, 'questions');
    requireDenseArray(questionValues, limits.MAX_QUESTIONS, 'MODEL_LIMIT_EXCEEDED');
    const questions = [];
    const resourceOwners = new Map();
    let totalAstNodes = 0;
    let totalImages = 0;
    let totalInlineBytes = 0;
    let accumulatedQuestionBytes = 0;
    for (let index = 0; index < questionValues.length; index += 1) {
      const result = validateQuestion(ownValue(questionValues, String(index)), index + 1);
      questions.push(result.question);
      totalAstNodes += result.astNodes;
      totalImages += result.question.images.length;
      totalInlineBytes += result.inlineBytes;
      accumulatedQuestionBytes += serializedBytes(result.question);
      if (totalAstNodes > limits.MAX_AST_NODES_PER_SESSION) fail('AST_LIMIT_EXCEEDED');
      if (totalImages > limits.MAX_IMAGES) fail('IMAGE_LIMIT_EXCEEDED');
      if (totalInlineBytes > limits.MAX_INLINE_IMAGE_TOTAL_BYTES) fail('IMAGE_LIMIT_EXCEEDED');
      if (accumulatedQuestionBytes > limits.MAX_SESSION_BYTES) fail('MODEL_LIMIT_EXCEEDED');
      for (const [id, owner] of result.resourceOwners) {
        if (resourceOwners.has(id)) fail('MODEL_INVALID');
        resourceOwners.set(id, owner);
      }
    }
    const warnings = validateWarnings(ownValue(value, 'warnings'), questions, resourceOwners);
    const canonical = { schemaVersion: 1, source, questions, warnings };
    if (serializedBytes(canonical) > limits.MAX_SESSION_BYTES) fail('MODEL_LIMIT_EXCEEDED');
    return deepFreeze(canonical);
  }

  function requireNow(value) {
    if (!Number.isSafeInteger(value) || value < 0) fail('MODEL_INVALID');
    return value;
  }

  function createSessionEnvelope(payload, nowMs) {
    const createdAt = requireNow(nowMs);
    const expiresAt = createdAt + limits.SESSION_TTL_MS;
    if (!Number.isSafeInteger(expiresAt)) fail('MODEL_INVALID');
    return deepFreeze({
      schemaVersion: 1,
      createdAt,
      expiresAt,
      payload: validatePayload(payload)
    });
  }

  function validateSessionEnvelope(value, nowMs) {
    const now = requireNow(nowMs);
    requireRecord(
      value,
      new Set(['schemaVersion', 'createdAt', 'expiresAt', 'payload']),
      new Set(['schemaVersion', 'createdAt', 'expiresAt', 'payload'])
    );
    const schemaVersion = ownValue(value, 'schemaVersion');
    const createdAt = ownValue(value, 'createdAt');
    const expiresAt = ownValue(value, 'expiresAt');
    if (schemaVersion !== 1 || !Number.isSafeInteger(createdAt) || createdAt < 0 ||
        !Number.isSafeInteger(expiresAt) || expiresAt !== createdAt + limits.SESSION_TTL_MS ||
        createdAt > now) fail('MODEL_INVALID');
    if (now >= expiresAt) fail('SESSION_EXPIRED');
    return deepFreeze({
      schemaVersion: 1,
      createdAt,
      expiresAt,
      payload: validatePayload(ownValue(value, 'payload'))
    });
  }

  ns.model = Object.freeze({
    validatePayload,
    createSessionEnvelope,
    validateSessionEnvelope,
    serializedBytes,
    isUuid,
    sessionKey,
    leaseKey
  });
})(globalThis);
