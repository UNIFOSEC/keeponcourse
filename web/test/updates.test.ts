import { describe, expect, it, vi } from "vitest";
import { isNewerVersionAvailable } from "../src/updates";

const reply = (body: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("isNewerVersionAvailable", () => {
  it("is true only when the published build differs", async () => {
    expect(await isNewerVersionAvailable("abc-1", reply({ build: "abc-2" }))).toBe(true);
    expect(await isNewerVersionAvailable("abc-1", reply({ build: "abc-1" }))).toBe(false);
  });

  it("treats errors and odd responses as no update", async () => {
    expect(await isNewerVersionAvailable("abc-1", reply({ build: "x" }, 404))).toBe(false);
    expect(await isNewerVersionAvailable("abc-1", reply({ nope: true }))).toBe(false);
    expect(await isNewerVersionAvailable("abc-1", vi.fn().mockRejectedValue(new TypeError("offline")) as unknown as typeof fetch)).toBe(false);
  });

  it("always asks the network, never a cached copy", async () => {
    const fetchMock = reply({ build: "abc-1" });
    await isNewerVersionAvailable("abc-1", fetchMock);
    expect(fetchMock).toHaveBeenCalledWith("./version.json", { cache: "no-store" });
  });
});
