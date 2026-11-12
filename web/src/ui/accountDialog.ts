import type { Account } from "../account";
import { errorMessage, type App } from "../app";
import { h } from "./dom";
import { icon } from "./icons";
import { toast } from "./toast";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase email codes are 6 digits by default (configurable up to 10) */
const CODE = /^\d{6,10}$/;

/** Sign in with an email link or code, or manage the signed-in account. */
export function createAccountDialog(app: App, account: Account, onAccountChange: () => void) {
  let sentTo: string | null = null;
  /** True when the user came to enter a code from an earlier email, so nothing was sent just now */
  let codeOnly = false;
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
              codeOnly = false;
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
        "Sync your courses across devices. No password needed: we'll email you a link and a code that sign you in. New here? The same email creates your free account.",
      ),
      h("label", { class: "field-label", attrs: { for: "account-email" } }, "Email"),
      email,
      message,
      submit,
      h(
        "button",
        {
          class: "btn btn-ghost btn-sm account-have-code",
          attrs: { type: "button" },
          on: {
            click: () => {
              const value = email.value.trim();
              if (!EMAIL.test(value)) {
                message.textContent = "Enter the email address the code was sent to.";
                email.focus();
                return;
              }
              sentTo = value;
              codeOnly = true;
              render();
            },
          },
        },
        "I already have a code",
      ),
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
    title.textContent = codeOnly ? "Enter your code" : "Check your email";
    const code = h("input", {
      class: "input account-code",
      attrs: {
        id: "account-code",
        inputmode: "numeric",
        autocomplete: "one-time-code",
        maxlength: 12,
        placeholder: "123456",
        "aria-describedby": "account-code-help",
      },
    });
    const message = h("p", { class: "field-error", attrs: { role: "alert" } });
    const submit = h("button", { class: "btn btn-primary", attrs: { type: "submit" } }, h("span", {}, "Sign in with code"));

    const form = h(
      "form",
      {
        class: "account-form account-code-form",
        attrs: { novalidate: true },
        on: {
          submit: async (event) => {
            event.preventDefault();
            const value = code.value.replace(/\D/g, ""); // allow pasted spaces or dashes
            if (!CODE.test(value)) {
              message.textContent = "Enter the code from the email: 6 digits or more.";
              code.focus();
              return;
            }
            if (busy) return;
            busy = true;
            submit.disabled = true;
            submit.classList.add("loading");
            try {
              await account.verifyCode(address, value);
              // The account subscription re-renders this dialog as signed in
            } catch (err) {
              message.textContent = errorMessage(err);
              code.select();
            } finally {
              busy = false;
              submit.disabled = false;
              submit.classList.remove("loading");
            }
          },
        },
      },
      h("label", { class: "field-label", attrs: { for: "account-code" } }, "Sign-in code"),
      code,
      h("p", { class: "muted account-code-help", attrs: { id: "account-code-help" } }, "The code works on any device, even if the link opened somewhere else."),
      message,
      submit,
    );

    body.replaceChildren(
      h(
        "div",
        { class: "account-sent" },
        h("span", { class: "account-sent-icon" }, icon("mail", 26)),
        codeOnly
          ? h("p", {}, "Enter the code from the sign-in email sent to ", h("strong", {}, address), ".")
          : h("p", {}, "We sent a sign-in link and code to ", h("strong", {}, address), "."),
        !codeOnly && h("p", { class: "muted" }, "Open the link in this browser, or type the code below. You can close this window; the app updates as soon as you're in."),
      ),
      form,
      h(
        "button",
        {
          class: "btn btn-ghost btn-sm account-different",
          attrs: { type: "button" },
          on: {
            click: () => {
              sentTo = null;
              codeOnly = false;
              render();
            },
          },
        },
        "Use a different email",
      ),
    );
    requestAnimationFrame(() => code.focus());
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
    if (account.signedIn) {
      sentTo = null;
      codeOnly = false;
    }
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
