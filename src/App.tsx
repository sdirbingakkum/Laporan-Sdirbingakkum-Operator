import { useEffect, useMemo, useState, type FormEvent } from "react";
import { REPORT_MODULES, type ReportModule } from "./data/report-modules";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import {
  operatorEmail,
  pomdamFromOperatorUsername,
  resolveAuthorizedOperator,
  resolveRestoredOperator,
  type AccessContext,
  type ActiveOperator,
} from "./lib/operator-auth";

function LoginPage({ onSuccess }: { onSuccess: (operator: ActiveOperator) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedPomdam = useMemo(
    () => pomdamFromOperatorUsername(username),
    [username],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (!selectedPomdam) {
      setErrorMessage("Username operator tidak ditemukan. Gunakan format operator_<kode Pomdam>.");
      return;
    }

    if (!password.trim()) return;
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Layanan login belum tersedia.");
      return;
    }

    setLoading(true);
    const email = operatorEmail(selectedPomdam.code);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setErrorMessage(
          signInError.status === 400
            ? "Username atau password tidak sesuai."
            : "Layanan login sedang bermasalah. Silakan coba lagi.",
        );
        return;
      }

      const { data, error: accessError } = await supabase.rpc("get_my_access_context");
      if (accessError || !data) {
        await supabase.auth.signOut();
        setErrorMessage("Akses operator tidak dapat diverifikasi.");
        return;
      }

      const operator = resolveAuthorizedOperator(
        data as AccessContext,
        email,
        selectedPomdam.id,
      );

      if (!operator) {
        await supabase.auth.signOut();
        setErrorMessage("Akun ini bukan operator untuk Pomdam yang dipilih.");
        return;
      }

      setPassword("");
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
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setErrorMessage("");
              }}
              placeholder="operator_im"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={loading}
            />
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

          <button className="submit-button" type="submit" disabled={loading || !username.trim() || !password}>
            {loading ? "Memproses..." : "Masuk"}
          </button>
        </form>
      </section>
    </main>
  );
}

