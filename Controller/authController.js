// const pool = require("../DB/db");
// const bcrypt = require("bcrypt");
// const jwt = require("jsonwebtoken");

// const register = async (req, res) => {
//   if (!req.body || typeof req.body !== "object") {
//     return res.status(400).json({
//       message: "Request body is missing. Send JSON data.",
//     });
//   }

//   const {
//     document_type,
//     document_number,
//     full_name,
//     mobile_no,
//     date_of_birth,
//     gender,
//     pincode,
//     city,
//     state,
//     country,
//     address,
//     password,
//   } = req.body;

//   // Validate required fields
//   const fields = [
//     document_type,
//     document_number,
//     full_name,
//     mobile_no,
//     date_of_birth,
//     gender,
//     pincode,
//     city,
//     state,
//     country,
//     address,
//     password,
//   ];

//   if (fields.some((value) => typeof value !== "string" || !value.trim())) {
//     return res.status(400).json({
//       message: "All registration fields are required.",
//     });
//   }

//   if (!["PAN", "AADHAAR"].includes(document_type)) {
//     return res.status(400).json({
//       message: "Document type must be PAN or AADHAAR.",
//     });
//   }

//   if (!/^[6-9]\d{9}$/.test(mobile_no.trim())) {
//     return res.status(400).json({
//       message: "Enter a valid 10-digit Indian mobile number.",
//     });
//   }

//   if (!["Male", "Female", "Other", "Prefer not to say"].includes(gender)) {
//     return res.status(400).json({
//       message: "Select a valid gender.",
//     });
//   }

//   if (!/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth)) {
//     return res.status(400).json({
//       message: "Date of birth must use YYYY-MM-DD format.",
//     });
//   }

//   const dob = new Date(`${date_of_birth}T00:00:00Z`);

//   if (
//     Number.isNaN(dob.getTime()) ||
//     dob.toISOString().slice(0, 10) !== date_of_birth ||
//     dob >= new Date(new Date().toISOString().slice(0, 10))
//   ) {
//     return res.status(400).json({
//       message: "Enter a valid date of birth in the past.",
//     });
//   }

//   const docNumber = document_number.trim().replace(/\s/g, "").toUpperCase();

//   if (document_type === "PAN" && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(docNumber)) {
//     return res.status(400).json({
//       message: "Enter a valid PAN format.",
//     });
//   }

//   if (document_type === "AADHAAR" && !/^\d{12}$/.test(docNumber)) {
//     return res.status(400).json({
//       message: "Aadhaar number must contain 12 digits.",
//     });
//   }

//   if (
//     typeof password !== "string" ||
//     password.length < 8 ||
//     password.length > 72
//   ) {
//     return res.status(400).json({
//       message: "Password must be between 8 and 72 characters.",
//     });
//   }

//   const passwordHash = await bcrypt.hash(password, 12);

//   const connection = await pool.getConnection();

//   try {
//     await connection.beginTransaction();

//     const [existing] = await connection.execute(
//       `SELECT id FROM users
//              WHERE document_type = ?
//              AND document_number = ?
//              LIMIT 1`,
//       [document_type, docNumber],
//     );

//     if (existing.length > 0) {
//       await connection.rollback();

//       return res.status(409).json({
//         message: "This identity document is already registered.",
//       });
//     }

//     const [result] = await connection.execute(
//       `INSERT INTO users (
//                 document_type,
//                 document_number,
//                 full_name,
//                 mobile_no,
//                 date_of_birth,
//                 gender,
//                 pincode,
//                 city,
//                 state,
//                 country,
//                 address,
//                 password_hash
//             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         document_type,
//         docNumber,
//         full_name.trim(),
//         mobile_no.trim(),
//         date_of_birth,
//         gender,
//         pincode.trim(),
//         city.trim(),
//         state.trim(),
//         country.trim(),
//         address.trim(),
//         passwordHash
//       ],
//     );

//     // Generate a unique reference from the database ID.
//     const referenceId = `SD${String(result.insertId).padStart(4, "0")}`;

//     await connection.execute(
//       `UPDATE users
//              SET reference_id = ?
//              WHERE id = ?`,
//       [referenceId, result.insertId],
//     );

//     await connection.commit();

//     return res.status(201).json({
//       message: "Registration successful.",
//       user: {
//         reference_id: referenceId,
//         full_name: full_name.trim(),
//         mobile_no: mobile_no.trim(),
//         document_type,
//         created_at: new Date().toISOString(),
//       },
//     });
//   } catch (error) {
//     await connection.rollback();

