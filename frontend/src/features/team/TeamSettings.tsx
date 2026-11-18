import { useEffect, useId, useState } from "react";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { saveTeam, type SavedTeam } from "../../lib/teamStore";

/** Editable bank and free transfers; saved (and re-analysed) once you stop typing. */
export function TeamSettings({ team }: { team: SavedTeam }) {
  const id = useId();
  const [bank, setBank] = useState(team.bank.toFixed(1));
  const [ft, setFt] = useState(String(team.freeTransfers));
  const debBank = useDebouncedValue(bank, 400);
  const debFt = useDebouncedValue(ft, 400);
  const bankNum = Number(debBank);
  const ftNum = Number(debFt);
  const bankOk = debBank.trim() !== "" && Number.isFinite(bankNum) && bankNum >= 0 && bankNum <= 100;
  const ftOk = Number.isInteger(ftNum) && ftNum >= 0 && ftNum <= 5 && debFt.trim() !== "";

  useEffect(() => {
    if (!bankOk || !ftOk) return;
    const b = Math.round(bankNum * 10) / 10;
    if (b !== team.bank || ftNum !== team.freeTransfers) saveTeam({ ...team, bank: b, freeTransfers: ftNum });
  }, [bankOk, ftOk, bankNum, ftNum, team]);

  const estimate = team.entry?.free_transfers;
  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Budget and transfers">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-bank`} className="text-xs font-medium text-muted">
          Bank £m
        </label>
        <input
          id={`${id}-bank`}
          className="field w-24 tabular-nums"
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step={0.1}
          value={bank}
          aria-invalid={!bankOk}
          onChange={(e) => {
            setBank(e.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-ft`} className="text-xs font-medium text-muted">
          Free transfers
        </label>
        <input
          id={`${id}-ft`}
          className="field w-20 tabular-nums"
          type="number"
          inputMode="numeric"
          min={0}
          max={5}
          step={1}
          value={ft}
          aria-invalid={!ftOk}
          aria-describedby={estimate !== undefined ? `${id}-ft-note` : undefined}
          onChange={(e) => {
            setFt(e.target.value);
          }}
        />
      </div>
      {estimate !== undefined && (
        <p id={`${id}-ft-note`} className="pb-2 text-xs text-muted">
          Estimated {estimate} from your history. Each extra transfer costs 4 points.
        </p>
      )}
      {(!bankOk || !ftOk) && (
        <p role="alert" className="pb-2 text-xs text-bad">
          {!bankOk ? "Bank must be between 0 and 100." : "Free transfers must be a whole number from 0 to 5."}
        </p>
      )}
    </div>
  );
}
