// ChatApp API sözleşmesi — TEK DOĞRULUK KAYNAĞI (K15, K24).
// Üretim: `pnpm gen` → out/openapi.yaml → @chatapp/api-types (TS) + services/chatapp/internal/api/gen (Go).
// Kural: v1 içinde yalnız ekleme serbest; kırıcı değişiklik = /v2 (oasdiff CI kapısı).
import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi";
import "@typespec/openapi3";
import "./src/common.tsp";
import "./src/models.tsp";
import "./src/auth.tsp";
import "./src/users.tsp";
import "./src/guilds.tsp";
import "./src/channels.tsp";
import "./src/roles.tsp";
import "./src/members.tsp";
import "./src/invites.tsp";
import "./src/messages.tsp";
import "./src/attachments.tsp";
import "./src/voice.tsp";
import "./src/audit.tsp";
import "./src/system.tsp";
import "./src/setup.tsp";
import "./src/settings.tsp";
import "./src/errors.tsp";
import "./src/telemetry.tsp";
import "./src/admin.tsp";
import "./src/applications.tsp";
import "./src/gateway.tsp";

using Http;
using TypeSpec.OpenAPI;

/**
 * ChatApp REST API v1.
 *
 * - Kimlikler Snowflake (epoch 2015-01-01, K29), JSON'da **string**.
 * - İzin bit dizileri V1 standart değerleriyle, 64-bit tamsayının ondalık **string** gösterimi.
 * - Kimlik doğrulama: `Authorization: Bearer <access_token>`. Access token login/register/refresh
 *   yanıtının gövdesinde gelir (ömür `expires_in` sn). Refresh token yalnız `chatapp_rt`
 *   HttpOnly çerezinde taşınır (Path=/v1/auth, SameSite=Strict).
 * - Hata gövdesi her zaman `ApiError`. Durumlar: 400 bozuk istek · 401 kimlik yok/geçersiz ·
 *   403 izin yok · 404 yok ya da görme izni yok · 409 çakışma · 422 alan doğrulama ·
 *   429 hız sınırı (`retry_after`) · 5xx yalnız sunucu hatası.
 * - Hoşgörülü okuyucu: istemciler bilinmeyen alanları yok sayar; v1'e yeni alan eklenebilir.
 * - Gateway (WebSocket) ayrı adreste: `GET /v1/gateway` ile bulunur; çerçeve modelleri
 *   `Gateway*` şemalarıdır (components'te).
 */
@service(#{ title: "ChatApp API" })
@info(#{ version: "1.0.0" })
@server("http://localhost:8410", "Yerel geliştirme (api rolü)")
@useAuth(BearerAuth)
namespace ChatApp;
