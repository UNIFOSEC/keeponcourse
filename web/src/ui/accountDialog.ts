import type { Account } from "../account";
import { errorMessage, type App } from "../app";
import { h } from "./dom";
import { icon } from "./icons";
import { toast } from "./toast";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sign in with an email link, or manage the signed-in account. */
export function createAccountDialog(app: App, account: Account, onAccountChange: () => void) {
  let sentTo: string | null = null;
  let busy = false;
  let deleteArmed: ReturnType<typeof setTimeout> | undefined;

  const title = h("h2", { attrs: { id: "account-title" } });
  const body = h("div", { class: "modal-body" });

  const dialog = h(
    "dialog",
    {
      class: "modal",
      attrs: { "aria-labelledby": "account-title" },
      on: {
        click: (event) => {
          if (event.target === dialog) dialog.close();
        },
        close: () => {
          clearTimeout(deleteArmed);
          deleteArmed = undefined;
        },
      },
    },
    h(
      "div",
      { class: "modal-form" },
      h(
        "header",
        { class: "modal-head" },
        title,
        h("button", { class: "icon-btn", attrs: { type: "button", "aria-label": "Close" }, on: { click: () => dialog.close() } }, icon("x", 18)),
      ),
      body,
    ),
  );

  function render() {
    const state = account.state;
    if (state.status === "signed-in") return renderSignedIn(state.email);
    if (sentTo) return renderSent(sentTo);
    renderSignIn(state.status === "signed-out" ? state.error : undefined);
  }

  function renderSignIn(error?: string) {
    title.textContent = "Sign in to KeepOnCourse";
    const email = h("input", {
      class: "input",
      attrs: { id: "account-email", type: "email", autocomplete: "email", inputmode: "email", placeholder: "you@example.com", required: true },
    });
    const message = h("p", { class: "field-error", attrs: { role: "alert" } }, error ?? "");
    const submit = h("button", { class: "btn btn-primary", attrs: { type: "submit" } }, icon("mail", 17), h("span", {}, "Email me a sign-in link"));

    const form = h(
      "form",
      {
        class: "account-form",
        attrs: { novalidate: true },
        on: {
          submit: async (event) => {
            event.preventDefault();
            const value = email.value.trim();
            if (!EMAIL.test(value)) {
              message.textContent = "Enter a valid email address.";
              email.focus();
              return;
            }
            if (busy) return;
            busy = true;
            submit.disabled = true;
            submit.classList.add("loading");
            try {
              await account.sendLink(value);
              sentTo = value;
              render();
            } catch (err) {
              message.textContent = errorMessage(err);
            } finally {
              busy = false;
              submit.disabled = false;
              submit.classList.remove("loading");
            }
          },
        },
      },
      h(
        "p",
        { class: "muted" },
        "Sync your courses across devices. No password needed: we'll email you a link that signs you in. New here? The same link creates your free account.",
      ),
      h("label", { class: "field-label", attrs: { for: "account-email" } }, "Email"),
      email,
      message,
      submit,
      h(
        "p",
        { class: "account-consent" },
        "By signing in, you agree to the ",
        h("a", { class: "link", attrs: { href: "#/terms" }, on: { click: () => dialog.close() } }, "Terms"),
        " and ",
        h("a", { class: "link", attrs: { href: "#/privacy" }, on: { click: () => dialog.close() } }, "Privacy policy"),
        ".",
      ),
    );
    body.replaceChildren(form);
    requestAnimationFrame(() => email.focus());
  }

  function renderSent(address: string) {
    title.textContent = "Check your email";
    body.replaceChildren(
      h(
        "div",
        { class: "account-sent" },
        h("span", { class: "account-sent-icon" }, icon("mail", 26)),
        h("p", {}, "We sent a sign-in link to ", h("strong", {}, address), "."),
        h("p", { class: "muted" }, "Open it in this browser to finish signing in. You can close this window; the app updates as soon as you're in."),
        h(
          "button",
          {
            class: "btn btn-secondary btn-sm",
            attrs: { type: "button" },
            on: {
              click: () => {
                sentTo = null;
                render();
              },
            },
          },
          "Use a different email",
        ),
      ),
    );
  }

  function renderSignedIn(email: string) {
    title.textContent = "Your account";
    const count = app.loadState === "ready" ? app.courses.length : null;

    const deleteBtn = h("button", { class: "btn btn-ghost-danger btn-sm", attrs: { type: "button" }, on: { click: onDelete } });
    const setDeleteLabel = (armed: boolean) =>
      deleteBtn.replaceChildren(icon(armed ? "alert" : "trash", 16), h("span", {}, armed ? "Click again to delete everything" : "Delete account"));
    setDeleteLabel(Boolean(deleteArmed));

    body.replaceChildren(
      h(
        "div",
        { class: "account-card" },
        h("span", { class: "account-avatar" }, (email[0] ?? "?").toUpperCase()),
        h(
          "div",
          {},
          h("strong", { class: "account-email" }, email),
          h("span", { class: "muted" }, icon("cloud", 14), count === null ? " Synced" : ` ${count} course${count === 1 ? "" : "s"}, synced`),
        ),
      ),
      h(
        "div",
        { class: "account-actions" },
        h(
          "button",
          { class: "btn btn-secondary", attrs: { type: "button" }, on: { click: exportData } },
          icon("download", 17),
          h("span", {}, "Export my data"),
        ),
        h(
          "button",
          {
            class: "btn btn-secondary",
            attrs: { type: "button" },
            on: {
              click: async () => {
                await account.signOut();
                dialog.close();
                onAccountChange();
                toast("Signed out", { tone: "success" });
              },
            },
          },
          icon("logOut", 17),
          h("span", {}, "Sign out"),
        ),
      ),
      h(
        "div",
        { class: "account-danger" },
        h("p", { class: "muted" }, "Deleting your account permanently removes it and all of your courses."),
        deleteBtn,
      ),
    );

    async function onDelete() {
      // Two-step: the first click arms the button, the second deletes
      if (!deleteArmed) {
        setDeleteLabel(true);
        deleteArmed = setTimeout(() => {
          deleteArmed = undefined;
          setDeleteLabel(false);
        }, 5000);
        return;
      }
      clearTimeout(deleteArmed);
      deleteArmed = undefined;
      deleteBtn.disabled = true;
      try {
        await account.deleteAccount();
        dialog.close();
        onAccountChange();
        toast("Your account and courses were deleted", { tone: "success" });
      } catch (err) {
        deleteBtn.disabled = false;
        setDeleteLabel(false);
        toast(errorMessage(err), { tone: "error" });
      }
    }
  }

  function exportData() {
    const state = account.state;
    const data = {
      exported_at: new Date().toISOString(),
      account: state.status === "signed-in" ? state.email : null,
      courses: app.courses,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = h("a", { attrs: { href: url, download: `keeponcourse-export-${new Date().toISOString().slice(0, 10)}.json` } });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Export downloaded", { tone: "success" });
  }

  account.subscribe(() => {
    if (account.signedIn) sentTo = null;
    if (dialog.open) render();
  });
  app.subscribe(() => {
    if (dialog.open && account.signedIn) render();
  });

  function open() {
    render();
    dialog.showModal();
  }

  return { el: dialog, open };
}
