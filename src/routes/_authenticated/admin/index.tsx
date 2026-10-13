import { createFileRoute, redirect } from "@tanstack/react-router";

/** Die frühere Link-Pool-Seite entfällt; /admin führt direkt zu den Märkten. */
export const Route = createFileRoute("/_authenticated/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/markets" });
  },
});
