import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PERMISSIONS, type AuditLogEntry, type Role } from "@chatapp/api-types";
import { api } from "../../api/endpoints.ts";
import { t, type TrKey } from "../../i18n/index.ts";
import { cssColorVar, intToHex } from "../../lib/color.ts";
import { has, highestPosition, parseBits } from "../../lib/perm.ts";
import { fmtAge, fmtDate, fmtFull, fmtRemaining } from "../../lib/time.ts";
import { memberName, permissionsIn } from "../../store/hooks.ts";
import { onDispatch } from "../../store/events.ts";
import { useStore } from "../../store/index.ts";
import { useUi } from "../../store/ui.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { Checkbox, Field, Switch, TextInput } from "../../ui/Form.tsx";
import { ConfirmModal } from "../../ui/Modal.tsx";
import { openMenuAt } from "../../ui/Menu.tsx";
import { Empty, ErrorCard, SkeletonRows, errorText } from "../../ui/States.tsx";
import { Tabs } from "../../ui/Tabs.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Users } from "lucide-react";
import { SettingsLayer } from "./Layer.tsx";
import { TriSwitch } from "./ChannelSettings.tsx";
import { PERM_GROUPS, permDesc, permLabel } from "./permInfo.ts";
import css from "./settings.module.css";
import gcss from "../guild/guild.module.css";

type Sec = "genel" | "roller" | "uyeler" | "davetler" | "yasaklar" | "denetim";

export default function GuildSettings({ guildId, section, onClose }: { guildId: string; section: string; onClose(): void }) {
  const g = useStore((s) => s.guilds[guildId]);
  const perms = useStore((s) => permissionsIn(s, guildId, s.me?.id));
  const owner = useStore((s) => s.guilds[guildId]?.ownerId === s.me?.id);
  const entries: { id: Sec; label: TrKey; ok: boolean }[] = [
    { id: "genel", label: "gs.general", ok: owner || has(perms, PERMISSIONS.MANAGE_GUILD) },
    { id: "roller", label: "gs.roles", ok: owner || has(perms, PERMISSIONS.MANAGE_ROLES) },
    { id: "uyeler", label: "gs.members", ok: owner || has(perms, PERMISSIONS.KICK_MEMBERS | 0n) || has(perms, PERMISSIONS.MANAGE_ROLES) || has(perms, PERMISSIONS.BAN_MEMBERS) },
    { id: "davetler", label: "gs.invites", ok: owner || has(perms, PERMISSIONS.MANAGE_GUILD) },
    { id: "yasaklar", label: "gs.bans", ok: owner || has(perms, PERMISSIONS.BAN_MEMBERS) },
    { id: "denetim", label: "gs.audit", ok: owner || has(perms, PERMISSIONS.VIEW_AUDIT_LOG) },
  ];
  const allowed = entries.filter((e) => e.ok);
  const [sec, setSec] = useState<Sec>((allowed.find((e) => e.id === section) ?? allowed[0])?.id ?? "genel");
  if (!g || allowed.length === 0) return null;
  return (
    <SettingsLayer title={g.name} active={sec} onSelect={(id) => setSec(id as Sec)} onClose={onClose} nav={allowed.map((e) => ({ id: e.id, label: t(e.label) }))}>
      {sec === "genel" && <General guildId={guildId} onClose={onClose} />}
      {sec === "roller" && <Roles guildId={guildId} />}
      {sec === "uyeler" && <Members guildId={guildId} />}
      {sec === "davetler" && <Invites guildId={guildId} />}
      {sec === "yasaklar" && <Bans guildId={guildId} />}
      {sec === "denetim" && <Audit guildId={guildId} />}
    </SettingsLayer>
  );
}

/** Gateway olayı gelince sorguyu tazeler (canlı listeler). */
function useLiveInvalidate(key: unknown[], events: Parameters<typeof onDispatch>[0][]) {
  const qc = useQueryClient();
  useEffect(() => {
    const offs = events.map((e) => onDispatch(e, () => void qc.invalidateQueries({ queryKey: key })));
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, JSON.stringify(key)]);
}

