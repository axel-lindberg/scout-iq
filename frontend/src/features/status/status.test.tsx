import { screen } from "@testing-library/react";
import { json, mockApi } from "../../test/mockApi";
import { predictions, status } from "../../test/fixtures";
import { renderApp } from "../../test/render";

describe("header and model card", () => {
  it("shows season, gameweek, data freshness and first kickoff", async () => {
    mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions() });
    renderApp();
    expect(await screen.findByText("2026-27 · Gameweek 11")).toBeInTheDocument();
    expect(screen.getByText(/Data through GW 10 · first kickoff/)).toBeInTheDocument();
    const time = screen.getByText((_, el) => el?.tagName === "TIME");
    expect(time).toHaveAttribute("dateTime", "2026-11-22T12:30:00+00:00");
    expect(time.textContent).toMatch(/22/);
  });

  it("shows MAE vs baseline, improvement, captain points and how it was evaluated", async () => {
    mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions() });
    renderApp();
    const card = await screen.findByRole("region", { name: "Model evaluation" });
    expect(await screen.findByText("1.88")).toBeInTheDocument();
    expect(card).toHaveTextContent("vs 1.99 season-average baseline");
    expect(card).toHaveTextContent("Improvement5.9%lower error"); // (1.994 - 1.877) / 1.994
    expect(card).toHaveTextContent("Captain pick7.0 ptsper GW vs 6.2");
    expect(card).toHaveTextContent(
      "Tested walk-forward, retrained before every gameweek on the 2025-26 season, players who had recently played.",
    );
  });

  it("explains an empty model card", async () => {
    mockApi({ "GET /api/status": status({ model_card: {} }), "GET /api/predictions": predictions() });
    renderApp();
    expect(await screen.findByText(/No evaluation results yet/)).toHaveTextContent(
      "No evaluation results yet. Run scripts/train_evaluate.py to show them here.",
    );
  });

  it("shows when the status call fails", async () => {
    mockApi({ "GET /api/status": json(500, { detail: "boom" }), "GET /api/predictions": predictions() });
    renderApp();
    expect(await screen.findByText("Couldn't reach the server")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByText("Model evaluation unavailable.")).toBeInTheDocument();
    expect(screen.getByText(/Chat is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Question" })).toBeDisabled();
  });
});

describe("routing", () => {
  it("shows a not-found page for unknown client routes", async () => {
    mockApi({ "GET /api/status": status(), "GET /api/predictions": predictions() });
    const { user } = renderApp("/no-such-page");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Back to predictions" }));
    expect(await screen.findByRole("heading", { name: "Expected points" })).toBeInTheDocument();
  });
});
