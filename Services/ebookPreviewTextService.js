const fs = require("node:fs/promises");
const mammoth = require("mammoth");
const { resolveDocxPath } = require("./ebookStorage");

function normalizeForMatching(text) {
  return text
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

function getTextParagraphs(text) {
  return text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 20);
}

function normalizeWithPositions(text) {
  const characters = [];
  const positions = [];

  for (let i = 0; i < text.length; i++) {
    const normalized = text[i]
      .normalize("NFC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .toLowerCase();

    for (const character of normalized) {
      characters.push(character);
      positions.push(i);
    }
  }

  return {
    normalized: characters.join(""),
    positions,
  };
}

async function extractPreviewDocxPage({
  storageKey,
  pageNumber,
  ocrText,
}) {
  if (
    !storageKey ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > 8 ||
    typeof ocrText !== "string" ||
    !ocrText.trim() ||
    ocrText.length > 100000
  ) {
    throw new Error("Invalid preview text request.");
  }

  const filePath = resolveDocxPath(storageKey);
  const buffer = await fs.readFile(filePath);

  const result = await mammoth.extractRawText({
    buffer,
  });

  const paragraphs = getTextParagraphs(result.value);

  const ocrLines = ocrText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => normalizeForMatching(line).length > 25);

  const matches = [];

  for (const ocrLine of ocrLines) {
    const normalizedOCR = normalizeForMatching(ocrLine);

    for (let i = 0; i < paragraphs.length; i++) {
      const normalizedDOCX = normalizeForMatching(paragraphs[i]);

      if (normalizedDOCX.includes(normalizedOCR)) {
        matches.push({
          ocrLine,
          paragraphIndex: i,
        });
        break;
      }
    }
  }

  const indexes = matches.map((match) => match.paragraphIndex);

  for (let i = 1; i < indexes.length; i++) {
    if (indexes[i] < indexes[i - 1]) {
      throw new Error("DOCX matches are out of order.");
    }
  }

  const exactMatches = matches.length;
  const matchRatio =
    ocrLines.length > 0 ? exactMatches / ocrLines.length : 0;

  const requiredMatches = Math.min(
    10,
    Math.max(5, Math.ceil(ocrLines.length * 0.7))
  );

  if (
    exactMatches < requiredMatches ||
    matchRatio < 0.7
  ) {
    throw new Error(
      "Page matching confidence is too low."
    );
  }

  const firstMatch = matches[0];
  const lastMatch = matches[matches.length - 1];

  const selectedParagraphs = paragraphs.slice(
    firstMatch.paragraphIndex,
    lastMatch.paragraphIndex + 1
  );

  const combinedText = selectedParagraphs.join("\n\n");
  const mapped = normalizeWithPositions(combinedText);

  const normalizedStart = normalizeForMatching(
    firstMatch.ocrLine
  );

  const normalizedEnd = normalizeForMatching(
    lastMatch.ocrLine
  );

  const startPosition = mapped.normalized.indexOf(
    normalizedStart
  );

  const endPosition = mapped.normalized.lastIndexOf(
    normalizedEnd
  );

  if (
    startPosition === -1 ||
    endPosition === -1 ||
    endPosition < startPosition
  ) {
    throw new Error("Unable to identify clean page boundaries.");
  }

  const originalStart = mapped.positions[startPosition];

  const endCharacterIndex =
    endPosition + normalizedEnd.length - 1;

  const originalEnd =
    mapped.positions[endCharacterIndex] + 1;

  const text = combinedText
    .slice(originalStart, originalEnd)
    .trim();

  if (!text) {
    throw new Error("Preview page text is empty.");
  }

  return {
    pageNumber,
    text,
    exactMatches,
    ocrLines: ocrLines.length,
  };
}

module.exports = { extractPreviewDocxPage };