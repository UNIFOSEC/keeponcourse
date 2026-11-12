import type { Session, SupabaseClient } from "@supabase/supabase-js";

/**
 * Accounts (Supabase Auth, passwordless email links).
 *
 * The Supabase library is loaded only when it's needed: when someone signs in,
 * or when a saved session or a sign-in link is present. Demo visitors never
 * download it.
 */

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
const STORAGE_KEY = "koc.auth";

export const accountsEnabled = SUPABASE_URL !== "" && SUPABASE_KEY !== "";

export type AccountState =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "signed-out"; error?: string }
  | { status: "signed-in"; userId: string; email: string };

let clientPromise: Promise<SupabaseClient> | null = null;

function client(): Promise<SupabaseClient> {
  clientPromise ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        // PKCE returns ?code= in the query string, which doesn't clash with the
        // app's #/ routes, and is safer than tokens in the URL fragment
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: STORAGE_KEY,
      },
    }),
  );
  return clientPromise;
}

function hasSavedSession(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** True when this browser has a saved sign-in (checked without loading the accounts library). */
export function mightBeSignedIn(): boolean {
  return hasSavedSession();
}

function urlHasAuthCode(): boolean {
  const params = new URLSearchParams(location.search);
  return params.has("code") || params.has("error_description");
}

/** Removes ?code=… (or an error) from the address bar after sign-in. */
function cleanUrl() {
  if (location.search) history.replaceState(null, "", location.pathname + location.hash);
}

export class Account {
  state: AccountState = accountsEnabled ? { status: "loading" } : { status: "disabled" };
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get signedIn(): boolean {
    return this.state.status === "signed-in";
  }

  /** The Supabase client, for the synced data store. Only valid when signed in. */
  async db(): Promise<SupabaseClient> {
    return client();
  }

  async init(): Promise<void> {
    if (!accountsEnabled) return;
    const linkError = new URLSearchParams(location.search).get("error_description");
    if (!hasSavedSession() && !urlHasAuthCode()) {
      this.set({ status: "signed-out" });
      return;
    }
    try {
      const sb = await client();
      // getSession() waits for a sign-in link's code to be exchanged first
      const { data, error } = await sb.auth.getSession();
      this.listen(sb);
      if (error) throw error;
      if (!data.session && urlHasAuthCode()) {
        this.set({
          status: "signed-out",
          error: linkError ?? "That sign-in link didn't work here. Links only work in the browser where you asked for them, and only for an hour. Enter your email and the code from the email instead, or request a new link.",
        });
      } else {
        this.fromSession(data.session);
      }
    } catch {
      this.set({ status: "signed-out", error: "Couldn't finish signing in. Please request a new link." });
    } finally {
      cleanUrl();
    }
  }

  private listening = false;

  /** Follows sign-in changes (including from other tabs), once per page. */
  private listen(sb: SupabaseClient) {
    if (this.listening) return;
    this.listening = true;
    sb.auth.onAuthStateChange((_event, session) => this.fromSession(session));
  }

  /**
   * Emails a one-time sign-in link and code. New emails get an account
   * automatically. The link works only in this browser (PKCE); the code
   * works on any device.
   */
  async sendLink(email: string): Promise<void> {
    const sb = await client();
    // Listen now, so this tab updates when the link is opened in another tab
    this.listen(sb);
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) {
      if (error.status === 429) throw new Error("Too many sign-in emails. Please wait a few minutes and try again.");
      throw new Error(error.message || "Couldn't send the sign-in link. Please try again.");
    }
  }

  /** Signs in with the one-time code from the sign-in email. */
  async verifyCode(email: string, code: string): Promise<void> {
    const sb = await client();
    this.listen(sb);
    const { data, error } = await sb.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) {
      if (error.status === 429) throw new Error("Too many attempts. Please wait a few minutes and try again.");
      throw new Error("That code didn't work. Check that it's from the newest email and less than an hour old, or request a new one.");
    }
    this.fromSession(data.session);
  }

  /**
   * The secret token for the user's calendar subscription feed, created on
   * first use. reset = true issues a new one and revokes the old link.
   */
  async calendarFeedToken(reset = false): Promise<string> {
    const sb = await client();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { data, error } = await sb.rpc("my_calendar_feed", { tz: timeZone, reset });
    if (error || typeof data !== "string") throw new Error("Couldn't set up your calendar link. Please try again.");
    return data;
  }

  /** Whether the weekly check-in email is on (off by default). */
  async weeklyCheckin(): Promise<boolean> {
    const sb = await client();
    const { data, error } = await sb.rpc("my_weekly_checkin");
    if (error) throw new Error("Couldn't load your email settings.");
    return data === true;
  }

  /** Turns the weekly check-in email on or off; it's sent Monday morning in this browser's time zone. */
  async setWeeklyCheckin(enabled: boolean): Promise<void> {
    const sb = await client();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { error } = await sb.rpc("set_weekly_checkin", { enabled, tz });
    if (error) throw new Error("Couldn't save your email settings. Please try again.");
  }

  /** The signed-in user's access token (for Coach), or null when signed out. */
  async accessToken(forceRefresh = false): Promise<string | null> {
    if (!this.signedIn) return null;
    const sb = await client();
    const { data } = forceRefresh ? await sb.auth.refreshSession() : await sb.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async signOut(): Promise<void> {
    const sb = await client();
    await sb.auth.signOut();
    this.set({ status: "signed-out" });
  }

  /** Deletes the account and all of its courses (see delete_my_account in supabase/schema.sql). */
  async deleteAccount(): Promise<void> {
    const sb = await client();
    const { error } = await sb.rpc("delete_my_account");
    if (error) throw new Error("Couldn't delete your account. Please try again.");
    await sb.auth.signOut({ scope: "local" });
    this.set({ status: "signed-out" });
  }

  private fromSession(session: Session | null) {
    if (session?.user) {
      const { id, email } = session.user;
      if (this.state.status === "signed-in" && this.state.userId === id) return;
      this.set({ status: "signed-in", userId: id, email: email ?? "" });
    } else if (this.state.status !== "signed-out") {
      this.set({ status: "signed-out" });
    }
  }

  private set(state: AccountState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
