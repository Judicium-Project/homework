import { useMemo, useState } from "react";
import { ChannelType, PERMISSIONS, type PermissionName } from "@chatapp/api-types";
import { api } from "../../api/endpoints.ts";
import { t, type TrKey } from "../../i18n/index.ts";
import { explainPermissions, parseBits, type PermSource } from "../../lib/perm.ts";
import { channelPermChannel, guildPermGuild, memberName } from "../../store/hooks.ts";
import { useStore } from "../../store/index.ts";
import { useUi } from "../../store/ui.ts";
import { Button } from "../../ui/Button.tsx";
import { Field, TextInput } from "../../ui/Form.tsx";
import { Modal } from "../../ui/Modal.tsx";
import { openMenuAt } from "../../ui/Menu.tsx";
import { Tabs } from "../../ui/Tabs.tsx";
import { errorText } from "../../ui/States.tsx";
import { toast } from "../../ui/Toast.tsx";
import { CHANNEL_PERMS, permDesc, permLabel } from "./permInfo.ts";
import gcss from "../guild/guild.module.css";
import css from "./settings.module.css";

type Tri = "allow" | "inherit" | "deny";

/** Üç konumlu anahtar: İzin ver / Devral / Yasakla (8.3). */
export function TriSwitch({ value, onChange, label }: { value: Tri; onChange(v: Tri): void; label: string }) {
  const opts: [Tri, TrKey][] = [["allow", "perm.tri.allow"], ["inherit", "perm.tri.inherit"], ["deny", "perm.tri.deny"]];
  return (
    <div className={css.tri} role="radiogroup" aria-label={label}>
      {opts.map(([v, k]) => (
        <button key={v} type="button" role="radio" data-v={v} aria-checked={value === v} onClick={() => onChange(v)}>{t(k)}</button>
      ))}
    </div>
  );
}

export function sourceText(s: PermSource, roleName: (id: string) => string): string {
  switch (s.kind) {
    case "owner": return t("perm.src.owner");
    case "administrator": return t("perm.src.admin", { role: roleName(s.roleId) });
    case "role": return t("perm.src.role", { role: roleName(s.roleId) });
    case "everyone": return t("perm.src.everyone");
    case "overwrite": return t(s.effect === "allow" ? "perm.src.owAllow" : "perm.src.owDeny", { who: s.target === "member" ? t("perm.src.member") : roleName(s.id) });
    case "implicit": return t(s.rule === "view" ? "perm.src.implView" : s.rule === "send" ? "perm.src.implSend" : "perm.src.implConnect");
    default: return t("perm.src.none");
  }
}

export function ChannelSettingsModal({ guildId, channelId, tab: initial }: { guildId: string; channelId: string; tab?: "genel" | "izinler" }) {
  const close = useUi((s) => s.closeModal);
  const g = useStore((s) => s.guilds[guildId]);
  const ch = g?.channels[channelId];
  const [tab, setTab] = useState<"genel" | "izinler">(initial ?? "genel");
  if (!g || !ch) return null;
  return (
    <Modal title={t("channel.settings.title", { name: ch.name })} size="lg" onClose={close}>
      <Tabs label={t("channel.settings")} value={tab} onChange={setTab} items={[{ id: "genel", label: t("channel.tab.general") }, { id: "izinler", label: t("channel.tab.perms") }]} />
      {tab === "genel" ? <General guildId={guildId} channelId={channelId} /> : <Permissions guildId={guildId} channelId={channelId} />}
    </Modal>
  );
}

