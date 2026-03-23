import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

export function AuthGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "ok" | "denied">("loading");

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.json())
      .then((data: { authenticated: boolean }) => {
        if (data.authenticated) {
          setStatus("ok");
        } else {
          setStatus("denied");
          navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`, { replace: true });
        }
      })
      .catch(() => {
        setStatus("denied");
        navigate("/login", { replace: true });
      });
  }, [navigate]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "denied") return null;

  return <>{children}</>;
}