//     console.error("Registration error:", error.message);

//     return res.status(500).json({
//       message: "Registration failed due to a server error.",
//     });
//   } finally {
//     connection.release();
//   }
// };

// const login = async (req, res) => {
//     try {
//         const { reference_id, password } = req.body || {};

//         if (
//             typeof reference_id !== "string" ||
//             typeof password !== "string" ||
//             !reference_id.trim() ||
//             !password ||
//             password.length > 72
//         ) {
//             return res.status(400).json({
//                 message: "Reference ID and password are required."
//             });
//         }

//         const [users] = await pool.execute(
//             `SELECT id, reference_id, full_name,
//                     mobile_no, password_hash
//              FROM users
//              WHERE reference_id = ?
//              LIMIT 1`,
//             [reference_id.trim()]
//         );

//         if (users.length === 0 || !users[0].password_hash) {
//             return res.status(401).json({
//                 message: "Invalid reference ID or password."
//             });
//         }

//         const user = users[0];

//         const passwordMatches = await bcrypt.compare(
//             password,
//             user.password_hash
//         );

//         if (!passwordMatches) {
//             return res.status(401).json({
//                 message: "Invalid reference ID or password."
//             });
//         }

//         const secret = process.env.JWT_SECRET;

//         if (!secret) {
//             console.error("JWT_SECRET is not configured.");

//             return res.status(500).json({
//                 message: "Authentication is not configured."
//             });
//         }

//         const token = jwt.sign(
//             { userId: user.id },
//             secret,
//             { expiresIn: "1h" }
//         );

//         return res.status(200).json({
//             message: "Login successful.",
//             token,
//             user: {
//                 id: user.id,
//                 reference_id: user.reference_id,
//                 full_name: user.full_name,
//                 mobile_no: user.mobile_no
//             }
//         });

//     } catch (error) {
//         console.error("Login error:", error.message);

//         return res.status(500).json({
//             message: "Login failed due to a server error."
//         });
//     }
// };

// module.exports = { register, login };

// const pool = require("../DB/db");
// const bcrypt = require("bcrypt");
// const jwt = require("jsonwebtoken");
// const crypto = require("crypto");

// // Generate a random 8-character alphanumeric password
// function generatePassword(length = 8) {
//   const characters =
//     "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

//   return Array.from(
//     { length },
//     () => characters[crypto.randomInt(0, characters.length)],
//   ).join("");
// }

// const register = async (req, res) => {
//   if (!req.body || typeof req.body !== "object") {
//     return res.status(400).json({
//       message: "Request body is missing. Send JSON data.",
//     });
//   }

//   const {
//     document_type,
//     document_number,
//     full_name,
//     mobile_no,
//     date_of_birth,
//     gender,
//     pincode,
//     city,
//     state,
//     country,
//     address,
//     referral_id,
//   } = req.body;

//   // Validate required registration fields (password is generated by backend)
//   const fields = [
//     document_type,
//     document_number,
//     full_name,
//     mobile_no,
//     date_of_birth,
//     gender,
//     pincode,
//     city,
//     state,
//     country,
//     address,
//   ];

//   if (fields.some((value) => typeof value !== "string" || !value.trim())) {
//     return res.status(400).json({
//       message: "All registration fields are required.",
//     });
//   }

//   if (!["PAN", "AADHAAR"].includes(document_type)) {
//     return res.status(400).json({
//       message: "Document type must be PAN or AADHAAR.",
//     });
//   }

//   if (!/^[6-9]\d{9}$/.test(mobile_no.trim())) {
//     return res.status(400).json({
//       message: "Enter a valid 10-digit Indian mobile number.",
//     });
//   }

//   if (!["Male", "Female", "Other", "Prefer not to say"].includes(gender)) {
//     return res.status(400).json({
//       message: "Select a valid gender.",
//     });
//   }

//   if (!/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth)) {
//     return res.status(400).json({
//       message: "Date of birth must use YYYY-MM-DD format.",
//     });
//   }

//   const dob = new Date(`${date_of_birth}T00:00:00Z`);

//   if (
//     Number.isNaN(dob.getTime()) ||
//     dob.toISOString().slice(0, 10) !== date_of_birth ||
//     dob >= new Date(new Date().toISOString().slice(0, 10))
//   ) {
//     return res.status(400).json({
//       message: "Enter a valid date of birth in the past.",
//     });
//   }

