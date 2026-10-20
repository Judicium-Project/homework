/** MSW REST işleyicileri — sözleşmeye (contracts/out/openapi.yaml) uyan sahte uçlar, `db.ts` üzerinde çalışır. */
import { http, HttpResponse, type HttpHandler } from "msw";
import type { Attachment, AuditLogAction, Channel, GuildMember, InviteWithMetadata, Message, Role } from "@chatapp/api-types";
import { ChannelType, PERMISSIONS } from "@chatapp/api-types";
import { cmpId } from "../lib/snowflake.ts";
import { highestPosition, parseBits } from "../lib/perm.ts";
import * as adm from "./adminData.ts";
import { HttpFail, type InviteRec, type MockGuild, newId, server } from "./db.ts";

const P = PERMISSIONS;
type Ctx = { userId: string; params: Record<string, string>; query: URLSearchParams; body: any; headers: Headers; request: Request };
type Handler = (c: Ctx) => unknown | Promise<unknown>;

const NO_CONTENT = Symbol("204");
const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>): never => {
  throw new HttpFail(status, code, message, extra);
};

function guildOf(c: Ctx): MockGuild {
  const g = server.guilds.get(c.params.guildId ?? "");
  if (!g || !g.members.has(c.userId)) return fail(404, "UNKNOWN_GUILD", "Sunucu bulunamadı");
  return g;
}
function need(g: MockGuild, userId: string, bit: bigint, channelId?: string): void {
  if (!server.can(g.id, userId, bit, channelId)) fail(403, "MISSING_PERMISSIONS", "Bu işlem için iznin yok");
}
function channelOf(c: Ctx): { g: MockGuild; ch: Channel } {
  const g = server.guildOfChannel(c.params.channelId ?? "");
  const ch = g?.channels.get(c.params.channelId ?? "");
  if (!g || !ch || !g.members.has(c.userId)) return fail(404, "UNKNOWN_CHANNEL", "Kanal bulunamadı");
  if (!server.can(g.id, c.userId, P.VIEW_CHANNEL, ch.id)) fail(403, "MISSING_PERMISSIONS", "Bu kanalı görme iznin yok");
  return { g, ch };
}
const session = (userId: string) => {
  const t = server.issueToken(userId);
  const acc = server.accounts.get(userId)!;
  return { ...t, token_type: "Bearer" as const, user: acc.user };
};
const calcAge = (dob: string): number => {
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
};
const hierarchyOk = (g: MockGuild, actor: string, targetRoleIds: readonly string[], targetUser?: string): boolean => {
  if (actor === g.ownerId) return true;
  if (targetUser === g.ownerId) return false;
  const rolesRec = Object.fromEntries([...g.roles.values()].map((r) => [r.id, r]));
  const mine = highestPosition({ ownerId: g.ownerId, roles: rolesRec }, actor, g.members.get(actor)?.roles ?? []);
  const theirs = highestPosition({ ownerId: g.ownerId, roles: rolesRec }, targetUser ?? "", targetRoleIds);
  return mine > theirs;
};
const memberView = (m: GuildMember): GuildMember => m;

const A = AuditLogActionNames();
function AuditLogActionNames() {
  return { GUILD_UPDATE: 1, CHANNEL_CREATE: 10, CHANNEL_UPDATE: 11, CHANNEL_DELETE: 12, MEMBER_KICK: 20, MEMBER_BAN_ADD: 22, MEMBER_BAN_REMOVE: 23, MEMBER_ROLE_UPDATE: 25, ROLE_CREATE: 30, ROLE_UPDATE: 31, ROLE_DELETE: 32, INVITE_CREATE: 40, INVITE_DELETE: 42, MESSAGE_DELETE: 72 } as const satisfies Record<string, AuditLogAction>;
}
const reasonOf = (c: Ctx): string | null => {
  const r = c.headers.get("X-Audit-Log-Reason");
  return r ? decodeURIComponent(r) : null;
};

const routes: [method: "get" | "post" | "put" | "patch" | "delete", path: string, auth: boolean, fn: Handler][] = [];
const def = (method: (typeof routes)[number][0], path: string, fn: Handler, auth = true) => routes.push([method, path, auth, fn]);

// ───────────── sağlık / kimlik ─────────────
def("get", "/ready", () => ({ status: "ok", role: "mock", checks: {} }), false);
def("get", "/health", () => ({ status: "ok", role: "mock", version: "mock" }), false);
// ── ilk kurulum (K45)
def("get", "/v1/instance", () => ({
  name: server.siteSettings.name,
  registration_mode: server.registrationMode,
  email_verification_required: server.emailVerificationRequired,
}), false);
def("get", "/v1/setup", () => ({ required: server.setupRequired }), false);
def("post", "/v1/setup", ({ body }) => {
  if (!server.setupRequired) return fail(409, "CONFLICT", "Kurulum zaten tamamlanmış.");
  if (String(body.setup_code).trim() !== server.setupCode) return fail(401, "INVALID_CREDENTIALS", "Kurulum kodu hatalı.");
  const admin = body.admin;
  if (!admin || !admin.email || !admin.username || !admin.password || !admin.date_of_birth) {
    return fail(400, "VALIDATION_FAILED", "Yönetici bilgileri eksik.");
  }
  if (calcAge(admin.date_of_birth) < 18) return fail(422, "UNDERAGE", "Yalnız 18 yaş ve üstü.");
  if (!/^[a-z0-9_.]{2,32}$/.test(String(admin.username).toLocaleLowerCase("tr"))) {
    return fail(400, "VALIDATION_FAILED", "Kullanıcı adı biçimi geçersiz.", { errors: [{ field: "admin.username", message: "Kullanıcı adı biçimi geçersiz." }] });
  }
  if (String(admin.password).length < 8 || String(admin.password).length > 128) {
    return fail(400, "VALIDATION_FAILED", "Parola 8-128 karakter arasında olmalıdır.", { errors: [{ field: "admin.password", message: "Parola 8-128 karakter arasında olmalıdır." }] });
  }
  const site = body.site;
  if (!site || !site.name || !site.public_url) {
    return fail(400, "VALIDATION_FAILED", "Site bilgileri eksik.");
  }
  server.setupRequired = false;
  server.siteSettings = { name: site.name, public_url: site.public_url };
  if (body.smtp) {
    server.smtpSettings = body.smtp;
    if (body.smtp.password) {
      server.smtpPassword = body.smtp.password;
      server.smtpPasswordSet = true;
    }
  }
  const u = server.createAccount({ email: admin.email, username: admin.username, password: admin.password, dob: admin.date_of_birth });
  const acc = server.accounts.get(u.id)!;
  acc.user = { ...acc.user, instance_admin: true, email_verified: true };
  return new HttpResponse(JSON.stringify(session(u.id)), { status: 201, headers: { "Content-Type": "application/json" } });
}, false);

