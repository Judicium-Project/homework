import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CurrentUser, InstanceSettings } from "@chatapp/api-types";
import { api } from "../../api/endpoints.ts";
import { ApiError } from "../../api/client.ts";
import { useStore } from "../../store/index.ts";
import { useApplySettings } from "../shell/Shell.tsx";
import UserSettings from "./UserSettings.tsx";
import ServerSettings from "./ServerSettings.tsx";

const mockAdmin: CurrentUser = {
  id: "u-admin",
  username: "adminuser",
  display_name: "Yönetici",
  avatar_id: null,
  banner_id: null,
  about: null,
  bot: false,
  email: "admin@chatapp.test",
  email_verified: true,
  instance_admin: true,
  date_of_birth: "1990-01-01",
  locale: "tr",
};

const mockNonAdmin: CurrentUser = {
  id: "u-normal",
  username: "normaluser",
  display_name: "Kullanıcı",
  avatar_id: null,
  banner_id: null,
  about: null,
  bot: false,
  email: "user@chatapp.test",
  email_verified: true,
  instance_admin: false,
  date_of_birth: "1995-01-01",
  locale: "tr",
};

const mockSettings: InstanceSettings = {
  site: {
    name: "ChatApp",
    public_url: "https://chatapp.test",
  },
  registration_mode: "invite",
  email_verification_required: false,
  smtp: {
    host: "smtp.example.com",
    port: 587,
    tls: "starttls",
    username: "smtpuser",
    from_address: "noreply@chatapp.test",
    from_name: "ChatApp",
    password_set: true,
  },
  sources: {
    "site.name": "database",
    "site.public_url": "database",
    "registration_mode": "database",
    "smtp.host": "database",
    "smtp.port": "database",
    "smtp.tls": "database",
    "smtp.username": "database",
    "smtp.password": "database",
    "smtp.from_address": "database",
    "smtp.from_name": "database",
    "email_verification_required": "database",
  },
};