// ───────────── 8.1 Genel ─────────────
function General({ guildId, onClose }: { guildId: string; onClose(): void }) {
  const g = useStore((s) => s.guilds[guildId]);
  const meId = useStore((s) => s.me?.id);
  const nav = useNavigate();
  const [name, setName] = useState(g?.name ?? "");
  const [sys, setSys] = useState(g?.systemChannelId ?? "");
  const [notif, setNotif] = useState<0 | 1>(g?.defaultNotifications ?? 0);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const [delName, setDelName] = useState("");
  const [transfer, setTransfer] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  if (!g) return null;
  const owner = g.ownerId === meId;
  const dirty = name !== g.name || sys !== (g.systemChannelId ?? "") || notif !== g.defaultNotifications;
  const texts = Object.values(g.channels).filter((c) => c.type === 0);
  const save = async () => {
    setBusy(true);
    try {
      await api.updateGuild(guildId, { name: name.trim(), system_channel_id: sys || null, default_message_notifications: notif });
      toast.success(t("settings.saved"));
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <h2 className={css.h}>{t("gs.general")}</h2>
      <div className={css.form}>
        <Field label={t("guild.create.name")}>{(p) => <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t("gs.systemChannel")}>
          {(p) => <select {...p} className={gcss.select} value={sys} onChange={(e) => setSys(e.target.value)}><option value="">{t("gs.none")}</option>{texts.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select>}
        </Field>
        <Field label={t("gs.defaultNotif")}>
          {(p) => <select {...p} className={gcss.select} value={notif} onChange={(e) => setNotif(Number(e.target.value) as 0 | 1)}><option value={0}>{t("gs.notif.all")}</option><option value={1}>{t("gs.notif.mentions")}</option></select>}
        </Field>
        <div><Button kind="primary" busy={busy} disabled={!dirty || !name.trim()} onClick={() => void save()}>{t("common.save")}</Button></div>
      </div>
      {owner && (
        <div className={css.danger}>
          <h3>{t("gs.danger")}</h3>
          <div style={{ display: "flex", gap: "var(--hk-space-2)" }}>
            <Button onClick={() => setTransfer(true)}>{t("gs.transfer")}</Button>
            <Button kind="danger" onClick={() => setDel(true)}>{t("gs.delete")}</Button>
          </div>
        </div>
      )}
      {del && (
        <ConfirmModal title={t("gs.delete")} description={t("gs.delete.desc", { name: g.name })} confirmLabel={t("gs.delete")} danger onClose={() => setDel(false)}
          onConfirm={() => {
            if (delName !== g.name) return toast.error(t("gs.delete.mismatch"));
            api.deleteGuild(guildId).then(() => { onClose(); nav("/ana"); }, (e) => toast.error(errorText(e)));
          }}>
          <TextInput aria-label={t("gs.delete.type")} placeholder={g.name} value={delName} onChange={(e) => setDelName(e.target.value)} data-autofocus />
        </ConfirmModal>
      )}
      {transfer && (
        <ConfirmModal title={t("gs.transfer")} description={t("gs.transfer.desc")} confirmLabel={t("gs.transfer")} danger onClose={() => setTransfer(false)}
          onConfirm={() => {
            if (!newOwner) return;
            api.transferOwnership(guildId, { new_owner_id: newOwner }).then(() => { toast.success(t("settings.saved")); setTransfer(false); }, (e) => toast.error(errorText(e)));
          }}>
          <select className={gcss.select} aria-label={t("gs.transfer.pick")} value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
            <option value="">{t("gs.transfer.pick")}</option>
            {Object.values(g.members).filter((m) => m.user.id !== meId).map((m) => <option key={m.user.id} value={m.user.id}>{memberName(m.user, m)}</option>)}
          </select>
        </ConfirmModal>
      )}
    </>
  );
}

// ───────────── 8.2 Roller ─────────────
function Roles({ guildId }: { guildId: string }) {
  const g = useStore((s) => s.guilds[guildId]);
  const meId = useStore((s) => s.me?.id);
  const [selId, setSelId] = useState<string | null>(null);
  const [tab, setTab] = useState<"gorunum" | "izinler" | "uyeler">("gorunum");
  const counts = useQuery({ queryKey: ["role-counts", guildId], queryFn: () => api.roleMemberCounts(guildId) });
  useLiveInvalidate(["role-counts", guildId], ["GUILD_MEMBER_UPDATE", "GUILD_MEMBER_ADD", "GUILD_MEMBER_REMOVE"]);
  const roles = useMemo(() => Object.values(g?.roles ?? {}).sort((a, b) => b.position - a.position), [g?.roles]);
  if (!g || !meId) return null;
  const myTop = highestPosition({ ownerId: g.ownerId, roles: g.roles }, meId, g.members[meId]?.roles ?? []);
  // Seçim yoksa ilk özel rol; özel rol yoksa @everyone seçilir.
  const sel = g.roles[selId ?? ""] ?? roles.find((r) => r.id !== g.id) ?? roles[0];
  const editable = (r: Role) => meId === g.ownerId || r.id === g.id || r.position < myTop;
  const isEveryone = sel?.id === g.id;
  const activeTab = isEveryone ? "izinler" : tab;

  return (
    <>
      <h2 className={css.h}>{t("gs.roles")}</h2>
      <div className={css.split}>
        <div className={css.list}>
          <Button size="sm" kind="primary" onClick={() => void api.createRole(guildId, { name: t("gs.role.new"), permissions: "0", color: 0, hoist: false, mentionable: false }).then((r) => setSelId(r.id)).catch((e) => toast.error(errorText(e)))}>{t("gs.role.create")}</Button>
          {roles.map((r, i) => (
            <div key={r.id} style={{ display: "flex", gap: "var(--hk-space-1)", alignItems: "center" }}>
              <button type="button" className={css.navItem} aria-current={sel?.id === r.id} onClick={() => setSelId(r.id)} style={{ flex: 1 }}>
                <span style={{ flex: 1, textAlign: "left" }}>{r.name}</span><span className={css.hint}>{counts.data?.[r.id] ?? ""}</span>
              </button>
              {r.id !== g.id && editable(r) && (
                <>
                  <Button size="sm" kind="ghost" aria-label={t("gs.role.up", { name: r.name })} disabled={i === 0 || !editable(roles[i - 1]) || roles[i - 1]?.id === g.id} onClick={() => swap(guildId, roles, i, i - 1)}>↑</Button>
                  <Button size="sm" kind="ghost" aria-label={t("gs.role.down", { name: r.name })} disabled={i >= roles.length - 1 || roles[i + 1]?.id === g.id || !editable(roles[i + 1])} onClick={() => swap(guildId, roles, i, i + 1)}>↓</Button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className={css.form}>
          {!sel && <Empty icon={Users} text={t("gs.role.onlyEveryone")} />}
          {sel && (
            <>
              <Tabs
                label={t("gs.roles")}
                value={activeTab}
                onChange={setTab}
                items={isEveryone ? [{ id: "izinler", label: t("gs.role.tab.perms") }] : [{ id: "gorunum", label: t("gs.role.tab.look") }, { id: "izinler", label: t("gs.role.tab.perms") }, { id: "uyeler" as const, label: t("gs.role.tab.members") }]}
              />
              {!editable(sel) && <p className={css.hint} role="note">{t("gs.role.locked")}</p>}
              {activeTab === "gorunum" && !isEveryone && <RoleLook key={sel.id} guildId={guildId} role={sel} disabled={!editable(sel)} onDelete={() => setSelId(null)} />}
              {activeTab === "izinler" && <RolePerms key={sel.id + "p"} guildId={guildId} role={sel} disabled={!editable(sel)} />}
              {activeTab === "uyeler" && !isEveryone && <RoleMembers guildId={guildId} role={sel} disabled={!editable(sel)} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function swap(guildId: string, roles: Role[], i: number, j: number) {
  const a = roles[i], b = roles[j];
  if (!a || !b || a.id === b.id || a.position === b.position) return;
  void api.reorderRoles(guildId, [{ id: a.id, position: b.position }, { id: b.id, position: a.position }]).catch((e) => toast.error(errorText(e)));
}

function RoleLook({ guildId, role, disabled, onDelete }: { guildId: string; role: Role; disabled: boolean; onDelete?: () => void }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [hoist, setHoist] = useState(role.hoist);
  const [ment, setMent] = useState(role.mentionable);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const dirty = name !== role.name || color !== role.color || hoist !== role.hoist || ment !== role.mentionable;
  const reset = () => { setName(role.name); setColor(role.color); setHoist(role.hoist); setMent(role.mentionable); };
  return (
    <>
      <Field label={t("gs.role.name")}>{(p) => <TextInput {...p} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label={t("gs.role.color")} help={color === 0 ? t("gs.role.colorDefault") : undefined}>
        {(p) => (
          <div className={css.swatchRow}>
            {/* 0 = renksiz rol: seçici siyah değil, adın gerçekte görüneceği varsayılan metin rengini gösterir. */}
            <input {...p} type="color" className={css.swatch} disabled={disabled} value={color === 0 ? cssColorVar("--hk-text-primary") : intToHex(color)} onChange={(e) => setColor(parseInt(e.target.value.slice(1), 16))} />
            {color !== 0 && !disabled && <Button size="sm" kind="ghost" onClick={() => setColor(0)}>{t("gs.role.colorReset")}</Button>}
          </div>
        )}
      </Field>
      <div className={css.row}><span>{t("gs.role.hoist")}</span><Switch label={t("gs.role.hoist")} checked={hoist} disabled={disabled} onChange={setHoist} /></div>
      <div className={css.row}><span>{t("gs.role.mentionable")}</span><Switch label={t("gs.role.mentionable")} checked={ment} disabled={disabled} onChange={setMent} /></div>
      <div style={{ display: "flex", gap: "var(--hk-space-2)" }}>
        <Button kind="primary" busy={busy} disabled={!dirty || disabled} onClick={async () => {
          setBusy(true);
          try { await api.updateRole(guildId, role.id, { name: name.trim(), color, hoist, mentionable: ment }); toast.success(t("settings.saved")); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
        }}>{t("common.save")}</Button>
        <Button disabled={!dirty} onClick={reset}>{t("settings.reset")}</Button>
        <Button kind="danger" disabled={disabled} onClick={() => setDel(true)}>{t("common.delete")}</Button>
      </div>
      {del && <ConfirmModal title={t("gs.role.delete", { name: role.name })} confirmLabel={t("common.delete")} danger onClose={() => setDel(false)} onConfirm={() => { setDel(false); api.deleteRole(guildId, role.id).then(() => onDelete?.()).catch((e) => toast.error(errorText(e))); }} />}
    </>
  );
}

function RolePerms({ guildId, role, disabled }: { guildId: string; role: Role; disabled: boolean }) {
  const [bits, setBits] = useState(parseBits(role.permissions));
  const [warnAdmin, setWarnAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = bits !== parseBits(role.permissions);
  const toggle = (name: keyof typeof PERMISSIONS, on: boolean) => {
    const b = PERMISSIONS[name];
    if (name === "ADMINISTRATOR" && on) return setWarnAdmin(true);
    setBits(on ? bits | b : bits & ~b);
  };
  return (
    <>
      {PERM_GROUPS.map((grp) => (
        <div key={grp.title} className={css.permGroup}>
          <h4>{t(grp.title)}</h4>
          {grp.perms.map((p) => (
            <div key={p} className={css.row}>
              <div className={css.rowText}><strong>{t(permLabel(p))}</strong><span className={css.hint}>{t(permDesc(p))}</span></div>
              <Switch label={t(permLabel(p))} checked={(bits & PERMISSIONS[p]) !== 0n} disabled={disabled} onChange={(v) => toggle(p, v)} />
            </div>
          ))}
        </div>
      ))}
      <div style={{ display: "flex", gap: "var(--hk-space-2)" }}>
        <Button kind="primary" busy={busy} disabled={!dirty || disabled} onClick={async () => {
          setBusy(true);
          try { await api.updateRole(guildId, role.id, { permissions: bits.toString() }); toast.success(t("settings.saved")); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
        }}>{t("common.save")}</Button>
        <Button disabled={!dirty} onClick={() => setBits(parseBits(role.permissions))}>{t("settings.reset")}</Button>
      </div>
      {warnAdmin && <ConfirmModal title={t("gs.role.adminWarn.title")} description={t("gs.role.adminWarn.desc")} confirmLabel={t("gs.role.adminWarn.ok")} danger onClose={() => setWarnAdmin(false)} onConfirm={() => { setBits(bits | PERMISSIONS.ADMINISTRATOR); setWarnAdmin(false); }} />}
    </>
  );
}

function RoleMembers({ guildId, role, disabled }: { guildId: string; role: Role; disabled: boolean }) {
  const g = useStore((s) => s.guilds[guildId]);
  const [q, setQ] = useState("");
  if (!g) return null;
  const members = Object.values(g.members);
  const inRole = members.filter((m) => m.roles.includes(role.id));
  const cand = q.trim() ? members.filter((m) => !m.roles.includes(role.id) && memberName(m.user, m).toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"))).slice(0, 6) : [];
  return (
    <>
      {!disabled && <Field label={t("gs.role.addMember")}>{(p) => <TextInput {...p} value={q} onChange={(e) => setQ(e.target.value)} />}</Field>}
      {cand.map((m) => <div key={m.user.id} className={css.row}><span>{memberName(m.user, m)}</span><Button size="sm" onClick={() => void api.addMemberRole(guildId, m.user.id, role.id).then(() => setQ("")).catch((e) => toast.error(errorText(e)))}>{t("gs.role.add")}</Button></div>)}
      {inRole.length === 0 && <p className={css.hint}>{t("gs.role.noMembers")}</p>}
      {inRole.map((m) => <div key={m.user.id} className={css.row}><span>{memberName(m.user, m)}</span>{!disabled && <Button size="sm" kind="ghost" onClick={() => void api.removeMemberRole(guildId, m.user.id, role.id).catch((e) => toast.error(errorText(e)))}>{t("gs.role.remove")}</Button>}</div>)}
    </>
  );
}

// ───────────── 8.4 Üyeler ─────────────
function Members({ guildId }: { guildId: string }) {
  const g = useStore((s) => s.guilds[guildId]);
  const openModal = useUi((s) => s.openModal);
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("");
  const [limit, setLimit] = useState(50);
  if (!g) return null;
  const list = Object.values(g.members)
    .filter((m) => (!roleF || m.roles.includes(roleF)) && (!q.trim() || memberName(m.user, m).toLocaleLowerCase("tr").includes(q.trim().toLocaleLowerCase("tr"))))
    .sort((a, b) => memberName(a.user, a).localeCompare(memberName(b.user, b), "tr"));
  return (
    <>
      <h2 className={css.h}>{t("gs.members")}</h2>
      <div style={{ display: "flex", gap: "var(--hk-space-2)" }}>
        <TextInput aria-label={t("gs.members.search")} placeholder={t("gs.members.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={gcss.select} aria-label={t("gs.members.filter")} value={roleF} onChange={(e) => setRoleF(e.target.value)}>
          <option value="">{t("gs.members.allRoles")}</option>
          {Object.values(g.roles).filter((r) => r.id !== g.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      <table className={css.table}>
        <thead><tr><th>{t("gs.members.col.name")}</th><th>{t("gs.members.col.joined")}</th><th>{t("gs.members.col.age")}</th><th>{t("gs.members.col.roles")}</th><th /></tr></thead>
        <tbody>
          {list.slice(0, limit).map((m) => (
            <tr key={m.user.id}>
              <td><span className={css.who}><Avatar name={memberName(m.user, m)} avatarId={m.user.avatar_id} size="sm" bg="bg-content" />{memberName(m.user, m)}</span></td>
              <td className="tabular">{fmtDate(m.joined_at)}</td>
              <td>{fmtAge(m.joined_at)}</td>
              <td>{m.roles.map((r) => g.roles[r]?.name).filter(Boolean).join(", ")}</td>
              <td><Button size="sm" kind="ghost" aria-label={t("gs.members.actions", { name: memberName(m.user, m) })} aria-haspopup="menu" onClick={(e) => openMenuAt(e.currentTarget, [
                { label: t("profile.assignRole"), onSelect: () => openModal({ kind: "profile", guildId, userId: m.user.id }) },
                { label: t("mod.kick.confirm"), danger: true, onSelect: () => openModal({ kind: "moderate", guildId, userId: m.user.id, mode: "kick" }) },
                { label: t("mod.ban.confirm"), danger: true, onSelect: () => openModal({ kind: "moderate", guildId, userId: m.user.id, mode: "ban" }) },
              ], "end")}>…</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > limit && <Button onClick={() => setLimit(limit + 50)}>{t("gs.more")}</Button>}
    </>
  );
}

// ───────────── 8.5 Davetler ─────────────
function Invites({ guildId }: { guildId: string }) {
  const q = useQuery({ queryKey: ["invites", guildId], queryFn: () => api.guildInvites(guildId) });
  const qc = useQueryClient();
  if (q.isPending) return <SkeletonRows rows={4} />;
  if (q.isError) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <>
      <h2 className={css.h}>{t("gs.invites")}</h2>
      {q.data.length === 0 ? <Empty icon={Users} text={t("gs.invites.none")} /> : (
        <table className={css.table}>
          <thead><tr><th>{t("gs.invites.code")}</th><th>{t("gs.invites.by")}</th><th>{t("gs.invites.uses")}</th><th>{t("gs.invites.left")}</th><th /></tr></thead>
          <tbody>{q.data.map((i) => (
            <tr key={i.code}>
              <td className={gcss.mono}>{i.code}</td><td>{i.inviter?.display_name || i.inviter?.username}</td>
              <td className="tabular">{i.uses}/{i.max_uses || "∞"}</td><td>{fmtRemaining(i.expires_at)}</td>
              <td><Button size="sm" kind="ghost" aria-label={t("gs.invites.revoke", { code: i.code })} onClick={() => api.deleteInvite(i.code).then(() => qc.invalidateQueries({ queryKey: ["invites", guildId] }), (e) => toast.error(errorText(e)))}>×</Button></td>
            </tr>))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ───────────── 8.6 Yasaklar ─────────────
function Bans({ guildId }: { guildId: string }) {
  const q = useQuery({ queryKey: ["bans", guildId], queryFn: () => api.bans(guildId) });
  useLiveInvalidate(["bans", guildId], ["GUILD_BAN_ADD", "GUILD_BAN_REMOVE"]);
  const qc = useQueryClient();
  const [s, setS] = useState("");
  if (q.isPending) return <SkeletonRows rows={4} />;
  if (q.isError) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data.filter((b) => !s.trim() || (b.user.display_name ?? b.user.username).toLocaleLowerCase("tr").includes(s.toLocaleLowerCase("tr")) || b.user.username.includes(s.toLocaleLowerCase("tr")));
  return (
    <>
      <h2 className={css.h}>{t("gs.bans")}</h2>
      <TextInput aria-label={t("gs.bans.search")} placeholder={t("gs.bans.search")} value={s} onChange={(e) => setS(e.target.value)} />
      {list.length === 0 ? <Empty icon={Users} text={t("gs.bans.none")} /> : list.map((b) => (
        <div key={b.user.id} className={css.row}>
          <span className={css.who}><Avatar name={b.user.display_name || b.user.username} avatarId={b.user.avatar_id} size="sm" bg="bg-content" />{b.user.display_name || b.user.username}<span className={css.hint}>{b.reason ?? t("gs.bans.noReason")}</span></span>
          <Button size="sm" onClick={() => api.unban(guildId, b.user.id).then(() => { toast.success(t("gs.bans.lifted")); return qc.invalidateQueries({ queryKey: ["bans", guildId] }); }, (e) => toast.error(errorText(e)))}>{t("gs.bans.lift")}</Button>
        </div>
      ))}
    </>
  );
}

// ───────────── 8.7 Denetim kaydı ─────────────
const ACTION_KEYS: Record<number, TrKey> = {
  1: "audit.1", 10: "audit.10", 11: "audit.11", 12: "audit.12", 13: "audit.13", 14: "audit.14", 15: "audit.15", 20: "audit.20", 22: "audit.22", 23: "audit.23", 24: "audit.24", 25: "audit.25",
  26: "audit.26", 27: "audit.27", 30: "audit.30", 31: "audit.31", 32: "audit.32", 40: "audit.40", 42: "audit.42", 72: "audit.72", 73: "audit.73",
};

function Audit({ guildId }: { guildId: string }) {
  const [user, setUser] = useState("");
  const [action, setAction] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const key = ["audit", guildId, user, action];
  const q = useQuery({ queryKey: key, queryFn: () => api.auditLogs(guildId, { user_id: user || undefined, action_type: action ? (Number(action) as never) : undefined, limit: 50 }) });
  const g = useStore((s) => s.guilds[guildId]);
  if (!g) return null;
  const users = new Map((q.data?.users ?? []).map((u) => [u.id, u]));
  const who = (id: string | null) => (id ? (users.get(id)?.display_name || users.get(id)?.username || g.members[id]?.user.username || id) : t("audit.system"));
  return (
    <>
      <h2 className={css.h}>{t("gs.audit")}</h2>
      <div style={{ display: "flex", gap: "var(--hk-space-2)" }}>
        <select className={gcss.select} aria-label={t("audit.filter.user")} value={user} onChange={(e) => setUser(e.target.value)}><option value="">{t("audit.allUsers")}</option>{Object.values(g.members).map((m) => <option key={m.user.id} value={m.user.id}>{memberName(m.user, m)}</option>)}</select>
        <select className={gcss.select} aria-label={t("audit.filter.action")} value={action} onChange={(e) => setAction(e.target.value)}><option value="">{t("audit.allActions")}</option>{Object.entries(ACTION_KEYS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
      </div>
      {q.isPending ? <SkeletonRows rows={5} /> : q.isError ? <ErrorCard error={q.error} onRetry={() => void q.refetch()} /> : q.data.audit_log_entries.length === 0 ? <Empty icon={Users} text={t("audit.none")} /> :
        q.data.audit_log_entries.map((e: AuditLogEntry) => (
          <button key={e.id} type="button" className={css.audit} aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
            <span><strong>{who(e.user_id)}</strong> · {t(ACTION_KEYS[e.action_type] ?? "audit.unknown")}{e.target_id && users.get(e.target_id) ? ` · ${who(e.target_id)}` : ""}</span>
            <span className={css.hint}>{fmtFull(new Date(Number((BigInt(e.id) >> 22n) + 1_735_689_600_000n)).toISOString())}{e.reason ? ` · ${e.reason}` : ""}</span>
            {open === e.id && e.changes.length > 0 && e.changes.map((c, i) => <span key={i} className={css.hint}>{c.key}: {String(c.old_value ?? "—")} → {String(c.new_value ?? "—")}</span>)}
          </button>
        ))}
    </>
  );
}
export { Checkbox, TriSwitch };
