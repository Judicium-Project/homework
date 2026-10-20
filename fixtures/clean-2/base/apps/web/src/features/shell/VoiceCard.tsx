import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Mic, MicOff, MonitorUp, PhoneOff, Volume2 } from "lucide-react";
import { t } from "../../i18n/index.ts";
import { channelPath } from "../../lib/nav.ts";
import { memberName } from "../../store/hooks.ts";
import { useStore } from "../../store/index.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button, IconButton } from "../../ui/Button.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useRoom } from "../../voice/engine.ts";
import { useVoice, voice } from "../../voice/index.ts";
import { useRoomUi } from "../voice/roomUi.ts";
import { useSpeakingStore } from "./ChannelList.tsx";
import css from "./shell.module.css";

/**
 * Sağ sütundaki yüzen ses kartı (K52, G29 Madde 4).
 * Kullanıcı ses odasındaysa hep görünür: oda adı, katılımcılar, konuşan halkası, Mikrofon / Ekran / Ayrıl düğmeleri.
 */
export function VoiceCard() {
  const nav = useNavigate();
  const v = useVoice();
  const room = useRoom();
  const roomUi = useRoomUi();
  const me = useStore((s) => s.me);
  const meId = me?.id;
  const inVoice = v.status === "connected" || v.status === "joining";
  const channel = useStore((s) => (v.guildId && v.channelId ? s.guilds[v.guildId]?.channels[v.channelId] : undefined));
  const states = useStore((s) => (v.guildId ? s.voiceStates[v.guildId] : undefined));
  const members = useStore((s) => (v.guildId ? s.guilds[v.guildId]?.members : undefined));
  const speaking = useSpeakingStore((s) => s.ids);

  const ids = useMemo(() => {
    if (!inVoice || !v.channelId) return [];
    const out: string[] = [];
    const add = (id: string) => !out.includes(id) && out.push(id);
    if (meId) add(meId);
    for (const st of Object.values(states ?? {})) {
      if (st.channel_id === v.channelId) add(st.user_id);
    }
    for (const p of room.participants) add(p.userId);
    return out;
  }, [inVoice, v.channelId, meId, states, room.participants]);

  if (!inVoice || !v.channelId) return null;

  const channelName = channel?.name ?? t("voice.card.title");
  const micDenied = room.permError?.kind === "microphone";
  const micLabel = micDenied ? t("voice.bar.micDenied") : v.selfMute ? t("voice.unmute") : t("voice.mute");
  const hasOwnStream = room.streams.some((x) => x.local);

  return (
    <div className={css.voiceCard} data-testid="voice-card">
      <button
        type="button"
        className={css.voiceCardHead}
        onClick={() => v.guildId && v.channelId && nav(channelPath(v.guildId, v.channelId))}
      >
        <span className={css.voiceCardTitle}>
          <Icon icon={Volume2} size="sm" />
          <span>{channelName}</span>
        </span>
        <span className={css.live}>{t("voice.live")}</span>
      </button>

      <div className={css.voiceCardUsers} aria-hidden="true">
        {ids.map((id) => {
          const m = members?.[id];
          const name = m ? memberName(m.user, m) : id === meId && me ? memberName(me) : id;
          const isSpeaking = speaking.has(id);
          const st = states?.[id];
          const isMuted = st?.self_mute || st?.mute;
          return (
            <div key={id} className={css.voiceCardUser} data-speaking={isSpeaking}>
              <Avatar name={name} avatarId={m?.user.avatar_id ?? (id === meId ? me?.avatar_id : null)} size="sm" speaking={isSpeaking} bg="bg-raised" />
              <span className={css.voiceCardUserName}>{name}</span>
              {isSpeaking && <span className={css.voiceCardSpeakingTag}>{t("voice.card.speaking")}</span>}
              {isMuted && !isSpeaking && <Icon icon={MicOff} size="sm" className={css.voiceCardMutedIcon} />}
            </div>
          );
        })}
      </div>

      <div className={css.voiceCardControls} role="toolbar" aria-label={t("voice.connected")}>
        <Button
          size="sm"
          icon={v.selfMute ? MicOff : Mic}
          kind={v.selfMute || micDenied ? "danger" : "secondary"}
          aria-pressed={v.selfMute}
          onClick={() => (micDenied ? roomUi.set({ permissionOpen: "microphone" }) : void voice.setSelfMute(!v.selfMute))}
        >
          {micLabel}
        </Button>
        {v.capabilities.screenShare && (
          <Button
            size="sm"
            icon={MonitorUp}
            aria-pressed={hasOwnStream}
            onClick={() => roomUi.set({ shareOpen: true })}
          >
            {t("voice.bar.share")}
          </Button>
        )}
        <Button
          size="sm"
          kind="danger"
          icon={PhoneOff}
          onClick={() => void voice.leave()}
        >
          {t("voice.leave")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Mobilde içerik üstünde ince "canlı" bandı (G29 Madde 6).
 * Dokununca ses odasına gider.
 */
export function VoiceLiveStrip() {
  const nav = useNavigate();
  const v = useVoice();
  const room = useRoom();
  const me = useStore((s) => s.me);
  const meId = me?.id;
  const inVoice = v.status === "connected" || v.status === "joining";
  const channel = useStore((s) => (v.guildId && v.channelId ? s.guilds[v.guildId]?.channels[v.channelId] : undefined));
  const states = useStore((s) => (v.guildId ? s.voiceStates[v.guildId] : undefined));

  const count = useMemo(() => {
    if (!inVoice || !v.channelId) return 0;
    const out: string[] = [];
    const add = (id: string) => !out.includes(id) && out.push(id);
    if (meId) add(meId);
    for (const st of Object.values(states ?? {})) {
      if (st.channel_id === v.channelId) add(st.user_id);
    }
    for (const p of room.participants) add(p.userId);
    return out.length;
  }, [inVoice, v.channelId, meId, states, room.participants]);

  if (!inVoice || !v.channelId) return null;

  const channelName = channel?.name ?? t("voice.card.title");

  return (
    <div
      className={css.voiceLiveStrip}
      role="region"
      aria-label={t("voice.connected")}
      onClick={() => v.guildId && v.channelId && nav(channelPath(v.guildId, v.channelId))}
    >
      <div className={css.voiceLiveStripMain}>
        <Icon icon={Volume2} size="sm" />
        <span className={css.voiceLiveStripName}>{channelName}</span>
        <span className={css.live}>{t("voice.live")}</span>
        <span className={css.voiceLiveStripCount}>({count})</span>
      </div>
      <IconButton
        icon={PhoneOff}
        size="sm"
        kind="danger"
        label={t("voice.leave")}
        onClick={(e) => {
          e.stopPropagation();
          void voice.leave();
        }}
      />
    </div>
  );
}
