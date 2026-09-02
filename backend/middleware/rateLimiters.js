const rateLimit = require("express-rate-limit");

// Shared rate limiters for the endpoints that cost money / burn third-party
// free-tier quota (Groq chat, Groq Whisper/TTS, file parsing). All of them
// key off the client IP (server.js sets `trust proxy` so this is the real
// caller behind Render's proxy) and return HTTP 429 with a JSON body plus
// standard RateLimit-* headers when tripped.
//
// These are a courtesy guard against a single user hammering the app; they
// do NOT replace handling upstream 429s from Groq/Tavily themselves, which
// have their own separate quotas (see README "Free-tier limitations").

// The agent endpoints each trigger 1..n Groq completions plus tool calls,
// so they're the most expensive. ~15 agent turns per 5 minutes per IP.
const agentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      "You're sending messages too quickly. Please wait a minute and try again.",
  },
});

// Voice transcription + TTS also hit Groq (Whisper / Orpheus), which have
// their own 20 req/min free-tier cap. Keep this comfortably under that.
const voiceLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many voice requests. Please wait a moment and try again." },
});

// File extraction is CPU-bound (pdf-parse) rather than quota-bound, but a
// flood of large uploads can still pin the free-tier dyno.
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many file uploads. Please wait a few minutes and try again." },
});

module.exports = { agentLimiter, voiceLimiter, uploadLimiter };
