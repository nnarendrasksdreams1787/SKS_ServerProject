const fs = require("node:fs/promises");
const { PDFDocument } = require("pdf-lib");
const { resolveEbookPath } = require("./ebookStorage");

const PREVIEW_PAGE_LIMIT = 8;

async function createBookPreview(storageKey) {
  const filePath = resolveEbookPath(storageKey);
  const pdfBuffer = await fs.readFile(filePath);

  const sourcePdf = await PDFDocument.load(pdfBuffer);

  const previewPdf = await PDFDocument.create();

  const totalPages = sourcePdf.getPageCount();
  const previewPageCount = Math.min(
    totalPages,
    PREVIEW_PAGE_LIMIT
  );

  const pageIndexes = Array.from(
    { length: previewPageCount },
    (_, index) => index
  );

  const copiedPages = await previewPdf.copyPages(
    sourcePdf,
    pageIndexes
  );

  copiedPages.forEach((page) => previewPdf.addPage(page));

  const previewBytes = await previewPdf.save();

  return {
    buffer: Buffer.from(previewBytes),
    previewPages: previewPageCount,
    totalPages,
    hasMorePages: totalPages > PREVIEW_PAGE_LIMIT,
  };
}

module.exports = { createBookPreview };