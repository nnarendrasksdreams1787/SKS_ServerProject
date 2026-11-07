const bookAccessService = require("../Services/bookAccessService");

const pool = require("../DB/db");
const { createBookPreview } = require("../Services/ebookPreviewService");

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
    const books = await bookAccessService.getMyPurchasedBooks(req.user.userId);

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


async function previewBook(req, res) {
  try {
    const productId = Number(req.params.id);

    if (!Number.isSafeInteger(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const [rows] = await pool.execute(
      `SELECT ebook_storage_key
       FROM products
       WHERE tenant_id = ?
         AND product_id = ?
         AND is_active = 1
       LIMIT 1`,
      [1, productId]
    );

    if (!rows.length || !rows[0].ebook_storage_key) {
      return res.status(404).json({
        success: false,
        message: "Book preview is not available",
      });
    }

    const preview = await createBookPreview(
      rows[0].ebook_storage_key
    );

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": preview.buffer.length,
      "Content-Disposition": "inline",
      "Cache-Control": "public, max-age=300",
      "X-Preview-Pages": String(preview.previewPages),
      "X-Total-Pages": String(preview.totalPages),
      "X-Has-More-Pages": String(preview.hasMorePages),
      "X-Content-Type-Options": "nosniff",
    });

    return res.status(200).send(preview.buffer);
  } catch (error) {
    console.error("Public book preview error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load book preview",
    });
  }
}

async function streamPurchasedPdf(req, res) {
  const fs = require("node:fs");
  const fsp = require("node:fs/promises");
  const pool = require("../DB/db");
  const { resolveEbookPath } = require("../Services/ebookStorage");

  try {
    const userId = Number(req.user.userId);
    const productId = Number(req.params.productId);
    const tenantId = Number(req.user.tenantId || 1);

    if (!Number.isSafeInteger(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    // Verify the logged-in user's paid purchase first.
    const access = await bookAccessService.checkBookAccess({
      userId,
      productId,
    });

    if (!access.hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Purchase required to read this book",
      });
    }

    const [rows] = await pool.execute(
      `SELECT ebook_storage_key
       FROM products
       WHERE tenant_id = ?
         AND product_id = ?
       LIMIT 1`,
      [tenantId, productId],
    );

    if (!rows.length || !rows[0].ebook_storage_key) {
      return res.status(404).json({
        success: false,
        message: "Ebook file is not available",
      });
    }

    let filePath;

    try {
      filePath = resolveEbookPath(rows[0].ebook_storage_key);
    } catch {
      return res.status(404).json({
        success: false,
        message: "Ebook file has not been uploaded",
      });
    }

    let stats;

    try {
      stats = await fsp.stat(filePath);
      if (!stats.isFile()) throw new Error("Not a file");
    } catch {
      return res.status(404).json({
        success: false,
        message: "Ebook PDF not found",
      });
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": stats.size,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });

    const stream = fs.createReadStream(filePath);

    stream.on("error", (error) => {
      console.error("Ebook stream error:", error.message);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "Unable to read ebook",
        });
      } else {
        res.destroy(error);
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error("Purchased PDF error:", error.message);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Unable to load purchased ebook",
      });
    }
  }
}

async function streamPurchasedDocx(req, res) {
  const fs = require("node:fs");
  const fsp = require("node:fs/promises");
  const pool = require("../DB/db");
  const { resolveDocxPath } = require("../Services/ebookStorage");

  try {
    const userId = Number(req.user.userId);
    const productId = Number(req.params.productId);
    const tenantId = Number(req.user.tenantId || 1);

    if (!Number.isSafeInteger(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    // Only a user with verified paid access may read this DOCX.
    const access = await bookAccessService.checkBookAccess({
      userId,
      productId,
    });

    if (!access.hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Purchase required to read this book",
      });
    }

    const [rows] = await pool.execute(
      `SELECT docx_storage_key
       FROM products
       WHERE tenant_id = ?
         AND product_id = ?
       LIMIT 1`,
      [tenantId, productId],
    );

    if (!rows.length || !rows[0].docx_storage_key) {
      return res.status(404).json({
        success: false,
        message: "Ebook DOCX is not available",
      });
    }

    let filePath;

    try {
      filePath = resolveDocxPath(rows[0].docx_storage_key);
    } catch {
      return res.status(404).json({
        success: false,
        message: "Ebook DOCX has not been uploaded",
      });
    }

    let stats;

    try {
      stats = await fsp.stat(filePath);
      if (!stats.isFile()) {
        throw new Error("Not a file");
      }
    } catch {
      return res.status(404).json({
        success: false,
        message: "Ebook DOCX not found",
      });
    }

    res.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Length": stats.size,
      "Content-Disposition": "attachment",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });

    const stream = fs.createReadStream(filePath);

    stream.on("error", (error) => {
      console.error("Ebook DOCX stream error:", error.message);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "Unable to read ebook DOCX",
        });
      } else {
        res.destroy(error);
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error("Purchased DOCX error:", error.message);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Unable to load purchased ebook DOCX",
      });
    }
  }
}

module.exports = {
  checkAccess,
  myBooks,
  streamPurchasedPdf,
  streamPurchasedDocx,
  previewBook,
};
