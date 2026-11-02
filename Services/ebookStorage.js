const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PRIVATE_EBOOK_DIR = path.resolve(
  process.env.EBOOK_STORAGE_DIR ||
    path.join(__dirname, "..", "storage", "ebooks"),
);

async function saveEbook(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new Error("A valid uploaded PDF is required");
  }

  // Basic file-signature validation. Also validate file size in Multer.
  if (file.buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("The uploaded file is not a valid PDF");
  }

  await fs.mkdir(PRIVATE_EBOOK_DIR, { recursive: true });

  const storageKey = `${crypto.randomUUID()}.pdf`;
  const destination = path.join(PRIVATE_EBOOK_DIR, storageKey);

  await fs.writeFile(destination, file.buffer, { flag: "wx" });

  // Persist this key in MySQL, never a public filesystem URL.

  return storageKey;
}

async function deleteEbook(storageKey) {
  // Only allow generated UUID-style keys; prevent path traversal.

  if (
    typeof storageKey !== "string" ||
    !/^[0-9a-f-]{36}\.pdf$/i.test(storageKey)
  ) {
    throw new Error("Invalid ebook storage key");
  }

  const destination = path.join(PRIVATE_EBOOK_DIR, storageKey);

  try {
    await fs.unlink(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

module.exports = {
  saveEbook,
  deleteEbook,
};
