import type { ReactNode } from "react";
import type { ModelCard } from "../../api/endpoints";
import { useStatus } from "../../api/queries";
import { Card } from "../../components/Card";

const MODEL = "LightGBM";
const BASELINE = "season average to date";

function Stat({ label, value, note }: { label: string; value: ReactNode; note: ReactNode }) {
  return (
    <div>
      <dt className="text-xs tracking-[0.05em] text-muted uppercase">{label}</dt>
      <dd className="heading text-[28px] tabular-nums">{value}</dd>
      <dd className="text-xs text-muted">{note}</dd>
    </div>
  );
}

function Content({ card }: { card: ModelCard }) {
  const mae = card.mae?.[MODEL];
  if (mae === undefined) {
    return (
      <p className="text-sm text-muted">
        No evaluation results yet. Run <code className="font-mono text-[13px]">scripts/train_evaluate.py</code> to show
        them here.
      </p>
    );
  }
  const base = card.mae?.[BASELINE];
  const cap = card.captain_points_per_gw?.[MODEL];
  const capBase = card.captain_points_per_gw?.[BASELINE];
  return (
    <>
      <dl className="contents">
        <Stat
          label="Model error (MAE)"
          value={mae.toFixed(2)}
          note={base !== undefined ? `vs ${base.toFixed(2)} season-average baseline` : "mean absolute error"}
        />
        {base !== undefined && base > 0 && (
          <Stat label="Improvement" value={`${(((base - mae) / base) * 100).toFixed(1)}%`} note="lower error" />
        )}
        {cap !== undefined && (
          <Stat
            label="Captain pick"
            value={`${cap.toFixed(1)} pts`}
            note={capBase !== undefined ? `per GW vs ${capBase.toFixed(1)}` : "per GW"}
          />
        )}
      </dl>
      {card.evaluation && card.test_season && (
        <p className="max-w-[52ch] text-[13px] text-muted">
          Tested {card.evaluation} on the <span className="whitespace-nowrap">{card.test_season}</span> season, players who had recently played.
        </p>
      )}
    </>
  );
}

export function ModelCardStrip({ className = "" }: { className?: string }) {
  const { data, error, isPending } = useStatus();
  return (
    <Card aria-label="Model evaluation" className={`flex flex-wrap items-center gap-x-8 gap-y-3 ${className}`}>
      {isPending && <p className="text-sm text-muted">Loading model evaluation…</p>}
      {error && <p className="text-sm text-muted">Model evaluation unavailable.</p>}
      {data && <Content card={data.model_card} />}
    </Card>
  );
}
