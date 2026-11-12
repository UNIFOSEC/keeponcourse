import { errorMessage, type App } from "../app";
import { formatDate } from "../dates";
import { describeContext, FEEDBACK_MAX, feedbackContext, KINDS, markRepliesSeen, myFeedback, STATUSES, submitFeedback, type FeedbackItem, type FeedbackKind } from "../feedback";
import { cx, h, setChildren } from "./dom";
import { icon } from "./icons";
import { toast } from "./toast";

/**
 * "Send feedback" for signed-in users: an idea, a problem or something they
 * like, optionally with app details, plus their earlier feedback and the
 * developer's replies.
 */
export function createFeedbackDialog(app: App, onUnreadChange: (unread: number) => void) {
  let kind: FeedbackKind = "idea";
  let busy = false;
  let items: FeedbackItem[] | null = null;

  const kindButtons = (Object.keys(KINDS) as FeedbackKind[]).map((k) =>
    h(
      "button",
      {
        class: "feedback-kind",
        attrs: { type: "button", "aria-pressed": k === kind },
        on: {
          click: () => {
            kind = k;
            kindButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(Object.keys(KINDS)[i] === k)));
            message.placeholder = PLACEHOLDERS[k];
          },
        },
      },
      h("span", { attrs: { "aria-hidden": "true" } }, KINDS[k].emoji),
      KINDS[k].label,
    ),
  );
  const PLACEHOLDERS: Record<FeedbackKind, string> = {
    idea: "What would make KeepOnCourse more useful for you?",
    problem: "What happened, and what did you expect instead?",
    praise: "What do you like, or what has helped you most?",
  };
  const message = h("textarea", {
    class: "input textarea",
    attrs: { id: "feedback-message", rows: 5, maxlength: FEEDBACK_MAX, placeholder: PLACEHOLDERS.idea, "aria-describedby": "feedback-counter" },
    on: { input: () => (counter.textContent = `${message.value.length} / ${FEEDBACK_MAX}`) },
  });
  const counter = h("span", { class: "field-counter", attrs: { id: "feedback-counter", "aria-live": "off" } }, `0 / ${FEEDBACK_MAX}`);
  const includeContext = h("input", { attrs: { type: "checkbox", id: "feedback-context", checked: true } });
  const contextPreview = h("span", { class: "muted feedback-context-preview" });
  const formError = h("p", { class: "field-error", attrs: { role: "alert" } });
  const send = h("button", { class: "btn btn-primary", attrs: { type: "submit" } }, icon("compose", 17), h("span", {}, "Send feedback"));
  const history = h("section", { class: "feedback-history", attrs: { "aria-labelledby": "feedback-history-title" } });

  const form = h(
    "form",
    { class: "modal-form", attrs: { novalidate: true }, on: { submit: (event) => void onSubmit(event) } },
    h(
      "header",
      { class: "modal-head" },
      h("h2", { attrs: { id: "feedback-title" } }, "Send feedback"),
      h("button", { class: "icon-btn", attrs: { type: "button", "aria-label": "Close" }, on: { click: () => !busy && dialog.close() } }, icon("x", 18)),
    ),
    h(
      "div",
      { class: "modal-body feedback-body" },
      h("p", { class: "muted" }, "Ideas, problems or things you like: it all goes straight to the developer, who reads every message and can reply here."),
      h("div", { class: "feedback-kinds", attrs: { role: "group", "aria-label": "Type of feedback" } }, kindButtons),
      h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "feedback-message" } }, "Your message"), message, counter),
      h(
        "label",
        { class: "feedback-context", attrs: { for: "feedback-context" } },
        includeContext,
        h("span", {}, h("strong", {}, "Include app details"), contextPreview),
      ),
      formError,
      history,
    ),
    h("footer", { class: "modal-foot" }, h("button", { class: "btn btn-ghost", attrs: { type: "button" }, on: { click: () => dialog.close() } }, "Close"), h("span", { class: "spacer" }), send),
  );

  const dialog = h(
    "dialog",
    {
      class: "modal",
      attrs: { "aria-labelledby": "feedback-title" },
      on: {
        click: (event) => {
          if (event.target === dialog && !busy) dialog.close();
        },
      },
    },
    form,
  );

  async function onSubmit(event: Event) {
    event.preventDefault();
    const text = message.value.trim();
    if (!text) {
      formError.textContent = "Write a few words first.";
      message.focus();
      return;
    }
    if (busy) return;
    busy = true;
    send.disabled = true;
    send.classList.add("loading");
    formError.textContent = "";
    try {
      await submitFeedback(app, kind, text, includeContext.checked ? feedbackContext(app) : null);
      message.value = "";
      counter.textContent = `0 / ${FEEDBACK_MAX}`;
      toast("Thanks! Your feedback was sent to the developer.", { tone: "success" });
      await loadHistory();
    } catch (error) {
      formError.textContent = errorMessage(error);
    } finally {
      busy = false;
      send.disabled = false;
      send.classList.remove("loading");
    }
  }

  function renderHistory() {
    if (!items?.length) {
      setChildren(history);
      return;
    }
    setChildren(
      history,
      h("h3", { attrs: { id: "feedback-history-title" } }, "Your feedback"),
      h(
        "ul",
        { class: "feedback-list" },
        items.slice(0, 10).map((item) =>
          h(
            "li",
            { class: cx("feedback-item", item.reply && !item.reply_seen && "has-unread") },
            h(
              "div",
              { class: "feedback-item-head" },
              h("span", {}, `${KINDS[item.kind].emoji} ${formatDate(item.created_at.slice(0, 10))}`),
              h("span", { class: `feedback-status status-${item.status}` }, STATUSES[item.status]),
            ),
            h("p", { class: "feedback-text" }, item.message.length > 240 ? `${item.message.slice(0, 240)}…` : item.message),
            item.reply &&
              h(
                "div",
                { class: "feedback-reply" },
                h("strong", {}, icon("compose", 14), "Reply from the developer", item.reply && !item.reply_seen && h("span", { class: "feedback-new" }, "New")),
                h("p", {}, item.reply),
              ),
          ),
        ),
      ),
    );
  }

  async function loadHistory() {
    try {
      items = await myFeedback(app);
    } catch {
      items = [];
    }
    renderHistory();
    const unread = items.filter((i) => i.reply && !i.reply_seen).length;
    if (unread && dialog.open) {
      // Shown now, so they count as read (the "New" labels stay for this visit)
      await markRepliesSeen(app).catch(() => {});
      onUnreadChange(0);
    } else {
      onUnreadChange(unread);
    }
  }

  function open() {
    if (!app.account.signedIn) return;
    formError.textContent = "";
    contextPreview.textContent = describeContext(feedbackContext(app));
    dialog.showModal();
    void loadHistory();
    requestAnimationFrame(() => message.focus());
  }

  /** Counts unread replies without opening the dialog (for the sidebar badge). */
  async function refreshUnread() {
    if (!app.account.signedIn) return onUnreadChange(0);
    try {
      const list = await myFeedback(app);
      onUnreadChange(list.filter((i) => i.reply && !i.reply_seen).length);
    } catch {
      // Not critical
    }
  }

  return { el: dialog, open, refreshUnread };
}
