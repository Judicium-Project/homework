import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { CornerUpRight, Ellipsis, File as FileIcon, ImageOff, SmilePlus, UserPlus } from "lucide-react";
import { PERMISSIONS, type Attachment } from "@chatapp/api-types";
import { api } from "../../api/endpoints.ts";
import { t } from "../../i18n/index.ts";
import { roleColorCss } from "../../lib/color.ts";
import type { TimelineMessage } from "../../lib/group.ts";
import { has } from "../../lib/perm.ts";
import { fmtBytes, fmtFull, fmtTime } from "../../lib/time.ts";
import { isImage, isVideo } from "../../lib/upload.ts";
import { colorRole, memberName, permissionsIn } from "../../store/hooks.ts";
import { isMentioningMe } from "./mention.ts";
import { useStore } from "../../store/index.ts";
import { useUi } from "../../store/ui.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Badge } from "../../ui/Badge.tsx";
import { IconButton } from "../../ui/Button.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { openMenu, openMenuAt } from "../../ui/Menu.tsx";
import { toast } from "../../ui/Toast.tsx";
import { errorText } from "../../ui/States.tsx";
import { ConfirmModal } from "../../ui/Modal.tsx";
import { useChatUi } from "./chatUi.ts";
import { EmojiPicker } from "./EmojiPicker.tsx";
import { Markdown } from "./Markdown.tsx";
import { deleteMessage, discardPending, editMessage, markUnreadFrom, retryMessage, toggleReaction } from "./messages.ts";
import css from "./chat.module.css";

interface Props { guildId?: string; message: TimelineMessage; head: boolean; flash?: boolean }

