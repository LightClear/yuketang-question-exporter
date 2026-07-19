(function registerResultsController(root) {
  const ns = root.YktQuestionExporter;
  if (ns.resultsController) return;

  const modelApi = ns.model;
  const richText = ns.richText;
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const SESSION_QUERY =
    /^\?session=([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
  const PAGE_KIND_LABELS = Object.freeze({
    standard: '常规题目',
    'cloud-exercise': '云作业',
    result: '复习结果'
  });
  const WARNING_COPY = Object.freeze({
    partialExtraction: '这道题只识别到部分内容，请对照原页面核对。',
    cloudCachePartial: '云作业缓存不完整，结果只包含当前可读取的题目。',
    imageAltMissing: '原页面没有提供图片说明，请对照原页面核对题图。',
    imageBlocked: '题图受到资源策略限制，可能无法显示或写入 Word。',
    fontFetchFailed: '部分加密文字未能还原，请对照原页面核对。'
  });

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function requireElement(documentValue, id) {
    const element = documentValue.getElementById(id);
    if (!element) fail('RESULTS_SHELL_INVALID');
    return element;
  }

  function platformLabel(host) {
    return host === 'yuketang.cn' || host.endsWith('.yuketang.cn')
      ? '雨课堂'
      : '学堂在线';
  }

  function parseSessionId(locationHref) {
    let parsed;
    try {
      parsed = new URL(locationHref);
    } catch (_error) {
      fail('SESSION_QUERY_INVALID');
    }
    const match = SESSION_QUERY.exec(parsed.search);
    if (!match || parsed.hash !== '' || !modelApi.isUuid(match[1])) {
      fail('SESSION_QUERY_INVALID');
    }
    return match[1];
  }

  function create(dependencies) {
    const input = dependencies || {};
    const documentValue = input.document || root.document;
    const locationHref = input.locationHref ||
      (root.location && typeof root.location.href === 'string' ? root.location.href : '');
    const storageSession = input.storageSession ||
      (root.chrome && root.chrome.storage ? root.chrome.storage.session : null);
    const createImageResolver = input.createImageResolver ||
      (() => ns.imageResolver.create());
    const exportQuestions = input.exportQuestions ||
      ((payload, options) => ns.docxExporter.exportQuestions(payload, options));
    const createObjectURL = input.createObjectURL ||
      ((blob) => root.URL.createObjectURL(blob));
    const revokeObjectURL = input.revokeObjectURL ||
      ((url) => root.URL.revokeObjectURL(url));
    const now = input.now || (() => Date.now());
    const setTimer = input.setTimeout || root.setTimeout;
    const clearTimer = input.clearTimeout || root.clearTimeout;
    const Observer = input.IntersectionObserver || root.IntersectionObserver;
    const katexValue = input.katex || root.katex;
    const addPageHideListener = input.addPageHideListener || ((listener) => {
      if (typeof root.addEventListener !== 'function') return () => {};
      root.addEventListener('pagehide', listener, { once: true });
      return () => {
        if (typeof root.removeEventListener === 'function') {
          root.removeEventListener('pagehide', listener);
        }
      };
    });
    if (!documentValue || !storageSession || typeof storageSession.get !== 'function' ||
        typeof storageSession.remove !== 'function' ||
        typeof createImageResolver !== 'function' || typeof exportQuestions !== 'function' ||
        typeof createObjectURL !== 'function' || typeof revokeObjectURL !== 'function' ||
        typeof now !== 'function' || typeof setTimer !== 'function' ||
        typeof clearTimer !== 'function' || typeof addPageHideListener !== 'function') {
      fail('RESULTS_DEPENDENCY_MISSING');
    }

    const pageTitle = requireElement(documentValue, 'page-title');
    const sourceSummary = requireElement(documentValue, 'source-summary');
    const exportButton = requireElement(documentValue, 'export-word');
    const liveStatus = requireElement(documentValue, 'live-status');
    const warningSummary = requireElement(documentValue, 'warning-summary');
    const app = requireElement(documentValue, 'app');
    const questionNav = requireElement(documentValue, 'question-nav');
    const questionsRoot = requireElement(documentValue, 'questions');
    const errorState = requireElement(documentValue, 'error-state');
    const errorTitle = requireElement(documentValue, 'error-title');
    const errorMessage = requireElement(documentValue, 'error-message');

    let started = false;
    let disposed = false;
    let exporting = false;
    let currentPayload = null;
    let currentSessionKey = null;
    let resolver = null;
    let observer = null;
    let unregisterPageHide = null;
    const timerIds = new Set();
    const activeDownloadUrls = new Set();
    const imageJobs = new Set();
    const navLinks = new Map();

    function schedule(callback, delay) {
      let timerId;
      timerId = setTimer(async () => {
        timerIds.delete(timerId);
        await callback();
      }, delay);
      timerIds.add(timerId);
      return timerId;
    }

    function safeRemoveSession(key) {
      if (!key) return Promise.resolve();
      return Promise.resolve(storageSession.remove(key)).catch(() => undefined);
    }

    function recoveryMessage() {
      return '切回原题目标签页，重新点击扩展图标即可重新识别。';
    }

    function showError() {
      app.hidden = true;
      warningSummary.hidden = true;
      exportButton.disabled = true;
      exportButton.removeAttribute('aria-busy');
      errorState.hidden = false;
      errorMessage.textContent = recoveryMessage();
      errorTitle.focus();
    }

    function makeElement(tag, className, text) {
      const element = documentValue.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    }

    function setCurrentQuestion(ordinal) {
      for (const [value, link] of navLinks) {
        if (value === ordinal) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    }

    function focusQuestion(question, link) {
      const heading = documentValue.getElementById(`question-heading-${question.ordinal}`);
      const article = documentValue.getElementById(`question-${question.ordinal}`);
      if (article && typeof article.scrollIntoView === 'function') {
        article.scrollIntoView({ block: 'start' });
      }
      if (heading) heading.focus();
      if (link && typeof link.scrollIntoView === 'function') {
        link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      setCurrentQuestion(question.ordinal);
    }

    function warningItems(payload) {
      const items = payload.warnings.map((warning) => ({
        questionOrdinal: warning.questionOrdinal,
        messageKey: warning.messageKey
      }));
      const warnedOrdinals = new Set(
        items
          .filter((item) => Number.isSafeInteger(item.questionOrdinal))
          .map((item) => item.questionOrdinal)
      );
      for (const question of payload.questions) {
        if ((question.status === 'failed' || question.status === 'incomplete') &&
            !warnedOrdinals.has(question.ordinal)) {
          items.push({
            questionOrdinal: question.ordinal,
            messageKey: 'partialExtraction'
          });
          warnedOrdinals.add(question.ordinal);
        }
      }
      return items;
    }

    function renderMath(descriptor) {
      const target = makeElement(descriptor.display ? 'div' : 'span');
      target.className = descriptor.display ? 'math-display' : 'math-inline';
      const fallback = descriptor.fallbackText.trim().length > 0
        ? descriptor.fallbackText
        : descriptor.tex;
      target.setAttribute('aria-label', fallback);
      try {
        if (!katexValue || typeof katexValue.render !== 'function') throw new Error('unavailable');
        katexValue.render(descriptor.tex, target, {
          displayMode: descriptor.display,
          throwOnError: false,
          trust: false,
          strict: 'warn',
          output: 'htmlAndMathml'
        });
      } catch (_error) {
        target.textContent = fallback;
      }
      return target;
    }

    function renderPendingImage(descriptor) {
      const figure = makeElement('figure', 'image-placeholder', '正在载入题图…');
      const job = Promise.resolve()
        .then(() => resolver.resolveForDisplay(descriptor))
        .then((result) => {
          if (disposed) return;
          if (!result || typeof result.objectUrl !== 'string' ||
              !result.objectUrl.startsWith('blob:') || result.alt !== descriptor.alt ||
              !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) ||
              result.width <= 0 || result.height <= 0) {
            fail('IMAGE_DISPLAY_INVALID');
          }
          const image = makeElement('img', 'question-image');
          image.setAttribute('src', result.objectUrl);
          image.setAttribute('alt', descriptor.decorative ? '' : result.alt);
          image.setAttribute('width', String(result.width));
          image.setAttribute('height', String(result.height));
          if (descriptor.decorative) image.setAttribute('aria-hidden', 'true');
          figure.className = 'question-image-container';
          figure.replaceChildren(image);
        })
        .catch(() => {
          if (disposed) return;
          figure.className = 'image-placeholder question-warning';
          figure.textContent = '题图无法显示；导出 Word 时会再次核对该图片。';
        })
        .finally(() => {
          imageJobs.delete(job);
        });
      imageJobs.add(job);
      return figure;
    }

    function renderRich(nodes, question) {
      const imageDescriptors = new Map(
        question.images.map((descriptor) => [descriptor.id, descriptor])
      );
      const mathDescriptors = new Map(
        question.math.map((descriptor) => [descriptor.id, descriptor])
      );
      return richText.render(nodes, documentValue, {
        renderImage(imageId) {
          const descriptor = imageDescriptors.get(imageId);
          return descriptor ? renderPendingImage(descriptor) : null;
        },
        renderMath(mathId) {
          const descriptor = mathDescriptors.get(mathId);
          return descriptor ? renderMath(descriptor) : null;
        }
      });
    }

    function richContainer(nodes, question, className = 'question-rich') {
      const container = makeElement('div', className);
      container.append(renderRich(nodes, question));
      return container;
    }

    function questionWarningSection(question, items) {
      if (items.length === 0) return null;
      const section = makeElement('section', 'question-warning');
      const heading = makeElement('h3', null, '请核对');
      const messages = [...new Set(items.map((item) =>
        WARNING_COPY[item.messageKey] || '这道题需要对照原页面核对。'
      ))];
      section.append(heading, makeElement('p', null, messages.join(' ')));
      section.setAttribute('aria-label', `第 ${question.ordinal} 题警告`);
      return section;
    }

    function renderQuestion(question, perQuestionWarnings) {
      const article = makeElement('article', 'question-item question');
      article.id = `question-${question.ordinal}`;
      article.setAttribute('data-status', question.status);
      article.setAttribute('data-ordinal', String(question.ordinal));

      const heading = makeElement('h2', 'question-head');
      heading.id = `question-heading-${question.ordinal}`;
      heading.setAttribute('tabindex', '-1');
      heading.append(
        makeElement('span', 'question-number', `第 ${question.ordinal} 题`),
        makeElement('span', 'question-meta', question.metaText)
      );
      article.append(heading);

      if (question.status === 'failed') {
        const failed = makeElement('section', 'question-failed');
        failed.append(
          makeElement('h3', null, '未能识别'),
          makeElement('p', null, `第 ${question.ordinal} 题未能识别，未包含在 Word。`)
        );
        article.append(failed);
      } else {
        article.append(richContainer(question.body, question));
        if (question.options.length > 0) {
          const options = makeElement('ol', 'question-options');
          for (const option of question.options) {
            const item = makeElement('li', 'question-option');
            item.append(
              makeElement('span', 'option-label', option.label),
              richContainer(option.content, question)
            );
            options.append(item);
          }
          article.append(options);
        }
        if (question.correctAnswer) {
          const answer = makeElement('section', 'source-answer');
          answer.append(
            makeElement('h3', null, '来源标注答案'),
            richContainer(question.correctAnswer, question)
          );
          article.append(answer);
        }
        if (question.explanation) {
          const explanation = makeElement('section', 'source-explanation');
          explanation.append(
            makeElement('h3', null, '来源解析'),
            richContainer(question.explanation, question)
          );
          article.append(explanation);
        }
      }
      const warningSection = questionWarningSection(question, perQuestionWarnings);
      if (warningSection) article.append(warningSection);
      return article;
    }

    function renderWarningSummary(items, questions) {
      warningSummary.replaceChildren();
      if (items.length === 0) {
        warningSummary.hidden = true;
        return;
      }
      const firstOrdinal = items.find((item) =>
        Number.isSafeInteger(item.questionOrdinal)
      )?.questionOrdinal;
      const firstQuestion = questions.find((question) => question.ordinal === firstOrdinal) ||
        questions[0];
      const heading = makeElement('h2', null, '需要核对');
      const paragraph = makeElement('p');
      paragraph.append(documentValue.createTextNode(`识别结果中有 ${items.length} 项提示。`));
      if (firstQuestion) {
        const link = makeElement('a', null, '跳到第一处提示');
        link.href = `#question-${firstQuestion.ordinal}`;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          focusQuestion(firstQuestion, navLinks.get(firstQuestion.ordinal));
        });
        paragraph.append(documentValue.createTextNode(' '), link);
      }
      warningSummary.append(heading, paragraph);
      warningSummary.hidden = false;
    }

    function renderPage(payload) {
      const usableQuestions = payload.questions.filter((question) => question.status !== 'failed');
      const answers = usableQuestions.filter((question) =>
        question.correctAnswer || question.explanation
      ).length;
      const issues = warningItems(payload);
      const warningByOrdinal = new Map();
      for (const issue of issues) {
        if (!Number.isSafeInteger(issue.questionOrdinal)) continue;
        if (!warningByOrdinal.has(issue.questionOrdinal)) warningByOrdinal.set(issue.questionOrdinal, []);
        warningByOrdinal.get(issue.questionOrdinal).push(issue);
      }
      const platform = platformLabel(payload.source.host);
      const kind = PAGE_KIND_LABELS[payload.source.pageKind];
      documentValue.title = `${platform} · ${kind} · ${payload.questions.length} 道题目`;
      sourceSummary.textContent =
        `已识别 ${usableQuestions.length}/${payload.questions.length} 道 · ` +
        `${answers} 道含答案或解析 · ${issues.length} 项提示`;
      questionNav.replaceChildren();
      questionsRoot.replaceChildren();
      navLinks.clear();
      const articles = [];

      for (const question of payload.questions) {
        const warnings = warningByOrdinal.get(question.ordinal) || [];
        const warned = warnings.length > 0 || question.status !== 'ok';
        const item = makeElement('li');
        const link = makeElement('a', 'question-nav-link', String(question.ordinal).padStart(2, '0'));
        link.href = `#question-${question.ordinal}`;
        link.setAttribute('data-ordinal', String(question.ordinal).padStart(2, '0'));
        if (question.status === 'failed') link.classList.add('is-failed');
        if (warned) link.classList.add('has-warning');
        link.setAttribute(
          'aria-label',
          `第 ${question.ordinal} 题，${question.metaText}${warned ? '，有警告' : ''}`
        );
        link.addEventListener('click', (event) => {
          event.preventDefault();
          focusQuestion(question, link);
        });
        item.append(link);
        questionNav.append(item);
        navLinks.set(question.ordinal, link);
        const article = renderQuestion(question, warnings);
        articles.push(article);
        questionsRoot.append(article);
      }

      renderWarningSummary(issues, payload.questions);
      if (articles.length > 0) setCurrentQuestion(payload.questions[0].ordinal);
      if (typeof Observer === 'function') {
        observer = new Observer((entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
          if (!visible) return;
          const ordinal = Number(visible.target.getAttribute('data-ordinal'));
          if (Number.isSafeInteger(ordinal)) setCurrentQuestion(ordinal);
        }, {
          rootMargin: '-20% 0px -65% 0px',
          threshold: [0, 0.5, 1]
        });
        for (const article of articles) observer.observe(article);
      }
      errorState.hidden = true;
      app.hidden = false;
      exportButton.textContent = '导出 Word';
      exportButton.disabled = usableQuestions.length === 0;
      exportButton.removeAttribute('aria-busy');
      pageTitle.focus();
    }

    function exportStatus(failedImages) {
      if (!Array.isArray(failedImages) || failedImages.length === 0) {
        return 'Word 已生成，下载已开始。';
      }
      const ordinals = [...new Set(
        failedImages
          .map((item) => item && item.questionOrdinal)
          .filter((value) => Number.isSafeInteger(value) && value > 0)
      )].sort((left, right) => left - right);
      if (ordinals.length === 0) {
        return `Word 已生成，下载已开始；有 ${failedImages.length} 张图片未写入。`;
      }
      return `Word 已生成，下载已开始；第 ${ordinals.join('、')} 题的 ` +
        `${failedImages.length} 张图片未写入。`;
    }

    function releaseDownloadUrl(url) {
      if (!activeDownloadUrls.has(url)) return;
      activeDownloadUrls.delete(url);
      try {
        revokeObjectURL(url);
      } catch (_error) {
        // Continue with the remaining page lifecycle cleanup.
      }
    }

    async function handleExport() {
      if (disposed || exporting || !currentPayload || !resolver) return;
      exporting = true;
      exportButton.disabled = true;
      exportButton.setAttribute('aria-busy', 'true');
      exportButton.textContent = '正在生成 Word…';
      liveStatus.textContent = '正在生成 Word…';
      let downloadUrl = null;
      try {
        const result = await exportQuestions(currentPayload, {
          resolveImage: (descriptor) => resolver.resolveForExport(descriptor)
        });
        if (!result || !result.blob || result.blob.type !== DOCX_MIME ||
            typeof result.filename !== 'string' ||
            !/^雨课堂题目-\d{8}-\d{4}\.docx$/.test(result.filename)) {
          fail('DOCX_RESULT_INVALID');
        }
        downloadUrl = createObjectURL(result.blob);
        if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith('blob:')) {
          fail('DOCX_RESULT_INVALID');
        }
        activeDownloadUrls.add(downloadUrl);
        const anchor = makeElement('a');
        anchor.href = downloadUrl;
        anchor.download = result.filename;
        anchor.hidden = true;
        documentValue.body.append(anchor);
        anchor.click();
        anchor.remove();
        liveStatus.textContent = exportStatus(result.failedImages);
        schedule(() => releaseDownloadUrl(downloadUrl), 1000);
        downloadUrl = null;
      } catch (_error) {
        if (downloadUrl !== null) releaseDownloadUrl(downloadUrl);
        liveStatus.textContent = 'Word 生成失败，请稍后重试。';
      } finally {
        exporting = false;
        if (!disposed) {
          exportButton.textContent = '再次导出 Word';
          exportButton.disabled = false;
          exportButton.removeAttribute('aria-busy');
        }
      }
    }

    exportButton.addEventListener('click', handleExport);

    async function start() {
      if (started || disposed) return;
      started = true;
      let sessionId;
      try {
        sessionId = parseSessionId(locationHref);
      } catch (_error) {
        showError();
        return;
      }
      currentSessionKey = modelApi.sessionKey(sessionId);
      let stored;
      try {
        stored = await storageSession.get(currentSessionKey);
      } catch (_error) {
        showError();
        return;
      }
      const envelope = stored && Object.prototype.hasOwnProperty.call(stored, currentSessionKey)
        ? stored[currentSessionKey]
        : null;
      if (envelope === null) {
        showError();
        return;
      }
      let validated;
      const currentTime = now();
      try {
        validated = modelApi.validateSessionEnvelope(envelope, currentTime);
      } catch (_error) {
        await safeRemoveSession(currentSessionKey);
        showError();
        return;
      }
      try {
        resolver = createImageResolver();
        if (!resolver || typeof resolver.resolveForDisplay !== 'function' ||
            typeof resolver.resolveForExport !== 'function' ||
            typeof resolver.dispose !== 'function') {
          fail('RESULTS_DEPENDENCY_MISSING');
        }
        currentPayload = validated.payload;
        renderPage(currentPayload);
      } catch (_error) {
        await safeRemoveSession(currentSessionKey);
        showError();
        return;
      }
      const remaining = validated.expiresAt - currentTime;
      schedule(async () => {
        await safeRemoveSession(currentSessionKey);
        if (!disposed) {
          if (resolver) resolver.dispose();
          resolver = null;
          currentPayload = null;
          showError();
        }
      }, Math.min(remaining, 0x7fffffff));
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      for (const timerId of timerIds) clearTimer(timerId);
      timerIds.clear();
      for (const url of [...activeDownloadUrls]) releaseDownloadUrl(url);
      if (observer && typeof observer.disconnect === 'function') observer.disconnect();
      observer = null;
      if (resolver) resolver.dispose();
      resolver = null;
      currentPayload = null;
      imageJobs.clear();
      if (unregisterPageHide) unregisterPageHide();
      unregisterPageHide = null;
    }

    unregisterPageHide = addPageHideListener(dispose);
    return Object.freeze({ start, dispose });
  }

  ns.resultsController = Object.freeze({ create });

  if (root.chrome && root.document) {
    const instance = create();
    const begin = () => {
      Promise.resolve(instance.start()).catch(() => undefined);
    };
    if (root.document.readyState === 'loading' && typeof root.addEventListener === 'function') {
      root.addEventListener('DOMContentLoaded', begin, { once: true });
    } else {
      begin();
    }
  }
})(globalThis);
