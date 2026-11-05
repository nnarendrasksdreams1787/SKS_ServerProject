const express = require("express");

const bookAccRoutes = express.Router();

const requireUser = require("../Middleware/requireUser");

const {
  checkAccess,
  myBooks,
  streamPurchasedPdf,
  streamPurchasedDocx,
} = require("../Controller/bookAccessController");

bookAccRoutes.get("/my-books", requireUser, myBooks);

bookAccRoutes.get("/:productId/access", requireUser, checkAccess);

bookAccRoutes.get("/:productId/pdf", requireUser, streamPurchasedPdf);

bookAccRoutes.get("/:productId/docx", requireUser, streamPurchasedDocx);

module.exports = bookAccRoutes;
