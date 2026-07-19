(function initializeNamespace(root) {
  if (root.YktQuestionExporter) return;
  Object.defineProperty(root, 'YktQuestionExporter', {
    value: Object.create(null),
    writable: false,
    enumerable: false,
    configurable: false
  });
  root.YktQuestionExporter.VERSION = '1.0.0';
})(globalThis);
