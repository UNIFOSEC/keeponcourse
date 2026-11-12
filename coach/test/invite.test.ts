import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { buildInviteEmail, isEmail, isPlainName } from "../src/invite";
import { memoryKv } from "./memoryKv";

const APP = "https://keeponcourse.com";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXRlc3Q";
const TOKEN = "c3".repeat(32);
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

afterEach(() => vi.unstubAllGlobals());

describe("invite email", () => {
  it("accepts names, not links or sentences", () => {
    for (const ok of ["Alex", "Ana María", "J. O'Neil", "Jean-Luc", "Alex R.", "李雷"]) expect(isPlainName(ok), ok).toBe(true);
    for (const bad of ["scam.com", "Win at bit.ly", "www shop", "http://x", "Alex!!!", "Call 555", "", " ", "a".repeat(41)]) expect(isPlainName(bad), bad).toBe(false);
  });

  it("checks addresses", () => {
    expect(isEmail("sam@example.com")).toBe(true);
    for (const bad of ["sam", "sam@", "sam@example", "a@b.c", "sam @example.com", "a@x.com,b@y.com", "<a@x.com>"]) expect(isEmail(bad), bad).toBe(false);
  });

  it("is a fixed message with the link, escaped", () => {
    const email = buildInviteEmail("Ana <b>", `${APP}/#/p/${TOKEN}`, false);
    expect(email.subject).toBe("Ana <b> invited you to follow their study progress");
    expect(email.html).toContain("Ana &lt;b&gt; wants you in their corner");
    expect(email.html).not.toContain("<b>");
    expect(email.html).toContain(`href="${APP}/#/p/${TOKEN}"`);
    expect(email.text).toContain(`See Ana <b>'s progress: ${APP}/#/p/${TOKEN}`);
    expect(email.text).toContain("We don't keep your address");
    expect(email.text).not.toContain("Reply to this email");
    expect(buildInviteEmail("Ana", "x", true).text).toContain("Reply to this email to reach Ana.");
  });
});

describe("POST /partners/invite", () => {
  const env = (): Env => ({
    ANTHROPIC_API_KEY: "x",
    ALLOWED_ORIGINS: APP,
    SUPABASE_URL: "https://db.example",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    RESEND_API_KEY: "re_test_not_real",
    APP_URL: APP,
    COACH_USAGE: memoryKv().kv,
  });

  function stub({ displayName = "Alex", userStatus = 200, resendStatus = 200 } = {}) {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/auth/v1/user")) {
        expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${JWT}`);
        return Response.json({ id: "user-1", email: "alex@example.com" }, { status: userStatus });
      }
      if (url.endsWith("/rpc/my_partners")) return Response.json([{ id: 7, label: "Sam", display_name: displayName, token: TOKEN }]);
      if (url === "https://api.resend.com/emails") {
        sent.push(JSON.parse(String(init.body)));
        return Response.json({ id: "e1" }, { status: resendStatus });
      }
      return new Response("unexpected", { status: 500 });
    });
    return sent;
  }

  const post = (e: Env, body: unknown, headers: Record<string, string> = { Origin: APP, Authorization: `Bearer ${JWT}` }) =>
    worker.fetch(new Request("https://coach.example/partners/invite", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }), e, ctx);

  it("sends the caller's own invite link, with a reply-to only when asked", async () => {
    const sent = stub();
    const e = env();
    const ok = await post(e, { invite_id: 7, email: " sam@example.com " });
    expect(ok.status).toBe(200);
    expect(sent[0]).toMatchObject({ to: ["sam@example.com"], from: "KeepOnCourse <hello@keeponcourse.com>", subject: "Alex invited you to follow their study progress" });
    expect(sent[0].html).toContain(`${APP}/#/p/${TOKEN}`);
    expect(sent[0]).not.toHaveProperty("reply_to");

    await post(e, { invite_id: 7, email: "sam@example.com", reply_to: true });
    expect(sent[1]).toMatchObject({ reply_to: "alex@example.com" });
  });

  it("refuses without sign-in, from other sites, for others' invites and bad addresses", async () => {
    const sent = stub();
    const e = env();
    expect((await post(e, { invite_id: 7, email: "sam@example.com" }, { Origin: APP })).status).toBe(401);
    expect((await post(e, { invite_id: 7, email: "sam@example.com" }, { Origin: "https://evil.example", Authorization: `Bearer ${JWT}` })).status).toBe(403);
    expect((await post(e, { invite_id: 8, email: "sam@example.com" })).status).toBe(404);
    expect((await post(e, { invite_id: 7, email: "a@x.com, b@y.com" })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("won't put a link-like name in the email", async () => {
    const sent = stub({ displayName: "Free money at scam.com" });
    const response = await post(env(), { invite_id: 7, email: "sam@example.com" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/just a name/);
    expect(sent).toHaveLength(0);
  });

  it("caps invite emails at 5 a day per account", async () => {
    const sent = stub();
    const e = env();
    for (let i = 0; i < 5; i++) expect((await post(e, { invite_id: 7, email: `p${i}@example.com` })).status).toBe(200);
    const sixth = await post(e, { invite_id: 7, email: "p6@example.com" });
    expect(sixth.status).toBe(429);
    expect(sent).toHaveLength(5);
  });

  it("reports an expired sign-in and a failed send", async () => {
    stub({ userStatus: 401 });
    expect((await post(env(), { invite_id: 7, email: "sam@example.com" })).status).toBe(401);
    vi.spyOn(console, "error").mockImplementation(() => {});
    stub({ resendStatus: 500 });
    expect((await post(env(), { invite_id: 7, email: "sam@example.com" })).status).toBe(502);
  });
});
