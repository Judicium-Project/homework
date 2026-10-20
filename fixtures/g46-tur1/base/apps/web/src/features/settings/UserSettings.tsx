import { useEffect, useRef, useState } from "react";
import { api } from "../../api/endpoints.ts";
import { t } from "../../i18n/index.ts";
import { MAX_AVATAR_FILE, uploadFile } from "../../lib/upload.ts";
import { useStore } from "../../store/index.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { AvatarCropModal } from "../../ui/AvatarCropModal.tsx";
import { Button } from "../../ui/Button.tsx";
import { Field, Switch, TextArea, TextInput } from "../../ui/Form.tsx";
import { errorText } from "../../ui/States.tsx";
import { toast } from "../../ui/Toast.tsx";
import { signOut } from "../auth/session.ts";
import { SettingsLayer } from "./Layer.tsx";
import { SessionsSection } from "./Sessions.tsx";
import { ShortcutsSection, VoiceSettingsSection } from "./VoiceSettings.tsx";
import ServerSettings from "./ServerSettings.tsx";
import { listTemplates, getTemplate, TEMPLATE_KEY, MODE_KEY, LEGACY_THEME_KEY, ACCENT_KEY, type TemplateMode, ADA_TEMPLATE } from "../../theme/templates.ts";
import { PRESET_ACCENTS, generateAccentPalette, applyAccentToDom } from "../../theme/accent.ts";
import {
  getCustomBackground,
  setCustomBackground,
  clearCustomBackground,
  BACKGROUND_PRESETS,
  type CustomBackgroundConfig,
} from "../../theme/background.ts";
import css from "./settings.module.css";
import gcss from "../guild/guild.module.css";
import { brand } from "../../brand.ts";

const SECTIONS = ["hesabim", "guvenlik", "profil", "ses", "kisayollar", "gorunum"] as const;
type Sec = (typeof SECTIONS)[number] | "sunucu";

export default function UserSettings({ section, onClose, guildForProfile }: { section: string; onClose(): void; guildForProfile: string | null }) {
  const me = useStore((s) => s.me);
  const isAdmin = Boolean(me?.instance_admin);
  const validSections: readonly string[] = isAdmin ? [...SECTIONS, "sunucu"] : SECTIONS;
  const [sec, setSec] = useState<Sec>(validSections.includes(section) ? (section as Sec) : "hesabim");

  const getLabel = (s: Sec): string => {
    switch (s) {
      case "hesabim": return t("settings.account");
      case "guvenlik": return t("settings.security");
      case "profil": return t("settings.profile");
      case "ses": return t("settings.voice");
      case "kisayollar": return t("settings.shortcuts");
      case "gorunum": return t("settings.appearance");
      case "sunucu": return t("settings.server");
    }
  };

  return (
    <SettingsLayer
      title={t("settings.user")}
      active={sec}
      onSelect={(id) => setSec(id as Sec)}
      onClose={onClose}
      nav={[
        ...SECTIONS.map((s) => ({ id: s, label: getLabel(s) })),
        ...(isAdmin ? [{ id: "sunucu", label: t("settings.server") }] : []),
        { id: "exit", label: t("settings.signOut"), danger: true, onClick: () => { onClose(); void signOut(); } },
      ]}
    >
      {sec === "hesabim" && <Account />}
      {sec === "guvenlik" && <Security />}
      {sec === "profil" && <Profile guildId={guildForProfile} />}
      {sec === "ses" && <VoiceSettingsSection />}
      {sec === "kisayollar" && <ShortcutsSection />}
      {sec === "gorunum" && <Appearance />}
      {sec === "sunucu" && isAdmin && <ServerSettings />}
    </SettingsLayer>
  );
}

