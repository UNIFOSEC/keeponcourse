import "@fontsource-variable/inter";
import "./styles.css";
import "./coach.css";
import "./plan.css";
import { Account } from "./account";
import { App } from "./app";
import { mountShell } from "./shell";

const root = document.getElementById("app");
if (root) {
  const account = new Account();
  const app = new App(account);
  mountShell(root, app);
  // Courses load once we know whether someone is signed in, so a signed-in
  // user never sees demo data flash first
  account.subscribe(() => void app.syncWithAccount());
  void account.init().then(() => app.syncWithAccount());
}
