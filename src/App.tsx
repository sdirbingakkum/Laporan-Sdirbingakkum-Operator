import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ACTIVE_POMDAMS, type Pomdam } from "./data/pomdams";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type AccessContext = {
  authenticated?: boolean;
  configured?: boolean;
  role?: { code?: string; display_name?: string } | null;
  scope?: { type?: string; pomdam_ids?: string[] };
  capabilities?: string[];
};

type ActiveOperator = {
  pomdam: Pomdam;
  email: string;
  mode: "authenticated" | "demo";
};

function operatorEmail(code: string) {
  const slug = code.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `operator_${slug}@puspomad.mil.id`;
}

function resolveAuthorizedOperator(
  access: AccessContext,
  email: string | null | undefined,
  expectedPomdamId?: string,
): ActiveOperator | null {
  const normalizedEmail = email?.trim().toLowerCase();
  if (
    !normalizedEmail ||
    !access.authenticated ||
    !access.configured ||
    access.role?.code !== "POMDAM_OPERATOR" ||
    access.scope?.type !== "POMDAM" ||
    !access.capabilities?.includes("MANAGE_REPORT_DATA")
  ) {
    return null;
  }

  const allowedPomdamIds = new Set(access.scope.pomdam_ids ?? []);
  const pomdam = ACTIVE_POMDAMS.find(
    (item) =>
      allowedPomdamIds.has(item.id) &&
      (!expectedPomdamId || item.id === expectedPomdamId) &&
      operatorEmail(item.code).toLowerCase() === normalizedEmail,
  );

  return pomdam ? { pomdam, email: normalizedEmail, mode: "authenticated" } : null;
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
    const email = operatorEmail(selectedPomdam.code);

    // Preview demonstration is isolated from Supabase and never requests report data.
    if (import.meta.env.VITE_DEMO_LOGIN_MODE === "true") {
      if (password !== "123456") {
        setErrorMessage("Password tidak sesuai.");
        return;
      }
      onSuccess({ pomdam: selectedPomdam, email, mode: "demo" });
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Layanan login belum tersedia.");
      return;
    }

    setLoading(true);
    let authenticated = false;
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setErrorMessage("Pomdam atau password tidak sesuai.");
        return;
      }
      authenticated = true;

      const { data, error: accessError } = await supabase.rpc("get_my_access_context");
      if (accessError || !data) {
        await supabase.auth.signOut();
        setErrorMessage("Akses akun tidak dapat diverifikasi.");
        return;
      }

      const operator = resolveAuthorizedOperator(data as AccessContext, email, selectedPomdam.id);
      if (!operator) {
        await supabase.auth.signOut();
        setErrorMessage("Akun tidak memiliki akses ke Pomdam yang dipilih.");
        return;
      }

      onSuccess(operator);
    } catch {
      if (authenticated) await supabase.auth.signOut();
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

  async function handleLogout() {
    setLoading(true);
    await onLogout();
    setLoading(false);
  }

  return (
    <main className="login-page">
      <section className="login-card signed-in-card">
        <img className="brand-logo" src="/logo-pomad-prima.webp" alt="POMAD PRIMA" />
        <h1>{operator.pomdam.displayName}</h1>
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
    if (import.meta.env.VITE_DEMO_LOGIN_MODE === "true") {
      setSessionReady(true);
      return;
    }

    if (!supabase) {
      setSessionReady(true);
      return;
    }

    let disposed = false;
    const client = supabase;

    async function restoreSession() {
      try {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;

        const session = sessionData.session;
        if (!session?.user?.email) {
          if (!disposed) setActiveOperator(null);
          return;
        }

        const { data, error } = await client.rpc("get_my_access_context");
        if (disposed) return;

        const operator = !error && data
          ? resolveAuthorizedOperator(data as AccessContext, session.user.email)
          : null;

        if (operator) {
          setActiveOperator(operator);
        } else {
          await client.auth.signOut();
          if (!disposed) setActiveOperator(null);
        }
      } catch {
        if (!disposed) setActiveOperator(null);
      } finally {
        if (!disposed) setSessionReady(true);
      }
    }

    void restoreSession();
    const { data: authListener } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setActiveOperator(null);
        setSessionReady(true);
      }
    });

    return () => {
      disposed = true;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    if (activeOperator?.mode === "authenticated" && supabase) {
      await supabase.auth.signOut();
    }
    setActiveOperator(null);
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
