const bookAccessService = require("../Services/bookAccessService");

async function checkAccess(req, res) {
  try {
    const result = await bookAccessService.checkBookAccess({
      userId: req.user.userId,
      productId: req.params.productId,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Book access error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Unable to verify book access",
    });
  }
}

async function myBooks(req, res) {
  try {
    const books =
      await bookAccessService.getMyPurchasedBooks(
        req.user.userId
      );

    return res.status(200).json({
      success: true,
      count: books.length,
      data: books,
    });
  } catch (error) {
    console.error("My books error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve purchased books",
    });
  }
}

module.exports = {
  checkAccess,
  myBooks,
};