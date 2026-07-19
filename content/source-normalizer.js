(function registerSourceNormalizer(root) {
  const ns = root.YktQuestionExporter;
  if (ns.sourceNormalizer) return;

  const limits = ns.limits;
  const urlPolicy = ns.urlPolicy;
  const richText = ns.richText;
  const INLINE_MIME = Object.freeze({
    'image/png': true,
    'image/jpeg': true,
    'image/gif': true,
    'image/webp': true
  });
  const LAZY_SOURCE_ATTRIBUTES = Object.freeze([
    'data-src', 'data-original', 'data-lazy-src', 'data-actualsrc'
  ]);
  const NATIVE_CONTROLS = Object.freeze({
    input: true,
    textarea: true,
    select: true,
    option: true
  });
  const OPTION_CHOICE_TAGS = Object.freeze({
    'x-choice': true
  });
  const CUSTOM_CONTROL_TAG_TOKENS = Object.freeze({
    answer: true,
    blank: true,
    fill: true,
    cloze: true,
    gap: true,
    completion: true,
    input: true,
    textarea: true,
    select: true,
    response: true,
    control: true,
    field: true,
    value: true,
    inner: true,
    wrapper: true,
    container: true,
    custom: true,
    el: true,
    x: true
  });
  const CUSTOM_CONTROL_TAG_SEMANTICS = Object.freeze({
    answer: true,
    blank: true,
    fill: true,
    cloze: true,
    gap: true,
    completion: true,
    input: true,
    textarea: true,
    select: true,
    response: true
  });
  const BLANK_MARKERS = Object.freeze({
    blank: true,
    fillblank: true,
    'fill-blank': true,
    fill_blank: true,
    cloze: true,
    gap: true,
    completion: true,
    input: true,
    textarea: true,
    填空: true,
    空格: true
  });
  const BLANK_WRAPPERS = Object.freeze({
    'el-input': true,
    'el-textarea': true
  });
  const BLANK_TEXT = '\u00a0'.repeat(8);
  const ROOT_COMPATIBLE_BLANK_MARKERS = Object.freeze({
    blank: true,
    fillblank: true,
    cloze: true,
    gap: true,
    completion: true,
    input: true,
    textarea: true
  });
  const ROOT_COMPATIBLE_BLANK_CLASSES = Object.freeze({
    'blank-item-dynamic': true
  });
  const ROOT_COMPATIBLE_BLANK_BLOCK_TAGS = Object.freeze({
    p: true,
    table: true,
    img: true,
    ul: true,
    ol: true,
    li: true,
    code: true,
    pre: true
  });
  const REVIEWED_BLANK_MAX_TEXT = 80;
  const REVIEWED_BLANK_BLOCK_TAGS = Object.freeze({
    p: true,
    table: true,
    img: true,
    ul: true,
    ol: true,
    li: true
  });
  const BLANK_STRUCTURE_SUFFIXES = Object.freeze({
    input: true,
    textarea: true,
    answer: true,
    value: true,
    inner: true,
    field: true,
    control: true,
    wrapper: true,
    container: true,
    content: true,
    text: true
  });
  const STRONG_BLANK_STRUCTURE_SUFFIXES = Object.freeze({
    input: true,
    textarea: true,
    answer: true,
    value: true,
    inner: true,
    field: true,
    control: true,
    wrapper: true,
    container: true
  });
  const BODY_OPTION_CLASSES = Object.freeze({
    'list-unstyled-radio': true,
    'list-unstyled-checkbox': true,
    options: true,
    'option-list': true,
    'question-options': true,
    'item-options': true,
    'el-radio-group': true,
    'el-checkbox-group': true,
    'el-radio': true,
    'el-checkbox': true
  });
  const USER_STATE_CONTROL_CLASSES = Object.freeze({
    answerinput: true,
    studentanswer: true,
    useranswer: true,
    myanswer: true,
    submittedanswer: true,
    userresponse: true,
    studentresponse: true,
    myresponse: true,
    submittedresponse: true,
    answercontrol: true,
    responseinput: true
  });
  const SOURCE_ANSWER_STRUCTURES = Object.freeze({
    correctanswer: true,
    referenceanswer: true,
    standardanswer: true,
    officialanswer: true
  });
  const STRUCTURE_SUFFIXES = Object.freeze({
    value: true,
    area: true,
    content: true,
    text: true,
    wrapper: true,
    container: true,
    field: true
  });
  const DROP_SUBTREE = Object.freeze({
    script: true,
    style: true,
    iframe: true,
    object: true,
    embed: true,
    svg: true,
    form: true,
    button: true
  });
  const STATUS_TAGS = Object.freeze({
    'status-icon': true,
    'feedback-icon': true,
    'answer-status': true,
    'correct-icon': true,
    'incorrect-icon': true,
    'success-icon': true,
    'error-icon': true,
    svg: true
  });
  const STATUS_CLASSES = Object.freeze({
    'answer-status-icon': true,
    'answer-feedback-icon': true,
    'feedback-icon': true,
    'status-icon': true,
    'correct-icon': true,
    'incorrect-icon': true,
    'right-icon': true,
    'wrong-icon': true
  });
  const EXPLICIT_LABELS = Object.freeze({
    正确答案: true,
    答案: true,
    参考答案: true
  });
  const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const RESOURCE_STATES = new WeakMap();
  const USER_FOOTER_MARKER = /(?:我的答案|你的答案|学生答案|用户答案|我的作答|你的作答|学生作答|用户作答)/;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function nodeTag(node) {
    if (!node || typeof node !== 'object') return '';
    let value = '';
    try {
      value = typeof node.localName === 'string' ? node.localName :
        typeof node.tagName === 'string' ? node.tagName : node.nodeName;
    } catch (_error) {
      return '';
    }
    return typeof value === 'string' ? value.toLowerCase() : '';
  }

  function attribute(node, name) {
    if (!node || typeof node.getAttribute !== 'function') return '';
    try {
      const value = node.getAttribute(name);
      return value === null || value === undefined ? '' : String(value);
    } catch (_error) {
      return '';
    }
  }

  function hasAttribute(node, name) {
    if (!node || typeof node !== 'object') return false;
    if (typeof node.hasAttribute === 'function') {
      try {
        return node.hasAttribute(name) === true;
      } catch (_error) {
        return false;
      }
    }
    if (typeof node.getAttribute === 'function') {
      try {
        return node.getAttribute(name) !== null;
      } catch (_error) {
        return false;
      }
    }
    return false;
  }

  function childrenOf(node) {
    if (!node || typeof node !== 'object') return [];
    let children;
    try {
      children = node.childNodes;
    } catch (_error) {
      return [];
    }
    if (!children) return [];
    const length = Number(children.length);
    if (!Number.isSafeInteger(length) || length < 0 || length > limits.MAX_AST_NODES_PER_QUESTION) {
      fail('AST_LIMIT_EXCEEDED');
    }
    const result = [];
    for (let index = 0; index < length; index += 1) result.push(children[index]);
    return result;
  }

  function textValue(node) {
    try {
      if (typeof node.nodeValue === 'string') return node.nodeValue;
      if (typeof node.data === 'string') return node.data;
      return typeof node.textContent === 'string' ? node.textContent : '';
    } catch (_error) {
      return '';
    }
  }

  function boundedCustomControlTag(tag) {
    const tokens = tag.split('-');
    if (tokens.length < 2 || tokens.some((token) => !token)) return false;
    if (!tokens.every((token) => CUSTOM_CONTROL_TAG_TOKENS[token] === true)) return false;
    return tokens.some((token) => CUSTOM_CONTROL_TAG_SEMANTICS[token] === true);
  }

  function isCustomControlTag(tag) {
    if (!tag.includes('-')) return false;
    if (matchesCompactStructure(tag, SOURCE_ANSWER_STRUCTURES)) return false;
    if (matchesCompactStructure(tag, USER_STATE_CONTROL_CLASSES)) return true;
    return OPTION_CHOICE_TAGS[tag] === true || boundedCustomControlTag(tag);
  }

  function classTokens(node) {
    return attribute(node, 'class').trim().split(/\s+/).filter(Boolean).map((value) => value.toLowerCase());
  }

  function compactControlClass(value) {
    return value.replace(/[-_]/g, '').toLowerCase();
  }

  function matchesCompactStructure(value, roots) {
    const compact = compactControlClass(value);
    for (const rootName of Object.keys(roots)) {
      if (compact === rootName) return true;
      if (compact.startsWith(rootName) && STRUCTURE_SUFFIXES[compact.slice(rootName.length)] === true) {
        return true;
      }
    }
    return false;
  }

  function hasUserStateControlClass(node) {
    return classTokens(node).some((value) => matchesCompactStructure(value, USER_STATE_CONTROL_CLASSES));
  }

  function isSourceAnswerStructure(node) {
    if (matchesCompactStructure(nodeTag(node), SOURCE_ANSWER_STRUCTURES)) return true;
    return classTokens(node).some((value) => matchesCompactStructure(value, SOURCE_ANSWER_STRUCTURES));
  }

  function hasAuthoredBodyClass(node) {
    const classes = classTokens(node);
    return classes.includes('custom_ueditor_cn_body') || classes.includes('problem-body') ||
      classes.includes('item-body');
  }

  function hasRichAuthoredStructure(node, includeLists) {
    const stack = childrenOf(node).slice();
    let visited = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || typeof current !== 'object' || Number(current.nodeType) !== 1) continue;
      visited += 1;
      if (visited > limits.MAX_AST_NODES_PER_QUESTION) fail('AST_LIMIT_EXCEEDED');
      const tag = nodeTag(current);
      if (tag === 'p' || tag === 'table' || tag === 'img' ||
          (includeLists && (tag === 'ul' || tag === 'ol' || tag === 'li'))) return true;
      if (hasAuthoredBodyClass(current)) return true;
      for (const child of childrenOf(current)) stack.push(child);
    }
    return false;
  }

  function structuredBlankSuffixes(value) {
    const parts = String(value).toLowerCase().replace(/__/g, '-').replace(/_/g, '-')
      .split('-').filter(Boolean);
    let suffixStart = -1;
    if (parts[0] === 'blank' || parts[0] === 'cloze' || parts[0] === 'gap' ||
        parts[0] === 'completion' || parts[0] === 'fillblank') {
      suffixStart = 1;
    } else if (parts[0] === 'fill' && parts[1] === 'blank') {
      suffixStart = 2;
    } else if (parts[0] === 'el' && (parts[1] === 'input' || parts[1] === 'textarea')) {
      suffixStart = 2;
    }
    if (suffixStart < 0 || suffixStart >= parts.length) return null;
    const suffixes = parts.slice(suffixStart);
    if (!suffixes.every((part) => BLANK_STRUCTURE_SUFFIXES[part] === true)) return null;
    return suffixes;
  }

  function structuredBlankClass(value) {
    return structuredBlankSuffixes(value) !== null;
  }

  function strongStructuredBlankClass(value) {
    const suffixes = structuredBlankSuffixes(value);
    return suffixes !== null &&
      suffixes.some((part) => STRONG_BLANK_STRUCTURE_SUFFIXES[part] === true);
  }

  function rootCompatibleBlankClass(value) {
    const normalized = String(value).toLowerCase();
    if (ROOT_COMPATIBLE_BLANK_CLASSES[normalized] === true) return true;
    const parts = normalized.replace(/__/g, '-').replace(/_/g, '-')
      .split('-').filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      let suffixStart = -1;
      if (parts[index] === 'fill' && parts[index + 1] === 'blank') {
        suffixStart = index + 2;
      } else if (ROOT_COMPATIBLE_BLANK_MARKERS[parts[index]] === true) {
        suffixStart = index + 1;
      }
      if (suffixStart < 0 || suffixStart >= parts.length) continue;
      const suffixes = parts.slice(suffixStart);
      if (!suffixes.every((part) => BLANK_STRUCTURE_SUFFIXES[part] === true)) continue;
      if (!suffixes.some((part) => STRONG_BLANK_STRUCTURE_SUFFIXES[part] === true)) continue;
      return true;
    }
    return false;
  }

  function hasBoundedBlankMarker(node) {
    const classes = classTokens(node);
    const tag = nodeTag(node);
    if (classes.includes('custom_ueditor_cn_body') || classes.includes('problem-body') ||
        classes.includes('item-body')) return false;
    let explicitMarker = hasAttribute(node, 'data-blank') || hasAttribute(node, 'data-fill-blank');
    for (const name of ['data-type', 'role']) {
      const value = attribute(node, name).trim().toLowerCase();
      if (BLANK_MARKERS[value]) explicitMarker = true;
    }
    if (explicitMarker) return true;
    if (tag === 'p' || tag === 'table' || tag === 'img') return false;
    const markedClass = classes.some((value) => (
      BLANK_MARKERS[value] || BLANK_WRAPPERS[value] || structuredBlankClass(value)
    ));
    if (!markedClass) return false;
    const strongClass = classes.some((value) => (
      BLANK_MARKERS[value] || BLANK_WRAPPERS[value] || strongStructuredBlankClass(value)
    ));
    if (!strongClass && (tag === 'ul' || tag === 'ol' || tag === 'li')) return false;
    if (hasRichAuthoredStructure(node, !strongClass)) return false;
    return true;
  }

  function rootCompatibleBlankMarker(node, depth) {
    const tag = nodeTag(node);
    if (depth < 1 || ROOT_COMPATIBLE_BLANK_BLOCK_TAGS[tag] ||
        isSourceAnswerStructure(node) || hasAuthoredBodyClass(node) ||
        hasRichAuthoredStructure(node, true)) {
      return false;
    }
    if (!classTokens(node).some((value) => rootCompatibleBlankClass(value))) return false;
    return textValue(node).replace(/\s+/g, '').length <= REVIEWED_BLANK_MAX_TEXT;
  }

  function isAnswerControl(node, tag) {
    if (NATIVE_CONTROLS[tag] || isCustomControlTag(tag)) return true;
    if (hasAttribute(node, 'contenteditable')) return true;
    if (hasUserStateControlClass(node)) return true;
    if (hasAttribute(node, 'data-answer-control') || hasAttribute(node, 'data-response-control')) return true;
    if (hasBoundedBlankMarker(node)) return true;
    const role = attribute(node, 'role').trim().toLowerCase();
    return role === 'textbox' || role === 'combobox' || role === 'radio' ||
      role === 'checkbox' || role === 'switch' || role === 'listbox';
  }

  function isBodyOptionContainer(node, tag) {
    if (tag === 'option-list' || tag === 'question-options') return true;
    if (attribute(node, 'data-question-region').trim().toLowerCase() === 'options') return true;
    return classTokens(node).some((value) => BODY_OPTION_CLASSES[value] === true);
  }

  function isOptionContentShell(node, tag) {
    if (NATIVE_CONTROLS[tag] || hasAttribute(node, 'contenteditable') ||
        hasUserStateControlClass(node) || hasBoundedBlankMarker(node) ||
        hasAttribute(node, 'data-answer-control') || hasAttribute(node, 'data-response-control')) {
      return false;
    }
    const role = attribute(node, 'role').trim().toLowerCase();
    if (role === 'radio' || role === 'checkbox') return true;
    return OPTION_CHOICE_TAGS[tag] === true;
  }

  function isStatusNode(node, tag) {
    if (STATUS_TAGS[tag]) return true;
    const role = attribute(node, 'role').trim().toLowerCase();
    if (role === 'status' || role === 'alert') return true;
    const classes = attribute(node, 'class').trim().split(/\s+/).filter(Boolean);
    for (const className of classes) {
      if (STATUS_CLASSES[className.toLowerCase()]) return true;
    }
    return false;
  }

  function isReviewedBlankStatusNode(node, tag) {
    if (tag !== 'svg' && STATUS_TAGS[tag]) return true;
    return classTokens(node).some((className) => STATUS_CLASSES[className] === true);
  }

  function reviewedBlankFeedback(node, tag, depth) {
    if (depth < 1 || REVIEWED_BLANK_BLOCK_TAGS[tag] || isStatusNode(node, tag) ||
        isSourceAnswerStructure(node) || hasAuthoredBodyClass(node) ||
        hasRichAuthoredStructure(node, true)) {
      return false;
    }
    const directChildren = childrenOf(node);
    const directSummaries = directChildren.map(() => ({ statuses: 0, compactText: 0 }));
    const stack = [];
    for (let index = directChildren.length - 1; index >= 0; index -= 1) {
      stack.push({ node: directChildren[index], directIndex: index });
    }
    let visited = 0;
    let statuses = 0;
    let compactText = 0;
    while (stack.length > 0) {
      const entry = stack.pop();
      const current = entry.node;
      if (!current || typeof current !== 'object') continue;
      visited += 1;
      if (visited > limits.MAX_AST_NODES_PER_QUESTION) fail('AST_LIMIT_EXCEEDED');
      const currentType = Number(current.nodeType);
      if (currentType === 3 || currentType === 4) {
        const length = textValue(current).replace(/\s+/g, '').length;
        compactText += length;
        directSummaries[entry.directIndex].compactText += length;
        if (compactText > REVIEWED_BLANK_MAX_TEXT) return false;
        continue;
      }
      if (currentType !== 1) continue;
      const currentTag = nodeTag(current);
      if (isSourceAnswerStructure(current)) return false;
      if (isReviewedBlankStatusNode(current, currentTag)) {
        statuses += 1;
        directSummaries[entry.directIndex].statuses += 1;
        if (statuses > 1) return false;
        continue;
      }
      const children = childrenOf(current);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ node: children[index], directIndex: entry.directIndex });
      }
    }
    if (statuses !== 1 || compactText < 1 || compactText > REVIEWED_BLANK_MAX_TEXT) return false;
    return !directSummaries.some((summary) => (
      summary.statuses >= 1 && summary.compactText >= 1
    ));
  }

  function isHidden(node) {
    if (hasAttribute(node, 'hidden')) return true;
    if (attribute(node, 'aria-hidden').trim().toLowerCase() === 'true') return true;
    const style = attribute(node, 'style').replace(/\s+/g, '').toLowerCase();
    return style.includes('display:none') || style.includes('visibility:hidden');
  }

  function safeSourceCandidate(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    return /^(?:https:|data:|blob:)/i.test(trimmed) ? trimmed : '';
  }

  function base64Prefix(value, maximumBytes) {
    const comma = value.indexOf(',');
    if (comma < 0 || !/;base64$/i.test(value.slice(0, comma))) return [];
    const encoded = value.slice(comma + 1).replace(/[\t\n\r ]/g, '');
    const bytes = [];
    for (let offset = 0; offset + 3 < encoded.length && bytes.length < maximumBytes; offset += 4) {
      const a = BASE64_ALPHABET.indexOf(encoded[offset]);
      const b = BASE64_ALPHABET.indexOf(encoded[offset + 1]);
      const c = encoded[offset + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(encoded[offset + 2]);
      const d = encoded[offset + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(encoded[offset + 3]);
      if (a < 0 || b < 0 || c < 0 || d < 0) return [];
      bytes.push((a << 2) | (b >> 4));
      if (encoded[offset + 2] !== '=') bytes.push(((b & 15) << 4) | (c >> 2));
      if (encoded[offset + 3] !== '=') bytes.push(((c & 3) << 6) | d);
    }
    return bytes.slice(0, maximumBytes);
  }

  function isPlaceholderDataGif(value) {
    if (!/^data:image\/gif(?:;|,)/i.test(value)) return false;
    if (/placeholder/i.test(value)) return true;
    const bytes = base64Prefix(value, 10);
    if (bytes.length < 10) return false;
    const header = String.fromCharCode(...bytes.slice(0, 6));
    if (header !== 'GIF87a' && header !== 'GIF89a') return false;
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    return width <= 1 && height <= 1;
  }

  function currentSource(node) {
    try {
      return safeSourceCandidate(typeof node.currentSrc === 'string' ? node.currentSrc : '');
    } catch (_error) {
      return '';
    }
  }

  function pickImageSource(imageNode) {
    if (!imageNode || typeof imageNode !== 'object') return '';
    const current = currentSource(imageNode);
    const lazy = [];
    for (const name of LAZY_SOURCE_ATTRIBUTES) {
      const candidate = safeSourceCandidate(attribute(imageNode, name));
      if (candidate) lazy.push(candidate);
    }
    if (current && !(isPlaceholderDataGif(current) && lazy.length > 0)) return current;
    if (lazy.length > 0) return lazy[0];
    const sourceValue = attribute(imageNode, 'src').trim();
    const safeSource = safeSourceCandidate(sourceValue);
    if (safeSource) return safeSource;
    return current || sourceValue;
  }

  function pairedImageSource(clonedNode, sourceNode) {
    const responsive = currentSource(sourceNode);
    if (responsive) {
      const lazy = LAZY_SOURCE_ATTRIBUTES.map((name) => safeSourceCandidate(attribute(clonedNode, name)))
        .filter(Boolean);
      if (!(isPlaceholderDataGif(responsive) && lazy.length > 0)) return responsive;
    }
    return pickImageSource(clonedNode);
  }

  function plainTextNode(value) {
    return { nodeType: 3, nodeName: '#text', nodeValue: value, childNodes: [] };
  }

  function plainElement(tag, attrs, children, responsiveSource) {
    const safeAttrs = Object.freeze({ ...attrs });
    return {
      nodeType: 1,
      nodeName: tag.toUpperCase(),
      localName: tag,
      childNodes: children,
      currentSrc: responsiveSource || '',
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(safeAttrs, name) ? safeAttrs[name] : null;
      },
      hasAttribute(name) {
        return Object.prototype.hasOwnProperty.call(safeAttrs, name);
      }
    };
  }

  function plainBlankNode() {
    return plainElement('u', {}, [plainTextNode(BLANK_TEXT)], '');
  }

  function optionContext(options) {
    return options.context === 'option' || options.field === 'option' ||
      options.optionContext === true || options.isOption === true;
  }

  function sanitizeNode(
    clonedNode, sourceNode, settings, imageSlots, depth, inMath, inSourceAnswerStructure
  ) {
    if (!clonedNode || typeof clonedNode !== 'object') return null;
    if (depth > limits.MAX_AST_DEPTH) fail('AST_LIMIT_EXCEEDED');
    const nodeType = Number(clonedNode.nodeType);
    if (nodeType === 3 || nodeType === 4) return plainTextNode(textValue(clonedNode));
    if (nodeType !== 1 && nodeType !== 9 && nodeType !== 11) return null;
    if (nodeType !== 1) {
      const cloneChildren = childrenOf(clonedNode);
      const sourceChildren = childrenOf(sourceNode);
      const safeChildren = [];
      for (let index = 0; index < cloneChildren.length; index += 1) {
        const child = sanitizeNode(
          cloneChildren[index], sourceChildren[index], settings, imageSlots, depth + 1, inMath,
          inSourceAnswerStructure
        );
        if (child) safeChildren.push(child);
      }
      return { nodeType: 11, nodeName: '#document-fragment', childNodes: safeChildren };
    }

    const tag = nodeTag(clonedNode);
    if (!tag) return null;
    const sourceAnswerContext = inSourceAnswerStructure || isSourceAnswerStructure(clonedNode);
    if (DROP_SUBTREE[tag]) return null;
    if (!settings.isOption && isBodyOptionContainer(clonedNode, tag)) return null;
    if (!settings.isOption && settings.rootCompatibleBlankMarkers &&
        !sourceAnswerContext && rootCompatibleBlankMarker(clonedNode, depth)) {
      return plainBlankNode();
    }
    if (isAnswerControl(clonedNode, tag)) {
      const optionShell = isOptionContentShell(clonedNode, tag);
      if (!settings.isOption) return optionShell ? null : plainBlankNode();
      if (!optionShell) return null;
      const cloneChildren = childrenOf(clonedNode);
      const sourceChildren = childrenOf(sourceNode);
      const safeChildren = [];
      for (let index = 0; index < cloneChildren.length; index += 1) {
        const child = sanitizeNode(
          cloneChildren[index], sourceChildren[index], settings, imageSlots, depth + 1, inMath,
          sourceAnswerContext
        );
        if (child) safeChildren.push(child);
      }
      return { nodeType: 11, nodeName: '#document-fragment', childNodes: safeChildren };
    }
    if (!settings.isOption && !sourceAnswerContext &&
        reviewedBlankFeedback(clonedNode, tag, depth)) {
      return plainBlankNode();
    }
    if (isStatusNode(clonedNode, tag)) return null;

    if (tag === 'img') {
      if (inMath) return null;
      const source = pairedImageSource(clonedNode, sourceNode);
      const altPresent = hasAttribute(clonedNode, 'alt');
      const role = attribute(clonedNode, 'role').trim().toLowerCase();
      const decorative = (altPresent && attribute(clonedNode, 'alt').trim() === '') ||
        role === 'presentation' || role === 'none' ||
        attribute(clonedNode, 'aria-hidden').trim().toLowerCase() === 'true';
      const alt = decorative ? '' : attribute(clonedNode, 'alt');
      const slotIndex = imageSlots.length;
      imageSlots.push({ source, alt, altPresent, decorative });
      return plainElement('img', { alt }, [], `ykt-image-slot:${slotIndex}`);
    }

    const safeAttrs = {};
    if (tag === 'td' || tag === 'th') {
      if (hasAttribute(clonedNode, 'rowspan')) safeAttrs.rowspan = attribute(clonedNode, 'rowspan');
      if (hasAttribute(clonedNode, 'colspan')) safeAttrs.colspan = attribute(clonedNode, 'colspan');
    } else if (tag === 'math') {
      if (hasAttribute(clonedNode, 'display')) safeAttrs.display = attribute(clonedNode, 'display');
    } else if (tag === 'annotation') {
      if (hasAttribute(clonedNode, 'encoding')) safeAttrs.encoding = attribute(clonedNode, 'encoding');
    }
    const cloneChildren = childrenOf(clonedNode);
    const sourceChildren = childrenOf(sourceNode);
    const safeChildren = [];
    const childInMath = inMath || tag === 'math';
    for (let index = 0; index < cloneChildren.length; index += 1) {
      const child = sanitizeNode(
        cloneChildren[index], sourceChildren[index], settings, imageSlots, depth + 1, childInMath,
        sourceAnswerContext
      );
      if (child) safeChildren.push(child);
    }
    return plainElement(tag, safeAttrs, safeChildren, '');
  }

  function boundedBytes(value, maximumBytes) {
    if (Array.isArray(value)) {
      const length = value.length;
      if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
        return { bytes: null, charge: maximumBytes };
      }
      const result = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        if (!Number.isInteger(value[index]) || value[index] < 0 || value[index] > 255) {
          return { bytes: null, charge: maximumBytes };
        }
        result[index] = value[index];
      }
      return { bytes: result, charge: length };
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
      const length = value.byteLength;
      if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
        return { bytes: null, charge: maximumBytes };
      }
      return {
        bytes: new Uint8Array(value.buffer, value.byteOffset, length).slice(),
        charge: length
      };
    }
    if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
      const length = value.byteLength;
      if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
        return { bytes: null, charge: maximumBytes };
      }
      return { bytes: new Uint8Array(value).slice(), charge: length };
    }
    return { bytes: null, charge: maximumBytes };
  }

  function asciiAt(bytes, offset, value) {
    if (offset + value.length > bytes.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (bytes[offset + index] !== value.charCodeAt(index)) return false;
    }
    return true;
  }

  function signatureMime(bytes) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && asciiAt(bytes, 1, 'PNG') &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
      return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes.length >= 6 && (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a'))) {
      return 'image/gif';
    }
    if (bytes.length >= 12 && asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) {
      return 'image/webp';
    }
    return '';
  }

  function containsAsciiCaseInsensitive(bytes, value) {
    const lowered = value.toLowerCase();
    for (let offset = 0; offset + lowered.length <= bytes.length; offset += 1) {
      let matches = true;
      for (let index = 0; index < lowered.length; index += 1) {
        let code = bytes[offset + index];
        if (code >= 0x41 && code <= 0x5a) code += 0x20;
        if (code !== lowered.charCodeAt(index)) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
    return false;
  }

  function hasActiveTextSignature(bytes) {
    return containsAsciiCaseInsensitive(bytes, '<svg') ||
      containsAsciiCaseInsensitive(bytes, '<script') ||
      containsAsciiCaseInsensitive(bytes, '<?xml') ||
      containsAsciiCaseInsensitive(bytes, '<!doctype html');
  }

  function base64Encode(bytes) {
    let result = '';
    const pieces = [];
    for (let offset = 0; offset < bytes.length; offset += 3) {
      const first = bytes[offset];
      const hasSecond = offset + 1 < bytes.length;
      const hasThird = offset + 2 < bytes.length;
      const second = hasSecond ? bytes[offset + 1] : 0;
      const third = hasThird ? bytes[offset + 2] : 0;
      result += BASE64_ALPHABET[first >> 2];
      result += BASE64_ALPHABET[((first & 3) << 4) | (second >> 4)];
      result += hasSecond ? BASE64_ALPHABET[((second & 15) << 2) | (third >> 6)] : '=';
      result += hasThird ? BASE64_ALPHABET[third & 63] : '=';
      if (result.length >= 8192) {
        pieces.push(result);
        result = '';
      }
    }
    pieces.push(result);
    return pieces.join('');
  }

  function blockedWarning(questionOrdinal) {
    return {
      code: 'IMAGE_BLOCKED',
      questionOrdinal,
      resourceId: null,
      messageKey: 'imageBlocked'
    };
  }

  function createResourceCounters() {
    return { imageSlotsUsed: 0, inlineBytesRead: 0, inlineBytesReserved: 0, questions: new Map() };
  }

  function resourceCounters(options) {
    const token = options.resourceState;
    if (token === undefined) return createResourceCounters();
    if (token === null || (typeof token !== 'object' && typeof token !== 'function')) fail('MODEL_INVALID');
    let state = RESOURCE_STATES.get(token);
    if (!state) {
      state = createResourceCounters();
      RESOURCE_STATES.set(token, state);
    }
    return state;
  }

  function questionResourceCounters(state, questionOrdinal) {
    let counters = state.questions.get(questionOrdinal);
    if (!counters) {
      counters = { images: 0, math: 0 };
      state.questions.set(questionOrdinal, counters);
    }
    return counters;
  }

  async function prepareImages(imageSlots, options, questionOrdinal, state, questionCounters) {
    const images = [];
    const decisions = [];
    const warnings = [];

    for (const slot of imageSlots) {
      if (state.imageSlotsUsed >= limits.MAX_IMAGES) {
        warnings.push(blockedWarning(questionOrdinal));
        decisions.push(null);
        continue;
      }
      state.imageSlotsUsed += 1;
      let prepared = null;
      const source = slot.source;
      if (/^https:/i.test(source)) {
        try {
          prepared = { kind: 'remote', src: urlPolicy.normalizeRemoteUrl(source) };
        } catch (_error) {
          prepared = null;
        }
      } else if (/^(?:data:|blob:)/i.test(source) && typeof options.fetchBlob === 'function') {
        const remainingTotalBytes = Math.max(
          0,
          limits.MAX_INLINE_IMAGE_TOTAL_BYTES - state.inlineBytesRead - state.inlineBytesReserved
        );
        if (remainingTotalBytes > 0) {
          const reservation = Math.min(limits.MAX_INLINE_IMAGE_BYTES, remainingTotalBytes);
          state.inlineBytesReserved += reservation;
          let charge = reservation;
          try {
            const result = await options.fetchBlob(source, {
              maxBytes: reservation,
              remainingTotalBytes
            });
            const inspected = boundedBytes(result && result.bytes, reservation);
            charge = inspected.charge;
            const bytes = inspected.bytes;
            const mime = result && typeof result.mime === 'string' ? result.mime.trim().toLowerCase() : '';
            if (bytes && INLINE_MIME[mime] && signatureMime(bytes) === mime &&
                !hasActiveTextSignature(bytes)) {
              prepared = { kind: 'data', src: `data:${mime};base64,${base64Encode(bytes)}` };
            }
          } catch (_error) {
            prepared = null;
          } finally {
            state.inlineBytesReserved = Math.max(0, state.inlineBytesReserved - reservation);
            state.inlineBytesRead = Math.min(
              limits.MAX_INLINE_IMAGE_TOTAL_BYTES,
              state.inlineBytesRead + charge
            );
          }
        }
      }

      if (!prepared || images.length >= limits.MAX_IMAGES) {
        warnings.push(blockedWarning(questionOrdinal));
        decisions.push(null);
        continue;
      }

      questionCounters.images += 1;
      const imageNumber = questionCounters.images;
      const id = `q-${questionOrdinal}-img-${imageNumber}`;
      const decorative = slot.decorative === true;
      let alt = decorative ? '' : slot.alt.trim();
      if (!decorative && !slot.altPresent) {
        alt = `第 ${questionOrdinal} 题图片 ${imageNumber}，原页面未提供图片说明`;
      }
      const descriptor = { id, kind: prepared.kind, src: prepared.src, alt, decorative };
      images.push(descriptor);
      decisions.push(id);
      if (!decorative && !slot.altPresent) {
        warnings.push({
          code: 'IMAGE_ALT_MISSING',
          questionOrdinal,
          resourceId: id,
          messageKey: 'imageAltMissing'
        });
      }
    }
    return { images, decisions, warnings };
  }

  async function normalizeRichContent(node, options = {}) {
    const questionOrdinal = options.questionOrdinal;
    if (!Number.isSafeInteger(questionOrdinal) || questionOrdinal < 1) fail('MODEL_INVALID');
    if (!node || typeof node !== 'object' || typeof node.cloneNode !== 'function') fail('AST_INVALID');
    let cloned;
    try {
      cloned = node.cloneNode(true);
    } catch (_error) {
      fail('AST_INVALID');
    }
    const imageSlots = [];
    let snapshot = sanitizeNode(cloned, node, {
      isOption: optionContext(options),
      rootCompatibleBlankMarkers: options.rootCompatibleBlankMarkers === true
    }, imageSlots, 0, false, false);
    if (!snapshot) snapshot = { nodeType: 11, nodeName: '#document-fragment', childNodes: [] };
    const state = resourceCounters(options);
    const questionCounters = questionResourceCounters(state, questionOrdinal);
    const prepared = await prepareImages(imageSlots, options, questionOrdinal, state, questionCounters);
    let imageIndex = 0;
    const math = [];
    const ast = richText.fromDom(snapshot, {
      onImage() {
        const decision = prepared.decisions[imageIndex];
        imageIndex += 1;
        return decision;
      },
      onMath(descriptor) {
        questionCounters.math += 1;
        const id = `q-${questionOrdinal}-math-${questionCounters.math}`;
        math.push({
          id,
          tex: descriptor.tex,
          display: descriptor.display === 'block',
          fallbackText: descriptor.fallbackText
        });
        return id;
      }
    });
    richText.validate(ast, {
      imageIds: new Set(prepared.images.map((descriptor) => descriptor.id)),
      mathIds: new Set(math.map((descriptor) => descriptor.id))
    });
    return { ast, images: prepared.images, math, warnings: prepared.warnings };
  }

  function normalizeAnswerText(value) {
    if (value === null || value === undefined) return '';
    const trimmed = String(value).trim();
    return trimmed.replace(/^(?:正确答案|参考答案|答案)\s*[：:]?\s*/, '').trim();
  }

  function canonicalLabel(value) {
    return String(value).replace(/\s+/g, '').replace(/[：:]$/, '');
  }

  function labelMatchesPattern(label, labelPattern) {
    if (labelPattern === undefined || labelPattern === null) return true;
    if (typeof labelPattern === 'string') return label === labelPattern;
    if (Object.prototype.toString.call(labelPattern) !== '[object RegExp]') return false;
    try {
      labelPattern.lastIndex = 0;
      const matched = labelPattern.test(label);
      labelPattern.lastIndex = 0;
      return matched;
    } catch (_error) {
      return false;
    }
  }

  function isQuestionContentRegion(node, tag) {
    if (tag === 'question-body' || tag === 'option-list' || tag === 'question-options') return true;
    const classes = attribute(node, 'class').trim().split(/\s+/).filter(Boolean);
    const blocked = {
      'q-body': true,
      'question-body': true,
      'question-options': true,
      'item-body': true,
      'problem-body': true,
      custom_ueditor_cn_body: true,
      options: true,
      'option-list': true,
      'list-unstyled-checkbox': true,
      'list-unstyled-radio': true,
      'el-radio': true,
      'el-checkbox': true,
      radioinput: true,
      checkboxinput: true
    };
    for (const className of classes) if (blocked[className.toLowerCase()]) return true;
    const region = attribute(node, 'data-question-region').trim().toLowerCase();
    return region === 'body' || region === 'options';
  }

  function isWithinQuestionContentRegion(node) {
    let current = node;
    let depth = 0;
    while (current && typeof current === 'object') {
      if (Number(current.nodeType) === 1 && isQuestionContentRegion(current, nodeTag(current))) return true;
      current = current.parentNode;
      depth += 1;
      if (depth > limits.MAX_AST_DEPTH) return true;
    }
    return false;
  }

  function containsQuestionContentRegion(node) {
    const stack = [{ node, depth: 0 }];
    let visited = 0;
    while (stack.length > 0) {
      const entry = stack.pop();
      const current = entry.node;
      if (!current || typeof current !== 'object') continue;
      visited += 1;
      if (visited > limits.MAX_AST_NODES_PER_QUESTION || entry.depth > limits.MAX_AST_DEPTH) return true;
      if (Number(current.nodeType) === 1 && isQuestionContentRegion(current, nodeTag(current))) return true;
      for (const child of childrenOf(current)) stack.push({ node: child, depth: entry.depth + 1 });
    }
    return false;
  }

  function safeVisibleText(node) {
    if (!node || typeof node !== 'object') return '';
    const nodeType = Number(node.nodeType);
    if (nodeType === 3 || nodeType === 4) return textValue(node);
    if (nodeType !== 1 && nodeType !== 9 && nodeType !== 11) return '';
    if (nodeType === 1) {
      const tag = nodeTag(node);
      if (isAnswerControl(node, tag) || isStatusNode(node, tag) || isHidden(node) ||
          isQuestionContentRegion(node, tag)) return '';
    }
    let output = '';
    for (const child of childrenOf(node)) output += safeVisibleText(child);
    return output;
  }

  function containsAnswerControl(node) {
    const stack = [{ node, depth: 0 }];
    let visited = 0;
    while (stack.length > 0) {
      const entry = stack.pop();
      const current = entry.node;
      if (!current || typeof current !== 'object') continue;
      visited += 1;
      if (visited > limits.MAX_AST_NODES_PER_QUESTION || entry.depth > limits.MAX_AST_DEPTH) return true;
      if (Number(current.nodeType) === 1 && isAnswerControl(current, nodeTag(current))) return true;
      for (const child of childrenOf(current)) stack.push({ node: child, depth: entry.depth + 1 });
    }
    return false;
  }

  function normalizeExplicitFooterValue(value, preserveLeadingSourceMarker) {
    const withoutSeparator = String(value).trim().replace(/^[：:]\s*/, '').trim();
    const normalized = normalizeAnswerText(withoutSeparator);
    const match = USER_FOOTER_MARKER.exec(normalized);
    if (!match || (match.index === 0 && preserveLeadingSourceMarker)) return normalized;
    return normalized.slice(0, match.index).trim();
  }

  function followingValue(siblings, startIndex) {
    let flattened = '';
    let hasMeaningfulText = false;
    let leadingSourceStructure = false;
    for (let index = startIndex; index < siblings.length; index += 1) {
      const sibling = siblings[index];
      if (!sibling || typeof sibling !== 'object') continue;
      const nodeType = Number(sibling.nodeType);
      if (nodeType === 3 || nodeType === 4) {
        const value = textValue(sibling);
        flattened += value;
        if (!hasMeaningfulText && value.replace(/[\s：:]/g, '').length > 0) {
          hasMeaningfulText = true;
          leadingSourceStructure = false;
        }
        continue;
      }
      if (nodeType !== 1) continue;
      const tag = nodeTag(sibling);
      if (isAnswerControl(sibling, tag) || containsAnswerControl(sibling)) return null;
      if (isStatusNode(sibling, tag) || isHidden(sibling)) continue;
      if (isWithinQuestionContentRegion(sibling) || containsQuestionContentRegion(sibling)) return null;
      const value = safeVisibleText(sibling);
      flattened += value;
      if (!hasMeaningfulText && value.replace(/[\s：:]/g, '').length > 0) {
        hasMeaningfulText = true;
        leadingSourceStructure = isSourceAnswerStructure(sibling);
      }
    }
    const value = normalizeExplicitFooterValue(flattened, leadingSourceStructure);
    return value || null;
  }

  function findExplicitLabelValue(rootNode, labelPattern) {
    if (!rootNode || typeof rootNode !== 'object' || typeof rootNode.cloneNode !== 'function') return null;
    let cloned;
    try {
      cloned = rootNode.cloneNode(true);
    } catch (_error) {
      return null;
    }
    const stack = [{ node: cloned, excluded: false }];
    while (stack.length > 0) {
      const entry = stack.pop();
      const current = entry.node;
      if (!current || typeof current !== 'object') continue;
      const nodeType = Number(current.nodeType);
      let excluded = entry.excluded;
      if (nodeType === 1) {
        const tag = nodeTag(current);
        if (isAnswerControl(current, tag) || isStatusNode(current, tag) || isHidden(current)) continue;
        excluded = excluded || isQuestionContentRegion(current, tag);
      }
      const children = childrenOf(current);
      if (!excluded) {
        const label = canonicalLabel(safeVisibleText(current));
        if (EXPLICIT_LABELS[label] && labelMatchesPattern(label, labelPattern)) {
          const parent = current.parentNode;
          const siblings = parent ? childrenOf(parent) : [];
          const index = siblings.indexOf(current);
          if (index >= 0) {
            const value = followingValue(siblings, index + 1);
            if (value !== null) return value;
          }
        }
      }
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ node: children[index], excluded });
      }
    }
    return null;
  }

  ns.sourceNormalizer = Object.freeze({
    normalizeRichContent,
    pickImageSource,
    normalizeAnswerText,
    findExplicitLabelValue
  });
})(globalThis);
