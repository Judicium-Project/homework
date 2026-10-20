import { useEffect, useState } from "react";
import type { InstanceSettings, InstanceSettingsPatch, RegistrationMode, SettingSource, SmtpTls } from "@chatapp/api-types";
import { api } from "../../api/endpoints.ts";
import { ApiError } from "../../api/client.ts";
import { t, type TrKey } from "../../i18n/index.ts";
import { useStore } from "../../store/index.ts";
import { Button } from "../../ui/Button.tsx";
import { Checkbox, Field, TextInput } from "../../ui/Form.tsx";
import { ErrorCard, SkeletonRows, errorText } from "../../ui/States.tsx";
import { toast } from "../../ui/Toast.tsx";
import css from "./settings.module.css";
import gcss from "../guild/guild.module.css";

export default function ServerSettings() {
  const me = useStore((s) => s.me);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<unknown | null>(null);
  const [etag, setEtag] = useState<string | undefined>(undefined);
  const [initial, setInitial] = useState<InstanceSettings | null>(null);

  // Form durumları
  const [siteName, setSiteName] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [regMode, setRegMode] = useState<RegistrationMode>("invite");
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);

  // SMTP alanları
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState<number>(1025);
  const [smtpTls, setSmtpTls] = useState<SmtpTls>("none");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [passwordRemoved, setPasswordRemoved] = useState(false);
  const [smtpFromAddress, setSmtpFromAddress] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");

  // Durumlar & Hatalar
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  // Test e-postası durumu
  const [testRecipient, setTestRecipient] = useState(me?.email ?? "");
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadErr(null);
    setConflict(false);
    try {
      const res = await api.instanceSettings();
      setInitial(res.settings);
      setEtag(res.etag);
      // Formu doldur
      setSiteName(res.settings.site.name);
      setPublicUrl(res.settings.site.public_url);
      setRegMode(res.settings.registration_mode);
      setEmailVerificationRequired(res.settings.email_verification_required ?? false);
      setSmtpHost(res.settings.smtp.host);
      setSmtpPort(res.settings.smtp.port);
      setSmtpTls(res.settings.smtp.tls);
      setSmtpUsername(res.settings.smtp.username);
      setSmtpFromAddress(res.settings.smtp.from_address);
      setSmtpFromName(res.settings.smtp.from_name);
      setSmtpPassword("");
      setPasswordRemoved(false);
      setFieldErrors({});

      // Store'daki instance'ı senkronize et
      const cur = useStore.getState().instance;
      if (cur) {
        useStore.getState().patch({
          instance: {
            ...cur,
            name: res.settings.site.name,
            registration_mode: res.settings.registration_mode,
            email_verification_required: res.settings.email_verification_required,
          },
        });
      }
    } catch (e) {
      setLoadErr(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return (
      <div className={css.content}>
        <h2 className={css.h}>{t("settings.server")}</h2>
        <SkeletonRows rows={6} />
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className={css.content}>
        <h2 className={css.h}>{t("settings.server")}</h2>
        <ErrorCard error={loadErr} onRetry={() => void load()} />
      </div>
    );
  }

  if (!initial) return null;

  // Değişiklik kontrolü
  const isDirty =
    siteName !== initial.site.name ||
    publicUrl !== initial.site.public_url ||
    regMode !== initial.registration_mode ||
    emailVerificationRequired !== initial.email_verification_required ||
    smtpHost !== initial.smtp.host ||
    smtpPort !== initial.smtp.port ||
    smtpTls !== initial.smtp.tls ||
    smtpUsername !== initial.smtp.username ||
    smtpFromAddress !== initial.smtp.from_address ||
    smtpFromName !== initial.smtp.from_name ||
    smtpPassword.length > 0 ||
    passwordRemoved;

  const handleReset = () => {
    setSiteName(initial.site.name);
    setPublicUrl(initial.site.public_url);
    setRegMode(initial.registration_mode);
    setEmailVerificationRequired(initial.email_verification_required);
    setSmtpHost(initial.smtp.host);
    setSmtpPort(initial.smtp.port);
    setSmtpTls(initial.smtp.tls);
    setSmtpUsername(initial.smtp.username);
    setSmtpFromAddress(initial.smtp.from_address);
    setSmtpFromName(initial.smtp.from_name);
    setSmtpPassword("");
    setPasswordRemoved(false);
    setFieldErrors({});
    setConflict(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setFieldErrors({});
    setConflict(false);

    const patch: InstanceSettingsPatch = {
      site: {
        name: siteName.trim(),
        public_url: publicUrl.trim(),
      },
      registration_mode: regMode,
      smtp: {
        host: smtpHost.trim(),
        port: Number(smtpPort),
        tls: smtpTls,
        username: smtpUsername.trim(),
        from_address: smtpFromAddress.trim(),
        from_name: smtpFromName.trim(),
      },
    };

    if (emailVerificationRequired !== initial.email_verification_required) {
      patch.email_verification_required = emailVerificationRequired;
    }

    if (passwordRemoved) {
      patch.smtp!.password = "";
    } else if (smtpPassword.length > 0) {
      patch.smtp!.password = smtpPassword;
    }

    try {
      const saved = await api.updateInstanceSettings(patch, etag);
      toast.success(t("settings.saved"));
      const cur = useStore.getState().instance;
      if (cur) {
        useStore.getState().patch({
          instance: {
            ...cur,
            name: saved.site.name,
            registration_mode: saved.registration_mode,
            email_verification_required: saved.email_verification_required,
          },
        });
      }
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) {
          setConflict(true);
          return;
        }
        if (e.status === 400 || e.status === 422) {
          const errs: Record<string, string> = {};
          if (e.body?.errors) {
            for (const fe of e.body.errors) {
              if (fe.field) errs[fe.field] = fe.message;
            }
          }
          setFieldErrors(errs);
          toast.error(errorText(e));
          return;
        }
      }
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const handleTestSmtp = async () => {
    if (isDirty) {
      toast.error(t("settings.server.testSmtp.unsavedWarning"));
      return;
    }
    setTestingSmtp(true);
    setTestResult(null);
    try {
      await api.testSmtp({ to: testRecipient.trim() });
      toast.success(t("settings.server.testSmtp.success"));
      setTestResult({ ok: true, msg: t("settings.server.testSmtp.success") });
    } catch (e) {
      const msg = errorText(e);
      toast.error(msg);
      setTestResult({ ok: false, msg });
    } finally {
      setTestingSmtp(false);
    }
  };

  return (
    <div className={css.form}>
      <h2 className={css.h}>{t("settings.server")}</h2>

      {conflict && (
        <div className={css.danger} role="alert">
          <h3>{t("settings.server.conflict")}</h3>
          <div>
            <Button kind="primary" onClick={() => void load()}>
              {t("settings.server.reload")}
            </Button>
          </div>
        </div>
      )}

      {/* ── BÖLÜM 1: Site Ayarları ── */}
      <h3 className={css.h} style={{ fontSize: "var(--hk-font-size-base)", marginTop: "var(--hk-space-2)" }}>
        {t("settings.server.site")}
      </h3>

      <SettingField label={t("settings.server.site.name")} source={initial.sources["site.name"]} error={fieldErrors["site.name"]}>
        {(p) => <TextInput {...p} value={siteName} maxLength={100} onChange={(e) => setSiteName(e.target.value)} />}
      </SettingField>

      <SettingField label={t("settings.server.site.publicUrl")} source={initial.sources["site.public_url"]} error={fieldErrors["site.public_url"]}>
        {(p) => <TextInput {...p} type="url" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} />}
      </SettingField>

      {/* ── BÖLÜM 2: Kayıt Kipi ── */}
      <SettingField label={t("settings.server.regMode")} source={initial.sources["registration_mode"]} error={fieldErrors["registration_mode"]}>
        {(p) => (
          <select
            {...p}
            className={gcss.select}
            value={regMode}
            onChange={(e) => setRegMode(e.target.value as RegistrationMode)}
          >
            <option value="open">{t("settings.server.regMode.open")}</option>
            <option value="invite">{t("settings.server.regMode.invite")}</option>
            <option value="closed">{t("settings.server.regMode.closed")}</option>
          </select>
        )}
      </SettingField>

      <div style={{ position: "relative", marginTop: "var(--hk-space-3)" }}>
        {initial.sources["email_verification_required"] && (
          <div style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}>
            <SourceBadge source={initial.sources["email_verification_required"]} />
          </div>
        )}
        <Checkbox
          label={t("settings.server.emailVerificationRequired")}
          checked={emailVerificationRequired}
          onChange={(e) => setEmailVerificationRequired(e.target.checked)}
        />
        <p style={{ margin: "var(--hk-space-1) 0 0 0", fontSize: "var(--hk-font-size-sm)", color: "var(--hk-text-muted)" }}>
          {t("settings.server.emailVerificationRequired.help")}
        </p>
      </div>

      {/* ── BÖLÜM 3: E-posta (SMTP) ── */}
      <h3 className={css.h} style={{ fontSize: "var(--hk-font-size-base)", marginTop: "var(--hk-space-4)" }}>
        {t("settings.server.email")}
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "var(--hk-space-4)" }}>
        <SettingField label={t("settings.server.smtp.host")} source={initial.sources["smtp.host"]} error={fieldErrors["smtp.host"]}>
          {(p) => <TextInput {...p} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />}
        </SettingField>

        <SettingField label={t("settings.server.smtp.port")} source={initial.sources["smtp.port"]} error={fieldErrors["smtp.port"]}>
          {(p) => (
            <TextInput
              {...p}
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(Number(e.target.value))}
            />
          )}
        </SettingField>
      </div>

      <SettingField label={t("settings.server.smtp.tls")} source={initial.sources["smtp.tls"]} error={fieldErrors["smtp.tls"]}>
        {(p) => (
          <select
            {...p}
            className={gcss.select}
            value={smtpTls}
            onChange={(e) => setSmtpTls(e.target.value as SmtpTls)}
          >
            <option value="starttls">STARTTLS</option>
            <option value="tls">TLS</option>
            <option value="none">none</option>
          </select>
        )}
      </SettingField>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--hk-space-4)" }}>
        <SettingField label={t("settings.server.smtp.username")} source={initial.sources["smtp.username"]} error={fieldErrors["smtp.username"]}>
          {(p) => <TextInput {...p} value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} />}
        </SettingField>

        <SettingField
          label={t("settings.server.smtp.password")}
          source={initial.sources["smtp.password"]}
          help={
            initial.smtp.password_set && !passwordRemoved
              ? t("settings.server.smtp.passwordSet")
              : undefined
          }
          error={fieldErrors["smtp.password"]}
        >
          {(p) => (
            <div style={{ display: "flex", gap: "var(--hk-space-2)", alignItems: "center" }}>
              <TextInput
                {...p}
                type="password"
                placeholder={initial.smtp.password_set && !passwordRemoved ? "••••••••" : ""}
                value={smtpPassword}
                onChange={(e) => {
                  setSmtpPassword(e.target.value);
                  setPasswordRemoved(false);
                }}
              />
              {initial.smtp.password_set && !passwordRemoved && (
                <Button
                  size="sm"
                  kind="danger"
                  type="button"
                  onClick={() => {
                    setPasswordRemoved(true);
                    setSmtpPassword("");
                  }}
                >
                  {t("settings.server.smtp.removePassword")}
                </Button>
              )}
            </div>
          )}
        </SettingField>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--hk-space-4)" }}>
        <SettingField label={t("settings.server.smtp.fromAddress")} source={initial.sources["smtp.from_address"]} error={fieldErrors["smtp.from_address"]}>
          {(p) => <TextInput {...p} type="email" value={smtpFromAddress} onChange={(e) => setSmtpFromAddress(e.target.value)} />}
        </SettingField>

        <SettingField label={t("settings.server.smtp.fromName")} source={initial.sources["smtp.from_name"]} error={fieldErrors["smtp.from_name"]}>
          {(p) => <TextInput {...p} value={smtpFromName} onChange={(e) => setSmtpFromName(e.target.value)} />}
        </SettingField>
      </div>

      {/* Kaydet ve Sıfırla düğmeleri */}
      <div style={{ display: "flex", gap: "var(--hk-space-3)", marginTop: "var(--hk-space-2)" }}>
        <Button kind="primary" busy={saving} disabled={!isDirty} onClick={() => void handleSave()}>
          {t("common.save")}
        </Button>
        <Button kind="ghost" disabled={!isDirty || saving} onClick={handleReset}>
          {t("settings.reset")}
        </Button>
      </div>

      {/* ── TEST E-POSTASI ALANI ── */}
      <div
        className={css.preview}
        style={{ marginTop: "var(--hk-space-6)", borderTop: "var(--hk-border-width) solid var(--hk-border-subtle)", paddingTop: "var(--hk-space-4)" }}
      >
        <h4 style={{ fontWeight: "var(--hk-font-weight-semibold)", fontSize: "var(--hk-font-size-base)" }}>
          {t("settings.server.testSmtp")}
        </h4>
        <div style={{ display: "flex", gap: "var(--hk-space-3)", alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <Field label={t("settings.server.testSmtp.recipient")}>
              {(p) => (
                <TextInput
                  {...p}
                  type="email"
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Button
            kind="secondary"
            busy={testingSmtp}
            disabled={!testRecipient.trim()}
            onClick={() => void handleTestSmtp()}
          >
            {t("settings.server.testSmtp.button")}
          </Button>
        </div>

        {testResult && (
          <div
            style={{
              padding: "var(--hk-space-2) var(--hk-space-3)",
              borderRadius: "var(--hk-radius-md)",
              backgroundColor: testResult.ok ? "var(--hk-success-subtle)" : "var(--hk-danger-subtle)",
              color: testResult.ok ? "var(--hk-success-text)" : "var(--hk-danger-text)",
              fontSize: "var(--hk-font-size-sm)",
            }}
            role="status"
          >
            {testResult.msg}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source?: SettingSource }) {
  if (!source) return null;
  const key = ("settings.server.source." + source) as TrKey;
  return <span className={css.badge}>{t(key)}</span>;
}

function SettingField({
  label,
  source,
  error,
  help,
  children,
}: {
  label: string;
  source?: SettingSource;
  error?: string | null;
  help?: string;
  children: Parameters<typeof Field>[0]["children"];
}) {
  return (
    <div style={{ position: "relative" }}>
      {source && (
        <div style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}>
          <SourceBadge source={source} />
        </div>
      )}
      <Field label={label} error={error} help={help}>
        {children}
      </Field>
    </div>
  );
}
