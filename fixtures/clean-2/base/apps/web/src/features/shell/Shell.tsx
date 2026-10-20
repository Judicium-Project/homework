import { lazy, Suspense, useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Compass, Hash, Plus } from "lucide-react";
import { ChannelType } from "@chatapp/api-types";
import { t } from "../../i18n/index.ts";
import { lastChannelFor, lastGuild, channelPath } from "../../lib/nav.ts";
import { MOBILE_QUERY, NARROW_QUERY, useMedia } from "../../lib/media.ts";
import { resetColorCache } from "../../lib/color.ts";
import { onDispatch } from "../../store/events.ts";
import { firstTextChannel, useChannelTree, useGuild } from "../../store/hooks.ts";
import { useStore } from "../../store/index.ts";
import { useUi } from "../../store/ui.ts";
import { Button } from "../../ui/Button.tsx";
import { MenuHost } from "../../ui/Menu.tsx";
import { Empty, NoAccessCard } from "../../ui/States.tsx";
import { ToastHost } from "../../ui/Toast.tsx";
import "../../voice/backend.ts";
import { reconcileVoiceWithStore, useVoice } from "../../voice/index.ts";
import { VoiceDialogs } from "../voice/Dialogs.tsx";
import { useVoiceShortcuts } from "../voice/shortcuts.ts";
import { VoiceRoom } from "../voice/VoiceRoom.tsx";
import { ChatView } from "../chat/ChatView.tsx";
import { ConnectionFailed, GuildUnavailable, LoadingScreen } from "../status/Screens.tsx";
import { ConnectionStrip } from "./ConnectionStrip.tsx";
import { VerifyBanner } from "./VerifyBanner.tsx";
import { MEMBERS_DRAWER_ID, NAV_DRAWER_ID, NavToggle, useDrawerFocus } from "./Drawers.tsx";
import { ChannelColumn } from "./ChannelList.tsx";
import { MemberPanel } from "./MemberPanel.tsx";
import { ModalHost } from "./ModalHost.tsx";
import { QuickSwitcher } from "./QuickSwitcher.tsx";
import { ServerRail } from "./ServerRail.tsx";
import { UserBar } from "./UserBar.tsx";
import { VoiceCard, VoiceLiveStrip } from "./VoiceCard.tsx";
import css from "./shell.module.css";
import { cx } from "../../ui/cx.ts";

const UserSettings = lazy(() => import("../settings/UserSettings.tsx"));
const GuildSettings = lazy(() => import("../settings/GuildSettings.tsx"));

/** Tema, yazı boyutu, yoğunluk: ayarlardan `<html>`'e. */
export function useApplySettings(): void {
  const settings = useStore((s) => s.settings);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.density = settings.message_density;
    root.style.setProperty("--hk-user-font-scale", String(settings.font_scale || 1));
    try {
      localStorage.setItem("chatapp.theme", settings.theme);
    } catch {
      /* yok say */
    }
    resetColorCache();
    if (settings.theme === "system" && typeof window !== "undefined" && window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => resetColorCache();
      mq.addEventListener?.("change", handler);
      return () => mq.removeEventListener?.("change", handler);
    }
  }, [settings.theme, settings.message_density, settings.font_scale]);
}

/** Ana kabuk (2): gateway READY gelene dek açılış ekranı (12.1) ya da bağlantı kurulamadı (12.4). */
export function Shell() {
  const ready = useStore((s) => s.ready);
  const conn = useStore((s) => s.conn);
  useApplySettings();
  if (!ready) return conn.status === "offline" && !conn.everConnected ? <ConnectionFailed /> : <LoadingScreen />;
  return <ReadyShell />;
}

