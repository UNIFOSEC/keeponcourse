import { errorMessage, type App } from "../app";
import { formatDate } from "../dates";
import { adminFeedback, describeContext, FEEDBACK_MAX, KINDS, STATUSES, updateFeedback, type AdminFeedbackItem, type FeedbackStatus } from "../feedback";
import { cx, h, setChildren } from "./dom";
import { toast } from "./toast";

/**
 * The site owner's feedback inbox (in the private Stats page): filter by
 * status, read each message with the app details it came with, set its
 * status and reply. Replies appear in the user's Feedback dialog.
 */
export function createFeedbackInbox(app: App) {
  let filter: FeedbackStatus | null = "new";
  let items: AdminFeedbackItem[] | null = null;
  let error = "";

  const list = h("div", {});
  const filters = h("div", { class: "inbox-filters", attrs: { role: "group", "aria-label": "Show feedback" } });
  const el = h(
    "section",
    { class: "card stats-card", attrs: { "aria-labelledby": "inbox-title" } },
    h("div", { class: "stats-card-head" }, h("h2", { attrs: { id: "inbox-title" } }, "Feedback"), h("p", { class: "muted" }, "Messages from signed-in users. Replies show up in their Feedback window.")),
    filters,
    list,
  );

  function renderFilters() {
    const options: [FeedbackStatus | null, string][] = [["new", "New"], ["planned", "Planned"], ["done", "Done"], ["closed", "Closed"], [null, "All"]];
    setChildren(
      filters,
      options.map(([value, label]) =>
        h(
          "button",
          {
            class: "feedback-kind",
            attrs: { type: "button", "aria-pressed": filter === value },
            on: {
              click: () => {
                filter = value;
                void load();
              },
            },
          },
          label,
        ),
      ),
    );
  }

  function render() {
    renderFilters();
    if (error) return setChildren(list, h("p", { class: "field-error" }, error));
    if (!items) return setChildren(list, h("p", { class: "muted" }, "Loading feedback…"));
    if (!items.length) return setChildren(list, h("p", { class: "muted" }, filter ? `No ${STATUSES[filter].toLowerCase()} feedback.` : "No feedback yet."));
    setChildren(list, h("ul", { class: "inbox-list" }, items.map(itemView)));
  }

  function itemView(item: AdminFeedbackItem): HTMLElement {
    const status = h(
      "select",
      { class: "input select", attrs: { "aria-label": "Status" } },
      (Object.keys(STATUSES) as FeedbackStatus[]).map((s) => h("option", { attrs: { value: s, selected: s === item.status } }, STATUSES[s])),
    );
    const reply = h("textarea", { class: "input textarea", attrs: { rows: 2, maxlength: FEEDBACK_MAX, placeholder: "Reply (optional): the user sees it in the app", "aria-label": "Reply" } });
    reply.value = item.reply ?? "";
    const save = h("button", { class: "btn btn-primary btn-sm", attrs: { type: "button" }, on: { click: () => void onSave() } }, "Save");

    async function onSave() {
      save.disabled = true;
      const text = reply.value.trim();
      try {
        await updateFeedback(app, item.id, status.value as FeedbackStatus, text === (item.reply ?? "") ? null : text);
        toast(text && text !== (item.reply ?? "") ? "Reply sent." : "Saved.", { tone: "success" });
        await load();
      } catch (err) {
        toast(errorMessage(err), { tone: "error" });
        save.disabled = false;
      }
    }

    return h(
      "li",
      { class: cx("inbox-item", `status-${item.status}`) },
      h(
        "div",
        { class: "inbox-meta" },
        h("strong", {}, `${KINDS[item.kind].emoji} ${KINDS[item.kind].label}`),
        h("span", {}, formatDate(item.created_at.slice(0, 10))),
        h("span", {}, `User ${item.author}${item.author_since ? `, joined ${formatDate(item.author_since)}` : ""}`),
      ),
      h("p", { class: "feedback-text" }, item.message),
      h("p", { class: "inbox-meta" }, describeContext(item.context)),
      item.replied_at && h("p", { class: "inbox-meta" }, `Replied ${formatDate(item.replied_at.slice(0, 10))}`),
      h("div", { class: "inbox-controls" }, reply, status, save),
    );
  }

  async function load() {
    items = null;
    error = "";
    render();
    try {
      items = await adminFeedback(app, filter);
    } catch (err) {
      error = errorMessage(err);
    }
    render();
  }

  return { el, load };
}
