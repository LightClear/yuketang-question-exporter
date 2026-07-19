(function registerRichText(root) {
  const ns = root.YktQuestionExporter;
  if (ns.richText) return;

  const limits = ns.limits;
  const ALLOWED_HTML = new Set([
    'p', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li',
    'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'hr'
  ]);
  const TRANSPARENT = new Set(['div', 'a']);
  const DROP_SUBTREE = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'form', 'button']);
  const BLOCKED_HTML_NON_VOID = new Set(['script', 'style', 'iframe', 'object', 'form', 'button']);
  const MATHML = new Set([
    'math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'msup', 'msub', 'msubsup',
    'mfrac', 'msqrt', 'mroot', 'mfenced', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd',
    'annotation'
  ]);
  const VOID = new Set(['br', 'hr']);
  const ALL_ELEMENTS = new Set([...ALLOWED_HTML, ...MATHML]);
  const BASIC_ENTITIES = Object.freeze({
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0'
  });
  const RESOURCE_ID_MAX_BYTES = 256;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  function hasForbiddenControl(value) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if ((code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
          code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
        return true;
      }
    }
    return false;
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function ownKeys(value) {
    let keys;
    try {
      keys = Reflect.ownKeys(value);
      for (const key of keys) {
        if (typeof key !== 'string') fail('AST_INVALID');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('AST_INVALID');
      }
    } catch (_error) {
      fail('AST_INVALID');
    }
    return keys;
  }

  function ownDataValue(value, key) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_error) {
      fail('AST_INVALID');
    }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('AST_INVALID');
    return descriptor.value;
  }

  function requireDenseArray(value) {
    if (!Array.isArray(value)) fail('AST_INVALID');
    if (value.length > limits.MAX_AST_NODES_PER_QUESTION) fail('AST_LIMIT_EXCEEDED');
    const keys = ownKeys(value);
    for (const key of keys) {
      if (key === 'length') continue;
      if (key.length === 0 || (key.length > 1 && key.charCodeAt(0) === 0x30)) fail('AST_INVALID');
      let index = 0;
      for (let offset = 0; offset < key.length; offset += 1) {
        const code = key.charCodeAt(offset);
        if (code < 0x30 || code > 0x39) fail('AST_INVALID');
        index = (index * 10) + code - 0x30;
        if (!Number.isSafeInteger(index)) fail('AST_INVALID');
      }
      if (index >= value.length) fail('AST_INVALID');
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) fail('AST_INVALID');
    }
  }

  function requireKeys(value, required, allowed) {
    if (!isRecord(value)) fail('AST_INVALID');
    const keys = ownKeys(value);
    for (const key of keys) {
      if (!allowed.has(key)) fail('AST_INVALID');
    }
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) fail('AST_INVALID');
    }
  }

  function isCanonicalSpan(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2) return false;
    if (value.length > 1 && value.charCodeAt(0) === 0x30) return false;
    let number = 0;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code < 0x30 || code > 0x39) return false;
      number = (number * 10) + code - 0x30;
    }
    return number >= 1 && number <= 20;
  }

  function canonicalSpan(value) {
    if (typeof value !== 'string' || value.length === 0) return null;
    let number = 0;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code < 0x30 || code > 0x39) return null;
      number = (number * 10) + code - 0x30;
      if (number > 20) return null;
    }
    return number >= 1 ? String(number) : null;
  }

  function isResourceId(value) {
    return typeof value === 'string' && value.length > 0 && !hasForbiddenControl(value) &&
      byteLength(value) <= RESOURCE_ID_MAX_BYTES;
  }

  function normalizeDeclaredIds(value) {
    if (Object.prototype.toString.call(value) !== '[object Set]') fail('AST_INVALID');
    const result = new Set();
    try {
      for (const id of value) {
        if (!isResourceId(id)) fail('AST_INVALID');
        result.add(id);
      }
    } catch (error) {
      if (error && error.code) throw error;
      fail('AST_INVALID');
    }
    return result;
  }

  function validateAttrs(tag, attrs) {
    if (!isRecord(attrs)) fail('AST_INVALID');
    const keys = ownKeys(attrs);
    if (tag === 'td' || tag === 'th') {
      for (const key of keys) {
        if ((key !== 'rowspan' && key !== 'colspan') || !isCanonicalSpan(attrs[key])) {
          fail('AST_INVALID');
        }
      }
      return;
    }
    if (tag === 'math') {
      for (const key of keys) {
        if (key !== 'display' || (attrs[key] !== 'block' && attrs[key] !== 'inline')) {
          fail('AST_INVALID');
        }
      }
      return;
    }
    if (keys.length !== 0) fail('AST_INVALID');
  }

  function validateCore(nodes, declaredResources) {
    requireDenseArray(nodes);
    const declaredImages = declaredResources ? normalizeDeclaredIds(declaredResources.imageIds) : null;
    const declaredMaths = declaredResources ? normalizeDeclaredIds(declaredResources.mathIds) : null;
    if (declaredImages && declaredMaths) {
      for (const id of declaredImages) {
        if (declaredMaths.has(id)) fail('AST_RESOURCE_MISMATCH');
      }
    }
    const seenImages = new Set();
    const seenMaths = new Set();
    const seenResources = new Set();
    const seenNodes = new WeakSet();
    const stack = [];
    let count = 0;
    let textBytes = 0;

    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      stack.push({ node: nodes[index], depth: 1 });
    }

    while (stack.length > 0) {
      const entry = stack.pop();
      const node = entry.node;
      if (!isRecord(node)) fail('AST_INVALID');
      if (seenNodes.has(node)) fail('AST_INVALID');
      seenNodes.add(node);
      count += 1;
      if (count > limits.MAX_AST_NODES_PER_QUESTION || entry.depth > limits.MAX_AST_DEPTH) {
        fail('AST_LIMIT_EXCEEDED');
      }
      const nodeType = ownDataValue(node, 'type');
      if (typeof nodeType !== 'string') fail('AST_INVALID');

      if (nodeType === 'text') {
        requireKeys(node, ['type', 'value'], new Set(['type', 'value']));
        if (typeof node.value !== 'string' || hasForbiddenControl(node.value)) fail('AST_INVALID');
        textBytes += byteLength(node.value);
        if (textBytes > limits.MAX_QUESTION_BYTES) fail('AST_LIMIT_EXCEEDED');
        continue;
      }

      if (nodeType === 'element') {
        requireKeys(node, ['type', 'tag', 'attrs', 'children'], new Set(['type', 'tag', 'attrs', 'children']));
        if (typeof node.tag !== 'string' || !ALL_ELEMENTS.has(node.tag)) fail('AST_INVALID');
        validateAttrs(node.tag, node.attrs);
        requireDenseArray(node.children);
        if (VOID.has(node.tag) && node.children.length !== 0) fail('AST_INVALID');
        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          stack.push({ node: node.children[index], depth: entry.depth + 1 });
        }
        continue;
      }

      if (nodeType === 'image') {
        requireKeys(node, ['type', 'imageId'], new Set(['type', 'imageId']));
        if (!isResourceId(node.imageId)) fail('AST_INVALID');
        if (seenResources.has(node.imageId)) fail('AST_RESOURCE_MISMATCH');
        if (declaredImages && !declaredImages.has(node.imageId)) fail('AST_RESOURCE_MISMATCH');
        seenImages.add(node.imageId);
        seenResources.add(node.imageId);
        continue;
      }

      if (nodeType === 'math') {
        requireKeys(node, ['type', 'mathId'], new Set(['type', 'mathId']));
        if (!isResourceId(node.mathId)) fail('AST_INVALID');
        if (seenResources.has(node.mathId)) fail('AST_RESOURCE_MISMATCH');
        if (declaredMaths && !declaredMaths.has(node.mathId)) fail('AST_RESOURCE_MISMATCH');
        seenMaths.add(node.mathId);
        seenResources.add(node.mathId);
        continue;
      }

      fail('AST_INVALID');
    }

    if (declaredImages && seenImages.size !== declaredImages.size) fail('AST_RESOURCE_MISMATCH');
    if (declaredMaths && seenMaths.size !== declaredMaths.size) fail('AST_RESOURCE_MISMATCH');
    return { imageIds: seenImages, mathIds: seenMaths };
  }

  function validate(nodes, resources) {
    const options = resources === undefined ? { imageIds: new Set(), mathIds: new Set() } : resources;
    requireKeys(options, ['imageIds', 'mathIds'], new Set(['imageIds', 'mathIds']));
    validateCore(nodes, options);
    return true;
  }

  function isWhitespaceCode(code) {
    return code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x20;
  }

  function isTagNameCode(code) {
    return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) || code === 0x2d || code === 0x5f || code === 0x3a;
  }

  function isAsciiLetter(code) {
    return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
  }

  function isDecimalCode(code) {
    return code >= 0x30 && code <= 0x39;
  }

  function isHexCode(code) {
    return isDecimalCode(code) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
  }

  function numericEntityValue(body) {
    let index = 1;
    let radix = 10;
    if (body.charCodeAt(index) === 0x78 || body.charCodeAt(index) === 0x58) {
      radix = 16;
      index += 1;
    }
    if (index >= body.length) return null;
    let value = 0;
    for (; index < body.length; index += 1) {
      const code = body.charCodeAt(index);
      if ((radix === 10 && !isDecimalCode(code)) || (radix === 16 && !isHexCode(code))) return null;
      let digit;
      if (code <= 0x39) digit = code - 0x30;
      else if (code <= 0x46) digit = code - 0x41 + 10;
      else digit = code - 0x61 + 10;
      value = (value * radix) + digit;
      if (value > 0x10ffff) return null;
    }
    if (value === 0 || (value >= 0xd800 && value <= 0xdfff)) return null;
    return String.fromCodePoint(value);
  }

  function decodeEntities(value) {
    let output = '';
    let index = 0;
    while (index < value.length) {
      if (value.charCodeAt(index) !== 0x26) {
        output += value[index];
        index += 1;
        continue;
      }
      let end = index + 1;
      const maximum = Math.min(value.length, index + 34);
      while (end < maximum && value.charCodeAt(end) !== 0x3b) end += 1;
      if (end >= value.length || end >= maximum || value.charCodeAt(end) !== 0x3b) {
        output += '&';
        index += 1;
        continue;
      }
      const body = value.slice(index + 1, end);
      let decoded = null;
      if (Object.prototype.hasOwnProperty.call(BASIC_ENTITIES, body)) decoded = BASIC_ENTITIES[body];
      else if (body.charCodeAt(0) === 0x23) decoded = numericEntityValue(body);
      if (decoded === null) output += value.slice(index, end + 1);
      else output += decoded;
      index = end + 1;
    }
    return output;
  }

  function scanComment(source, start) {
    let index = start + 4;
    while (index + 2 < source.length) {
      if (source.charCodeAt(index) === 0x2d && source.charCodeAt(index + 1) === 0x2d &&
          source.charCodeAt(index + 2) === 0x3e) {
        return index + 3;
      }
      index += 1;
    }
    return source.length;
  }

  function scanDeclaration(source, start) {
    let index = start + 2;
    let quote = 0;
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (quote !== 0) {
        if (code === quote) quote = 0;
      } else if (code === 0x22 || code === 0x27) {
        quote = code;
      } else if (code === 0x3e) {
        return index + 1;
      }
      index += 1;
    }
    return source.length;
  }

  function parseTag(source, start) {
    if (source.charCodeAt(start) !== 0x3c) return { kind: 'invalid', next: start + 1 };
    if (source.slice(start, start + 4) === '<!--') {
      return { kind: 'skip', next: scanComment(source, start) };
    }
    if (source.charCodeAt(start + 1) === 0x21 || source.charCodeAt(start + 1) === 0x3f) {
      return { kind: 'skip', next: scanDeclaration(source, start) };
    }

    let index = start + 1;
    let closing = false;
    if (source.charCodeAt(index) === 0x2f) {
      closing = true;
      index += 1;
    }
    if (index >= source.length || !isAsciiLetter(source.charCodeAt(index))) {
      return { kind: 'invalid', next: start + 1 };
    }
    const nameStart = index;
    while (index < source.length && isTagNameCode(source.charCodeAt(index))) index += 1;
    const name = source.slice(nameStart, index).toLowerCase();
    const attrs = Object.create(null);

    if (closing) {
      while (index < source.length && source.charCodeAt(index) !== 0x3e) index += 1;
      if (index >= source.length) return { kind: 'invalid', next: start + 1 };
      return { kind: 'close', name, next: index + 1 };
    }

    let selfClosing = false;
    while (index < source.length) {
      while (index < source.length && isWhitespaceCode(source.charCodeAt(index))) index += 1;
      if (index >= source.length) return { kind: 'invalid', next: start + 1 };
      if (source.charCodeAt(index) === 0x3e) {
        return { kind: 'open', name, attrs, selfClosing, next: index + 1 };
      }
      if (source.charCodeAt(index) === 0x2f) {
        let afterSlash = index + 1;
        while (afterSlash < source.length && isWhitespaceCode(source.charCodeAt(afterSlash))) afterSlash += 1;
        if (source.charCodeAt(afterSlash) === 0x3e) {
          selfClosing = true;
          return { kind: 'open', name, attrs, selfClosing, next: afterSlash + 1 };
        }
      }

      const attrStart = index;
      while (index < source.length) {
        const code = source.charCodeAt(index);
        if (isWhitespaceCode(code) || code === 0x3d || code === 0x3e) break;
        index += 1;
      }
      if (index === attrStart) {
        index += 1;
        continue;
      }
      const attrName = source.slice(attrStart, index).toLowerCase();
      while (index < source.length && isWhitespaceCode(source.charCodeAt(index))) index += 1;
      let attrValue = '';
      if (source.charCodeAt(index) === 0x3d) {
        index += 1;
        while (index < source.length && isWhitespaceCode(source.charCodeAt(index))) index += 1;
        if (index >= source.length) return { kind: 'invalid', next: start + 1 };
        const quote = source.charCodeAt(index);
        if (quote === 0x22 || quote === 0x27) {
          index += 1;
          const valueStart = index;
          while (index < source.length && source.charCodeAt(index) !== quote) index += 1;
          if (index >= source.length) return { kind: 'invalid', next: start + 1 };
          attrValue = source.slice(valueStart, index);
          index += 1;
        } else {
          const valueStart = index;
          while (index < source.length && !isWhitespaceCode(source.charCodeAt(index)) &&
                 source.charCodeAt(index) !== 0x3e) index += 1;
          attrValue = source.slice(valueStart, index);
        }
      }
      if (!Object.prototype.hasOwnProperty.call(attrs, attrName)) {
        attrs[attrName] = decodeEntities(attrValue);
      }
    }
    return { kind: 'invalid', next: start + 1 };
  }

  function safeElementAttrs(tag, attrs) {
    const safe = {};
    if (tag === 'td' || tag === 'th') {
      const rowspan = canonicalSpan(attrs.rowspan);
      const colspan = canonicalSpan(attrs.colspan);
      if (rowspan !== null) safe.rowspan = rowspan;
      if (colspan !== null) safe.colspan = colspan;
    } else if (tag === 'math' && (attrs.display === 'block' || attrs.display === 'inline')) {
      safe.display = attrs.display;
    }
    return safe;
  }

  function createConversionState(onImage, onMath) {
    return {
      nodes: [],
      nodeCount: 0,
      textBytes: 0,
      sourceNodes: 0,
      onImage: typeof onImage === 'function' ? onImage : null,
      onMath: typeof onMath === 'function' ? onMath : null
    };
  }

  function addNode(state, children, node, depth) {
    if (depth > limits.MAX_AST_DEPTH) fail('AST_LIMIT_EXCEEDED');
    state.nodeCount += 1;
    if (state.nodeCount > limits.MAX_AST_NODES_PER_QUESTION) fail('AST_LIMIT_EXCEEDED');
    children.push(node);
    return node;
  }

  function addText(state, children, value, depth) {
    if (value.length === 0) return;
    if (hasForbiddenControl(value)) fail('AST_INVALID');
    if (depth > limits.MAX_AST_DEPTH) fail('AST_LIMIT_EXCEEDED');
    state.textBytes += byteLength(value);
    if (state.textBytes > limits.MAX_QUESTION_BYTES) fail('AST_LIMIT_EXCEEDED');
    const previous = children.length > 0 ? children[children.length - 1] : null;
    if (previous && previous.type === 'text') {
      previous.value += value;
      return;
    }
    addNode(state, children, { type: 'text', value }, depth);
  }

  function safeHookId(value) {
    return isResourceId(value) ? value : null;
  }

  function addImage(state, children, attrs, depth) {
    if (!state.onImage) return;
    const src = typeof attrs.src === 'string' ? attrs.src : '';
    const alt = typeof attrs.alt === 'string' ? attrs.alt : '';
    if (hasForbiddenControl(src) || hasForbiddenControl(alt)) fail('AST_INVALID');
    if (byteLength(src) > limits.MAX_QUESTION_BYTES || byteLength(alt) > limits.MAX_QUESTION_BYTES) {
      fail('AST_LIMIT_EXCEEDED');
    }
    const imageId = safeHookId(state.onImage({ src, alt }));
    if (imageId !== null) addNode(state, children, { type: 'image', imageId }, depth);
  }

  function collectAstText(node, skipAnnotations) {
    const output = [];
    const stack = [node];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current.type === 'text') output.push(current.value);
      else if (current.type === 'element') {
        if (skipAnnotations && current.tag === 'annotation') continue;
        for (let index = current.children.length - 1; index >= 0; index -= 1) {
          stack.push(current.children[index]);
        }
      }
    }
    return output.join('');
  }

  function finalizeAnnotation(frame) {
    if (!frame.mathRoot || frame.annotationEncoding !== 'application/x-tex') return;
    const tex = collectAstText(frame.annotationNode).trim();
    if (tex.length > 0) frame.mathRoot.texCandidates.push(tex);
  }

  function finalizeMath(state, mathRoot) {
    if (mathRoot.done) return;
    mathRoot.done = true;
    if (!state.onMath) return;
    let tex = null;
    for (const candidate of mathRoot.texCandidates) {
      if (byteLength(candidate) <= limits.MAX_TEX_BYTES) {
        tex = candidate;
        break;
      }
    }
    if (tex === null) return;
    const fallbackText = collectAstText(mathRoot.node, true).trim();
    const mathId = safeHookId(state.onMath({ tex, display: mathRoot.display, fallbackText }));
    if (mathId !== null) mathRoot.parent[mathRoot.index] = { type: 'math', mathId };
  }

  function finalizeFrame(state, frame) {
    if (frame.annotationNode) finalizeAnnotation(frame);
    if (frame.ownsMathRoot) finalizeMath(state, frame.mathRoot);
  }

  function openSerializedTag(state, frames, token) {
    const parent = frames[frames.length - 1];
    const inMath = parent.mathRoot !== null;
    const sourceDepth = frames.length;
    if (sourceDepth > limits.MAX_AST_DEPTH) fail('AST_LIMIT_EXCEEDED');

    if (token.name === 'img' && !inMath) {
      addImage(state, parent.children, token.attrs, parent.astDepth + 1);
      return;
    }

    let node = null;
    let astDepth = parent.astDepth;
    let mathRoot = parent.mathRoot;
    let ownsMathRoot = false;
    if (token.name === 'math' && !inMath) {
      astDepth += 1;
      node = addNode(state, parent.children, {
        type: 'element', tag: 'math', attrs: safeElementAttrs('math', token.attrs), children: []
      }, astDepth);
      mathRoot = {
        node,
        parent: parent.children,
        index: parent.children.length - 1,
        display: node.attrs.display || 'inline',
        texCandidates: [],
        done: false
      };
      ownsMathRoot = true;
    } else if (inMath && MATHML.has(token.name)) {
      astDepth += 1;
      node = addNode(state, parent.children, {
        type: 'element', tag: token.name, attrs: safeElementAttrs(token.name, token.attrs), children: []
      }, astDepth);
    } else if (!inMath && ALLOWED_HTML.has(token.name)) {
      astDepth += 1;
      node = addNode(state, parent.children, {
        type: 'element', tag: token.name, attrs: safeElementAttrs(token.name, token.attrs), children: []
      }, astDepth);
    }

    const children = node ? node.children : parent.children;
    const isVoid = (!inMath && VOID.has(token.name)) || token.name === 'img';
    const frame = {
      sourceTag: token.name,
      children,
      astDepth,
      mathRoot,
      ownsMathRoot,
      annotationNode: null,
      annotationEncoding: ''
    };
    if (node && token.name === 'annotation' && mathRoot) {
      frame.annotationNode = node;
      frame.annotationEncoding = String(token.attrs.encoding || '').trim().toLowerCase();
    }

    if (token.selfClosing || isVoid) {
      finalizeFrame(state, frame);
    } else {
      frames.push(frame);
    }
  }

  function closeSerializedTag(state, frames, name) {
    let match = -1;
    for (let index = frames.length - 1; index >= 1; index -= 1) {
      if (frames[index].sourceTag === name) {
        match = index;
        break;
      }
    }
    if (match === -1) return;
    while (frames.length - 1 >= match) {
      finalizeFrame(state, frames.pop());
    }
  }

  function blockedTagConsumesSubtree(name, selfClosing) {
    if (BLOCKED_HTML_NON_VOID.has(name)) return true;
    if (name === 'svg') return !selfClosing;
    return false;
  }

  function skipBlocked(source, start, outerName) {
    const blockedStack = [outerName];
    let index = start;
    while (index < source.length && blockedStack.length > 0) {
      if (source.charCodeAt(index) !== 0x3c) {
        index += 1;
        continue;
      }
      const token = parseTag(source, index);
      if (token.kind === 'invalid') {
        index += 1;
        continue;
      }
      index = token.next;
      if (token.kind === 'open' && DROP_SUBTREE.has(token.name) &&
          blockedTagConsumesSubtree(token.name, token.selfClosing)) {
        blockedStack.push(token.name);
        if (blockedStack.length > limits.MAX_AST_DEPTH) fail('AST_LIMIT_EXCEEDED');
      } else if (token.kind === 'close' && DROP_SUBTREE.has(token.name)) {
        if (blockedStack[blockedStack.length - 1] === token.name) blockedStack.pop();
      }
    }
    return index;
  }

  function fromSerialized(source, hooks) {
    if (typeof source !== 'string') fail('AST_INVALID');
    if (byteLength(source) > limits.MAX_QUESTION_BYTES) fail('AST_LIMIT_EXCEEDED');
    const options = hooks === undefined ? {} : hooks;
    if (!isRecord(options)) fail('AST_INVALID');
    const state = createConversionState(options.onImage, options.onMath);
    const frames = [{ sourceTag: '', children: state.nodes, astDepth: 0, mathRoot: null }];
    let index = 0;

    while (index < source.length) {
      if (source.charCodeAt(index) !== 0x3c) {
        const start = index;
        while (index < source.length && source.charCodeAt(index) !== 0x3c) index += 1;
        const parent = frames[frames.length - 1];
        addText(state, parent.children, decodeEntities(source.slice(start, index)), parent.astDepth + 1);
        continue;
      }

      const token = parseTag(source, index);
      if (token.kind === 'invalid') {
        const parent = frames[frames.length - 1];
        addText(state, parent.children, '<', parent.astDepth + 1);
        index = token.next;
        continue;
      }
      index = token.next;
      if (token.kind === 'skip') continue;
      if (token.kind === 'close') {
        closeSerializedTag(state, frames, token.name);
        continue;
      }
      if (DROP_SUBTREE.has(token.name)) {
        if (blockedTagConsumesSubtree(token.name, token.selfClosing)) {
          index = skipBlocked(source, index, token.name);
        }
        continue;
      }
      openSerializedTag(state, frames, token);
    }

    while (frames.length > 1) finalizeFrame(state, frames.pop());
    validateCore(state.nodes, null);
    return state.nodes;
  }

  function domTagName(node) {
    const value = typeof node.localName === 'string' ? node.localName : node.tagName;
    return typeof value === 'string' ? value.toLowerCase() : '';
  }

  function domAttribute(node, name) {
    if (!node || typeof node.getAttribute !== 'function') return '';
    const value = node.getAttribute(name);
    return value === null || value === undefined ? '' : String(value);
  }

  function domImageAttrs(node) {
    let src = typeof node.currentSrc === 'string' ? node.currentSrc : '';
    if (!src) {
      for (const name of ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc', 'src']) {
        src = domAttribute(node, name);
        if (src) break;
      }
    }
    return { src, alt: domAttribute(node, 'alt') };
  }

  function pushDomChildren(tasks, node, parent, astDepth, sourceDepth, mathRoot) {
    const children = node && node.childNodes;
    if (!children) return;
    const length = Number(children.length);
    if (!Number.isSafeInteger(length) || length < 0 || length > limits.MAX_AST_NODES_PER_QUESTION) {
      fail('AST_LIMIT_EXCEEDED');
    }
    for (let index = length - 1; index >= 0; index -= 1) {
      tasks.push({ kind: 'visit', node: children[index], parent, astDepth, sourceDepth, mathRoot });
    }
  }

  function visitDomElement(state, tasks, task, node, tag) {
    const sourceDepth = task.sourceDepth + 1;
    if (sourceDepth > limits.MAX_AST_DEPTH) fail('AST_LIMIT_EXCEEDED');
    if (DROP_SUBTREE.has(tag)) return;
    const inMath = task.mathRoot !== null;
    if (tag === 'img' && !inMath) {
      addImage(state, task.parent, domImageAttrs(node), task.astDepth + 1);
      return;
    }

    let astNode = null;
    let astDepth = task.astDepth;
    let mathRoot = task.mathRoot;
    let ownsMathRoot = false;
    const attrs = Object.create(null);
    if (tag === 'td' || tag === 'th') {
      attrs.rowspan = domAttribute(node, 'rowspan');
      attrs.colspan = domAttribute(node, 'colspan');
    } else if (tag === 'math') {
      attrs.display = domAttribute(node, 'display');
    }

    if (tag === 'math' && !inMath) {
      astDepth += 1;
      astNode = addNode(state, task.parent, {
        type: 'element', tag: 'math', attrs: safeElementAttrs('math', attrs), children: []
      }, astDepth);
      mathRoot = {
        node: astNode,
        parent: task.parent,
        index: task.parent.length - 1,
        display: astNode.attrs.display || 'inline',
        texCandidates: [],
        done: false
      };
      ownsMathRoot = true;
    } else if (inMath && MATHML.has(tag)) {
      astDepth += 1;
      astNode = addNode(state, task.parent, {
        type: 'element', tag, attrs: safeElementAttrs(tag, attrs), children: []
      }, astDepth);
    } else if (!inMath && ALLOWED_HTML.has(tag)) {
      astDepth += 1;
      astNode = addNode(state, task.parent, {
        type: 'element', tag, attrs: safeElementAttrs(tag, attrs), children: []
      }, astDepth);
    }

    const childParent = astNode ? astNode.children : task.parent;
    if (ownsMathRoot) tasks.push({ kind: 'finalizeMath', mathRoot });
    if (astNode && tag === 'annotation' && mathRoot) {
      tasks.push({
        kind: 'finalizeAnnotation',
        frame: {
          mathRoot,
          annotationNode: astNode,
          annotationEncoding: domAttribute(node, 'encoding').trim().toLowerCase()
        }
      });
    }
    pushDomChildren(tasks, node, childParent, astDepth, sourceDepth, mathRoot);
  }

  function fromDom(rootNode, hooks) {
    if (!rootNode || typeof rootNode !== 'object') fail('AST_INVALID');
    const options = hooks === undefined ? {} : hooks;
    if (!isRecord(options)) fail('AST_INVALID');
    const state = createConversionState(options.onImage, options.onMath);
    const tasks = [{ kind: 'visit', node: rootNode, parent: state.nodes, astDepth: 0, sourceDepth: 0, mathRoot: null }];

    while (tasks.length > 0) {
      const task = tasks.pop();
      if (task.kind === 'finalizeMath') {
        finalizeMath(state, task.mathRoot);
        continue;
      }
      if (task.kind === 'finalizeAnnotation') {
        finalizeAnnotation(task.frame);
        continue;
      }
      const node = task.node;
      if (!node || typeof node !== 'object') continue;
      const nodeType = Number(node.nodeType);
      if (nodeType === 3 || nodeType === 4) {
        state.sourceNodes += 1;
        if (state.sourceNodes > limits.MAX_AST_NODES_PER_QUESTION) fail('AST_LIMIT_EXCEEDED');
        const value = node.nodeValue === null || node.nodeValue === undefined ? '' : String(node.nodeValue);
        addText(state, task.parent, value, task.astDepth + 1);
      } else if (nodeType === 1) {
        state.sourceNodes += 1;
        if (state.sourceNodes > limits.MAX_AST_NODES_PER_QUESTION) fail('AST_LIMIT_EXCEEDED');
        const tag = domTagName(node);
        if (tag) visitDomElement(state, tasks, task, node, tag);
      } else if (nodeType === 9 || nodeType === 11) {
        pushDomChildren(tasks, node, task.parent, task.astDepth, task.sourceDepth, task.mathRoot);
      }
    }

    validateCore(state.nodes, null);
    return state.nodes;
  }

  function render(nodes, document, hooks) {
    validateCore(nodes, null);
    if (!document || typeof document.createDocumentFragment !== 'function' ||
        typeof document.createTextNode !== 'function' || typeof document.createElement !== 'function') {
      fail('AST_INVALID');
    }
    const options = hooks === undefined ? {} : hooks;
    if (!isRecord(options)) fail('AST_INVALID');
    const renderImage = typeof options.renderImage === 'function' ? options.renderImage : null;
    const renderMath = typeof options.renderMath === 'function' ? options.renderMath : null;
    const fragment = document.createDocumentFragment();
    const stack = [];
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      stack.push({ node: nodes[index], parent: fragment });
    }

    while (stack.length > 0) {
      const entry = stack.pop();
      const node = entry.node;
      if (node.type === 'text') {
        entry.parent.append(document.createTextNode(node.value));
      } else if (node.type === 'element') {
        const element = document.createElement(node.tag);
        for (const key of Object.keys(node.attrs)) element.setAttribute(key, node.attrs[key]);
        entry.parent.append(element);
        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          stack.push({ node: node.children[index], parent: element });
        }
      } else if (node.type === 'image' && renderImage) {
        const renderedImage = renderImage(node.imageId);
        if (renderedImage !== null && renderedImage !== undefined) entry.parent.append(renderedImage);
      } else if (node.type === 'math' && renderMath) {
        const renderedMath = renderMath(node.mathId);
        if (renderedMath !== null && renderedMath !== undefined) entry.parent.append(renderedMath);
      }
    }
    return fragment;
  }

  ns.richText = Object.freeze({ fromDom, fromSerialized, validate, render });
})(globalThis);
