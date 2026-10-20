import "@typespec/http";
using Http;

namespace ChatApp;

/** Snowflake kimliği: 64-bit tamsayının ondalık string gösterimi (epoch 2015-01-01). */
@pattern("^[0-9]{1,20}$")
@example("1288310542081277952")
scalar Snowflake extends string;

/** İzin bit dizisi: 64-bit tamsayının ondalık string gösterimi. */
@pattern("^[0-9]{1,20}$")
@example("1024")
scalar PermissionBits extends string;

/** Makine-okunur hata kodları. İstemci yalnız bu koda göre dallanır; `message` gösterim içindir. */
enum ErrorCode {
  BAD_REQUEST,
  VALIDATION_FAILED,
  UNAUTHORIZED,
  TOKEN_EXPIRED,
  INVALID_CREDENTIALS,
  ACCOUNT_SUSPENDED,
  FORBIDDEN,
  MISSING_PERMISSIONS,
  NOT_FOUND,
  UNKNOWN_USER,
  UNKNOWN_GUILD,
  UNKNOWN_CHANNEL,
  UNKNOWN_ROLE,
  UNKNOWN_MEMBER,
  UNKNOWN_MESSAGE,
  UNKNOWN_INVITE,
  UNKNOWN_BAN,
  UNKNOWN_ATTACHMENT,
  CONFLICT,
  USERNAME_TAKEN,
  EMAIL_TAKEN,
  ALREADY_MEMBER,
  BETA_CODE_INVALID,
  BETA_CODE_EXPIRED,
  BETA_CODE_EXHAUSTED,
  UNDERAGE,
  INVITE_EXPIRED,
  BANNED_FROM_GUILD,
  OWNER_CANNOT_LEAVE,
  ROLE_HIERARCHY,
  GUILD_LIMIT_REACHED,
  FILE_TOO_LARGE,
  UPLOAD_INCOMPLETE,
  CHANNEL_FULL,
  RATE_LIMITED,
  INTERNAL,
  NOT_IMPLEMENTED,
  UNAVAILABLE,
}

/** Alan doğrulama hatası (422). `field` JSON yolu, ör. `password` ya da `permission_overwrites.0.allow`. */
model FieldError {
  field: string;

  /** Alan düzeyi kod: REQUIRED, TOO_SHORT, TOO_LONG, INVALID_FORMAT, OUT_OF_RANGE, TAKEN, WEAK, LINK_INVALID, LINK_EXPIRED, LINK_USED, EMAIL_NOT_VERIFIED ... */
  code: string;

  message: string;
}

/**
 * Tüm hata yanıtlarının tek biçimi (OpenAPI `default` yanıtı). İç ayrıntı (SQL, yığın izi,
 * dosya yolu) asla içermez. HTTP durumu `code`'la tutarlıdır (bkz. servis açıklaması);
 * henüz yazılmamış uç 501 NOT_IMPLEMENTED döner.
 */
@error
model ApiError {
  code: ErrorCode;
  message: string;

  /** İstek kimliği (hata izleme ve raporlama için). */
  request_id?: string;

  /** 422'de ve 403 FORBIDDEN + EMAIL_NOT_VERIFIED kısıtında dolu. */
  errors?: FieldError[];

  /** Yalnız 429'da: kaç saniye sonra yeniden denenmeli. */
  retry_after?: float64;

  /** Yalnız ACCOUNT_SUSPENDED'da: askının bitişi (süresizse yok). */
  suspended_until?: utcDateTime;
}

/** Denetim kaydına yazılacak gerekçe (URL-encoded, ≤512 karakter). */
model AuditReasonHeader {
  @header("X-Audit-Log-Reason") reason?: string;
}

/** 204 yanıtı. */
model NoContent {
  @statusCode _: 204;
}
