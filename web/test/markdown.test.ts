// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/coach/markdown";

function render(source: string): HTMLElement {
  const root = document.createElement("div");
  root.append(...renderMarkdown(source));
  return root;
}

describe("renderMarkdown", () => {
  it("renders the formatting Coach uses", () => {
    const root = render("**Plan**\n\n1. First\n2. Second\n\n- one\n- two\n\nUse `notes.md` and *focus*.\n\n```\ncode block\n```");
    expect(root.querySelector("strong")?.textContent).toBe("Plan");
    expect(root.querySelectorAll("ol li")).toHaveLength(2);
    expect(root.querySelectorAll("ul li")).toHaveLength(2);
    expect(root.querySelector("code.md-code")?.textContent).toBe("notes.md");
    expect(root.querySelector("em")?.textContent).toBe("focus");
    expect(root.querySelector("pre code")?.textContent).toBe("code block");
  });

  it("never turns text into HTML", () => {
    const root = render('<img src=x onerror="alert(1)"> <script>alert(2)</script> **<b>bold</b>**');
    expect(root.querySelector("img, script, b")).toBeNull();
    expect(root.textContent).toContain("<img src=x");
  });

  it("only links to http(s), with safe link attributes", () => {
    const root = render("[bad](javascript:alert(1)) [data](data:text/html,x) [good](https://example.com/page)");
    const links = [...root.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://example.com/page");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(root.textContent).toContain("bad");
  });

  it("copes with half-finished Markdown while a reply streams in", () => {
    expect(() => render("**unfinished\n```\nstill typing")).not.toThrow();
  });
});
