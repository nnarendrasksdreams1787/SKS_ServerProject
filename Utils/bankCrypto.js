const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION = 1;

// Get encryption key from .env
function getEncryptionKey() {
  const keyHex = process.env.BANK_ENCRYPTION_KEY;

  if (!keyHex || !/^[a-fA-F0-9]{64}$/.test(keyHex)) {
    throw new Error(
      "BANK_ENCRYPTION_KEY must be 32 bytes in hex format"
    );
  }

  return Buffer.from(keyHex, "hex");
}

// Get fingerprint key from .env
function getFingerprintKey() {
  const keyHex = process.env.BANK_FINGERPRINT_KEY;

  if (!keyHex || !/^[a-fA-F0-9]{64}$/.test(keyHex)) {
    throw new Error(
      "BANK_FINGERPRINT_KEY must be 32 bytes in hex format"
    );
  }

  return Buffer.from(keyHex, "hex");
}

// 1. Encrypt bank account number
function encryptAccountNumber(accountNumber) {
  const normalized = String(accountNumber).trim();

  // Basic validation
  if (!/^[0-9]{6,30}$/.test(normalized)) {
    throw new Error("Invalid bank account number");
  }

  // Generate a random IV for every encryption
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(
    ALGORITHM,
    getEncryptionKey(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Store version + IV + authentication tag + encrypted data
  return Buffer.concat([
    Buffer.from([VERSION]),
    iv,
    authTag,
    encrypted,
  ]);
}

// 2. Decrypt bank account number
function decryptAccountNumber(encryptedBuffer) {
  const data = Buffer.from(encryptedBuffer);

  if (
    data.length <= 1 + IV_LENGTH + AUTH_TAG_LENGTH ||
    data[0] !== VERSION
  ) {
    throw new Error("Invalid encrypted account number");
  }

  const iv = data.subarray(
    1,
    1 + IV_LENGTH
  );

  const authTag = data.subarray(
    1 + IV_LENGTH,
    1 + IV_LENGTH + AUTH_TAG_LENGTH
  );

  const ciphertext = data.subarray(
    1 + IV_LENGTH + AUTH_TAG_LENGTH
  );

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    iv
  );

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

// 3. Generate secure account number fingerprint
function fingerprintAccountNumber(accountNumber) {
  const normalized = String(accountNumber).trim();

  if (!/^[0-9]{6,30}$/.test(normalized)) {
    throw new Error("Invalid bank account number");
  }

  return crypto
    .createHmac("sha256", getFingerprintKey())
    .update(normalized, "utf8")
    .digest();
}

module.exports = {
  encryptAccountNumber,
  decryptAccountNumber,
  fingerprintAccountNumber,
};