const multer = require("multer");

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const uploadEbook = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB maximum
    files: 1,
  },
  fileFilter: (req, file, callback) => {
    // if (file.mimetype !== "application/pdf") {
    //     return callback(new Error("Only PDF file are allowed"));
    // }

    // callback(null, true);

    const extension = file.originalname.toLowerCase().split(".").pop();

    const validPDF = extension === "pdf" && file.mimetype === "application/pdf";

    const validDOCX =
      extension === "docx" &&
      allowedMimeTypes.has(file.mimetype) &&
      file.mimetype !== "application/pdf";

    if (!validPDF && !validDOCX) {
      return callback(new Error("Only PDF and DOCX files are allowed"));
    }

    callback(null, true);
  },
}).single("ebook");

module.exports = uploadEbook;