/** 7.1 Hesabım: e-posta (maskeli, göster), kullanıcı adı. Parola/e-posta değişimi Beta 0 dışı. */
function Account() {
  const me = useStore((s) => s.me);
  const [show, setShow] = useState(false);
  if (!me) return null;
  const masked = me.email.replace(/^(.).*(@.*)$/, "$1•••$2");
  return (
    <>
      <h2 className={css.h}>{t("settings.account")}</h2>
      <div className={css.row}><div className={css.rowText}><strong>{t("auth.email")}</strong><span>{show ? me.email : masked}</span></div><Button size="sm" onClick={() => setShow(!show)}>{show ? t("settings.hide") : t("settings.show")}</Button></div>
      <div className={css.row}><div className={css.rowText}><strong>{t("auth.username")}</strong><span>@{me.username}</span></div></div>
    </>
  );
}

/** 7.3/7.4 Güvenlik: aktif oturumlar (2FA/passkey sonraki paket). */
function Security() {
  return (
    <>
      <h2 className={css.h}>{t("settings.security")}</h2>
      <SessionsSection />
    </>
  );
}

/** 7.2 Profil + sunucu başına takma ad. */
function Profile({ guildId }: { guildId: string | null }) {
  const me = useStore((s) => s.me);
  const guilds = useStore((s) => s.guilds);
  const [name, setName] = useState(me?.display_name ?? "");
  const [about, setAbout] = useState(me?.about ?? "");
  const [avatarId, setAvatarId] = useState(me?.avatar_id ?? null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [gid, setGid] = useState(guildId ?? Object.keys(guilds)[0] ?? "");
  const nickNow = useStore((s) => (s.me ? s.guilds[gid]?.members[s.me.id]?.nick : null)) ?? "";
  const [nick, setNick] = useState(nickNow);
  useEffect(() => setNick(nickNow ?? ""), [nickNow, gid]);
  if (!me) return null;
  const dirty = name !== (me.display_name ?? "") || about !== (me.about ?? "") || avatarId !== me.avatar_id;
  const save = async () => {
    setBusy(true);
    try {
      await api.updateMe({ display_name: name.trim() || null, about: about.trim() || null, avatar_id: avatarId });
      toast.success(t("settings.saved"));
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <h2 className={css.h}>{t("settings.profile")}</h2>
      <div className={css.form}>
        <div className={gcss.iconPick}>
          <Avatar name={name || me.username} avatarId={avatarId} size="xl" />
          <Button onClick={() => file.current?.click()}>{t("settings.avatar")}</Button>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > MAX_AVATAR_FILE || !/^image\/(png|jpeg|webp|gif)$/.test(f.type)) {
                toast.error(t("upload.badImage"));
                if (file.current) file.current.value = "";
                return;
              }
              setCropFile(f);
            }}
          />
        </div>
        {cropFile && (
          <AvatarCropModal
            file={cropFile}
            shape="circle"
            onClose={() => {
              setCropFile(null);
              if (file.current) file.current.value = "";
            }}
            onConfirm={async (cropped) => {
              try {
                const att = await uploadFile(cropped, "avatar");
                setAvatarId(att.id);
                toast.success(t("settings.saved"));
              } catch (er) {
                toast.error(errorText(er));
              } finally {
                setCropFile(null);
                if (file.current) file.current.value = "";
              }
            }}
          />
        )}
        <Field label={t("settings.displayName")}>{(p) => <TextInput {...p} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t("settings.about")} help={t("settings.aboutHelp", { n: 190 - about.length })}>{(p) => <TextArea {...p} rows={3} maxLength={190} value={about} onChange={(e) => setAbout(e.target.value)} />}</Field>
        <div><Button kind="primary" busy={busy} disabled={!dirty} onClick={() => void save()}>{t("common.save")}</Button></div>
      </div>
      {Object.keys(guilds).length > 0 && (
        <div className={css.form}>
          <h3 className={css.h}>{t("settings.perGuild")}</h3>
          <Field label={t("settings.pickGuild")}>
            {(p) => <select {...p} className={gcss.select} value={gid} onChange={(e) => setGid(e.target.value)}>{Object.values(guilds).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
          </Field>
          <Field label={t("settings.nick")}>{(p) => <TextInput {...p} value={nick} maxLength={32} onChange={(e) => setNick(e.target.value)} />}</Field>
          <div><Button disabled={nick === (nickNow ?? "")} onClick={() => api.updateMember(gid, me.id, { nick: nick.trim() || null }).then(() => toast.success(t("settings.saved")), (e) => toast.error(errorText(e)))}>{t("common.save")}</Button></div>
        </div>
      )}
    </>
  );
}

/** 7.9 Görünüm: şablon, kip, kişisel vurgu, yoğunluk, yazı boyutu, geliştirici modu (G33). */
function Appearance() {
  const s = useStore((x) => x.settings);
  const patch = (b: Parameters<typeof api.updateSettings>[0]) => {
    useStore.getState().patch({ settings: { ...useStore.getState().settings, ...b } });
    api.updateSettings(b).catch((e) => toast.error(errorText(e)));
  };

  const [templateId, setTemplateId] = useState(() => (typeof localStorage !== "undefined" && localStorage.getItem(TEMPLATE_KEY)) || "ada");
  const [accent, setAccent] = useState<string | null>(() => (typeof localStorage !== "undefined" ? localStorage.getItem(ACCENT_KEY) : null));
  const [aaAdjusted, setAaAdjusted] = useState(false);

  const [bgConfig, setBgConfig] = useState<CustomBackgroundConfig>(() => getCustomBackground());
  const [customUrl, setCustomUrl] = useState(bgConfig.image ?? "");
  const [uploading, setUploading] = useState(false);
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  const handlePresetSelect = (url: string) => {
    const next = setCustomBackground({ image: url });
    setBgConfig(next);
    setCustomUrl(url);
  };

  const handleApplyCustomUrl = () => {
    const trimmed = customUrl.trim();
    const next = setCustomBackground({ image: trimmed || null });
    setBgConfig(next);
  };

  const handleBlurChange = (val: number) => {
    const next = setCustomBackground({ blur: val });
    setBgConfig(next);
  };

  const handleOpacityChange = (val: number) => {
    const next = setCustomBackground({ opacity: val });
    setBgConfig(next);
  };

  const handleResetBackground = () => {
    clearCustomBackground();
    const next = getCustomBackground();
    setBgConfig(next);
    setCustomUrl("");
  };

  const handleUploadBgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const att = await uploadFile(f, "banner");
      const res = await api.attachmentUrl(att.id);
      const url = res.url;
      const next = setCustomBackground({ image: url });
      setBgConfig(next);
      setCustomUrl(url);
      toast.success(t("settings.saved"));
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          const next = setCustomBackground({ image: reader.result });
          setBgConfig(next);
          setCustomUrl(reader.result);
          toast.success(t("settings.saved"));
        }
      };
      reader.readAsDataURL(f);
    } finally {
      setUploading(false);
      if (bgFileInputRef.current) bgFileInputRef.current.value = "";
    }
  };

  const templates = listTemplates();
  const activeTemplate = getTemplate(templateId) ?? ADA_TEMPLATE;

  const isDarkNow =
    s.theme === "light"
      ? false
      : s.theme === "system" && typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : true;

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    try {
      localStorage.setItem(TEMPLATE_KEY, id);
    } catch {
      /* yok say */
    }
    document.documentElement.dataset.template = id;
    const nextTemplate = getTemplate(id);
    if (nextTemplate && !nextTemplate.supportedModes.includes("dev") && s.theme === "dev") {
      patch({ theme: "dark" });
    }
  };

  const handleModeChange = (mode: TemplateMode) => {
    patch({ theme: mode });
    try {
      localStorage.setItem(MODE_KEY, mode);
      localStorage.setItem(LEGACY_THEME_KEY, mode);
    } catch {
      /* yok say */
    }
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.theme = mode;

    if (accent && accent !== "default") {
      const isDark =
        mode === "light"
          ? false
          : mode === "system" && typeof window !== "undefined" && window.matchMedia
            ? window.matchMedia("(prefers-color-scheme: dark)").matches
            : true;
      const pal = generateAccentPalette(accent, undefined, isDark);
      applyAccentToDom(pal);
      setAaAdjusted(pal.contrastAdjusted);
    }
  };

  const handleAccentSelect = (hex: string) => {
    setAccent(hex);
    try {
      localStorage.setItem(ACCENT_KEY, hex);
    } catch {
      /* yok say */
    }
    const pal = generateAccentPalette(hex, undefined, isDarkNow);
    applyAccentToDom(pal);
    setAaAdjusted(pal.contrastAdjusted);
  };

  const handleResetAccent = () => {
    setAccent(null);
    try {
      localStorage.removeItem(ACCENT_KEY);
    } catch {
      /* yok say */
    }
    applyAccentToDom(null);
    setAaAdjusted(false);
  };

  const modes = [
    ["system", "settings.mode.system"],
    ["light", "settings.mode.light"],
    ["dark", "settings.mode.dark"],
    ...(activeTemplate.supportedModes.includes("dev") ? [["dev", "settings.mode.dev"] as const] : []),
  ] as const;

  return (
    <>
      <h2 className={css.h}>{t("settings.appearance")}</h2>

      {/* Şablon Kartları (Mini Önizleme) */}
      <Field label={t("settings.template")}>
        {() => (
          <div role="radiogroup" aria-label={t("settings.template")} style={{ display: "flex", gap: "var(--hk-space-3)", flexWrap: "wrap" }}>
            {templates.map((tpl) => {
              const preview = typeof tpl.preview === "object" && "dark" in tpl.preview ? (tpl.preview as any)[isDarkNow ? "dark" : "light"] ?? (tpl.preview as any).dark : tpl.preview;
              const isSelected = templateId === tpl.id;
              return (
                <div
                  key={tpl.id}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onClick={() => handleTemplateChange(tpl.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleTemplateChange(tpl.id); }}
                  style={{
                    cursor: "pointer",
                    border: isSelected ? "2px solid var(--hk-accent-base)" : "1px solid var(--hk-border-subtle)",
                    borderRadius: "var(--hk-radius-md)",
                    padding: "var(--hk-space-2)",
                    background: "var(--hk-bg-surface)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--hk-space-1_5)",
                    minWidth: "130px",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "54px",
                      borderRadius: "var(--hk-radius-sm)",
                      background: preview.bg,
                      border: "1px solid var(--hk-border-subtle)",
                      position: "relative",
                      overflow: "hidden",
                      padding: "var(--hk-space-1)",
                      display: "flex",
                      gap: "var(--hk-space-1)",
                    }}
                  >
                    <div style={{ width: "26%", height: "100%", background: preview.surface, borderRadius: "2px" }} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
                      <div style={{ width: "65%", height: "5px", background: preview.text, borderRadius: "2px", opacity: 0.8 }} />
                      <div style={{ width: "85%", height: "4px", background: preview.text, borderRadius: "2px", opacity: 0.4 }} />
                      <div style={{ width: "35%", height: "10px", background: preview.accent, borderRadius: "2px", marginTop: "auto" }} />
                    </div>
                  </div>
                  <div style={{ fontWeight: "var(--hk-font-weight-semibold)", fontSize: "var(--hk-font-size-sm)" }}>{tpl.name}</div>
                </div>
              );
            })}
          </div>
        )}
      </Field>

      {/* Kip Seçici */}
      <Field label={t("settings.mode")}>
        {() => (
          <div role="radiogroup" aria-label={t("settings.mode")} style={{ display: "flex", gap: "var(--hk-space-2)", flexWrap: "wrap" }}>
            {modes.map(([v, k]) => (
              <Button key={v} role="radio" aria-checked={s.theme === v} kind={s.theme === v ? "primary" : "secondary"} onClick={() => handleModeChange(v as TemplateMode)}>
                {t(k as any)}
              </Button>
            ))}
          </div>
        )}
      </Field>

      {/* Kişisel Vurgu Rengi */}
      <Field label={t("settings.accent")}>
        {() => (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--hk-space-2)" }}>
            <div role="radiogroup" aria-label={t("settings.accent")} style={{ display: "flex", alignItems: "center", gap: "var(--hk-space-2)", flexWrap: "wrap" }}>
              {PRESET_ACCENTS.map((p) => {
                const isSelected = accent?.toLocaleLowerCase("tr") === p.color.toLocaleLowerCase("tr");
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    title={p.name}
                    onClick={() => handleAccentSelect(p.color)}
                    style={{
                      width: "30px",
                      height: "30px",
                      borderRadius: "50%",
                      background: p.color,
                      border: isSelected ? "3px solid var(--hk-text-primary)" : "1px solid var(--hk-border-subtle)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                );
              })}
              <label
                title={t("settings.accent.custom")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "30px",
                  height: "30px",
                  borderRadius: "50%",
                  border: "1px dashed var(--hk-border-subtle)",
                  cursor: "pointer",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <input
                  type="color"
                  aria-label={t("settings.accent.custom")}
                  value={accent || "#cc4821"} // hk-izin: input type=color varsayılan hex
                  onChange={(e) => handleAccentSelect(e.target.value)}
                  style={{
                    position: "absolute",
                    opacity: 0,
                    width: "100%",
                    height: "100%",
                    cursor: "pointer",
                  }}
                />
                <span style={{ fontSize: "var(--hk-font-size-xs)", color: "var(--hk-text-muted)" }}>+</span>
              </label>
              <Button size="sm" kind="secondary" onClick={handleResetAccent}>
                {t("settings.accent.default")}
              </Button>
            </div>
            {aaAdjusted && (
              <span className={css.hint} style={{ color: "var(--hk-warning-text, var(--hk-text-secondary))" }}>
                {t("settings.accent.aaNote")}
              </span>
            )}
          </div>
        )}
      </Field>

      {/* Özel Arka Plan (Buzlu Cam) */}
      <Field label={t("settings.background")}>
        {() => (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--hk-space-4)" }}>
            {/* Hazır Preset Kartları */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--hk-space-1_5)" }}>
              <span style={{ fontSize: "var(--hk-font-size-sm)", fontWeight: "var(--hk-font-weight-semibold)", color: "var(--hk-text-secondary)" }}>
                {t("settings.background.presets")}
              </span>
              <div
                role="radiogroup"
                aria-label={t("settings.background.presets")}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                  gap: "var(--hk-space-2)",
                }}
              >
                {/* Yok / Sıfırla Seçeneği */}
                <button
                  type="button"
                  role="radio"
                  aria-checked={!bgConfig.image}
                  onClick={handleResetBackground}
                  style={{
                    cursor: "pointer",
                    border: !bgConfig.image ? "2px solid var(--hk-accent-base)" : "1px solid var(--hk-border-subtle)",
                    borderRadius: "var(--hk-radius-md)",
                    padding: "var(--hk-space-2)",
                    background: "var(--hk-bg-surface)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "var(--hk-space-1)",
                    minHeight: "72px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "40px",
                      borderRadius: "var(--hk-radius-sm)",
                      background: "var(--hk-bg-raised)",
                      border: "1px dashed var(--hk-border-subtle)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--hk-text-muted)",
                      fontSize: "var(--hk-font-size-xs)",
                    }}
                  >
                    ✕
                  </div>
                  <div style={{ fontWeight: "var(--hk-font-weight-medium)", fontSize: "var(--hk-font-size-xs)", color: "var(--hk-text-primary)" }}>
                    {t("settings.background.none")}
                  </div>
                </button>

                {/* Preset Kartları */}
                {BACKGROUND_PRESETS.map((p) => {
                  const isSelected = bgConfig.image === p.url;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => handlePresetSelect(p.url)}
                      style={{
                        cursor: "pointer",
                        border: isSelected ? "2px solid var(--hk-accent-base)" : "1px solid var(--hk-border-subtle)",
                        borderRadius: "var(--hk-radius-md)",
                        padding: "var(--hk-space-2)",
                        background: "var(--hk-bg-surface)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "var(--hk-space-1)",
                        minHeight: "72px",
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: "40px",
                          borderRadius: "var(--hk-radius-sm)",
                          backgroundImage: `url("${p.previewUrl}")`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                          border: "1px solid var(--hk-border-subtle)",
                        }}
                      />
                      <div style={{ fontWeight: "var(--hk-font-weight-medium)", fontSize: "var(--hk-font-size-xs)", color: "var(--hk-text-primary)" }}>
                        {p.name}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Özel URL / Dosya Yükleme */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--hk-space-1_5)" }}>
              <span style={{ fontSize: "var(--hk-font-size-sm)", fontWeight: "var(--hk-font-weight-semibold)", color: "var(--hk-text-secondary)" }}>
                {t("settings.background.customUrl")}
              </span>
              <div style={{ display: "flex", gap: "var(--hk-space-2)", flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <TextInput
                    value={customUrl}
                    placeholder={t("settings.background.customUrlPlaceholder")}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleApplyCustomUrl();
                      }
                    }}
                  />
                </div>
                <Button kind="secondary" onClick={handleApplyCustomUrl}>
                  {t("settings.background.apply")}
                </Button>
                <input
                  type="file"
                  ref={bgFileInputRef}
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => void handleUploadBgFile(e)}
                />
                <Button
                  kind="secondary"
                  busy={uploading}
                  onClick={() => bgFileInputRef.current?.click()}
                >
                  {uploading ? t("settings.background.uploading") : t("settings.background.upload")}
                </Button>
              </div>
            </div>

            {/* Bulanıklık (Blur) Kaydırıcısı */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--hk-space-1_5)" }}>
              <span style={{ fontSize: "var(--hk-font-size-sm)", fontWeight: "var(--hk-font-weight-semibold)", color: "var(--hk-text-secondary)" }}>
                {t("settings.background.blur", { n: bgConfig.blur })}
              </span>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={bgConfig.blur}
                onChange={(e) => handleBlurChange(Number(e.target.value))}
              />
            </div>

            {/* Karartma / Opaklık Kaydırıcısı (WCAG AA Korumalı) */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--hk-space-1_5)" }}>
              <span style={{ fontSize: "var(--hk-font-size-sm)", fontWeight: "var(--hk-font-weight-semibold)", color: "var(--hk-text-secondary)" }}>
                {t("settings.background.opacity", { n: bgConfig.opacity })}
              </span>
              <input
                type="range"
                min={40}
                max={95}
                step={1}
                value={bgConfig.opacity}
                onChange={(e) => handleOpacityChange(Number(e.target.value))}
              />
              <div style={{ display: "flex", alignItems: "center", gap: "var(--hk-space-2)", flexWrap: "wrap", marginTop: "var(--hk-space-0_5)" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--hk-space-1)",
                    fontSize: "var(--hk-font-size-xs)",
                    lineHeight: "var(--hk-font-line-height-xs)",
                    fontWeight: "var(--hk-font-weight-semibold)",
                    color: "var(--hk-success-text)",
                    backgroundColor: "var(--hk-success-subtle)",
                    borderRadius: "var(--hk-radius-full)",
                    padding: "var(--hk-space-0_5) var(--hk-space-2)",
                  }}
                >
                  ✓ {t("settings.background.wcagBadge")}
                </span>
                <span className={css.hint}>
                  {t("settings.background.wcagHint")}
                </span>
              </div>
            </div>

            {/* Canlı Mini Önizleme ve Sıfırlama Butonu */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--hk-space-2)" }}>
              <span style={{ fontSize: "var(--hk-font-size-sm)", fontWeight: "var(--hk-font-weight-semibold)", color: "var(--hk-text-secondary)" }}>
                {t("settings.background.preview")}
              </span>
              <div
                style={{
                  width: "100%",
                  height: "100px",
                  borderRadius: "var(--hk-radius-md)",
                  border: "1px solid var(--hk-border-subtle)",
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                }}
              >
                {bgConfig.image ? (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        backgroundImage: `url("${bgConfig.image}")`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        backdropFilter: `blur(${bgConfig.blur}px)`,
                        WebkitBackdropFilter: `blur(${bgConfig.blur}px)`,
                        backgroundColor: "var(--hk-bg-base)",
                        opacity: bgConfig.opacity / 100,
                      }}
                    />
                  </>
                ) : (
                  <div style={{ position: "absolute", inset: 0, backgroundColor: "var(--hk-bg-base)" }} />
                )}

                {/* Sahte Arayüz İskeleti */}
                <div
                  style={{
                    position: "relative",
                    zIndex: 1,
                    display: "flex",
                    width: "100%",
                    height: "100%",
                    padding: "var(--hk-space-2)",
                    gap: "var(--hk-space-2)",
                  }}
                >
                  <div
                    style={{
                      width: "24px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--hk-space-1)",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ width: "20px", height: "20px", borderRadius: "var(--hk-radius-full)", background: "var(--hk-accent-base)" }} />
                    <div style={{ width: "20px", height: "20px", borderRadius: "var(--hk-radius-full)", background: "var(--hk-bg-surface)", border: "1px solid var(--hk-border-subtle)" }} />
                  </div>

                  <div
                    style={{
                      width: "90px",
                      height: "100%",
                      borderRadius: "var(--hk-radius-sm)",
                      background: "color-mix(in srgb, var(--hk-bg-surface) 75%, transparent)",
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                      border: "1px solid var(--hk-border-subtle)",
                      padding: "var(--hk-space-1)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--hk-space-1)",
                    }}
                  >
                    <div style={{ width: "70%", height: "5px", background: "var(--hk-text-primary)", borderRadius: "2px", opacity: 0.8 }} />
                    <div style={{ width: "85%", height: "4px", background: "var(--hk-text-secondary)", borderRadius: "2px", opacity: 0.5 }} />
                    <div style={{ width: "60%", height: "4px", background: "var(--hk-text-secondary)", borderRadius: "2px", opacity: 0.5 }} />
                  </div>

                  <div
                    style={{
                      flex: 1,
                      height: "100%",
                      borderRadius: "var(--hk-radius-sm)",
                      background: "color-mix(in srgb, var(--hk-bg-content) 75%, transparent)",
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                      border: "1px solid var(--hk-border-subtle)",
                      padding: "var(--hk-space-1_5)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--hk-space-0_5)" }}>
                      <div style={{ fontSize: "var(--hk-font-size-xs)", fontWeight: "var(--hk-font-weight-bold)", color: "var(--hk-text-primary)" }}>
                        {brand.name}
                      </div>
                      <div style={{ fontSize: "var(--hk-font-size-xs)", color: "var(--hk-text-secondary)" }}>
                        {bgConfig.image ? t("settings.background.wcagBadge") : t("settings.background.none")}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "var(--hk-space-1)" }}>
                      <div style={{ width: "35%", height: "5px", background: "var(--hk-accent-base)", borderRadius: "2px" }} />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <Button size="sm" kind="secondary" disabled={!bgConfig.image} onClick={handleResetBackground}>
                  {t("settings.background.reset")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Field>

      {/* Mesaj Yoğunluğu */}
      <Field label={t("settings.density")}>
        {() => (
          <div role="radiogroup" aria-label={t("settings.density")} style={{ display: "flex", gap: "var(--hk-space-2)" }}>
            {(["cozy", "compact"] as const).map((v) => (
              <Button key={v} role="radio" aria-checked={s.message_density === v} kind={s.message_density === v ? "primary" : "secondary"} onClick={() => patch({ message_density: v })}>
                {t(v === "cozy" ? "settings.density.cozy" : "settings.density.compact")}
              </Button>
            ))}
          </div>
        )}
      </Field>

      {/* Yazı Boyutu */}
      <Field label={t("settings.fontScale", { n: Math.round(s.font_scale * 100) })}>
        {(p) => <input {...p} type="range" min={0.8} max={1.4} step={0.05} value={s.font_scale} onChange={(e) => patch({ font_scale: Number(e.target.value) })} />}
      </Field>

      {/* Geliştirici Modu */}
      <div className={css.row}>
        <div className={css.rowText}>
          <strong>{t("settings.dev")}</strong>
          <span className={css.hint}>{t("settings.dev.help")}</span>
        </div>
        <Switch label={t("settings.dev")} checked={s.developer_mode} onChange={(v) => patch({ developer_mode: v })} />
      </div>
    </>
  );
}
