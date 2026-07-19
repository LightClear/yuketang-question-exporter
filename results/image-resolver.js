(function registerImageResolver(root) {
  const ns = root.YktQuestionExporter;
  if (ns.imageResolver) return;

  const limits = ns.limits;
  const urlPolicy = ns.urlPolicy;
  const DESCRIPTOR_KEYS = Object.freeze(['id', 'kind', 'src', 'alt', 'decorative']);
  const IMAGE_ID = /^q-[1-9][0-9]{0,5}-img-[1-9][0-9]{0,5}$/;
  const DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/;
  const RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  const EXPORT_MAX_EDGE = 1600;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function lowerLimit(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 && value < fallback ? value : fallback;
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

  function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  function dataKeys(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      fail('IMAGE_DESCRIPTOR_INVALID');
    }
    let keys;
    try {
      keys = Reflect.ownKeys(value);
      for (const key of keys) {
        if (typeof key !== 'string') fail('IMAGE_DESCRIPTOR_INVALID');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          fail('IMAGE_DESCRIPTOR_INVALID');
        }
      }
    } catch (error) {
      if (error && error.code) throw error;
      fail('IMAGE_DESCRIPTOR_INVALID');
    }
    return keys;
  }

  function dataValue(value, key) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_error) {
      fail('IMAGE_DESCRIPTOR_INVALID');
    }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      fail('IMAGE_DESCRIPTOR_INVALID');
    }
    return descriptor.value;
  }

  function asciiAt(bytes, offset, text) {
    if (bytes.byteLength < offset + text.length) return false;
    for (let index = 0; index < text.length; index += 1) {
      if (bytes[offset + index] !== text.charCodeAt(index)) return false;
    }
    return true;
  }

  function detectedMime(bytes) {
    if (bytes.byteLength >= 8 && bytes[0] === 0x89 && asciiAt(bytes, 1, 'PNG') &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
      return 'image/png';
    }
    if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes.byteLength >= 6 && (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a'))) {
      return 'image/gif';
    }
    if (bytes.byteLength >= 12 && asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) {
      return 'image/webp';
    }
    return null;
  }

  function requireSignature(bytes, mime) {
    if (detectedMime(bytes) !== mime) fail('IMAGE_SIGNATURE_INVALID');
  }

  function decodeDataSource(source, atobValue) {
    const match = DATA_IMAGE.exec(source);
    if (!match) fail('IMAGE_DESCRIPTOR_INVALID');
    const mime = match[1];
    const encoded = match[2];
    if (encoded.length === 0 || encoded.length % 4 !== 0) fail('IMAGE_DESCRIPTOR_INVALID');
    const maximumEncoded = Math.ceil(limits.MAX_INLINE_IMAGE_BYTES / 3) * 4;
    if (encoded.length > maximumEncoded) fail('IMAGE_LIMIT_EXCEEDED');
    const firstPadding = encoded.indexOf('=');
    if (firstPadding >= 0 && firstPadding < encoded.length - 2) fail('IMAGE_DESCRIPTOR_INVALID');
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    const decodedLength = (encoded.length / 4 * 3) - padding;
    if (decodedLength > limits.MAX_INLINE_IMAGE_BYTES) fail('IMAGE_LIMIT_EXCEEDED');
    let binary;
    try {
      binary = atobValue(encoded);
    } catch (_error) {
      fail('IMAGE_DESCRIPTOR_INVALID');
    }
    if (typeof binary !== 'string' || binary.length !== decodedLength) {
      fail('IMAGE_DESCRIPTOR_INVALID');
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      const code = binary.charCodeAt(index);
      if (code > 0xff) fail('IMAGE_DESCRIPTOR_INVALID');
      bytes[index] = code;
    }
    requireSignature(bytes, mime);
    return { mime, bytes };
  }

  function validateDescriptor(value, atobValue) {
    const keys = dataKeys(value);
    if (keys.length !== DESCRIPTOR_KEYS.length ||
        DESCRIPTOR_KEYS.some((key) => !keys.includes(key))) {
      fail('IMAGE_DESCRIPTOR_INVALID');
    }
    const id = dataValue(value, 'id');
    const kind = dataValue(value, 'kind');
    const source = dataValue(value, 'src');
    const alt = dataValue(value, 'alt');
    const decorative = dataValue(value, 'decorative');
    if (typeof id !== 'string' || !IMAGE_ID.test(id) ||
        (kind !== 'remote' && kind !== 'data') ||
        typeof source !== 'string' || typeof alt !== 'string' ||
        typeof decorative !== 'boolean' || hasForbiddenControl(source) ||
        hasForbiddenControl(alt) || byteLength(alt) > limits.MAX_QUESTION_BYTES ||
        (decorative ? alt !== '' : alt.trim().length === 0)) {
      fail('IMAGE_DESCRIPTOR_INVALID');
    }
    if (kind === 'remote') {
      if (source.length === 0 || byteLength(source) > limits.MAX_QUESTION_BYTES) {
        fail('IMAGE_DESCRIPTOR_INVALID');
      }
      let canonicalSource;
      try {
        canonicalSource = urlPolicy.normalizeRemoteUrl(source);
      } catch (_error) {
        fail('IMAGE_URL_NOT_ALLOWED');
      }
      return {
        descriptor: { id, kind, src: canonicalSource, alt, decorative },
        inline: null
      };
    }
    const inline = decodeDataSource(source, atobValue);
    return {
      descriptor: { id, kind, src: source, alt, decorative },
      inline
    };
  }

  function fingerprint(descriptor) {
    return [
      descriptor.kind,
      descriptor.src,
      descriptor.alt,
      descriptor.decorative ? '1' : '0'
    ].join('\u0000');
  }

  function createSemaphore(maximum) {
    let active = 0;
    const waiting = [];
    async function run(task) {
      if (active >= maximum) {
        await new Promise((resolve) => waiting.push(resolve));
      }
      active += 1;
      try {
        return await task();
      } finally {
        active -= 1;
        const next = waiting.shift();
        if (next) next();
      }
    }
    return Object.freeze({ run });
  }

  function create(dependencies) {
    const input = dependencies || {};
    const fetchValue = input.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    const createBitmap = input.createImageBitmap ||
      (typeof root.createImageBitmap === 'function' ? root.createImageBitmap.bind(root) : null);
    const createCanvas = input.createCanvas || ((width, height) => {
      const canvas = root.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    });
    const createObjectURL = input.createObjectURL ||
      ((blob) => root.URL.createObjectURL(blob));
    const revokeObjectURL = input.revokeObjectURL ||
      ((url) => root.URL.revokeObjectURL(url));
    const BlobValue = input.Blob || root.Blob;
    const AbortControllerValue = input.AbortController || root.AbortController;
    const atobValue = input.atob || root.atob;
    const setTimer = input.setTimeout || root.setTimeout;
    const clearTimer = input.clearTimeout || root.clearTimeout;
    if (typeof fetchValue !== 'function' || typeof createBitmap !== 'function' ||
        typeof createCanvas !== 'function' || typeof createObjectURL !== 'function' ||
        typeof revokeObjectURL !== 'function' || typeof BlobValue !== 'function' ||
        typeof AbortControllerValue !== 'function' || typeof atobValue !== 'function' ||
        typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
      fail('IMAGE_DEPENDENCY_MISSING');
    }

    const maxRemoteBytes = lowerLimit(input.maxRemoteImageBytes, limits.MAX_REMOTE_IMAGE_BYTES);
    const maxRemoteTotal = lowerLimit(
      input.maxRemoteImageTotalBytes,
      limits.MAX_REMOTE_IMAGE_TOTAL_BYTES
    );
    const maxImageEdge = lowerLimit(input.maxImageEdge, limits.MAX_IMAGE_EDGE);
    const maxImagePixels = lowerLimit(input.maxImagePixels, limits.MAX_IMAGE_PIXELS);
    const concurrency = lowerLimit(input.imageConcurrency, limits.IMAGE_CONCURRENCY);
    const semaphore = createSemaphore(concurrency);
    const cache = new Map();
    const controllers = new Set();
    let disposed = false;
    let committedRemoteBytes = 0;
    let reservedRemoteBytes = 0;
    let committedInlineBytes = 0;

    function requireActive() {
      if (disposed) fail('IMAGE_DISPOSED');
    }

    function reserveRemote(amount) {
      if (!Number.isSafeInteger(amount) || amount < 0 ||
          committedRemoteBytes + reservedRemoteBytes + amount > maxRemoteTotal) {
        fail('IMAGE_LIMIT_EXCEEDED');
      }
      reservedRemoteBytes += amount;
    }

    async function cancelResponse(response) {
      try {
        if (response && response.body && typeof response.body.getReader === 'function') {
          const reader = response.body.getReader();
          if (reader && typeof reader.cancel === 'function') await reader.cancel();
        }
      } catch (_error) {
        // Cancellation is best-effort; the stable caller-facing error is preserved.
      }
    }

    function responseMime(response) {
      if (!response || !response.headers || typeof response.headers.get !== 'function') {
        fail('IMAGE_FETCH_FAILED');
      }
      const raw = response.headers.get('content-type');
      const mime = typeof raw === 'string' ? raw.split(';', 1)[0].trim().toLowerCase() : '';
      if (!RASTER_MIMES.has(mime)) fail('IMAGE_MIME_INVALID');
      return mime;
    }

    async function fetchRemote(source) {
      return semaphore.run(async () => {
        requireActive();
        const controller = new AbortControllerValue();
        controllers.add(controller);
        const timer = setTimer(() => controller.abort(), limits.RESOURCE_TIMEOUT_MS);
        let response;
        try {
          response = await fetchValue(source, {
            method: 'GET',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            redirect: 'error',
            signal: controller.signal
          });
        } catch (error) {
          if (error && error.code) throw error;
          fail('IMAGE_FETCH_FAILED');
        } finally {
          clearTimer(timer);
          controllers.delete(controller);
        }
        if (!response || response.redirected) {
          await cancelResponse(response);
          fail('IMAGE_REDIRECTED');
        }
        if (!response.ok) {
          await cancelResponse(response);
          fail('IMAGE_FETCH_FAILED');
        }
        let mime;
        try {
          mime = responseMime(response);
        } catch (error) {
          await cancelResponse(response);
          throw error;
        }
        const rawLength = response.headers.get('content-length');
        let declaredLength = null;
        if (rawLength !== null) {
          if (!/^(?:0|[1-9][0-9]*)$/.test(rawLength)) {
            await cancelResponse(response);
            fail('IMAGE_FETCH_FAILED');
          }
          declaredLength = Number(rawLength);
          if (!Number.isSafeInteger(declaredLength) || declaredLength > maxRemoteBytes) {
            await cancelResponse(response);
            fail('IMAGE_LIMIT_EXCEEDED');
          }
        }
        if (!response.body || typeof response.body.getReader !== 'function') {
          fail('IMAGE_FETCH_FAILED');
        }

        let reservation = 0;
        let downloaded = 0;
        let reader;
        const chunks = [];
        try {
          if (declaredLength !== null) {
            reserveRemote(declaredLength);
            reservation = declaredLength;
          }
          reader = response.body.getReader();
          if (!reader || typeof reader.read !== 'function') fail('IMAGE_FETCH_FAILED');
          while (true) {
            const part = await reader.read();
            if (!part || part.done) break;
            const value = part.value;
            if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1) {
              fail('IMAGE_FETCH_FAILED');
            }
            const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            downloaded += view.byteLength;
            if (!Number.isSafeInteger(downloaded) || downloaded > maxRemoteBytes) {
              fail('IMAGE_LIMIT_EXCEEDED');
            }
            if (downloaded > reservation) {
              const difference = downloaded - reservation;
              reserveRemote(difference);
              reservation += difference;
            }
            chunks.push(new Uint8Array(view));
          }
          const bytes = new Uint8Array(downloaded);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          requireSignature(bytes, mime);
          return { mime, bytes };
        } catch (error) {
          if (reader && typeof reader.cancel === 'function') {
            try {
              await reader.cancel();
            } catch (_cancelError) {
              // Preserve the validation or network error that triggered cancellation.
            }
          } else {
            await cancelResponse(response);
          }
          if (error && error.code) throw error;
          fail('IMAGE_FETCH_FAILED');
        } finally {
          reservedRemoteBytes -= reservation;
          committedRemoteBytes += downloaded;
        }
      });
    }

    function closeBitmap(resource) {
      if (!resource || resource.closed) return;
      resource.closed = true;
      if (resource.bitmap && typeof resource.bitmap.close === 'function') {
        try {
          resource.bitmap.close();
        } catch (_error) {
          // A close failure must not leave other resources undisposed.
        }
      }
    }

    async function decodeResource(validated) {
      requireActive();
      let loaded;
      if (validated.inline) {
        if (committedInlineBytes + validated.inline.bytes.byteLength >
            limits.MAX_INLINE_IMAGE_TOTAL_BYTES) {
          fail('IMAGE_LIMIT_EXCEEDED');
        }
        committedInlineBytes += validated.inline.bytes.byteLength;
        loaded = validated.inline;
      } else {
        loaded = await fetchRemote(validated.descriptor.src);
      }
      requireActive();
      const blob = new BlobValue([loaded.bytes], { type: loaded.mime });
      let decoded;
      try {
        decoded = await createBitmap(blob);
      } catch (_error) {
        fail('IMAGE_DECODE_FAILED');
      }
      const width = decoded && decoded.width;
      const height = decoded && decoded.height;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
          width <= 0 || height <= 0) {
        if (decoded && typeof decoded.close === 'function') decoded.close();
        fail('IMAGE_DECODE_FAILED');
      }
      if (width > maxImageEdge || height > maxImageEdge ||
          width * height > maxImagePixels) {
        if (typeof decoded.close === 'function') decoded.close();
        fail('IMAGE_LIMIT_EXCEEDED');
      }
      if (disposed) {
        if (typeof decoded.close === 'function') decoded.close();
        fail('IMAGE_DISPOSED');
      }
      return {
        descriptor: validated.descriptor,
        mime: loaded.mime,
        bytes: loaded.bytes,
        blob,
        bitmap: decoded,
        width,
        height,
        displayUrl: null,
        exportPromise: null,
        closed: false
      };
    }

    function getResource(value) {
      requireActive();
      const validated = validateDescriptor(value, atobValue);
      const key = validated.descriptor.id;
      const identity = fingerprint(validated.descriptor);
      const existing = cache.get(key);
      if (existing) {
        if (existing.identity !== identity) fail('IMAGE_DESCRIPTOR_INVALID');
        return existing.promise;
      }
      const entry = { identity, promise: null, resource: null };
      entry.promise = decodeResource(validated).then((resource) => {
        entry.resource = resource;
        if (disposed) closeBitmap(resource);
        return resource;
      });
      cache.set(key, entry);
      return entry.promise;
    }

    async function resolveForDisplay(descriptor) {
      const resource = await getResource(descriptor);
      requireActive();
      if (resource.displayUrl === null) {
        try {
          resource.displayUrl = createObjectURL(resource.blob);
        } catch (_error) {
          fail('IMAGE_OBJECT_URL_FAILED');
        }
        if (typeof resource.displayUrl !== 'string' || resource.displayUrl.length === 0) {
          resource.displayUrl = null;
          fail('IMAGE_OBJECT_URL_FAILED');
        }
      }
      return {
        objectUrl: resource.displayUrl,
        width: resource.width,
        height: resource.height,
        alt: resource.descriptor.alt
      };
    }

    function canvasPng(canvas) {
      return new Promise((resolve, reject) => {
        try {
          canvas.toBlob((blob) => {
            if (!blob || blob.type !== 'image/png' || typeof blob.arrayBuffer !== 'function') {
              const error = new Error('IMAGE_EXPORT_FAILED');
              error.code = 'IMAGE_EXPORT_FAILED';
              reject(error);
              return;
            }
            resolve(blob);
          }, 'image/png');
        } catch (_error) {
          const error = new Error('IMAGE_EXPORT_FAILED');
          error.code = 'IMAGE_EXPORT_FAILED';
          reject(error);
        }
      });
    }

    async function exportResource(resource) {
      const scale = Math.min(1, EXPORT_MAX_EDGE / Math.max(resource.width, resource.height));
      const width = Math.max(1, Math.round(resource.width * scale));
      const height = Math.max(1, Math.round(resource.height * scale));
      let canvas;
      try {
        canvas = createCanvas(width, height);
        const context = canvas && typeof canvas.getContext === 'function'
          ? canvas.getContext('2d')
          : null;
        if (!context || typeof context.drawImage !== 'function' ||
            typeof canvas.toBlob !== 'function') {
          fail('IMAGE_EXPORT_FAILED');
        }
        context.drawImage(resource.bitmap, 0, 0, width, height);
      } catch (error) {
        if (error && error.code) throw error;
        fail('IMAGE_EXPORT_FAILED');
      }
      const blob = await canvasPng(canvas);
      let bytes;
      try {
        bytes = new Uint8Array(await blob.arrayBuffer());
      } catch (_error) {
        fail('IMAGE_EXPORT_FAILED');
      }
      try {
        requireSignature(bytes, 'image/png');
      } catch (_error) {
        fail('IMAGE_EXPORT_FAILED');
      }
      return { pngBytes: bytes, width, height, alt: resource.descriptor.alt };
    }

    async function resolveForExport(descriptor) {
      const resource = await getResource(descriptor);
      requireActive();
      if (resource.exportPromise === null) resource.exportPromise = exportResource(resource);
      const result = await resource.exportPromise;
      requireActive();
      return {
        pngBytes: new Uint8Array(result.pngBytes),
        width: result.width,
        height: result.height,
        alt: result.alt
      };
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of controllers) {
        try {
          controller.abort();
        } catch (_error) {
          // Continue cleaning up the remaining resources.
        }
      }
      controllers.clear();
      for (const entry of cache.values()) {
        const resource = entry.resource;
        if (!resource) continue;
        if (resource.displayUrl !== null) {
          try {
            revokeObjectURL(resource.displayUrl);
          } catch (_error) {
            // Continue cleaning up the bitmap.
          }
          resource.displayUrl = null;
        }
        closeBitmap(resource);
      }
    }

    return Object.freeze({ resolveForDisplay, resolveForExport, dispose });
  }

  ns.imageResolver = Object.freeze({ create });
})(globalThis);