export const MessageItem = memo(function MessageItem({ guildId, message: m, head, flash }: Props) {
  const me = useStore((s) => s.me);
  const guild = useStore((s) => (guildId ? s.guilds[guildId] : undefined));
  const member = guild?.members[m.author.id];
  const perms = useStore((s) => (guildId ? permissionsIn(s, guildId, s.me?.id, m.channel_id) : ~0n));
  const dev = useStore((s) => s.settings.developer_mode);
  const editing = useChatUi((s) => s.editingId === m.id);
  const openModal = useUi((s) => s.openModal);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const own = m.author.id === me?.id;
  const canManage = has(perms, PERMISSIONS.MANAGE_MESSAGES);
  const name = member ? memberName(m.author, member) : memberName(m.author);
  const rc = guild ? roleColorCss(colorRole(guild, member)?.color ?? 0) : undefined;
  const myRoles = guild && me ? guild.members[me.id]?.roles ?? [] : [];
  const mentioned = me ? isMentioningMe(m, me, myRoles) : false;
  const local = m.local;
  const nameStyle = rc ? ({ "--hk-role-color": rc } as CSSProperties) : undefined;

  if (m.type === 7) {
    return (
      <div className={css.msg} data-head="false" data-system="true">
        <span className={css.sysIcon}>
          <Icon icon={UserPlus} />
        </span>
        <div className={css.sysText}>
          {t("msg.joined", { name })} · <span className="tabular">{fmtTime(m.timestamp)}</span>
        </div>
      </div>
    );
  }

  const canReact = !local && has(perms, PERMISSIONS.ADD_REACTIONS);
  const canReply = !local && has(perms, PERMISSIONS.SEND_MESSAGES);

  const menuItems = () => [
    { label: t("msg.edit"), disabled: false, hidden: !own || !!local, onSelect: () => useChatUi.getState().startEdit(m.id) },
    { label: t("msg.delete"), danger: true, hidden: !(own || canManage) || !!local, onSelect: () => setConfirmDelete(true) },
    { separator: true as const, hidden: !!local },
    { label: t("msg.copyText"), onSelect: () => void navigator.clipboard?.writeText(m.content).then(() => toast.success(t("msg.copied"))) },
    { label: t("msg.copyLink"), hidden: !!local, onSelect: () => void navigator.clipboard?.writeText(guildId ? `${location.origin}/s/${guildId}/${m.channel_id}#${m.id}` : `${location.origin}/channels/@me/${m.channel_id}#${m.id}`).then(() => toast.success(t("msg.copied"))) },
    { label: t("msg.copyId"), hidden: !dev || !!local, onSelect: () => void navigator.clipboard?.writeText(m.id) },
    { label: t("msg.markUnread"), hidden: !!local, onSelect: () => markUnreadFrom(m.channel_id, m.id) },
  ];

  return (
    <div
      className={css.msg}
      data-head={head}
      data-mention={mentioned || undefined}
      data-flash={flash || undefined}
      data-local={local}
      data-msg-id={m.id}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest("a,button,textarea,video")) return;
        openMenu(e, menuItems());
      }}
      tabIndex={-1}
    >
      {head && m.message_reference && <ReplyPreview m={m} guildId={guildId} />}
      {head ? (
        <span className={css.avatarCol}>
          <Avatar name={name} avatarId={m.author.avatar_id} size="lg" />
        </span>
      ) : (
        <span className={css.gutterTime} title={fmtFull(m.timestamp)}>
          {fmtTime(m.timestamp)}
        </span>
      )}
      {head && (
        <div className={css.head}>
          <button type="button" className={css.author} style={nameStyle} onClick={() => openModal({ kind: "profile", guildId: guildId ?? "", userId: m.author.id })}>
            {name}
          </button>
          {m.author.bot && <Badge variant="bot" size="sm">BOT</Badge>}
          <time className={css.time} dateTime={m.timestamp} title={fmtFull(m.timestamp)}>
            {fmtTime(m.timestamp)}
          </time>
        </div>
      )}
      {editing ? (
        <EditBox m={m} />
      ) : (
        <div className={css.body}>
          {m.content && <Markdown text={m.content} guildId={guildId} meId={me?.id} />}
          {m.edited_timestamp && (
            <span className={css.edited} title={fmtFull(m.edited_timestamp)}>
              {" "}
              {t("msg.edited")}
            </span>
          )}
        </div>
      )}
      {m.attachments.length > 0 && <Attachments list={m.attachments} />}
      {m.reactions.length > 0 && (
        <div className={css.reactions}>
          {m.reactions.map((r) => (
            <button
              key={r.emoji.name}
              type="button"
              className={css.chip}
              aria-pressed={r.me}
              aria-label={t("msg.reaction.aria", { emoji: r.emoji.name, n: r.count })}
              disabled={!canReact && !r.me && !has(perms, PERMISSIONS.ADD_REACTIONS) && false}
              onClick={() => void toggleReaction(m.channel_id, m.id, r.emoji.name, r.me).catch((e) => toast.error(errorText(e)))}
            >
              <span className={css.emoji}>{r.emoji.name}</span>
              <span>{r.count}</span>
            </button>
          ))}
        </div>
      )}
      {local === "failed" && (
        <div className={css.failed} role="alert">
          <span>{t("msg.failed")}</span>
          <button type="button" onClick={() => void retryMessage(m.channel_id, m.nonce ?? "")}>{t("common.retry")}</button>
          <button type="button" onClick={() => discardPending(m.channel_id, m.nonce ?? "")}>{t("msg.delete")}</button>
        </div>
      )}
      {!local && !editing && (
        <div className={css.toolbar} role="toolbar" aria-label={t("msg.actions")}>
          {canReact && (
            <IconButton icon={SmilePlus} label={t("msg.react")} size="sm" iconSize="sm" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())} />
          )}
          {canReply && <IconButton icon={CornerUpRight} label={t("msg.reply")} size="sm" iconSize="sm" onClick={() => useChatUi.getState().setReply(m.channel_id, m)} />}
          <IconButton icon={Ellipsis} label={t("msg.more")} size="sm" iconSize="sm" aria-haspopup="menu" onClick={(e) => openMenuAt(e.currentTarget, menuItems(), "end")} />
        </div>
      )}
      {picker && (
        <EmojiPicker
          anchor={picker}
          onPick={(e) => {
            setPicker(null);
            const mine = m.reactions.find((r) => r.emoji.name === e)?.me ?? false;
            if (!mine) void toggleReaction(m.channel_id, m.id, e, false).catch((err) => toast.error(errorText(err)));
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={t("msg.delete.title")}
          description={t("msg.delete.desc")}
          confirmLabel={t("msg.delete")}
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void deleteMessage(m.channel_id, m.id).catch((e) => toast.error(errorText(e)));
          }}
        >
          <div className={css.msg} style={{ background: "var(--hk-bg-surface)", borderRadius: "var(--hk-radius-md)", padding: "var(--hk-space-3)" }}>
            <Markdown text={m.content || t("msg.attachmentsOnly")} guildId={guildId} />
          </div>
        </ConfirmModal>
      )}
    </div>
  );
});