function General({ guildId, channelId }: { guildId: string; channelId: string }) {
  const g = useStore((s) => s.guilds[guildId]);
  const ch = g?.channels[channelId];
  const [name, setName] = useState(ch?.name ?? "");
  const [topic, setTopic] = useState(ch?.topic ?? "");
  const [bitrate, setBitrate] = useState(Math.round((ch?.bitrate ?? 64000) / 1000));
  const [limit, setLimit] = useState(ch?.user_limit ?? 0);
  const [parent, setParent] = useState(ch?.parent_id ?? "");
  const [busy, setBusy] = useState(false);
  if (!g || !ch) return null;
  const voice = ch.type === ChannelType.GUILD_VOICE;
  const cat = ch.type === ChannelType.GUILD_CATEGORY;
  const cats = Object.values(g.channels).filter((c) => c.type === ChannelType.GUILD_CATEGORY);
  const save = async () => {
    setBusy(true);
    try {
      await api.updateChannel(channelId, { name: name.trim(), ...(cat ? {} : { parent_id: parent || null }), ...(ch.type === ChannelType.GUILD_TEXT ? { topic: topic.trim() || null } : {}), ...(voice ? { bitrate: bitrate * 1000, user_limit: limit } : {}) });
      toast.success(t("settings.saved"));
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className={css.form}>
      <Field label={t("channel.name")}>{(p) => <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      {ch.type === ChannelType.GUILD_TEXT && <Field label={t("channel.topic")}>{(p) => <TextInput {...p} value={topic} maxLength={1024} onChange={(e) => setTopic(e.target.value)} />}</Field>}
      {voice && (
        <div className={gcss.selectRow}>
          <Field label={t("channel.bitrate")}>{(p) => <TextInput {...p} type="number" min={8} max={384} value={bitrate} onChange={(e) => setBitrate(Number(e.target.value))} />}</Field>
          <Field label={t("channel.limit")} help={t("channel.limit.help")}>{(p) => <TextInput {...p} type="number" min={0} max={99} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />}</Field>
        </div>
      )}
      {!cat && (
        <Field label={t("channel.category")}>
          {(p) => <select {...p} className={gcss.select} value={parent} onChange={(e) => setParent(e.target.value)}><option value="">{t("channel.noCategory")}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        </Field>
      )}
      <div><Button kind="primary" busy={busy} disabled={!name.trim()} onClick={() => void save()}>{t("common.save")}</Button></div>
    </div>
  );
}

function Permissions({ guildId, channelId }: { guildId: string; channelId: string }) {
  const g = useStore((s) => s.guilds[guildId]);
  const ch = g?.channels[channelId];
  const [sel, setSel] = useState<string | null>(null);
  const [previewUser, setPreviewUser] = useState("");
  const roleName = (id: string) => g?.roles[id]?.name ?? id;
  const owList = ch?.permission_overwrites ?? [];
  const cur = owList.find((o) => o.id === sel) ?? owList[0];
  const selId = cur?.id ?? null;

  const preview = useMemo(() => {
    if (!g || !ch || !previewUser) return null;
    const m = g.members[previewUser];
    if (!m) return null;
    return explainPermissions(guildPermGuild(g), { userId: previewUser, roleIds: m.roles }, channelPermChannel(ch));
  }, [g, ch, previewUser]);

  if (!g || !ch) return null;
  const nameOf = (id: string, type: number) => (type === 0 ? roleName(id) : g.members[id] ? memberName(g.members[id].user, g.members[id]) : id);

  const setPerm = async (name: PermissionName, v: Tri) => {
    if (!cur) return;
    let allow = parseBits(cur.allow);
    let deny = parseBits(cur.deny);
    const bit = PERMISSIONS[name];
    allow &= ~bit; deny &= ~bit;
    if (v === "allow") allow |= bit;
    if (v === "deny") deny |= bit;
    try {
      await api.putOverwrite(channelId, cur.id, { type: cur.type, allow: allow.toString(), deny: deny.toString() });
    } catch (e) { toast.error(errorText(e)); }
  };
  const addMenu = (el: HTMLElement) => {
    const have = new Set(owList.map((o) => o.id));
    openMenuAt(el, [
      ...Object.values(g.roles).filter((r) => !have.has(r.id)).map((r) => ({ label: r.name, onSelect: () => void api.putOverwrite(channelId, r.id, { type: 0, allow: "0", deny: "0" }).then(() => setSel(r.id)).catch((e) => toast.error(errorText(e))) })),
      ...Object.values(g.members).filter((m) => !have.has(m.user.id)).slice(0, 15).map((m) => ({ label: `@${memberName(m.user, m)}`, onSelect: () => void api.putOverwrite(channelId, m.user.id, { type: 1, allow: "0", deny: "0" }).then(() => setSel(m.user.id)).catch((e) => toast.error(errorText(e))) })),
    ]);
  };
  const triOf = (name: PermissionName): Tri => {
    if (!cur) return "inherit";
    const bit = PERMISSIONS[name];
    return (parseBits(cur.allow) & bit) !== 0n ? "allow" : (parseBits(cur.deny) & bit) !== 0n ? "deny" : "inherit";
  };
  const synced = ch.parent_id ? JSON.stringify(g.channels[ch.parent_id]?.permission_overwrites.map((o) => [o.id, o.allow, o.deny]).sort()) === JSON.stringify(owList.map((o) => [o.id, o.allow, o.deny]).sort()) : null;

  return (
    <div className={css.form}>
      {ch.parent_id && (
        <div className={css.row}>
          <span>{synced ? t("perm.synced") : t("perm.notSynced")}</span>
          <Button size="sm" disabled={!!synced} onClick={() => void api.updateChannel(channelId, { lock_permissions: true }).catch((e) => toast.error(errorText(e)))}>{t("perm.sync")}</Button>
        </div>
      )}
      <div className={css.split}>
        <div className={css.list} role="listbox" aria-label={t("perm.overwrites")}>
          {owList.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={o.id === selId} className={css.navItem} aria-current={o.id === selId} onClick={() => setSel(o.id)}>{nameOf(o.id, o.type)}</button>
          ))}
          <Button size="sm" aria-haspopup="menu" onClick={(e) => addMenu(e.currentTarget)}>{t("perm.add")}</Button>
        </div>
        <div>
          {!cur ? <p className={css.hint}>{t("perm.none")}</p> : (
            <>
              <Button size="sm" kind="ghost" onClick={() => void api.deleteOverwrite(channelId, cur.id).catch((e) => toast.error(errorText(e)))}>{t("perm.remove")}</Button>
              {CHANNEL_PERMS.filter((p) => ch.type === ChannelType.GUILD_VOICE ? !["SEND_MESSAGES", "ATTACH_FILES", "EMBED_LINKS", "READ_MESSAGE_HISTORY", "MENTION_EVERYONE", "USE_EXTERNAL_EMOJIS", "MANAGE_MESSAGES", "ADD_REACTIONS"].includes(p) : !["CONNECT", "SPEAK", "STREAM", "USE_VAD", "PRIORITY_SPEAKER", "MUTE_MEMBERS", "DEAFEN_MEMBERS", "MOVE_MEMBERS"].includes(p)).map((p) => (
                <div key={p} className={css.row}>
                  <div className={css.rowText}><strong>{t(permLabel(p))}</strong><span className={css.hint}>{t(permDesc(p))}</span></div>
                  <TriSwitch value={triOf(p)} label={t(permLabel(p))} onChange={(v) => void setPerm(p, v)} />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <div className={css.preview}>
        <strong>{t("perm.preview.title")}</strong>
        <select className={gcss.select} aria-label={t("perm.preview.pick")} value={previewUser} onChange={(e) => setPreviewUser(e.target.value)}>
          <option value="">{t("perm.preview.pick")}</option>
          {Object.values(g.members).map((m) => <option key={m.user.id} value={m.user.id}>{memberName(m.user, m)}</option>)}
        </select>
        {preview && CHANNEL_PERMS.map((p) => {
          const yes = (preview.permissions & PERMISSIONS[p]) !== 0n;
          return (
            <div key={p} className={css.row} data-testid={`prev-${p}`}>
              <span>{t(permLabel(p))}</span>
              <span><strong className={yes ? css.yes : css.no}>{yes ? t("perm.yes") : t("perm.no")}</strong> <span className={css.srcTag}>{sourceText(preview.sources[p], roleName)}</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