function DashboardPage({
  operator,
  onLogout,
}: {
  operator: ActiveOperator;
  onLogout: () => Promise<void>;
}) {
  const [activeModuleCode, setActiveModuleCode] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const activeModule = useMemo(
    () => REPORT_MODULES.find((module) => module.code === activeModuleCode) ?? null,
    [activeModuleCode],
  );

  function openModule(code: string) {
    setActiveModuleCode(code);
    setMobileMenuOpen(false);
  }

  function goHome() {
    setActiveModuleCode(null);
    setMobileMenuOpen(false);
  }

  async function handleLogout() {
    setLoggingOut(true);
    setErrorMessage("");
    try {
      await onLogout();
    } catch {
      setErrorMessage("Tidak dapat keluar. Silakan coba lagi.");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="app-shell">
      {mobileMenuOpen && (
        <button
          className="drawer-backdrop"
          aria-label="Tutup menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <img src="/logo-pomad-prima.webp" alt="" />
          <div>
            <strong>POMAD PRIMA</strong>
            <span>SISTEM LAPORAN</span>
          </div>
        </div>

        <div className="sidebar-section-label">MENU UTAMA</div>
        <button
          className={`sidebar-link ${activeModule ? "" : "sidebar-link-active"}`}
          onClick={goHome}
        >
          <span className="sidebar-link-index">00</span>
          <span>Dashboard</span>
        </button>

        <div className="sidebar-section-label reports-label">MENU LAPORAN</div>
        <nav className="sidebar-nav" aria-label="Menu laporan">
          {REPORT_MODULES.map((module, index) => (
            <button
              key={module.code}
              className={`sidebar-link ${activeModuleCode === module.code ? "sidebar-link-active" : ""}`}
              onClick={() => openModule(module.code)}
            >
              <span className="sidebar-link-index">{String(index + 1).padStart(2, "0")}</span>
              <span>{module.title}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <span className="sidebar-bottom-label">UNIT OPERATOR</span>
          <strong>{operator.pomdam.displayName}</strong>
          <span className="sidebar-username">{operator.username}</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu-button"
            type="button"
            aria-label="Buka menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(true)}
          >
            <span />
            <span />
            <span />
          </button>

          <div className="topbar-heading">
            <span className="topbar-eyebrow">SISTEM LAPORAN DIRBINGAKKUM</span>
            <strong>{activeModule ? activeModule.title : "Dashboard"}</strong>
          </div>

          <div className="topbar-account">
            <div className="account-avatar">OP</div>
            <div className="account-copy">
              <strong>{operator.pomdam.displayName}</strong>
              <span>OPERATOR</span>
            </div>
            <button className="logout-button" type="button" onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? "Keluar..." : "Keluar"}
            </button>
          </div>
        </header>

        <main className="dashboard-content">
          {errorMessage && <p className="form-error dashboard-error" role="alert">{errorMessage}</p>}

          {activeModule ? (
            <ModulePlaceholder module={activeModule} onBack={goHome} />
          ) : (
            <DashboardHome operator={operator} onOpenModule={openModule} />
          )}
        </main>
      </div>
    </div>
  );
}

function DashboardHome({
  operator,
  onOpenModule,
}: {
  operator: ActiveOperator;
  onOpenModule: (code: string) => void;
}) {
  return (
    <>
      <section className="welcome-section">
        <div>
          <p className="eyebrow">RUANG KERJA OPERATOR</p>
          <h1>Selamat datang</h1>
          <p className="welcome-description">
            Pilih menu laporan untuk melanjutkan pekerjaan unit.
          </p>
        </div>
        <div className="welcome-unit">
          <span>UNIT ANDA</span>
          <strong>{operator.pomdam.displayName}</strong>
          <small>{operator.username}</small>
        </div>
      </section>

      <section className="module-section" aria-labelledby="module-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MODUL SISTEM</p>
            <h2 id="module-heading">Menu Laporan</h2>
          </div>
          <span className="module-count">{String(REPORT_MODULES.length).padStart(2, "0")} MODUL</span>
        </div>

        <div className="module-grid">
          {REPORT_MODULES.map((module, index) => (
            <button
              className="module-card"
              key={module.code}
              type="button"
              onClick={() => onOpenModule(module.code)}
            >
              <div className="module-card-top">
                <span className="module-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="module-arrow" aria-hidden="true">↗</span>
              </div>
              <div className="module-card-copy">
                <h3>{module.title}</h3>
                <p>{module.description}</p>
              </div>
              <div className="module-card-footer">
                <span>BUKA MENU</span>
                <span className="module-status">BELUM AKTIF</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <footer className="dashboard-footer">
        <span>POMAD PRIMA</span>
        <span>PORTAL OPERATOR · {operator.pomdam.code}</span>
      </footer>
    </>
  );
}

function ModulePlaceholder({
  module,
  onBack,
}: {
  module: ReportModule;
  onBack: () => void;
}) {
  const index = REPORT_MODULES.findIndex((item) => item.code === module.code) + 1;

  return (
    <section className="module-placeholder">
      <button className="back-link" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Kembali ke dashboard
      </button>
      <div className="placeholder-panel">
        <span className="placeholder-index">MODUL {String(index).padStart(2, "0")}</span>
        <span className="placeholder-status">DALAM PERSIAPAN</span>
        <h1>{module.title}</h1>
        <p>{module.description}</p>
        <div className="placeholder-divider" />
        <p className="placeholder-note">
          Menu sudah disiapkan. Form input, pengolahan data, dan tampilan laporan akan dibangun pada tahap berikutnya.
        </p>
        <button className="placeholder-button" type="button" onClick={onBack}>
          Kembali ke menu laporan
        </button>
      </div>
    </section>
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

        const operator = resolveRestoredOperator(data as AccessContext, session.user.email);
        if (operator) {
          setActiveOperator(operator);
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
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
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
    ? <DashboardPage operator={activeOperator} onLogout={logout} />
    : <LoginPage onSuccess={setActiveOperator} />;
}
