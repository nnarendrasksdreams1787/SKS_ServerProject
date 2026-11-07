const pool = require("../DB/db");
const {
  saveEbook,
  deleteEbook,
  saveDocx,
  deleteDocx,
} = require("../Services/ebookStorage");

const {
  saveProductImage,
  deleteProductImage,
  resolveProductImagePath,
  getProductImageContentType,
} = require("../Services/productImageStorage");

const TENANT_ID = 1;

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 220);
}

function handleDatabaseError(error, res, fallbackMessage) {
  console.error("Products API error: ", error.message);

  if (error.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      message:
        "A product with the slug already exists. Try a differnt product name.",
    });
  }

  return res.status(500).json({ message: fallbackMessage });
}

// GET /api/admin/proucts

exports.getProducts = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         p.product_id AS id,
         p.title AS name,
         p.slug,
         p.description,
         p.author,
         p.category_id,
         c.name AS category,
         p.price,
         p.stock,
         p.tax_percent,
         p.cover_image_key,
         p.is_active,
         p.created_at,
         p.updated_at
       FROM products p
       INNER JOIN categories c
         ON c.category_id = p.category_id
        AND c.tenant_id = p.tenant_id
       WHERE p.tenant_id = ?
       ORDER BY p.created_at DESC`,
      [TENANT_ID],
    );

    return res.json({
      products: rows.map((product) => ({
        ...product,
        price: Number(product.price),
        stock: Number(product.stock),
        tax_percent: Number(product.tax_percent),
        status: product.is_active ? "Active" : "Inactive",
      })),
    });
  } catch (error) {
    return handleDatabaseError(error, res, "Unable to load products");
  }
};

// GET /api/admin/categories

exports.getProductCategories = async (req, res) => {
  try {
    const [categories] = await pool.execute(
      `SELECT category_id AS id, name, slug
            FROM categories
            WHERE tenant_id = ? AND is_active = 1
            ORDER BY name ASC
            `,
      [TENANT_ID],
    );

    return res.json({ categories });
  } catch (error) {
    return handleDatabaseError(error, res, "Unable to load product categories");
  }
};

// POST /api/admin/products

exports.createProduct = async (req, res) => {
  let savedStorageKey = null;
  let savedDocxKey = null;
  let savedImageKey = null;

  try {
    const {
      name,
      category_id,
      price,
      stock = 0,
      status = "Active",
      description = null,
      author = null,
      tax_percent = 0,
      // cover_image_key = null,
      //   ebook_storage_key,
    } = req.body;

    const title = String(name || "").trim();
    const slug = slugify(title);
    const categoryId = Number(category_id);
    const productPrice = Number(price);
    const productStock = Number(stock);
    const taxPercent = Number(tax_percent);

    if (!title || title.length > 200 || !slug) {
      return res.status(400).json({
        message: "A valid product name is required (maximum 200 characters)",
      });
    }

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return res.status(400).json({
        message: "A valid category is required",
      });
    }

    if (!Number.isFinite(productPrice) || productPrice < 0) {
      return res.status(400).json({
        message: "Price must be a non-negative number",
      });
    }

    if (!Number.isInteger(productStock) || productStock < 0) {
      return res.status(400).json({
        message: "Stock must be a non-negative whole number",
      });
    }

    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
      return res.status(400).json({
        message: "Tax must be between 0 and 100",
      });
    }

    if (!["Active", "Inactive"].includes(status)) {
      return res.status(400).json({
        message: "Status must be Active or Inactive",
      });
    }

    // The current database requires a private ebook storage key.
    // This should be a storage key, never a public ebook URL.
    // if (typeof ebook_storage_key !== "string" || !ebook_storage_key.trim()) {
    //   return res.status(400).json({
    //     message: "An ebook storage key is required",
    //   });
    // }

    // if (!req.file) {
    //   return res.status(400).json({
    //     message: "Please upload the e-book PDF",
    //   });
    // }

    const pdfFile = req.files?.ebook?.[0];
    const docxFile = req.files?.docx?.[0];
    const imageFile = req.files?.coverImage?.[0];

    if (!pdfFile || !docxFile) {
      return res.status(400).json({
        message: "Both PDF and DOCX files are required",
      });
    }

    const [categories] = await pool.execute(
      `SELECT category_id
       FROM categories
       WHERE category_id = ? AND tenant_id = ? AND is_active = 1
       LIMIT 1`,
      [categoryId, TENANT_ID],
    );

    if (!categories.length) {
      return res.status(400).json({
        message: "Selected category does not exist or is inactive",
      });
    }

    // Save the uploaded PDF in private storage
    // savedStorageKey = await saveEbook(req.file);

    savedStorageKey = await saveEbook(pdfFile);
    savedDocxKey = await saveDocx(docxFile);
    if (imageFile) {
      savedImageKey = await saveProductImage(imageFile);
    }

    // Save the PDF privately; never accept its storage key from the client.

    const [result] = await pool.execute(
      `INSERT INTO products
        (tenant_id, category_id, title, slug, description, author,
         price, stock, tax_percent, cover_image_key,
         ebook_storage_key, docx_storage_key, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        TENANT_ID,
        categoryId,
        title,
        slug,
        description || null,
        author || null,
        productPrice,
        productStock,
        taxPercent,
        // cover_image_key || null,
        // ebook_storage_key.trim(),
        savedImageKey,
        savedStorageKey,
        savedDocxKey,
        status === "Active" ? 1 : 0,
      ],
    );

    return res.status(201).json({
      message: "Product created successfully",
      product: {
        id: result.insertId,
        name: title,
        category_id: categoryId,
        price: productPrice,
        stock: productStock,
        status,
      },
    });
  } catch (error) {
    // Remove the newly saved PDF if creation fails

    if (savedStorageKey) {
      try {
        await deleteEbook(savedStorageKey);
      } catch (cleanupError) {
        console.error("E-book cleanup faild:", cleanupError.message);
      }
    }

    if (savedDocxKey) {
      try {
        await deleteDocx(savedDocxKey);
      } catch (cleanupError) {
        console.error("DOCX cleanup failed:", cleanupError.message);
      }
    }

    if (savedImageKey) {
      try {
        await deleteProductImage(savedImageKey);
      } catch (cleanupError) {
        console.error("Product image cleanup failed:", cleanupError.message);
      }
    }

    return handleDatabaseError(error, res, "Unable to create product");
  }
};

