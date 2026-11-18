import { useEffect, useId, useRef, useState } from "react";
import type { ToolCall } from "../../api/endpoints";
import { useChat, useStatus } from "../../api/queries";
import { Card } from "../../components/Card";
import { formatToolCall } from "../../lib/format";
import { teamContext, useSavedTeam } from "../../lib/teamStore";
import { Link } from "react-router";

const SUGGESTIONS = ["Who should I captain?", "Best defenders under £5m?", "Any Arsenal injuries?"];
const GREETING =
  "Ask me about captains, transfers or injuries. I answer from the model's predictions and the latest FPL news.";

interface Message {
  id: number;
  role: "user" | "assistant" | "error";
  text: string;
  tools?: ToolCall[];
}

function Bubble({ m }: { m: Message }) {
  if (m.role === "user") {
    return (
      <div className="max-w-[92%] self-end rounded-2xl rounded-br-md bg-accent px-3 py-2 whitespace-pre-wrap text-on-accent">
        <span className="sr-only">You: </span>
        {m.text}
      </div>
    );
  }
  if (m.role === "error") {
    return (
      <div role="alert" className="max-w-[92%] self-start rounded-2xl rounded-bl-md bg-bad-soft px-3 py-2 text-bad">
        Error: {m.text}
      </div>
    );
  }
  return (
    <div className="max-w-[92%] self-start rounded-2xl rounded-bl-md border border-line bg-surface-2 px-3 py-2">
      <span className="sr-only">Scout: </span>
      <div className="whitespace-pre-wrap">{m.text}</div>
      {m.tools && m.tools.length > 0 && (
        <div className="mt-2 border-t border-line pt-1.5">
          <p className="text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">Tools used</p>
          <ol className="mt-0.5 space-y-0.5 font-mono text-[11px] text-muted">
            {m.tools.map((t, i) => (
              <li key={i} className="break-words">
                {formatToolCall(t)}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function ChatPanel({ suggestions = SUGGESTIONS }: { suggestions?: readonly string[] }) {
  const status = useStatus();
  const team = useSavedTeam();
  const chat = useChat();
  const enabled = status.data?.chat_available === true;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const sessionId = useRef<string | null>(null); // the backend keeps one agent (with memory) per session
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const add = (m: Omit<Message, "id">) => {
    const id = nextId.current++;
    setMessages((ms) => [...ms, { ...m, id }]);
  };

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, chat.isPending]);

  async function ask(text: string) {
    const message = text.trim();
    if (!enabled || chat.isPending || !message) return;
    add({ role: "user", text: message });
    setInput("");
    try {
      const res = await chat.mutateAsync({
        message,
        session_id: sessionId.current,
        ...(team ? { team: teamContext(team) } : {}), // the agent can analyse it with analyze_my_team
      });
      sessionId.current = res.session_id;
      add({ role: "assistant", text: res.answer, tools: res.tools });
    } catch (e) {
      add({ role: "error", text: e instanceof Error ? e.message : String(e) });
    }
    inputRef.current?.focus();
  }

  const busy = chat.isPending;
  const disabled = !enabled || busy;

  return (
    <Card
      aria-labelledby="chat-h"
      className="flex h-[min(78dvh,680px)] min-h-[460px] flex-col min-[950px]:sticky min-[950px]:top-3 min-[950px]:h-[calc(100dvh-1.5rem)] min-[950px]:max-h-[900px]"
    >
      <h2 id="chat-h" className="heading mb-2.5 text-[22px]">
        Ask the scout
      </h2>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="btn min-h-0 rounded-full px-2.5 py-1 text-xs"
            disabled={disabled}
            onClick={() => void ask(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="-mx-1 flex flex-1 flex-col gap-2.5 overflow-y-auto px-1 py-1 text-sm motion-safe:scroll-smooth"
      >
        {status.isPending && <p className="text-muted">Connecting…</p>}
        {status.error && (
          <p className="rounded-lg bg-warn-soft px-3 py-2.5 text-sm">Chat is unavailable: couldn't reach the server.</p>
        )}
        {status.data && !enabled && (
          <p className="rounded-lg bg-warn-soft px-3 py-2.5 text-sm">
            Chat is off: add <code className="font-mono text-[13px]">OPENAI_API_KEY</code> to{" "}
            <code className="font-mono text-[13px]">.env</code> and restart the server.
          </p>
        )}
        {enabled && <Bubble m={{ id: 0, role: "assistant", text: GREETING }} />}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {busy && (
          <div className="self-start rounded-2xl rounded-bl-md border border-line bg-surface-2 px-3 py-2 text-muted">
            Thinking<span className="motion-safe:animate-pulse">…</span>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-muted">
        {team ? (
          <>
            Using your team{team.entry ? ` “${team.entry.team_name}”` : ""} for questions about it.{" "}
            <Link to="/my-team" className="underline underline-offset-2">
              Edit
            </Link>
          </>
        ) : (
          <>
            Want advice on your own squad?{" "}
            <Link to="/my-team" className="underline underline-offset-2">
              Load your team
            </Link>
          </>
        )}
      </p>
      <form
        className="mt-1.5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Question
        </label>
        <input
          id={inputId}
          ref={inputRef}
          className="field min-w-0 flex-1 px-3 py-2"
          autoComplete="off"
          maxLength={1000}
          placeholder="Ask about captains, transfers, injuries…"
          value={input}
          disabled={!enabled}
          onChange={(e) => {
            setInput(e.target.value);
          }}
        />
        <button type="submit" className="btn btn-primary px-4" disabled={disabled || !input.trim()}>
          Send
        </button>
      </form>
    </Card>
  );
}