//   const normalizedReferralId =
//     typeof referral_id === "string" ? referral_id.trim().toUpperCase() : "";

//   // let validReferralId = null;

//   // if (normalizedReferralId) {
//   //   const [referrer] = await connection.execute(
//   //     `SELECT id
//   //    FROM users
//   //    WHERE reference_id = ?
//   //    LIMIT 1`,
//   //     [normalizedReferralId],
//   //   );

//   //   if (referrer.length > 0) {
//   //     validReferralId = normalizedReferralId;
//   //   }
//   // }

//   let sponsorId = null;

//   const docNumber = document_number.trim().replace(/\s/g, "").toUpperCase();

//   if (document_type === "PAN" && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(docNumber)) {
//     return res.status(400).json({
//       message: "Enter a valid PAN format.",
//     });
//   }

//   if (document_type === "AADHAAR" && !/^\d{12}$/.test(docNumber)) {
//     return res.status(400).json({
//       message: "Aadhaar number must contain 12 digits.",
//     });
//   }

//   // Generate a temporary password and hash it before storing
//   const generatedPassword = generatePassword();
//   const passwordHash = await bcrypt.hash(generatedPassword, 12);

//   let connection;

//   try {
//     connection = await pool.getConnection();
//     await connection.beginTransaction();

//     if (normalizedReferralId) {
//       const [referrer] = await connection.execute(
//         `SELECT user_id
//      FROM users
//      WHERE tenant_id = ?
//        AND referral_code = ?
//        AND status = 'active'
//      LIMIT 1`,
//         [1, normalizedReferralId],
//       );

//       if (referrer.length === 0) {
//         await connection.rollback();

//         return res.status(400).json({
//           message: "Invalid referral ID.",
//         });
//       }

//       sponsorId = referrer[0].user_id;
//     }

//     // const [existing] = await connection.execute(
//     //   `SELECT id FROM users
//     //    WHERE document_type = ?
//     //    AND document_number = ?
//     //    LIMIT 1`,
//     //   [document_type, docNumber],
//     // );

//     const [existingMobile] = await connection.execute(
//       `SELECT user_id
//    FROM users
//    WHERE tenant_id = ? AND mobile = ?
//    LIMIT 1`,
//       [1, mobile_no.trim()],
//     );

//     if (existingMobile.length > 0) {
//       await connection.rollback();

//       return res.status(409).json({
//         message: "This mobile number is already registered.",
//       });
//     }

//     if (existing.length > 0) {
//       await connection.rollback();

//       return res.status(409).json({
//         message: "This identity document is already registered.",
//       });
//     }

//     if (document_type === "PAN") {
//       const [existingPan] = await connection.execute(
//         `SELECT profile_id
//      FROM user_profiles
//      WHERE tenant_id = ? AND pan_number = ?
//      LIMIT 1`,
//         [1, docNumber],
//       );

//       if (existingPan.length > 0) {
//         await connection.rollback();

//         return res.status(409).json({
//           message: "This PAN is already registered.",
//         });
//       }
//     }

//     // const [result] = await connection.execute(
//     //   `INSERT INTO users (
//     //     document_type,
//     //     document_number,
//     //     full_name,
//     //     mobile_no,
//     //     date_of_birth,
//     //     gender,
//     //     pincode,
//     //     city,
//     //     state,
//     //     country,
//     //     address,
//     //     referral_id,
//     //     password_hash
//     //   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//     //   [
//     //     document_type,
//     //     docNumber,
//     //     full_name.trim(),
//     //     mobile_no.trim(),
//     //     date_of_birth,
//     //     gender,
//     //     pincode.trim(),
//     //     city.trim(),
//     //     state.trim(),
//     //     country.trim(),
//     //     address.trim(),
//     //     validReferralId,
//     //     passwordHash,
//     //   ],
//     // );
//     const temporaryReferralCode = `TMP${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

//     const [result] = await connection.execute(
//       `INSERT INTO users (
//     tenant_id,
//     referral_code,
//     sponsor_id,
//     full_name,
//     email,
//     mobile,
//     password_hash
//   ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
//       [
//         1,
//         temporaryReferralCode,
//         sponsorId,
//         full_name.trim(),
//         mobile_no.trim(),
//         passwordHash,
//       ],
//     );

//     const userId = result.insertId;
//     // Generate reference ID from the database ID
//     // const referenceId = `SD${String(result.insertId).padStart(4, "0")}`;
//     // const referenceId = `SM${String(userId).padStart(4, "0")}`;