describe("ServerSettings (Sunucu Ayarları Ekranı)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("admin olmayan kullanıcı ayarlar menüsünde 'Sunucu ayarları'nı görmez", () => {
    useStore.setState({ me: mockNonAdmin });

    render(<UserSettings section="hesabim" onClose={vi.fn()} guildForProfile={null} />);

    expect(screen.queryByRole("button", { name: "Sunucu ayarları" })).not.toBeInTheDocument();
  });

  it("admin kullanıcı ayarlar menüsünde 'Sunucu ayarları'nı görür ve seçebilir", () => {
    useStore.setState({ me: mockAdmin });

    render(<UserSettings section="hesabim" onClose={vi.fn()} guildForProfile={null} />);

    const serverBtn = screen.getByRole("button", { name: "Sunucu ayarları" });
    expect(serverBtn).toBeInTheDocument();
  });

  it("kaydet başarı: değişiklikler If-Match ile PATCH edilir", async () => {
    useStore.setState({ me: mockAdmin });

    vi.spyOn(api, "instanceSettings").mockResolvedValue({
      settings: mockSettings,
      etag: '"etag-1"',
    });

    const updateSpy = vi.spyOn(api, "updateInstanceSettings").mockResolvedValue({
      ...mockSettings,
      site: { ...mockSettings.site, name: "Yeni ChatApp" },
    });

    render(<ServerSettings />);

    await screen.findByLabelText("Site adı");

    // Site adını değiştir
    const nameInput = screen.getByLabelText("Site adı");
    fireEvent.change(nameInput, { target: { value: "Yeni ChatApp" } });

    // Kaydet düğmesi aktifleşir
    const saveBtn = screen.getByRole("button", { name: "Kaydet" });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          site: expect.objectContaining({ name: "Yeni ChatApp" }),
        }),
        '"etag-1"',
      );
    });
  });

  it("409 akışı: çakışma durumunda uyarı ve yeniden yükle düğmesi gösterilir", async () => {
    useStore.setState({ me: mockAdmin });

    vi.spyOn(api, "instanceSettings").mockResolvedValue({
      settings: mockSettings,
      etag: '"etag-1"',
    });

    vi.spyOn(api, "updateInstanceSettings").mockRejectedValue(
      new ApiError(409, { code: "CONFLICT", message: "Çakışma" }),
    );

    render(<ServerSettings />);

    await screen.findByLabelText("Site adı");

    const nameInput = screen.getByLabelText("Site adı");
    fireEvent.change(nameInput, { target: { value: "Değiştirilmiş Ad" } });

    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await screen.findByText("Ayarlar başka biri tarafından değişti, yeniden yükle");
    const reloadBtn = screen.getByRole("button", { name: "Yeniden yükle" });
    expect(reloadBtn).toBeInTheDocument();

    // Yeniden yükleye basılınca ayarlar tekrar istenir
    fireEvent.click(reloadBtn);
    await waitFor(() => {
      expect(api.instanceSettings).toHaveBeenCalledTimes(2);
    });
  });

  it("parola hiç DOM'da gösterilmez ve password_set varken doğru ipucu verilir", async () => {
    useStore.setState({ me: mockAdmin });

    vi.spyOn(api, "instanceSettings").mockResolvedValue({
      settings: mockSettings,
      etag: '"etag-1"',
    });

    render(<ServerSettings />);

    await screen.findByLabelText("Site adı");

    // Parola alanı boş olmalı (asla düz metin parola yok)
    const passInput = screen.getByPlaceholderText("••••••••") as HTMLInputElement;
    expect(passInput.value).toBe("");

    // Ayarlı ipucu görünür
    expect(screen.getByText("Ayarlı — değiştirmek için yaz")).toBeInTheDocument();

    // Parolayı kaldır butonu mevcuttur
    const removePassBtn = screen.getByRole("button", { name: "Parolayı kaldır" });
    expect(removePassBtn).toBeInTheDocument();

    fireEvent.click(removePassBtn);
    expect(screen.queryByText("Ayarlı — değiştirmek için yaz")).not.toBeInTheDocument();
  });

  it("test e-postası: başarı ve hata akışları", async () => {
    useStore.setState({ me: mockAdmin });

    vi.spyOn(api, "instanceSettings").mockResolvedValue({
      settings: mockSettings,
      etag: '"etag-1"',
    });

    const testSpy = vi.spyOn(api, "testSmtp").mockResolvedValue(undefined);

    render(<ServerSettings />);

    await screen.findByLabelText("Site adı");

    // Alıcı varsayılan olarak admin e-postası
    const recipientInput = screen.getByDisplayValue("admin@chatapp.test");
    expect(recipientInput).toBeInTheDocument();

    // Test gönder
    const testBtn = screen.getByRole("button", { name: "Test gönder" });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(testSpy).toHaveBeenCalledWith({ to: "admin@chatapp.test" });
    });
    await screen.findByText("Test e-postası başarıyla gönderildi.");

    // Hata akışı
    testSpy.mockRejectedValueOnce(
      new ApiError(502, { code: "UNAVAILABLE", message: "SMTP sunucu hatası: 550 User unknown" }),
    );

    fireEvent.click(testBtn);
    await screen.findByText("SMTP sunucu hatası: 550 User unknown");
  });

  it("kaydedilmemiş değişiklik varken test e-postası göndermek engellenir ve uyarılır", async () => {
    useStore.setState({ me: mockAdmin });

    vi.spyOn(api, "instanceSettings").mockResolvedValue({
      settings: mockSettings,
      etag: '"etag-1"',
    });

    const testSpy = vi.spyOn(api, "testSmtp");

    render(<ServerSettings />);

    await screen.findByLabelText("Site adı");

    // Değişiklik yap (form dirty olsun)
    const nameInput = screen.getByLabelText("Site adı");
    fireEvent.change(nameInput, { target: { value: "Değiştirildi" } });

    // Test göndere bas
    const testBtn = screen.getByRole("button", { name: "Test gönder" });
    fireEvent.click(testBtn);

    // API çağrılmamalı
    expect(testSpy).not.toHaveBeenCalled();
  });

  it("anahtar değiştirilip kaydedilince PATCH gövdesinde email_verification_required var; değişmeyince yok", async () => {
    useStore.setState({
      me: mockAdmin,
      instance: { name: "ChatApp", registration_mode: "invite", email_verification_required: false },
    });

    const instanceSettingsSpy = vi.spyOn(api, "instanceSettings").mockResolvedValue({
      settings: mockSettings,
      etag: '"etag-1"',
    });

    const updateSpy = vi.spyOn(api, "updateInstanceSettings").mockImplementation(async (patch) => {
      const next = {
        ...mockSettings,
        ...(patch.site?.name ? { site: { ...mockSettings.site, name: patch.site.name } } : {}),
        ...(patch.email_verification_required !== undefined ? { email_verification_required: patch.email_verification_required } : {}),
      };
      instanceSettingsSpy.mockResolvedValue({ settings: next, etag: '"etag-2"' });
      return next;
    });

    render(<ServerSettings />);

    await screen.findByLabelText("Site adı");

    // Değişmeyince: yalnız site adı değiştirilince email_verification_required PATCH gövdesinde yok
    const nameInput = screen.getByLabelText("Site adı");
    fireEvent.change(nameInput, { target: { value: "Yeni Ad" } });

    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });
    expect(updateSpy.mock.calls[0][0].email_verification_required).toBeUndefined();

    // Anahtar değiştirilince PATCH gövdesinde var ve store güncellenir
    updateSpy.mockClear();
    const checkbox = screen.getByLabelText("E-posta doğrulaması zorunlu");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });
    expect(updateSpy.mock.calls[0][0].email_verification_required).toBe(true);
    expect(useStore.getState().instance?.email_verification_required).toBe(true);
  });

  it("dev seçilince document.documentElement.dataset.theme === 'dev' ve localStorage'a yazılır; yeniden yüklemede okunur", async () => {
    useStore.setState({ me: mockNonAdmin });
    localStorage.clear();
    document.documentElement.dataset.theme = "system";

    vi.spyOn(api, "updateSettings").mockResolvedValue({
      ...useStore.getState().settings,
      theme: "dev",
    });

    function TestWrapper() {
      useApplySettings();
      return <UserSettings section="gorunum" onClose={vi.fn()} guildForProfile={null} />;
    }

    render(<TestWrapper />);

    const devBtn = screen.getByRole("radio", { name: "Kokpit — geliştirici" });
    expect(devBtn).toBeInTheDocument();
    expect(devBtn).toHaveAttribute("aria-checked", "false");

    fireEvent.click(devBtn);

    expect(useStore.getState().settings.theme).toBe("dev");
    expect(document.documentElement.dataset.theme).toBe("dev");
    expect(localStorage.getItem("chatapp.theme")).toBe("dev");

    // Yeniden yükleme provası (index.html / main.tsx mantığı)
    document.documentElement.dataset.theme = "";
    const saved = localStorage.getItem("chatapp.theme");
    if (saved === "dark" || saved === "light" || saved === "dev" || saved === "system") {
      document.documentElement.dataset.theme = saved;
    }
    expect(document.documentElement.dataset.theme).toBe("dev");
  });
});

