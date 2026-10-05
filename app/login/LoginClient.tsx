"use client";

import {
  ArrowRight,
  Building2,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { BrandLockup } from "../../features/brand/BrandLockup";
import { PartnerFooter } from "../../features/brand/PartnerFooter";
import type { WorkspaceRole } from "../../features/workspace/model";
import styles from "./LoginClient.module.css";

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  user: "Bruger",
  consultant: "D-GITA-konsulent",
  admin: "Administrator",
};

type SessionResponse = {
  authenticated: boolean;
  devLoginEnabled?: boolean;
  devLoginAccessCodeRequired?: boolean;
  error?: string;
};

export function LoginClient() {
  const router = useRouter();
  const [role, setRole] = useState<WorkspaceRole>("user");
  const [devLoginEnabled, setDevLoginEnabled] = useState(false);
  const [entraEnabled, setEntraEnabled] = useState(false);
  const [accessCodeRequired, setAccessCodeRequired] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const entraError = new URLSearchParams(window.location.search).get("entra");
    void fetch("/api/auth/entra/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload: unknown = await response.json();
        setEntraEnabled(Boolean(payload && typeof payload === "object" && "enabled" in payload && payload.enabled === true));
      })
      .catch(() => { /* An unavailable provider stays disabled; test login remains independent. */ });
    void fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as SessionResponse;
        if (payload.authenticated) {
          router.replace("/");
          return;
        }
        if (entraError === "access-not-assigned") {
          setError("Du har ikke fået adgang til D-GITA endnu. Kontakt systemadministratoren.");
        } else if (entraError === "login-failed") {
          setError("Kommunens login kunne ikke gennemføres. Prøv at logge ind igen.");
        }
        setDevLoginEnabled(Boolean(payload.devLoginEnabled));
        setAccessCodeRequired(Boolean(payload.devLoginAccessCodeRequired));
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== "AbortError") {
          setError("Login-tjenesten kunne ikke kontaktes. Prøv igen om et øjeblik.");
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [router]);

  async function signInForTesting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          ...(accessCodeRequired ? { accessCode } : {}),
        }),
      });
      const payload = (await response.json()) as SessionResponse;
      if (!response.ok || !payload.authenticated) {
        throw new Error(payload.error || "Testlogin kunne ikke gennemføres.");
      }
      router.replace("/");
      router.refresh();
    } catch (reason) {
      setError((reason as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="login-story-title">
        <div className="login-story-image" aria-hidden="true" />
        <div className="login-story-shade" aria-hidden="true" />
        <div className="login-wordmark">
          <BrandLockup tone="inverse" />
        </div>
        <div className="login-story-copy">
          <span className="login-kicker">Kalundborg Kommune</span>
          <h1 id="login-story-title">Ét sikkert forløb fra behov til godkendelse.</h1>
          <p>Ansøgning, dokumentation, dialog og beslutninger samlet omkring den enkelte IT-anskaffelse.</p>
          <ul>
            <li><Check size={16} /> Kun adgang til relevante sager</li>
            <li><Check size={16} /> Versionslåst dokumentation</li>
            <li><Check size={16} /> Tydeligt auditspor</li>
          </ul>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-panel-inner">
          <div className="login-security-mark"><ShieldCheck size={22} /></div>
          <span className="section-label dark">Sikker adgang</span>
          <h2 id="login-title">Log ind på D-GITA</h2>
          <p className="login-intro">Vælg den adgangsløsning, din kommune anvender. Din rolle og kommune fastlægges ved login.</p>

          <form id="entra-login" action="/api/auth/entra/start" method="get" />
          <div className="login-provider-list" aria-label="Kommunale loginmuligheder">
            <button type="submit" form="entra-login" disabled={!entraEnabled || submitting} title={entraEnabled ? "Log ind med din kommunale konto" : "Kommunens login er ikke tilsluttet endnu"}>
              <span><KeyRound size={20} /></span>
              <div><strong>Microsoft Entra ID</strong><small>{entraEnabled ? "Log ind med din kommunale konto" : "Ikke tilsluttet"}</small></div>
              <ArrowRight size={18} />
            </button>
            <button type="button" disabled title="Aktiveres, når Context Handler-klienten er registreret">
              <span><Building2 size={20} /></span>
              <div><strong>Fælleskommunal Adgangsstyring</strong><small>Ikke tilsluttet</small></div>
              <ArrowRight size={18} />
            </button>
          </div>

          <div className="login-divider"><span>Testmiljø</span></div>

          <form className="login-test-box" aria-busy={submitting} onSubmit={(event) => void signInForTesting(event)}>
            <div><strong>Afprøv rollebaseret adgang</strong><small>Kun tilgængelig lokalt eller ved eksplicit testopsætning.</small></div>
            <label>
              Rolle
              <select value={role} onChange={(event) => setRole(event.target.value as WorkspaceRole)} disabled={!devLoginEnabled || submitting}>
                {(Object.keys(ROLE_LABELS) as WorkspaceRole[]).map((value) => (
                  <option key={value} value={value}>{ROLE_LABELS[value]}</option>
                ))}
              </select>
            </label>
            {devLoginEnabled && accessCodeRequired ? (
              <div className={styles.accessCodeField}>
                <label htmlFor="test-access-code">Testadgangskode</label>
                <span className={styles.accessCodeInput}>
                  <LockKeyhole size={17} aria-hidden="true" />
                  <input
                    id="test-access-code"
                    type={passwordVisible ? "text" : "password"}
                    aria-label="Testadgangskode"
                    value={accessCode}
                    onChange={(event) => setAccessCode(event.target.value)}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    minLength={8}
                    required
                    disabled={submitting}
                    aria-describedby="test-access-help"
                  />
                  <button
                    className={styles.passwordToggle}
                    type="button"
                    aria-label={passwordVisible ? "Skjul adgangskode" : "Vis adgangskode"}
                    aria-controls="test-access-code"
                    disabled={submitting}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    {passwordVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </span>
                <small id="test-access-help" className={styles.accessCodeHelp}>
                  Indtast den adgangskode, du har modtaget til testmiljøet.
                </small>
              </div>
            ) : null}
            <button className="login-submit" type="submit" disabled={!devLoginEnabled || loading || submitting || (accessCodeRequired && accessCode.length === 0)}>
              {submitting ? "Logger ind…" : "Fortsæt til portalen"}
              {!submitting ? <ArrowRight size={18} /> : null}
            </button>
          </form>

          {error ? <p className="login-error" role="alert">{error}</p> : null}
          {!loading && !devLoginEnabled && !entraEnabled && !error ? <p className="login-status" role="status">Kommunens identitetsforbindelse skal konfigureres af en administrator.</p> : null}

          <div className="login-privacy"><LockKeyhole size={16} /><p>Login og adgang kontrolleres på serveren. Rollen kan ikke ændres ved at manipulere browseren.</p></div>
        </div>
      </section>

      <PartnerFooter className="login-partner-footer" />
    </main>
  );
}
