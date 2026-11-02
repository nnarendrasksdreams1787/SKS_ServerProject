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






const pool = require("../DB/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// Generate a random 8-character alphanumeric password
function generatePassword(length = 8) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  return Array.from({ length }, () =>
    characters[crypto.randomInt(0, characters.length)]
  ).join("");
}

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
  } = req.body;

  // Validate required registration fields (password is generated by backend)
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

  if (
    fields.some(
      (value) => typeof value !== "string" || !value.trim()
    )
  ) {
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

  if (!["Male", "Female", "Other", "Prefer not to say"].includes(gender)) {
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

  const docNumber = document_number
    .trim()
    .replace(/\s/g, "")
    .toUpperCase();

  if (
    document_type === "PAN" &&
    !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(docNumber)
  ) {
    return res.status(400).json({
      message: "Enter a valid PAN format.",
    });
  }

  if (document_type === "AADHAAR" && !/^\d{12}$/.test(docNumber)) {
    return res.status(400).json({
      message: "Aadhaar number must contain 12 digits.",
    });
  }

  // Generate a temporary password and hash it before storing
  const generatedPassword = generatePassword();
  const passwordHash = await bcrypt.hash(generatedPassword, 12);

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `SELECT id FROM users
       WHERE document_type = ?
       AND document_number = ?
       LIMIT 1`,
      [document_type, docNumber]
    );

    if (existing.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        message: "This identity document is already registered.",
      });
    }

    const [result] = await connection.execute(
      `INSERT INTO users (
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
        password_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        document_type,
        docNumber,
        full_name.trim(),
        mobile_no.trim(),
        date_of_birth,
        gender,
        pincode.trim(),
        city.trim(),
        state.trim(),
        country.trim(),
        address.trim(),
        passwordHash,
      ]
    );

    // Generate reference ID from the database ID
    const referenceId = `SD${String(result.insertId).padStart(4, "0")}`;

    await connection.execute(
      `UPDATE users
       SET reference_id = ?
       WHERE id = ?`,
      [referenceId, result.insertId]
    );

    await connection.commit();

    return res.status(201).json({
      message: "Registration successful.",
      user: {
        reference_id: referenceId,
        full_name: full_name.trim(),
        mobile_no: mobile_no.trim(),
        document_type,
      },

      // Temporary: for development/testing only.
      // Replace this with SMS delivery before production.
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

    return res.status(500).json({
      message: "Registration failed due to a server error.",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

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

    const [users] = await pool.execute(
      `SELECT id, reference_id, full_name,
              mobile_no, password_hash
       FROM users
       WHERE reference_id = ?
       LIMIT 1`,
      [reference_id.trim()]
    );

    if (users.length === 0 || !users[0].password_hash) {
      return res.status(401).json({
        message: "Invalid reference ID or password.",
      });
    }

    const user = users[0];

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid reference ID or password.",
      });
    }

    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error("JWT_SECRET is not configured.");

      return res.status(500).json({
        message: "Authentication is not configured.",
      });
    }

    const token = jwt.sign(
      { userId: user.id },
      secret,
      { expiresIn: "1h" }
    );

    return res.status(200).json({
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        reference_id: user.reference_id,
        full_name: user.full_name,
        mobile_no: user.mobile_no,
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
