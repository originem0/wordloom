import type { ReactNode } from "react";
import { useIsAdmin } from "@/client/hooks/useAuth";

/**
 * Renders children only for a logged-in admin.
 *
 * This is presentation, not protection — the server's write guard is what
 * refuses visitors. It exists so visitors aren't shown delete/edit controls
 * that can only ever answer 401.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  return useIsAdmin() ? <>{children}</> : null;
}
