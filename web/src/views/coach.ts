import { errorMessage } from "../app";
import { MAX_INPUT, type Item } from "../coach/session";
import { renderMarkdown } from "../coach/markdown";
import type { CoachAction } from "../coach/tools";
import { formatDate } from "../dates";
import { button, emptyState, pageHeader, type Ctx, type View } from "../ui/components";
import { cx, h } from "../ui/dom";
import { icon, type IconName } from "../ui/icons";
import { toast } from "../ui/toast";

const SUGGESTIONS = [
  "What should I focus on this week?",
  "Which courses are overdue, and how do I catch up?",
  "Make me a 4-week plan for my in-progress courses",
  "Add an Excel course, due in 3 months",
];

export function createCoach(ctx: Ctx): View {
  const { app, coach } = ctx;

  if (!coach.configured) {
    const el = h(
      "div",
      { class: "page" },
      pageHeader("Coach", "Your AI learning assistant, powered by Claude."),
      emptyState(
        "sparkles",
        "Coach isn't connected in this build",
        "Coach needs its small server (the proxy that keeps the Claude API key secret). Set VITE_COACH_URL when building. See coach/README.md.",
      ),
    );
    return { el, update() {} };
  }

  // ------------------------------------------------------------ composer

  const input = h("textarea", {
    class: "composer-input",
    attrs: { rows: 1, maxlength: MAX_INPUT, placeholder: "Ask Coach about your learning plan…", "aria-label": "Message Coach" },
    on: {
      input: () => {
        autosize();
        renderComposer();
      },
      keydown: (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          submit();
        }
      },
    },
  });
  const sendBtn = h("button", { class: "composer-send", attrs: { type: "button" }, on: { click: () => (coach.busy ? coach.stop() : submit()) } });
  const counter = h("span", { class: "composer-counter", attrs: { "aria-live": "polite" } });
  const usageEl = h("span", { class: "composer-usage" });

  function renderUsage() {
    const usage = coach.usage;
    if (!usage) {
      usageEl.replaceChildren();
      return;
    }
    const text = usage.signedIn
      ? `${usage.remaining} of ${usage.limit} messages left today`
      : `${usage.remaining} of ${usage.limit} free messages left today`;
    usageEl.classList.toggle("is-low", usage.remaining <= Math.max(2, Math.floor(usage.limit * 0.2)));
    usageEl.replaceChildren(text);
    if (!usage.signedIn && app.account.state.status !== "disabled") {
      usageEl.append(h("button", { class: "link-btn", attrs: { type: "button" }, on: { click: () => ctx.openAccount() } }, "Sign in for more"));
    }
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
  }

  function submit(text = input.value) {
    if (!text.trim() || coach.busy) return;
    input.value = "";
    autosize();
    void coach.send(text);
  }

  function renderComposer() {
    renderUsage();
    const busy = coach.busy;
    sendBtn.replaceChildren(icon(busy ? "stop" : "arrowUp", 18));
    sendBtn.setAttribute("aria-label", busy ? "Stop" : "Send");
    sendBtn.title = busy ? "Stop" : "Send (Enter)";
    sendBtn.classList.toggle("is-stop", busy);
    sendBtn.disabled = !busy && !input.value.trim();
    const length = input.value.length;
    counter.textContent = length > MAX_INPUT * 0.75 ? `${length} / ${MAX_INPUT}` : "";
  }

  // ---------------------------------------------------------- transcript

  const transcript = h("div", { class: "transcript", attrs: { role: "log", "aria-label": "Conversation with Coach" } });
  const announcer = h("p", { class: "sr-only", attrs: { "aria-live": "polite" } });
  const rendered = new Map<string, { el: HTMLElement; key: string }>();
  const typing = h("div", { class: "msg msg-assistant typing-row" });
  let wasBusy = false;

  function itemKey(item: Item): string {
    if (item.kind === "assistant") return `${item.streaming}|${item.text}`;
    if (item.kind === "action") return `${item.undone}|${app.courses.some((c) => c.id === actionCourseId(item.action))}`;
    return "static";
  }

  function renderTranscript() {
    const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 120;

    if (coach.items.length === 0) {
      rendered.clear();
      transcript.replaceChildren(welcome());
      return;
    }

    const children: HTMLElement[] = [];
    const live = new Set<string>();
    for (const item of coach.items) {
      live.add(item.id);
      const key = itemKey(item);
      let entry = rendered.get(item.id);
      if (!entry || entry.key !== key) {
        entry = { el: renderItem(item), key };
        rendered.set(item.id, entry);
      }
      children.push(entry.el);
    }
    for (const id of rendered.keys()) if (!live.has(id)) rendered.delete(id);

    // Show the typing row until reply text starts streaming
    const last = coach.items[coach.items.length - 1];
    if (coach.busy && !(last.kind === "assistant" && last.streaming)) {
      typing.replaceChildren(
        avatar(),
        h(
          "div",
          { class: "typing" },
          h("span", { class: "dots", attrs: { "aria-hidden": "true" } }, h("span"), h("span"), h("span")),
          coach.phase === "acting" ? "Updating your courses…" : "Thinking…",
        ),
      );
      children.push(typing);
    }

    transcript.replaceChildren(...children);
    transcript.setAttribute("aria-busy", String(coach.busy));
    if (nearBottom || coach.busy) transcript.scrollTop = transcript.scrollHeight;

    if (wasBusy && !coach.busy) {
      const reply = [...coach.items].reverse().find((i) => i.kind === "assistant");
      announcer.textContent = reply && reply.kind === "assistant" ? `Coach replied: ${reply.text.slice(0, 200)}` : "Coach finished.";
    }
    wasBusy = coach.busy;
  }

  function welcome(): HTMLElement {
    const count = app.courses.length;
    return h(
      "div",
      { class: "coach-welcome" },
      h("div", { class: "coach-hero-avatar" }, icon("sparkles", 28)),
      h("h2", {}, "Hi, I'm Coach"),
      h(
        "p",
        {},
        count
          ? `I can see your ${count} course${count === 1 ? "" : "s"}. Ask me to plan your week, explain a topic, or update your list for you.`
          : "Ask me to plan what to learn next, or to add your first course.",
      ),
      h(
        "div",
        { class: "suggestions" },
        SUGGESTIONS.map((text) =>
          h("button", { class: "suggestion", attrs: { type: "button" }, on: { click: () => submit(text) } }, icon("sparkles", 15), h("span", {}, text)),
        ),
      ),
    );
  }

  function renderItem(item: Item): HTMLElement {
    switch (item.kind) {
      case "user":
        return h("div", { class: "msg msg-user" }, h("div", { class: "bubble" }, item.text));
      case "assistant":
        return h(
          "div",
          { class: "msg msg-assistant" },
          avatar(),
          h("div", { class: cx("bubble", "md", item.streaming && "is-streaming") }, renderMarkdown(item.text)),
        );
      case "notice":
        return h(
          "div",
          { class: `notice notice-${item.tone}`, attrs: item.tone === "error" ? { role: "alert" } : {} },
          icon(item.tone === "error" ? "alert" : "info", 16),
          h("span", {}, item.text),
        );
      case "action":
        return actionCard(item);
    }
  }

  function actionCard(item: Extract<Item, { kind: "action" }>): HTMLElement {
    const { action } = item;
    const meta: Record<CoachAction["kind"], { icon: IconName; verb: string }> = {
      added: { icon: "plus", verb: "Added" },
      updated: { icon: "pencil", verb: "Updated" },
      removed: { icon: "trash", verb: "Removed" },
    };
    const course = action.kind === "updated" ? action.after : action.course;
    const current = app.courses.find((c) => c.id === course.id);

    return h(
      "div",
      { class: cx("action-card", `action-${action.kind}`, item.undone && "is-undone") },
      h("span", { class: "action-icon" }, icon(meta[action.kind].icon, 17)),
      h(
        "div",
        { class: "action-text" },
        h("strong", {}, `${meta[action.kind].verb} "${course.name}"`),
        h("span", { class: "muted" }, item.undone ? "Undone" : describe(action)),
      ),
      h(
        "div",
        { class: "action-buttons" },
        !item.undone && current && action.kind !== "removed" && button("Open", () => ctx.openCourse(current), { size: "sm" }),
        !item.undone &&
          button(
            "Undo",
            () => {
              coach.undo(item.id).then(
                () => toast("Change undone", { tone: "success" }),
                (error) => toast(errorMessage(error), { tone: "error" }),
              );
            },
            { size: "sm", iconName: "undo" },
          ),
      ),
    );
  }

  // --------------------------------------------------------------- side

  const sideCount = h("strong", {});
  const side = h(
    "aside",
    { class: "coach-side" },
    h(
      "section",
      { class: "card side-card" },
      h("h2", {}, "What Coach can see"),
      h("p", { class: "muted" }, sideCount, " from your ", h("a", { class: "link", attrs: { href: "#/courses" } }, "course list"), ", plus today's date."),
      h("h2", {}, "What it can do"),
      h(
        "ul",
        { class: "side-list" },
        sideItem("calendar", "Plan your week and set realistic deadlines"),
        sideItem("book", "Explain topics from your courses"),
        sideItem("pencil", "Add, update or remove courses. Every change can be undone."),
      ),
    ),
    h(
      "section",
      { class: "card side-card side-privacy" },
      h("h2", {}, icon("shield", 16), "Privacy"),
      h(
        "p",
        { class: "muted" },
        "Your messages and course list are sent to Anthropic's Claude API to answer you. Don't share personal information. Coach can make mistakes.",
      ),
    ),
  );

  function sideItem(iconName: IconName, text: string) {
    return h("li", {}, icon(iconName, 16), h("span", {}, text));
  }

  // --------------------------------------------------------------- page

  const newChat = button("New chat", () => {
    coach.reset();
    input.focus();
  }, { iconName: "compose" });

  const el = h(
    "div",
    { class: "page coach-page" },
    pageHeader("Coach", "Your AI learning assistant, powered by Claude.", newChat),
    h(
      "div",
      { class: "coach-layout" },
      h(
        "section",
        { class: "chat card", attrs: { "aria-label": "Chat" } },
        transcript,
        h(
          "div",
          { class: "composer" },
          h("div", { class: "composer-box" }, input, sendBtn),
          h("div", { class: "composer-foot" }, h("span", {}, "Enter to send · Shift+Enter for a new line"), usageEl, counter),
        ),
        announcer,
      ),
      side,
    ),
  );

  function update() {
    if (coach.restoredDraft !== null) {
      if (!input.value) input.value = coach.restoredDraft;
      coach.restoredDraft = null;
      autosize();
    }
    newChat.disabled = coach.items.length === 0 && !coach.busy;
    const count = app.courses.length;
    sideCount.textContent = `${count} course${count === 1 ? "" : "s"}`;
    renderComposer();
    renderTranscript();
  }

  const unsubscribe = coach.subscribe(update);
  update();
  void coach.refreshUsage();
  // Focus the composer on desktop; on touch devices that would pop up the keyboard unasked
  if (matchMedia("(pointer: fine)").matches) requestAnimationFrame(() => input.focus());
  return { el, update, destroy: unsubscribe };
}

function avatar(): HTMLElement {
  return h("span", { class: "coach-avatar", attrs: { "aria-hidden": "true" } }, icon("sparkles", 16));
}

function actionCourseId(action: CoachAction): number {
  return action.kind === "updated" ? action.after.id : action.course.id;
}

function describe(action: CoachAction): string {
  if (action.kind === "added") return `${action.course.status} · due ${formatDate(action.course.target_date)}`;
  if (action.kind === "removed") return "Removed from your list";
  const { before, after } = action;
  const changes: string[] = [];
  if (before.status !== after.status) changes.push(`${before.status} → ${after.status}`);
  if (before.target_date !== after.target_date) changes.push(`due ${formatDate(before.target_date)} → ${formatDate(after.target_date)}`);
  if (before.name !== after.name) changes.push(`renamed from "${before.name}"`);
  if (before.description !== after.description) changes.push("description updated");
  return changes.join(" · ") || "No visible changes";
}
