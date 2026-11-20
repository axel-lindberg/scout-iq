import type { PlayerOption } from "../../api/endpoints";
import { type Draft, type Slot, type SlotRef, sameRef } from "../../lib/plan";
import { POSITION_ORDER } from "../../lib/squad";
import { Shirt } from "../../components/Shirt";
import { type Level, LEVEL_FILL, LEVEL_NAME } from "../../lib/difficulty";

/** Five players must fit side by side on a phone. */
const CHIP_W = "w-[62px] shrink-0 sm:w-[100px]";

const FLAG_DOT = {
  fit: "bg-accent",
  doubtful: "bg-warn",
  out: "bg-bad",
} as const;

interface Props {
  draft: Draft;
  gameweek: number;
  /** Index of `gameweek` in each player's `fixtures` / `expected_points`. */
  gwIndex: number;
  playerOf: (id: number) => PlayerOption | undefined;
  /** Fixture difficulty of the player's club this gameweek: null = blank, undefined = not known (yet). */
  levelOf: (id: number) => Level | null | undefined;
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
    <li aria-label={`Empty ${slot.position} slot`} className={CHIP_W}>
      <button
        type="button"
        aria-label={`Add a ${slot.position}`}
        aria-expanded={active}
        className={`flex min-h-[92px] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed bg-black/10 text-white transition-colors hover:bg-black/20 sm:min-h-[118px] ${active ? "border-warn" : "border-white/70"}`}
        onClick={() => {
          onAdd(r);
        }}
      >
        <span className="text-3xl leading-none" aria-hidden="true">
          +
        </span>
        <span className="text-[11px] font-semibold">{slot.position}</span>
      </button>
    </li>
  );
}

function Chip(props: Props & { r: SlotRef; id: number; role: "C" | "V" | null; benchNo?: number }) {
  const { r, id, role, benchNo, gwIndex, playerOf, levelOf, selected, swapHint, onSelect, onRemove } = props;
  const p = playerOf(id);
  const name = p?.name ?? `#${id}`;
  const isSel = sameRef(selected, r);
  const level = levelOf(id);
  const fill = level ? LEVEL_FILL[level] : "bg-surface text-ink";
  const hint = selected && !isSel ? swapHint(r) : null;
  const label = `${name}${role === "C" ? ", captain" : role === "V" ? ", vice-captain" : ""}${benchNo ? `, bench ${benchNo}` : ""}`;
  return (
    <li aria-label={label} className={`relative ${CHIP_W} ${hint === false ? "opacity-45" : ""}`}>
      <button
        type="button"
        aria-pressed={isSel}
        aria-label={`Select ${name}`}
        className={`group flex w-full flex-col items-center rounded-lg pt-1 transition-transform hover:-translate-y-0.5 motion-reduce:transition-none ${isSel ? "ring-[3px] ring-warn" : hint ? "outline-2 outline-offset-1 outline-warn outline-dashed" : ""}`}
        onClick={() => {
          onSelect(r);
        }}
      >
        <Shirt
          teamCode={p?.team_code}
          isGoalkeeper={p?.position === "GK"}
          size={56}
          className="h-auto w-10 drop-shadow-[0_2px_2px_rgb(0_0_0/0.35)] sm:w-14"
        />
        <span className="-mt-1 flex w-full items-center justify-center gap-1 rounded-t-md bg-chip px-1 py-0.5 text-chip-ink">
          <span className={`size-1.5 shrink-0 rounded-full ${FLAG_DOT[p?.availability ?? "fit"]}`} aria-hidden="true" />
          <span className="truncate text-[11px] font-semibold sm:text-[12px]">{name}</span>
        </span>
        <span
          className={`flex w-full flex-col items-center rounded-b-md px-1 py-0.5 shadow-[0_1px_2px_rgb(0_0_0/0.2)] sm:flex-row sm:justify-between sm:gap-1 ${fill}`}
          data-fdr={level ?? undefined}
          title={level ? `${LEVEL_NAME[level]} fixture` : undefined}
        >
          <span className={`max-w-full truncate text-[10px] sm:text-[11px] ${level ? "font-medium" : "text-muted"}`}>
            {p?.fixtures[gwIndex] || "blank"}
            {level && <span className="sr-only">, {LEVEL_NAME[level].toLowerCase()} fixture</span>}
          </span>
          <span className="font-mono text-[12px] font-semibold tabular-nums sm:text-[13px]">
            {(p?.expected_points[gwIndex] ?? 0).toFixed(1)}
          </span>
        </span>
      </button>
      {role && (
        <span
          className={`pointer-events-none absolute -top-1 -left-1 grid size-5 place-items-center rounded-full text-[11px] font-bold shadow ${role === "C" ? "bg-ink text-surface" : "border border-line bg-surface text-ink"}`}
          aria-hidden="true"
        >
          {role}
        </span>
      )}
      <button
        type="button"
        aria-label={`Remove ${name}`}
        title={`Remove ${name} (then pick a replacement)`}
        className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full border border-line bg-surface text-[13px] leading-none text-muted shadow hover:border-bad hover:bg-bad hover:text-surface"
        onClick={() => {
          onRemove(r);
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </li>
  );
}

/** Your XI for one gameweek on a pitch, bench below. Click to select, × to sell, + to buy. */
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
      <div className="pitch relative overflow-hidden rounded-xl px-1 pt-4 pb-6 sm:px-4 sm:pt-6 sm:pb-10">
        <div className="pitch-box pointer-events-none absolute top-0 left-1/2 h-[17%] w-[58%] -translate-x-1/2" aria-hidden="true">
          <div className="pitch-box mx-auto h-[40%] w-[45%]" />
        </div>
        <div className="relative space-y-3 sm:space-y-6">
          {POSITION_ORDER.map((pos) => (
            <ul key={pos} aria-label={pos} className="flex justify-center gap-1 sm:gap-4">
              {draft.xi.map((s, index) =>
                s.position === pos
                  ? slot(s, { part: "xi", index }, index === draft.captain ? "C" : index === draft.vice ? "V" : null)
                  : null,
              )}
            </ul>
          ))}
        </div>
      </div>
      <div className="mt-2 rounded-xl border border-line bg-surface-2 px-1 py-2 sm:px-4">
        <p className="mb-1.5 text-center text-xs font-semibold tracking-[0.05em] text-muted uppercase">
          Bench, in order
        </p>
        <ul aria-label="Bench" className="flex justify-center gap-1 sm:gap-4">
          {draft.bench.map((s, index) => slot(s, { part: "bench", index }, null, index + 1))}
        </ul>
      </div>
      <figcaption className="mt-2 text-xs text-muted">
        Click a player, then a bench player, to substitute; click a bench player then another to change the bench order.
        × sells a player, + buys one. C = captain (points ×2), V = vice-captain; the dot shows availability; the
        bottom colour is the fixture difficulty (Overall, as on the Fixtures page). Shirts:
        official FPL images.
      </figcaption>
    </figure>
  );
}
