import { ChatPanel } from "../features/chat/ChatPanel";
import { MyTeamPanel } from "../features/team/MyTeamPanel";

const TEAM_QUESTIONS = ["Who should I sell this week?", "Who should I captain from my team?", "Is a -4 hit worth it?"];

/** Load or pick a squad and get feedback on it; the chat knows the team. */
export function MyTeamPage() {
  return (
    // The team is the main view: full width until there's room for the chat beside it.
    <div className="grid items-start gap-4 sm:gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <MyTeamPanel />
      <ChatPanel suggestions={TEAM_QUESTIONS} />
    </div>
  );
}