function ReadyShell() {
  const { guildId } = useParams();
  const { pathname } = useLocation();
  const [sp, setSp] = useSearchParams();
  const membersOpen = useUi((s) => s.membersOpen);
  const membersDrawer = useUi((s) => s.membersDrawer);
  const navOpen = useUi((s) => s.navOpen);
  const quick = useUi((s) => s.quickSwitcher);
  const mobile = useMedia(MOBILE_QUERY);
  const narrow = useMedia(NARROW_QUERY);
  const hasMemberPanel = !!guildId;
  const navRef = useRef<HTMLDivElement>(null);
  const membersRef = useRef<HTMLDivElement>(null);
  const inVoice = useVoice((v) => (v.status === "connected" || v.status === "joining") && v.channelId !== null);

  // Geniş: üye sütunu (tercih). Dar (≤ membersBreakpoint): yalnız istenince çekmece — içerik/kontrol çubuğu örtülmez.
  const membersColumn = hasMemberPanel && !narrow && membersOpen;
  const showRightCol = !narrow && (inVoice || (membersColumn && hasMemberPanel));
  const membersDrawerOpen = (narrow && membersDrawer) || (narrow && !hasMemberPanel && inVoice && membersDrawer);
  const navDrawerOpen = mobile && navOpen;
  const closeNav = () => useUi.getState().setNavOpen(false);
  const closeMembers = () => useUi.getState().setMembersDrawer(false);
  useDrawerFocus(navDrawerOpen, navRef, closeNav);
  useDrawerFocus(membersDrawerOpen, membersRef, closeMembers);

  // Gezinince (kanal/sunucu seçimi) ve kırılım değişince çekmeceler kapanır.
  useEffect(() => {
    const ui = useUi.getState();
    if (ui.navOpen) ui.setNavOpen(false);
    if (ui.membersDrawer) ui.setMembersDrawer(false);
  }, [pathname, mobile, narrow]);

  useVoiceShortcuts();

  // Ctrl/Cmd+K
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLocaleLowerCase("tr") === "k") {
        e.preventDefault();
        const ui = useUi.getState();
        ui.setQuickSwitcher(!ui.quickSwitcher);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Sunucu tarafı ses durumu bu kullanıcıyı kanaldan çıkardıysa (taşıma/atılma) yerel durumu sıfırla.
  useEffect(
    () =>
      onDispatch("VOICE_STATE_UPDATE", (f) => {
        const me = useStore.getState().me?.id;
        if (f.t === "VOICE_STATE_UPDATE" && f.d.user_id === me && f.d.channel_id !== useVoice.getState().channelId) reconcileVoiceWithStore();
      }),
    [],
  );

  const userSection = sp.get("ayarlar");
  const settingsGuild = sp.get("sunucu");
  const closeSettings = () => {
    const next = new URLSearchParams(sp);
    ["ayarlar", "sunucu", "bolum", "sunucu-profil"].forEach((k) => next.delete(k));
    setSp(next, { replace: true });
  };

  return (
    <div className={css.app} data-mobile={mobile || undefined}>
      <a href="#icerik" className={cx(css.skipLink)}>
        <Button size="sm">{t("a11y.skip")}</Button>
      </a>
      <ConnectionStrip />
      <VerifyBanner />
      <div className={css.main} data-members={membersColumn} data-right={showRightCol}>
        <ServerRail />
        <div
          ref={navRef}
          id={NAV_DRAWER_ID}
          className={css.nav}
          data-open={navDrawerOpen}
          role={navDrawerOpen ? "dialog" : undefined}
          aria-modal={navDrawerOpen || undefined}
          aria-label={navDrawerOpen ? t("nav.label") : undefined}
          tabIndex={navDrawerOpen ? -1 : undefined}
          inert={(mobile && !navOpen) || membersDrawerOpen}
          // Zaten açık kanalın bağlantısına dokunmak rota değiştirmez; çekmece yine kapanır.
          onClick={navDrawerOpen ? (e) => (e.target as HTMLElement).closest("a[href]") && closeNav() : undefined}
        >
          <div className={css.left}>
            <ChannelColumn />
            <UserBar />
          </div>
        </div>
        <main id="icerik" className={css.content} tabIndex={-1} inert={navDrawerOpen || membersDrawerOpen}>
          <NavToggle />
          {(mobile || narrow) && inVoice && <VoiceLiveStrip />}
          <Outlet />
        </main>
        {showRightCol && (
          <div className={css.rightCol}>
            {inVoice && <VoiceCard />}
            {membersColumn && guildId && <MemberPanel guildId={guildId} />}
          </div>
        )}
      </div>
      {(navDrawerOpen || membersDrawerOpen) && <div className={css.scrim} aria-hidden="true" onClick={navDrawerOpen ? closeNav : closeMembers} />}
      {membersDrawerOpen && (
        <div ref={membersRef} id={MEMBERS_DRAWER_ID} className={css.membersDrawer} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("members.title")}>
          {inVoice && <VoiceCard />}
          {guildId && <MemberPanel guildId={guildId} />}
        </div>
      )}
      {quick && <QuickSwitcher />}
      <ModalHost />
      <VoiceDialogs />
      <MenuHost />
      <ToastHost />
      <Suspense fallback={null}>
        {userSection && <UserSettings section={userSection} onClose={closeSettings} guildForProfile={sp.get("sunucu-profil")} />}
        {settingsGuild && !userSection && <GuildSettings guildId={settingsGuild} section={sp.get("bolum") ?? "genel"} onClose={closeSettings} />}
      </Suspense>
    </div>
  );
}

