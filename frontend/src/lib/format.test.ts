import { errorMessage } from "../api/client";
import { availability, fmt, formatToolCall } from "./format";
import { toQuery } from "../features/predictions/filterValues";

describe("formatToolCall", () => {
  it("formats arguments like a function call", () => {
    expect(formatToolCall({ tool: "get_predictions", args: { position: "DEF", max_price: 5 } })).toBe(
      'get_predictions(position="DEF", max_price=5)',
    );
    expect(formatToolCall({ tool: "compare_players", args: { names: ["Saka", "Salah"] } })).toBe(
      'compare_players(names=["Saka","Salah"])',
    );
    expect(formatToolCall({ tool: "get_predictions", args: {} })).toBe("get_predictions()");
    expect(formatToolCall({ tool: "x", args: null })).toBe("x()");
    expect(formatToolCall({ tool: "x", args: [1, 2] })).toBe("x([1,2])");
  });
});

describe("availability", () => {
  it("uses the same rule as the old UI", () => {
    expect(availability({ chance_of_playing: 100, status: "available" })).toBe("fit");
    expect(availability({ chance_of_playing: 100, status: "doubtful" })).toBe("doubtful");
    expect(availability({ chance_of_playing: 25, status: "doubtful" })).toBe("doubtful");
    expect(availability({ chance_of_playing: 0, status: "injured" })).toBe("out");
  });
});

describe("helpers", () => {
  it("fmt shows a dash for missing numbers", () => {
    expect(fmt(null, 2)).toBe("–");
    expect(fmt(1.234, 1)).toBe("1.2");
  });

  it("errorMessage reads FastAPI error bodies", () => {
    expect(errorMessage({ detail: "Chat needs OPENAI_API_KEY in .env." }, 503)).toBe("Chat needs OPENAI_API_KEY in .env.");
    expect(errorMessage({ detail: [{ loc: ["query", "top_n"], msg: "too big" }] }, 422)).toBe(
      "Invalid request (top_n: too big)",
    );
    expect(errorMessage(null, 500)).toBe("Request failed (500)");
    expect(errorMessage("<html>", 502)).toBe("Request failed (502)");
  });

  it("toQuery drops empty and invalid filters", () => {
    expect(toQuery({ position: "", maxPrice: "", team: "  ", rankBy: "next" })).toEqual({ top_n: 30, horizon: 5 });
    expect(toQuery({ position: "MID", maxPrice: "7.5", team: " ars ", rankBy: "horizon" })).toEqual({
      top_n: 30,
      horizon: 5,
      rank_by: "horizon",
      position: "MID",
      max_price: 7.5,
      team: "ars",
    });
    expect(toQuery({ position: "", maxPrice: "0", team: "", rankBy: "next" }).max_price).toBeUndefined();
    expect(toQuery({ position: "", maxPrice: "-2", team: "", rankBy: "next" }).max_price).toBeUndefined();
  });
});
