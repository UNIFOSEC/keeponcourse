import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { PLAN_LIMITS, planFromSyllabus, validatePlanRequest } from "../src/planner";
import { RequestError } from "../src/validate";

const SYLLABUS = "Week 1: Variables and types\nWeek 2: Control flow\nWeek 3: Functions and modules";
const PDF = Buffer.from("%PDF-1.7\n% test file\n").toString("base64");

describe("validatePlanRequest", () => {
  it("accepts syllabus text or a PDF, and trims the name hint", () => {
    expect(validatePlanRequest({ text: `  ${SYLLABUS}  `, name_hint: " Python " })).toEqual({ text: SYLLABUS, nameHint: "Python" });
    expect(validatePlanRequest({ pdf_base64: PDF })).toEqual({ pdfBase64: PDF, nameHint: "" });
  });

  it.each([
    ["nothing", {}],
    ["both text and a PDF", { text: SYLLABUS, pdf_base64: PDF }],
    ["text that's too short", { text: "Week 1" }],
    ["text that's too long", { text: "x".repeat(PLAN_LIMITS.textMax + 1) }],
    ["a file that isn't base64", { pdf_base64: "<<not base64>>" }],
    ["a file that isn't a PDF", { pdf_base64: Buffer.from("<html>hello</html>").toString("base64") }],
    ["a PDF over 4 MB", { pdf_base64: "JVBERi0" + "A".repeat(6 * 1024 * 1024) }],
  ])("rejects %s", (_label, body) => {
    expect(() => validatePlanRequest(body)).toThrow(RequestError);
  });
});

/** A stand-in for the Anthropic client that returns a fixed response. */
function fakeClient(response: Partial<Anthropic.Message>) {
  const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [], ...response });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const reply = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] as Anthropic.ContentBlock[] });

describe("planFromSyllabus", () => {
  it("asks for structured output and wraps the material as data", async () => {
    const { client, create } = fakeClient(reply({ course_name: "Python", description: "d", suggested_weeks: 6, modules: [{ title: "Basics", summary: "s", hours: 3 }] }));
    const plan = await planFromSyllabus(client, "claude-haiku-5-5", { text: SYLLABUS, nameHint: "Python" });
    expect(plan.modules).toEqual([{ title: "Basics", summary: "s", hours: 3 }]);

    const request = create.mock.calls[0][0];
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.output_config.format.type).toBe("json_schema");
    expect(request.tools).toBeUndefined();
    expect(request.messages[0].content[0].text).toContain(`<course_material>\n${SYLLABUS}\n</course_material>`);
  });

  it("sends a PDF as a document block", async () => {
    const { client, create } = fakeClient(reply({ course_name: "C", description: "", suggested_weeks: 1, modules: [] }));
    await planFromSyllabus(client, "m", { pdfBase64: PDF });
    expect(create.mock.calls[0][0].messages[0].content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf", data: PDF } });
  });

  it("clamps whatever the model returns before it reaches the browser", async () => {
    const { client } = fakeClient(
      reply({
        course_name: "  ",
        description: "x".repeat(1000),
        suggested_weeks: 9999,
        modules: [
          { title: "A".repeat(300), summary: "line\n\nbreaks", hours: 1000 },
          { title: "Tiny", summary: "", hours: 0.01 },
          { title: "Not a number", summary: "", hours: "lots" },
          { title: "", summary: "untitled modules are dropped", hours: 2 },
          "not an object",
          ...Array.from({ length: 40 }, (_, i) => ({ title: `Extra ${i}`, summary: "", hours: 1 })),
        ],
      }),
    );
    const plan = await planFromSyllabus(client, "m", { text: SYLLABUS });
    expect(plan.course_name).toBe("Untitled course");
    expect(plan.description).toHaveLength(300);
    expect(plan.suggested_weeks).toBe(104);
    expect(plan.modules).toHaveLength(PLAN_LIMITS.modules);
    expect(plan.modules[0]).toEqual({ title: "A".repeat(80), summary: "line breaks", hours: 60 });
    expect(plan.modules[1].hours).toBe(0.25);
    expect(plan.modules[2].hours).toBe(1);
  });

  it("turns refusals and truncated replies into friendly errors", async () => {
    await expect(planFromSyllabus(fakeClient({ stop_reason: "refusal" }).client, "m", { text: SYLLABUS })).rejects.toThrow(RequestError);
    await expect(planFromSyllabus(fakeClient({ stop_reason: "max_tokens" }).client, "m", { text: SYLLABUS })).rejects.toThrow(/too long/);
  });
});
