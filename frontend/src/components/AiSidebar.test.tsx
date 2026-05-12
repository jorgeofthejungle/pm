import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, beforeEach } from "vitest";
import { AiSidebar } from "@/components/AiSidebar";

vi.mock("@/lib/api", () => ({
  api: {
    chat: vi.fn(),
  },
}));

import { api } from "@/lib/api";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as any;

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.chat.mockResolvedValue({ reply: "Hello!", boardUpdate: null });
});

describe("AiSidebar", () => {
  it("is hidden when open=false", () => {
    render(<AiSidebar open={false} onClose={noop} onBoardMutated={noop} />);
    expect(screen.getByTestId("ai-sidebar")).toHaveClass("translate-x-full");
  });

  it("is visible when open=true", () => {
    render(<AiSidebar open={true} onClose={noop} onBoardMutated={noop} />);
    expect(screen.getByTestId("ai-sidebar")).not.toHaveClass("translate-x-full");
  });

  it("calls onClose when close button clicked", async () => {
    const onClose = vi.fn();
    render(<AiSidebar open={true} onClose={onClose} onBoardMutated={noop} />);
    await userEvent.click(screen.getByRole("button", { name: /close ai sidebar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("sends a message and shows the reply", async () => {
    render(<AiSidebar open={true} onClose={noop} onBoardMutated={noop} />);
    await userEvent.type(screen.getByLabelText("Message"), "Hello");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(screen.getByText("Hello!")).toBeInTheDocument());
  });

  it("shows the user message in the chat", async () => {
    render(<AiSidebar open={true} onClose={noop} onBoardMutated={noop} />);
    await userEvent.type(screen.getByLabelText("Message"), "What is my board?");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(screen.getByText("What is my board?")).toBeInTheDocument();
  });

  it("clears input after sending", async () => {
    render(<AiSidebar open={true} onClose={noop} onBoardMutated={noop} />);
    const textarea = screen.getByLabelText("Message");
    await userEvent.type(textarea, "Test message");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(textarea).toHaveValue(""));
  });

  it("calls onBoardMutated when boardUpdate has operations", async () => {
    mockApi.chat.mockResolvedValue({
      reply: "Added a card.",
      boardUpdate: { operations: [{ op: "add_card" }], errors: [] },
    });
    const onBoardMutated = vi.fn();
    render(<AiSidebar open={true} onClose={noop} onBoardMutated={onBoardMutated} />);
    await userEvent.type(screen.getByLabelText("Message"), "Add a card");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(onBoardMutated).toHaveBeenCalled());
  });

  it("does not call onBoardMutated when boardUpdate is null", async () => {
    mockApi.chat.mockResolvedValue({ reply: "Just a reply.", boardUpdate: null });
    const onBoardMutated = vi.fn();
    render(<AiSidebar open={true} onClose={noop} onBoardMutated={onBoardMutated} />);
    await userEvent.type(screen.getByLabelText("Message"), "Hello");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => screen.getByText("Just a reply."));
    expect(onBoardMutated).not.toHaveBeenCalled();
  });

  it("shows error message on API failure", async () => {
    mockApi.chat.mockRejectedValue(new Error("Network error"));
    render(<AiSidebar open={true} onClose={noop} onBoardMutated={noop} />);
    await userEvent.type(screen.getByLabelText("Message"), "Hello");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    );
  });

  it("passes conversation history on follow-up messages", async () => {
    mockApi.chat
      .mockResolvedValueOnce({ reply: "First reply.", boardUpdate: null })
      .mockResolvedValueOnce({ reply: "Second reply.", boardUpdate: null });
    render(<AiSidebar open={true} onClose={noop} onBoardMutated={noop} />);

    const textarea = screen.getByLabelText("Message");
    const sendBtn = screen.getByRole("button", { name: /send/i });

    await userEvent.type(textarea, "First");
    await userEvent.click(sendBtn);
    await waitFor(() => screen.getByText("First reply."));

    await userEvent.type(textarea, "Second");
    await userEvent.click(sendBtn);
    await waitFor(() => screen.getByText("Second reply."));

    expect(mockApi.chat).toHaveBeenCalledTimes(2);
    const [, history] = mockApi.chat.mock.calls[1];
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: "user", content: "First" });
    expect(history[1]).toEqual({ role: "assistant", content: "First reply." });
  });

  it("submit button is disabled when input is empty", () => {
    render(<AiSidebar open={true} onClose={noop} onBoardMutated={noop} />);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("submit with Enter key sends message", async () => {
    render(<AiSidebar open={true} onClose={noop} onBoardMutated={noop} />);
    await userEvent.type(screen.getByLabelText("Message"), "Hello{Enter}");
    await waitFor(() => expect(mockApi.chat).toHaveBeenCalledWith("Hello", []));
  });
});