// ───────────── rota içerikleri ─────────────

/** `/` → son açılan kanala, yoksa Ana sayfaya. */
export function IndexRedirect() {
  const guilds = useStore((s) => s.guilds);
  const g = lastGuild();
  if (g && guilds[g]) {
    const c = lastChannelFor(g);
    if (c && guilds[g]?.channels[c]) return <Navigate to={channelPath(g, c)} replace />;
    return <Navigate to={`/s/${g}`} replace />;
  }
  const first = Object.keys(guilds)[0];
  return <Navigate to={first ? `/s/${first}` : "/ana"} replace />;
}

/** Ana sayfa (DM sonraki sürüm): hiç sunucu yoksa ilk sunucuyu kurma/katılma çağrısı. */
export function HomeView() {
  const openModal = useUi((s) => s.openModal);
  const count = useStore((s) => s.guildOrder.length);
  return (
    <Empty
      icon={Compass}
      text={count === 0 ? t("home.noGuild") : t("home.pickGuild")}
      action={
        <div className={css.btnRow}>
          <Button kind={count === 0 ? "primary" : "secondary"} icon={Plus} onClick={() => openModal({ kind: "createGuild" })}>
            {t("guild.create.title")}
          </Button>
          <Button onClick={() => openModal({ kind: "joinGuild" })}>{t("guild.join.title")}</Button>
        </div>
      }
    />
  );
}

/** `/s/:guildId` → ilk (ya da son) metin kanalı. */
export function GuildRoute() {
  const { guildId } = useParams();
  const nav = useNavigate();
  const g = useGuild(guildId);
  const tree = useChannelTree(guildId);
  if (!guildId || !g) return <GuildUnavailable suspended={false} onHome={() => nav("/ana")} />;
  if (g.unavailable) return <GuildUnavailable suspended onHome={() => nav("/ana")} />;
  const last = lastChannelFor(guildId);
  const target = (last && g.channels[last] && g.channels[last].type !== ChannelType.GUILD_CATEGORY ? g.channels[last] : undefined) ?? firstTextChannel(tree);
  if (target) return <Navigate to={channelPath(guildId, target.id)} replace />;
  return <Empty icon={Hash} text={t("channels.none")} />;
}

/** `/s/:guildId/:channelId` → metin kanalı (5) ya da ses odası (6). */
export function ChannelRoute() {
  const { guildId, channelId } = useParams();
  const nav = useNavigate();
  const g = useGuild(guildId);
  const tree = useChannelTree(guildId);
  if (!guildId || !channelId || !g) return <GuildUnavailable suspended={false} onHome={() => nav("/ana")} />;
  if (g.unavailable) return <GuildUnavailable suspended onHome={() => nav("/ana")} />;
  const ch = g.channels[channelId];
  const visible = ch && tree && [...tree.uncategorized, ...tree.categories.flatMap((c) => c.children)].some((c) => c.id === ch.id);
  if (!ch || !visible) return <NoAccessCard text={t("channel.noAccess")} onBack={() => nav(`/s/${guildId}`)} />;
  if (ch.type === ChannelType.GUILD_VOICE) return <VoiceRoom guildId={guildId} channelId={ch.id} name={ch.name} />;
  return <ChatView guildId={guildId} channel={ch} />;
}
