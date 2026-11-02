const mammoth = require("mammoth");
const fs = require("node:fs");
const path = require("node:path");

const inputPath = path.join(
  __dirname,
  "Samples",
  "Bhagvadgeeta2.docx"
);

const outputPath = path.join(
  __dirname,
  "Results",
  "marathi-docx.txt"
);

async function testDocxExtraction() {
  try {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`DOCX file not found: ${inputPath}`);
    }

    const result = await mammoth.extractRawText({
      path: inputPath,
    });

    const extractedText = result.value;

    fs.mkdirSync(path.dirname(outputPath), {
      recursive: true,
    });

    fs.writeFileSync(outputPath, extractedText, "utf8");

    console.log("DOCX extraction successful!");
    console.log("Text length:", extractedText.length);

    console.log("\n========== TEXT SAMPLE ==========\n");

    const searchText = "माझा जन्म";
    const position = extractedText.indexOf(searchText);

    if (position !== -1) {
      console.log(
        extractedText.slice(position, position + 1000)
      );
    } else {
      console.log(extractedText.slice(0, 1000));
      console.log("\nTarget paragraph not found.");
    }

    console.log("\n========== WARNINGS ==========\n");

    console.log(result.messages);

    console.log("\nSaved to:", outputPath);
  } catch (error) {
    console.error("DOCX extraction failed:", error);
  }
}

testDocxExtraction();