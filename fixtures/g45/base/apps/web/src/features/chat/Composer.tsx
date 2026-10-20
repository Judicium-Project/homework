import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Plus, Smile, X } from "lucide-react";
import { PERMISSIONS, type Attachment, type Channel } from "@chatapp/api-types";
import { api } from "../../api/endpoints.ts";
import { t } from "../../i18n/index.ts";
import { has } from "../../lib/perm.ts";
import { MAX_MESSAGE_FILE, uploadFile } from "../../lib/upload.ts";
import { fmtBytes } from "../../lib/time.ts";
import { memberName, permissionsIn } from "../../store/hooks.ts";
import { useStore } from "../../store/index.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Badge } from "../../ui/Badge.tsx";
import { IconButton } from "../../ui/Button.tsx";
import { ConfirmModal } from "../../ui/Modal.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { isEmailNotVerified } from "../../api/client.ts";
import { errorText } from "../../ui/States.tsx";
import { toast } from "../../ui/Toast.tsx";
import { useChatUi } from "./chatUi.ts";
import { EmojiPicker } from "./EmojiPicker.tsx";
import { searchEmoji } from "./emoji.ts";
import { sendMessage } from "./messages.ts";
import { EmailNotVerifiedNotice } from "../auth/EmailNotVerifiedNotice.tsx";
import css from "./chat.module.css";

interface Pending { key: string; file: File; thumb?: string; progress: number; status: "uploading" | "ready" | "error"; attachment?: Attachment; abort: AbortController }

type Sug = { kind: "user" | "role" | "channel" | "emoji" | "everyone"; key: string; label: string; sub?: string; insert: string; token?: string; isBot?: boolean; avatar?: { name: string; id: string | null } };

const TYPING_EVERY_MS = 8000;

