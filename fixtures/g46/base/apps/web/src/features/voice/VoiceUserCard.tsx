import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";
import {
  Headphones,
  HeadphoneOff,
  MessageSquare,
  Mic,
  MicOff,
  Settings,
  User as UserIcon,
  Volume2,
  VolumeX,
} from "lucide-react";
import { PERMISSIONS, type Role } from "@chatapp/api-types";
import { api, fileUrl } from "../../api/endpoints.ts";
import { t } from "../../i18n/index.ts";
import { roleColorCss } from "../../lib/color.ts";
import { has } from "../../lib/perm.ts";
import { colorRole, memberName, permissionsIn } from "../../store/hooks.ts";
import { useStore } from "../../store/index.ts";
import { useUi } from "../../store/ui.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { Field, Switch } from "../../ui/Form.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useFocusTrap } from "../../ui/Modal.tsx";
import { errorText } from "../../ui/States.tsx";
import { toast } from "../../ui/Toast.tsx";
import { engine, useRoom } from "../../voice/engine.ts";
import { useVoice } from "../../voice/index.ts";
import { useVoiceSettings } from "../../voice/settings.ts";
import gcss from "../guild/guild.module.css";
import css from "./voice.module.css";

export interface VoiceUserCardProps {
  userId: string;
  anchor: DOMRect;
  onClose: () => void;
  guildId?: string;
  channelId?: string;
}

/**
 * Zengin Sesli Sohbet Katılımcı Profil Kartı (6.5).
 * Banner, büyük avatar, durum/konuşuyor halkası, görünen ad, @kullanıcıadı, BOT rozeti,
 * roller, hakkında metni, eylem butonları (DM gönder, profile git) ve ses kontrolleri.
 */
