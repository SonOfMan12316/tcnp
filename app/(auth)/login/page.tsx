"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { safeDestination } from "@/lib/safe-destination";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, ChevronDown } from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const QUOTES = [
  "Excellence is not an act, but a habit.",
  "Precision in every detail, power in every action.",
  "Protocol is the invisible architecture of power.",
  "Command the room, secure the objective.",
  "The standard is perfection. We accept nothing less.",
];

const OSCAR_OPTIONS = [
  { value: "Command", label: "Command", sub: "HQ & Leadership" },
  { value: "Alpha Oscar", label: "Alpha Oscar", sub: "Eagle Square" },
  { value: "Compliance Oscar", label: "Compliance Oscar", sub: "Grooming & Dress Code" },
  { value: "November (Den)", label: "November (Den)", sub: "Lounge & Menus" },
  { value: "November (Nest)", label: "November (Nest)", sub: "Hotels, rooms & guest experience" },
  { value: "Serial Oscar", label: "Serial Oscar", sub: "Social Media" },
  { value: "Tango Oscar", label: "Tango Oscar", sub: "Transport" },
  { value: "Victor Oscar", label: "Victor Oscar", sub: "Theatre" },
  { value: "Welfare Oscar", label: "Welfare Oscar", sub: "Meals & Welfare" },
];

const TEAM_OPTIONS = [
  { value: "strength", label: "Team Strength" },
  { value: "wisdom", label: "Team Wisdom" },
  { value: "swift", label: "Team Swift" },
];

const LOGIN_REQUEST_TIMEOUT_MS = 12_000

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-semibold text-gray-300 mb-1.5 uppercase tracking-[0.15em]"
    >
      {children}
    </label>
  );
}

const INPUT_CLS =
  "w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder-gray-400 text-base " +
  "focus:outline-none focus:ring-2 focus:ring-orange-500/60 focus:border-orange-500/40 focus:bg-white/8 " +
  "transition-all duration-200 shadow-inner";

function GlassInput({
  id,
  type = "text",
  value,
  onChange,
  required,
  placeholder,
  autoComplete,
  autoCapitalize,
  autoCorrect,
  spellCheck,
  inputMode,
  className = "",
  children,
}: {
  id: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  autoCapitalize?: string;
  autoCorrect?: string;
  spellCheck?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        inputMode={inputMode}
        className={`${INPUT_CLS} ${className}`}
      />
      {children}
    </div>
  );
}