/** 5.2 Mesaj yazma alanı. */
export function Composer({ guildId, channel }: { guildId?: string; channel: Channel }) {
  const perms = useStore((s) => (guildId ? permissionsIn(s, guildId, s.me?.id, channel.id) : ~0n));
  const canSend = !guildId || has(perms, PERMISSIONS.SEND_MESSAGES);
  const canAttach = !guildId || has(perms, PERMISSIONS.ATTACH_FILES);
  const canEveryone = guildId ? has(perms, PERMISSIONS.MENTION_EVERYONE) : false;
  const guild = useStore((s) => (guildId ? s.guilds[guildId] : undefined));
  const meId = useStore((s) => s.me?.id);
  const reply = useChatUi((s) => s.replyTo[channel.id] ?? null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [warn, setWarn] = useState<string | null>(null);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [sug, setSug] = useState<{ items: Sug[]; active: number; from: number } | null>(null);
  const [confirm, setConfirm] = useState<{ text: string; n: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  void dragging;
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const tokens = useRef(new Map<string, string>()); // "@ad" → "<@id>"

  // Kanal değişince taslak ve ekler temizlenir (yanıt durumu kanal başına tutulur).
  useEffect(() => {
    setText("");
    setFiles((f) => {
      f.forEach((x) => x.abort.abort());
      return [];
    });
    setWarn(null);
    setSug(null);
    tokens.current.clear();
    area.current?.focus();
  }, [channel.id]);

  useEffect(() => {
    if (reply) area.current?.focus();
  }, [reply]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const addFiles = useCallback(
    (list: File[]) => {
      if (!canAttach) return;
      const room = 10 - files.length;
      const next: Pending[] = [];
      for (const f of list.slice(0, Math.max(0, room))) {
        if (f.size > MAX_MESSAGE_FILE) {
          setWarn(t("attach.tooBig", { name: f.name, max: fmtBytes(MAX_MESSAGE_FILE) }));
          continue;
        }
        const abort = new AbortController();
        const p: Pending = { key: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`, file: f, thumb: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined, progress: 0, status: "uploading", abort };
        next.push(p);
        uploadFile(f, "message", { channelId: channel.id, signal: abort.signal, onProgress: (r) => setFiles((cur) => cur.map((x) => (x.key === p.key ? { ...x, progress: r } : x))) })
          .then((a) => setFiles((cur) => cur.map((x) => (x.key === p.key ? { ...x, status: "ready", attachment: a, progress: 1 } : x))))
          .catch((e: unknown) => {
            if (e instanceof DOMException && e.name === "AbortError") return;
            setFiles((cur) => cur.map((x) => (x.key === p.key ? { ...x, status: "error" } : x)));
            setWarn(errorText(e));
          });
      }
      if (list.length > room) setWarn(t("attach.max"));
      if (next.length) {
        setWarn((w) => (list.some((f) => f.size > MAX_MESSAGE_FILE) ? w : null));
        setFiles((cur) => [...cur, ...next]);
      }
    },
    [canAttach, channel.id, files.length],
  );

  // Yapıştırma ve sürükle-bırak (içerik alanı genelinde).
  useEffect(() => {
    if (!canAttach) return;
    const root = area.current?.closest("main") ?? document.body;
    let depth = 0;
    const over = (e: DragEvent) => e.dataTransfer?.types.includes("Files") && e.preventDefault();
    const enter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        depth++;
        setDragging(true);
      }
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addFiles([...e.dataTransfer.files]);
    };
    root.addEventListener("dragover", over as EventListener);
    root.addEventListener("dragenter", enter as EventListener);
    root.addEventListener("dragleave", leave);
    root.addEventListener("drop", drop as EventListener);
    return () => {
      root.removeEventListener("dragover", over as EventListener);
      root.removeEventListener("dragenter", enter as EventListener);
      root.removeEventListener("dragleave", leave);
      root.removeEventListener("drop", drop as EventListener);
    };
  }, [canAttach, addFiles]);

  const removeFile = (key: string) =>
    setFiles((cur) => {
      cur.find((x) => x.key === key)?.abort.abort();
      return cur.filter((x) => x.key !== key);
    });

  const uploading = files.some((f) => f.status === "uploading");
  const ready = files.filter((f) => f.status === "ready" && f.attachment).map((f) => f.attachment as Attachment);
  const canSubmit = (text.trim().length > 0 || ready.length > 0) && !uploading;

  const finalContent = (raw: string): string => {
    let out = raw;
    for (const [label, token] of tokens.current) out = out.split(label).join(token);
    return out;
  };

  const doSend = (content: string) => {
    const r = useChatUi.getState().replyTo[channel.id];
    setText("");
    setFiles([]);
    setWarn(null);
    setEmailNotVerified(false);
    tokens.current.clear();
    useChatUi.getState().setReply(channel.id, null);
    sendMessage(guildId ?? "", channel.id, content, { replyTo: r?.message, mentionReply: r?.mention, attachments: ready }).catch((e) => {
      if (isEmailNotVerified(e)) {
        setEmailNotVerified(true);
      } else {
        toast.error(errorText(e));
      }
    });
    area.current?.focus();
  };

  const submit = () => {
    if (!canSubmit) return;
    const content = finalContent(text.trim());
    if (canEveryone && /@(everyone|here)\b/.test(content)) {
      const n = Object.keys(guild?.members ?? {}).length;
      setConfirm({ text: content, n });
      return;
    }
    doSend(content);
  };

  // ───── öneriler (@ : #) ─────
  const computeSuggestions = (value: string, caret: number) => {
    const upto = value.slice(0, caret);
    const m = /(^|\s)([@#:])([\p{L}\p{N}_.-]*)$/u.exec(upto);
    if (!m || !guild) return setSug(null);
    const [, , trigger, q] = m;
    const needle = (q ?? "").toLocaleLowerCase("tr");
    const from = caret - (q?.length ?? 0) - 1;
    let items: Sug[] = [];
    if (trigger === "@") {
      items = Object.values(guild.members)
        .filter((x) => x.user.id !== meId || true)
        .filter((x) => [x.user.username, x.user.display_name ?? "", x.nick ?? ""].some((s) => s.toLocaleLowerCase("tr").includes(needle)))
        .slice(0, 6)
        .map((x) => ({ kind: "user" as const, key: `u${x.user.id}`, label: memberName(x.user, x), sub: `@${x.user.username}`, insert: `@${x.user.username} `, token: `<@${x.user.id}>`, isBot: Boolean(x.user.bot), avatar: { name: memberName(x.user, x), id: x.user.avatar_id } }));
      const roles = Object.values(guild.roles).filter((r) => r.id !== guild.id && (r.mentionable || canEveryone) && r.name.toLocaleLowerCase("tr").includes(needle)).slice(0, 3);
      items.push(...roles.map((r) => ({ kind: "role" as const, key: `r${r.id}`, label: r.name, sub: t("sug.role"), insert: `@${r.name.replace(/\s+/g, "-")} `, token: `<@&${r.id}>` })));
      if (canEveryone) for (const w of ["everyone", "here"]) if (w.startsWith(needle)) items.push({ kind: "everyone", key: `e${w}`, label: `@${w}`, insert: `@${w} ` });
    } else if (trigger === "#") {
      items = Object.values(guild.channels).filter((c) => c.type === 0 && c.name.toLocaleLowerCase("tr").includes(needle)).slice(0, 8).map((c) => ({ kind: "channel" as const, key: `c${c.id}`, label: `#${c.name}`, insert: `#${c.name} `, token: `<#${c.id}>` }));
    } else if (trigger === ":" && needle.length >= 1) {
      items = searchEmoji(needle, 8).map((e) => ({ kind: "emoji" as const, key: `m${e.e}`, label: `${e.e}  ${e.n.split(" ")[0]}`, insert: `${e.e} ` }));
    }
    setSug(items.length ? { items, active: 0, from } : null);
  };

  const applySuggestion = (s: Sug, from: number) => {
    const el = area.current;
    if (!el) return;
    const caret = el.selectionStart;
    const next = `${text.slice(0, from)}${s.insert}${text.slice(caret)}`;
    if (s.token) tokens.current.set(s.insert.trim(), s.token);
    setText(next);
    setSug(null);
    requestAnimationFrame(() => {
      const pos = from + s.insert.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const onChange = (value: string, caret: number) => {
    setText(value);
    computeSuggestions(value, caret);
    const now = Date.now();
    if (value.trim() && canSend && now - lastTyping.current > TYPING_EVERY_MS) {
      lastTyping.current = now;
      api.typing(channel.id).catch(() => undefined);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (sug) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSug({ ...sug, active: (sug.active + (e.key === "ArrowDown" ? 1 : -1) + sug.items.length) % sug.items.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const it = sug.items[sug.active];
        if (it) applySuggestion(it, sug.from);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSug(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && reply) {
      useChatUi.getState().setReply(channel.id, null);
    } else if (e.key === "ArrowUp" && text === "" && files.length === 0) {
      // Boş alanda ↑ → son mesajını düzenle.
      const b = useStore.getState().messages[channel.id];
      const mine = b?.ids.map((id) => b.byId[id]).reverse().find((m) => m?.author.id === meId && m.type !== 7);
      if (mine) {
        e.preventDefault();
        useChatUi.getState().startEdit(mine.id);
      }
    }
  };

  const typingNames = useTyping(channel.id, guildId);
  const replyName = useMemo(() => (reply ? memberName(reply.message.author, guild?.members[reply.message.author.id]) : ""), [reply, guild]);

  if (!canSend) {
    return (
      <div className={css.composerWrap}>
        <div className={css.composer} data-disabled="true" style={{ minHeight: "var(--hk-layout-composer-min)" }}>
          <span>{t("composer.noPermission")}</span>
        </div>
        <div className={css.typing} aria-live="polite" />
      </div>
    );
  }

  return (
    <>
      {reply && (
        <div className={css.replyBar}>
          <span className={css.grow}>
            <Trans text={t("composer.replying", { name: "\u0000" })} name={replyName} />
            {" · "}
            <button type="button" className="mentionTog" onClick={() => useChatUi.getState().toggleReplyMention(channel.id)} aria-pressed={reply.mention} style={{ color: "var(--hk-text-link)", textDecoration: "underline" }}>
              {reply.mention ? t("composer.mentionOn") : t("composer.mentionOff")}
            </button>
          </span>
          <IconButton icon={X} label={t("composer.cancelReply")} size="sm" iconSize="sm" onClick={() => useChatUi.getState().setReply(channel.id, null)} />
        </div>
      )}
      <div className={css.composerWrap}>
        {sug && (
          <div className={css.suggest} role="listbox" aria-label={t("composer.suggestions")}>
            {sug.items.map((s, i) => (
              <button key={s.key} type="button" role="option" aria-selected={i === sug.active} data-active={i === sug.active} className={css.suggestItem} onMouseDown={(e) => e.preventDefault()} onClick={() => applySuggestion(s, sug.from)}>
                {s.avatar && <Avatar name={s.avatar.name} avatarId={s.avatar.id} size="sm" bg="bg-overlay" />}
                <span>{s.label}</span>
                {s.isBot && <Badge variant="bot" size="sm">BOT</Badge>}
                {s.sub && <span className={css.suggestMeta}>{s.sub}</span>}
              </button>
            ))}
          </div>
        )}
        <div className={css.composer} style={reply ? { borderTopLeftRadius: 0, borderTopRightRadius: 0 } : undefined}>
          {files.length > 0 && (
            <div className={css.attachRow}>
              {files.map((f) => (
                <div key={f.key} className={css.attachCard}>
                  {f.thumb ? <img src={f.thumb} alt="" /> : <Icon icon={Paperclip} size="lg" />}
                  <span className={css.nm} title={f.file.name}>{f.file.name}</span>
                  {f.status === "error" && <span className={css.attachErr}>{t("attach.failed")}</span>}
                  <IconButton icon={X} label={t("attach.remove", { name: f.file.name })} size="sm" iconSize="sm" className={css.attachRemove} onClick={() => removeFile(f.key)} />
                  {f.status === "uploading" && <span className={css.attachBar} style={{ width: `${Math.round(f.progress * 100)}%` }} role="progressbar" aria-valuenow={Math.round(f.progress * 100)} aria-valuemin={0} aria-valuemax={100} />}
                </div>
              ))}
            </div>
          )}
          <div className={css.composerRow}>
            {canAttach && (
              <>
                <IconButton icon={Plus} label={t("composer.attach")} size="sm" onClick={() => fileInput.current?.click()} />
                <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} data-testid="file-input" />
              </>
            )}
            <textarea
              ref={area}
              className={css.textarea}
              rows={1}
              value={text}
              placeholder={t("composer.placeholder", { name: channel.name })}
              aria-label={t("composer.placeholder", { name: channel.name })}
              onChange={(e) => {
                onChange(e.target.value, e.target.selectionStart);
                if (emailNotVerified) setEmailNotVerified(false);
              }}
              onKeyDown={onKeyDown}
              onKeyUp={(e) => ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && computeSuggestions(e.currentTarget.value, e.currentTarget.selectionStart)}
              onPaste={(e) => {
                const fl = [...e.clipboardData.files];
                if (fl.length && canAttach) {
                  e.preventDefault();
                  addFiles(fl);
                }
              }}
              onBlur={() => setTimeout(() => setSug(null), 120)}
              maxLength={4000}
              data-testid="composer"
            />
            <IconButton icon={Smile} label={t("composer.emoji")} size="sm" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())} />
          </div>
        </div>
        {warn && <div className={css.warn} role="alert">{warn}</div>}
        {emailNotVerified && <div className={css.warn} role="alert"><EmailNotVerifiedNotice /></div>}
        <div className={css.typing} aria-live="polite">
          {typingNames.length > 0 && <TypingText names={typingNames} />}
        </div>
      </div>
      {picker && (
        <EmojiPicker
          anchor={picker}
          onClose={() => setPicker(null)}
          onPick={(e) => {
            setPicker(null);
            const el = area.current;
            const pos = el?.selectionStart ?? text.length;
            setText(text.slice(0, pos) + e + text.slice(pos));
            requestAnimationFrame(() => el?.focus());
          }}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={t("composer.everyone.title")}
          description={t("composer.everyone.desc", { n: confirm.n })}
          confirmLabel={t("composer.send")}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const c = confirm.text;
            setConfirm(null);
            doSend(c);
          }}
        />
      )}
    </>
  );
}

/** "Ada yanıt veriyorsun": addaki `\u0000` yer tutucusunu kalın ad ile değiştirir. */
function Trans({ text, name }: { text: string; name: string }) {
  const [a, b] = text.split("\u0000");
  return (
    <>
      {a}
      <strong>{name}</strong>
      {b}
    </>
  );
}

function TypingText({ names }: { names: string[] }) {
  if (names.length >= 3) return <>{t("typing.several")}</>;
  if (names.length === 2) return <><strong>{names[0]}</strong> {t("typing.and")} <strong>{names[1]}</strong> {t("typing.two")}</>;
  return <><strong>{names[0]}</strong> {t("typing.one")}</>;
}

/** Kanalda yazanlar (10 sn sonra söner); saniyede bir tazelenir. */
export function useTyping(channelId: string, guildId?: string): string[] {
  const typing = useStore((s) => s.typing[channelId]);
  const members = useStore((s) => (guildId ? s.guilds[guildId]?.members : undefined));
  const users = useStore((s) => s.users);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!typing) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [typing]);
  return useMemo(
    () =>
      Object.entries(typing ?? {})
        .filter(([, exp]) => exp > now)
        .map(([uid]) => {
          if (members?.[uid]) return memberName(members[uid].user, members[uid]);
          const u = users[uid];
          return u ? (u.display_name || u.username) : uid;
        }),
    [typing, members, users, now],
  );
}
