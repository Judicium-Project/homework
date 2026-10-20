import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Channel } from "@chatapp/api-types";
import { PERMISSIONS } from "@chatapp/api-types";
import { useStore } from "../../store/index.ts";
import { Composer } from "./Composer.tsx";

const user = { id: "me", username: "me", display_name: null, avatar_id: null, banner_id: null, about: null, bot: false };
const channel: Channel = { id: "c1", guild_id: "g1", type: 0, name: "genel", topic: null, position: 0, parent_id: null, permission_overwrites: [], bitrate: null, user_limit: null, last_message_id: null };

function setup(everyone: bigint) {
  useStore.setState({
    me: { ...user, email: "", email_verified: true, instance_admin: false, date_of_birth: "", locale: "tr" },
    guilds: { g1: { id: "g1", name: "G", iconId: null, ownerId: "o", systemChannelId: null, defaultNotifications: 0, memberCount: 1, joinedAt: null, channels: { c1: channel },
      roles: { g1: { id: "g1", name: "@everyone", color: 0, hoist: false, mentionable: false, position: 0, permissions: everyone.toString() } },
      members: { me: { user, nick: null, avatar_id: null, roles: [], joined_at: "", deaf: false, mute: false } } } },
  });
}

describe("yazma alanı", () => {
  it("SEND_MESSAGES yoksa alan kapalı ve açıklama görünür, düğme yok", () => {
    setup(PERMISSIONS.VIEW_CHANNEL);
    render(<Composer guildId="g1" channel={channel} />);
    expect(screen.getByText("Bu kanala mesaj gönderme iznin yok")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByLabelText("Dosya ekle")).toBeNull();
  });
  it("izin varsa metin alanı ve ek düğmesi çizilir", () => {
    setup(PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES | PERMISSIONS.ATTACH_FILES);
    render(<Composer guildId="g1" channel={channel} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByLabelText("Dosya ekle")).toBeInTheDocument();
  });

  it("bayrak true + doğrulanmamış: mesaj gönderme 403 EMAIL_NOT_VERIFIED → açıklama görünür; bayrak false → gönderim başarılı", async () => {
    const { fireEvent, waitFor } = await import("@testing-library/react");
    const { vi } = await import("vitest");
    const { api } = await import("../../api/endpoints.ts");
    const { ApiError } = await import("../../api/client.ts");

    setup(PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES);
    useStore.setState({
      me: { ...user, email: "unverified@example.com", email_verified: false, instance_admin: false, date_of_birth: "", locale: "tr" },
      instance: { name: "ChatApp", registration_mode: "open", email_verification_required: true },
    });

    const sendSpy = vi.spyOn(api, "sendMessage").mockRejectedValueOnce(
      new ApiError(403, {
        code: "FORBIDDEN",
        message: "E-postan doğrulanmamış.",
        errors: [{ field: "", code: "EMAIL_NOT_VERIFIED", message: "E-postanı doğrula" }],
      }),
    );

    render(<Composer guildId="g1" channel={channel} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "Deneme mesajı" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    // Açıklama ve yeniden gönder bağlantısı görünür
    expect(
      await screen.findByText(/E-postanı doğrulayana kadar sunucu\/kanal oluşturamaz ve mesaj gönderemezsin/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Doğrulama e-postasını yeniden gönder" })).toBeInTheDocument();

    // Bayrak false → gönderim başarılı
    sendSpy.mockResolvedValueOnce({
      id: "m1",
      channel_id: "c1",
      guild_id: "g1",
      author: user as any,
      content: "İkinci mesaj",
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      type: 0,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      reactions: [],
      nonce: "n1",
    });

    useStore.setState({
      instance: { name: "ChatApp", registration_mode: "open", email_verification_required: false },
    });

    fireEvent.change(input, { target: { value: "İkinci mesaj" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledTimes(2);
    });
    // Kısıt uyarısı kaybolur
    expect(screen.queryByText(/E-postanı doğrulayana kadar sunucu\/kanal oluşturamaz ve mesaj gönderemezsin/)).toBeNull();
  });
});