function GlassSelect({
  id,
  value,
  onChange,
  required,
  children,
}: {
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={onChange}
        required={required}
        className={`${INPUT_CLS} appearance-none pr-10 cursor-pointer`}
        style={{ colorScheme: "dark" }}
      >
        {children}
      </select>
      <ChevronDown
        className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none"
        aria-hidden="true"
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");

  // Signup fields
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role] = useState("viewer");
  const [oscar, setOscar] = useState("");
  const [team, setTeam] = useState("");

  // Rotating quote — fixed stale-closure bug by using functional updater
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [quoteFading, setQuoteFading] = useState(false);

  const router = useRouter();

  // Fixed: Using useCallback + functional setState to avoid stale closure
  const advanceQuote = useCallback(() => {
    setQuoteFading(true);
    setTimeout(() => {
      setQuoteIndex((i) => (i + 1) % QUOTES.length);
      setQuoteFading(false);
    }, 600);
  }, []);

  useEffect(() => {
    const id = setInterval(advanceQuote, 8000);
    return () => clearInterval(id);
  }, [advanceQuote]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormNotice("");
    setLoading(true);
    let loginSuccess = false;
    let requestTimedOut = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, LOGIN_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(result.error || 'Failed to login')
      }

      loginSuccess = true;
      toast.success("Signed in securely.");
      await new Promise((resolve) => setTimeout(resolve, 200));

      if (typeof window !== "undefined") {
        window.location.href = safeDestination(new URLSearchParams(window.location.search).get("next"));
      } else {
        router.replace("/dashboard");
      }
    } catch (err: any) {
      if (!loginSuccess) {
        const message =
          requestTimedOut
            ? "Sign-in is taking longer than expected. Check your connection and try again."
            : err?.message === "Failed to fetch"
            ? "Unable to reach the TCNP application server. Please refresh and try again."
            : err?.message || "Failed to login";
        setFormError(message);
        toast.error(message);
      }
    } finally {
      window.clearTimeout(timeout);
      if (!loginSuccess) setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setFormError("Password must be at least 6 characters.");
      return;
    }
    setFormError("");
    setFormNotice("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          full_name: fullName.trim(),
          phone: phone.trim() || undefined,
          role,
          oscar: oscar.trim() || undefined,
          team: team || undefined,
        }),
      });

      let data: any = {};
      const ct = res.headers.get("content-type");
      if (ct?.includes("application/json")) {
        data = await res.json();
      } else {

        throw new Error("The server could not process your request. Your entries are still here; please try again.");
      }

      if (!res.ok) throw new Error(data.error || "Failed to sign up");
      setFormNotice("Access requested. An administrator must approve your account before you can sign in.");
      setMode("login");
      setPassword("");
    } catch (err: any) {
      setFormError(err.message === "Failed to fetch" ? "Unable to reach the server. Your entries are still here; please try again." : err.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  const switchToSignup = () => setMode("signup");
  const switchToLogin = () => setMode("login");

  return (
    <main className="min-h-dvh flex items-center justify-center bg-gray-950 relative overflow-x-hidden overflow-y-auto py-6 selection:bg-orange-500/30">

      {/* Background Image — composited once, no JS animation */}
      <div className="absolute inset-0 z-0" aria-hidden="true">
        <Image
          src="/tcnp_cinematic_bg.png"
          alt=""
          fill
          className="object-cover opacity-40 brightness-75 contrast-110"
          priority
          sizes="100vw"
        />
        {/* Gradient overlays — static, GPU-composited */}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-gray-950/70 via-transparent to-gray-950/70" />
      </div>

      {/* Ambient light blobs — will-change: transform for GPU isolation */}
      <div className="absolute inset-0 z-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute top-[-20%] left-[-10%] w-[50%] h-[60%] rounded-full opacity-30"
          style={{
            background: "radial-gradient(circle, rgba(37,99,235,0.35) 0%, transparent 70%)",
            willChange: "transform",
            animation: "floatBlob1 18s ease-in-out infinite alternate",
          }}
        />
        <div
          className="absolute bottom-[-15%] right-[-10%] w-[55%] h-[55%] rounded-full opacity-25"
          style={{
            background: "radial-gradient(circle, rgba(234,88,12,0.3) 0%, transparent 70%)",
            willChange: "transform",
            animation: "floatBlob2 22s ease-in-out infinite alternate",
          }}
        />
      </div>

      {/* ── Main card ─────────────────────────────────────────────────────── */}
      <div className="w-full max-w-[420px] relative z-10 px-5 sm:px-4">
        <div
          className="rounded-[2rem] border border-white/10 p-6 sm:p-10 overflow-hidden"
          style={{
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.05), 0 32px 80px rgba(0,0,0,0.7), 0 8px 24px rgba(0,0,0,0.5)",
            animation: "cardEnter 0.5s cubic-bezier(0.16,1,0.3,1) both",
          }}
        >
          {/* Card inner glow */}
          <div
            className="absolute -top-32 -left-32 w-80 h-80 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(234,88,12,0.08) 0%, transparent 65%)" }}
            aria-hidden="true"
          />

          {/* ── Header ──────────────────────────────────────────────── */}
          <div className="text-center mb-7 relative z-10">
            <div className="flex justify-center mb-4">
              <div className="relative h-16 w-16 ring-1 ring-white/10 rounded-2xl overflow-hidden drop-shadow-[0_0_20px_rgba(255,255,255,0.25)]">
                <Image
                  src="/tcnp_logo.png"
                  alt="TCNP logo"
                  fill
                  sizes="64px"
                  className="object-contain p-1"
                  priority
                />
              </div>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white leading-none">
              TCN Protocol
            </h1>
            <p className="text-[10px] font-semibold tracking-[0.22em] text-orange-300/60 uppercase mt-1.5">
              Central Application
            </p>
          </div>

          {/* ── Mode toggle tabs ─────────────────────────────────── */}
          <div
            className="relative flex bg-white/5 rounded-2xl p-1 mb-7"
            role="tablist"
            aria-label="Authentication mode"
          >
            <div
              className="absolute inset-y-1 rounded-xl bg-white/10 border border-white/10 transition-all duration-300"
              style={{
                left: mode === "login" ? "4px" : "50%",
                right: mode === "login" ? "50%" : "4px",
              }}
              aria-hidden="true"
            />
            <button
              role="tab"
              aria-selected={mode === "login"}
              aria-controls="login-form"
              onClick={switchToLogin}
              className={`relative z-10 flex-1 py-2 text-xs font-semibold rounded-xl transition-colors duration-200 tracking-wide ${mode === "login" ? "text-white" : "text-gray-500 hover:text-gray-300"
                }`}
            >
              Sign In
            </button>
            <button
              role="tab"
              aria-selected={mode === "signup"}
              aria-controls="signup-form"
              onClick={switchToSignup}
              className={`relative z-10 flex-1 py-2 text-xs font-semibold rounded-xl transition-colors duration-200 tracking-wide ${mode === "signup" ? "text-white" : "text-gray-500 hover:text-gray-300"
                }`}
            >
              Request Access
            </button>
          </div>

          {/* ── Login Form ─────────────────────────────────────────── */}
          {mode === "login" && (
            <form
              id="login-form"
              role="tabpanel"
              onSubmit={handleLogin}
              className="space-y-5 relative z-10"
              style={{ animation: "formEnter 0.3s cubic-bezier(0.16,1,0.3,1) both" }}
              noValidate
            >
              <div>
                <FieldLabel htmlFor="login-email">Email Address</FieldLabel>
                <GlassInput
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="email"
                />
              </div>

              <div>
                <FieldLabel htmlFor="login-password">Password</FieldLabel>
                <GlassInput
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pr-12"
                >
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-200 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </GlassInput>
              </div>

              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="relative w-full flex items-center justify-center gap-2.5 overflow-hidden text-white font-bold py-3.5 px-4 rounded-xl transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
                style={{
                  background: "linear-gradient(135deg, #9a3412 0%, #c2410c 100%)",
                  boxShadow: loading ? "none" : "0 0 24px rgba(234,88,12,0.35), 0 4px 12px rgba(0,0,0,0.3)",
                }}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                <span className="relative z-10 uppercase tracking-widest text-xs">
                  {loading ? "Authenticating…" : "Sign In"}
                </span>
              </button>
            </form>
          )}

          {formError && <p role="alert" className="mt-4 rounded-lg border border-red-400/40 bg-red-950/40 p-3 text-sm leading-6 text-red-100">{formError}</p>}
          {formNotice && <p role="status" className="mt-4 rounded-lg border border-white/20 p-3 text-sm leading-6 text-white">{formNotice}</p>}
          <details className="mt-4 text-sm text-gray-300"><summary className="cursor-pointer rounded py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400">Forgot your password or need access help?</summary><p className="mt-2 leading-6">Contact your unit head or a TCNP administrator to request password or account-access assistance. Give them your registered email address. Never share your password. Password-reset emails are not available from this screen.</p></details>

          {/* ── Signup Form ────────────────────────────────────────── */}
          {mode === "signup" && (
            <form
              id="signup-form"
              role="tabpanel"
              onSubmit={handleSignup}
              className="space-y-4 relative z-10"
              style={{ animation: "formEnter 0.3s cubic-bezier(0.16,1,0.3,1) both" }}
              noValidate
            >
              {/* Row: name + phone */}
              <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
                <div>
                  <FieldLabel htmlFor="signup-name">Full Name</FieldLabel>
                  <GlassInput
                    id="signup-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    placeholder="Amina Okafor"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="signup-phone">Phone</FieldLabel>
                  <GlassInput
                    id="signup-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+234 800 000 0000"
                    autoComplete="tel"
                    inputMode="tel"
                  />
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="signup-email">Email Address</FieldLabel>
                <GlassInput
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="email"
                />
              </div>

              <div>
                <FieldLabel htmlFor="signup-password">Password</FieldLabel>
                <GlassInput
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Min. 6 characters"
                  autoComplete="new-password"
                  className="pr-12"
                >
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-200 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </GlassInput>
              </div>

              {/* Row: Oscar + Team */}
              <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
                <div>
                  <FieldLabel htmlFor="signup-oscar">Oscar Unit</FieldLabel>
                  <GlassSelect
                    id="signup-oscar"
                    value={oscar}
                    onChange={(e) => setOscar(e.target.value)}
                  >
                    <option value="" className="bg-gray-900 text-gray-400">
                      Select…
                    </option>
                    {OSCAR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} className="bg-gray-900 text-white">
                        {o.label}
                      </option>
                    ))}
                  </GlassSelect>
                </div>
                <div>
                  <FieldLabel htmlFor="signup-team">Team</FieldLabel>
                  <GlassSelect
                    id="signup-team"
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    required
                  >
                    <option value="" className="bg-gray-900 text-gray-400">
                      Select…
                    </option>
                    {TEAM_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value} className="bg-gray-900 text-white">
                        {t.label}
                      </option>
                    ))}
                  </GlassSelect>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="relative w-full flex items-center justify-center gap-2.5 overflow-hidden rounded-xl py-3.5 px-4 text-white font-bold transition-all duration-200 border border-white/15 hover:bg-white/15 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: "rgba(255,255,255,0.08)" }}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                <span className="uppercase tracking-widest text-xs">
                  {loading ? "Submitting…" : "Submit Request"}
                </span>
              </button>
            </form>
          )}

          {/* ── Footer ──────────────────────────────────────────────── */}
          <p className="mt-6 text-center text-[10px] text-gray-600 tracking-widest uppercase relative z-10">
            Command Center · Secure Access
          </p>
        </div>

        {/* Rotating quote */}
        <div className="mt-6 text-center px-6" aria-live="polite" aria-atomic="true">
          <p
            className="text-gray-500 text-xs italic leading-relaxed transition-opacity duration-500"
            style={{ opacity: quoteFading ? 0 : 0.7 }}
          >
            &ldquo;{QUOTES[quoteIndex]}&rdquo;
          </p>
        </div>
      </div>

      {/* ── CSS for keyframes (moved to style tag in layout—or inline here) ── */}
      <style>{`
        @keyframes cardEnter {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes formEnter {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes floatBlob1 {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(4%, 3%) scale(1.05); }
        }
        @keyframes floatBlob2 {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(-4%, -3%) scale(1.08); }
        }
      `}</style>
    </main>
  );
}