//     const namePrefix = full_name
//       .trim()
//       .replace(/[^a-zA-Z]/g, "")
//       .substring(0, 2)
//       .toUpperCase();

//     const referenceId = `${namePrefix}${String(userId).padStart(4, "0")}`;

//     // await connection.execute(
//     //   `UPDATE users
//     //    SET reference_id = ?
//     //    WHERE id = ?`,
//     //   [referenceId, result.insertId],
//     // );

//     await connection.execute(
//       `UPDATE users
//    SET referral_code = ?
//    WHERE tenant_id = ? AND user_id = ?`,
//       [referenceId, 1, userId],
//     );

//     await connection.commit();

//     return res.status(201).json({
//       message: "Registration successful.",
//       user: {
//         reference_id: referenceId,
//         full_name: full_name.trim(),
//         mobile_no: mobile_no.trim(),
//         document_type,
//         referral_id: validReferralId,
//       },

//       // Temporary: for development/testing only.
//       // Replace this with SMS delivery before production.

//       referralApplied: Boolean(validReferralId),

//       temporaryPassword: generatedPassword,
//     });
//   } catch (error) {
//     if (connection) {
//       try {
//         await connection.rollback();
//       } catch (rollbackError) {
//         console.error("Rollback error:", rollbackError.message);
//       }
//     }

//     console.error("Registration error:", error.message);

//     return res.status(500).json({
//       message: "Registration failed due to a server error.",
//     });
//   } finally {
//     if (connection) {
//       connection.release();
//     }
//   }
// };

// const login = async (req, res) => {
//   try {
//     const { reference_id, password } = req.body || {};

//     if (
//       typeof reference_id !== "string" ||
//       typeof password !== "string" ||
//       !reference_id.trim() ||
//       !password ||
//       password.length > 72
//     ) {
//       return res.status(400).json({
//         message: "Reference ID and password are required.",
//       });
//     }

//     // const [users] = await pool.execute(
//     //   `SELECT id, reference_id, full_name,
//     //           mobile_no, password_hash
//     //    FROM users
//     //    WHERE reference_id = ?
//     //    LIMIT 1`,
//     //   [reference_id.trim()],
//     // );

//     const [users] = await pool.execute(
//       `SELECT user_id, referral_code, full_name,
//           mobile, password_hash, status
//    FROM users
//    WHERE tenant_id = ?
//      AND referral_code = ?
//    LIMIT 1`,
//       [1, reference_id.trim().toUpperCase()],
//     );

//     if (users.length === 0 || !users[0].password_hash) {
//       return res.status(401).json({
//         message: "Invalid reference ID or password.",
//       });
//     }

//     const user = users[0];

//     const passwordMatches = await bcrypt.compare(password, user.password_hash);

//     if (!passwordMatches) {
//       return res.status(401).json({
//         message: "Invalid reference ID or password.",
//       });
//     }

//     const secret = process.env.JWT_SECRET;

//     if (!secret) {
//       console.error("JWT_SECRET is not configured.");

//       return res.status(500).json({
//         message: "Authentication is not configured.",
//       });
//     }

//     const token = jwt.sign({ userId: user.id }, secret, { expiresIn: "1h" });

//     return res.status(200).json({
//       message: "Login successful.",
//       token,
//       user: {
//         id: user.id,
//         reference_id: user.reference_id,
//         full_name: user.full_name,
//         mobile_no: user.mobile_no,
//       },
//     });
//   } catch (error) {
//     console.error("Login error:", error.message);

//     return res.status(500).json({
//       message: "Login failed due to a server error.",
//     });
//   }
// };

// module.exports = { register, login };

const pool = require("../DB/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// Tenant configuration
const TENANT_ID = 1;

// Generate an 8-character temporary password
function generatePassword(length = 8) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  return Array.from(
    { length },
    () => characters[crypto.randomInt(0, characters.length)],
  ).join("");
}

// Convert frontend gender to database enum
const genderMap = {
  Male: "male",
  Female: "female",
  Other: "other",
  "Prefer not to say": "prefer_not_to_say",
};

