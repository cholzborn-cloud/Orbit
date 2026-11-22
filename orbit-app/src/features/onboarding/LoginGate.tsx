import { StartKarte } from "./schritte";

/** Nur Anmeldung: wenn die App ein Konto verlangt und keins aktiv ist. */
export function LoginGate({ onDone }: { onDone: () => void }) {
  return (
    <div className="orbit-ui o-auth-viewport h-screen bg-o-bg text-o-text" data-login-gate>
      <StartKarte onAngemeldet={onDone} />
    </div>
  );
}
