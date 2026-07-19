(function registerQuestionExtractors(root) {
  const ns = root.YktQuestionExporter;
  if (ns.questionExtractors) return;

  const limits = ns.limits;
  const urlPolicy = ns.urlPolicy;
  const richText = ns.richText;
  const model = ns.model;

  const STANDARD_SELECTORS = Object.freeze([
    '.container-problem .subject-item',
    '.exercise-item',
    '.subject-item',
    '[data-question-id]',
    '[data-exercise-id]',
    '.exam-item',
    '.question-item'
  ]);
  const BODY_SELECTORS = Object.freeze([
    '.item-body .custom_ueditor_cn_body',
    '.problem-body .custom_ueditor_cn_body',
    '.item-body',
    '.problem-body',
    'h4',
    '.custom_ueditor_cn_body'
  ]);
  const OPTION_LIST_SELECTORS = Object.freeze([
    '.list-unstyled-checkbox',
    '.list-unstyled-radio',
    '.options',
    '.option-list',
    '.question-options',
    '.item-options',
    '.el-radio-group',
    '.el-checkbox-group',
    'option-list',
    'question-options',
    '[data-question-region="options"]'
  ]);
  const OPTION_ITEM_SELECTOR = [
    '.option', '.option-item', 'option-item', '.el-radio', '.el-checkbox',
    '[role="radio"]', '[role="checkbox"]', 'x-choice'
  ].join(', ');
  const STANDALONE_OPTION_SELECTOR = [
    '.el-radio', '.el-checkbox', '[role="radio"]', '[role="checkbox"]', 'x-choice'
  ].join(', ');
  const OPTION_LABEL_SELECTORS = Object.freeze([
    '.checkboxInput',
    '.radioInput',
    '.option-label',
    '.label'
  ]);
  const OPTION_CONTENT_SELECTORS = Object.freeze([
    '.checkboxText',
    '.radioText',
    '.option-content',
    '.content',
    '.el-radio__label',
    '.el-checkbox__label'
  ]);
  const META_SELECTORS = Object.freeze([
    '.item-type',
    '.problem-type',
    '.question-type',
    '.subject-type',
    '.score',
    '.meta'
  ]);
  const EXPLANATION_SELECTORS = Object.freeze([
    '.item-footer--body',
    '.answer-analysis',
    '.question-analysis',
    '.analysis',
    '.explanation'
  ]);
  const EXCLUDED_ANCESTORS = '.exam-aside, .aside, .nav, .navigation, .toolbar';
  const REMOTE_SOURCE = /^https:/i;
  const CLOUD_KEY_PREFIX = 'cloud-student-exercise-';
  const BLANK_TEXT = '\u00a0'.repeat(8);

  function fail(code) {
    throw new Error(code);
  }

  function own(value, key) {
    return value !== null && typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, key);
  }

  function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function safeQuery(node, selector) {
    if (!node || typeof node.querySelector !== 'function') return null;
    try {
      return node.querySelector(selector);
    } catch (_error) {
      return null;
    }
  }

  function safeQueryAll(node, selector) {
    if (!node || typeof node.querySelectorAll !== 'function') return [];
    try {
      return Array.from(node.querySelectorAll(selector) || []);
    } catch (_error) {
      return [];
    }
  }

  function firstMatch(node, selectors) {
    for (const selector of selectors) {
      const match = safeQuery(node, selector);
      if (match) return match;
    }
    return null;
  }

  function visibleText(node) {
    if (!node || typeof node !== 'object') return '';
    let value = '';
    try {
      value = typeof node.textContent === 'string' ? node.textContent : '';
    } catch (_error) {
      value = '';
    }
    return value.replace(/\s+/g, ' ').trim();
  }

  function attribute(node, name) {
    if (!node || typeof node.getAttribute !== 'function') return '';
    try {
      const value = node.getAttribute(name);
      return typeof value === 'string' ? value : '';
    } catch (_error) {
      return '';
    }
  }

  function pageKind(input) {
    const canonical = urlPolicy.normalizeRemoteUrl(
      typeof input === 'string' ? input : input && input.href
    );
    const parsed = new URL(canonical);
    if (/^\/v2\/web\/cloud\/student\/exercise(?:\/|$)/.test(parsed.pathname)) {
      return 'cloud-exercise';
    }
    if (parsed.hostname.toLowerCase() === 'examination.xuetangx.com' &&
        /^\/result(?:\/|$)/.test(parsed.pathname)) {
      return 'result';
    }
    return 'standard';
  }

  function isQuestionCandidate(node) {
    if (!node || typeof node !== 'object') return false;
    if (typeof node.closest === 'function') {
      try {
        if (node.closest(EXCLUDED_ANCESTORS)) return false;
      } catch (_error) {
        return false;
      }
    }
    const hasBody = firstMatch(node, BODY_SELECTORS) !== null;
    const hasOptions = firstMatch(node, OPTION_LIST_SELECTORS) !== null ||
      safeQuery(node, STANDALONE_OPTION_SELECTOR) !== null;
    const hasInput = safeQuery(node, 'input, textarea, select, [contenteditable]') !== null;
    const hasType = firstMatch(node, META_SELECTORS) !== null;
    return hasBody || hasOptions || hasInput || hasType;
  }

  function uniqueCandidates(nodes) {
    const seen = new Set();
    const result = [];
    for (const node of nodes) {
      if (!node || seen.has(node) || !isQuestionCandidate(node)) continue;
      seen.add(node);
      result.push(node);
      if (result.length >= limits.MAX_QUESTIONS) break;
    }
    return result;
  }

  function standardCandidates(document) {
    return uniqueCandidates(safeQueryAll(document, STANDARD_SELECTORS.join(', ')));
  }

  function resultCandidates(document) {
    const subjects = safeQueryAll(document, '.subject-item');
    if (subjects.length > 0) {
      return uniqueCandidates(subjects.map((subject) => (
        safeQuery(subject, '.result_item') || subject
      )));
    }
    const direct = safeQueryAll(document, '.result_item');
    if (direct.length > 0) return uniqueCandidates(direct);
    const bodies = safeQueryAll(document, '.item-body, .problem-body');
    return uniqueCandidates(bodies.map((body) => body.parentNode).filter(Boolean));
  }

  function normalizerOptions(
    ordinal, resourceState, dependencies, context, rootCompatibleBlankMarkers
  ) {
    const result = {
      questionOrdinal: ordinal,
      resourceState
    };
    if (context === 'option') result.context = 'option';
    if (rootCompatibleBlankMarkers === true) result.rootCompatibleBlankMarkers = true;
    if (typeof dependencies.fetchBlob === 'function') result.fetchBlob = dependencies.fetchBlob;
    return result;
  }

  function mergeNormalized(target, normalized) {
    target.images.push(...normalized.images);
    target.math.push(...normalized.math);
    target.warnings.push(...normalized.warnings);
    return normalized.ast;
  }

  function hasAstContent(nodes) {
    const stack = Array.isArray(nodes) ? nodes.slice() : [];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!record(node)) continue;
      if (node.type === 'text' && typeof node.value === 'string' && node.value.trim()) return true;
      if (node.type === 'image' || node.type === 'math') return true;
      if (node.type === 'element' && Array.isArray(node.children)) {
        if (node.tag === 'hr' || (
          node.tag === 'u' &&
          node.children.length === 1 &&
          node.children[0].type === 'text' &&
          node.children[0].value === BLANK_TEXT
        )) return true;
        stack.push(...node.children);
      }
    }
    return false;
  }

  function labelText(node, index) {
    const found = firstMatch(node, OPTION_LABEL_SELECTORS);
    const authored = visibleText(found).replace(/[\s.．、:：]+$/g, '');
    if (authored) return authored;
    let value = index;
    let label = '';
    do {
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26) - 1;
    } while (value >= 0);
    return label;
  }

  async function extractOptions(candidate, ordinal, state, dependencies, resourceState) {
    const list = firstMatch(candidate, OPTION_LIST_SELECTORS);
    let items = list ? safeQueryAll(list, 'li') : [];
    if (list && items.length === 0) items = safeQueryAll(list, OPTION_ITEM_SELECTOR);
    if (!list) items = safeQueryAll(candidate, STANDALONE_OPTION_SELECTOR);
    if (items.length === 0) return [];
    const options = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const contentNode = firstMatch(item, OPTION_CONTENT_SELECTORS) || item;
      const normalized = await dependencies.normalizer.normalizeRichContent(
        contentNode,
        normalizerOptions(ordinal, resourceState, dependencies, 'option')
      );
      const content = mergeNormalized(state, normalized);
      if (!hasAstContent(content)) continue;
      options.push({ label: labelText(item, index), content });
    }
    return options;
  }

  function textAst(value) {
    const normalized = String(value || '').trim();
    return normalized ? [{ type: 'text', value: normalized }] : null;
  }

  function failedQuestion(ordinal, metaText) {
    return {
      id: `q-${ordinal}`,
      ordinal,
      status: 'failed',
      metaText: metaText || `第 ${ordinal} 题未能识别`,
      images: [],
      math: []
    };
  }

  function partialWarning(ordinal) {
    return {
      code: 'PARTIAL_EXTRACTION',
      questionOrdinal: ordinal,
      resourceId: null,
      messageKey: 'partialExtraction'
    };
  }

  function cloudWarning() {
    return {
      code: 'CLOUD_CACHE_PARTIAL',
      questionOrdinal: null,
      resourceId: null,
      messageKey: 'cloudCachePartial'
    };
  }

  async function decodedClone(candidate, dependencies) {
    if (!candidate || typeof candidate.cloneNode !== 'function') fail('MODEL_INVALID');
    const cloned = candidate.cloneNode(true);
    if (dependencies.fontDecoder && typeof dependencies.fontDecoder.decode === 'function') {
      const outcome = await dependencies.fontDecoder.decode(cloned, {
        requestId: dependencies.requestId || null
      });
      if (outcome && outcome.ok === false && outcome.required === true) fail('FONT_FETCH_FAILED');
    }
    return cloned;
  }

  async function extractDomQuestion(candidate, ordinal, dependencies) {
    const working = await decodedClone(candidate, dependencies);
    const metaText = visibleText(firstMatch(working, META_SELECTORS)) || `第 ${ordinal} 题`;
    const bodyNode = firstMatch(working, BODY_SELECTORS);
    if (!bodyNode) fail('QUESTION_BODY_MISSING');
    const resourceState = {};
    const state = { images: [], math: [], warnings: [] };
    const bodyResult = await dependencies.normalizer.normalizeRichContent(
      bodyNode,
      normalizerOptions(
        ordinal, resourceState, dependencies, 'body', true
      )
    );
    const body = mergeNormalized(state, bodyResult);
    if (!hasAstContent(body)) fail('QUESTION_BODY_MISSING');
    const options = await extractOptions(
      working, ordinal, state, dependencies, resourceState
    );

    const question = {
      id: `q-${ordinal}`,
      ordinal,
      status: state.warnings.length > 0 ? 'incomplete' : 'ok',
      metaText,
      body,
      options
    };

    const answerValue = dependencies.normalizer.findExplicitLabelValue(
      working,
      /^(?:正确答案|参考答案|答案)$/
    );
    const answer = textAst(dependencies.normalizer.normalizeAnswerText(answerValue));
    if (answer) question.correctAnswer = answer;

    const explanationNode = firstMatch(working, EXPLANATION_SELECTORS);
    if (explanationNode) {
      const explanationResult = await dependencies.normalizer.normalizeRichContent(
        explanationNode,
        normalizerOptions(ordinal, resourceState, dependencies, 'body')
      );
      const explanation = mergeNormalized(state, explanationResult);
      if (hasAstContent(explanation)) question.explanation = explanation;
    }

    question.status = state.warnings.length > 0 ? 'incomplete' : 'ok';
    question.images = state.images;
    question.math = state.math;
    return { question, warnings: state.warnings };
  }

  function sourceRecord(dependencies, kind) {
    const canonical = urlPolicy.normalizeRemoteUrl(dependencies.location.href);
    const parsed = new URL(canonical);
    const nowValue = dependencies.now();
    if (!Number.isSafeInteger(nowValue) || nowValue < 0) fail('MODEL_INVALID');
    return {
      host: parsed.hostname.toLowerCase(),
      pageKind: kind,
      extractedAt: new Date(nowValue).toISOString()
    };
  }

  async function extractDomCandidates(candidates, dependencies, kind) {
    const questions = [];
    const warnings = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const ordinal = index + 1;
      try {
        const result = await extractDomQuestion(
          candidates[index], ordinal, dependencies
        );
        questions.push(result.question);
        warnings.push(...result.warnings);
      } catch (_error) {
        questions.push(failedQuestion(ordinal));
        warnings.push(partialWarning(ordinal));
      }
    }
    return model.validatePayload({
      schemaVersion: 1,
      source: sourceRecord(dependencies, kind),
      questions,
      warnings
    });
  }

  function cacheKeys(localStorage) {
    const result = [];
    if (!localStorage || !Number.isSafeInteger(localStorage.length) || localStorage.length < 0) {
      return result;
    }
    const maximum = Math.min(localStorage.length, limits.MAX_QUESTIONS);
    for (let index = 0; index < maximum; index += 1) {
      let key = null;
      try {
        key = localStorage.key(index);
      } catch (_error) {
        key = null;
      }
      if (typeof key === 'string' && key.startsWith(CLOUD_KEY_PREFIX)) result.push(key);
    }
    return result;
  }

  function matchingCache(localStorage, pathname) {
    const keys = cacheKeys(localStorage);
    const ordered = [
      ...keys.filter((key) => key.includes(pathname)),
      ...keys.filter((key) => !key.includes(pathname))
    ];
    for (const key of ordered) {
      let raw = null;
      try {
        raw = localStorage.getItem(key);
      } catch (_error) {
        raw = null;
      }
      if (typeof raw !== 'string' || raw.length === 0 ||
          raw.length > limits.MAX_SESSION_BYTES) continue;
      try {
        const parsed = JSON.parse(raw);
        if (record(parsed) && record(parsed.problems) || Array.isArray(parsed && parsed.problems)) {
          return parsed.problems;
        }
      } catch (_error) {
        // Ignore malformed passive cache entries.
      }
    }
    return null;
  }

  function cachedEntries(problems) {
    const values = Array.isArray(problems) ? problems.slice() :
      (record(problems) ? Object.keys(problems).map((key) => problems[key]) : []);
    const result = [];
    for (const item of values) {
      if (!record(item) || !record(item.content)) continue;
      const ordinal = Number(item.index);
      if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > limits.MAX_QUESTIONS) continue;
      result.push({ ordinal, content: item.content });
    }
    result.sort((left, right) => left.ordinal - right.ordinal);
    return result;
  }

  function cacheResourceHooks(ordinal, state) {
    return {
      onImage(descriptor) {
        let src = null;
        try {
          if (REMOTE_SOURCE.test(descriptor.src)) src = urlPolicy.normalizeRemoteUrl(descriptor.src);
        } catch (_error) {
          src = null;
        }
        if (!src || state.images.length >= limits.MAX_IMAGES) {
          state.warnings.push({
            code: 'IMAGE_BLOCKED',
            questionOrdinal: ordinal,
            resourceId: null,
            messageKey: 'imageBlocked'
          });
          return null;
        }
        const id = `q-${ordinal}-img-${state.images.length + 1}`;
        const alt = descriptor.alt.trim() ||
          `第 ${ordinal} 题图片 ${state.images.length + 1}，原页面未提供图片说明`;
        state.images.push({ id, kind: 'remote', src, alt, decorative: false });
        if (!descriptor.alt.trim()) {
          state.warnings.push({
            code: 'IMAGE_ALT_MISSING',
            questionOrdinal: ordinal,
            resourceId: id,
            messageKey: 'imageAltMissing'
          });
        }
        return id;
      },
      onMath(descriptor) {
        const id = `q-${ordinal}-math-${state.math.length + 1}`;
        state.math.push({
          id,
          tex: descriptor.tex,
          display: descriptor.display === 'block',
          fallbackText: descriptor.fallbackText
        });
        return id;
      }
    };
  }

  function cachedMeta(content, ordinal) {
    const type = typeof content.TypeText === 'string' && content.TypeText.trim() ?
      content.TypeText.trim() :
      (typeof content.Type === 'string' && content.Type.trim() ? content.Type.trim() : '题目');
    const scoreValue = own(content, 'Score') ? content.Score : content.score;
    const score = typeof scoreValue === 'number' || typeof scoreValue === 'string' ?
      String(scoreValue).trim() : '';
    return `${ordinal}.${type}${score ? `（${score}分）` : ''}`;
  }

  function cachedOptionFields(value, index) {
    if (!record(value)) return null;
    const labelValue = own(value, 'key') ? value.key :
      (own(value, 'Key') ? value.Key :
        (own(value, 'label') ? value.label : value.Label));
    const contentValue = own(value, 'value') ? value.value :
      (own(value, 'Value') ? value.Value :
        (own(value, 'content') ? value.content :
          (own(value, 'Content') ? value.Content :
            (own(value, 'text') ? value.text : value.Text))));
    if (contentValue === undefined || contentValue === null) return null;
    const label = String(labelValue === undefined || labelValue === null ? '' : labelValue).trim() ||
      String.fromCharCode(65 + (index % 26));
    return { label, content: String(contentValue) };
  }

  function cachedQuestion(entry) {
    const ordinal = entry.ordinal;
    const content = entry.content;
    const bodySource = typeof content.Body === 'string' ? content.Body : '';
    if (!bodySource.trim()) fail('QUESTION_BODY_MISSING');
    const state = { images: [], math: [], warnings: [] };
    const hooks = cacheResourceHooks(ordinal, state);
    const body = richText.fromSerialized(bodySource, hooks);
    if (!hasAstContent(body)) fail('QUESTION_BODY_MISSING');
    const options = [];
    const sourceOptions = Array.isArray(content.Options) ? content.Options : [];
    for (let index = 0; index < sourceOptions.length; index += 1) {
      const fields = cachedOptionFields(sourceOptions[index], index);
      if (!fields) continue;
      const optionAst = richText.fromSerialized(fields.content, hooks);
      if (hasAstContent(optionAst)) options.push({ label: fields.label, content: optionAst });
    }
    return {
      question: {
        id: `q-${ordinal}`,
        ordinal,
        status: state.warnings.length > 0 ? 'incomplete' : 'ok',
        metaText: cachedMeta(content, ordinal),
        body,
        options,
        images: state.images,
        math: state.math
      },
      warnings: state.warnings
    };
  }

  function passiveNavigationCount(document) {
    const nodes = safeQueryAll(
      document,
      '.exam-aside .J_order[data-order], .exam-aside .J_order, .J_order[data-order]'
    );
    let maximum = 0;
    for (const node of nodes) {
      const value = Number(attribute(node, 'data-order'));
      if (Number.isSafeInteger(value) && value > maximum) maximum = value;
    }
    return Math.min(limits.MAX_QUESTIONS, Math.max(maximum, nodes.length));
  }

  function currentCloudCandidate(document) {
    const candidates = uniqueCandidates(safeQueryAll(
      document,
      '.container-problem .subject-item, .container-problem [data-question-id], ' +
      '.container-problem [data-exercise-id]'
    ));
    return candidates[0] || null;
  }

  function currentCloudOrdinal(candidate) {
    for (const name of ['data-order', 'data-index', 'data-question-order']) {
      const value = Number(attribute(candidate, name));
      if (Number.isSafeInteger(value) && value >= 1 && value <= limits.MAX_QUESTIONS) return value;
    }
    return null;
  }

  async function extractCloud(dependencies) {
    const pathname = dependencies.location.pathname;
    const problems = matchingCache(dependencies.localStorage, pathname);
    const entries = cachedEntries(problems);
    const byOrdinal = new Map();
    const warnings = [];

    for (const entry of entries) {
      if (byOrdinal.has(entry.ordinal)) continue;
      try {
        const result = cachedQuestion(entry);
        byOrdinal.set(entry.ordinal, result.question);
        warnings.push(...result.warnings);
      } catch (_error) {
        byOrdinal.set(entry.ordinal, failedQuestion(entry.ordinal));
        warnings.push(partialWarning(entry.ordinal));
      }
    }

    const current = currentCloudCandidate(dependencies.document);
    const currentOrdinal = currentCloudOrdinal(current);
    if (current && currentOrdinal !== null && !byOrdinal.has(currentOrdinal)) {
      try {
        const result = await extractDomQuestion(current, currentOrdinal, dependencies);
        byOrdinal.set(currentOrdinal, result.question);
        warnings.push(...result.warnings);
      } catch (_error) {
        byOrdinal.set(currentOrdinal, failedQuestion(currentOrdinal));
        warnings.push(partialWarning(currentOrdinal));
      }
    }

    let maximum = passiveNavigationCount(dependencies.document);
    for (const ordinal of byOrdinal.keys()) maximum = Math.max(maximum, ordinal);
    maximum = Math.min(maximum, limits.MAX_QUESTIONS);
    let partial = false;
    const questions = [];
    for (let ordinal = 1; ordinal <= maximum; ordinal += 1) {
      if (byOrdinal.has(ordinal)) {
        questions.push(byOrdinal.get(ordinal));
      } else {
        partial = true;
        questions.push(failedQuestion(ordinal));
        warnings.push(partialWarning(ordinal));
      }
    }
    if (partial || questions.length === 0) warnings.unshift(cloudWarning());

    return model.validatePayload({
      schemaVersion: 1,
      source: sourceRecord(dependencies, 'cloud-exercise'),
      questions,
      warnings
    });
  }

  function create(dependencies) {
    if (!record(dependencies) || !dependencies.document || !dependencies.location ||
        !dependencies.localStorage || !dependencies.normalizer ||
        typeof dependencies.normalizer.normalizeRichContent !== 'function') {
      fail('MODEL_INVALID');
    }
    const normalized = {
      document: dependencies.document,
      location: dependencies.location,
      localStorage: dependencies.localStorage,
      normalizer: dependencies.normalizer,
      fontDecoder: dependencies.fontDecoder || null,
      fetchBlob: dependencies.fetchBlob,
      requestId: dependencies.requestId,
      now: typeof dependencies.now === 'function' ? dependencies.now : Date.now
    };
    const kind = pageKind(normalized.location.href);
    return Object.freeze({
      extractAll() {
        if (kind === 'cloud-exercise') return extractCloud(normalized);
        const candidates = kind === 'result' ?
          resultCandidates(normalized.document) :
          standardCandidates(normalized.document);
        return extractDomCandidates(candidates, normalized, kind);
      }
    });
  }

  ns.questionExtractors = Object.freeze({
    pageKind,
    isQuestionCandidate,
    create
  });
})(globalThis);
