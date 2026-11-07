// const fs = require("node:fs/promises");
// const path = require("node:path");
// const crypto = require("node:crypto");

// const PRIVATE_EBOOK_DIR = path.resolve(
//   process.env.EBOOK_STORAGE_DIR ||
//     path.join(__dirname, "..", "storage", "ebooks"),
// );

// async function saveEbook(file) {
//   if (!file || !Buffer.isBuffer(file.buffer)) {
//     throw new Error("A valid uploaded PDF is required");
//   }

//   // Basic file-signature validation. Also validate file size in Multer.
//   if (file.buffer.subarray(0, 5).toString() !== "%PDF-") {
//     throw new Error("The uploaded file is not a valid PDF");
//   }

//   await fs.mkdir(PRIVATE_EBOOK_DIR, { recursive: true });

//   const storageKey = `${crypto.randomUUID()}.pdf`;
//   const destination = path.join(PRIVATE_EBOOK_DIR, storageKey);

//   await fs.writeFile(destination, file.buffer, { flag: "wx" });

//   // Persist this key in MySQL, never a public filesystem URL.

//   return storageKey;
// }

// async function deleteEbook(storageKey) {
//   // Only allow generated UUID-style keys; prevent path traversal.

//   if (
//     typeof storageKey !== "string" ||
//     !/^[0-9a-f-]{36}\.pdf$/i.test(storageKey)
//   ) {
//     throw new Error("Invalid ebook storage key");
//   }

//   const destination = path.join(PRIVATE_EBOOK_DIR, storageKey);

//   try {
//     await fs.unlink(destination);
//   } catch (error) {
//     if (error.code !== "ENOENT") throw error;
//   }
// }

// function resolveEbookPath(storageKey) {
//   if (
//     typeof storageKey !== "string" ||
//     !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i.test(storageKey)
//   ) {
//     const error = new Error("Invalid ebook storage key");
//     error.statusCode = 404;
//     throw error;
//   }

//   return path.join(PRIVATE_EBOOK_DIR, storageKey);
// }

// module.exports = {
//   saveEbook,
//   deleteEbook,
//   resolveEbookPath
// };










const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

// const PRIVATE_EBOOK_DIR = path.resolve(
//   process.env.EBOOK_STORAGE_DIR ||
//     path.join(__dirname, "..", "storage", "ebooks")
// );


// const PRIVATE_DOCX_DIR = path.resolve(
//   process.env.DOCX_STORAGE_DIR ||
//     path.join(__dirname, "..", "storage", "docx")
// );



const PRIVATE_EBOOK_DIR = path.resolve(
  process.env.EBOOK_STORAGE_DIR ||
    path.join(__dirname, "..", "Storage", "ebooks")
);

const PRIVATE_DOCX_DIR = path.resolve(
  process.env.DOCX_STORAGE_DIR ||
    path.join(__dirname, "..", "Storage", "docx")
);




function validStorageKey(key, extension) {
  return (
    typeof key === "string" &&
    new RegExp(
      `^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.${extension}$`,
      "i"
    ).test(key)
  );
}

function resolveEbookPath(storageKey) {
  if (!validStorageKey(storageKey, "pdf")) {
    throw new Error("Invalid ebook storage key");
  }

  return path.join(PRIVATE_EBOOK_DIR, storageKey);
}

function resolveDocxPath(storageKey) {
  if (!validStorageKey(storageKey, "docx")) {
    throw new Error("Invalid DOCX storage key");
  }

  return path.join(PRIVATE_DOCX_DIR, storageKey);
}

async function saveEbook(file) {
  if (
    !file ||
    !Buffer.isBuffer(file.buffer) ||
    file.buffer.subarray(0, 5).toString() !== "%PDF-"
  ) {
    throw new Error("A valid PDF file is required");
  }

  await fs.mkdir(PRIVATE_EBOOK_DIR, { recursive: true });

  const storageKey = `${crypto.randomUUID()}.pdf`;

  await fs.writeFile(
    resolveEbookPath(storageKey),
    file.buffer,
    { flag: "wx" }
  );

  return storageKey;
}

async function saveDocx(file) {
  if (
    !file ||
    !Buffer.isBuffer(file.buffer) ||
    file.buffer.subarray(0, 4).toString("hex") !== "504b0304"
  ) {
    throw new Error("A valid DOCX file is required");
  }

  // ZIP signature is a preliminary check.
  // Full DOCX package validation should be added before production.
  await fs.mkdir(PRIVATE_DOCX_DIR, { recursive: true });

  const storageKey = `${crypto.randomUUID()}.docx`;

  await fs.writeFile(
    resolveDocxPath(storageKey),
    file.buffer,
    { flag: "wx" }
  );

  return storageKey;
}

async function deleteEbook(storageKey) {
  const filePath = resolveEbookPath(storageKey);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function deleteDocx(storageKey) {
  const filePath = resolveDocxPath(storageKey);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

module.exports = {
  saveEbook,
  deleteEbook,
  resolveEbookPath,
  saveDocx,
  deleteDocx,
  resolveDocxPath,
};
