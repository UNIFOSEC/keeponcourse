/**
 * Scripted stand-in for the Claude Messages API (streaming only), for running
 * Coach locally with no API key and no cost. Replies are canned, not real AI.
 *
 *   npm run mock                                  # listens on http://localhost:9099
 *   ANTHROPIC_BASE_URL=http://localhost:9099      # in .dev.vars
 *
 * What it does, based on the user's last message:
 *   "add ..."                 -> calls add_course
 *   "... done/complete ..."   -> calls update_course (status: Completed)
 *   "remove/delete ..."       -> calls remove_course
 *   "trigger-refusal"         -> stop_reason "refusal"
 *   anything else             -> a short Markdown study plan built from <course_data>
 * After tool results, it replies with a one-line confirmation.
 *
 * GET /__requests returns the last requests it received, so tests can check
 * what the proxy sent (model, tools, headers, echoed thinking blocks).
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 9099);
const received = [];
let counter = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lastUserText(messages) {
  const last = messages[messages.length - 1];
  const blocks = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
  const texts = blocks.filter((b) => b.type === "text" && !b.text.startsWith("<course_data"));
  return texts.map((b) => b.text).join("\n");
}

function courseData(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user" || typeof m.content === "string") continue;
    const block = m.content.find((b) => b.type === "text" && b.text.startsWith("<course_data"));
    if (block) {
      const today = /today="([\d-]+)"/.exec(block.text)?.[1] ?? "2026-01-01";
      const json = block.text.slice(block.text.indexOf("\n") + 1, block.text.lastIndexOf("</course_data>"));
      return { today, courses: JSON.parse(json) };
    }
  }
  return { today: "2026-01-01", courses: [] };
}

function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function findCourse(text, courses) {
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  return courses.find((c) => words.some((w) => c.name.toLowerCase().includes(w))) ?? courses[0];
}

/** Decide the scripted reply: { blocks: [...], stop_reason } */
function script(messages) {
  const last = messages[messages.length - 1];
  const thinking = { type: "thinking", thinking: "", signature: `mock-signature-${++counter}` };

  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) {
    const results = last.content.filter((b) => b.type === "tool_result");
    const failed = results.find((r) => r.is_error);
    const text = failed
      ? `I couldn't make that change: ${JSON.parse(failed.content).error}`
      : "Done. Your course list is updated. You can undo it from the card above if you change your mind.";
    return { blocks: [thinking, { type: "text", text }], stop_reason: "end_turn" };
  }

  const text = lastUserText(messages);
  const { today, courses } = courseData(messages);

  if (/trigger-refusal/i.test(text)) return { blocks: [], stop_reason: "refusal" };

  if (/\b(add|create)\b/i.test(text)) {
    return {
      blocks: [
        thinking,
        { type: "text", text: "Adding that to your list now." },
        {
          type: "tool_use",
          id: `toolu_mock_${counter}`,
          name: "add_course",
          input: {
            name: "Data Analysis with Excel",
            description: "Formulas, pivot tables and charts for turning raw data into clear reports.",
            target_date: addDays(today, 90),
            status: "Not Started",
          },
        },
      ],
      stop_reason: "tool_use",
    };
  }

  if (/\b(done|complete|completed|finished)\b/i.test(text) && courses.length) {
    const course = findCourse(text, courses);
    return {
      blocks: [thinking, { type: "tool_use", id: `toolu_mock_${counter}`, name: "update_course", input: { id: course.id, status: "Completed" } }],
      stop_reason: "tool_use",
    };
  }

  if (/\b(remove|delete)\b/i.test(text) && courses.length) {
    const course = findCourse(text, courses);
    return {
      blocks: [thinking, { type: "tool_use", id: `toolu_mock_${counter}`, name: "remove_course", input: { id: course.id } }],
      stop_reason: "tool_use",
    };
  }

  const overdue = courses.filter((c) => c.status !== "Completed" && c.target_date < today);
  const active = courses.filter((c) => c.status === "In Progress");
  const lines = [
    `Here's a focused plan for this week _(mock reply: start the proxy with a real key for real answers)_:`,
    "",
    overdue.length ? `**Catch up first:** ${overdue.map((c) => c.name).join(", ")} ${overdue.length === 1 ? "is" : "are"} overdue.` : "**Nothing is overdue.** Nice work.",
    "",
    "1. Pick **one** in-progress course and block three 45-minute sessions for it.",
    `2. Keep going with ${active[0] ? `**${active[0].name}**` : "your next course"}: finish one module before starting anything new.`,
    "3. On Friday, write down what you learned in `notes.md`, and move finished courses to **Completed**.",
    "",
    "- Small, regular sessions beat one long weekend sprint.",
    "- Reschedule deadlines that no longer feel realistic.",
  ];
  return { blocks: [thinking, { type: "text", text: lines.join("\n") }], stop_reason: "end_turn" };
}

async function streamReply(res, body) {
  const { blocks, stop_reason } = script(body.messages);
  const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "request-id": `req_mock_${counter}` });
  sse("message_start", {
    message: {
      id: `msg_mock_${counter}`, type: "message", role: "assistant", model: body.model, content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 },
    },
  });

  for (const [index, block] of blocks.entries()) {
    if (block.type === "thinking") {
      sse("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
      await sleep(250);
      sse("content_block_delta", { index, delta: { type: "signature_delta", signature: block.signature } });
    } else if (block.type === "text") {
      sse("content_block_start", { index, content_block: { type: "text", text: "" } });
      for (const piece of block.text.match(/\S+\s*|\s+/g) ?? []) {
        sse("content_block_delta", { index, delta: { type: "text_delta", text: piece } });
        await sleep(12);
      }
    } else if (block.type === "tool_use") {
      sse("content_block_start", { index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      const json = JSON.stringify(block.input);
      for (let i = 0; i < json.length; i += 24) {
        sse("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 24) } });
        await sleep(10);
      }
    }
    sse("content_block_stop", { index });
  }

  sse("message_delta", { delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 42 } });
  sse("message_stop", {});
  res.end();
}

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/__requests") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(received.slice(-20)));
      return;
    }
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw);
      const credential = req.headers["x-api-key"] || req.headers["authorization"];
      received.push({ headers: { "anthropic-beta": req.headers["anthropic-beta"], credential: credential ? "(set)" : "(missing)" }, body });
      if (!body.stream) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "mock supports streaming only" } }));
        return;
      }
      streamReply(res, body).catch((error) => {
        console.error(error);
        res.end();
      });
    });
  })
  .listen(PORT, () => console.log(`Mock Claude API on http://localhost:${PORT} (scripted replies, no real AI)`));
