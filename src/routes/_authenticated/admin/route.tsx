import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/jobs" });
  },
  component: AdminLayout,
});

const TABS = [
  { to: "/admin/prompts", label: "Prompts" },
  { to: "/admin/markets", label: "Märkte" },
  { to: "/admin/workspaces", label: "Arbeitsbereiche" },
] as const;

function AdminLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prompts, Märkte und Arbeitsbereiche verwalten.
        </p>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="rounded-t-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
            activeProps={{ className: "border-b-2 border-primary text-foreground" }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
