import type { Player } from "../api/endpoints";
import { availability } from "../lib/format";
import { Tooltip } from "./Tooltip";

const STYLE = {
  fit: "text-muted",
  doubtful: "rounded-full bg-warn-soft px-2 py-px font-medium text-warn",
  out: "rounded-full bg-bad-soft px-2 py-px font-medium text-bad",
} as const;

/** "Fit", or "75% · doubtful" in amber / "0% · injured" in red, with the FPL news as a tooltip. */
interface Props {
  player: Pick<Player, "chance_of_playing" | "status" | "news">;
  /** Off where the news is already printed next to the badge. */
  tooltip?: boolean;
}

export function AvailabilityBadge({ player, tooltip = true }: Props) {
  const kind = availability(player);
  const label = kind === "fit" ? "Fit" : `${player.chance_of_playing}% · ${player.status}`;
  const tip = tooltip ? (player.news ?? (kind === "fit" ? null : player.status)) : null;
  const cls = `inline-block whitespace-nowrap text-xs ${STYLE[kind]}`;
  if (!tip) return <span className={cls}>{label}</span>;
  return (
    <Tooltip content={tip} className={`${cls} underline decoration-dotted underline-offset-2`}>
      {label}
    </Tooltip>
  );
}
