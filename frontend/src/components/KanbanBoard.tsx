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

const COLUMN_COLORS = ["#ecad0a", "#209dd7", "#753991", "#22c55e", "#f97316"] as const;

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
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--stroke)] border-t-[var(--primary-blue)]" />
      </div>
    );
  }

  const activeCard = activeCardId ? cardsById[activeCardId] : null;
  const totalCards = board.columns.reduce((sum, col) => sum + col.cardIds.length, 0);

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full" style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--primary-blue) 25%, transparent) 0%, color-mix(in srgb, var(--primary-blue) 5%, transparent) 55%, transparent 70%)" }} />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full" style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--secondary-purple) 18%, transparent) 0%, color-mix(in srgb, var(--secondary-purple) 5%, transparent) 55%, transparent 75%)" }} />

      <main
        className={clsx(
          "relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-8 px-6 pb-16 pt-10",
          "transition-[padding] duration-300",
          sidebarOpen && "lg:pr-[calc(24px+384px)]",
        )}
      >
        <header className="flex items-center justify-between gap-6 rounded-[28px] border border-[var(--stroke)] bg-white/80 px-8 py-6 shadow-[var(--shadow)] backdrop-blur">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
              Single Board Kanban
            </p>
            <h1 className="mt-1.5 font-display text-3xl font-semibold text-[var(--navy-dark)]">
              Kanban Studio
            </h1>
            <div className="mt-3 flex items-center gap-4">
              <span className="text-xs text-[var(--gray-text)]">
                <span className="font-semibold text-[var(--navy-dark)]">{board.columns.length}</span> columns
              </span>
              <span className="h-1 w-1 rounded-full bg-[var(--stroke)]" />
              <span className="text-xs text-[var(--gray-text)]">
                <span className="font-semibold text-[var(--navy-dark)]">{totalCards}</span> cards
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-expanded={sidebarOpen}
              aria-controls="ai-sidebar"
              className={clsx(
                "rounded-full px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] transition",
                sidebarOpen
                  ? "bg-[var(--secondary-purple)] text-white hover:brightness-110"
                  : "border border-[var(--stroke)] text-[var(--secondary-purple)] hover:border-[var(--secondary-purple)]/40 hover:bg-[var(--secondary-purple)]/5",
              )}
            >
              AI
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-[var(--stroke)] px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)] transition hover:border-[var(--navy-dark)]/20 hover:text-[var(--navy-dark)]"
            >
              Sign out
            </button>
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <section className="grid gap-5 lg:grid-cols-5">
            {optimisticColumns.map((column, index) => (
              <KanbanColumn
                key={column.id}
                column={column}
                cards={column.cardIds.map((cardId) => board.cards[cardId]).filter(Boolean)}
                accentColor={COLUMN_COLORS[index % COLUMN_COLORS.length]}
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
