// Static description of Scout's capabilities, shown instantly by the
// /help slash command with no backend call. Kept here as plain data (rather
// than asking the model) so it can never hallucinate or drift from what the
// app actually offers, and costs nothing against rate limits or Groq usage.
export const HELP_TEXT = `### What Scout can do

Scout is an agent — it decides when to just answer and when to use a tool first.

**Tools it can call**
- 🔎 **Web search** — live results for current events or facts, with sources
- ☀️ **Weather** — current conditions + 3-day forecast for any location
- 🖼️ **Image generation** — describe an image and Scout will generate it
- 📖 **Wikipedia lookup** — quick encyclopedic summaries
- 🔗 **Read a page** — paste a URL and Scout reads the full page, not just a snippet
- 🐙 **Explain a GitHub repo** — paste a repo link for an architecture walkthrough
- 💻 **Run code** — Scout executes a snippet in a real sandbox and shows the actual output

**Other features**
- 🧠 **Deep research mode** — toggle it on for a multi-source, structured report instead of a short answer
- 📎 **File attachments** — upload a PDF, .txt, .md, or .csv and ask questions about it
- 🎙️ **Voice input** — use the mic button to speak your message instead of typing
- ✏️ **Edit & regenerate** — edit any of your earlier messages to branch the conversation from there
- 💡 **Follow-up suggestions** — one-click prompts after every reply

Just type your question normally — Scout picks the right tool on its own.`;

export function isHelpCommand(text) {
  return /^\/help\s*$/i.test(text.trim());
}
