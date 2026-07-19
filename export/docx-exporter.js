(function registerDocxExporter(root) {
  const ns = root.YktQuestionExporter;
  if (ns.docxExporter) return;

  const modelApi = ns.model;
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const EMU_PER_PIXEL = 9525;
  const MAX_EXPORT_EDGE = 1600;
  const BLOCK_TAGS = new Set(['p', 'ul', 'ol', 'blockquote', 'pre', 'table', 'hr']);

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function normalizedXmlText(value) {
    let output = '';
    for (const character of String(value ?? '')) {
      const point = character.codePointAt(0);
      if (point === 0x09 || point === 0x0a || point === 0x0d ||
          (point >= 0x20 && point <= 0xd7ff) ||
          (point >= 0xe000 && point <= 0xfffd) ||
          (point >= 0x10000 && point <= 0x10ffff)) {
        output += character;
      } else {
        output += '\ufffd';
      }
    }
    return output;
  }

  function escapeXml(value) {
    return normalizedXmlText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(String(value));
  }

  function mergeStyle(style, addition) {
    return Object.assign({}, style || {}, addition);
  }

  function textRunXml(text, style = {}) {
    const properties = [];
    if (style.bold) properties.push('<w:b/>');
    if (style.italic) properties.push('<w:i/>');
    if (style.underline) properties.push('<w:u w:val="single"/>');
    if (style.strike) properties.push('<w:strike/>');
    if (style.vertAlign) {
      properties.push(`<w:vertAlign w:val="${style.vertAlign}"/>`);
    }
    if (style.font) {
      const font = escapeXml(style.font);
      properties.push(`<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/>`);
    }
    if (style.size) properties.push(`<w:sz w:val="${style.size}"/>`);
    if (style.color) properties.push(`<w:color w:val="${style.color}"/>`);
    if (style.shade) properties.push(`<w:shd w:val="clear" w:fill="${style.shade}"/>`);
    const runProperties = properties.length > 0 ? `<w:rPr>${properties.join('')}</w:rPr>` : '';
    return `<w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  }

  function imageRunXml(image, drawingId) {
    const width = Number.isSafeInteger(image.width) && image.width > 0 ? image.width : 1;
    const height = Number.isSafeInteger(image.height) && image.height > 0 ? image.height : 1;
    const cx = Math.round(width * EMU_PER_PIXEL);
    const cy = Math.round(height * EMU_PER_PIXEL);
    const name = escapeXml(image.fileName || `image${drawingId}.png`);
    const description = escapeXml(image.alt || '');
    const relation = escapeXml(image.relId || '');
    const drawing =
      `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${cx}" cy="${cy}"/>` +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      `<wp:docPr id="${drawingId}" name="${name}" descr="${description}"/>` +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr>' +
      `<pic:cNvPr id="${drawingId}" name="${name}" descr="${description}"/>` +
      '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>' +
      `<a:blip r:embed="${relation}"/>` +
      '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr>' +
      `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
    return `<w:r>${drawing}</w:r>`;
  }

  function paragraphXml(runs, options = {}) {
    const properties = [];
    if (options.style) properties.push(`<w:pStyle w:val="${escapeXml(options.style)}"/>`);
    if (options.center) properties.push('<w:jc w:val="center"/>');
    if (options.pageBreakBefore) properties.push('<w:pageBreakBefore/>');
    if (options.keepNext) properties.push('<w:keepNext/>');
    if (Number.isSafeInteger(options.indent) && options.indent > 0) {
      properties.push(`<w:ind w:left="${options.indent}"/>`);
    }
    if (options.shade) {
      properties.push(`<w:shd w:val="clear" w:fill="${options.shade}"/>`);
    }
    if (options.bottomBorder) {
      properties.push(
        '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="DCE3EC"/></w:pBdr>'
      );
    }
    if (options.spacing) {
      const before = Number.isSafeInteger(options.spacing.before) ? options.spacing.before : 0;
      const after = Number.isSafeInteger(options.spacing.after) ? options.spacing.after : 0;
      properties.push(`<w:spacing w:before="${before}" w:after="${after}"/>`);
    }
    const paragraphProperties = properties.length > 0
      ? `<w:pPr>${properties.join('')}</w:pPr>`
      : '';
    return `<w:p>${paragraphProperties}${runs.join('')}</w:p>`;
  }

  function textParagraph(text, style = {}, paragraphOptions = {}) {
    return paragraphXml([textRunXml(text, style)], paragraphOptions);
  }

  function imageEntry(context, imageId) {
    return context.imageMap.get(imageId) || null;
  }

  function mathText(context, mathId) {
    const descriptor = context.mathMap.get(mathId);
    if (!descriptor) return '';
    return descriptor.fallbackText.trim().length > 0 ? descriptor.fallbackText : descriptor.tex;
  }

  function renderInlineNode(node, context, style = {}) {
    if (node.type === 'text') return textRunXml(node.value, style);
    if (node.type === 'image') {
      const entry = imageEntry(context, node.imageId);
      if (entry && entry.part) {
        context.drawingCounter.value += 1;
        return imageRunXml(entry.part, context.drawingCounter.value);
      }
      const alt = entry && entry.descriptor.alt ? `：${entry.descriptor.alt}` : '';
      return textRunXml(`[图片未导出${alt}]`, mergeStyle(style, {
        italic: true,
        color: '9A5A00'
      }));
    }
    if (node.type === 'math') {
      return textRunXml(mathText(context, node.mathId), mergeStyle(style, {
        font: 'Cambria Math'
      }));
    }
    if (node.type !== 'element') return '';
    if (node.tag === 'br') return '<w:r><w:br/></w:r>';
    let childStyle = style;
    if (node.tag === 'strong' || node.tag === 'b') childStyle = mergeStyle(style, { bold: true });
    else if (node.tag === 'em' || node.tag === 'i') childStyle = mergeStyle(style, { italic: true });
    else if (node.tag === 'u') childStyle = mergeStyle(style, { underline: true });
    else if (node.tag === 's') childStyle = mergeStyle(style, { strike: true });
    else if (node.tag === 'sub') childStyle = mergeStyle(style, { vertAlign: 'subscript' });
    else if (node.tag === 'sup') childStyle = mergeStyle(style, { vertAlign: 'superscript' });
    else if (node.tag === 'code') childStyle = mergeStyle(style, { font: 'Consolas', shade: 'F1F5F9' });
    return node.children.map((child) => renderInlineNode(child, context, childStyle)).join('');
  }

  function collectPlainText(nodes, context) {
    const output = [];
    const stack = nodes.slice().reverse();
    while (stack.length > 0) {
      const node = stack.pop();
      if (node.type === 'text') output.push(node.value);
      else if (node.type === 'math') output.push(mathText(context, node.mathId));
      else if (node.type === 'image') {
        const entry = imageEntry(context, node.imageId);
        if (entry && entry.descriptor.alt) output.push(`[${entry.descriptor.alt}]`);
      } else if (node.type === 'element') {
        if (node.tag === 'br') {
          output.push('\n');
        } else {
          for (let index = node.children.length - 1; index >= 0; index -= 1) {
            stack.push(node.children[index]);
          }
        }
      }
    }
    return output.join('');
  }

  function tableRows(table) {
    const rows = [];
    for (const child of table.children) {
      if (child.type !== 'element') continue;
      if (child.tag === 'tr') rows.push(child);
      else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
        for (const row of child.children) {
          if (row.type === 'element' && row.tag === 'tr') rows.push(row);
        }
      }
    }
    return rows;
  }

  function renderTable(table, context) {
    const rows = tableRows(table).map((row) => {
      const cells = row.children
        .filter((cell) => cell.type === 'element' && (cell.tag === 'td' || cell.tag === 'th'))
        .map((cell) => {
          const cellProperties = ['<w:tcW w:w="0" w:type="auto"/>'];
          if (cell.attrs.colspan) {
            cellProperties.push(`<w:gridSpan w:val="${cell.attrs.colspan}"/>`);
          }
          const content = renderBlocks(cell.children, context, {
            defaultStyle: cell.tag === 'th' ? { bold: true } : {}
          });
          return `<w:tc><w:tcPr>${cellProperties.join('')}</w:tcPr>` +
            `${content.length > 0 ? content.join('') : '<w:p/>'}</w:tc>`;
        })
        .join('');
      return `<w:tr>${cells}</w:tr>`;
    }).join('');
    const borders =
      '<w:tblBorders>' +
      '<w:top w:val="single" w:sz="4" w:color="DCE3EC"/>' +
      '<w:left w:val="single" w:sz="4" w:color="DCE3EC"/>' +
      '<w:bottom w:val="single" w:sz="4" w:color="DCE3EC"/>' +
      '<w:right w:val="single" w:sz="4" w:color="DCE3EC"/>' +
      '<w:insideH w:val="single" w:sz="4" w:color="DCE3EC"/>' +
      '<w:insideV w:val="single" w:sz="4" w:color="DCE3EC"/>' +
      '</w:tblBorders>';
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>${rows}</w:tbl>`;
  }

  function renderList(list, context, depth) {
    const output = [];
    let ordinal = 0;
    for (const item of list.children) {
      if (item.type !== 'element' || item.tag !== 'li') continue;
      ordinal += 1;
      const nested = [];
      const content = [];
      for (const child of item.children) {
        if (child.type === 'element' && (child.tag === 'ul' || child.tag === 'ol')) nested.push(child);
        else content.push(child);
      }
      const prefix = list.tag === 'ol' ? `${ordinal}. ` : '• ';
      output.push(...renderBlocks(content, context, {
        prefixText: prefix,
        paragraphOptions: { indent: 720 + (depth * 360) }
      }));
      for (const child of nested) output.push(...renderList(child, context, depth + 1));
    }
    return output;
  }

  function renderBlocks(nodes, context, options = {}) {
    const output = [];
    const defaultStyle = options.defaultStyle || {};
    let pending = options.prefixText
      ? [textRunXml(options.prefixText, mergeStyle(defaultStyle, { bold: true }))]
      : [];

    function flush() {
      if (pending.length === 0) return;
      output.push(paragraphXml(pending, options.paragraphOptions || {}));
      pending = [];
    }

    for (const node of nodes) {
      if (node.type === 'element' && BLOCK_TAGS.has(node.tag)) {
        if (node.tag === 'p') {
          const runs = node.children.map((child) =>
            renderInlineNode(child, context, defaultStyle)
          );
          if (pending.length > 0) runs.unshift(...pending.splice(0));
          output.push(paragraphXml(runs, options.paragraphOptions || {}));
          continue;
        }
        flush();
        if (node.tag === 'ul' || node.tag === 'ol') {
          output.push(...renderList(node, context, 0));
        } else if (node.tag === 'blockquote') {
          output.push(...renderBlocks(node.children, context, {
            paragraphOptions: { indent: 720 }
          }));
        } else if (node.tag === 'pre') {
          const lines = collectPlainText(node.children, context).split(/\r?\n/);
          for (const line of lines) {
            output.push(textParagraph(line, { font: 'Consolas' }, {
              shade: 'F1F5F9',
              spacing: { before: 20, after: 20 }
            }));
          }
        } else if (node.tag === 'table') {
          output.push(renderTable(node, context));
        } else if (node.tag === 'hr') {
          output.push(paragraphXml([], { bottomBorder: true }));
        }
        continue;
      }
      pending.push(renderInlineNode(node, context, defaultStyle));
    }
    flush();
    return output;
  }

  function questionContext(question, resources, drawingCounter) {
    return {
      imageMap: resources.imageMap,
      mathMap: new Map(question.math.map((descriptor) => [descriptor.id, descriptor])),
      drawingCounter
    };
  }

  function buildQuestionsSection(questions, resources, drawingCounter) {
    const paragraphs = [
      textParagraph('一、题目', { bold: true, size: 32 }, {
        center: true,
        keepNext: true,
        spacing: { after: 240 }
      })
    ];
    for (const question of questions) {
      const context = questionContext(question, resources, drawingCounter);
      paragraphs.push(textParagraph(`${question.ordinal}. [${question.metaText}]`, {
        bold: true,
        color: '172033'
      }, {
        keepNext: true,
        spacing: { before: 200, after: 100 }
      }));
      paragraphs.push(...renderBlocks(question.body, context));
      for (const option of question.options) {
        paragraphs.push(...renderBlocks(option.content, context, {
          prefixText: option.label ? `${option.label}. ` : ''
        }));
      }
    }
    return paragraphs;
  }

  function buildAnswersSection(questions, resources, drawingCounter) {
    const answerQuestions = questions.filter((question) =>
      question.correctAnswer || question.explanation
    );
    if (answerQuestions.length === 0) return [];
    const paragraphs = [
      textParagraph('二、答案', { bold: true, size: 32 }, {
        center: true,
        pageBreakBefore: true,
        keepNext: true,
        spacing: { after: 240 }
      })
    ];
    for (const question of answerQuestions) {
      const context = questionContext(question, resources, drawingCounter);
      paragraphs.push(textParagraph(`${question.ordinal}. [${question.metaText}]`, {
        bold: true
      }, {
        keepNext: true,
        spacing: { before: 160, after: 80 }
      }));
      if (question.correctAnswer) {
        paragraphs.push(textParagraph('答案：', { bold: true, color: '157A6E' }, {
          keepNext: true,
          spacing: { before: 80, after: 40 }
        }));
        paragraphs.push(...renderBlocks(question.correctAnswer, context));
      }
      if (question.explanation) {
        paragraphs.push(textParagraph('解析：', { bold: true }, {
          keepNext: true,
          spacing: { before: 80, after: 40 }
        }));
        paragraphs.push(...renderBlocks(question.explanation, context));
      }
    }
    return paragraphs;
  }

  function buildDocumentXml(questions, resources = { imageMap: new Map() }) {
    const drawingCounter = { value: 0 };
    const content = [
      ...buildQuestionsSection(questions, resources, drawingCounter),
      ...buildAnswersSection(questions, resources, drawingCounter),
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" ' +
      'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
    ].join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document ' +
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<w:body>${content}</w:body></w:document>`;
  }

  function buildStylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Source Han Sans SC"/>' +
      '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/>' +
      '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>' +
      '<w:spacing w:after="120" w:line="360" w:lineRule="auto"/>' +
      '</w:pPr></w:pPrDefault></w:docDefaults>' +
      '</w:styles>';
  }

  function buildContentTypes() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ' +
      'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';
  }

  function buildRootRelationships() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      'Target="word/document.xml"/>' +
      '<Relationship Id="rId2" ' +
      'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" ' +
      'Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" ' +
      'Target="docProps/app.xml"/>' +
      '</Relationships>';
  }

  function buildCoreProperties(now) {
    const timestamp = now.toISOString();
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties ' +
      'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
      'xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>雨课堂题目</dc:title><dc:creator>雨课堂题目导出器</dc:creator>' +
      '<cp:lastModifiedBy>雨课堂题目导出器</cp:lastModifiedBy>' +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>` +
      '</cp:coreProperties>';
  }

  function buildAppProperties() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties ' +
      'xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>雨课堂题目导出器</Application></Properties>';
  }

  function buildDocumentRelationships(mediaParts) {
    const images = mediaParts.map((part) =>
      `<Relationship Id="${part.relId}" ` +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
      `Target="media/${part.fileName}"/>`
    ).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
      'Target="styles.xml"/>' +
      `${images}</Relationships>`;
  }

  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      table[index] = value >>> 0;
    }
    return table;
  }

  const CRC_TABLE = makeCrcTable();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.byteLength; index += 1) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function setUint16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function setUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function dosDateTime(value) {
    const year = Math.min(2107, Math.max(1980, value.getFullYear()));
    return {
      time: (value.getHours() << 11) |
        (value.getMinutes() << 5) |
        Math.floor(value.getSeconds() / 2),
      date: ((year - 1980) << 9) |
        ((value.getMonth() + 1) << 5) |
        value.getDate()
    };
  }

  function localHeader(entry, timestamp) {
    const name = utf8Bytes(entry.name);
    const header = new Uint8Array(30 + name.byteLength);
    const view = new DataView(header.buffer);
    setUint32(view, 0, 0x04034b50);
    setUint16(view, 4, 20);
    setUint16(view, 6, 0x0800);
    setUint16(view, 8, 0);
    setUint16(view, 10, timestamp.time);
    setUint16(view, 12, timestamp.date);
    setUint32(view, 14, entry.crc);
    setUint32(view, 18, entry.data.byteLength);
    setUint32(view, 22, entry.data.byteLength);
    setUint16(view, 26, name.byteLength);
    setUint16(view, 28, 0);
    header.set(name, 30);
    return header;
  }

  function centralHeader(entry, timestamp) {
    const name = utf8Bytes(entry.name);
    const header = new Uint8Array(46 + name.byteLength);
    const view = new DataView(header.buffer);
    setUint32(view, 0, 0x02014b50);
    setUint16(view, 4, 20);
    setUint16(view, 6, 20);
    setUint16(view, 8, 0x0800);
    setUint16(view, 10, 0);
    setUint16(view, 12, timestamp.time);
    setUint16(view, 14, timestamp.date);
    setUint32(view, 16, entry.crc);
    setUint32(view, 20, entry.data.byteLength);
    setUint32(view, 24, entry.data.byteLength);
    setUint16(view, 28, name.byteLength);
    setUint16(view, 30, 0);
    setUint16(view, 32, 0);
    setUint16(view, 34, 0);
    setUint16(view, 36, 0);
    setUint32(view, 38, 0);
    setUint32(view, 42, entry.offset);
    header.set(name, 46);
    return header;
  }

  function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
    const header = new Uint8Array(22);
    const view = new DataView(header.buffer);
    setUint32(view, 0, 0x06054b50);
    setUint16(view, 4, 0);
    setUint16(view, 6, 0);
    setUint16(view, 8, entryCount);
    setUint16(view, 10, entryCount);
    setUint32(view, 12, centralSize);
    setUint32(view, 16, centralOffset);
    setUint16(view, 20, 0);
    return header;
  }

  function writeZip(entries) {
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 65535) {
      fail('DOCX_BUILD_FAILED');
    }
    const names = new Set();
    const prepared = entries.map((entry) => {
      if (!entry || typeof entry.name !== 'string' || entry.name.length === 0 ||
          entry.name.startsWith('/') || entry.name.includes('\\') ||
          entry.name.split('/').includes('..') || names.has(entry.name)) {
        fail('DOCX_BUILD_FAILED');
      }
      names.add(entry.name);
      let data;
      if (ArrayBuffer.isView(entry.data) && entry.data.BYTES_PER_ELEMENT === 1) {
        data = new Uint8Array(
          entry.data.buffer,
          entry.data.byteOffset,
          entry.data.byteLength
        ).slice();
      } else {
        fail('DOCX_BUILD_FAILED');
      }
      return { name: entry.name, data, crc: crc32(data), offset: 0 };
    });
    const timestamp = dosDateTime(new Date());
    const parts = [];
    let offset = 0;
    for (const entry of prepared) {
      entry.offset = offset;
      const header = localHeader(entry, timestamp);
      parts.push(header, entry.data);
      offset += header.byteLength + entry.data.byteLength;
      if (!Number.isSafeInteger(offset) || offset > 0xffffffff) fail('DOCX_BUILD_FAILED');
    }
    const centralOffset = offset;
    let centralSize = 0;
    for (const entry of prepared) {
      const header = centralHeader(entry, timestamp);
      parts.push(header);
      centralSize += header.byteLength;
    }
    if (centralSize > 0xffffffff || centralOffset > 0xffffffff) fail('DOCX_BUILD_FAILED');
    parts.push(endOfCentralDirectory(prepared.length, centralSize, centralOffset));
    return new root.Blob(parts, { type: DOCX_MIME });
  }

  function pngSignature(bytes) {
    return bytes.byteLength >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
  }

  function imageResultValue(result, key) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(result, key);
    } catch (_error) {
      fail('IMAGE_EXPORT_FAILED');
    }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      fail('IMAGE_EXPORT_FAILED');
    }
    return descriptor.value;
  }

  function validateImageResult(result, descriptor) {
    if (result === null || typeof result !== 'object' || Array.isArray(result)) {
      fail('IMAGE_EXPORT_FAILED');
    }
    let keys;
    try {
      keys = Reflect.ownKeys(result);
    } catch (_error) {
      fail('IMAGE_EXPORT_FAILED');
    }
    const expected = ['pngBytes', 'width', 'height', 'alt'];
    if (keys.length !== expected.length ||
        keys.some((key) => typeof key !== 'string' || !expected.includes(key))) {
      fail('IMAGE_EXPORT_FAILED');
    }
    const sourceBytes = imageResultValue(result, 'pngBytes');
    const width = imageResultValue(result, 'width');
    const height = imageResultValue(result, 'height');
    const alt = imageResultValue(result, 'alt');
    if (!ArrayBuffer.isView(sourceBytes) || sourceBytes.BYTES_PER_ELEMENT !== 1 ||
        !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width <= 0 || height <= 0 || width > MAX_EXPORT_EDGE || height > MAX_EXPORT_EDGE ||
        width * height > MAX_EXPORT_EDGE * MAX_EXPORT_EDGE || alt !== descriptor.alt) {
      fail('IMAGE_EXPORT_FAILED');
    }
    const bytes = new Uint8Array(
      sourceBytes.buffer,
      sourceBytes.byteOffset,
      sourceBytes.byteLength
    ).slice();
    if (!pngSignature(bytes)) fail('IMAGE_EXPORT_FAILED');
    return { bytes, width, height, alt };
  }

  function stableImageReason(error) {
    return error && typeof error.code === 'string' &&
      /^IMAGE_[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : 'IMAGE_RESOLUTION_FAILED';
  }

  async function prepareImages(questions, resolveImage) {
    const mediaParts = [];
    const imageMap = new Map();
    const failedImages = [];
    let attemptedImages = 0;
    for (const question of questions) {
      for (const descriptor of question.images) {
        attemptedImages += 1;
        try {
          const verified = validateImageResult(await resolveImage(descriptor), descriptor);
          const index = mediaParts.length + 1;
          const fileName = `image${String(index).padStart(3, '0')}.png`;
          const part = {
            fileName,
            path: `word/media/${fileName}`,
            relId: `rIdImage${index}`,
            bytes: verified.bytes,
            width: verified.width,
            height: verified.height,
            alt: verified.alt
          };
          mediaParts.push(part);
          imageMap.set(descriptor.id, { part, descriptor });
        } catch (error) {
          failedImages.push({
            questionOrdinal: question.ordinal,
            imageId: descriptor.id,
            reasonCode: stableImageReason(error)
          });
          imageMap.set(descriptor.id, { part: null, descriptor });
        }
      }
    }
    return { mediaParts, imageMap, failedImages, attemptedImages };
  }

  function packageEntries(questions, prepared, now) {
    const resources = { imageMap: prepared.imageMap };
    const entries = [
      { name: '[Content_Types].xml', data: utf8Bytes(buildContentTypes()) },
      { name: '_rels/.rels', data: utf8Bytes(buildRootRelationships()) },
      { name: 'docProps/core.xml', data: utf8Bytes(buildCoreProperties(now)) },
      { name: 'docProps/app.xml', data: utf8Bytes(buildAppProperties()) },
      { name: 'word/document.xml', data: utf8Bytes(buildDocumentXml(questions, resources)) },
      { name: 'word/styles.xml', data: utf8Bytes(buildStylesXml()) },
      {
        name: 'word/_rels/document.xml.rels',
        data: utf8Bytes(buildDocumentRelationships(prepared.mediaParts))
      }
    ];
    for (const part of prepared.mediaParts) {
      entries.push({ name: part.path, data: part.bytes });
    }
    return entries;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function filenameFor(now) {
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `雨课堂题目-${date}-${time}.docx`;
  }

  async function exportQuestions(value, options) {
    let payload;
    try {
      payload = modelApi.validatePayload(value);
    } catch (_error) {
      fail('MODEL_INVALID');
    }
    let resolveImage;
    try {
      resolveImage = options && options.resolveImage;
    } catch (_error) {
      fail('DOCX_BUILD_FAILED');
    }
    if (typeof resolveImage !== 'function') fail('DOCX_BUILD_FAILED');
    const questions = payload.questions.filter((question) => question.status !== 'failed');
    if (questions.length === 0) fail('DOCX_BUILD_FAILED');
    const warnings = payload.questions
      .filter((question) => question.status === 'failed')
      .map((question) => ({
        code: 'QUESTION_SKIPPED',
        questionOrdinal: question.ordinal
      }));
    const prepared = await prepareImages(questions, resolveImage);
    const now = new Date();
    let blob;
    try {
      blob = writeZip(packageEntries(questions, prepared, now));
    } catch (_error) {
      fail('DOCX_BUILD_FAILED');
    }
    return {
      blob,
      filename: filenameFor(now),
      attemptedImages: prepared.attemptedImages,
      failedImages: prepared.failedImages,
      warnings
    };
  }

  const privateApi = Object.freeze({
    writeZip,
    buildDocumentXml,
    imageRunXml,
    escapeXml
  });
  ns.docxExporter = Object.freeze({ exportQuestions, _private: privateApi });
})(globalThis);