// ── sunucu ayarları (K45)
def("get", "/v1/settings", ({ userId }) => {
  const acc = server.accounts.get(userId);
  if (!acc?.user.instance_admin) return fail(403, "FORBIDDEN", "Yalnızca sunucu yöneticisi erişebilir.");
  const etag = `"${server.instanceSettingsVersion}"`;
  return new HttpResponse(JSON.stringify(server.getInstanceSettings()), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ETag: etag,
    },
  });
});
def("patch", "/v1/settings", ({ userId, headers, body }) => {
  const acc = server.accounts.get(userId);
  if (!acc?.user.instance_admin) return fail(403, "FORBIDDEN", "Yalnızca sunucu yöneticisi erişebilir.");

  const ifMatch = headers.get("If-Match");
  const expectedEtag = `"${server.instanceSettingsVersion}"`;
  if (ifMatch && ifMatch !== expectedEtag && ifMatch !== "*") {
    return fail(409, "CONFLICT", "Ayarlar başka biri tarafından değiştirildi.");
  }

  if (body.site) {
    if (body.site.name !== undefined) {
      const name = String(body.site.name).trim();
      if (!name || name.length > 100) {
        return fail(400, "VALIDATION_FAILED", "Site adı 1-100 karakter olmalıdır.", {
          errors: [{ field: "site.name", message: "Site adı 1-100 karakter olmalıdır." }],
        });
      }
      server.siteSettings.name = name;
      server.sources["site.name"] = "database";
    }
    if (body.site.public_url !== undefined) {
      try {
        const u = new URL(body.site.public_url);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      } catch {
        return fail(400, "VALIDATION_FAILED", "Geçersiz URL.", {
          errors: [{ field: "site.public_url", message: "Geçersiz URL." }],
        });
      }
      server.siteSettings.public_url = body.site.public_url;
      server.sources["site.public_url"] = "database";
    }
  }

  if (body.registration_mode !== undefined) {
    if (!["open", "invite", "closed"].includes(body.registration_mode)) {
      return fail(400, "VALIDATION_FAILED", "Geçersiz kayıt kipi.", {
        errors: [{ field: "registration_mode", message: "Geçersiz kayıt kipi." }],
      });
    }
    server.registrationMode = body.registration_mode;
    server.sources["registration_mode"] = "database";
  }

  if (body.email_verification_required !== undefined) {
    server.emailVerificationRequired = Boolean(body.email_verification_required);
    server.sources["email_verification_required"] = "database";
  }

  if (body.smtp) {
    const curSmtp = ((server.smtpSettings as any) ?? {}) as Record<string, any>;
    if (body.smtp.host !== undefined) {
      curSmtp.host = String(body.smtp.host).trim();
      server.sources["smtp.host"] = "database";
    }
    if (body.smtp.port !== undefined) {
      const port = Number(body.smtp.port);
      if (port < 1 || port > 65535) {
        return fail(400, "VALIDATION_FAILED", "Port 1-65535 arasında olmalıdır.", {
          errors: [{ field: "smtp.port", message: "Port 1-65535 arasında olmalıdır." }],
        });
      }
      curSmtp.port = port;
      server.sources["smtp.port"] = "database";
    }
    if (body.smtp.tls !== undefined) {
      if (!["starttls", "tls", "none"].includes(body.smtp.tls)) {
        return fail(400, "VALIDATION_FAILED", "Geçersiz TLS türü.", {
          errors: [{ field: "smtp.tls", message: "Geçersiz TLS türü." }],
        });
      }
      curSmtp.tls = body.smtp.tls;
      server.sources["smtp.tls"] = "database";
    }
    if (body.smtp.username !== undefined) {
      curSmtp.username = String(body.smtp.username).trim();
      server.sources["smtp.username"] = "database";
    }
    if (body.smtp.password !== undefined) {
      if (body.smtp.password === "") {
        server.smtpPassword = "";
        server.smtpPasswordSet = false;
        server.sources["smtp.password"] = "database";
      } else {
        server.smtpPassword = body.smtp.password;
        server.smtpPasswordSet = true;
        server.sources["smtp.password"] = "database";
      }
    }
    if (body.smtp.from_address !== undefined) {
      if (!body.smtp.from_address.includes("@") || /[\r\n]/.test(body.smtp.from_address)) {
        return fail(400, "VALIDATION_FAILED", "Geçersiz gönderen e-posta adresi.", {
          errors: [{ field: "smtp.from_address", message: "Geçersiz gönderen e-posta adresi." }],
        });
      }
      curSmtp.from_address = String(body.smtp.from_address).trim();
      server.sources["smtp.from_address"] = "database";
    }
    if (body.smtp.from_name !== undefined) {
      curSmtp.from_name = String(body.smtp.from_name).trim();
      server.sources["smtp.from_name"] = "database";
    }
    server.smtpSettings = curSmtp;
  }

  server.instanceSettingsVersion++;
  const nextEtag = `"${server.instanceSettingsVersion}"`;
  return new HttpResponse(JSON.stringify(server.getInstanceSettings()), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ETag: nextEtag,
    },
  });
});
def("post", "/v1/settings/smtp/test", ({ userId, body }) => {
  const acc = server.accounts.get(userId);
  if (!acc?.user.instance_admin) return fail(403, "FORBIDDEN", "Yalnızca sunucu yöneticisi erişebilir.");

  const to = String(body?.to ?? "").trim();
  if (!to || !to.includes("@") || /[\r\n]/.test(to)) {
    return fail(400, "VALIDATION_FAILED", "Geçersiz alıcı e-posta adresi.", {
      errors: [{ field: "to", message: "Geçersiz alıcı e-posta adresi." }],
    });
  }
  if (to === "fail@example.com") {
    return fail(502, "UNAVAILABLE", "SMTP sunucu hatası: 550 User unknown");
  }

  return NO_CONTENT;
});
def("post", "/v1/auth/beta-codes/check", ({ body }) => ({ state: server.betaCodes.get(String(body.code).trim().toLocaleUpperCase("tr"))?.state ?? "invalid" }), false);
def("get", "/v1/auth/username-available", ({ query }) => {
  const u = (query.get("username") ?? "").toLocaleLowerCase("tr");
  const taken = [...server.accounts.values()].some((a) => a.user.username.toLocaleLowerCase("tr") === u);
  return { available: !taken && /^[a-z0-9_.]{2,32}$/.test(u), suggestions: taken ? [`${u}1`, `${u}_`, `${u}.halka`] : [] };
}, false);
def("post", "/v1/auth/register", ({ body }) => {
  const code = String(body.invite_code ?? "").trim().toLocaleUpperCase("tr");
  const st = server.betaCodes.get(code)?.state ?? "invalid";
  if (st !== "valid") return fail(400, st === "expired" ? "BETA_CODE_EXPIRED" : st === "exhausted" ? "BETA_CODE_EXHAUSTED" : "BETA_CODE_INVALID", "Davet kodu geçersiz");
  if (!body.consents?.adult || calcAge(body.date_of_birth) < 18) return fail(400, "UNDERAGE", "Yalnız 18 yaş ve üstü");
  if (!body.consents?.terms || !body.consents?.privacy) return fail(400, "VALIDATION_FAILED", "Onaylar eksik");
  if ([...server.accounts.values()].some((a) => a.user.username.toLocaleLowerCase("tr") === String(body.username).toLocaleLowerCase("tr"))) return fail(409, "USERNAME_TAKEN", "Kullanıcı adı dolu");
  if ([...server.accounts.values()].some((a) => a.user.email.toLocaleLowerCase("tr") === String(body.email).toLocaleLowerCase("tr"))) return fail(409, "EMAIL_TAKEN", "E-posta kayıtlı");
  const u = server.createAccount({ email: body.email, username: body.username, password: body.password, display_name: body.display_name, dob: body.date_of_birth });
  return new HttpResponse(JSON.stringify(session(u.id)), { status: 201, headers: { "Content-Type": "application/json" } });
}, false);
def("post", "/v1/auth/login", ({ body }) => {
  const a = [...server.accounts.values()].find((x) => x.user.email.toLocaleLowerCase("tr") === String(body.email).toLocaleLowerCase("tr"));
  if (!a || a.password !== body.password) return fail(401, "INVALID_CREDENTIALS", "E-posta ya da parola hatalı");
  if (a.suspended) return fail(403, "ACCOUNT_SUSPENDED", "Hesap askıda", { suspended_until: null });
  return session(a.user.id);
}, false);
def("post", "/v1/auth/refresh", () => (server.refreshUser ? session(server.refreshUser) : fail(401, "UNAUTHORIZED", "Oturum yok")), false);
def("post", "/v1/auth/logout", () => {
  server.refreshUser = null;
  return NO_CONTENT;
}, false);
def("get", "/v1/gateway", () => ({ url: "mock://gateway" }));
// K1 hesap: e-posta doğrulama / parola sıfırlama / aktif oturumlar (mock: "gecersiz" token hata verir).
def("post", "/v1/auth/email/verify", ({ body }) => {
  if (body.token === "gecersiz") return fail(422, "VALIDATION_FAILED", "Bağlantı geçersiz.", { errors: [{ field: "token", code: "LINK_INVALID", message: "Bağlantı geçersiz." }] });
  if (body.token === "eski") return fail(422, "VALIDATION_FAILED", "Bağlantının süresi dolmuş.", { errors: [{ field: "token", code: "LINK_EXPIRED", message: "Bağlantının süresi dolmuş." }] });
  for (const a of server.accounts.values()) a.user = { ...a.user, email_verified: true };
  if (server.refreshUser) server.emitUser(server.refreshUser, "USER_UPDATE", server.accounts.get(server.refreshUser)!.user);
  return NO_CONTENT;
}, false);
def("post", "/v1/auth/email/resend", () => NO_CONTENT);
def("post", "/v1/auth/password/forgot", () => new HttpResponse(null, { status: 202 }), false);
def("post", "/v1/auth/password/reset", ({ body }) => (body.token === "gecersiz" ? fail(422, "VALIDATION_FAILED", "Bağlantı geçersiz.", { errors: [{ field: "token", code: "LINK_INVALID", message: "Bağlantı geçersiz." }] }) : NO_CONTENT), false);
const mockSessions = () => [
  { id: "9001", family_id: "9001", user_agent: navigator.userAgent, ip_prefix: "127.0.0.x", created_at: new Date(Date.now() - 864e5).toISOString(), last_used_at: new Date().toISOString(), current: true, grace_sibling: false },
  { id: "9002", family_id: "9002", user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari/605.1.15", ip_prefix: "88.240.12.x", created_at: new Date(Date.now() - 6048e5).toISOString(), last_used_at: new Date(Date.now() - 36e5).toISOString(), current: false, grace_sibling: false },
];
def("get", "/v1/auth/sessions", () => mockSessions());
def("delete", "/v1/auth/sessions/:sessionId", () => NO_CONTENT);
def("post", "/v1/auth/sessions/revoke-others", () => ({ revoked: 1 }));

// ───────────── kullanıcı ─────────────
def("get", "/v1/users/@me", ({ userId }) => server.accounts.get(userId)?.user);
def("patch", "/v1/users/@me", ({ userId, body }) => {
  const a = server.accounts.get(userId)!;
  a.user = { ...a.user, ...Object.fromEntries(Object.entries(body).filter(([k]) => ["display_name", "about", "avatar_id", "banner_id"].includes(k))) };
  for (const g of server.guilds.values()) {
    const m = g.members.get(userId);
    if (m) m.user = server.publicUser(userId);
  }
  server.emitUser(userId, "USER_UPDATE", a.user);
  for (const g of server.guilds.values()) if (g.members.has(userId)) server.emitGuild(g.id, "GUILD_MEMBER_UPDATE", { ...g.members.get(userId)!, guild_id: g.id });
  return a.user;
});
def("get", "/v1/users/@me/guilds", ({ userId }) => [...server.guilds.values()].filter((g) => g.members.has(userId)).map(guildView));
def("delete", "/v1/users/@me/guilds/:guildId", (c) => {
  const g = guildOf(c);
  if (g.ownerId === c.userId) return fail(403, "OWNER_CANNOT_LEAVE", "Önce sahipliği devret");
  server.removeMemberEverywhere(g.id, c.userId);
  return NO_CONTENT;
});
def("get", "/v1/users/@me/read-states", ({ userId }) => [...(server.accounts.get(userId)?.readStates.values() ?? [])]);
def("get", "/v1/users/@me/settings", ({ userId }) => server.accounts.get(userId)?.settings);
def("patch", "/v1/users/@me/settings", ({ userId, body }) => {
  const a = server.accounts.get(userId)!;
  a.settings = { ...a.settings, ...body };
  server.emitUser(userId, "USER_SETTINGS_UPDATE", a.settings);
  return a.settings;
});
def("get", "/v1/users/:userId", ({ params }) => server.publicUser(params.userId ?? ""));

// ───────────── sunucu ─────────────
const guildView = (g: MockGuild) => ({
  id: g.id, name: g.name, icon_id: g.iconId, owner_id: g.ownerId, system_channel_id: g.systemChannelId,
  default_message_notifications: g.defaultNotifications, approximate_member_count: g.members.size,
  approximate_presence_count: [...g.members.keys()].filter((u) => server.presenceOf(u) !== "offline").length,
});
def("post", "/v1/guilds", ({ userId, body }) => {
  const acc = server.accounts.get(userId);
  if (server.emailVerificationRequired && acc && !acc.user.email_verified) {
    return fail(403, "FORBIDDEN", "E-postanı doğrulayana kadar sunucu/kanal oluşturamaz ve mesaj gönderemezsin.", {
      errors: [{ field: "", code: "EMAIL_NOT_VERIFIED", message: "E-postanı doğrulayana kadar sunucu/kanal oluşturamaz ve mesaj gönderemezsin." }],
    });
  }
  if ([...server.guilds.values()].filter((g) => g.ownerId === userId).length >= 20) return fail(403, "GUILD_LIMIT_REACHED", "Sunucu sınırına ulaştın");
  const g = server.createGuild(userId, String(body.name).trim(), body.template ?? "empty", body.icon_id ?? null);
  const gg = server.gatewayGuild(g);
  queueMicrotask(() => server.emitUser(userId, "GUILD_CREATE", gg));
  return new HttpResponse(JSON.stringify(gg), { status: 201, headers: { "Content-Type": "application/json" } });
});
def("get", "/v1/guilds/:guildId", (c) => guildView(guildOf(c)));
def("patch", "/v1/guilds/:guildId", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.MANAGE_GUILD);
  const ch: { key: string; old_value?: unknown; new_value?: unknown }[] = [];
  if (c.body.name !== undefined) { ch.push({ key: "name", old_value: g.name, new_value: c.body.name }); g.name = c.body.name; }
  if (c.body.icon_id !== undefined) g.iconId = c.body.icon_id;
  if (c.body.system_channel_id !== undefined) g.systemChannelId = c.body.system_channel_id;
  if (c.body.default_message_notifications !== undefined) g.defaultNotifications = c.body.default_message_notifications;
  server.audit(g, c.userId, A.GUILD_UPDATE, g.id, ch);
  server.emitGuild(g.id, "GUILD_UPDATE", guildView(g));
  return guildView(g);
});
def("delete", "/v1/guilds/:guildId", (c) => {
  const g = guildOf(c);
  if (g.ownerId !== c.userId) return fail(403, "FORBIDDEN", "Yalnız sahip silebilir");
  server.emitGuild(g.id, "GUILD_DELETE", { id: g.id });
  server.guilds.delete(g.id);
  return NO_CONTENT;
});
def("post", "/v1/guilds/:guildId/ack", (c) => {
  const g = guildOf(c);
  const acc = server.accounts.get(c.userId)!;
  for (const ch of g.channels.values()) if (ch.last_message_id) acc.readStates.set(ch.id, { channel_id: ch.id, last_read_message_id: ch.last_message_id, mention_count: 0 });
  return NO_CONTENT;
});
def("post", "/v1/guilds/:guildId/transfer-ownership", (c) => {
  const g = guildOf(c);
  if (g.ownerId !== c.userId) return fail(403, "FORBIDDEN", "Yalnız sahip devredebilir");
  if (!g.members.has(c.body.new_owner_id)) return fail(404, "UNKNOWN_MEMBER", "Üye yok");
  g.ownerId = c.body.new_owner_id;
  server.emitGuild(g.id, "GUILD_UPDATE", guildView(g));
  return guildView(g);
});

