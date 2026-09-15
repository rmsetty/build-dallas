import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env["VITE_SUPABASE_URL"];
const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"];

/**
 * Reads go straight from the browser to PostgREST — no Worker in the path.
 * Every table the client can reach is behind RLS (public read on events /
 * companies / people, owner-scoped on profiles, insert-only on wiki_edits), so
 * the publishable key is safe to ship.
 */
/** Placeholders keep createClient from throwing before the backend exists. */
export const supabase = createClient<Database>(url || "http://localhost:54321", anonKey || "public-anon-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** False when .env is missing, so routes can explain that instead of 401ing. */
export const supabaseConfigured = Boolean(url && anonKey);
