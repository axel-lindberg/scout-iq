import { ChatPanel } from "../features/chat/ChatPanel";
import { ModelCardStrip } from "../features/status/ModelCardStrip";
import { PredictionsPanel } from "../features/predictions/PredictionsPanel";

/** The main page: model evaluation strip, then predictions (left) and chat (right; below on narrow screens). */
export function ScoutPage() {
  return (
    <div className="grid items-start gap-4 min-[950px]:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] sm:gap-5">
      <ModelCardStrip className="min-[950px]:col-span-2" />
      <PredictionsPanel />
      <ChatPanel />
    </div>
  );
}
