import { pageHeader, type Ctx, type View } from "../ui/components";
import { h, type Child } from "../ui/dom";

/**
 * Privacy policy and terms of use. Written to match what the app actually
 * does with data (see the README security notes); keep them in sync when
 * data handling changes, and update EFFECTIVE when you do.
 */

const EFFECTIVE = "November 11, 2026";
const CONTACT_URL = "https://unifosec.github.io/#contact";
/** Cookie-free visitor counts, only when a Cloudflare Web Analytics token is configured (see vite.config.ts) */
const WEB_ANALYTICS = Boolean((import.meta.env.VITE_CF_ANALYTICS_TOKEN ?? "").trim());

const section = (title: string, ...children: Child[]) => h("section", { class: "legal-section" }, h("h2", {}, title), ...children);
const p = (...children: Child[]) => h("p", {}, ...children);
const list = (...items: Child[]) => h("ul", {}, items.map((item) => h("li", {}, item)));
const link = (href: string, text: string) =>
  h("a", { class: "link", attrs: { href, ...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {}) } }, text);

function page(title: string, intro: string, ...sections: HTMLElement[]): View {
  const el = h(
    "div",
    { class: "page legal" },
    pageHeader(title, `Effective ${EFFECTIVE}`),
    h("article", { class: "card legal-body" }, p(intro), ...sections),
  );
  return { el, update() {} };
}

export function createPrivacy(_ctx: Ctx): View {
  return page(
    "Privacy policy",
    "KeepOnCourse is a free learning planner. This policy explains, in plain language, what data it handles, where that data goes, and the choices you have. We don't sell data, show ads, or track you across other sites.",

    section(
      "Using KeepOnCourse without an account",
      p(
        "Your courses, study plans and settings are saved only in your browser's storage on your device. They aren't sent anywhere, unless you use Coach (see below). Clearing your browser's site data deletes them.",
      ),
    ),

    section(
      "If you create an account",
      p("We store:"),
      list(
        "Your email address, used only to send you sign-in links and codes. There's no password.",
        "Your courses and study plans (names, descriptions, dates, statuses, modules and scheduled sessions).",
        "If you turn on calendar sync: a private calendar link and your time zone.",
        "Daily counts of your Coach messages and of the AI tokens they used, so the daily allowance works and we know what Coach costs to run.",
      ),
      p("This data is stored with Supabase, our database and sign-in provider. Each account can only ever read its own data; this is enforced by the database itself."),
    ),

    section(
      "Coach (AI assistant) and syllabus import",
      p(
        "When you chat with Coach or import a syllabus, your message, your course list (names, descriptions, dates, statuses and a short summary of any study plan), and any syllabus text or PDF you provide are sent through our server to Anthropic's Claude API to generate a reply.",
      ),
      list(
        "We don't keep chat transcripts on our servers. Your current conversation is kept in your browser tab and cleared when you start a new chat or close the tab.",
        h("span", {}, "Anthropic processes this data under its commercial terms and privacy policy (", link("https://www.anthropic.com/legal/privacy", "anthropic.com/legal/privacy"), ")."),
        "Please don't share sensitive personal information with Coach.",
      ),
    ),

    section(
      "Usage limits and abuse prevention",
      p(
        "To keep Coach free, each person has a daily message allowance. For signed-in users it's counted per account. For visitors without an account, it's counted using a one-way hash of the IP address and the date; the IP address itself is never stored, and these counts are deleted after two days. We keep only each day's totals (how many visitors used Coach and how many messages they sent), with no hash or IP address. Requests are also rate-limited per IP address.",
      ),
    ),

    section(
      "Usage statistics",
      p(
        "To run KeepOnCourse and decide how to keep it going, we look at totals only: how many accounts were active in a week, how many Coach messages were answered, how often the daily limit was reached, and what Coach costs. Only the site owner can see them, and they never include names, email addresses, course content or chats.",
      ),
      WEB_ANALYTICS &&
        p(
          "We also use Cloudflare Web Analytics to count page visits. It doesn't use cookies or other storage on your device and doesn't build a profile of you; it reports totals such as page views, countries and browsers.",
        ),
    ),

    section(
      "Calendar sync",
      p(
        "If you subscribe to your study plan in a calendar app, that app fetches a private link that contains your course names, module titles and session times. Anyone who has the link can see those. You can reset the link at any time on the Calendar page, which stops the old one from working.",
      ),
    ),

    section(
      "Service providers",
      list(
        "Cloudflare hosts the website and runs our Coach and calendar server.",
        "Supabase stores accounts and synced data, and sends sign-in emails.",
        "Anthropic provides the Claude AI model behind Coach.",
      ),
      p(
        "Like any website or online service, these providers process technical information such as IP addresses to deliver and secure their service. We don't use cookies; the app uses your browser's storage only for your theme, demo data and sign-in session. The font is self-hosted, so no third-party font requests are made.",
      ),
    ),

    section(
      "Your choices",
      list(
        "Use KeepOnCourse without an account; everything then stays in your browser.",
        "Export all of your data as a file from your account at any time.",
        "Delete your account at any time. This permanently removes your account, courses, study plans, calendar link and usage counts.",
      ),
    ),

    section(
      "Children",
      p("KeepOnCourse isn't directed at children under 13, and we don't knowingly collect data from them."),
    ),

    section(
      "Changes and contact",
      p("If this policy changes, we'll update the date at the top. Questions or requests: ", link(CONTACT_URL, "contact us"), "."),
    ),
  );
}

export function createTerms(_ctx: Ctx): View {
  return page(
    "Terms of use",
    "By using KeepOnCourse, you agree to these terms. They're short, and we've kept them in plain language.",

    section(
      "The service",
      p(
        "KeepOnCourse is provided free of charge, as is and as available, without warranties of any kind. Features, limits and availability may change, and the service may be interrupted or discontinued. We're not liable for any loss arising from your use of it, to the extent the law allows.",
      ),
    ),

    section(
      "Coach and study plans",
      p(
        "Coach is an AI assistant. It can make mistakes, and its suggestions, explanations, schedules and time estimates are not professional, academic or medical advice. Check anything important against your course materials. You're responsible for the changes you ask Coach to make, and every change can be undone.",
      ),
    ),

    section(
      "Acceptable use",
      p("Please don't:"),
      list(
        "use KeepOnCourse for anything illegal, harmful or abusive;",
        "try to get around the daily allowances or rate limits, or use Coach for purposes unrelated to learning;",
        "try to access other people's data, or probe, overload or attack the service;",
        "upload content you don't have the right to share.",
      ),
      p("We may limit or suspend access for anyone who breaks these terms."),
    ),

    section(
      "Your content",
      p(
        "Your courses, plans and messages belong to you. You give us permission to store and process them only to run the service for you, as described in the ",
        link("#/privacy", "privacy policy"),
        ". You can export or delete them at any time.",
      ),
    ),

    section(
      "Open source",
      p("The KeepOnCourse source code is published under the MIT license. These terms cover use of the hosted service."),
    ),

    section(
      "Changes and contact",
      p("If these terms change, we'll update the date at the top. Questions: ", link(CONTACT_URL, "contact us"), "."),
    ),
  );
}
