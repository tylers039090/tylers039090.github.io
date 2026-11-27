"use client";

import { useActionState } from "react";
import { sendCode, verifyCode, type LoginState } from "./actions";

const initial: LoginState = { step: "email", email: "" };

export default function LoginPage() {
  const [sendState, send, sending] = useActionState(sendCode, initial);
  const [verifyState, verify, verifying] = useActionState(verifyCode, initial);

  const onCode = sendState.step === "code";
  const error = onCode ? verifyState.error ?? sendState.error : sendState.error;

  return (
    <main className="login">
      <div className="login-card ticket">
        <h1 className="display">Bet Tracker</h1>
        {!onCode ? (
          <form action={send} className="stack">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              defaultValue={sendState.email}
            />
            <button className="btn btn-accent" disabled={sending}>
              {sending ? "Sending…" : "Send sign-in link"}
            </button>
          </form>
        ) : (
          <form action={verify} className="stack">
            <p className="mute">{sendState.message}</p>
            <p className="mute small">
              On the Home Screen app, type the code here — links open in Safari instead of the app.
            </p>
            <input type="hidden" name="email" value={sendState.email} />
            <label htmlFor="code">Code</label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              required
              className="mono"
            />
            <button className="btn btn-accent" disabled={verifying}>
              {verifying ? "Checking…" : "Sign in"}
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
