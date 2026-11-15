import { screen, waitFor, within } from "@testing-library/react";
import type { ChatResponse } from "../../api/endpoints";
import { deferred, json, mockApi } from "../../test/mockApi";
import { predictions, status } from "../../test/fixtures";
import { renderApp } from "../../test/render";

const log = () => screen.getByRole("log", { name: "Conversation" });
const input = () => screen.getByRole("textbox", { name: "Question" });
const send = () => screen.getByRole("button", { name: "Send" });

describe("chat", () => {
  it("keeps the session id across messages and shows the tools the agent used", async () => {
    let n = 0;
    const api = mockApi({
      "GET /api/status": status(),
      "GET /api/predictions": predictions(),
      "POST /api/chat": (): ChatResponse => {
        n += 1;
        return n === 1
          ? {
              session_id: "s-123",
              answer: "Captain Haaland.",
              tools: [
                { tool: "get_predictions", args: { position: "FWD", top_n: 5 } },
                { tool: "get_news", args: { query: "Haaland injury" } },
              ],
            }
          : { session_id: "s-123", answer: "Saka is doubtful.", tools: [] };
      },
    });
    const { user } = renderApp();
    await screen.findByText(/Ask me about captains/);

    await user.type(input(), "Who should I captain?");
    await user.click(send());
    expect(await within(log()).findByText("Captain Haaland.")).toBeInTheDocument();
    expect(within(log()).getByText("Tools used")).toBeInTheDocument();
    expect(within(log()).getByText('get_predictions(position="FWD", top_n=5)')).toBeInTheDocument();
    expect(within(log()).getByText('get_news(query="Haaland injury")')).toBeInTheDocument();
    expect(input()).toHaveValue("");
    expect(input()).toHaveFocus();

    await user.type(input(), "And Saka?{Enter}");
    expect(await within(log()).findByText("Saka is doubtful.")).toBeInTheDocument();

    const bodies = api.callsTo("/api/chat").map((c) => c.body);
    expect(bodies).toEqual([
      { message: "Who should I captain?", session_id: null },
      { message: "And Saka?", session_id: "s-123" },
    ]);
  });

  it("shows Thinking… while waiting and blocks double sends", async () => {
    const reply = deferred<ChatResponse>();
    const api = mockApi({
      "GET /api/status": status(),
      "GET /api/predictions": predictions(),
      "POST /api/chat": () => reply.promise,
    });
    const { user } = renderApp();
    await screen.findByText(/Ask me about captains/);

    await user.click(screen.getByRole("button", { name: "Any Arsenal injuries?" })); // a suggested question
    expect(await within(log()).findByText("Thinking")).toBeInTheDocument();
    expect(within(log()).getByText("Any Arsenal injuries?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Who should I captain?" })).toBeDisabled();
    await user.type(input(), "again{Enter}");
    expect(api.callsTo("/api/chat")).toHaveLength(1);

    reply.resolve({ session_id: "s1", answer: "Saka has a knock.", tools: [] });
    expect(await within(log()).findByText("Saka has a knock.")).toBeInTheDocument();
    expect(within(log()).queryByText("Thinking")).not.toBeInTheDocument();
    expect(within(log()).queryByText("Tools used")).not.toBeInTheDocument();
  });

  it("shows API errors in the conversation", async () => {
    mockApi({
      "GET /api/status": status(),
      "GET /api/predictions": predictions(),
      "POST /api/chat": json(502, { detail: "The language model call failed: RateLimitError" }),
    });
    const { user } = renderApp();
    await screen.findByText(/Ask me about captains/);
    await user.type(input(), "hi{Enter}");
    expect(await within(log()).findByRole("alert")).toHaveTextContent(
      "Error: The language model call failed: RateLimitError",
    );
    expect(send()).toBeDisabled(); // input was cleared
    await user.type(input(), "x");
    expect(send()).toBeEnabled(); // and the chat still works afterwards
  });

  it("is disabled, with instructions, when the server has no OpenAI key", async () => {
    const api = mockApi({ "GET /api/status": status({ chat_available: false }), "GET /api/predictions": predictions() });
    const { user } = renderApp();
    expect(await within(log()).findByText(/Chat is off: add/)).toHaveTextContent(
      "Chat is off: add OPENAI_API_KEY to .env and restart the server.",
    );
    expect(input()).toBeDisabled();
    expect(send()).toBeDisabled();
    for (const q of ["Who should I captain?", "Best defenders under £5m?", "Any Arsenal injuries?"]) {
      expect(screen.getByRole("button", { name: q })).toBeDisabled();
    }
    await user.click(screen.getByRole("button", { name: "Who should I captain?" }));
    await waitFor(() => {
      expect(api.callsTo("/api/chat")).toHaveLength(0);
    });
    expect(screen.queryByText(/Ask me about captains/)).not.toBeInTheDocument();
  });
});
