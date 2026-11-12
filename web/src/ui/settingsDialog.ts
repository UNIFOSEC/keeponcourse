import { errorMessage, type App } from "../app";
import { ApiStore } from "../data/apiStore";
import { DEFAULT_API_URL, LOCAL_API_ENABLED, normalizeApiUrl, type Settings } from "../data/store";
import { h } from "./dom";
import { icon, type IconName } from "./icons";
import { toast } from "./toast";

/** Choose where courses come from: the in-browser demo, or the project's Express API. */
export function createSettingsDialog(app: App) {
  let source: Settings["source"] = "demo";
  let resetArmed: ReturnType<typeof setTimeout> | undefined;
  let testSeq = 0;

  const option = (value: Settings["source"], iconName: IconName, title: string, text: string) => {
    const input = h("input", {
      attrs: { type: "radio", name: "source", value },
      on: {
        change: () => {
          source = value;
          sync();
        },
      },
    });
    return {
      input,
      el: h(
        "label",
        { class: "source-option" },
        input,
        h(
          "span",
          { class: "source-card" },
          h("span", { class: "source-icon" }, icon(iconName, 20)),
          h("span", {}, h("strong", {}, title), h("span", { class: "muted" }, text)),
        ),
      ),
    };
  };

  const demo = option("demo", "database", "Demo data", "Sample courses saved in this browser only. Nothing is sent anywhere.");
  const api = option("api", "server", "Local API", "Connect to the Express server from this project (npm start).");

  const urlInput = h("input", {
    class: "input",
    attrs: { id: "api-url", type: "url", spellcheck: "false", autocomplete: "off" },
    on: {
      input: () => {
        testSeq++;
        testResult.textContent = "";
      },
    },
  });
  const testResult = h("p", { class: "test-result", attrs: { "aria-live": "polite" } });
  const testBtn = h(
    "button",
    { class: "btn btn-secondary btn-sm", attrs: { type: "button" }, on: { click: testConnection } },
    icon("refresh", 16),
    h("span", {}, "Test connection"),
  );
  const apiFields = h(
    "div",
    { class: "api-fields" },
    h("label", { class: "field-label", attrs: { for: "api-url" } }, "API base URL"),
    h("div", { class: "row-gap" }, urlInput, testBtn),
    h("p", { class: "field-hint" }, "Only localhost addresses are allowed. This keeps the page's security policy strict."),
    testResult,
  );

  const resetBtn = h("button", { class: "btn btn-ghost-danger btn-sm", attrs: { type: "button" }, on: { click: onReset } });
  const demoFields = h(
    "div",
    { class: "demo-fields" },
    h("p", { class: "field-hint" }, "Made a mess? Put the sample courses back."),
    resetBtn,
  );

  const signedInNote = h(
    "p",
    { class: "notice-box" },
    icon("cloud", 18),
    h("span", {}, "You're signed in, so your courses sync to your account. These options apply when you're signed out."),
  );

  const saveBtn = h("button", { class: "btn btn-primary", attrs: { type: "submit" } }, "Save");
  const form = h(
    "form",
    { class: "modal-form", attrs: { novalidate: true }, on: { submit: onSave } },
    h(
      "header",
      { class: "modal-head" },
      h("h2", { attrs: { id: "settings-title" } }, "Data source"),
      h("button", { class: "icon-btn", attrs: { type: "button", "aria-label": "Close" }, on: { click: () => dialog.close() } }, icon("x", 18)),
    ),
    h(
      "div",
      { class: "modal-body" },
      signedInNote,
      h("fieldset", { class: "source-options" }, h("legend", { class: "sr-only" }, "Where courses are stored"), demo.el, LOCAL_API_ENABLED && api.el),
      apiFields,
      demoFields,
    ),
    h(
      "footer",
      { class: "modal-foot" },
      h("span", { class: "spacer" }),
      h("button", { class: "btn btn-secondary", attrs: { type: "button" }, on: { click: () => dialog.close() } }, "Cancel"),
      saveBtn,
    ),
  );

  const dialog = h(
    "dialog",
    {
      class: "modal",
      attrs: { "aria-labelledby": "settings-title" },
      on: {
        click: (event) => {
          if (event.target === dialog) dialog.close();
        },
      },
    },
    form,
  );

  function sync() {
    demo.input.checked = source === "demo";
    api.input.checked = source === "api";
    apiFields.hidden = source !== "api";
    demoFields.hidden = source !== "demo" || app.account.signedIn;
    signedInNote.hidden = !app.account.signedIn;
  }

  function disarmReset() {
    clearTimeout(resetArmed);
    resetArmed = undefined;
    resetBtn.replaceChildren(icon("refresh", 16), h("span", {}, "Reset demo data"));
  }

  function open() {
    source = app.settings.source;
    urlInput.value = app.settings.apiUrl || DEFAULT_API_URL;
    testResult.textContent = "";
    testResult.className = "test-result";
    disarmReset();
    sync();
    dialog.showModal();
  }

  async function testConnection() {
    const seq = ++testSeq; // a slow, older test must not overwrite a newer result
    const url = normalizeApiUrl(urlInput.value);
    if (!url) return showTest("Enter a localhost URL, like " + DEFAULT_API_URL, false);
    showTest("Connecting…", null);
    try {
      const courses = await new ApiStore(url).list();
      if (seq === testSeq) showTest(`Connected. Found ${courses.length} course${courses.length === 1 ? "" : "s"}.`, true);
    } catch (error) {
      if (seq === testSeq) showTest(errorMessage(error), false);
    }
  }

  function showTest(message: string, ok: boolean | null) {
    testResult.textContent = message;
    testResult.className = `test-result${ok === true ? " ok" : ok === false ? " bad" : ""}`;
  }

  async function onReset() {
    // Two-step: the first click arms the button, the second resets
    if (!resetArmed) {
      resetBtn.replaceChildren(icon("alert", 16), h("span", {}, "Click again to reset"));
      resetArmed = setTimeout(disarmReset, 4000);
      return;
    }
    disarmReset();
    dialog.close();
    await app.resetDemo();
    toast("Demo data reset", { tone: "success" });
  }

  async function onSave(event: SubmitEvent) {
    event.preventDefault();
    let apiUrl = app.settings.apiUrl;
    if (source === "api") {
      const url = normalizeApiUrl(urlInput.value);
      if (!url) {
        showTest("Enter a localhost URL, like " + DEFAULT_API_URL, false);
        urlInput.focus();
        return;
      }
      apiUrl = url;
    }
    dialog.close();
    await app.applySettings({ source, apiUrl });
    if (app.account.signedIn) {
      toast("Saved. It applies when you sign out.", { tone: "success" });
    } else if (app.loadState === "ready") {
      toast(source === "api" ? "Connected to the local API" : "Using demo data", { tone: "success" });
    }
  }

  return { el: dialog, open };
}
