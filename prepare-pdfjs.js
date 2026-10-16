// Copies pdf.js into assets so PDFs are read fully offline.
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build');
const dst = path.join(__dirname, '..', 'assets', 'pdfjs');
fs.mkdirSync(dst, { recursive: true });
fs.copyFileSync(path.join(src, 'pdf.min.js'), path.join(dst, 'pdf.txt'));
fs.copyFileSync(path.join(src, 'pdf.worker.min.js'), path.join(dst, 'worker.txt'));
console.log('pdf.js ready');
