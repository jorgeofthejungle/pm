"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type AiSidebarProps = {
  open: boolean;
  onClose: () => void;
  onBoardMutated: () => void;
};

export const AiSidebar = ({ open, onClose, onBoardMutated }: AiSidebarProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (bottomRef.current?.scrollIntoView) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, thinking]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || thinking) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setError("");
    setThinking(true);

    try {
      const history = messages.slice(-50).map((m) => ({ role: m.role, content: m.content }));
      const result = await api.chat(text, history);
      const assistantMsg: Message = { role: "assistant", content: result.reply || "(no reply)" };
      setMessages((prev) => [...prev, assistantMsg]);
      if (result.boardUpdate && result.boardUpdate.operations.length > 0) {
        onBoardMutated();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setThinking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-[var(--navy-dark)]/10 backdrop-blur-[1px] lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        data-testid="ai-sidebar"
        className={clsx(
          "fixed right-0 top-0 z-30 flex h-full w-full max-w-sm flex-col",
          "border-l border-[var(--stroke)] bg-white shadow-[-8px_0_32px_rgba(3,33,71,0.1)]",
          "transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        aria-label="AI assistant"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--stroke)] px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--gray-text)]">
              Assistant
            </p>
            <p className="mt-0.5 font-display text-base font-semibold text-[var(--navy-dark)]">
              AI Chat
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI sidebar"
            className="rounded-full border border-[var(--stroke)] px-3 py-1.5 text-xs font-semibold text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
          >
            Close
          </button>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && !thinking && (
            <div className="mt-10 flex flex-col items-center gap-4 px-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--secondary-purple)]/10">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="22" height="22" style={{ color: "var(--secondary-purple)" }}>
                  <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 14.5A6.5 6.5 0 1110 3.5a6.5 6.5 0 010 13zm.75-9.75a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0V6.75zm0 5.5a.75.75 0 00-1.5 0v.5a.75.75 0 001.5 0v-.5z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--navy-dark)]">AI Assistant</p>
                <p className="mt-1.5 text-xs leading-5 text-[var(--gray-text)]">
                  Ask me to add, move, or edit cards. Describe what you need and I will update the board.
                </p>
              </div>
              <div className="w-full space-y-2 text-left">
                {["Move all blocked cards to Backlog", "Add a card for the API redesign", "What is in Review right now?"].map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => setInput(hint)}
                    className="w-full rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2 text-left text-xs text-[var(--gray-text)] transition hover:border-[var(--primary-blue)]/30 hover:text-[var(--navy-dark)]"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={clsx(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6",
                  msg.role === "user"
                    ? "bg-[var(--secondary-purple)] text-white"
                    : "border border-[var(--stroke)] bg-[var(--surface)] text-[var(--navy-dark)]",
                )}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {thinking && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--gray-text)] [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--gray-text)] [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--gray-text)] [animation-delay:300ms]" />
              </div>
            </div>
          )}

          {error && (
            <p className="text-center text-xs font-semibold text-red-500">{error}</p>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-[var(--stroke)] px-5 py-4 space-y-3"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the AI..."
            rows={3}
            disabled={thinking}
            aria-label="Message"
            className="w-full resize-none rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={thinking || !input.trim()}
            className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {thinking ? "Thinking..." : "Send"}
          </button>
        </form>
      </aside>
    </>
  );
};
