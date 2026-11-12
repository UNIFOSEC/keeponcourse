import { test as base } from "@playwright/test";

export { expect, type Page } from "@playwright/test";

/**
 * Every browser test imports `test` from here. When the build has a Cloudflare
 * Web Analytics token, the page loads Cloudflare's beacon; this swaps it for an
 * empty script so test runs never count as visits on the live dashboard. The
 * script still loads under the real security policy, so the tests' CSP checks
 * still cover it.
 */
export const test = base.extend<{ stubAnalytics: void }>({
  stubAnalytics: [
    async ({ context }, use) => {
      await context.route(/cloudflareinsights\.com/, (route) =>
        route.request().resourceType() === "script"
          ? route.fulfill({ status: 200, contentType: "text/javascript", body: "" })
          : route.fulfill({ status: 204, body: "" }),
      );
      await use();
    },
    { auto: true },
  ],
});
