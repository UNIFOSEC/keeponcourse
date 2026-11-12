import { errorMessage, type App } from "../app";
import { daysUntil, formatDate, todayISO, toISODate } from "../dates";
import {
  CHEERS,
  createInvite,
  deleteInvite,
  describeCheer,
  markCheersSeen,
  MAX_PARTNERS,
  myCheers,
  myPartners,
  NAME_MAX,
  partnerLink,
  updateInvite,
  type Cheer,
  type PartnerInvite,
} from "../partner";
import { readJSON, writeJSON } from "../data/storage";
import { cx, h, setChildren } from "./dom";
import { icon } from "./icons";
import { toast } from "./toast";

export interface PartnersState {
  /** null until loaded (or when signed out) */
  invites: PartnerInvite[] | null;
  cheers: Cheer[];
}

/** "today", "yesterday", "3 days ago", "Nov 2, 2026" */
export function ago(timestamp: string, today = todayISO()): string {
  const day = toISODate(new Date(timestamp));
  const n = -daysUntil(day, today);
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 7) return `${n} days ago`;
  return formatDate(day);
}

/** "Sam", "Sam and Kim", "Sam, Kim and 2 others" */
export function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

export type SendInviteEmail = (inviteId: number, email: string, replyTo: boolean) => Promise<void>;

