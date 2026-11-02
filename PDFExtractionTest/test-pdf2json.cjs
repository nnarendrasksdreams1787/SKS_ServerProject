const PDFParser = require("pdf2json");
const fs = require("node:fs");
const path = require("node:path");

const pdfPath = path.join(__dirname, "samples", "bg-hi.pdf");
const outputPath = path.join(__dirname, "results", "hindi-pdf2json.txt");

const pageNumber = 8;

const pdfParser = new PDFParser();

pdfParser.on("pdfParser_dataError", (error) => {
  console.error("PDF2JSON extraction failed:", error.parserError);
});

pdfParser.on("pdfParser_dataReady", (pdfData) => {
  try {
    const pages = pdfData.Pages || [];

    console.log("PDF loaded successfully!");
    console.log("Total pages:", pages.length);

    const page = pages[pageNumber - 1];

    if (!page) {
      throw new Error(`Page ${pageNumber} not found`);
    }

    const extractedText = (page.Texts || [])
      .map((item) =>
        (item.R || [])
          .map((run) => {
            try {
              return decodeURIComponent(run.T || "");
            } catch {
              return run.T || "";
            }
          })
          .join("")
      )
      .join(" ");

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
    console.error("PDF2JSON processing failed:", error);
  }
});

pdfParser.loadPDF(pdfPath);