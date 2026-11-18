import { useState } from "react";
import { SHIRT_ASPECT, shirtUrl } from "../lib/shirts";

interface Props {
  /** FPL team code (not the team id); null/undefined shows the plain shirt. */
  teamCode: number | null | undefined;
  isGoalkeeper?: boolean;
  /** Displayed width in px (picks the image resolution too). Override the width with `className`. */
  size?: number;
  className?: string;
}

/** A plain grey shirt: shown when there's no code or the image fails, so a broken image never shows. */
function PlainShirt({ size, className }: { size: number; className: string }) {
  return (
    <svg
      viewBox="0 0 110 145"
      width={size}
      height={Math.round(size * SHIRT_ASPECT)}
      className={className}
      aria-hidden="true"
      data-testid="shirt-fallback"
    >
      <path
        d="M38 8 L20 14 L2 40 L18 56 L26 48 L26 138 L84 138 L84 48 L92 56 L108 40 L90 14 L72 8 C68 18 42 18 38 8 Z"
        fill="#c4cac2"
        stroke="#8d958b"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A team's FPL shirt (decorative: the player's name is always shown next to it). */
export function Shirt({ teamCode, isGoalkeeper = false, size = 40, className = "" }: Props) {
  const src = teamCode == null ? null : shirtUrl(teamCode, isGoalkeeper, size);
  const [failed, setFailed] = useState<string | null>(null); // the src that failed, so a new one retries
  if (src === null || failed === src) return <PlainShirt size={size} className={className} />;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={Math.round(size * SHIRT_ASPECT)}
      decoding="async"
      draggable={false}
      className={`object-contain select-none ${className}`}
      onError={() => {
        setFailed(src);
      }}
    />
  );
}