// PUT /api/admin/products/:id
exports.updateProduct = async (req, res) => {
  let newStorageKey = null;
  let oldStorageKey = null;
  let newDocxKey = null;
  let oldDocxKey = null;
  let newImageKey = null;
  let oldImageKey = null;

  try {
    const productId = req.params.id;
    const {
      name,
      category_id,
      price,
      stock = 0,
      status = "Active",
      description = null,
      author = null,
      tax_percent = 0,
      // cover_image_key = null,
      //   ebook_storage_key,
    } = req.body;

    if (!/^\d+$/.test(productId) || Number(productId) <= 0) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const title = String(name || "").trim();
    const slug = slugify(title);
    const categoryId = Number(category_id);
    const productPrice = Number(price);
    const productStock = Number(stock);
    const taxPercent = Number(tax_percent);

    if (!title || title.length > 200 || !slug) {
      return res
        .status(400)
        .json({ message: "A valid product name is required" });
    }

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return res.status(400).json({ message: "A valid category is required" });
    }

    if (!Number.isFinite(productPrice) || productPrice < 0) {
      return res.status(400).json({ message: "Invalid product price" });
    }

    if (!Number.isInteger(productStock) || productStock < 0) {
      return res.status(400).json({ message: "Invalid stock quantity" });
    }

    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
      return res.status(400).json({ message: "Tax must be between 0 and 100" });
    }

    if (!["Active", "Inactive"].includes(status)) {
      return res.status(400).json({ message: "Invalid product status" });
    }

    const [existingRows] = await pool.execute(
      `SELECT ebook_storage_key, docx_storage_key, cover_image_key
   FROM products
   WHERE product_id = ? AND tenant_id = ?
   LIMIT 1`,
      [productId, TENANT_ID],
    );

    if (!existingRows.length) {
      return res.status(404).json({ message: "Product not found" });
    }

    oldStorageKey = existingRows[0].ebook_storage_key;
    oldDocxKey = existingRows[0].docx_storage_key;
    oldImageKey = existingRows[0].cover_image_key;

    const [categories] = await pool.execute(
      `SELECT category_id
       FROM categories
       WHERE category_id = ? AND tenant_id = ? AND is_active = 1
       LIMIT 1`,
      [categoryId, TENANT_ID],
    );

    if (!categories.length) {
      return res.status(400).json({
        message: "Selected category does not exist or is inactive",
      });
    }

    // If omitted, retain the existing private storage key.
    // let storageKey = ebook_storage_key;
    // let storageKey = req.file
    //   ? (newStorageKey = await saveEbook(req.file))
    //   : oldStorageKey;

    const pdfFile = req.files?.ebook?.[0];
    const docxFile = req.files?.docx?.[0];
    const imageFile = req.files?.coverImage?.[0];

    let storageKey = pdfFile
      ? (newStorageKey = await saveEbook(pdfFile))
      : oldStorageKey;

    let docxStorageKey = docxFile
      ? (newDocxKey = await saveDocx(docxFile))
      : oldDocxKey;

    const imageStorageKey = imageFile
      ? (newImageKey = await saveProductImage(imageFile))
      : oldImageKey;

    if (typeof storageKey !== "string" || !storageKey.trim()) {
      const [existing] = await pool.execute(
        `SELECT ebook_storage_key
         FROM products
         WHERE product_id = ? AND tenant_id = ?
         LIMIT 1`,
        [productId, TENANT_ID],
      );

      if (!existing.length) {
        return res.status(404).json({ message: "Product not found" });
      }

      storageKey = existing[0].ebook_storage_key;
    }

    const [result] = await pool.execute(
      `UPDATE products
       SET category_id = ?, title = ?, slug = ?, description = ?,
           author = ?, price = ?, stock = ?, tax_percent = ?,
           cover_image_key = ?, ebook_storage_key = ?,
           docx_storage_key = ?, is_active = ?
       WHERE product_id = ? AND tenant_id = ?`,
      [
        categoryId,
        title,
        slug,
        description,
        author,
        productPrice,
        productStock,
        taxPercent,
        // cover_image_key,
        imageStorageKey,
        storageKey.trim(),
        docxStorageKey || null,
        status === "Active" ? 1 : 0,
        productId,
        TENANT_ID,
      ],
    );

    if (result.affectedRows === 0 && newStorageKey) {
      const [existing] = await pool.execute(
        `SELECT product_id
         FROM products
         WHERE product_id = ? AND tenant_id = ?
         LIMIT 1`,
        [productId, TENANT_ID],
      );

      if (!existing.length) {
        return res.status(404).json({ message: "Product not found" });
      }
    }

    if (newStorageKey && oldStorageKey && oldStorageKey !== newStorageKey) {
      try {
        await deleteEbook(oldStorageKey);
      } catch (cleanupError) {
        console.error("Old e-book cleanup faild: ", cleanupError.message);
      }
    }

    if (newDocxKey && oldDocxKey && oldDocxKey !== newDocxKey) {
      try {
        const [references] = await pool.execute(
          `SELECT product_id FROM products
       WHERE docx_storage_key = ? LIMIT 1`,
          [oldDocxKey],
        );

        if (!references.length) {
          await deleteDocx(oldDocxKey);
        }
      } catch (cleanupError) {
        console.error("Old DOCX cleanup failed:", cleanupError.message);
      }
    }

    // OLD IMAGE CLEANUP
    if (newImageKey && oldImageKey && oldImageKey !== newImageKey) {
      try {
        const [references] = await pool.execute(
          `SELECT product_id
       FROM products
       WHERE cover_image_key = ?
       LIMIT 1`,
          [oldImageKey],
        );

        if (!references.length) {
          await deleteProductImage(oldImageKey);
        }
      } catch (cleanupError) {
        console.error(
          "Old product image cleanup failed:",
          cleanupError.message,
        );
      }
    }

    return res.json({ message: "Product updated successfully" });
  } catch (error) {
    if (newStorageKey) {
      try {
        await deleteEbook(newStorageKey);
      } catch (cleanupError) {
        console.error("New e-bbok cleanup failed", cleanupError.message);
      }
    }

    if (newDocxKey) {
      try {
        await deleteDocx(newDocxKey);
      } catch (cleanupError) {
        console.error("New DOCX cleanup failed:", cleanupError.message);
      }
    }

    if (newImageKey) {
      try {
        await deleteProductImage(newImageKey);
      } catch (cleanupError) {
        console.error(
          "New product image cleanup failed:",
          cleanupError.message,
        );
      }
    }

    return handleDatabaseError(error, res, "Unable to update product");
  }
};