// ───────────── kanal ─────────────
def("get", "/v1/guilds/:guildId/channels", (c) => [...guildOf(c).channels.values()].filter((ch) => server.can(c.params.guildId!, c.userId, P.VIEW_CHANNEL, ch.id)));
def("post", "/v1/guilds/:guildId/channels", (c) => {
  const acc = server.accounts.get(c.userId);
  if (server.emailVerificationRequired && acc && !acc.user.email_verified) {
    return fail(403, "FORBIDDEN", "E-postanı doğrulayana kadar sunucu/kanal oluşturamaz ve mesaj gönderemezsin.", {
      errors: [{ field: "", code: "EMAIL_NOT_VERIFIED", message: "E-postanı doğrulayana kadar sunucu/kanal oluşturamaz ve mesaj gönderemezsin." }],
    });
  }
  const g = guildOf(c);
  need(g, c.userId, P.MANAGE_CHANNELS);
  const ch = server.makeChannel(g, { ...c.body, permission_overwrites: (c.body.permission_overwrites ?? []).map((o: any) => ({ id: o.id, type: o.type, allow: o.allow ?? "0", deny: o.deny ?? "0" })) });
  server.audit(g, c.userId, A.CHANNEL_CREATE, ch.id, [{ key: "name", new_value: ch.name }]);
  server.emitGuild(g.id, "CHANNEL_CREATE", ch);
  return new HttpResponse(JSON.stringify(ch), { status: 201, headers: { "Content-Type": "application/json" } });
});
def("patch", "/v1/guilds/:guildId/channels", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.MANAGE_CHANNELS);
  for (const p of c.body as { id: string; position: number; parent_id?: string | null }[]) {
    const ch = g.channels.get(p.id);
    if (!ch) continue;
    ch.position = p.position;
    if (p.parent_id !== undefined) ch.parent_id = p.parent_id;
    server.emitGuild(g.id, "CHANNEL_UPDATE", ch);
  }
  return NO_CONTENT;
});
def("get", "/v1/channels/:channelId", (c) => channelOf(c).ch);
def("patch", "/v1/channels/:channelId", (c) => {
  const { g, ch } = channelOf(c);
  need(g, c.userId, P.MANAGE_CHANNELS);
  Object.assign(ch, Object.fromEntries(Object.entries(c.body).filter(([k]) => ["name", "topic", "parent_id", "position", "bitrate", "user_limit"].includes(k))));
  if (c.body.permission_overwrites) ch.permission_overwrites = c.body.permission_overwrites.map((o: any) => ({ id: o.id, type: o.type, allow: o.allow ?? "0", deny: o.deny ?? "0" }));
  if (c.body.lock_permissions && ch.parent_id) ch.permission_overwrites = [...(g.channels.get(ch.parent_id)?.permission_overwrites ?? [])];
  server.audit(g, c.userId, A.CHANNEL_UPDATE, ch.id, Object.keys(c.body).map((k) => ({ key: k, new_value: c.body[k] })));
  server.emitGuild(g.id, "CHANNEL_UPDATE", ch);
  return ch;
});
def("delete", "/v1/channels/:channelId", (c) => {
  const { g, ch } = channelOf(c);
  need(g, c.userId, P.MANAGE_CHANNELS);
  g.channels.delete(ch.id);
  for (const k of g.channels.values()) if (k.parent_id === ch.id) k.parent_id = null;
  server.audit(g, c.userId, A.CHANNEL_DELETE, ch.id, [{ key: "name", old_value: ch.name }]);
  server.emitGuild(g.id, "CHANNEL_DELETE", ch);
  return NO_CONTENT;
});
def("put", "/v1/channels/:channelId/permissions/:overwriteId", (c) => {
  const { g, ch } = channelOf(c);
  need(g, c.userId, P.MANAGE_ROLES, ch.id);
  const id = c.params.overwriteId!;
  const ow = { id, type: c.body.type, allow: c.body.allow ?? "0", deny: c.body.deny ?? "0" };
  ch.permission_overwrites = [...ch.permission_overwrites.filter((o) => o.id !== id), ow];
  server.audit(g, c.userId, 14, ch.id, [{ key: "overwrite", new_value: ow }]);
  server.emitGuild(g.id, "CHANNEL_UPDATE", ch);
  return NO_CONTENT;
});
def("delete", "/v1/channels/:channelId/permissions/:overwriteId", (c) => {
  const { g, ch } = channelOf(c);
  need(g, c.userId, P.MANAGE_ROLES, ch.id);
  ch.permission_overwrites = ch.permission_overwrites.filter((o) => o.id !== c.params.overwriteId);
  server.audit(g, c.userId, 15, ch.id);
  server.emitGuild(g.id, "CHANNEL_UPDATE", ch);
  return NO_CONTENT;
});

