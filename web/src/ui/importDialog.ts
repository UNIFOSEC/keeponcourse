import { errorMessage, type App } from "../app";
import { DemoStore } from "../data/demoStore";
import { readString, writeString } from "../data/storage";
import { h } from "./dom";
import { icon } from "./icons";
import { toast } from "./toast";

/**
 * After someone signs in to a brand-new (empty) account, offer once to copy
 * the courses they had in this browser's demo, so nothing they set up is lost.
 */
export function createImportDialog(app: App) {
  let checking = false;
  let count = 0;

  const text = h("p", {});
  const importBtn = h("button", { class: "btn btn-primary", attrs: { type: "button" }, on: { click: onImport } });
  const dialog = h(
    "dialog",
    { class: "modal", attrs: { "aria-labelledby": "import-title" } },
    h(
      "div",
      { class: "modal-form" },
      h("header", { class: "modal-head" }, h("h2", { attrs: { id: "import-title" } }, "Bring your courses along?")),
      h("div", { class: "modal-body" }, text),
      h(
        "footer",
        { class: "modal-foot" },
        h("span", { class: "spacer" }),
        h("button", { class: "btn btn-secondary", attrs: { type: "button" }, on: { click: () => dialog.close() } }, "Start fresh"),
        importBtn,
      ),
    ),
  );

  async function maybeOffer() {
    const state = app.account.state;
    if (checking || dialog.open || state.status !== "signed-in") return;
    if (app.store.kind !== "account" || app.loadState !== "ready" || app.courses.length > 0) return;
    const flag = `koc.importOffered.${state.userId}`;
    if (readString(flag)) return;
    checking = true;
    try {
      count = (await new DemoStore().list()).length;
      writeString(flag, "1"); // offer once per account on this browser
      if (count === 0) return;
      text.replaceChildren(
        `Your new account is empty. Copy the ${count} course${count === 1 ? "" : "s"} from this browser's demo into it, so you can keep working on ${count === 1 ? "it" : "them"} on any device?`,
      );
      importBtn.replaceChildren(icon("cloud", 17), h("span", {}, `Copy ${count} course${count === 1 ? "" : "s"}`));
      dialog.showModal();
    } finally {
      checking = false;
    }
  }

  async function onImport() {
    importBtn.disabled = true;
    importBtn.classList.add("loading");
    try {
      const copied = await app.importDemoCourses();
      dialog.close();
      toast(`Copied ${copied} course${copied === 1 ? "" : "s"} into your account`, { tone: "success" });
    } catch (error) {
      toast(errorMessage(error), { tone: "error" });
    } finally {
      importBtn.disabled = false;
      importBtn.classList.remove("loading");
    }
  }

  return { el: dialog, maybeOffer: () => void maybeOffer() };
}