// PATCH /api/admin/products/:id/status
exports.updateProductStatus = async (req, res) => {
  try {
    const productId = req.params.id;
    const { status } = req.body;

    if (!/^\d+$/.test(productId) || Number(productId) <= 0) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    if (!["Active", "Inactive"].includes(status)) {
      return res.status(400).json({
        message: "Status must be Active or Inactive",
      });
    }

    const [result] = await pool.execute(
      `UPDATE products
       SET is_active = ?
       WHERE product_id = ? AND tenant_id = ?`,
      [status === "Active" ? 1 : 0, productId, TENANT_ID],
    );

    if (result.affectedRows === 0) {
      const [existing] = await pool.execute(
        `SELECT product_id
         FROM products
         WHERE product_id = ? AND tenant_id = ?
         LIMIT 1`,
        [productId, TENANT_ID],
      );

      if (!existing.length) {
        return res.status(404).json({ message: "Product not found" });
      }
    }

    return res.json({
      message: `Product ${status.toLowerCase()} successfully`,
    });
  } catch (error) {
    return handleDatabaseError(error, res, "Unable to update product status");
  }
};

exports.createProductCategory = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();

    if (!name || name.length > 100) {
      return res.status(400).json({
        message: "Category name is required (maximum 100 characters)",
      });
    }

    const slug = name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);

    if (!slug) {
      return res.status(400).json({
        message: "Please provide a valid category name",
      });
    }

    const [existing] = await pool.execute(
      `SELECT category_id
        FROM categories
        WHERE tenant_id = ? AND slug = ?
        LIMIT 1`,
      [TENANT_ID, slug],
    );

    if (existing.length) {
      return res.status(409).json({
        message: "This category already exists",
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO categories
        (tenant_id, name, slug, is_active)
       VALUES (?, ?, ?, 1)`,
      [TENANT_ID, name, slug],
    );

    return res.status(201).json({
      message: "Category created successfully",
      category: {
        id: result.insertId,
        name,
        slug,
        is_active: 1,
      },
    });
  } catch (error) {
    console.error("Create category error:", error.message);

    return res.status(500).json({
      message: "Unable to create category",
    });
  }
};

exports.updateProductCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const name = String(req.body.name || "").trim();

    if (!/^\d+$/.test(categoryId) || Number(categoryId) <= 0) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    if (!name || name.length > 100) {
      return res.status(400).json({
        message: "Category name is required (maximum 100 characters)",
      });
    }

    const slug = slugify(name);

    if (!slug) {
      return res.status(400).json({
        message: "Please provide a valid category name",
      });
    }

    const [existing] = await pool.execute(
      `SELECT category_id
       FROM categories
       WHERE category_id = ? AND tenant_id = ?
       LIMIT 1`,
      [categoryId, TENANT_ID],
    );

    if (!existing.length) {
      return res.status(404).json({ message: "Category not found" });
    }

    const [duplicate] = await pool.execute(
      `SELECT category_id
       FROM categories
       WHERE tenant_id = ? AND slug = ? AND category_id <> ?
       LIMIT 1`,
      [TENANT_ID, slug, categoryId],
    );

    if (duplicate.length) {
      return res.status(409).json({
        message: "Another category already uses this name",
      });
    }

    await pool.execute(
      `UPDATE categories
       SET name = ?, slug = ?
       WHERE category_id = ? AND tenant_id = ?`,
      [name, slug, categoryId, TENANT_ID],
    );

    return res.json({
      message: "Category updated successfully",
      category: {
        id: Number(categoryId),
        name,
        slug,
      },
    });
  } catch (error) {
    return handleDatabaseError(error, res, "Unable to update category");
  }
};

exports.updateProductCategoryStatus = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const { status } = req.body;

    if (!/^\d+$/.test(categoryId) || Number(categoryId) <= 0) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    if (!["Active", "Inactive"].includes(status)) {
      return res.status(400).json({
        message: "Status must be Active or Inactive",
      });
    }

    const [categories] = await pool.execute(
      `SELECT category_id
       FROM categories
       WHERE category_id = ? AND tenant_id = ?
       LIMIT 1`,
      [categoryId, TENANT_ID],
    );

    if (!categories.length) {
      return res.status(404).json({ message: "Category not found" });
    }

    if (status === "Inactive") {
      const [products] = await pool.execute(
        `SELECT product_id
         FROM products
         WHERE category_id = ? AND tenant_id = ?
         LIMIT 1`,
        [categoryId, TENANT_ID],
      );

      if (products.length) {
        return res.status(409).json({
          message:
            "This category contains products. Reassign those products before deactivating it.",
        });
      }
    }

    await pool.execute(
      `UPDATE categories
       SET is_active = ?
       WHERE category_id = ? AND tenant_id = ?`,
      [status === "Active" ? 1 : 0, categoryId, TENANT_ID],
    );

    return res.json({
      message: `Category ${status.toLowerCase()} successfully`,
    });
  } catch (error) {
    return handleDatabaseError(error, res, "Unable to update category status");
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    if (!/^\d+$/.test(productId) || Number(productId) <= 0) {
      return res.status(400).json({
        message: "Invalid product ID",
      });
    }

    const [products] = await pool.execute(
      `SELECT ebook_storage_key
       FROM products
       WHERE product_id = ? AND tenant_id = ?
       LIMIT 1`,
      [productId, TENANT_ID],
    );

    if (!products.length) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    const storageKey = products[0].ebook_storage_key;

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [result] = await connection.execute(
        `DELETE FROM products
         WHERE product_id = ? AND tenant_id = ?`,
        [productId, TENANT_ID],
      );

      if (result.affectedRows !== 1) {
        await connection.rollback();

        return res.status(404).json({
          message: "Product not found",
        });
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    // Delete the PDF only if no remaining product references it.
    if (storageKey) {
      const [references] = await pool.execute(
        `SELECT product_id
         FROM products
         WHERE ebook_storage_key = ?
         LIMIT 1`,
        [storageKey],
      );

      if (!references.length) {
        try {
          await deleteEbook(storageKey);
        } catch (cleanupError) {
          console.error(
            "Deleted product PDF cleanup failed:",
            cleanupError.message,
          );
        }
      }
    }

    return res.json({
      message: "Product deleted successfully",
    });
  } catch (error) {
    return handleDatabaseError(error, res, "Unable to delete product");
  }
};

/**
 * Product-wise dynamic commission configuration
 * Existing table: product_referral_rules
 */

exports.getProductCommissions = async (req, res) => {
  const productId = Number(req.params.id);

  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return res.status(400).json({ message: "Invalid product ID" });
  }

  try {
    const [products] = await pool.execute(
      `SELECT product_id, title
       FROM products
       WHERE tenant_id = ? AND product_id = ?
       LIMIT 1`,
      [TENANT_ID, productId],
    );

    if (!products.length) {
      return res.status(404).json({ message: "Product not found" });
    }

    const [rows] = await pool.execute(
      `SELECT level, commission_percent,
              buyer_discount_percent, is_active
       FROM product_referral_rules
       WHERE tenant_id = ? AND product_id = ?
       ORDER BY level ASC`,
      [TENANT_ID, productId],
    );

    return res.json({
      product: products[0],
      active_levels: rows.filter((r) => Number(r.is_active) === 1).length,
      rules: rows.map((r) => ({
        level: Number(r.level),
        commission_percent: Number(r.commission_percent),
        buyer_discount_percent: Number(r.buyer_discount_percent),
        is_active: Boolean(r.is_active),
      })),
    });
  } catch (error) {
    console.error("GET_PRODUCT_COMMISSIONS_ERROR", error);
    return res.status(500).json({
      message: "Unable to load commission settings",
    });
  }
};

exports.updateProductCommissions = async (req, res) => {
  const productId = Number(req.params.id);
  const { levels } = req.body || {};

  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return res.status(400).json({ message: "Invalid product ID" });
  }

  if (!Array.isArray(levels) || levels.length > 255) {
    return res.status(400).json({
      message: "levels must be an array with at most 255 entries",
    });
  }

  // Empty array intentionally disables all commission levels.
  const rates = [];

  for (let i = 0; i < levels.length; i++) {
    const rule = levels[i];

    if (
      !rule ||
      typeof rule !== "object" ||
      Array.isArray(rule) ||
      !Number.isInteger(rule.level) ||
      rule.level !== i + 1 ||
      typeof rule.commission_percent !== "number" ||
      !Number.isFinite(rule.commission_percent) ||
      rule.commission_percent < 0 ||
      rule.commission_percent > 100 ||
      Math.round(rule.commission_percent * 100) !==
        rule.commission_percent * 100
    ) {
      return res.status(400).json({
        message:
          "Levels must be sequential from 1 with percentages from 0 to 100 (max 2 decimals)",
      });
    }

    rates.push(Math.round(rule.commission_percent * 100));
  }

  const totalBasisPoints = rates.reduce((sum, rate) => sum + rate, 0);

  if (totalBasisPoints > 10000) {
    return res.status(400).json({
      message: "Total commission cannot exceed 100%",
    });
  }

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Serializes concurrent changes for the same product.
    const [products] = await connection.execute(
      `SELECT product_id
       FROM products
       WHERE tenant_id = ? AND product_id = ?
       FOR UPDATE`,
      [TENANT_ID, productId],
    );

    if (!products.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Product not found" });
    }

    const [existingRules] = await connection.execute(
      `SELECT level, commission_percent,
              buyer_discount_percent, is_active
       FROM product_referral_rules
       WHERE tenant_id = ? AND product_id = ?
       ORDER BY level ASC`,
      [TENANT_ID, productId],
    );

    // Preserve existing rows, including buyer discounts.
    // Disable removed levels instead of deleting historical settings.
    await connection.execute(
      `UPDATE product_referral_rules
       SET is_active = 0
       WHERE tenant_id = ? AND product_id = ?`,
      [TENANT_ID, productId],
    );

    for (let i = 0; i < rates.length; i++) {
      await connection.execute(
        `INSERT INTO product_referral_rules
           (tenant_id, product_id, level,
            commission_percent, buyer_discount_percent, is_active)
         VALUES (?, ?, ?, ?, 0, 1)
         ON DUPLICATE KEY UPDATE
           commission_percent = VALUES(commission_percent),
           is_active = 1`,
        [TENANT_ID, productId, i + 1, (rates[i] / 100).toFixed(2)],
      );
    }

    // Record configuration changes for admin accountability.
    await connection.execute(
      `INSERT INTO audit_logs
         (tenant_id, actor_admin_id, action,
          entity_type, entity_id, before_data, after_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        TENANT_ID,
        req.admin.id,
        "PRODUCT_COMMISSIONS_UPDATED",
        "product",
        String(productId),
        JSON.stringify(existingRules),
        JSON.stringify({
          levels: levels.map((rule, i) => ({
            level: i + 1,
            commission_percent: rates[i] / 100,
          })),
          total_percent: totalBasisPoints / 100,
        }),
      ],
    );

    await connection.commit();

    return res.json({
      message: "Commission settings saved successfully",
      product_id: productId,
      active_levels: rates.length,
      total_percent: totalBasisPoints / 100,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("COMMISSION_ROLLBACK_ERROR", rollbackError);
      }
    }

    console.error("UPDATE_PRODUCT_COMMISSIONS_ERROR", error);

    return res.status(500).json({
      message: "Unable to update commission settings",
    });
  } finally {
    if (connection) connection.release();
  }
};