// Encrypt Aadhaar using AES-256-GCM
function encryptAadhaar(aadhaar) {
  const keyString = process.env.AADHAAR_ENCRYPTION_KEY;

  if (!keyString) {
    throw new Error("AADHAAR_ENCRYPTION_KEY is not configured.");
  }

  const key = Buffer.from(keyString, "base64");

  if (key.length !== 32) {
    throw new Error("AADHAAR_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(aadhaar, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Store IV + authentication tag + encrypted data
  return Buffer.concat([iv, authTag, encrypted]);
}

// Generate Reference ID from first two letters of name
function generateReferencePrefix(fullName) {
  const prefix = fullName
    .trim()
    .replace(/[^a-zA-Z]/g, "")
    .substring(0, 2)
    .toUpperCase();

  return prefix || "US";
}

// ================= REGISTER =================

const register = async (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({
      message: "Request body is missing. Send JSON data.",
    });
  }

  const {
    document_type,
    document_number,
    full_name,
    mobile_no,
    date_of_birth,
    gender,
    pincode,
    city,
    state,
    country,
    address,
    referral_id,
  } = req.body;

  const fields = [
    document_type,
    document_number,
    full_name,
    mobile_no,
    date_of_birth,
    gender,
    pincode,
    city,
    state,
    country,
    address,
  ];

  if (fields.some((value) => typeof value !== "string" || !value.trim())) {
    return res.status(400).json({
      message: "All registration fields are required.",
    });
  }

  if (!["PAN", "AADHAAR"].includes(document_type)) {
    return res.status(400).json({
      message: "Document type must be PAN or AADHAAR.",
    });
  }

  if (!/^[6-9]\d{9}$/.test(mobile_no.trim())) {
    return res.status(400).json({
      message: "Enter a valid 10-digit Indian mobile number.",
    });
  }

  if (!genderMap[gender]) {
    return res.status(400).json({
      message: "Select a valid gender.",
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth)) {
    return res.status(400).json({
      message: "Date of birth must use YYYY-MM-DD format.",
    });
  }

  const dob = new Date(`${date_of_birth}T00:00:00Z`);

  if (
    Number.isNaN(dob.getTime()) ||
    dob.toISOString().slice(0, 10) !== date_of_birth ||
    dob >= new Date(new Date().toISOString().slice(0, 10))
  ) {
    return res.status(400).json({
      message: "Enter a valid date of birth in the past.",
    });
  }

  const normalizedReferralId =
    typeof referral_id === "string" ? referral_id.trim().toUpperCase() : "";

  const docNumber = document_number.trim().replace(/\s/g, "").toUpperCase();

  if (document_type === "PAN" && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(docNumber)) {
    return res.status(400).json({
      message: "Enter a valid PAN format.",
    });
  }

  if (document_type === "AADHAAR" && !/^\d{12}$/.test(docNumber)) {
    return res.status(400).json({
      message: "Aadhaar number must contain 12 digits.",
    });
  }

  // Generate password and hash
  const generatedPassword = generatePassword();
  const passwordHash = await bcrypt.hash(generatedPassword, 12);

  let connection;

  try {
    connection = await pool.getConnection();

    await connection.beginTransaction();

    // 1. Check referral ID
    let sponsorId = null;

    if (normalizedReferralId) {
      const [referrer] = await connection.execute(
        `SELECT user_id
         FROM users
         WHERE tenant_id = ?
           AND referral_id = ?
           AND status = 'active'
         LIMIT 1`,
        [TENANT_ID, normalizedReferralId],
      );

      if (referrer.length === 0) {
        await connection.rollback();

        return res.status(400).json({
          message: "Invalid referral ID.",
        });
      }

      sponsorId = referrer[0].user_id;
    }

    // 2. Check duplicate mobile
    const [existingMobile] = await connection.execute(
      `SELECT user_id
       FROM users
       WHERE tenant_id = ? AND mobile = ?
       LIMIT 1`,
      [TENANT_ID, mobile_no.trim()],
    );

    if (existingMobile.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        message: "This mobile number is already registered.",
      });
    }

    // 3. Check duplicate PAN
    if (document_type === "PAN") {
      const [existingPan] = await connection.execute(
        `SELECT profile_id
         FROM user_profiles
         WHERE tenant_id = ? AND pan_number = ?
         LIMIT 1`,
        [TENANT_ID, docNumber],
      );

      if (existingPan.length > 0) {
        await connection.rollback();

        return res.status(409).json({
          message: "This PAN is already registered.",
        });
      }
    }

    // 4. Encrypt Aadhaar if applicable
    const encryptedAadhaar =
      document_type === "AADHAAR" ? encryptAadhaar(docNumber) : null;

    // 5. Create temporary unique referral code
    const temporaryReferralCode = `TMP${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    // 6. Insert account into users

    const [result] = await connection.execute(
      `INSERT INTO users (
    tenant_id,
    reference_id,
    referral_id,
    sponsor_id,
    full_name,
    mobile,
    password_hash
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        TENANT_ID,
        temporaryReferralCode,
        normalizedReferralId || null,
        sponsorId,
        full_name.trim(),
        mobile_no.trim(),
        passwordHash,
      ],
    );

    const userId = result.insertId;

    // 7. Generate Reference ID from first two name letters
    const namePrefix = generateReferencePrefix(full_name);

    const referenceId = `${namePrefix}${String(userId).padStart(4, "0")}`;

    // 8. Update final Reference ID
    await connection.execute(
      `UPDATE users
       SET reference_id = ?
       WHERE tenant_id = ? AND user_id = ?`,
      [referenceId, TENANT_ID, userId],
    );

    // 9. Insert personal information into user_profiles
    await connection.execute(
      `INSERT INTO user_profiles (
        tenant_id,
        user_id,
        id_type,
        pan_number,
        aadhaar_ciphertext,
        date_of_birth,
        gender,
        pincode,
        city,
        state,
        country,
        address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        TENANT_ID,
        userId,
        document_type.toLowerCase(),
        document_type === "PAN" ? docNumber : null,
        encryptedAadhaar,
        date_of_birth,
        genderMap[gender],
        pincode.trim(),
        city.trim(),
        state.trim(),
        country.trim(),
        address.trim(),
      ],
    );

    // 10. Update referral hierarchy
    if (sponsorId !== null) {
      await connection.execute("CALL sp_add_referral_paths(?, ?, ?)", [
        TENANT_ID,
        userId,
        sponsorId,
      ]);
    }

    // 11. Commit transaction
    await connection.commit();

    // 12. Return registration details
    return res.status(201).json({
      message: "Registration successful.",

      user: {
        id: userId,
        reference_id: referenceId,
        full_name: full_name.trim(),
        mobile_no: mobile_no.trim(),
        document_type,
        referral_id: normalizedReferralId || null,
      },

      referralApplied: Boolean(sponsorId),

      // Temporary: deliver securely to the user.
      temporaryPassword: generatedPassword,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError.message);
      }
    }

    console.error("Registration error:", error.message);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This mobile number or referral code is already registered.",
      });
    }

    return res.status(500).json({
      message: "Registration failed due to a server error.",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// ================= LOGIN =================

const login = async (req, res) => {
  try {
    const { reference_id, password } = req.body || {};

    if (
      typeof reference_id !== "string" ||
      typeof password !== "string" ||
      !reference_id.trim() ||
      !password ||
      password.length > 72
    ) {
      return res.status(400).json({
        message: "Reference ID and password are required.",
      });
    }

    // 1. Find user by Reference ID
    const [users] = await pool.execute(
      `SELECT
     user_id,
     reference_id,
     full_name,
     mobile,
     password_hash,
     status
   FROM users
   WHERE tenant_id = ?
     AND reference_id = ?
   LIMIT 1`,
      [TENANT_ID, reference_id.trim().toUpperCase()],
    );

    if (users.length === 0 || !users[0].password_hash) {
      return res.status(401).json({
        message: "Invalid reference ID or password.",
      });
    }

    const user = users[0];

    // 2. Check account status
    if (user.status !== "active") {
      return res.status(403).json({
        message: "Your account is not active.",
      });
    }

    // 3. Verify password
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid reference ID or password.",
      });
    }

    // 4. Check JWT secret
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error("JWT_SECRET is not configured.");

      return res.status(500).json({
        message: "Authentication is not configured.",
      });
    }

    // 5. Generate token BEFORE sending response
    // const token = jwt.sign(
    //   { userId: user.user_id },
    //   secret,
    //   { expiresIn: "1h" }
    // );

    // const token = jwt.sign({ userId: user.user_id }, secret, {
    //   expiresIn: "1h",
    // });

    const token = jwt.sign(
      {
        userId: Number(user.user_id),
        tenantId: TENANT_ID,
        type: "user",
      },
      secret,
      {
        expiresIn: "1h",
        algorithm: "HS256",
      },
    );

    // 6. Send successful login response
    return res.status(200).json({
      message: "Login successful.",
      token,

      user: {
        id: user.user_id,
        reference_id: user.reference_id,
        full_name: user.full_name,
        mobile_no: user.mobile,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      message: "Login failed due to a server error.",
    });
  }
};

module.exports = { register, login };
