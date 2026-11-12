import "@fontsource-variable/inter";
import "./styles.css";
import "./coach.css";
import "./plan.css";
import "./legal.css";
import "./stats.css";
import "./landing.css";
import { Account } from "./account";
import { App } from "./app";
import { initInstall } from "./install";
import { mountShell } from "./shell";
import { startUpdates } from "./updates";

initInstall();
startUpdates();

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
