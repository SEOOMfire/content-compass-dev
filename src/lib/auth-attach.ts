import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

/** Meldung, wenn der geöffnete Tab noch Code von vor dem letzten Deployment nutzt. */
export const STALE_CLIENT_MESSAGE =
  "Die App wurde aktualisiert. Bitte die Seite neu laden (Strg + F5) und die Aktion wiederholen.";

/**
 * Erkennt die HTML-Fehlerseite des Servers als Antwort eines Server-Function-Calls.
 * Typische Ursache: Der Tab wurde vor einem Deployment geladen und ruft eine
 * Server-Funktion auf, die es in der neuen Version nicht mehr gibt.
 */
function isServerErrorPage(err: unknown): boolean {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /<!doctype html|This page didn't load/i.test(text);
}

/**
 * Hängt an jeden Server-Function-Call das Supabase-Bearer-Token des
 * angemeldeten Nutzers, damit `requireSupabaseAuth` serverseitig prüfen kann.
 * Antwortet der Server mit seiner HTML-Fehlerseite, wird daraus eine verständliche Meldung.
 */
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    try {
      return await next({
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch (err) {
      if (isServerErrorPage(err)) throw new Error(STALE_CLIENT_MESSAGE);
      throw err;
    }
  },
);
