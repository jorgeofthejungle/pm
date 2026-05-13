"use client";

import { useEffect, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { LoginForm } from "@/components/LoginForm";
import { api } from "@/lib/api";

type AuthState = "loading" | "unauthenticated" | "authenticated";

export default function Home() {
  const [auth, setAuth] = useState<AuthState>("loading");

  useEffect(() => {
    api.me()
      .then(() => setAuth("authenticated"))
      .catch(() => setAuth("unauthenticated"));
  }, []);

  if (auth === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--stroke)] border-t-[var(--primary-blue)]" />
      </div>
    );
  }

  if (auth === "unauthenticated") {
    return <LoginForm onLogin={() => setAuth("authenticated")} />;
  }

  return <KanbanBoard onLogout={() => setAuth("unauthenticated")} />;
}