// ───────────── mesaj ─────────────
def("get", "/v1/channels/:channelId/messages", (c) => {
  const { g, ch } = channelOf(c);
  need(g, c.userId, P.READ_MESSAGE_HISTORY, ch.id);
  const all = server.messages.get(ch.id) ?? [];
  const limit = Math.min(100, Number(c.query.get("limit") ?? 50));
  const before = c.query.get("before");
  const after = c.query.get("after");
  let list = all;
  if (before) list = all.filter((m) => cmpId(m.id, before) < 0).slice(-limit);
  else if (after) list = all.filter((m) => cmpId(m.id, after) > 0).slice(0, limit);
  else list = all.slice(-limit);
  return [...list].reverse().map((m) => server.withReactions(m, c.userId));
});
def("post", "/v1/channels/:channelId/messages", async (c) => {
  const acc = server.accounts.get(c.userId);
  if (server.emailVerificationRequired && acc && !acc.user.email_verified) {
    return fail(403, "FORBIDDEN", "E-postanı doğrulayana kadar sunucu/kanal oluşturamaz ve mesaj gönderemezsin.", {
      errors: [{ field: "", code: "EMAIL_NOT_VERIFIED", message: "E-postanı doğrulayana kadar sunucu/kanal oluşturamaz ve mesaj gönderemezsin." }],
    });
  }
  const { g, ch } = channelOf(c);
  need(g, c.userId, P.SEND_MESSAGES, ch.id);
  const content = String(c.body.content ?? "");
  const ids: string[] = c.body.attachment_ids ?? [];
  if (!content.trim() && ids.length === 0) return fail(400, "VALIDATION_FAILED", "Mesaj boş olamaz");
  if (content.length > 4000) return fail(400, "VALIDATION_FAILED", "Mesaj çok uzun");
  if (ids.length) need(g, c.userId, P.ATTACH_FILES, ch.id);
  if (c.body.nonce) {
    const dup = (server.messages.get(ch.id) ?? []).find((m) => m.nonce === c.body.nonce && m.author.id === c.userId);
    if (dup) return server.withReactions(dup, c.userId);
  }
  const attachments = ids.map((id) => server.attachments.get(id)).filter((a): a is NonNullable<typeof a> => !!a && a.ownerId === c.userId).map(publicAttachment);
  const ref = c.body.message_reference;
  const msg = server.pushMessage(ch.id, c.userId, content, ref ? 19 : 0, {
    nonce: c.body.nonce, attachments, ...(ref ? { message_reference: { message_id: ref.message_id, channel_id: ch.id, guild_id: g.id } } : {}),
  });
  scheduleBot(ch.id, c.userId, content);
  return server.withReactions(msg, c.userId);
});
def("get", "/v1/channels/:channelId/messages/:messageId", (c) => {
  const { ch } = channelOf(c);
  const m = server.messages.get(ch.id)?.find((x) => x.id === c.params.messageId);
  return m ? server.withReactions(m, c.userId) : fail(404, "UNKNOWN_MESSAGE", "Mesaj yok");
});
def("patch", "/v1/channels/:channelId/messages/:messageId", (c) => {
  const { g, ch } = channelOf(c);
  const m = server.messages.get(ch.id)?.find((x) => x.id === c.params.messageId);
  if (!m) return fail(404, "UNKNOWN_MESSAGE", "Mesaj yok");
  if (m.author.id !== c.userId) return fail(403, "FORBIDDEN", "Yalnız yazar düzenler");
  m.content = c.body.content;
  m.edited_timestamp = new Date().toISOString();
  server.emitGuild(g.id, "MESSAGE_UPDATE", server.withReactions(m, c.userId), ch.id);
  return server.withReactions(m, c.userId);
});
def("delete", "/v1/channels/:channelId/messages/:messageId", (c) => {
  const { g, ch } = channelOf(c);
  const list = server.messages.get(ch.id) ?? [];
  const i = list.findIndex((x) => x.id === c.params.messageId);
  const m = list[i];
  if (!m) return fail(404, "UNKNOWN_MESSAGE", "Mesaj yok");
  if (m.author.id !== c.userId) {
    need(g, c.userId, P.MANAGE_MESSAGES, ch.id);
    server.audit(g, c.userId, A.MESSAGE_DELETE, m.author.id, [], reasonOf(c));
  }
  list.splice(i, 1);
  server.emitGuild(g.id, "MESSAGE_DELETE", { id: m.id, channel_id: ch.id, guild_id: g.id }, ch.id);
  return NO_CONTENT;
});
def("post", "/v1/channels/:channelId/messages/:messageId/ack", (c) => {
  const { ch } = channelOf(c);
  const rs = { channel_id: ch.id, last_read_message_id: c.params.messageId ?? null, mention_count: 0 };
  server.accounts.get(c.userId)?.readStates.set(ch.id, rs);
  server.emitUser(c.userId, "MESSAGE_ACK", { channel_id: ch.id, message_id: c.params.messageId, mention_count: 0 });
  return NO_CONTENT;
});
const reactionPath = "/v1/channels/:channelId/messages/:messageId/reactions/:emoji";
def("put", `${reactionPath}/@me`, (c) => reaction(c, true));
def("delete", `${reactionPath}/@me`, (c) => reaction(c, false));
function reaction(c: Ctx, add: boolean): symbol {
  const { g, ch } = channelOf(c);
  if (add) need(g, c.userId, P.ADD_REACTIONS, ch.id);
  const emoji = decodeURIComponent(c.params.emoji ?? "");
  const mid = c.params.messageId!;
  const byEmoji = server.reactions.get(mid) ?? new Map<string, Set<string>>();
  server.reactions.set(mid, byEmoji);
  const set = byEmoji.get(emoji) ?? new Set<string>();
  byEmoji.set(emoji, set);
  if (add) set.add(c.userId);
  else set.delete(c.userId);
  server.emitGuild(g.id, add ? "MESSAGE_REACTION_ADD" : "MESSAGE_REACTION_REMOVE", { user_id: c.userId, channel_id: ch.id, message_id: mid, guild_id: g.id, emoji: { id: null, name: emoji } }, ch.id);
  return NO_CONTENT;
}
def("get", `${reactionPath}`, (c) => [...(server.reactions.get(c.params.messageId ?? "")?.get(decodeURIComponent(c.params.emoji ?? "")) ?? [])].map((u) => server.publicUser(u)));
def("post", "/v1/channels/:channelId/typing", (c) => {
  const { g, ch } = channelOf(c);
  need(g, c.userId, P.SEND_MESSAGES, ch.id);
  server.emitGuild(g.id, "TYPING_START", { channel_id: ch.id, guild_id: g.id, user_id: c.userId, timestamp: Math.floor(Date.now() / 1000) }, ch.id);
  return NO_CONTENT;
});

