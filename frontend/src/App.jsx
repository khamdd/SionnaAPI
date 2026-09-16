import PlannerApp from "./PlannerApp";
import SessionGate from "./components/SessionGate";

export default function App() {
  return (
    <SessionGate>
      {({ currentUser, isNewSession, logout }) => (
        <PlannerApp
          currentUser={currentUser}
          isNewSession={isNewSession}
          onLogout={logout}
        />
      )}
    </SessionGate>
  );
}
