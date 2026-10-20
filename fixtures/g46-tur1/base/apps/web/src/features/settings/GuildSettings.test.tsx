import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { PERMISSIONS } from "@chatapp/api-types";
import { useStore } from "../../store/index.ts";
import GuildSettings from "./GuildSettings.tsx";

vi.mock("../../api/endpoints.ts", () => ({
  api: {
    roleMemberCounts: vi.fn().mockResolvedValue({ g1: 2, r1: 1 }),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    reorderRoles: vi.fn(),
  },
}));

describe("GuildSettings › Roller Bölümü", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();

    useStore.setState({
      me: {
        id: "u-owner",
        username: "owner",
        display_name: "Sunucu Sahibi",
        avatar_id: null,
        banner_id: null,
        about: null,
        bot: false,
        email: "owner@test.com",
        email_verified: true,
        instance_admin: false,
        date_of_birth: "1990-01-01",
        locale: "tr",
      },
      guilds: {
        g1: {
          id: "g1",
          name: "Test Sunucu",
          iconId: null,
          ownerId: "u-owner",
          systemChannelId: null,
          defaultNotifications: 0,
          memberCount: 2,
          joinedAt: null,
          channels: {},
          roles: {
            g1: {
              id: "g1",
              name: "@everyone",
              color: 0,
              hoist: false,
              position: 0,
              permissions: "1024",
              mentionable: false,
            },
            r1: {
              id: "r1",
              name: "Yönetici",
              color: 0xff0000,
              hoist: true,
              position: 1,
              permissions: PERMISSIONS.ADMINISTRATOR.toString(),
              mentionable: true,
            },
          },
          members: {
            "u-owner": {
              user: { id: "u-owner", username: "owner", display_name: "Sunucu Sahibi", avatar_id: null, banner_id: null, about: null, bot: false },
              nick: null,
              avatar_id: null,
              roles: ["r1"],
              joined_at: "",
              deaf: false,
              mute: false,
            },
          },
        },
      },
    });
  });

  const renderWithProviders = (section = "roller") => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <GuildSettings guildId="g1" section={section} onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  it("roller sekmesinde özel rol ve @everyone listelenir; varsayılan olarak özel rol seçilir", async () => {
    renderWithProviders();

    expect(screen.getByRole("button", { name: "Yönetici" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "@everyone" })).toBeInTheDocument();

    // Özel rol seçili olduğunda Görünüm, İzinler ve Üyeler sekmeleri görünür
    expect(screen.getByRole("tab", { name: "Görünüm" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "İzinler" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Üyeler" })).toBeInTheDocument();
  });

  it("@everyone rolüne tıklandığında yalnızca İzinler sekmesi açılır ve form asla boş kalmaz", async () => {
    renderWithProviders();

    // Önce özel rolde Üyeler sekmesine geç
    fireEvent.click(screen.getByRole("tab", { name: "Üyeler" }));
    expect(screen.getByRole("textbox", { name: /Üye ekle/i })).toBeInTheDocument();

    // Şimdi @everyone'a tıkla
    fireEvent.click(screen.getByRole("button", { name: /^@everyone/ }));

    // @everyone için Üyeler ve Görünüm sekmesi olmamalı, yalnızca İzinler olmalı
    expect(screen.queryByRole("tab", { name: "Görünüm" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Üyeler" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "İzinler" })).toBeInTheDocument();

    // İzinler içeriği aktif ve görünür olmalı (boş ekran olmamalı)
    expect(screen.getByText("Kanalı gör")).toBeInTheDocument();
  });

  it("sunucuda yalnız @everyone varken form boş uyarısı yerine doğrudan @everyone izinlerini gösterir", async () => {
    // g1 rollerinden r1'i sil, yalnız @everyone kalsın
    const g = useStore.getState().guilds["g1"];
    useStore.setState({
      guilds: {
        g1: {
          ...g,
          roles: {
            g1: g.roles["g1"],
          },
        },
      },
    });

    renderWithProviders();

    expect(screen.queryByText(/yalnızca @everyone rolü var/i)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "İzinler" })).toBeInTheDocument();
    expect(screen.getByText("Kanalı gör")).toBeInTheDocument();
  });
});
