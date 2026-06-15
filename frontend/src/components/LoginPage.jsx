import { useState } from "react";
import { loginUser, registerUser } from "../api";


export default function LoginPage({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isRegistering = mode === "register";

  async function submit(event) {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setStatus(isRegistering ? "Creating account..." : "Signing in...");

    try {
      const request = isRegistering ? registerUser : loginUser;
      const result = await request({
        username,
        password,
      });

      onAuthenticated(result.user);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  function switchMode(nextMode) {
    if (isLoading) {
      return;
    }

    setMode(nextMode);
    setStatus("");
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div>
          <strong>Sionna Planner</strong>
          <h1>{isRegistering ? "Create account" : "Sign in"}</h1>
          <p>Use a project account to access simulations, scenes, and history.</p>
        </div>

        <div className="login-tabs" role="tablist" aria-label="Authentication mode">
          <button
            className={mode === "login" ? "active" : ""}
            type="button"
            disabled={isLoading}
            onClick={() => switchMode("login")}
          >
            Login
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            type="button"
            disabled={isLoading}
            onClick={() => switchMode("register")}
          >
            Register
          </button>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label>
            <span>Username</span>
            <input
              type="text"
              value={username}
              minLength={3}
              maxLength={80}
              autoComplete="username"
              required
              disabled={isLoading}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              minLength={8}
              maxLength={256}
              autoComplete={isRegistering ? "new-password" : "current-password"}
              required
              disabled={isLoading}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {status && (
            <p className={status.includes("...") ? "history-status" : "history-status error-text"}>
              {status}
            </p>
          )}
          <button className="primary-button" type="submit" disabled={isLoading}>
            {isLoading
              ? isRegistering ? "Creating..." : "Signing in..."
              : isRegistering ? "Create account" : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}
