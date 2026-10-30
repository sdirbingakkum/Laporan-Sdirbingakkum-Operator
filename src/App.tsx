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
};

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand-mark brand-mark--compact" : "brand-mark"}>
      <img src="/logo-pomad-prima.webp" alt="Lambang POMAD PRIMA" />
      <span className="brand-mark__ring" />
    </div>
  );
}

function Icon({ name }: { name: "chevron" | "eye" | "eyeOff" | "lock" | "shield" | "check" | "logout" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  switch (name) {
    case "chevron":
      return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
    case "eye":
      return <svg {...common}><path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.6" /></svg>;
    case "eyeOff":
      return <svg {...common}><path d="m3 3 18 18M10.6 6.2A10.6 10.6 0 0 1 12 6c6.2 0 9.5 6 9.5 6a15.4 15.4 0 0 1-3.1 3.8M6.2 6.9C3.8 8.6 2.5 12 2.5 12s3.3 6 9.5 6c1.3 0 2.5-.3 3.5-.7" /></svg>;
    case "lock":
      return <svg {...common}><rect x="4.5" y="10" width="15" height="11" rx="2.2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg>;
    case "shield":
      return <svg {...common}><path d="M12 3 20 6v5.5c0 5-3.4 8-8 9.5-4.6-1.5-8-4.5-8-9.5V6l8-3Z" /><path d="m8.8 12 2.1 2.1 4.5-4.6" /></svg>;
    case "check":
      return <svg {...common}><path d="m5 12.5 4.2 4.2L19.5 6.8" /></svg>;
    case "logout":
      return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></svg>;
  }
}

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

  return pomdam ? { pomdam, email: normalizedEmail } : null;
}