function ReplyPreview({ m, guildId }: { m: TimelineMessage; guildId?: string }) {
  const ref = m.referenced_message;
  const guild = useStore((s) => (guildId ? s.guilds[guildId] : undefined));
  if (ref === null) {
    return (
      <div className={css.reply}>
        <Icon icon={CornerUpRight} size="sm" />
        <span className={css.replyGone}>{t("msg.reply.deleted")}</span>
      </div>
    );
  }
  if (!ref) return null;
  const mem = guild?.members[ref.author.id];
  const nm = memberName(ref.author, mem);
  return (
    <button type="button" className={css.reply} onClick={() => useChatUi.getState().jump(ref.id)} aria-label={t("msg.reply.jump", { name: nm })}>
      <Icon icon={CornerUpRight} size="sm" />
      <Avatar name={nm} avatarId={ref.author.avatar_id} size="xs" />
      <span className={css.replyName}>{nm}</span>
      <span className={css.replyText}>{ref.content || t("msg.attachmentsOnly")}</span>
    </button>
  );
}

function EditBox({ m }: { m: TimelineMessage }) {
  const [text, setText] = useState(m.content);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  const cancel = () => useChatUi.getState().startEdit(null);
  const save = async () => {
    const v = text.trim();
    if (!v || v === m.content) return cancel();
    setBusy(true);
    try {
      await editMessage(m.channel_id, m.id, v);
      cancel();
    } catch (e) {
      toast.error(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className={css.editBox}>
      <textarea
        ref={ref}
        className={css.editArea}
        value={text}
        rows={Math.min(8, text.split("\n").length)}
        disabled={busy}
        aria-label={t("msg.edit")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            cancel();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <span className={css.editHint}>{t("msg.edit.hint")}</span>
    </div>
  );
}

// ───────────── ekler (5.1) ─────────────

/** Süresi dolan imzalı adres için tazesini ister (`url_expires_at`). */
function useFreshUrl(a: Attachment): { url: string | null; refresh(): void } {
  const [url, setUrl] = useState<string | null>(a.url);
  useEffect(() => setUrl(a.url), [a.url]);
  useEffect(() => {
    if (!a.url_expires_at || a.status !== "ready") return;
    const ms = new Date(a.url_expires_at).getTime() - Date.now() - 30_000;
    if (ms > 0) return;
    void api.attachmentUrl(a.id).then((r) => setUrl(r.url)).catch(() => undefined);
  }, [a.id, a.url_expires_at, a.status]);
  return { url, refresh: () => void api.attachmentUrl(a.id).then((r) => setUrl(r.url)).catch(() => undefined) };
}

function Attachments({ list }: { list: Attachment[] }) {
  const images = list.filter((a) => isImage(a) && a.status === "ready");
  return (
    <div className={css.attachments}>
      {list.map((a) => (
        <AttachmentView key={a.id} a={a} onOpen={() => useChatUi.getState().openPreview(images.length ? images : [a], Math.max(0, images.indexOf(a)))} />
      ))}
    </div>
  );
}

function AttachmentView({ a, onOpen }: { a: Attachment; onOpen(): void }) {
  const { url, refresh } = useFreshUrl(a);
  const [retried, setRetried] = useState(false);
  if (a.status === "blocked") return <div className={css.fileCard}><Icon icon={ImageOff} size="lg" /><span className={css.blocked}>{t("attach.blocked")}</span></div>;
  if (a.status === "pending" || !url) return <div className={css.thumbPh} aria-busy="true"><Icon icon={FileIcon} size="lg" /></div>;
  const onErr = () => {
    if (!retried) {
      setRetried(true);
      refresh();
    }
  };
  if (isImage(a)) {
    return (
      <button type="button" className={css.thumbBtn} onClick={onOpen} aria-label={t("attach.open", { name: a.filename })}>
        <img className={css.thumb} src={url} alt={a.filename} width={a.width ?? undefined} height={a.height ?? undefined} loading="lazy" onError={onErr} />
      </button>
    );
  }
  if (isVideo(a)) return <video className={css.video} src={url} controls preload="metadata" aria-label={a.filename} onError={onErr} />;
  return (
    <a className={css.fileCard} href={url} download={a.filename} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
      <Icon icon={FileIcon} size="lg" />
      <span style={{ minWidth: 0 }}>
        <span className={css.fileName}>{a.filename}</span>
        <span className={css.fileSize}>{fmtBytes(a.size)}</span>
      </span>
    </a>
  );
}
