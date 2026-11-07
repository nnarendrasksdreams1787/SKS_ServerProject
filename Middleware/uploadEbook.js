// const multer = require("multer");

// const allowedMimeTypes = new Set([
//   "application/pdf",
//   "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
// ]);

// const uploadEbook = multer({
//   storage: multer.memoryStorage(),
//   limits: {
//     fileSize: 100 * 1024 * 1024, // 100 MB maximum
//     files: 1,
//   },
//   fileFilter: (req, file, callback) => {
//     // if (file.mimetype !== "application/pdf") {
//     //     return callback(new Error("Only PDF file are allowed"));
//     // }

//     // callback(null, true);

//     const extension = file.originalname.toLowerCase().split(".").pop();

//     const validPDF = extension === "pdf" && file.mimetype === "application/pdf";

//     const validDOCX =
//       extension === "docx" &&
//       allowedMimeTypes.has(file.mimetype) &&
//       file.mimetype !== "application/pdf";

//     if (!validPDF && !validDOCX) {
//       return callback(new Error("Only PDF and DOCX files are allowed"));
//     }

//     callback(null, true);
//   },
// }).single("ebook");

// module.exports = uploadEbook;






// const multer = require("multer");

// const uploadEbook = multer({
//   storage: multer.memoryStorage(),
//   limits: {
//     fileSize: 100 * 1024 * 1024,
//     files: 2,
//   },
//   fileFilter: (req, file, callback) => {
//     const name = file.originalname.toLowerCase();

//     if (
//       file.fieldname === "ebook" &&
//       name.endsWith(".pdf") &&
//       file.mimetype === "application/pdf"
//     ) {
//       return callback(null, true);
//     }

//     if (
//       file.fieldname === "docx" &&
//       name.endsWith(".docx") &&
//       file.mimetype ===
//         "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
//     ) {
//       return callback(null, true);
//     }

//     callback(new Error("Only PDF and DOCX files are allowed"));
//   },
// }).fields([
//   { name: "ebook", maxCount: 1 },
//   { name: "docx", maxCount: 1 },
// ]);

// module.exports = uploadEbook;





const multer = require("multer");

const uploadEbook = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 3,
  },
  fileFilter: (req, file, callback) => {
    const name = file.originalname.toLowerCase();

    if (
      file.fieldname === "ebook" &&
      name.endsWith(".pdf") &&
      file.mimetype === "application/pdf"
    ) {
      return callback(null, true);
    }

    if (
      file.fieldname === "docx" &&
      name.endsWith(".docx") &&
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return callback(null, true);
    }

    const allowedImageTypes = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    };

    const extension = name.slice(name.lastIndexOf("."));
    const expectedMimeType = allowedImageTypes[extension];

    if (
      file.fieldname === "coverImage" &&
      expectedMimeType &&
      file.mimetype === expectedMimeType
    ) {
      return callback(null, true);
    }

    return callback(
      new Error("Only PDF, DOCX, JPG, JPEG, PNG and WebP files are allowed")
    );
  },
}).fields([
  { name: "ebook", maxCount: 1 },
  { name: "docx", maxCount: 1 },
  { name: "coverImage", maxCount: 1 },
]);

module.exports = uploadEbook;
