import type { BoardData } from "@/lib/kanban";

const BASE = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw Object.assign(new Error(res.statusText), { status: res.status });
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ ok: boolean }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    request<{ ok: boolean }>("/api/logout", { method: "POST" }),

  me: () =>
    request<{ userId: string }>("/api/me"),

  getBoard: () =>
    request<BoardData>("/api/board"),

  renameColumn: (columnId: string, title: string) =>
    request<{ ok: boolean }>(`/api/columns/${columnId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  addCard: (columnId: string, title: string, details: string) =>
    request<{ id: string; title: string; details: string }>(
      `/api/columns/${columnId}/cards`,
      { method: "POST", body: JSON.stringify({ title, details }) }
    ),

  updateCard: (cardId: string, patch: { title?: string; details?: string }) =>
    request<{ ok: boolean }>(`/api/cards/${cardId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteCard: (cardId: string) =>
    request<{ ok: boolean }>(`/api/cards/${cardId}`, { method: "DELETE" }),

  moveCard: (cardId: string, targetColumnId: string, targetPosition: number) =>
    request<{ ok: boolean }>(`/api/cards/${cardId}/move`, {
      method: "POST",
      body: JSON.stringify({ targetColumnId, targetPosition }),
    }),

  chat: (
    message: string,
    history: { role: "user" | "assistant"; content: string }[],
  ) =>
    request<{
      reply: string;
      boardUpdate: { operations: unknown[]; errors: string[] } | null;
    }>("/api/ai", {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),
};
