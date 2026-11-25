import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { Button } from "@/client/components/ui/button";
import { apiPost } from "@/client/lib/api";
import { queryClient } from "@/client/lib/query-client";
import { AUTH_QUERY_KEY } from "@/client/hooks/useAuth";
import { errorMessage, useI18n } from "@/client/lib/i18n";
import { ApiError } from "@/client/lib/api";

export function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await apiPost("/api/auth/login", { token });
      await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      const redirect = searchParams.get("redirect") || "/";
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center text-xl">WordLoom</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="space-y-2">
              <label htmlFor="admin-access-token" className="text-sm font-medium">{t("管理员口令", "Access token")}</label>
              <Input
                id="admin-access-token"
                type="password"
                placeholder={t("输入管理员口令", "Enter your access token")}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </div>
            {error != null && (
              <p className="text-sm text-destructive" role="alert">{error instanceof ApiError && error.status === 401 ? t("口令不正确，请重试。", "Incorrect access token. Please try again.") : errorMessage(error)}</p>
            )}
            <Button type="submit" disabled={loading}>
              {loading ? t("正在登录…", "Signing in…") : t("登录", "Sign in")}
            </Button>
          </form>
          <Link to="/cards" replace className="mt-3 flex min-h-11 items-center justify-center rounded-md text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            {t("继续浏览词库", "Continue browsing cards")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
