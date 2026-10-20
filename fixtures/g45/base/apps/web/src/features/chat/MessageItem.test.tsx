import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useStore } from "../../store/index.ts";
import { MessageItem } from "./MessageItem.tsx";
import type { TimelineMessage } from "../../lib/group.ts";

describe("MessageItem", () => {
  it("bot kullanıcının mesajında belirgin BOT etiketi render edilmelidir", () => {
    useStore.setState({
      me: { id: "me", username: "me", display_name: null, avatar_id: null, banner_id: null, about: null, bot: false, email: "", email_verified: true, instance_admin: false, date_of_birth: "", locale: "tr" },
      guilds: {},
      settings: { theme: "dark", message_density: "cozy", font_scale: 1, developer_mode: false, locale: "tr" },
    });

    const botMessage: TimelineMessage = {
      id: "m_bot_1",
      channel_id: "c1",
      author: {
        id: "bot_1",
        username: "chatapp_bot",
        display_name: "ChatApp Asistan",
        avatar_id: null,
        banner_id: null,
        about: null,
        bot: true,
      },
      content: "Merhaba! Ben bir botum.",
      attachments: [],
      reactions: [],
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      type: 0,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
    };

    render(<MessageItem message={botMessage} head={true} />);

    expect(screen.getByText("ChatApp Asistan")).toBeInTheDocument();
    const botBadge = screen.getByText("BOT");
    expect(botBadge).toBeInTheDocument();
    expect(botBadge.closest("[data-variant]")).toHaveAttribute("data-variant", "bot");
  });

  it("normal kullanıcının mesajında BOT etiketi yer almamalıdır", () => {
    useStore.setState({
      me: { id: "me", username: "me", display_name: null, avatar_id: null, banner_id: null, about: null, bot: false, email: "", email_verified: true, instance_admin: false, date_of_birth: "", locale: "tr" },
      guilds: {},
      settings: { theme: "dark", message_density: "cozy", font_scale: 1, developer_mode: false, locale: "tr" },
    });

    const userMessage: TimelineMessage = {
      id: "m_user_1",
      channel_id: "c1",
      author: {
        id: "user_1",
        username: "ahmet",
        display_name: "Ahmet",
        avatar_id: null,
        banner_id: null,
        about: null,
        bot: false,
      },
      content: "Selam herkese!",
      attachments: [],
      reactions: [],
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      type: 0,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
    };

    render(<MessageItem message={userMessage} head={true} />);

    expect(screen.getByText("Ahmet")).toBeInTheDocument();
    expect(screen.queryByText("BOT")).not.toBeInTheDocument();
  });
});
