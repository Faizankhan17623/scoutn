const express = require("express");
const {
  listConversations,
  getConversation,
  createConversation,
  deleteConversation,
  addMessage,
  editMessage,
} = require("../controllers/conversationController");
const { agentLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.get("/conversations", listConversations);
router.get("/conversations/:id", getConversation);
router.post("/conversations", agentLimiter, createConversation);
router.delete("/conversations/:id", deleteConversation);
router.post("/conversations/:id/messages", agentLimiter, addMessage);
router.put("/conversations/:id/messages/:index", agentLimiter, editMessage);

module.exports = router;