// ───────────── ek ─────────────
const publicAttachment = (a: Attachment): Attachment => ({ id: a.id, filename: a.filename, content_type: a.content_type, size: a.size, url: `/mock-files/${a.id}`, url_expires_at: null, width: a.width, height: a.height, status: a.status });
def("post", "/v1/attachments", (c) => {
  if (c.body.size > 25 * 1024 * 1024) return fail(413, "FILE_TOO_LARGE", "Dosya çok büyük");
  const id = newId();
  server.attachments.set(id, { id, filename: c.body.filename, content_type: c.body.content_type, size: c.body.size, url: null, url_expires_at: null, width: null, height: null, status: "pending", channelId: c.body.channel_id, ownerId: c.userId, purpose: c.body.purpose });
  return new HttpResponse(JSON.stringify({ attachment_id: id, upload_url: `${location.origin}/mock-upload/${id}`, upload_method: "PUT", upload_headers: {}, expires_at: new Date(Date.now() + 900_000).toISOString() }), { status: 201, headers: { "Content-Type": "application/json" } });
});
def("post", "/v1/attachments/:id/complete", (c) => {
  const a = server.attachments.get(c.params.id ?? "");
  if (!a || a.ownerId !== c.userId) return fail(404, "UNKNOWN_ATTACHMENT", "Ek yok");
  a.status = "ready";
  if (c.body?.width) { a.width = c.body.width; a.height = c.body.height; }
  return publicAttachment(a);
});
def("get", "/v1/attachments/:id/url", (c) => ({ url: `/mock-files/${c.params.id}`, expires_at: new Date(Date.now() + 900_000).toISOString() }));

