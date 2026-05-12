"use client";

import { useCallback, useEffect, useMemo, useOptimistic, useTransition, useState } from "react";
import clsx from "clsx";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { AiSidebar } from "@/components/AiSidebar";
import { CardModal } from "@/components/CardModal";
import { moveCard, type BoardData } from "@/lib/kanban";
import { api } from "@/lib/api";

type KanbanBoardProps = {
  onLogout: () => void;
};

export const KanbanBoard = ({ onLogout }: KanbanBoardProps) => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const refreshBoard = useCallback(() => {
    api.getBoard().then(setBoard).catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    refreshBoard();
  }, [refreshBoard]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const cardsById = useMemo(() => board?.cards ?? {}, [board?.cards]);

  const [, startMoveTransition] = useTransition();
  const [optimisticColumns, applyOptimisticMove] = useOptimistic(
    board?.columns ?? [],
    (cols, { cardId, overId }: { cardId: string; overId: string }) =>
      moveCard(cols, cardId, overId),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);
    if (!over || active.id === over.id || !board) return;

    const cardId = active.id as string;
    const overId = over.id as string;

    startMoveTransition(async () => {
      applyOptimisticMove({ cardId, overId });
      const updatedColumns = moveCard(board.columns, cardId, overId);
      const targetCol = updatedColumns.find((col) => col.cardIds.includes(cardId));
      if (targetCol) {
        const targetPosition = targetCol.cardIds.indexOf(cardId);
        await api.moveCard(cardId, targetCol.id, targetPosition);
        setBoard((prev) => prev && { ...prev, columns: updatedColumns });
      }
    });
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    setBoard((prev) =>
      prev && {
        ...prev,
        columns: prev.columns.map((col) =>
          col.id === columnId ? { ...col, title } : col
        ),
      }
    );
    api.renameColumn(columnId, title).catch(refreshBoard);
  };

  const handleAddCard = async (columnId: string, title: string, details: string) => {
    const card = await api.addCard(columnId, title, details);
    setBoard((prev) =>
      prev && {
        ...prev,
        cards: { ...prev.cards, [card.id]: card },
        columns: prev.columns.map((col) =>
          col.id === columnId
            ? { ...col, cardIds: [...col.cardIds, card.id] }
            : col
        ),
      }
    );
  };

  const handleUpdateCard = async (
    cardId: string,
    patch: { title: string; details: string; notes: string },
  ) => {
    setBoard((prev) =>
      prev && { ...prev, cards: { ...prev.cards, [cardId]: { ...prev.cards[cardId], ...patch } } }
    );
    await api.updateCard(cardId, patch).catch(refreshBoard);
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    setBoard((prev) =>
      prev && {
        ...prev,
        cards: Object.fromEntries(
          Object.entries(prev.cards).filter(([id]) => id !== cardId)
        ),
        columns: prev.columns.map((col) =>
          col.id === columnId
            ? { ...col, cardIds: col.cardIds.filter((id) => id !== cardId) }
            : col
        ),
      }
    );
    api.deleteCard(cardId).catch(refreshBoard);
  };

  const handleLogout = async () => {
    await api.logout();
    onLogout();
  };

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-[var(--gray-text)]">Failed to load board.</p>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-[var(--gray-text)]">Loading...</p>
      </div>
    );
  }

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full" style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--primary-blue) 25%, transparent) 0%, color-mix(in srgb, var(--primary-blue) 5%, transparent) 55%, transparent 70%)" }} />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full" style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--secondary-purple) 18%, transparent) 0%, color-mix(in srgb, var(--secondary-purple) 5%, transparent) 55%, transparent 75%)" }} />

      <main
        className={clsx(
          "relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12",
          "transition-[padding] duration-300",
          sidebarOpen && "lg:pr-[calc(24px+384px)]",
        )}
      >
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSidebarOpen((o) => !o)}
                  aria-expanded={sidebarOpen}
                  aria-controls="ai-sidebar"
                  className={clsx(
                    "rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition",
                    sidebarOpen
                      ? "bg-[var(--secondary-purple)] text-white hover:brightness-110"
                      : "border border-[var(--stroke)] text-[var(--primary-blue)] hover:border-[var(--primary-blue)]",
                  )}
                >
                  AI
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
                >
                  Sign out
                </button>
              </div>
              <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                  Focus
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                  One board. Five columns. Zero clutter.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <section className="grid gap-6 lg:grid-cols-5">
            {optimisticColumns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                cards={column.cardIds.map((cardId) => board.cards[cardId]).filter(Boolean)}
                onRename={handleRenameColumn}
                onAddCard={handleAddCard}
                onDeleteCard={handleDeleteCard}
                onEditCard={setEditingCardId}
              />
            ))}
          </section>
          <DragOverlay>
            {activeCard ? (
              <div className="w-[260px]">
                <KanbanCardPreview card={activeCard} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>

      <AiSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onBoardMutated={refreshBoard}
      />

      {editingCardId && board.cards[editingCardId] && (
        <CardModal
          card={board.cards[editingCardId]}
          onSave={handleUpdateCard}
          onClose={() => setEditingCardId(null)}
        />
      )}
    </div>
  );
};
