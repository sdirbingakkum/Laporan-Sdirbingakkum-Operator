import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ACTIVE_POMDAMS } from "./data/pomdams";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import {
  isPuspomadOperatorContext,
  operatorLoginEmails,
  resolveAuthorizedOperator,
  resolveRestoredOperator,
  SELECTED_POMDAM_STORAGE_KEY,
  type AccessContext,
  type ActiveOperator,
} from "./lib/operator-auth";

function readRememberedPomdamId(): string | null {
  try {
    const stored = window.localStorage.getItem(SELECTED_POMDAM_STORAGE_KEY);
    return ACTIVE_POMDAMS.some((pomdam) => pomdam.id === stored) ? stored : null;
  } catch {
    return null;
  }
}

function rememberPomdamId(pomdamId: string): void {
  try {
    window.localStorage.setItem(SELECTED_POMDAM_STORAGE_KEY, pomdamId);
  } catch {
    // Storage is only a convenience for restoring the selected unit, never an auth boundary.
  }
}

function clearRememberedPomdamId(): void {
  try {
    window.localStorage.removeItem(SELECTED_POMDAM_STORAGE_KEY);
  } catch {
    // The Supabase session remains the source of authentication state.
  }
}

function LoginPage({ onSuccess }: { onSuccess: (operator: ActiveOperator) => void }) {
  const [selectedPomdamId, setSelectedPomdamId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedPomdam = useMemo(
    () => ACTIVE_POMDAMS.find((pomdam) => pomdam.id === selectedPomdamId),
    [selectedPomdamId],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (!selectedPomdam || !password.trim()) return;
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Layanan login belum tersedia.");
      return;
    }

    setLoading(true);
    try {
      let authenticatedEmail: string | null = null;

      for (const email of operatorLoginEmails(selectedPomdam.code)) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (!signInError) {
          authenticatedEmail = email;
          break;
        }

        // Supabase intentionally returns a generic 400 for invalid credentials.
        // Try the other supported operator identity without exposing account existence.
        if (signInError.status && signInError.status !== 400) {
          setErrorMessage("Layanan login sedang bermasalah. Silakan coba lagi.");
          return;
        }
      }

      if (!authenticatedEmail) {
        setErrorMessage("Pomdam atau password tidak sesuai.");
        return;
      }

      const { data, error: accessError } = await supabase.rpc("get_my_access_context");
      if (accessError || !data) {
        await supabase.auth.signOut();
        setErrorMessage("Akses akun tidak dapat diverifikasi.");
        return;
      }

      const operator = resolveAuthorizedOperator(
        data as AccessContext,
        authenticatedEmail,
        selectedPomdam.id,
      );

      if (!operator) {
        await supabase.auth.signOut();
        setErrorMessage("Akun tidak memiliki akses ke Pomdam yang dipilih.");
        return;
      }

      rememberPomdamId(operator.pomdam.id);
      onSuccess(operator);
    } catch {
      await supabase.auth.signOut();
      setErrorMessage("Tidak dapat terhubung. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <img className="brand-logo" src="/logo-pomad-prima.webp" alt="POMAD PRIMA" />
        <h1 id="login-title">Login</h1>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label htmlFor="pomdam">Pomdam</label>
            <select
              id="pomdam"
              value={selectedPomdamId}
              onChange={(event) => {
                setSelectedPomdamId(event.target.value);
                setErrorMessage("");
              }}
              required
              disabled={loading}
            >
              <option value="" disabled>Pilih Pomdam</option>
              {ACTIVE_POMDAMS.map((pomdam) => (
                <option key={pomdam.id} value={pomdam.id}>
                  {pomdam.code} — {pomdam.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setErrorMessage("");
              }}
              placeholder="Masukkan password"
              autoComplete="current-password"
              required
              disabled={loading}
            />
          </div>

          {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}

          <button className="submit-button" type="submit" disabled={loading || !selectedPomdamId || !password}>
            {loading ? "Memproses..." : "Masuk"}
          </button>
        </form>
      </section>
    </main>
  );
}

function SignedInPage({
  operator,
  onLogout,
}: {
  operator: ActiveOperator;
  onLogout: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleLogout() {
    setLoading(true);
    setErrorMessage("");
    try {
      await onLogout();
    } catch {
      setErrorMessage("Tidak dapat keluar. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card signed-in-card">
        <img className="brand-logo" src="/logo-pomad-prima.webp" alt="POMAD PRIMA" />
        <h1>{operator.pomdam.displayName}</h1>
        {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
        <button className="submit-button" type="button" onClick={handleLogout} disabled={loading}>
          {loading ? "Memproses..." : "Keluar"}
        </button>
      </section>
    </main>
  );
}

export default function App() {
  const [activeOperator, setActiveOperator] = useState<ActiveOperator | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setSessionReady(true);
      return;
    }

    const authClient = client as NonNullable<typeof client>;
    let disposed = false;
    const { data: authListener } = authClient.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearRememberedPomdamId();
        setActiveOperator(null);
        setSessionReady(true);
      }
    });

    async function restoreSession() {
      try {
        const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
        if (sessionError) throw sessionError;

        const session = sessionData.session;
        if (!session?.user?.email) {
          if (!disposed) setActiveOperator(null);
          return;
        }

        const { data, error } = await authClient.rpc("get_my_access_context");
        if (disposed) return;

        if (error || !data) {
          await authClient.auth.signOut();
          if (!disposed) setActiveOperator(null);
          return;
        }

        const access = data as AccessContext;
        const operator = resolveRestoredOperator(
          access,
          session.user.email,
          readRememberedPomdamId(),
        );

        if (operator) {
          setActiveOperator(operator);
          rememberPomdamId(operator.pomdam.id);
          return;
        }

        // A Puspomad-wide operator may have a valid session but no selected
        // target Pomdam saved on this browser yet. Keep the session and ask for a selection.
        if (isPuspomadOperatorContext(access, session.user.email)) {
          clearRememberedPomdamId();
          setActiveOperator(null);
          return;
        }

        await authClient.auth.signOut();
        if (!disposed) setActiveOperator(null);
      } catch {
        if (!disposed) setActiveOperator(null);
      } finally {
        if (!disposed) setSessionReady(true);
      }
    }

    void restoreSession();

    return () => {
      disposed = true;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    try {
      if (activeOperator && supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }
    } finally {
      clearRememberedPomdamId();
      setActiveOperator(null);
    }
  }

  if (!sessionReady) {
    return (
      <main className="session-checking">
        <img className="brand-logo" src="/logo-pomad-prima.webp" alt="POMAD PRIMA" />
      </main>
    );
  }

  return activeOperator
    ? <SignedInPage operator={activeOperator} onLogout={logout} />
    : <LoginPage onSuccess={setActiveOperator} />;
}