// ───────────── rol ─────────────
def("get", "/v1/guilds/:guildId/roles", (c) => [...guildOf(c).roles.values()]);
def("post", "/v1/guilds/:guildId/roles", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.MANAGE_ROLES);
  const r = server.makeRole(g, { name: c.body.name ?? "yeni rol", color: c.body.color, hoist: c.body.hoist, mentionable: c.body.mentionable, permissions: c.body.permissions ?? "0" });
  server.audit(g, c.userId, A.ROLE_CREATE, r.id, [{ key: "name", new_value: r.name }]);
  server.emitGuild(g.id, "GUILD_ROLE_CREATE", { guild_id: g.id, role: r });
  return new HttpResponse(JSON.stringify(r), { status: 201, headers: { "Content-Type": "application/json" } });
});
def("patch", "/v1/guilds/:guildId/roles", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.MANAGE_ROLES);
  for (const p of c.body as { id: string; position: number }[]) {
    const r = g.roles.get(p.id);
    if (r && r.id !== g.id) {
      r.position = p.position;
      server.emitGuild(g.id, "GUILD_ROLE_UPDATE", { guild_id: g.id, role: r });
    }
  }
  return [...g.roles.values()];
});
def("get", "/v1/guilds/:guildId/roles/member-counts", (c) => {
  const g = guildOf(c);
  const out: Record<string, number> = { [g.id]: g.members.size };
  for (const m of g.members.values()) for (const r of m.roles) out[r] = (out[r] ?? 0) + 1;
  return out;
});
def("patch", "/v1/guilds/:guildId/roles/:roleId", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.MANAGE_ROLES);
  const r = g.roles.get(c.params.roleId ?? "");
  if (!r) return fail(404, "UNKNOWN_ROLE", "Rol yok");
  if (r.id !== g.id && c.userId !== g.ownerId && !hierarchyOk(g, c.userId, [r.id])) return fail(403, "ROLE_HIERARCHY", "Bu rol senin rolünün üstünde");
  const next: Role = { ...r, ...Object.fromEntries(Object.entries(c.body).filter(([k]) => ["name", "permissions", "color", "hoist", "mentionable"].includes(k))) };
  g.roles.set(r.id, next);
  server.audit(g, c.userId, A.ROLE_UPDATE, r.id, Object.keys(c.body).map((k) => ({ key: k, old_value: (r as any)[k], new_value: c.body[k] })));
  server.emitGuild(g.id, "GUILD_ROLE_UPDATE", { guild_id: g.id, role: next });
  return next;
});
def("delete", "/v1/guilds/:guildId/roles/:roleId", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.MANAGE_ROLES);
  const id = c.params.roleId ?? "";
  if (id === g.id) return fail(400, "BAD_REQUEST", "@everyone silinemez");
  g.roles.delete(id);
  for (const m of g.members.values()) m.roles = m.roles.filter((x) => x !== id);
  for (const ch of g.channels.values()) ch.permission_overwrites = ch.permission_overwrites.filter((o) => o.id !== id);
  server.audit(g, c.userId, A.ROLE_DELETE, id);
  server.emitGuild(g.id, "GUILD_ROLE_DELETE", { guild_id: g.id, role_id: id });
  return NO_CONTENT;
});

// ───────────── üye ─────────────
def("get", "/v1/guilds/:guildId/members", (c) => {
  const g = guildOf(c);
  const q = (c.query.get("query") ?? "").toLocaleLowerCase("tr");
  const role = c.query.get("role_id");
  const after = c.query.get("after");
  return [...g.members.values()]
    .filter((m) => (!q || [m.user.username, m.user.display_name ?? "", m.nick ?? ""].some((s) => s.toLocaleLowerCase("tr").startsWith(q))) && (!role || m.roles.includes(role)) && (!after || cmpId(m.user.id, after) > 0))
    .sort((a, b) => cmpId(a.user.id, b.user.id))
    .slice(0, Number(c.query.get("limit") ?? 100))
    .map(memberView);
});
def("patch", "/v1/guilds/:guildId/members/@me", (c) => {
  const g = guildOf(c);
  const m = g.members.get(c.userId)!;
  if (c.body.nick !== undefined) { need(g, c.userId, P.CHANGE_NICKNAME); m.nick = c.body.nick; }
  server.emitGuild(g.id, "GUILD_MEMBER_UPDATE", { ...m, guild_id: g.id });
  return m;
});
def("get", "/v1/guilds/:guildId/members/:userId", (c) => guildOf(c).members.get(c.params.userId ?? "") ?? fail(404, "UNKNOWN_MEMBER", "Üye yok"));
def("patch", "/v1/guilds/:guildId/members/:userId", (c) => {
  const g = guildOf(c);
  const m = g.members.get(c.params.userId ?? "");
  if (!m) return fail(404, "UNKNOWN_MEMBER", "Üye yok");
  if (c.body.nick !== undefined) { need(g, c.userId, P.MANAGE_NICKNAMES); m.nick = c.body.nick; }
  if (c.body.roles !== undefined) { need(g, c.userId, P.MANAGE_ROLES); m.roles = c.body.roles; }
  server.emitGuild(g.id, "GUILD_MEMBER_UPDATE", { ...m, guild_id: g.id });
  return m;
});
def("delete", "/v1/guilds/:guildId/members/:userId", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.KICK_MEMBERS);
  const m = g.members.get(c.params.userId ?? "");
  if (!m) return fail(404, "UNKNOWN_MEMBER", "Üye yok");
  if (!hierarchyOk(g, c.userId, m.roles, m.user.id)) return fail(403, "ROLE_HIERARCHY", "Bu üyeye işlem yapamazsın");
  server.audit(g, c.userId, A.MEMBER_KICK, m.user.id, [], reasonOf(c));
  server.removeMemberEverywhere(g.id, m.user.id);
  return NO_CONTENT;
});
const roleToggle = (add: boolean): Handler => (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.MANAGE_ROLES);
  const m = g.members.get(c.params.userId ?? "");
  if (!m || !g.roles.has(c.params.roleId ?? "")) return fail(404, "UNKNOWN_MEMBER", "Üye/rol yok");
  const rid = c.params.roleId!;
  m.roles = add ? [...new Set([...m.roles, rid])] : m.roles.filter((r) => r !== rid);
  server.audit(g, c.userId, A.MEMBER_ROLE_UPDATE, m.user.id, [{ key: add ? "$add" : "$remove", new_value: rid }]);
  server.emitGuild(g.id, "GUILD_MEMBER_UPDATE", { ...m, guild_id: g.id });
  return NO_CONTENT;
};
def("put", "/v1/guilds/:guildId/members/:userId/roles/:roleId", roleToggle(true));
def("delete", "/v1/guilds/:guildId/members/:userId/roles/:roleId", roleToggle(false));

