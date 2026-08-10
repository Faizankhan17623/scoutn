const { runAgentStream, generateTitle, generateFollowUps } = require("../services/llmService");
const Conversation = require("../models/Conversation");

function titleFromMessage(text) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

function sessionTokenOf(req) {
  const token = req.header("X-Session-Token");
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

async function listConversations(req, res) {
  const sessionToken = sessionTokenOf(req);
  if (!sessionToken) {
    return res.json({ conversations: [] });
  }

  const conversations = await Conversation.find({ sessionToken }, "title createdAt updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  return res.json({ conversations });
}

async function getConversation(req, res) {
  const sessionToken = sessionTokenOf(req);
  const conversation = await Conversation.findOne({ _id: req.params.id, sessionToken }, "-sessionToken").lean();

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  return res.json({ conversation });
}

function startSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Render/Heroku/etc. sit behind an nginx proxy that buffers the whole
    // response by default, so no tokens reach the browser until the handler
    // ends — and if the agent run outlasts the proxy's read timeout the
    // connection is dropped with nothing logged on our side. This header
    // tells nginx to stream through untouched.
    "X-Accel-Buffering": "no",
  });
  // Flush headers immediately so the client sees a 200 and an open stream
  // before the first (possibly slow) LLM round trip.
  if (typeof res.flushHeaders === "function") res.flushHeaders();
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// A comment line every 15s keeps intermediaries (and the browser) from
// treating a long tool-calling phase — where no tokens are emitted yet — as
// an idle/dead connection and closing it.
function startHeartbeat(res) {
  const timer = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);
  timer.unref?.();
  return () => clearInterval(timer);
}

// Turn an agent/LLM failure into a message that's actually useful to the
// user (and visible in the browser Network tab / console), instead of the
// old opaque "Failed to get a response from the agent". The upstream layers
// already produce specific messages — Groq HTTP status + body, model-not-
// found, empty-response, tool-round overflow, provider rate limits — so we
// pass those through, only falling back to the generic line for a truly
// unrecognised error.
function agentErrorMessage(err) {
  const raw = (err && err.message) || "";

  if (/Groq API error/i.test(raw)) return raw;
  if (/model_not_found|does not exist or you do not have access/i.test(raw)) {
    return "The configured model is unavailable on this account. Check GROQ_MODEL.";
  }
  if (/empty response/i.test(raw)) return "The model returned an empty response. Please try again.";
  if (/maximum tool-call rounds/i.test(raw)) {
    return "The agent got stuck calling tools without finishing. Please rephrase and try again.";
  }
  if (/rate limit|429/i.test(raw)) {
    return "A provider rate limit was hit. Please wait a moment and try again.";
  }
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(raw)) {
    return "Couldn't reach the model provider (network error). Please try again.";
  }

  return raw || "Failed to get a response from the agent";
}

function omitSessionToken(conversation) {
  const obj = conversation.toObject ? conversation.toObject() : conversation;
  const { sessionToken, ...rest } = obj;
  return rest;
}

async function createConversation(req, res) {
  const { message, deepResearch } = req.body;
  const sessionToken = sessionTokenOf(req);

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }
  if (!sessionToken) {
    return res.status(400).json({ error: "X-Session-Token header is required" });
  }

  const userMessage = message.trim();
  startSSE(res);
  const stopHeartbeat = startHeartbeat(res);

  try {
    const { response, searches, toolCalls } = await runAgentStream(
      [{ role: "user", content: userMessage }],
      (token) => sendEvent(res, "token", { token }),
      { deepResearch: !!deepResearch }
    );

    const followUps = await generateFollowUps(userMessage, response);

    const conversation = await Conversation.create({
      title: titleFromMessage(userMessage),
      sessionToken,
      messages: [
        { role: "user", content: userMessage },
        { role: "assistant", content: response, searches, toolCalls, followUps },
      ],
    });

    sendEvent(res, "done", { conversation: omitSessionToken(conversation) });

    // Refine the title in the background so the response isn't held up
    // waiting on a third model call; the sidebar just updates a moment
    // later once it's ready.
    generateTitle(userMessage, response)
      .then((title) => {
        if (title) return Conversation.updateOne({ _id: conversation._id }, { title });
      })
      .catch(() => {});
  } catch (err) {
    console.error("Create conversation error:", err.message);
    sendEvent(res, "error", { error: agentErrorMessage(err) });
  } finally {
    stopHeartbeat();
    res.end();
  }
}

async function deleteConversation(req, res) {
  const sessionToken = sessionTokenOf(req);
  const conversation = await Conversation.findOneAndDelete({ _id: req.params.id, sessionToken });

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  return res.status(204).send();
}

async function addMessage(req, res) {
  const { message, deepResearch } = req.body;
  const sessionToken = sessionTokenOf(req);

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  const conversation = await Conversation.findOne({ _id: req.params.id, sessionToken });

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const userMessage = message.trim();
  startSSE(res);
  const stopHeartbeat = startHeartbeat(res);

  try {
    const history = [
      ...conversation.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userMessage },
    ];

    const { response, searches, toolCalls } = await runAgentStream(
      history,
      (token) => sendEvent(res, "token", { token }),
      { deepResearch: !!deepResearch }
    );

    const followUps = await generateFollowUps(userMessage, response);

    conversation.messages.push({ role: "user", content: userMessage });
    conversation.messages.push({ role: "assistant", content: response, searches, toolCalls, followUps });
    await conversation.save();

    sendEvent(res, "done", { conversation: omitSessionToken(conversation) });
  } catch (err) {
    console.error("Add message error:", err.message);
    sendEvent(res, "error", { error: agentErrorMessage(err) });
  } finally {
    stopHeartbeat();
    res.end();
  }
}

// Edits a previous user message in place, drops everything that came after
// it, and regenerates the assistant reply from that point — i.e. branches
// the conversation from an earlier turn instead of appending to the end.
async function editMessage(req, res) {
  const { message } = req.body;
  const sessionToken = sessionTokenOf(req);
  const index = Number(req.params.index);

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  const conversation = await Conversation.findOne({ _id: req.params.id, sessionToken });

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= conversation.messages.length ||
    conversation.messages[index].role !== "user"
  ) {
    return res.status(400).json({ error: "Invalid message index" });
  }

  const userMessage = message.trim();
  startSSE(res);
  const stopHeartbeat = startHeartbeat(res);

  try {
    const history = [
      ...conversation.messages.slice(0, index).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userMessage },
    ];

    const { response, searches, toolCalls } = await runAgentStream(history, (token) =>
      sendEvent(res, "token", { token })
    );

    const followUps = await generateFollowUps(userMessage, response);

    conversation.messages.splice(index, conversation.messages.length - index);
    conversation.messages.push({ role: "user", content: userMessage });
    conversation.messages.push({ role: "assistant", content: response, searches, toolCalls, followUps });
    await conversation.save();

    sendEvent(res, "done", { conversation: omitSessionToken(conversation) });
  } catch (err) {
    console.error("Edit message error:", err.message);
    sendEvent(res, "error", { error: agentErrorMessage(err) });
  } finally {
    stopHeartbeat();
    res.end();
  }
}

module.exports = {
  listConversations,
  getConversation,
  createConversation,
  deleteConversation,
  addMessage,
  editMessage,
};
