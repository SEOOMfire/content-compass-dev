import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/admin/markets")({
  head: () => ({
    meta: [
      { title: "Märkte verwalten – Content-Lokalisierung" },
      { name: "description", content: "Zielmärkte, Domains und Marktprofile pflegen." },
      { property: "og:title", content: "Märkte verwalten" },
      { property: "og:description", content: "Zielmärkte, Domains und Marktprofile pflegen." },
    ],
  }),
  component: MarketsPage,
});

function MarketsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const markets = useQuery({
    queryKey: ["markets-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("markets").select("*").order("country");
      if (error) throw error;
      return data;
    },
  });

  function edit(m: Record<string, unknown>) {
    setEditing(m["id"] as string);
    setForm({
      language_variant: String(m["language_variant"] ?? ""),
      localization_notes: String(m["localization_notes"] ?? ""),
      domain: String(m["domain"] ?? ""),
      path_prefix: String(m["path_prefix"] ?? "/"),
      magazine_root: String(m["magazine_root"] ?? ""),
      category_root: String(m["category_root"] ?? ""),
      brand: String(m["brand"] ?? ""),
      address_form: String(m["address_form"] ?? ""),
      closing_note: String(m["closing_note"] ?? ""),
      crawl_delay_ms: String(m["crawl_delay_ms"] ?? 400),
      forbidden_claims: JSON.stringify(m["forbidden_claims"] ?? [], null, 2),
      institutions: JSON.stringify(m["institutions"] ?? {}, null, 2),
    });
  }

  async function save() {
    if (!editing) return;
    try {
      const { error } = await supabase
        .from("markets")
        .update({
          language_variant: form["language_variant"] ?? "",
          localization_notes: form["localization_notes"]?.trim() || null,
          domain: form["domain"] ?? "",
          path_prefix: form["path_prefix"] || "/",
          magazine_root: form["magazine_root"] ?? "",
          category_root: form["category_root"] ?? "",
          brand: form["brand"] ?? "",
          address_form: form["address_form"] || null,
          closing_note: form["closing_note"] || null,
          crawl_delay_ms: Number(form["crawl_delay_ms"] ?? 400),
          forbidden_claims: JSON.parse(form["forbidden_claims"] || "[]"),
          institutions: JSON.parse(form["institutions"] || "{}"),
        })
        .eq("id", editing);
      if (error) throw error;
      toast.success("Markt gespeichert");
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["markets-admin"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    }
  }

  return (
    <div className="space-y-4">
      {(markets.data ?? []).map((m: Tables<"markets">) => (
        <Card key={m.id} className="border-border bg-surface">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {m.country} · {m.language}{" "}
              <span className="text-xs font-normal text-muted-foreground">{m.domain}</span>
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => (editing === m.id ? setEditing(null) : edit(m))}>
              {editing === m.id ? "Schließen" : "Bearbeiten"}
            </Button>
          </CardHeader>
          {editing === m.id && (
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor={`lv-${m.id}`}>Sprachvariante (language_variant)</Label>
                <Input
                  id={`lv-${m.id}`}
                  placeholder="z. B. Schweizer Hochdeutsch, kein „ß“"
                  value={form["language_variant"] ?? ""}
                  onChange={(e) => setForm({ ...form, language_variant: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor={`ln-${m.id}`}>Lokalisierungshinweise</Label>
                <Textarea
                  id={`ln-${m.id}`}
                  rows={5}
                  placeholder="Verbindliche Hinweise für den Zielmarkt, z. B. „Hundeführerschein gibt es nicht – neutral formulieren“, Gegenstücke zu Behörden, Services, Einheiten."
                  value={form["localization_notes"] ?? ""}
                  onChange={(e) => setForm({ ...form, localization_notes: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Wird in Scan, Lokalisierung und Review als verbindliche Vorgabe an die KI übergeben.
                </p>
              </div>
              {["domain", "path_prefix", "magazine_root", "category_root", "brand", "address_form", "crawl_delay_ms"].map(
                (k) => (
                  <div key={k} className="space-y-1.5">
                    <Label>{k}</Label>
                    <Input
                      value={form[k] ?? ""}
                      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    />
                  </div>
                ),
              )}
              {["closing_note", "forbidden_claims", "institutions"].map((k: string) => (
                <div key={k} className="space-y-1.5 md:col-span-2">
                  <Label>{k}</Label>
                  <Textarea
                    rows={4}
                    value={form[k] ?? ""}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  />
                </div>
              ))}
              <div className="md:col-span-2">
                <Button onClick={save}>Speichern</Button>
              </div>
            </CardContent>
          )}
        </Card>
      ))}
      {(markets.data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">Keine Märkte angelegt.</p>
      )}
    </div>
  );
}
