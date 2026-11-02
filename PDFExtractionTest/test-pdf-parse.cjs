const { PDFParse } = require("pdf-parse");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const pdfPath = path.join(__dirname, "samples", "bg-hi.pdf");
  const outputPath = path.join(__dirname, "results", "hindi-pdf-parse.txt");

  let parser;

  try {
    const pdfBuffer = fs.readFileSync(pdfPath);

    parser = new PDFParse({
      data: new Uint8Array(pdfBuffer),
    });

    // PDF page 8 only
    const result = await parser.getText({
      partial: [8],
    });

    fs.mkdirSync(path.dirname(outputPath), {
      recursive: true,
    });

    fs.writeFileSync(outputPath, result.text, "utf8");

    console.log("PDF-Parse extraction successful!");
    console.log("Text length:", result.text.length);
    console.log("\nExtracted text:\n");
    console.log(result.text);
    console.log("\nSaved to:", outputPath);

  } catch (error) {
    console.error("PDF-Parse extraction failed:", error);
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
}

main();