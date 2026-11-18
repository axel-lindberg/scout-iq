import type { Player } from "../../api/endpoints";
import { AvailabilityBadge } from "../../components/AvailabilityBadge";
import { aheadOpacity } from "../../lib/format";

interface Props {
  players: Player[];
  /** Gameweeks after the next one, shown as extra columns (empty: next gameweek only). */
  laterGameweeks?: readonly number[];
  selected: readonly string[];
  selectionFull: boolean;
  onToggle: (fullName: string, checked: boolean) => void;
  stale: boolean;
}

const BAR_PX = 40;
// Opaque row colours, also set on the sticky first two columns so they cover what scrolls under them.
const ROW_BG = "bg-surface group-hover:bg-surface-2 group-data-[selected=true]:bg-accent-soft";

export function PredictionsTable({ players, laterGameweeks = [], selected, selectionFull, onToggle, stale }: Props) {
  const maxXp = Math.max(1, ...players.map((p) => p.expected_points_adjusted));
  return (
    <tbody className={stale ? "opacity-60 transition-opacity" : "transition-opacity"}>
      {players.map((p) => {
        const isSelected = selected.includes(p.full_name);
        return (
          <tr key={`${p.full_name}-${p.team}`} data-selected={isSelected}
            className="group bg-surface hover:bg-surface-2 data-[selected=true]:bg-accent-soft"
          >
            {/* pl-2 + a 24px box = exactly 32px, so the column can't shrink and the player column
                (sticky at left-8 = 32px) never leaves a gap when the table scrolls sideways. */}
            <td className={`sticky left-0 z-[1] w-8 py-2 pr-0 pl-2 ${ROW_BG}`}>
              <span className="inline-flex w-6 items-center">
                <input
                  type="checkbox"
                  className="size-4"
                  aria-label={`Select ${p.name} to compare`}
                  checked={isSelected}
                  disabled={!isSelected && selectionFull}
                  onChange={(e) => {
                    onToggle(p.full_name, e.target.checked);
                  }}
                />
              </span>
            </td>
            <td className={`sticky left-8 z-[1] px-2 py-2 whitespace-nowrap ${ROW_BG}`}>
              <span className="font-semibold">{p.name}</span> <span className="text-muted">{p.team}</span>
            </td>
            <td className="px-2 py-2">
              <span className="rounded border border-line bg-bg px-1.5 py-px text-[11px] font-semibold">
                {p.position}
              </span>
            </td>
            <td className="px-2 py-2 text-[13px]">{p.fixtures}</td>
            <td className="px-2 py-2 text-right font-mono text-[13px] tabular-nums">{p.price.toFixed(1)}</td>
            <td className="px-2 py-2 text-right whitespace-nowrap">
              <span className="font-mono font-medium tabular-nums">{p.expected_points_adjusted.toFixed(2)}</span>
              <span
                aria-hidden="true"
                className="ml-2 inline-block h-1.5 w-10 overflow-hidden rounded-full bg-line align-middle"
              >
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${Math.round((BAR_PX * p.expected_points_adjusted) / maxXp)}px` }}
                />
              </span>
            </td>
            {laterGameweeks.map((gw, i) => {
              const g = p.gameweeks?.find((x) => x.gameweek === gw);
              return (
                <td
                  key={gw}
                  className="px-2 py-1.5 text-right whitespace-nowrap"
                  style={{ opacity: aheadOpacity(i + 1) }}
                >
                  <span className="block font-mono text-[13px] tabular-nums">
                    {g ? g.expected_points_adjusted.toFixed(1) : "–"}
                  </span>
                  <span className="block text-[11px] text-muted">{g ? g.fixtures || "blank" : ""}</span>
                </td>
              );
            })}
            {laterGameweeks.length > 0 && (
              <td className="px-2 py-2 text-right font-mono font-medium tabular-nums">
                {p.expected_points_horizon_adjusted?.toFixed(1) ?? "–"}
              </td>
            )}
            <td className="px-2 py-2">
              <AvailabilityBadge player={p} />
            </td>
          </tr>
        );
      })}
    </tbody>
  );
}
