const express = require("express");

const bookAccRoutes = express.Router();

const requireUser = require("../Middleware/requireUser");

const {
  checkAccess,
  myBooks,
} = require("../Controller/bookAccessController");

bookAccRoutes.get("/my-books", requireUser, myBooks);

bookAccRoutes.get(
  "/:productId/access",
  requireUser,
  checkAccess
);

module.exports = bookAccRoutes;