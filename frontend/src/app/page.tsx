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
        <p className="text-sm text-[var(--gray-text)]">Loading...</p>
      </div>
    );
  }

  if (auth === "unauthenticated") {
    return <LoginForm onLogin={() => setAuth("authenticated")} />;
  }

  return <KanbanBoard onLogout={() => setAuth("unauthenticated")} />;
}
