import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, beforeEach } from "vitest";
import { KanbanBoard } from "@/components/KanbanBoard";
import type { BoardData } from "@/lib/kanban";

const mockBoard: BoardData = {
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    { id: "col-progress", title: "In Progress", cardIds: ["card-4", "card-5"] },
    { id: "col-review", title: "Review", cardIds: ["card-6"] },
    { id: "col-done", title: "Done", cardIds: ["card-7", "card-8"] },
  ],
  cards: {
    "card-1": { id: "card-1", title: "Align roadmap themes", details: "Draft quarterly themes." },
    "card-2": { id: "card-2", title: "Gather customer signals", details: "Review support tags." },
    "card-3": { id: "card-3", title: "Prototype analytics view", details: "Sketch layout." },
    "card-4": { id: "card-4", title: "Refine status language", details: "Standardize labels." },
    "card-5": { id: "card-5", title: "Design card layout", details: "Add hierarchy." },
    "card-6": { id: "card-6", title: "QA micro-interactions", details: "Verify states." },
    "card-7": { id: "card-7", title: "Ship marketing page", details: "Copy approved." },
    "card-8": { id: "card-8", title: "Close onboarding sprint", details: "Release notes." },
  },
};

vi.mock("@/lib/api", () => ({
  api: {
    getBoard: vi.fn(),
    renameColumn: vi.fn().mockResolvedValue({ ok: true }),
    addCard: vi.fn(),
    deleteCard: vi.fn().mockResolvedValue({ ok: true }),
    moveCard: vi.fn().mockResolvedValue({ ok: true }),
    logout: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { api } from "@/lib/api";

const mockApi = vi.mocked(api);

beforeEach(() => {
  mockApi.getBoard.mockResolvedValue(structuredClone(mockBoard));
  mockApi.addCard.mockResolvedValue({ id: "card-new", title: "New card", details: "Notes" });
});

const noop = () => {};

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];

describe("KanbanBoard", () => {
  it("renders five columns after loading", async () => {
    render(<KanbanBoard onLogout={noop} />);
    await waitFor(() =>
      expect(screen.getAllByTestId(/column-/i)).toHaveLength(5)
    );
  });

  it("renames a column", async () => {
    render(<KanbanBoard onLogout={noop} />);
    await waitFor(() => screen.getAllByTestId(/column-/i));
    const column = getFirstColumn();
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");
    expect(input).toHaveValue("New Name");
  });

  it("adds and removes a card", async () => {
    render(<KanbanBoard onLogout={noop} />);
    await waitFor(() => screen.getAllByTestId(/column-/i));
    const column = getFirstColumn();

    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(column).getByPlaceholderText(/card title/i), "New card");
    await userEvent.type(within(column).getByPlaceholderText(/details/i), "Notes");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    await waitFor(() => expect(within(column).getByText("New card")).toBeInTheDocument());

    await userEvent.click(within(column).getByRole("button", { name: /delete new card/i }));
    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
  });

  it("shows sign out button", async () => {
    render(<KanbanBoard onLogout={noop} />);
    await waitFor(() => screen.getByRole("button", { name: /sign out/i }));
  });

  it("calls onLogout when signing out", async () => {
    const onLogout = vi.fn();
    render(<KanbanBoard onLogout={onLogout} />);
    await waitFor(() => screen.getByRole("button", { name: /sign out/i }));
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(onLogout).toHaveBeenCalled());
  });

  it("toggles the AI sidebar with the AI button", async () => {
    render(<KanbanBoard onLogout={noop} />);
    await waitFor(() => screen.getAllByTestId(/column-/i));
    const aiButton = screen.getByRole("button", { name: /^ai$/i });
    expect(screen.getByTestId("ai-sidebar")).toHaveClass("translate-x-full");
    await userEvent.click(aiButton);
    expect(screen.getByTestId("ai-sidebar")).not.toHaveClass("translate-x-full");
    await userEvent.click(aiButton);
    expect(screen.getByTestId("ai-sidebar")).toHaveClass("translate-x-full");
  });
});