// ───────────── yasak / denetim ─────────────
def("get", "/v1/guilds/:guildId/bans", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.BAN_MEMBERS);
  return [...g.bans.values()];
});
def("get", "/v1/guilds/:guildId/bans/:userId", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.BAN_MEMBERS);
  return g.bans.get(c.params.userId ?? "") ?? fail(404, "UNKNOWN_BAN", "Yasak yok");
});
def("put", "/v1/guilds/:guildId/bans/:userId", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.BAN_MEMBERS);
  const uid = c.params.userId ?? "";
  const m = g.members.get(uid);
  if (m && !hierarchyOk(g, c.userId, m.roles, uid)) return fail(403, "ROLE_HIERARCHY", "Bu üyeye işlem yapamazsın");
  if (uid === g.ownerId) return fail(403, "FORBIDDEN", "Sahip yasaklanamaz");
  g.bans.set(uid, { user: server.publicUser(uid), reason: reasonOf(c) });
  server.audit(g, c.userId, A.MEMBER_BAN_ADD, uid, [], reasonOf(c));
  if (m) server.removeMemberEverywhere(g.id, uid, true);
  return NO_CONTENT;
});
def("delete", "/v1/guilds/:guildId/bans/:userId", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.BAN_MEMBERS);
  g.bans.delete(c.params.userId ?? "");
  server.audit(g, c.userId, A.MEMBER_BAN_REMOVE, c.params.userId ?? null);
  server.emitGuild(g.id, "GUILD_BAN_REMOVE", { guild_id: g.id, user: server.publicUser(c.params.userId ?? "") });
  return NO_CONTENT;
});
def("get", "/v1/guilds/:guildId/audit-logs", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.VIEW_AUDIT_LOG);
  const uid = c.query.get("user_id");
  const at = c.query.get("action_type");
  const entries = g.audit.filter((e) => (!uid || e.user_id === uid) && (!at || String(e.action_type) === at)).slice(0, Number(c.query.get("limit") ?? 50));
  const users = [...new Set(entries.flatMap((e) => [e.user_id, e.target_id]).filter((x): x is string => !!x && server.accounts.has(x)))].map((u) => server.publicUser(u));
  return { audit_log_entries: entries, users };
});

// ───────────── davet ─────────────
const inviteView = (i: InviteRec, meta = false) => {
  const { guildId: _g, channelId: _c, ...rest } = i;
  const g = server.guilds.get(i.guildId);
  const base = { ...rest, approximate_member_count: g?.members.size ?? 0, approximate_presence_count: g ? [...g.members.keys()].filter((u) => server.presenceOf(u) !== "offline").length : 0 };
  if (meta) return base;
  const { uses: _u, max_uses: _m, max_age: _a, created_at: _ca, ...pub } = base;
  return pub;
};
const liveInvite = (code: string): InviteRec => {
  const i = server.invites.get(code);
  if (!i || !server.guilds.has(i.guildId)) return fail(404, "UNKNOWN_INVITE", "Davet bulunamadı");
  if (i.expires_at && new Date(i.expires_at).getTime() < Date.now()) return fail(410, "INVITE_EXPIRED", "Davetin süresi dolmuş");
  if (i.max_uses && i.uses >= i.max_uses) return fail(410, "INVITE_EXPIRED", "Davet kullanım sınırına ulaştı");
  return i;
};
def("post", "/v1/channels/:channelId/invites", (c) => {
  const { g, ch } = channelOf(c);
  need(g, c.userId, P.CREATE_INSTANT_INVITE, ch.id);
  const code = newId().slice(-8).replace(/./g, (d) => "abcdefghjk"[Number(d)] ?? "x");
  const maxAge = c.body.max_age ?? 604800;
  const rec: InviteRec = {
    code, guild: { id: g.id, name: g.name, icon_id: g.iconId }, channel: { id: ch.id, name: ch.name, type: ch.type }, inviter: server.publicUser(c.userId),
    expires_at: maxAge ? new Date(Date.now() + maxAge * 1000).toISOString() : null, approximate_member_count: g.members.size, approximate_presence_count: 1,
    uses: 0, max_uses: c.body.max_uses ?? 0, max_age: maxAge, created_at: new Date().toISOString(), guildId: g.id, channelId: ch.id,
  };
  server.invites.set(code, rec);
  server.audit(g, c.userId, A.INVITE_CREATE, null, [{ key: "code", new_value: code }]);
  return new HttpResponse(JSON.stringify(inviteView(rec, true)), { status: 201, headers: { "Content-Type": "application/json" } });
});
def("get", "/v1/guilds/:guildId/invites", (c) => {
  const g = guildOf(c);
  need(g, c.userId, P.MANAGE_GUILD);
  return [...server.invites.values()].filter((i) => i.guildId === g.id).map((i) => inviteView(i, true) as InviteWithMetadata);
});
def("get", "/v1/invites/:code", (c) => inviteView(liveInvite(c.params.code ?? "")));
def("post", "/v1/invites/:code", (c) => {
  const i = liveInvite(c.params.code ?? "");
  const g = server.guilds.get(i.guildId)!;
  if (g.bans.has(c.userId)) return fail(403, "BANNED_FROM_GUILD", "Bu sunucuya katılamazsın");
  const already = g.members.has(c.userId);
  if (!already) {
    i.uses++;
    server.addMember(g, c.userId, true);
  }
  return { guild: server.gatewayGuild(g), already_member: already };
});
def("delete", "/v1/invites/:code", (c) => {
  const i = server.invites.get(c.params.code ?? "");
  if (!i) return fail(404, "UNKNOWN_INVITE", "Davet yok");
  const g = server.guilds.get(i.guildId);
  if (g && i.inviter?.id !== c.userId) need(g, c.userId, P.MANAGE_GUILD);
  server.invites.delete(i.code);
  if (g) server.audit(g, c.userId, A.INVITE_DELETE, null, [{ key: "code", old_value: i.code }]);
  return NO_CONTENT;
});

