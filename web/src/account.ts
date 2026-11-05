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
      sb.auth.onAuthStateChange((_event, session) => this.fromSession(session));
      if (error) throw error;
      if (!data.session && urlHasAuthCode()) {
        this.set({
          status: "signed-out",
          error: linkError ?? "That sign-in link didn't work. It may have expired, or been opened in a different browser. Request a new one.",
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

  /** Emails a one-time sign-in link. New emails get an account automatically. */
  async sendLink(email: string): Promise<void> {
    const sb = await client();
    // Listen now, so this tab updates when the link is opened in another tab
    sb.auth.onAuthStateChange((_event, session) => this.fromSession(session));
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) {
      if (error.status === 429) throw new Error("Too many sign-in emails. Please wait a few minutes and try again.");
      throw new Error(error.message || "Couldn't send the sign-in link. Please try again.");
    }
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
