const express = require("express");
const multer = require("multer");
const { extract } = require("../controllers/fileController");
const { uploadLimiter } = require("../middleware/rateLimiters");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = express.Router();

router.post("/files/extract", uploadLimiter, upload.single("file"), extract);

module.exports = router;
