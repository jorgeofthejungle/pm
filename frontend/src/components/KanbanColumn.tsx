import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Card, Column } from "@/lib/kanban";
import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";

type KanbanColumnProps = {
  column: Column;
  cards: Card[];
  accentColor: string;
  onRename: (columnId: string, title: string) => void;
  onAddCard: (columnId: string, title: string, details: string) => void;
  onDeleteCard: (columnId: string, cardId: string) => void;
  onEditCard: (cardId: string) => void;
};

export const KanbanColumn = ({
  column,
  cards,
  accentColor,
  onRename,
  onAddCard,
  onDeleteCard,
  onEditCard,
}: KanbanColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className="flex min-h-[520px] flex-col overflow-hidden rounded-3xl border border-[var(--stroke)] bg-[var(--surface-strong)] shadow-[var(--shadow)] transition-all duration-200"
      style={isOver ? { boxShadow: `0 0 0 2px ${accentColor}, var(--shadow)` } : undefined}
      data-testid={`column-${column.id}`}
    >
      <div className="h-1 w-full shrink-0" style={{ background: accentColor }} />

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em]"
              style={{ background: `${accentColor}18`, color: accentColor }}
            >
              {cards.length}
            </span>
            <input
              value={column.title}
              onChange={(event) => onRename(column.id, event.target.value)}
              className="mt-2 w-full bg-transparent font-display text-base font-semibold text-[var(--navy-dark)] outline-none transition placeholder:text-[var(--gray-text)]"
              aria-label="Column title"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-1 flex-col gap-2.5">
          <SortableContext items={column.cardIds} strategy={verticalListSortingStrategy}>
            {cards.map((card) => (
              <KanbanCard
                key={card.id}
                card={card}
                onDelete={(cardId) => onDeleteCard(column.id, cardId)}
                onEdit={onEditCard}
              />
            ))}
          </SortableContext>
          {cards.length === 0 && (
            <div
              className="flex flex-1 items-center justify-center rounded-2xl border border-dashed px-3 py-6 text-center text-xs font-semibold uppercase tracking-[0.2em] transition-colors"
              style={{ borderColor: `${accentColor}40`, color: `${accentColor}99` }}
            >
              Drop a card here
            </div>
          )}
        </div>

        <NewCardForm
          onAdd={(title, details) => onAddCard(column.id, title, details)}
        />
      </div>
    </section>
  );
};