function LoginPage({ onSuccess }: { onSuccess: (operator: ActiveOperator) => void }) {
  const [selectedPomdamId, setSelectedPomdamId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedPomdam = useMemo(
    () => ACTIVE_POMDAMS.find((pomdam) => pomdam.id === selectedPomdamId),
    [selectedPomdamId],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (!selectedPomdam) {
      setErrorMessage("Pilih satuan Pomdam terlebih dahulu.");
      return;
    }
    if (!password.trim()) {
      setErrorMessage("Masukkan password untuk melanjutkan.");
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Konfigurasi koneksi belum tersedia. Hubungi administrator sistem.");
      return;
    }

    setLoading(true);
    const email = operatorEmail(selectedPomdam.code);

    let authenticated = false;
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setErrorMessage("Kredensial tidak cocok. Periksa Pomdam yang dipilih dan password Anda.");
        return;
      }
      authenticated = true;

      const { data, error: accessError } = await supabase.rpc("get_my_access_context");

      if (accessError || !data) {
        await supabase.auth.signOut();
        setErrorMessage("Akun berhasil dikenali, tetapi hak akses belum dapat diverifikasi. Hubungi administrator.");
        return;
      }

      const operator = resolveAuthorizedOperator(data as AccessContext, email, selectedPomdam.id);
      if (!operator) {
        await supabase.auth.signOut();
        setErrorMessage("Akun ini tidak terdaftar sebagai operator pada Pomdam yang dipilih.");
        return;
      }

      onSuccess(operator);
    } catch {
      if (authenticated) await supabase.auth.signOut();
      setErrorMessage("Terjadi kendala saat menghubungi layanan autentikasi. Coba kembali.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <div className="grain" />

      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Laporan Sdirbingakkum Operator">
          <span className="wordmark__symbol">S</span>
          <span className="wordmark__text">
            <strong>SDIRBINGAKKUM</strong>
            <small>OPERATOR PORTAL</small>
          </span>
        </a>
        <div className="topbar__right">
          <span className="secure-dot" />
          <span>AKSES TERBATAS</span>
        </div>
      </header>

      <section className="login-layout">
        <div className="brand-panel">
          <div className="brand-panel__eyebrow">
            <span className="eyebrow-line" />
            <span>SISTEM PELAPORAN TERPADU</span>
          </div>

          <div className="brand-emblem-wrap">
            <div className="brand-emblem-glow" />
            <BrandMark />
            <div className="brand-emblem-caption">
              <span className="brand-emblem-caption__line" />
              <span>PROFESIONAL · RESPONSIF · INTEGRITAS</span>
              <span className="brand-emblem-caption__line" />
            </div>
          </div>

          <div className="brand-copy">
            <p className="brand-copy__kicker">PUSAT POLISI MILITER ANGKATAN DARAT</p>
            <h1>Data yang akurat.<br /><em>Keputusan yang tepat.</em></h1>
            <p className="brand-copy__description">
              Satu gerbang kerja bagi operator Pomdam untuk menyusun, memeriksa, dan mengirim laporan secara tertib dan terukur.
            </p>
          </div>

          <div className="brand-panel__footer">
            <div className="footer-rule" />
            <div className="brand-panel__meta">
              <span>TERINTEGRASI</span>
              <span className="meta-separator" />
              <span>TERVERIFIKASI</span>
              <span className="meta-separator" />
              <span>TERKENDALI</span>
            </div>
          </div>
        </div>

        <div className="form-panel">
          <div className="form-card">
            <div className="form-card__topline" />
            <div className="form-card__eyebrow">
              <span className="form-card__eyebrow-icon"><Icon name="shield" /></span>
              <span>RUANG OPERATOR</span>
              <span className="form-card__eyebrow-rule" />
              <span className="form-card__eyebrow-status">SECURE LOGIN</span>
            </div>

            <div className="form-heading">
              <p className="form-heading__overline">SELAMAT DATANG</p>
              <h2>Masuk ke akun Anda.</h2>
              <p>Pilih satuan kerja dan masukkan password untuk melanjutkan.</p>
            </div>

            <form className="login-form" onSubmit={handleSubmit} noValidate>
              <div className="field-group">
                <label htmlFor="pomdam">SATUAN POMDAM</label>
                <div className="select-wrap">
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
                    <option value="" disabled>Pilih Pomdam Anda</option>
                    {ACTIVE_POMDAMS.map((pomdam) => (
                      <option key={pomdam.id} value={pomdam.id}>
                        {pomdam.code} — {pomdam.name}
                      </option>
                    ))}
                  </select>
                  <span className="select-chevron"><Icon name="chevron" /></span>
                </div>
                <span className="field-hint">Pilih satuan yang terdaftar pada akun operator Anda.</span>
              </div>

              <div className="field-group">
                <div className="field-label-row">
                  <label htmlFor="password">PASSWORD</label>
                  <span className="field-label-note"><Icon name="lock" /> ENCRYPTED SESSION</span>
                </div>
                <div className="password-wrap">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
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
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                    disabled={loading}
                  >
                    <Icon name={showPassword ? "eyeOff" : "eye"} />
                  </button>
                </div>
              </div>

              {errorMessage && (
                <div className="form-error" role="alert">
                  <span className="form-error__mark">!</span>
                  <span>{errorMessage}</span>
                </div>
              )}

              <button className="submit-button" type="submit" disabled={loading || !selectedPomdamId || !password}>
                {loading ? (
                  <>
                    <span className="button-spinner" />
                    MEMVERIFIKASI AKSES
                  </>
                ) : (
                  <>
                    MASUK KE SISTEM
                    <span className="submit-button__arrow">↗</span>
                  </>
                )}
              </button>
            </form>

            <div className="form-card__divider"><span>KEAMANAN AKUN</span></div>

            <div className="security-note">
              <span className="security-note__icon"><Icon name="shield" /></span>
              <p>
                Akses operator terikat pada satu Pomdam. Sistem akan memeriksa hak akses akun setelah autentikasi berhasil.
              </p>
            </div>
            <div className="form-card__bottom">
              <span>Belum dapat masuk?</span>
              <span className="form-card__bottom-muted">Hubungi administrator sistem.</span>
            </div>
          </div>

          <div className="form-panel__caption">
            <span>© SDIRBINGAKKUM</span>
            <span className="caption-dot" />
            <span>PORTAL OPERATOR</span>
          </div>
        </div>
      </section>

      <footer className="mobile-footer">
        <span>SDIRBINGAKKUM</span>
        <span className="caption-dot" />
        <span>POMAD PRIMA</span>
      </footer>
    </main>
  );
}

function VerifiedPage({ operator, onLogout }: { operator: ActiveOperator; onLogout: () => Promise<void> }) {
  const [loggingOut, setLoggingOut] = useState(false);
  async function handleLogout() {
    setLoggingOut(true);
    await onLogout();
    setLoggingOut(false);
  }

  return (
    <main className="verified-shell">
      <div className="ambient ambient--one" />
      <div className="grain" />
      <header className="topbar">
        <div className="wordmark">
          <span className="wordmark__symbol">S</span>
          <span className="wordmark__text"><strong>SDIRBINGAKKUM</strong><small>OPERATOR PORTAL</small></span>
        </div>
        <button className="logout-button" onClick={handleLogout} disabled={loggingOut}>
          <Icon name="logout" /> {loggingOut ? "KELUAR..." : "KELUAR"}
        </button>
      </header>
      <section className="verified-card">
        <div className="verified-card__mark"><BrandMark compact /></div>
        <div className="verified-status"><span><Icon name="check" /></span> AKSES TERVERIFIKASI</div>
        <p className="verified-kicker">SELAMAT DATANG, OPERATOR</p>
        <h1>{operator.pomdam.displayName}</h1>
        <p className="verified-copy">Autentikasi dan pemeriksaan hak akses Pomdam berhasil. Ruang kerja operator siap dilanjutkan pada tahap berikutnya.</p>
        <div className="verified-details">
          <div><span>IDENTITAS LOGIN</span><strong>{operator.email}</strong></div>
          <div><span>ROLE</span><strong>OPERATOR POMDAM</strong></div>
          <div><span>STATUS</span><strong className="status-active">TERAUTENTIKASI</strong></div>
        </div>
        <div className="verified-footnote"><Icon name="shield" /> Hak akses tetap ditegakkan oleh Supabase Row Level Security.</div>
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

        const operator = !error && data
          ? resolveAuthorizedOperator(data as AccessContext, session.user.email)
          : null;

        if (operator) {
          setActiveOperator(operator);
        } else {
          await authClient.auth.signOut();
          if (!disposed) setActiveOperator(null);
        }
      } catch {
        if (!disposed) setActiveOperator(null);
      } finally {
        if (!disposed) setSessionReady(true);
      }
    }

    void restoreSession();

    const { data: authListener } = authClient.auth.onAuthStateChange((event) => {
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
    if (supabase) await supabase.auth.signOut();
    setActiveOperator(null);
  }

  if (!sessionReady) {
    return (
      <main className="session-checking" role="status" aria-live="polite">
        <span className="session-checking__mark">S</span>
        <span>MEMERIKSA SESI</span>
      </main>
    );
  }

  return activeOperator
    ? <VerifiedPage operator={activeOperator} onLogout={logout} />
    : <LoginPage onSuccess={setActiveOperator} />;
}