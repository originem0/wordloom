import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAdminOnceKnown } from "@/client/hooks/useAuth";

/**
 * `/` is the 表达 page for the admin and the card library for a visitor.
 * useIsAdmin() says "no" until the auth check has answered, which would send
 * the admin to the cards on every hard refresh, so this waits for the answer.
 * The children are not rendered for a visitor: a lazy page among them is
 * never loaded, and asks the server for nothing.
 */
export function HomeSplit({ children }: { children: ReactNode }) {
  const isAdmin = useAdminOnceKnown();
  if (isAdmin === undefined) return <Loader2 className="mx-auto my-12 size-6 animate-spin text-muted-foreground" />;
  return isAdmin ? <>{children}</> : <Navigate to="/cards" replace />;
}
