// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, AccountState } from "../src/account";
import type { App } from "../src/app";
import { createAccountDialog } from "../src/ui/accountDialog";

/** A signed-out account whose sign-in calls are recorded. */
function fakeAccount() {
  const listeners = new Set<() => void>();
  const account = {
    state: { status: "signed-out" } as AccountState,
    get signedIn() {
      return this.state.status === "signed-in";
    },
    subscribe: (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn)),
    sendLink: vi.fn().mockResolvedValue(undefined),
    verifyCode: vi.fn(async (email: string, code: string) => {
      if (code !== "123456") throw new Error("That code didn't work.");
      account.state = { status: "signed-in", userId: "u1", email };
      listeners.forEach((fn) => fn());
    }),
  };
  return account;
}

const fakeApp = { loadState: "ready", courses: [], subscribe: () => () => {} } as unknown as App;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const account = fakeAccount();
  const dialog = createAccountDialog(fakeApp, account as unknown as Account, () => {});
  document.body.replaceChildren(dialog.el);
  dialog.open();
  const $ = <T extends Element>(selector: string) => dialog.el.querySelector<T>(selector)!;
  const button = (text: string) => [...dialog.el.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
  return { account, $, button, el: dialog.el };
}

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("sign-in dialog", () => {
  it("sends a link and code, then signs in with the code typed or pasted with spaces", async () => {
    const { account, $, button, el } = setup();
    $<HTMLInputElement>("#account-email").value = "learner@example.com";
    $<HTMLFormElement>("form").requestSubmit();
    await flush();
    expect(account.sendLink).toHaveBeenCalledWith("learner@example.com");
    expect(el.textContent).toContain("We sent a sign-in link and code to learner@example.com");

    $<HTMLInputElement>("#account-code").value = "123 456";
    button("Sign in with code").click();
    await flush();
    expect(account.verifyCode).toHaveBeenCalledWith("learner@example.com", "123456");
    expect(el.textContent).toContain("Your account");
  });

  it("lets someone with a code from an earlier email sign in without sending another", async () => {
    const { account, $, button } = setup();
    // Straight to the code form, even before typing an email
    button("I already have a code").click();
    expect($("#account-code-email")).toBeTruthy();
    expect($("#account-code")).toBeTruthy();

    $<HTMLInputElement>("#account-code").value = "123456";
    button("Sign in with code").click();
    await flush();
    expect(account.verifyCode).not.toHaveBeenCalled(); // the email is still missing

    $<HTMLInputElement>("#account-code-email").value = "learner@example.com";
    button("Sign in with code").click();
    await flush();
    expect(account.sendLink).not.toHaveBeenCalled();
    expect(account.verifyCode).toHaveBeenCalledWith("learner@example.com", "123456");
  });

  it("puts the code box first, and rescues a code typed into the email box", async () => {
    const { account, $, button, el } = setup();
    button("I already have a code").click();
    const fields = [...el.querySelectorAll("form input")].map((i) => i.id);
    expect(fields).toEqual(["account-code", "account-code-email"]);

    // The code went into the email box by mistake
    $<HTMLInputElement>("#account-code-email").value = "123 456";
    button("Sign in with code").click();
    await flush();
    expect($<HTMLInputElement>("#account-code").value).toBe("123 456");
    expect($<HTMLInputElement>("#account-code-email").value).toBe("");
    expect(el.textContent).toContain("Now enter the email address it was sent to.");
    expect(account.verifyCode).not.toHaveBeenCalled();

    $<HTMLInputElement>("#account-code-email").value = "learner@example.com";
    button("Sign in with code").click();
    await flush();
    expect(account.verifyCode).toHaveBeenCalledWith("learner@example.com", "123456");
  });

  it("remembers the address a sign-in email went to, so a code needs only the code", async () => {
    const first = setup();
    first.$<HTMLInputElement>("#account-email").value = "learner@example.com";
    first.$<HTMLFormElement>("form").requestSubmit();
    await flush();

    // Later, in a fresh dialog (for example after a reload)
    const { $, button, account } = setup();
    expect($<HTMLInputElement>("#account-email").value).toBe("learner@example.com");
    $<HTMLInputElement>("#account-email").value = "";
    button("I already have a code").click();
    expect($<HTMLInputElement>("#account-code-email").value).toBe("learner@example.com");
    $<HTMLInputElement>("#account-code").value = "123456";
    button("Sign in with code").click();
    await flush();
    expect(account.verifyCode).toHaveBeenCalledWith("learner@example.com", "123456");
  });

  it("fills in an email typed before choosing to enter a code", () => {
    const { $, button } = setup();
    $<HTMLInputElement>("#account-email").value = "learner@example.com";
    button("I already have a code").click();
    expect($<HTMLInputElement>("#account-code-email").value).toBe("learner@example.com");
  });

  it("explains a wrong or malformed code without signing in", async () => {
    const { account, $, button, el } = setup();
    $<HTMLInputElement>("#account-email").value = "learner@example.com";
    button("I already have a code").click();

    $<HTMLInputElement>("#account-code").value = "12";
    button("Sign in with code").click();
    await flush();
    expect(account.verifyCode).not.toHaveBeenCalled();
    expect(el.textContent).toContain("6 digits or more");

    $<HTMLInputElement>("#account-code").value = "654321";
    button("Sign in with code").click();
    await flush();
    expect(el.textContent).toContain("That code didn't work.");
    expect(account.state.status).toBe("signed-out");
  });

  it("shows the weekly check-in switch when signed in, saves changes, and sends a sample", async () => {
    const account = fakeAccount();
    account.state = { status: "signed-in", userId: "u1", email: "learner@example.com" };
    const extra = account as unknown as Record<string, unknown>;
    extra.weeklyCheckin = vi.fn().mockResolvedValue(false);
    extra.setWeeklyCheckin = vi.fn().mockResolvedValue(undefined);
    const sendSample = vi.fn().mockResolvedValue("learner@example.com");
    const dialog = createAccountDialog(fakeApp, account as unknown as Account, () => {}, sendSample);
    document.body.replaceChildren(dialog.el);
    dialog.open();
    await flush();

    const box = dialog.el.querySelector<HTMLInputElement>("#account-weekly")!;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await flush();
    expect(extra.setWeeklyCheckin).toHaveBeenCalledWith(true);
    expect(dialog.el.querySelector<HTMLInputElement>("#account-weekly")!.checked).toBe(true);

    [...dialog.el.querySelectorAll("button")].find((b) => b.textContent?.includes("Send me a sample"))!.click();
    await flush();
    expect(sendSample).toHaveBeenCalled();
  });
});
