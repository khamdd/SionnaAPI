import { useState } from "react";

import useAuthSession from "../hooks/useAuthSession";
import LoginPage from "./LoginPage";

export default function SessionGate({ children }) {
  const auth = useAuthSession();
  const [isNewSession, setIsNewSession] = useState(false);

  function authenticate(authResult) {
    setIsNewSession(true);
    auth.authenticate(authResult);
  }

  if (auth.status === "checking") {
    return (
      <main className="session-check" role="status">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <strong>Opening Sionna Planner</strong>
        <p>Checking your workspace session...</p>
      </main>
    );
  }

  if (!auth.currentUser || auth.status === "unauthenticated") {
    return <LoginPage onAuthenticated={authenticate} />;
  }

  return children({
    currentUser: auth.currentUser,
    isNewSession,
    logout: auth.logout,
  });
}