const EMAILED_KEY = "koc.partner.emailed";
// Same check as the server: one @, no spaces or separators, a dot in the domain
const EMAIL = /^[^\s@,;<>"()]{1,64}@[^\s@,;<>"()]+\.[^\s@,;<>"()]{2,}$/;
export const looksLikeEmail = (value: string) => value.length <= 254 && EMAIL.test(value);

/**
 * Study partners for signed-in users: invite people with private links,
 * choose what they see, stop sharing, and read their cheers. New cheers are
 * announced with a toast when the app opens or comes back to the front.
 */
export function createPartnerDialog(app: App, onChange: () => void, sendEmail?: SendInviteEmail) {
  const state: PartnersState = { invites: null, cheers: [] };
  let loadedFor: string | null = null;
  let lastCheck = 0;
  let fresh: number | null = null; // id of the invite just created, shown open
  let busy = false;

  const label = h("input", { class: "input", attrs: { id: "partner-label", maxlength: NAME_MAX, autocomplete: "off", placeholder: "Sam, or My mentor" } });
  const displayName = h("input", { class: "input", attrs: { id: "partner-display", maxlength: NAME_MAX, autocomplete: "given-name", placeholder: "Your first name" } });
  const showNames = h("input", { attrs: { type: "checkbox", id: "partner-show-names" } });
  const email = h("input", { class: "input", attrs: { id: "partner-email", type: "email", maxlength: 254, autocomplete: "off", placeholder: "sam@example.com", "aria-describedby": "partner-email-help" } });
  const replyTo = h("input", { attrs: { type: "checkbox", id: "partner-reply" } });
  // When each invite was last emailed (the addresses themselves aren't kept anywhere)
  const emailed = (): Record<string, string> => readJSON<Record<string, string>>(EMAILED_KEY, {});
  const markEmailed = (id: number) => writeJSON(EMAILED_KEY, { ...emailed(), [id]: new Date().toISOString() });
  const formError = h("p", { class: "field-error", attrs: { role: "alert" } });
  const create = h("button", { class: "btn btn-primary", attrs: { type: "submit" } }, icon("plus", 17), h("span", {}, "Create link"));
  const form = h(
    "form",
    { class: "partner-form", attrs: { novalidate: true, "aria-labelledby": "partner-form-title" }, on: { submit: (e) => void onCreate(e) } },
    h("h3", { attrs: { id: "partner-form-title" } }, "Invite a partner"),
    h(
      "div",
      { class: "partner-form-row" },
      h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "partner-label" } }, "Who is it?"), label),
      h("div", { class: "field" }, h("label", { class: "field-label", attrs: { for: "partner-display" } }, "Your name, as they'll see it"), displayName),
    ),
    sendEmail &&
      h(
        "div",
        { class: "field" },
        h("label", { class: "field-label", attrs: { for: "partner-email" } }, "Their email (optional)"),
        email,
        h("span", { class: "field-hint muted", attrs: { id: "partner-email-help" } }, "We email them the link once, and don't keep the address."),
      ),
    sendEmail &&
      h(
        "label",
        { class: "account-switch", attrs: { for: "partner-reply" } },
        replyTo,
        h("span", {}, h("strong", {}, "Let them reply to my email"), h("span", { class: "muted" }, "They'll see your email address, so a reply reaches you.")),
      ),
    h(
      "label",
      { class: "account-switch", attrs: { for: "partner-show-names" } },
      showNames,
      h("span", {}, h("strong", {}, "Show course and module names"), h("span", { class: "muted" }, "Off: they see “Course 1”, “Course 2” and your progress only.")),
    ),
    formError,
    h("div", { class: "row-gap" }, create),
  );

  const list = h("div", { class: "partner-list" });
  const cheersEl = h("section", { class: "partner-cheer-list", attrs: { "aria-labelledby": "partner-cheers-title" } });

  const dialog: HTMLDialogElement = h(
    "dialog",
    {
      class: "modal",
      attrs: { "aria-labelledby": "partners-title" },
      on: {
        click: (event) => {
          if (event.target === dialog && !busy) dialog.close();
        },
      },
    },
    h(
      "div",
      { class: "modal-form" },
      h(
        "header",
        { class: "modal-head" },
        h("h2", { attrs: { id: "partners-title" } }, "Study partners"),
        h("button", { class: "icon-btn", attrs: { type: "button", "aria-label": "Close" }, on: { click: () => dialog.close() } }, icon("x", 18)),
      ),
      h(
        "div",
        { class: "modal-body partner-body" },
        h("p", { class: "muted" }, "Studying is easier when someone is following along. Share a private link with a friend, mentor or classmate: they see your progress and can cheer you on, with no account needed."),
        h(
          "ul",
          { class: "partner-sees" },
          h("li", {}, icon("check", 15), "They see this week's sessions, your streak, and whether each plan is on track."),
          h("li", {}, icon("shield", 15), "Never your email, course descriptions or Coach chats. Course names only if you choose."),
          h("li", {}, icon("x", 15), "Stop sharing any time, and the link stops working at once."),
        ),
        list,
        form,
        cheersEl,
      ),
      h("footer", { class: "modal-foot" }, h("span", { class: "spacer" }), h("button", { class: "btn btn-ghost", attrs: { type: "button" }, on: { click: () => dialog.close() } }, "Close")),
    ),
  );

  // ------------------------------------------------------------ rendering
  function render() {
    const invites = state.invites ?? [];
    form.hidden = invites.length >= MAX_PARTNERS;
    if (!displayName.value && invites.length) displayName.value = invites[invites.length - 1].display_name;
    if (state.invites === null) {
      setChildren(list, h("p", { class: "muted" }, "Loading…"));
    } else if (!invites.length) {
      setChildren(list);
    } else {
      setChildren(
        list,
        h("h3", {}, `Sharing with ${invites.length} ${invites.length === 1 ? "person" : "people"}`),
        h("ul", { class: "partner-invites" }, invites.map(inviteItem)),
        invites.length >= MAX_PARTNERS && h("p", { class: "muted" }, `You can have up to ${MAX_PARTNERS} study partners.`),
      );
    }
    if (state.cheers.length) {
      setChildren(
        cheersEl,
        h("h3", { attrs: { id: "partner-cheers-title" } }, "Cheers"),
        h(
          "ul",
          { class: "partner-cheer-items" },
          state.cheers.slice(0, 10).map((c) => h("li", { class: cx(!c.seen && "is-new") }, h("span", {}, describeCheer(c)), h("span", { class: "muted" }, ago(c.created_at)))),
        ),
      );
    } else {
      setChildren(cheersEl);
    }
  }

  function inviteItem(invite: PartnerInvite): HTMLElement {
    const link = partnerLink(invite.token);
    const linkBox = h("input", { class: "input partner-link", attrs: { readonly: true, value: link, "aria-label": `Private link for ${invite.label}` }, on: { focus: () => linkBox.select() } });
    const copy = h("button", { class: "btn btn-secondary btn-sm", attrs: { type: "button" }, on: { click: () => void copyLink(invite, link) } }, icon("copy", 15), h("span", {}, "Copy link"));
    const canShare = typeof navigator.share === "function";
    const share =
      canShare &&
      h(
        "button",
        {
          class: "btn btn-secondary btn-sm",
          attrs: { type: "button" },
          on: {
            click: () =>
              void navigator.share({ title: "My study progress", text: `${invite.display_name} shared their study progress with you on KeepOnCourse.`, url: link }).catch(() => {}),
          },
        },
        icon("share", 15),
        h("span", {}, "Share"),
      );
    const names = h("input", { attrs: { type: "checkbox", id: `partner-names-${invite.id}`, checked: invite.show_names } });
    names.addEventListener("change", async () => {
      names.disabled = true;
      try {
        await updateInvite(app, invite.id, names.checked);
        invite.show_names = names.checked;
        toast(names.checked ? `${invite.label} can now see course names.` : `Course names are hidden from ${invite.label}.`);
      } catch (error) {
        names.checked = !names.checked;
        toast(errorMessage(error), { tone: "error" });
      } finally {
        names.disabled = false;
      }
    });

    let armed: ReturnType<typeof setTimeout> | undefined;
    const stop = h("button", { class: "btn btn-ghost btn-sm partner-stop", attrs: { type: "button" } });
    const stopLabel = (on: boolean) => stop.replaceChildren(icon(on ? "alert" : "x", 15), h("span", {}, on ? "Click again to stop sharing" : "Stop sharing"));
    stopLabel(false);
    stop.addEventListener("click", async () => {
      if (!armed) {
        stopLabel(true);
        armed = setTimeout(() => {
          armed = undefined;
          stopLabel(false);
        }, 4000);
        return;
      }
      clearTimeout(armed);
      stop.disabled = true;
      try {
        await deleteInvite(app, invite.id);
        state.invites = (state.invites ?? []).filter((i) => i.id !== invite.id);
        render();
        toast(`Stopped sharing with ${invite.label}. Their link no longer works.`);
        await load(true); // its cheers went with it
      } catch (error) {
        stop.disabled = false;
        armed = undefined;
        stopLabel(false);
        toast(errorMessage(error), { tone: "error" });
      }
    });

    const sentAt = emailed()[invite.id];
    const seen = invite.last_viewed_at ? `Last looked ${ago(invite.last_viewed_at)}` : sentAt ? `Invite emailed ${ago(sentAt)}` : "Hasn't opened the link yet";
    const emailRow = sendEmail ? emailForm(invite) : null;
    const emailBtn: HTMLButtonElement | null =
      emailRow &&
      h(
        "button",
        {
          class: "btn btn-secondary btn-sm",
          attrs: { type: "button", "aria-expanded": "false" },
          on: {
            click: () => {
              emailRow.hidden = !emailRow.hidden;
              emailBtn?.setAttribute("aria-expanded", String(!emailRow.hidden));
              if (!emailRow.hidden) emailRow.querySelector("input")?.focus();
            },
          },
        },
        icon("mail", 15),
        h("span", {}, sentAt ? "Email again" : "Email"),
      );
    return h(
      "li",
      { class: cx("partner-invite", fresh === invite.id && "is-fresh") },
      h(
        "div",
        { class: "partner-invite-head" },
        h("span", { class: "account-avatar account-avatar-sm", attrs: { "aria-hidden": "true" } }, (invite.label[0] ?? "?").toUpperCase()),
        h("span", { class: "partner-invite-name" }, h("strong", {}, invite.label), h("span", { class: "muted" }, `${seen}${invite.cheers ? ` · ${invite.cheers} cheer${invite.cheers === 1 ? "" : "s"}` : ""}`)),
      ),
      h("div", { class: "partner-link-row" }, linkBox, copy, share, emailBtn),
      emailRow,
      h(
        "div",
        { class: "partner-invite-foot" },
        h("label", { class: "partner-names", attrs: { for: `partner-names-${invite.id}` } }, names, h("span", {}, "Show course names")),
        stop,
      ),
    );
  }

  /** Emailing the link for an existing invite: an address, the reply-to choice, Send. */
  function emailForm(invite: PartnerInvite): HTMLFormElement {
    const id = `partner-email-${invite.id}`;
    const address = h("input", { class: "input", attrs: { id, type: "email", maxlength: 254, autocomplete: "off", placeholder: "Their email" } });
    const reply = h("input", { attrs: { type: "checkbox", id: `${id}-reply` } });
    const error = h("p", { class: "field-error", attrs: { role: "alert" } });
    const send = h("button", { class: "btn btn-primary btn-sm", attrs: { type: "submit" } }, icon("mail", 15), h("span", {}, "Send"));
    return h(
      "form",
      {
        class: "partner-email-row",
        attrs: { novalidate: true, hidden: true },
        on: {
          submit: async (event) => {
            event.preventDefault();
            const to = address.value.trim();
            error.textContent = "";
            if (!looksLikeEmail(to)) {
              error.textContent = "That email address doesn't look right.";
              address.focus();
              return;
            }
            send.disabled = true;
            send.classList.add("loading");
            try {
              await sendEmail!(invite.id, to, reply.checked);
              markEmailed(invite.id);
              toast(`Invite emailed to ${invite.label}.`, { tone: "success" });
              render();
            } catch (err) {
              error.textContent = errorMessage(err);
            } finally {
              send.disabled = false;
              send.classList.remove("loading");
            }
          },
        },
      },
      h("label", { class: "sr-only", attrs: { for: id } }, `Email address for ${invite.label}`),
      h("div", { class: "partner-link-row" }, address, send),
      h("label", { class: "partner-names", attrs: { for: `${id}-reply` } }, reply, h("span", {}, "Let them reply to my email")),
      error,
    );
  }

  async function copyLink(invite: PartnerInvite, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast(`Link copied. Send it to ${invite.label}.`, { tone: "success" });
    } catch {
      toast("Couldn't copy. Select the link and copy it instead.", { tone: "error" });
    }
  }

  // ------------------------------------------------------------ actions
  async function onCreate(event: Event) {
    event.preventDefault();
    const who = label.value.trim();
    const me = displayName.value.trim();
    const to = email.value.trim();
    formError.textContent = "";
    if (!who) {
      formError.textContent = "Add who you're inviting, so you can tell your partners apart.";
      label.focus();
      return;
    }
    if (!me) {
      formError.textContent = "Add your name, so they know whose progress it is.";
      displayName.focus();
      return;
    }
    if (to && !looksLikeEmail(to)) {
      formError.textContent = "That email address doesn't look right. Fix it, or leave it empty and copy the link instead.";
      email.focus();
      return;
    }
    if (busy) return;
    busy = true;
    create.disabled = true;
    create.classList.add("loading");
    try {
      const { id } = await createInvite(app, who, me, showNames.checked);
      fresh = id;
      label.value = "";
      showNames.checked = false;
      let mailed = false;
      let mailError = "";
      if (to && sendEmail) {
        try {
          await sendEmail(id, to, replyTo.checked);
          markEmailed(id);
          mailed = true;
          email.value = "";
          replyTo.checked = false;
        } catch (error) {
          mailError = errorMessage(error);
        }
      }
      await load(true);
      if (mailError) toast(`Link created, but the email wasn't sent: ${mailError}`, { tone: "error" });
      else toast(mailed ? `Link created and emailed to ${who}.` : `Link created for ${who}. Copy it or share it with them.`, { tone: "success" });
      list.querySelector<HTMLInputElement>(".is-fresh .partner-link")?.focus();
    } catch (error) {
      formError.textContent = errorMessage(error);
    } finally {
      busy = false;
      create.disabled = false;
      create.classList.remove("loading");
    }
  }

  /** Loads partners and cheers. Announces new cheers once, then marks them seen. */
  async function load(force = false) {
    const account = app.account.state;
    if (account.status !== "signed-in") {
      state.invites = null;
      state.cheers = [];
      loadedFor = null;
      return onChange();
    }
    if (!force && loadedFor === account.userId && Date.now() - lastCheck < 5 * 60_000) return;
    lastCheck = Date.now();
    try {
      const [invites, cheers] = await Promise.all([myPartners(app), myCheers(app)]);
      if (app.account.state.status !== "signed-in" || app.account.state.userId !== account.userId) return;
      loadedFor = account.userId;
      state.invites = invites;
      state.cheers = cheers;
      announce();
    } catch {
      state.invites ??= [];
    }
    render();
    onChange();
  }

  function announce() {
    const unseen = state.cheers.filter((c) => !c.seen);
    if (!unseen.length) return;
    const text = unseen.length === 1 ? `${CHEERS[unseen[0].kind].emoji} ${unseen[0].from} cheered you on: ${CHEERS[unseen[0].kind].text}` : `🎉 ${unseen.length} new cheers from ${namesList([...new Set(unseen.map((c) => c.from))])}`;
    if (!dialog.open) toast(text, { tone: "success", action: { label: "See", run: open } });
    void markCheersSeen(app).catch(() => {});
  }

  function open() {
    if (!app.account.signedIn) return;
    formError.textContent = "";
    render();
    if (!dialog.open) dialog.showModal();
    void load(true);
    fresh = null;
  }

  // New cheers when the app comes back to the front
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void load();
  });

  return { el: dialog, open, load, state };
}
