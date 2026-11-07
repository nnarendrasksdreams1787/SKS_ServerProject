
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PRODUCT_IMAGE_DIR = path.resolve(
  process.env.PRODUCT_IMAGE_STORAGE_DIR ||
    path.join(__dirname, "..", "Storage", "product-images")
);

function getImageExtension(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;

  // JPEG
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpg";
  }

  // PNG
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "png";
  }

  // WebP
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

function resolveProductImagePath(storageKey) {
  if (
    typeof storageKey !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(storageKey)
  ) {
    const error = new Error("Invalid product image key");
    error.statusCode = 404;
    throw error;
  }

  return path.join(PRODUCT_IMAGE_DIR, storageKey);
}

async function saveProductImage(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new Error("A valid product image is required");
  }

  if (file.buffer.length > 5 * 1024 * 1024) {
    throw new Error("Product image must be smaller than 5 MB");
  }

  const extension = getImageExtension(file.buffer);

  if (!extension) {
    throw new Error("Only valid JPG, PNG and WebP images are allowed");
  }

  await fs.mkdir(PRODUCT_IMAGE_DIR, { recursive: true });

  const storageKey = `${crypto.randomUUID()}.${extension}`;

  await fs.writeFile(
    resolveProductImagePath(storageKey),
    file.buffer,
    { flag: "wx" }
  );

  return storageKey;
}

async function deleteProductImage(storageKey) {
  if (!storageKey) return;

  const filePath = resolveProductImagePath(storageKey);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function getProductImageContentType(storageKey) {
  const extension = storageKey.split(".").pop().toLowerCase();

  const types = {
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };

  return types[extension] || "application/octet-stream";
}

module.exports = {
  saveProductImage,
  deleteProductImage,
  resolveProductImagePath,
  getProductImageContentType,
};
