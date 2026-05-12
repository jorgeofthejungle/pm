import { expect, test, type Page } from "@playwright/test";
import type { BoardData } from "../src/lib/kanban";

const mockBoard: BoardData = {
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    { id: "col-progress", title: "In Progress", cardIds: ["card-4", "card-5"] },
    { id: "col-review", title: "Review", cardIds: ["card-6"] },
    { id: "col-done", title: "Done", cardIds: ["card-7", "card-8"] },
  ],
  cards: {
    "card-1": { id: "card-1", title: "Align roadmap themes", details: "Draft quarterly themes.", notes: "" },
    "card-2": { id: "card-2", title: "Gather customer signals", details: "Review support tags.", notes: "" },
    "card-3": { id: "card-3", title: "Prototype analytics view", details: "Sketch layout.", notes: "" },
    "card-4": { id: "card-4", title: "Refine status language", details: "Standardize labels.", notes: "" },
    "card-5": { id: "card-5", title: "Design card layout", details: "Add hierarchy.", notes: "" },
    "card-6": { id: "card-6", title: "QA micro-interactions", details: "Verify states.", notes: "" },
    "card-7": { id: "card-7", title: "Ship marketing page", details: "Copy approved.", notes: "" },
    "card-8": { id: "card-8", title: "Close onboarding sprint", details: "Release notes.", notes: "" },
  },
};

async function setupApiMocks(page: Page) {
  await page.route("/api/me", (route) =>
    route.fulfill({ json: { userId: "user-1" } })
  );
  await page.route("/api/board", (route) =>
    route.fulfill({ json: mockBoard })
  );
  await page.route("/api/login", (route) =>
    route.fulfill({ json: { ok: true } })
  );
  await page.route("/api/logout", (route) =>
    route.fulfill({ json: { ok: true } })
  );
  await page.route("/api/columns/**", (route) =>
    route.fulfill({ json: { ok: true } })
  );
  await page.route("/api/cards/**", (route) => {
    if (route.request().url().includes("/cards/") && !route.request().url().includes("/move")) {
      if (route.request().method() === "POST") {
        route.fulfill({ json: { id: "card-new", title: "Playwright card", details: "Added via e2e." } });
        return;
      }
    }
    route.fulfill({ json: { ok: true } });
  });
}

test("loads the kanban board", async ({ page }) => {
  await setupApiMocks(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("adds a card to a column", async ({ page }) => {
  await setupApiMocks(page);
  await page.route("/api/columns/col-backlog/cards", (route) =>
    route.fulfill({ json: { id: "card-new", title: "Playwright card", details: "Added via e2e." } })
  );
  await page.goto("/");
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();
});

test("moves a card between columns", async ({ page }) => {
  await setupApiMocks(page);
  await page.goto("/");
  const card = page.getByTestId("card-card-1");
  const targetColumn = page.getByTestId("column-col-review");
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/move")),
    (async () => {
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + 120, { steps: 12 });
      await page.mouse.up();
    })(),
  ]);
  await expect(targetColumn.getByTestId("card-card-1")).toBeVisible();
});

test("shows sign out button and logs out", async ({ page }) => {
  await setupApiMocks(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("shows login form when unauthenticated", async ({ page }) => {
  await page.route("/api/me", (route) =>
    route.fulfill({ status: 401, json: { detail: "Not authenticated" } })
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  await expect(page.getByLabel("Username")).toBeVisible();
});