// ───────────── ses (Z5b) ─────────────
def("post", "/v1/voice/join", (c) => {
  const ch = server.guildOfChannel(c.body.channel_id)?.channels.get(c.body.channel_id);
  const g = server.guildOfChannel(c.body.channel_id);
  if (!g || !ch || ch.type !== ChannelType.GUILD_VOICE) return fail(404, "UNKNOWN_CHANNEL", "Ses kanalı yok");
  need(g, c.userId, P.CONNECT, ch.id);
  const vs = { guild_id: g.id, channel_id: ch.id, user_id: c.userId, member: g.members.get(c.userId), session_id: "mock", deaf: false, mute: false, self_deaf: !!c.body.self_deaf, self_mute: !!c.body.self_mute, self_stream: false, self_video: false };
  server.voice.set(`${g.id}:${c.userId}`, vs);
  server.emitGuild(g.id, "VOICE_STATE_UPDATE", vs);
  return { url: "ws://localhost:7880", token: "mock", expires_at: new Date(Date.now() + 3600_000).toISOString(), room: ch.id, grants: { can_subscribe: true, can_publish_sources: ["microphone"], can_publish_data: true }, voice_state: vs };
});
def("post", "/v1/voice/leave", (c) => {
  for (const [k, v] of [...server.voice.entries()]) {
    if (v.user_id !== c.userId) continue;
    server.voice.delete(k);
    server.emitGuild(v.guild_id, "VOICE_STATE_UPDATE", { ...v, channel_id: null });
  }
  return NO_CONTENT;
});
def("patch", "/v1/voice/state", (c) => {
  const cur = [...server.voice.values()].find((v) => v.user_id === c.userId);
  if (!cur) return fail(400, "BAD_REQUEST", "Ses kanalında değilsin");
  const next = { ...cur, ...c.body };
  server.voice.set(`${cur.guild_id}:${c.userId}`, next);
  server.emitGuild(cur.guild_id, "VOICE_STATE_UPDATE", next);
  return next;
});

// ───────────── yönetim paneli (yalnız instance admin) ─────────────
const adminOnly = (c: Ctx): void => {
  if (!server.accounts.get(c.userId)?.user.instance_admin) fail(403, "FORBIDDEN", "Yalnızca sunucu yöneticisi erişebilir.");
};
def("get", "/v1/admin/system/live", (c) => (adminOnly(c), adm.adminLive()));
def("get", "/v1/admin/system/series", (c) => (adminOnly(c), adm.adminSeries(c.query.get("range") ?? "24h")));
def("get", "/v1/admin/reports", (c) => (adminOnly(c), adm.adminReport(c.query.get("period") ?? "day", c.query.get("at") ?? undefined)));
def("get", "/v1/admin/capacity", (c) => (adminOnly(c), adm.adminCapacity()));
def("get", "/v1/admin/capacity/plan", (c) => (adminOnly(c), adm.adminPlan(Number(c.query.get("users") ?? 50) || 50)));
def("get", "/v1/admin/quality/sessions/:sessionId", (c) => (adminOnly(c), adm.adminSession(c.params.sessionId ?? "")));
def("get", "/v1/admin/error-groups", (c) => {
  adminOnly(c);
  const st = c.query.get("status");
  return { items: adm.errorGroups.filter((g) => !st || g.status === st) };
});
def("get", "/v1/admin/error-groups/:fp", (c) => (adminOnly(c), adm.errorDetail(c.params.fp ?? "") ?? fail(404, "NOT_FOUND", "Hata grubu bulunamadı")));
def("patch", "/v1/admin/error-groups/:fp", (c) => {
  adminOnly(c);
  const g = adm.errorGroups.find((x) => x.fingerprint === c.params.fp);
  if (!g) return fail(404, "NOT_FOUND", "Hata grubu bulunamadı");
  g.status = c.body.status;
  return g;
});
def("get", "/v1/admin/beta-codes", (c) => (adminOnly(c), { items: adm.betaCodes }));
def("post", "/v1/admin/beta-codes", (c) => {
  adminOnly(c);
  const count = Math.min(100, Math.max(1, Number(c.body.count) || 1));
  const al = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 4 }, () => al[Math.floor(Math.random() * al.length)]).join("");
  for (let i = 0; i < count; i++) {
    const code = `${part()}-${part()}-${part()}`;
    adm.betaCodes.unshift({
      id: newId(), code, code_hint: code.slice(0, 4), status: "active", max_uses: Math.max(1, Number(c.body.max_uses) || 1), uses: 0, note: String(c.body.note ?? ""),
      created_by_username: server.accounts.get(c.userId)?.user.username, created_at: new Date().toISOString(),
      expires_at: c.body.expires_in_hours ? new Date(Date.now() + Number(c.body.expires_in_hours) * 3_600_000).toISOString() : undefined, used_by: [],
    });
  }
  return { items: adm.betaCodes };
});
def("delete", "/v1/admin/beta-codes/:id", (c) => {
  adminOnly(c);
  const i = adm.betaCodes.findIndex((b) => b.id === c.params.id);
  if (i < 0) return fail(404, "NOT_FOUND", "Kod bulunamadı");
  const b = adm.betaCodes[i]!;
  if (b.uses > 0) { b.status = "revoked"; b.revoked_at = new Date().toISOString(); return { result: "revoked" }; }
  adm.betaCodes.splice(i, 1);
  return { result: "deleted" };
});

// ───────────── Ada: demo katılımcısı ─────────────
function scheduleBot(channelId: string, authorId: string, content: string): void {
  const ada = [...server.accounts.values()].find((a) => a.user.username === "ada");
  const g = server.guildOfChannel(channelId);
  if (!ada || !g || authorId === ada.user.id || !g.members.has(ada.user.id) || !/\bada\b|selam|merhaba/i.test(content)) return;
  setTimeout(() => server.emitGuild(g.id, "TYPING_START", { channel_id: channelId, guild_id: g.id, user_id: ada.user.id, timestamp: Math.floor(Date.now() / 1000) }, channelId), 300);
  setTimeout(() => server.pushMessage(channelId, ada.user.id, "Selam! Ben Ada, bu demo sunucusunun sahibiyim."), 1600);
}

// ───────────── MSW'ye bağlama ─────────────
export const handlers: HttpHandler[] = [
  ...routes.map(([method, path, auth, fn]) =>
    http[method](`*${path}`, async ({ request, params }) => {
      try {
        let userId = "";
        if (auth) {
          userId = server.authUser(request.headers.get("Authorization")) ?? "";
          if (!userId) return HttpResponse.json({ code: "UNAUTHORIZED", message: "Oturum gerekli" }, { status: 401 });
        }
        let body: unknown;
        if (request.method !== "GET" && request.method !== "DELETE") body = await request.json().catch(() => ({}));
        const url = new URL(request.url);
        const out = await fn({ userId, params: params as Record<string, string>, query: url.searchParams, body, headers: request.headers, request });
        if (out === NO_CONTENT) return new HttpResponse(null, { status: 204 });
        if (out instanceof HttpResponse) return out;
        return HttpResponse.json(out as never);
      } catch (e) {
        if (e instanceof HttpFail) return HttpResponse.json({ code: e.code, message: e.message, ...e.extra }, { status: e.status });
        console.error("[mock]", e);
        return HttpResponse.json({ code: "INTERNAL", message: String(e) }, { status: 500 });
      }
    }),
  ),
  http.put("*/mock-upload/:id", () => new HttpResponse(null, { status: 200 })),
  http.get("*/mock-files/:id", () => new HttpResponse(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="gray"/></svg>`], { type: "image/svg+xml" }))),
  http.get("*/v1/files/:id", () => new HttpResponse(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="gray"/></svg>`], { type: "image/svg+xml" }))),
];
export { parseBits };
export type { Message };
