(function registerFontDecoder(root) {
  const ns = root.YktQuestionExporter;
  if (ns.fontDecoder) return;

  const limits = ns.limits;
  const urlPolicy = ns.urlPolicy;
  const CACHE_KEY = 'fontMappingCache';
  const CACHE_SCHEMA_VERSION = 1;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SHA256_PATTERN = /^[0-9a-f]{64}$/;
  const FONT_PATH_PATTERN = /\/(?:fe_font\/product\/)?(exam_font_[a-z0-9_-]+)\.(?:ttf|otf|woff2?|eot)$/i;
  const FONT_CSS_PATTERN = /url\(\s*["']?([^"')]*exam_font_[^"')]+\.(?:ttf|otf|woff2?|eot)(?:[?#][^"')]*)?)["']?\s*\)/i;
  const FONT_MIMES = new Set([
    'font/ttf',
    'font/otf',
    'font/woff',
    'font/woff2',
    'application/font-sfnt',
    'application/vnd.ms-fontobject',
    'application/x-font-ttf',
    'application/x-font-opentype',
    'application/x-font-woff'
  ]);
  const BUNDLED_NAME = 'exam_font_b0ff80437f6f4c24bf9b940e1e33c89e';
  const BUNDLED_PAIRS = '一科万序三命上少下而不持与胆专站且子世菌业功东辑两杆严直个除中磁临指为济主仿么板义隔之律乐没乙府也究习题书随买联乳满了液予么争军事古二由于裂互滑五够亚兴些思交费产历人障什钟介词从癌他右付他代多令令以特仪小们国件广价材任档份宫仿做企黑众灯优抽会室传克伤党估乙但仪位院低乳住英体足何疾余德作物你可使两例其供包依书侧腹便者促射保参信论修新借质债户值手假剂偏间做石停本健饮储善像余儿区元数充三先且光确克旋免范党志入想全肢公激共燃关业兴频其研具四养难内胞再排写货军践农毒冲技决基况同冷定准则减染凝营几强出据击尺函告分胃切汽划益列连则全创念初某判支利镜别政到应制限剂模前大力币办央功闭加宋务学动农助章劳旅势虫包油化答北缺区率医航十零升担半源华机协走单称南代卡酒卫短印台危互即绝历折压住原复去冲参快又平及至双人反肾发向取供受元变并叙创口语古精句底只求可监台食史起右各叶请号月司予各件合目同放名记后里向观否证含胸吸现告后员冷周页呼年命灭和送品认响比哪纳售配商失善势器术四因回极因胎团动围那固针国销图增圆网土维在对地依场期址控均织坏温块紧坚疗型力城价域打培己基急塞问填争境已增此士银声识处般备相复青外碱多左够习大推天湿太签央设失转头否女女好们如爱始破委列子脱孔句字脑存避学编它膜安空宋脉完先定核宜诊实整审例客括室让宫文害离家若容料密中富内察火对什导干封与射该将过小像少害尔叙就症尺门尿通局金层皮展何属服山作岁回工更左展差络己分已号巴封币规市顺布流师声带险常水干载平布年你并铁幼结广好床类序升库静应码底态府山度硬康装延纪建士开酶异误式前引径张素弹图强工当炎录票形白影矛往效征西径印很块律法得约循算微果德托心付必凝志卫快必念适态海思违急群性个总任息映患众情腺想肺意头感致慢改成就我些或报战采户受房美所导手养才域打示托播执瘤扩音批财承坚技优把楷投血抗象折健护宜报教抽天担半拉医择提括斗持略指差按防损产换叶据非排华接标控被推债措要描考提投播圆操痛支来收促改盘放近政触故严效再敏故救散教电散生数决整普文东斗清料波断五斯市新格方说施性旅岁旋合族危无填日扩早偏时置明继易北映位是骨显概普节景围曲式更速最轮月换有塞服础期断未征本存术库机交杂反权很杆脏李收材润束出条但来预板路极警构只析往果或某才染补查见标劳校得样别核单根孔格低案的档照检常楷越概双模脂次含款录止毛正这此措步房死于段资母器每买毒客比条毛神民容气息氧键氨安水边求培汽幼没份油景治片法化波气注易泽尿活审流解测理济肝浓准海面消远润救液环深商混及清终温写游组湿吸源程溶透滑储满正激入火种灭高灯稳炎外点族热线然甲照测燃康爱延片账牙知物富特充状额独真率立王口环游现二班风球描理到生取用款由企甲链申统电花男须画第界城留传略检疗软疫和疾微病重症字痛议瘤抗癌意白能的退皮责益敏监批盘介目密直日相母盾需看造真输眼名着为矛查知护短试石利码择研处破身础坏硬画确响碱属磁读示即社浓神场票减离积种蛋科循积构称看移义程专税况稳际究牙空拉突心立初站权章验端协符信第儿等轴筑境答无策在签述简侧算根管然米次类形粒溶精床糖一系早素巴索男紧委红了纤下约制级眼纪未纳进线以组将细部织训终轻经品结员给酸络接绝停统固继关续点维职综腔编获缩切缺临网言置体美杂群系老世考伤者税而判职道联发肌虑肝加肠阻股红肢估育领肺也肾最肿亚胃家胆异胎当胞许胸死能革脂史脉粒脏缩脑共脱首腔班腹光腺地膜等自曲至队致集航明般步船状良课色斯艺束节完花划若计英便范所药方获育菌段营司落保虑万虫层蛋错融情血公行使衡申补都表击被选裂负装附西是要用见事观细规务视开觉始角去解泽触样言肠警续计马认留让阶训每议弹记如许简论按设战证热评较识值诊阴词肌试融话艺该治语引误析说索请距读股课察调社象行负氨财着责压账假货筑质表购运费函资主走达起土超损越呼足良距衡路把践执身级车船转肿轮尔软具轴超轻影载售较移辑糖输慢边助达李过上运局近几还我这管进不远建违深连长述又退混送止适它选承透氧通盾速活造周道还避带那综部调都纤配变酒民酶病酸独采疫释备里实重车量施金会针南钟色铁型银给链界销阳错师键老镜哪长案门校闭黄问操间团队办防角阳张阴成阶太阻址附修际符降策限药院显除评险王随感隔卡障从难患雅原集觉零经需自青突静落非度面乐革米音购页释项雅顺消须均预降领球频借题时额有风之食端饮十首免马量验项骨总高注黄视黑话';
  let bundledMapMemo = null;

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

  function oneScalar(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2) return false;
    try {
      return Array.from(value).length === 1;
    } catch (_error) {
      return false;
    }
  }

  function cleanMap(value) {
    if (!dataRecord(value)) return null;
    const result = Object.create(null);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length === 0 || keys.length > 200000) return null;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!oneScalar(key) || !oneScalar(descriptor.value)) continue;
      result[key] = descriptor.value;
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  function bundledMap() {
    if (bundledMapMemo) return bundledMapMemo;
    const chars = Array.from(BUNDLED_PAIRS);
    const result = Object.create(null);
    for (let index = 0; index + 1 < chars.length; index += 2) {
      result[chars[index]] = chars[index + 1];
    }
    bundledMapMemo = Object.freeze(result);
    return bundledMapMemo;
  }

  function mapForName(name, injected) {
    if (dataRecord(injected) && own(injected, name)) {
      const map = cleanMap(injected[name]);
      if (map) return map;
    }
    return name === BUNDLED_NAME ? bundledMap() : null;
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  }

  function emptyCache() {
    return { schemaVersion: CACHE_SCHEMA_VERSION, entries: {} };
  }

  function pruneCache(cache, nowMs) {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !dataRecord(cache) ||
        cache.schemaVersion !== CACHE_SCHEMA_VERSION || !dataRecord(cache.entries)) {
      return emptyCache();
    }
    const retained = [];
    for (const sha of Object.keys(cache.entries)) {
      if (!SHA256_PATTERN.test(sha)) continue;
      const entry = cache.entries[sha];
      if (!dataRecord(entry)) continue;
      const createdAt = entry.createdAt;
      const lastUsedAt = entry.lastUsedAt;
      if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(lastUsedAt) ||
          createdAt < 0 || createdAt > nowMs || lastUsedAt < createdAt || lastUsedAt > nowMs ||
          nowMs - createdAt >= limits.FONT_CACHE_TTL_MS) {
        continue;
      }
      const map = cleanMap(entry.map);
      if (!map) continue;
      retained.push({ sha, map, createdAt, lastUsedAt });
    }
    retained.sort((left, right) =>
      right.lastUsedAt - left.lastUsedAt || (left.sha < right.sha ? -1 : left.sha > right.sha ? 1 : 0)
    );
    const result = emptyCache();
    for (const entry of retained.slice(0, limits.MAX_FONT_CACHE_ENTRIES)) {
      result.entries[entry.sha] = {
        map: entry.map,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt
      };
      if (utf8Bytes(result) > limits.MAX_FONT_CACHE_BYTES) delete result.entries[entry.sha];
    }
    return result;
  }

  function fontNameFromUrl(value) {
    try {
      const canonical = urlPolicy.normalizeRemoteUrl(value);
      const parsed = new URL(canonical);
      const match = FONT_PATH_PATTERN.exec(parsed.pathname);
      return match ? { canonical, name: match[1] } : null;
    } catch (_error) {
      return null;
    }
  }

  function detectFont(dependencies) {
    const candidates = [];
    try {
      const entries = dependencies.performance &&
        typeof dependencies.performance.getEntriesByType === 'function'
        ? dependencies.performance.getEntriesByType('resource')
        : [];
      for (const entry of Array.from(entries || [])) {
        if (entry && typeof entry.name === 'string') candidates.push(entry.name);
      }
    } catch (_error) {
      // Cross-origin or hostile performance entries are ignored.
    }
    try {
      for (const sheet of Array.from(dependencies.document.styleSheets || [])) {
        let rules;
        try {
          rules = Array.from(sheet.cssRules || []);
        } catch (_error) {
          continue;
        }
        for (const rule of rules) {
          const text = rule && typeof rule.cssText === 'string' ? rule.cssText : '';
          const match = FONT_CSS_PATTERN.exec(text);
          if (match) candidates.push(match[1]);
        }
      }
    } catch (_error) {
      // Stylesheet discovery is best effort and read-only.
    }
    for (const candidate of candidates) {
      let resolved = candidate;
      try {
        if (dependencies.document && typeof dependencies.document.baseURI === 'string') {
          resolved = new URL(candidate, dependencies.document.baseURI).href;
        }
      } catch (_error) {
        resolved = candidate;
      }
      const font = fontNameFromUrl(resolved);
      if (font) return font;
    }
    return null;
  }

  function runtimeMessage(chrome, message) {
    return new Promise((resolve) => {
      if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value || null);
      };
      try {
        const possible = chrome.runtime.sendMessage(message, finish);
        if (possible && typeof possible.then === 'function') possible.then(finish, () => finish(null));
      } catch (_error) {
        finish(null);
      }
    });
  }

  function storageCall(chrome, method, argument) {
    return new Promise((resolve) => {
      const area = chrome && chrome.storage && chrome.storage.local;
      if (!area || typeof area[method] !== 'function') {
        resolve(method === 'get' ? {} : undefined);
        return;
      }
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const possible = area[method](argument, finish);
        if (possible && typeof possible.then === 'function') possible.then(finish, () => finish(undefined));
      } catch (_error) {
        finish(method === 'get' ? {} : undefined);
      }
    });
  }

  async function readCache(dependencies) {
    const result = await storageCall(dependencies.chrome, 'get', [CACHE_KEY]);
    return pruneCache(result && result[CACHE_KEY], dependencies.now());
  }

  async function writeCache(dependencies, cache) {
    const pruned = pruneCache(cache, dependencies.now());
    if (utf8Bytes(pruned) > limits.MAX_FONT_CACHE_BYTES) return false;
    await storageCall(dependencies.chrome, 'set', { [CACHE_KEY]: pruned });
    return true;
  }

  function strictBase64(value, atobImpl) {
    if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      return null;
    }
    try {
      const binary = atobImpl(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        const code = binary.charCodeAt(index);
        if (code > 255) return null;
        bytes[index] = code;
      }
      return bytes;
    } catch (_error) {
      return null;
    }
  }

  function fontSignature(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return '';
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return 'sfnt';
    if (tag === 'OTTO') return 'otf';
    if (tag === 'wOFF') return 'woff';
    if (tag === 'wOF2') return 'woff2';
    if (bytes.byteLength >= 82 && bytes[34] === 0x4c && bytes[35] === 0x50) return 'eot';
    return '';
  }

  function responseBytes(response, dependencies) {
    if (!dataRecord(response) || response.ok !== true || typeof response.mime !== 'string' ||
        !FONT_MIMES.has(response.mime.toLowerCase()) ||
        !Number.isSafeInteger(response.byteLength) || response.byteLength <= 0 ||
        response.byteLength > limits.MAX_REMOTE_FONT_BYTES) {
      return null;
    }
    const bytes = strictBase64(response.base64, dependencies.atob);
    if (!bytes || bytes.byteLength !== response.byteLength || !fontSignature(bytes)) return null;
    return bytes;
  }

  async function digestHex(bytes, dependencies) {
    if (typeof dependencies.sha256 === 'function') {
      const supplied = await dependencies.sha256(bytes);
      return typeof supplied === 'string' && SHA256_PATTERN.test(supplied) ? supplied : null;
    }
    try {
      const digest = await dependencies.crypto.subtle.digest(
        'SHA-256',
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      );
      return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
    } catch (_error) {
      return null;
    }
  }

  function dataView(buffer) {
    try {
      if (!buffer || typeof buffer.byteLength !== 'number') return null;
      return new DataView(buffer);
    } catch (_error) {
      return null;
    }
  }

  function readTag(view, offset) {
    if (offset < 0 || offset + 4 > view.byteLength) return '';
    return String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
  }

  function parseFormat12(view, offset) {
    if (offset < 0 || offset + 16 > view.byteLength) return [];
    const declared = view.getUint32(offset + 4);
    const groupCount = view.getUint32(offset + 12);
    const endOffset = offset + declared;
    if (declared < 16 || endOffset > view.byteLength ||
        groupCount > Math.floor((declared - 16) / 12)) return [];
    const chars = [];
    for (let index = 0; index < groupCount; index += 1) {
      const group = offset + 16 + (index * 12);
      const start = Math.max(view.getUint32(group), 0x3400);
      const end = Math.min(view.getUint32(group + 4), 0x9fff);
      if (end < start) continue;
      for (let codePoint = start; codePoint <= end; codePoint += 1) {
        chars.push(String.fromCodePoint(codePoint));
      }
    }
    return chars;
  }

  function parseFormat4(view, offset) {
    if (offset < 0 || offset + 16 > view.byteLength) return [];
    const length = view.getUint16(offset + 2);
    const segCount = view.getUint16(offset + 6) / 2;
    if (!Number.isInteger(segCount) || segCount <= 0 || length < 16 ||
        offset + length > view.byteLength || segCount > Math.floor((length - 16) / 8) + 1) {
      return [];
    }
    const endCodeOffset = offset + 14;
    const startCodeOffset = endCodeOffset + (segCount * 2) + 2;
    const idDeltaOffset = startCodeOffset + (segCount * 2);
    const idRangeOffsetOffset = idDeltaOffset + (segCount * 2);
    if (idRangeOffsetOffset + (segCount * 2) > offset + length) return [];
    const chars = [];
    for (let index = 0; index < segCount; index += 1) {
      const rawEnd = view.getUint16(endCodeOffset + (index * 2));
      const rawStart = view.getUint16(startCodeOffset + (index * 2));
      const delta = view.getInt16(idDeltaOffset + (index * 2));
      const rangeOffset = view.getUint16(idRangeOffsetOffset + (index * 2));
      const start = Math.max(rawStart, 0x3400);
      const end = Math.min(rawEnd, 0x9fff);
      for (let codePoint = start; codePoint <= end && codePoint !== 0xffff; codePoint += 1) {
        let glyphId = 0;
        if (rangeOffset === 0) {
          glyphId = (codePoint + delta) & 0xffff;
        } else {
          const glyphOffset = idRangeOffsetOffset + (index * 2) + rangeOffset +
            ((codePoint - rawStart) * 2);
          if (glyphOffset >= offset && glyphOffset + 2 <= offset + length) {
            glyphId = view.getUint16(glyphOffset);
            if (glyphId !== 0) glyphId = (glyphId + delta) & 0xffff;
          }
        }
        if (glyphId !== 0) chars.push(String.fromCharCode(codePoint));
      }
    }
    return chars;
  }

  function parseCmapChars(buffer) {
    try {
      const view = dataView(buffer);
      if (!view || view.byteLength < 28 || view.getUint16(4) > 4096) return [];
      const tableCount = view.getUint16(4);
      if (12 + (tableCount * 16) > view.byteLength) return [];
      let cmapOffset = -1;
      for (let index = 0; index < tableCount; index += 1) {
        const record = 12 + (index * 16);
        if (readTag(view, record) === 'cmap') {
          cmapOffset = view.getUint32(record + 8);
          break;
        }
      }
      if (cmapOffset < 0 || cmapOffset + 4 > view.byteLength) return [];
      const subtableCount = view.getUint16(cmapOffset + 2);
      if (subtableCount > 4096 || cmapOffset + 4 + (subtableCount * 8) > view.byteLength) return [];
      const subtables = [];
      for (let index = 0; index < subtableCount; index += 1) {
        const record = cmapOffset + 4 + (index * 8);
        const offset = cmapOffset + view.getUint32(record + 4);
        if (offset + 2 > view.byteLength) continue;
        subtables.push({
          platform: view.getUint16(record),
          format: view.getUint16(offset),
          offset
        });
      }
      const selected = subtables.find((item) => item.format === 12 && item.platform === 3) ||
        subtables.find((item) => item.format === 4 && item.platform === 3) ||
        subtables.find((item) => item.format === 12) ||
        subtables.find((item) => item.format === 4);
      if (!selected) return [];
      const chars = selected.format === 12
        ? parseFormat12(view, selected.offset)
        : parseFormat4(view, selected.offset);
      return Array.from(new Set(chars)).sort((left, right) =>
        left.codePointAt(0) - right.codePointAt(0)
      );
    } catch (_error) {
      return [];
    }
  }

  function glyphVector(document, char, family, vectorSize) {
    try {
      const canvasSize = 128;
      const canvas = document.createElement('canvas');
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvasSize, canvasSize);
      context.fillStyle = '#000';
      context.font = `96px "${family}"`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(char, canvasSize / 2, canvasSize / 2);
      const pixels = context.getImageData(0, 0, canvasSize, canvasSize).data;
      let minX = canvasSize;
      let minY = canvasSize;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < canvasSize; y += 1) {
        for (let x = 0; x < canvasSize; x += 1) {
          const position = ((y * canvasSize) + x) * 4;
          const value = pixels[position] + pixels[position + 1] + pixels[position + 2];
          if (pixels[position + 3] > 0 && value < 735) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      if (maxX < minX || maxY < minY) return null;
      const normalized = document.createElement('canvas');
      normalized.width = vectorSize;
      normalized.height = vectorSize;
      const normalizedContext = normalized.getContext('2d', { willReadFrequently: true });
      if (!normalizedContext) return null;
      normalizedContext.fillStyle = '#fff';
      normalizedContext.fillRect(0, 0, vectorSize, vectorSize);
      normalizedContext.drawImage(
        canvas,
        minX,
        minY,
        maxX - minX + 1,
        maxY - minY + 1,
        0,
        0,
        vectorSize,
        vectorSize
      );
      const normalizedPixels = normalizedContext.getImageData(0, 0, vectorSize, vectorSize).data;
      const vector = new Uint8Array(vectorSize * vectorSize);
      for (let index = 0; index < vector.length; index += 1) {
        const position = index * 4;
        const value = normalizedPixels[position] +
          normalizedPixels[position + 1] +
          normalizedPixels[position + 2];
        vector[index] = value < 600 ? 1 : 0;
      }
      return vector;
    } catch (_error) {
      return null;
    }
  }

  function vectorHash(vector) {
    let hash = '';
    for (let index = 0; index < vector.length; index += 6) {
      let value = 0;
      for (let bit = 0; bit < 6 && index + bit < vector.length; bit += 1) {
        value = (value << 1) | vector[index + bit];
      }
      hash += value.toString(36).padStart(2, '0');
    }
    return hash;
  }

  function vectorDistance(left, right) {
    let distance = 0;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) distance += 1;
    }
    return distance;
  }

  async function loadFontFace(dependencies, family, source) {
    const Face = dependencies.FontFace;
    if (typeof Face !== 'function') return null;
    const face = new Face(family, source);
    await face.load();
    dependencies.document.fonts.add(face);
    await dependencies.document.fonts.ready;
    return family;
  }

  async function defaultGenerateMap(bytes, dependencies) {
    const chars = parseCmapChars(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (chars.length === 0 || chars.length > 2000) return null;
    const referenceUrl = dependencies.chrome && dependencies.chrome.runtime &&
      typeof dependencies.chrome.runtime.getURL === 'function'
      ? dependencies.chrome.runtime.getURL('assets/fonts/SourceHanSansSC-VF.ttf')
      : '';
    if (!referenceUrl) return null;
    const referenceFamily = 'YKTSourceHanSansSCVF';
    const encryptedFamily = `YKTEncryptedFont${dependencies.now()}`;
    if (!dependencies.document.fonts ||
        !dependencies.document.fonts.check(`16px "${referenceFamily}"`)) {
      if (!await loadFontFace(dependencies, referenceFamily, `url("${referenceUrl}")`)) return null;
    }
    if (!await loadFontFace(
      dependencies,
      encryptedFamily,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    )) return null;
    const refs = [];
    const byHash = new Map();
    for (const char of chars) {
      const vector = glyphVector(dependencies.document, char, referenceFamily, 24);
      if (!vector) continue;
      const item = { char, vector };
      refs.push(item);
      const hash = vectorHash(vector);
      byHash.set(hash, byHash.has(hash) ? null : item);
    }
    const map = Object.create(null);
    for (let index = 0; index < chars.length; index += 1) {
      if (index > 0 && index % 40 === 0) await Promise.resolve();
      const encrypted = chars[index];
      const query = glyphVector(dependencies.document, encrypted, encryptedFamily, 24);
      if (!query) continue;
      const exact = byHash.get(vectorHash(query));
      if (exact) {
        map[encrypted] = exact.char;
        continue;
      }
      let best = null;
      for (const reference of refs) {
        const distance = vectorDistance(query, reference.vector);
        if (!best || distance < best.distance) best = { char: reference.char, distance };
      }
      if (best) map[encrypted] = best.char;
    }
    const cleaned = cleanMap(map);
    if (!cleaned) return null;
    const entries = Object.entries(cleaned);
    const selfMapped = entries.filter(([key, value]) => key === value).length;
    return selfMapped / entries.length < 0.2 ? cleaned : null;
  }

  function applyMap(nodes, map) {
    let replaced = 0;
    let unresolved = 0;
    for (const node of nodes) {
      const source = typeof node.textContent === 'string' ? node.textContent : '';
      node.textContent = Array.from(source, (char) => {
        if (own(map, char)) {
          if (map[char] !== char) replaced += 1;
          return map[char];
        }
        const codePoint = char.codePointAt(0);
        if ((codePoint >= 0x3400 && codePoint <= 0x9fff) ||
            (codePoint >= 0xe000 && codePoint <= 0xf8ff)) {
          unresolved += 1;
        }
        return char;
      }).join('');
      if (node.classList && typeof node.classList.remove === 'function') {
        node.classList.remove('xuetangx-com-encrypted-font');
      }
      if (node.style && typeof node.style === 'object') node.style.fontFamily = '';
    }
    return { ok: true, required: true, replaced, unresolved };
  }

  function failed(required) {
    return { ok: false, required, code: 'FONT_FETCH_FAILED' };
  }

  function create(input) {
    const dependencies = input && typeof input === 'object' ? input : {};
    const normalized = {
      chrome: dependencies.chrome || root.chrome,
      document: dependencies.document || root.document,
      performance: dependencies.performance || root.performance,
      now: typeof dependencies.now === 'function' ? dependencies.now : Date.now,
      bundledMaps: dependencies.bundledMaps || null,
      sha256: dependencies.sha256,
      generateMap: dependencies.generateMap,
      crypto: dependencies.crypto || root.crypto,
      atob: typeof dependencies.atob === 'function' ? dependencies.atob : root.atob,
      FontFace: dependencies.FontFace || root.FontFace
    };

    async function decode(rootNode, options) {
      let nodes;
      try {
        nodes = rootNode && typeof rootNode.querySelectorAll === 'function'
          ? Array.from(rootNode.querySelectorAll('.xuetangx-com-encrypted-font'))
          : [];
      } catch (_error) {
        return failed(false);
      }
      if (nodes.length === 0) {
        return { ok: true, required: false, replaced: 0, unresolved: 0 };
      }
      const font = detectFont(normalized);
      if (!font) return failed(true);
      const localMap = mapForName(font.name, normalized.bundledMaps);
      if (localMap) return applyMap(nodes, localMap);
      const requestId = options && options.requestId;
      if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) return failed(true);
      const response = await runtimeMessage(normalized.chrome, {
        type: 'YKT_FONT_FETCH',
        requestId,
        url: font.canonical
      });
      const bytes = responseBytes(response, normalized);
      if (!bytes) return failed(true);
      const sha = await digestHex(bytes, normalized);
      if (!sha) return failed(true);
      const cache = await readCache(normalized);
      if (own(cache.entries, sha)) {
        cache.entries[sha].lastUsedAt = normalized.now();
        await writeCache(normalized, cache);
        return applyMap(nodes, cache.entries[sha].map);
      }
      let generated;
      try {
        generated = typeof normalized.generateMap === 'function'
          ? await normalized.generateMap(bytes, normalized)
          : await defaultGenerateMap(bytes, normalized);
      } catch (_error) {
        generated = null;
      }
      const map = cleanMap(generated);
      if (!map) return failed(true);
      const nowValue = normalized.now();
      if (!Number.isSafeInteger(nowValue) || nowValue < 0) return failed(true);
      cache.entries[sha] = {
        map,
        createdAt: nowValue,
        lastUsedAt: nowValue
      };
      await writeCache(normalized, cache);
      return applyMap(nodes, map);
    }

    return Object.freeze({ decode });
  }

  ns.fontDecoder = Object.freeze({ create, parseCmapChars, pruneCache });
})(globalThis);