export function VoiceUserCard({ userId, anchor, onClose, guildId, channelId }: VoiceUserCardProps) {
  const nav = useNavigate();
  const vGuildId = useVoice((v) => v.guildId) ?? "";
  const vChannelId = useVoice((v) => v.channelId) ?? "";
  const effectiveGuildId = guildId ?? vGuildId;
  const effectiveChannelId = channelId ?? vChannelId;

  const meId = useStore((s) => s.me?.id);
  const me = useStore((s) => s.me);
  const isSelf = userId === meId;

  const g = useStore((s) => s.guilds[effectiveGuildId]);
  const member = g?.members[userId];
  const userFromStore = useStore((s) => s.users[userId]);
  const user = member?.user ?? (isSelf ? me : userFromStore);

  const status = useStore((s) => s.presences[userId] ?? (isSelf ? "online" : "offline"));
  const speaking = useRoom((s) => s.speaking.has(userId));
  const vs = useStore((s) => s.voiceStates[effectiveGuildId]?.[userId]);
  const perms = useStore((s) => permissionsIn(s, effectiveGuildId, meId, effectiveChannelId));

  // Ses ayarları
  const inputGain = useVoiceSettings((s) => s.inputGain);
  const gain = useVoiceSettings((s) => s.userGain[userId] ?? 1);
  const muted = useVoiceSettings((s) => !!s.userMuted[userId]);
  const patch = useVoiceSettings((s) => s.patch);

  // Moderasyon izinleri
  const canMute = has(perms, PERMISSIONS.MUTE_MEMBERS);
  const canDeafen = has(perms, PERMISSIONS.DEAFEN_MEMBERS);
  const canMove = has(perms, PERMISSIONS.MOVE_MEMBERS);
  const voiceChannels = useMemo(
    () => Object.values(g?.channels ?? {}).filter((c) => c.type === 2 && c.id !== effectiveChannelId),
    [g, effectiveChannelId]
  );

  const name = member ? memberName(member.user, member) : user ? memberName(user) : userId;
  const displayName = member?.nick || user?.display_name || user?.username || name;
  const username = user?.username ?? userId;
  const avatarId = member?.avatar_id ?? user?.avatar_id;
  const bannerId = user?.banner_id;
  const bannerUrl = fileUrl(bannerId);
  const isBot = Boolean(user?.bot);
  const about = user?.about;

  const roles: Role[] = useMemo(() => {
    if (!g || !member) return [];
    return member.roles
      .map((rId) => g.roles[rId])
      .filter((r): r is Role => Boolean(r))
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  }, [g, member]);

  const topColorRole = colorRole(g, member);
  const rc = roleColorCss(topColorRole?.color ?? 0);

  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);

  // Akıllı konumlandırma: taşmaları engeller
  const [pos, setPos] = useState(() => {
    const cardW = 320;
    const cardH = 460;
    let left = Math.max(12, Math.min(anchor.left, window.innerWidth - cardW - 12));
    let top = anchor.bottom + 8;
    if (top + cardH > window.innerHeight - 12) {
      if (anchor.top - cardH - 8 >= 12) {
        top = anchor.top - cardH - 8;
      } else {
        top = Math.max(12, window.innerHeight - cardH - 12);
      }
    }
    return { top, left };
  });

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const cardW = rect.width || 320;
    const cardH = rect.height || 460;
    let left = Math.max(12, Math.min(anchor.left, window.innerWidth - cardW - 12));
    let top = anchor.bottom + 8;
    if (top + cardH > window.innerHeight - 12) {
      if (anchor.top - cardH - 8 >= 12) {
        top = anchor.top - cardH - 8;
      } else {
        top = Math.max(12, window.innerHeight - cardH - 12);
      }
    }
    setPos({ top, left });
  }, [anchor]);

  // Esc tuşu ile kapatma
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [dmBusy, setDmBusy] = useState(false);

  // DM aç veya yönlendir
  const handleOpenDm = async () => {
    if (dmBusy) return;
    setDmBusy(true);
    try {
      const dm = await api.createDirectChannel(userId);
      useStore.getState().patch({
        directChannels: {
          ...useStore.getState().directChannels,
          [dm.id]: dm,
        },
      });
      onClose();
      nav(`/channels/@me/${dm.id}`);
    } catch (err: unknown) {
      toast.error(errorText(err) || t("voice.user.dmFailed"));
    } finally {
      setDmBusy(false);
    }
  };

  const handleViewProfile = () => {
    onClose();
    if (effectiveGuildId) {
      useUi.getState().openModal({ kind: "profile", guildId: effectiveGuildId, userId });
    }
  };

  const act = (b: Parameters<typeof api.updateMember>[2]) =>
    api.updateMember(effectiveGuildId, userId, b).then(
      () => toast.success(t("voice.user.done")),
      (e) => toast.error(errorText(e))
    );

  return (
    <div className={css.popScrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={css.userCard}
        style={{ top: pos.top, left: pos.left, ...(rc ? ({ "--card-role-color": rc } as CSSProperties) : {}) }}
        role="dialog"
        aria-label={t("voice.tile.menu", { name: displayName })}
        data-testid="participant-menu"
        tabIndex={-1}
      >
        {/* Banner */}
        <div className={css.cardBanner} data-testid="user-card-banner">
          {bannerUrl ? (
            <img src={bannerUrl} alt="" className={css.cardBannerImg} />
          ) : (
            <div className={css.cardBannerPlaceholder} />
          )}
        </div>

        {/* Avatar */}
        <div className={css.cardAvatarWrap}>
          <Avatar
            name={displayName}
            avatarId={avatarId}
            size="xl"
            status={status}
            speaking={speaking && !muted}
            bg="bg-overlay"
          />
        </div>

        {/* Kart Gövdesi */}
        <div className={css.cardBody}>
          {/* Kimlik: Görünen ad, @kullanıcıadı, BOT rozeti */}
          <div className={css.cardIdentity}>
            <div className={css.cardNameRow}>
              <strong className={css.cardDisplayName} title={displayName}>
                {displayName}
              </strong>
              {isBot && (
                <Badge variant="bot" size="sm" data-testid="bot-badge" aria-label={t("voice.user.bot")}>
                  {t("voice.user.bot")}
                </Badge>
              )}
            </div>
            <span className={css.cardUsername}>@{username}</span>
          </div>

          <div className={css.cardDivider} />

          {/* Hakkında */}
          {about && (
            <div className={css.cardSection}>
              <span className={css.cardSectionTitle}>{t("voice.user.about")}</span>
              <p className={css.cardAbout} data-testid="user-about">
                {about}
              </p>
            </div>
          )}

          {/* Roller */}
          {member && (
            <div className={css.cardSection}>
              <span className={css.cardSectionTitle}>{t("voice.user.roles")}</span>
              <div className={css.cardRoles} data-testid="user-roles">
                {roles.length === 0 ? (
                  <span className={css.cardUsername}>{t("voice.user.noRoles")}</span>
                ) : (
                  roles.map((r) => (
                    <span key={r.id} className={css.cardRoleChip}>
                      <span
                        className={css.cardRoleDot}
                        style={{ "--hk-role-color": roleColorCss(r.color) } as CSSProperties}
                      />
                      {r.name}
                    </span>
                  ))
                )}
              </div>
            </div>
          )}

          <div className={css.cardDivider} />

          {/* Ses Kontrolleri */}
          <div className={css.cardSection}>
            <span className={css.cardSectionTitle}>{t("voice.user.audioControls")}</span>
            {isSelf ? (
              <>
                <Field label={t("voice.user.inputGain", { n: Math.round(inputGain * 100) })}>
                  {(p) => (
                    <div className={css.sliderRow}>
                      <Icon icon={inputGain === 0 ? VolumeX : Volume2} size="sm" className={css.sliderIcon} />
                      <input
                        {...p}
                        type="range"
                        min={0}
                        max={200}
                        value={Math.round(inputGain * 100)}
                        className={css.range}
                        data-testid="self-input-gain"
                        onChange={(e) => patch({ inputGain: Number(e.target.value) / 100 })}
                      />
                    </div>
                  )}
                </Field>
                <Button
                  size="sm"
                  icon={Settings}
                  onClick={() => {
                    onClose();
                    nav({ search: "?ayarlar=ses" });
                  }}
                >
                  {t("voice.user.openSettings")}
                </Button>
              </>
            ) : (
              <>
                <Field label={`${t("voice.user.volume")}: %${Math.round(gain * 100)}`}>
                  {(p) => (
                    <div className={css.sliderRow}>
                      <Icon icon={gain === 0 || muted ? VolumeX : Volume2} size="sm" className={css.sliderIcon} />
                      <input
                        {...p}
                        type="range"
                        min={0}
                        max={200}
                        value={Math.round(gain * 100)}
                        className={css.range}
                        data-testid="user-volume"
                        onChange={(e) => {
                          patch({
                            userGain: {
                              ...useVoiceSettings.getState().userGain,
                              [userId]: Number(e.target.value) / 100,
                            },
                          });
                          engine.applyVolumes();
                        }}
                      />
                    </div>
                  )}
                </Field>
                <div className={css.formRow}>
                  <strong>{t("voice.user.localMute")}</strong>
                  <Switch
                    label={t("voice.user.localMute")}
                    checked={muted}
                    data-testid="user-mute-switch"
                    onChange={(v) => {
                      patch({
                        userMuted: {
                          ...useVoiceSettings.getState().userMuted,
                          [userId]: v,
                        },
                      });
                      engine.applyVolumes();
                    }}
                  />
                </div>

                {/* Moderasyon İşlemleri (yetkiliye) */}
                {(canMute || canDeafen || canMove) && (
                  <div className={css.modControls}>
                    {canMute && (
                      <Button
                        size="sm"
                        data-testid="btn-server-mute"
                        icon={vs?.mute ? Mic : MicOff}
                        onClick={() => void act({ mute: !vs?.mute })}
                      >
                        {vs?.mute ? t("voice.user.serverUnmute") : t("voice.user.serverMute")}
                      </Button>
                    )}
                    {canDeafen && (
                      <Button
                        size="sm"
                        data-testid="btn-server-deafen"
                        icon={vs?.deaf ? Headphones : HeadphoneOff}
                        onClick={() => void act({ deaf: !vs?.deaf })}
                      >
                        {vs?.deaf ? t("voice.user.serverUndeaf") : t("voice.user.serverDeaf")}
                      </Button>
                    )}
                    {canMove && voiceChannels.length > 0 && (
                      <Field label={t("voice.user.move")}>
                        {(p) => (
                          <select
                            {...p}
                            className={gcss.select}
                            value=""
                            onChange={(e) => e.target.value && void act({ channel_id: e.target.value })}
                          >
                            <option value="">{t("voice.user.move")}</option>
                            {voiceChannels.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                    )}
                    {canMove && (
                      <Button
                        size="sm"
                        kind="danger"
                        data-testid="btn-server-disconnect"
                        onClick={() => void act({ channel_id: null })}
                      >
                        {t("voice.user.disconnect")}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Eylem Butonları: Mesaj Gönder ve Profili Görüntüle */}
          <div className={css.cardActions}>
            {!isSelf && (
              <Button
                kind="primary"
                size="sm"
                icon={MessageSquare}
                busy={dmBusy}
                data-testid="btn-send-message"
                onClick={() => void handleOpenDm()}
              >
                {t("voice.user.sendMessage")}
              </Button>
            )}
            {member && (
              <Button
                size="sm"
                icon={UserIcon}
                data-testid="btn-view-profile"
                onClick={handleViewProfile}
              >
                {t("voice.user.viewProfile")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
