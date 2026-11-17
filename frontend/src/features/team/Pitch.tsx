import type { PlayerOption } from "../../api/endpoints";
import { type Draft, type Slot, type SlotRef, sameRef } from "../../lib/plan";
import { POSITION_ORDER } from "../../lib/squad";

const FLAG_DOT = {
  fit: "bg-accent",
  doubtful: "bg-warn",
  out: "bg-bad",
} as const;

interface Props {
  draft: Draft;
  gameweek: number;
  playerOf: (id: number) => PlayerOption | undefined;
  /** The player picked for a substitution or the armband. */
  selected: SlotRef | null;
  /** For a selection: can this slot swap with it? (null = no hint) */
  swapHint: (r: SlotRef) => boolean | null;
  /** The empty slot the player list is open for. */
  picking: SlotRef | null;
  onSelect: (r: SlotRef) => void;
  onRemove: (r: SlotRef) => void;
  onAdd: (r: SlotRef) => void;
}

function Empty({ slot, r, active, onAdd }: { slot: Slot; r: SlotRef; active: boolean; onAdd: (r: SlotRef) => void }) {
  return (
    <li aria-label={`Empty ${slot.position} slot`} className="w-[68px] sm:w-[88px]">
      <button
        type="button"
        aria-label={`Add a ${slot.position}`}
        aria-expanded={active}
        className={`flex h-full min-h-[74px] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed bg-surface/60 text-muted transition-colors hover:border-accent hover:text-accent ${active ? "border-accent text-accent" : "border-line"}`}
        onClick={() => {
          onAdd(r);
        }}
      >
        <span className="text-2xl leading-none" aria-hidden="true">
          +
        </span>
        <span className="text-[11px] font-semibold">{slot.position}</span>
      </button>
    </li>
  );
}

function Chip(
  props: Props & {
    r: SlotRef;
    id: number;
    role: "C" | "V" | null;
    benchNo?: number;
  },
) {
  const { r, id, role, benchNo, playerOf, selected, swapHint, onSelect, onRemove } = props;
  const p = playerOf(id);
  const name = p?.name ?? `#${id}`;
  const isSel = sameRef(selected, r);
  const hint = selected && !isSel ? swapHint(r) : null;
  const label = `${name}${role === "C" ? ", captain" : role === "V" ? ", vice-captain" : ""}${benchNo ? `, bench ${benchNo}` : ""}`;
  return (
    <li aria-label={label} className={`relative w-[68px] sm:w-[88px] ${hint === false ? "opacity-45" : ""}`}>
      <button
        type="button"
        aria-pressed={isSel}
        aria-label={`Select ${name}`}
        className={`flex w-full flex-col items-center rounded-lg border bg-surface px-1 pt-2 pb-1.5 text-center shadow-[0_1px_2px_rgb(0_0_0/0.08)] transition-shadow ${isSel ? "border-accent ring-2 ring-accent" : hint ? "border-accent border-dashed" : "border-line hover:border-accent"}`}
        onClick={() => {
          onSelect(r);
        }}
      >
        <span className="flex max-w-full items-center gap-1">
          <span className={`size-1.5 shrink-0 rounded-full ${FLAG_DOT[p?.availability ?? "fit"]}`} aria-hidden="true" />
          <span className="truncate text-[12px] font-semibold sm:text-[13px]">{name}</span>
        </span>
        <span className="max-w-full truncate text-[10px] text-muted sm:text-[11px]">
          {p?.team} · {p?.fixtures[0] || "blank"}
        </span>
        <span className="font-mono text-[13px] font-medium tabular-nums">
          {(p?.expected_points[0] ?? 0).toFixed(1)}
        </span>
      </button>
      {role && (
        <span
          className={`pointer-events-none absolute -top-2 -left-1.5 grid size-5 place-items-center rounded-full text-[11px] font-bold ${role === "C" ? "bg-ink text-surface" : "border border-line bg-surface text-ink"}`}
          aria-hidden="true"
        >
          {role}
        </span>
      )}
      <button
        type="button"
        aria-label={`Remove ${name}`}
        title={`Remove ${name} (then pick a replacement)`}
        className="absolute -top-2 -right-1.5 grid size-5 place-items-center rounded-full border border-line bg-surface text-[13px] leading-none text-muted hover:border-bad hover:bg-bad hover:text-surface"
        onClick={() => {
          onRemove(r);
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </li>
  );
}

/** Your XI for the next gameweek on a pitch, bench below. Click to select, × to sell, + to buy. */
export function Pitch(props: Props) {
  const { draft, gameweek, picking, onAdd } = props;
  const slot = (s: Slot, r: SlotRef, role: "C" | "V" | null, benchNo?: number) =>
    s.id === null ? (
      <Empty key={`${r.part}${r.index}`} slot={s} r={r} active={sameRef(picking, r)} onAdd={onAdd} />
    ) : (
      <Chip key={`${r.part}${r.index}`} {...props} r={r} id={s.id} role={role} benchNo={benchNo} />
    );
  return (
    <figure aria-label={`Your team for gameweek ${gameweek}`}>
      <div className="space-y-3 rounded-xl border border-line bg-accent-soft px-1.5 py-4 sm:px-4">
        {POSITION_ORDER.map((pos) => (
          <ul key={pos} aria-label={pos} className="flex flex-wrap justify-center gap-2 sm:gap-x-3">
            {draft.xi.map((s, index) =>
              s.position === pos
                ? slot(s, { part: "xi", index }, index === draft.captain ? "C" : index === draft.vice ? "V" : null)
                : null,
            )}
          </ul>
        ))}
      </div>
      <p className="mt-3 mb-1.5 text-xs font-semibold tracking-[0.05em] text-muted uppercase">Bench, in order</p>
      <ul aria-label="Bench" className="flex flex-wrap gap-2 sm:gap-x-3">
        {draft.bench.map((s, index) => slot(s, { part: "bench", index }, null, index + 1))}
      </ul>
      <figcaption className="mt-2 text-xs text-muted">
        Click a player, then a bench player, to substitute; click a bench player then another to change the bench order.
        × sells a player, + buys one. C = captain (points ×2), V = vice-captain; the dot shows availability.
      </figcaption>
    </figure>
  );
}
