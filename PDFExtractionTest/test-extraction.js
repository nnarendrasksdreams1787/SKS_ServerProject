import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfPath = path.join(__dirname, "samples", "bg-hi.pdf");
const outputPath = path.join(__dirname, "results", "hindi-mupdf.txt");

// Same page that we tested with PDF.js
const pageNumber = 8;

try {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }

  const pdfBuffer = fs.readFileSync(pdfPath);

  const document = mupdf.Document.openDocument(
    pdfBuffer,
    "application/pdf"
  );

  console.log("PDF loaded successfully!");
  console.log("Total pages:", document.countPages());

  if (pageNumber < 1 || pageNumber > document.countPages()) {
    throw new Error(`Invalid page number: ${pageNumber}`);
  }

  // MuPDF uses zero-based page indexing
  const page = document.loadPage(pageNumber - 1);

  const structuredText = page.toStructuredText();

  const extractedText = structuredText.asText();

  fs.mkdirSync(path.dirname(outputPath), {
    recursive: true,
  });

  fs.writeFileSync(outputPath, extractedText, "utf8");

  console.log("\n========== EXTRACTION RESULT ==========\n");

  console.log("Page:", pageNumber);
  console.log("Text length:", extractedText.length);

  console.log("\nExtracted text:\n");
  console.log(extractedText);

  console.log("\nSaved to:", outputPath);

} catch (error) {
  console.error("MuPDF extraction failed:", error);
}