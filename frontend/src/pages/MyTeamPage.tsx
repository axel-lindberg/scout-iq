import { ChatPanel } from "../features/chat/ChatPanel";
import { MyTeamPanel } from "../features/team/MyTeamPanel";

const TEAM_QUESTIONS = ["Who should I sell this week?", "Who should I captain from my team?", "Is a -4 hit worth it?"];

/** Load or pick a squad and get feedback on it; the chat knows the team. */
export function MyTeamPage() {
  return (
    <div className="grid items-start gap-4 min-[950px]:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] sm:gap-5">
      <MyTeamPanel />
      <ChatPanel suggestions={TEAM_QUESTIONS} />
    </div>
  );
}
