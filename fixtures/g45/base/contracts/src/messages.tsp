import "@typespec/http";
using Http;

namespace ChatApp;

enum AllowedMentionType {
  roles,
  users,
  everyone,
}

model AllowedMentions {
  parse?: AllowedMentionType[];

  /** Yanıtta yanıtlanan kişiye bildirim gitsin mi (5.2 "@bahset aç/kapa"). Varsayılan true. */
  replied_user?: boolean;
}

model CreateMessageRequest {
  /** ≤4000. `content` ya da `attachment_ids`'ten en az biri dolu olmalı. */
  @maxLength(4000) content?: string;

  /** İstemci üretir (≤25 karakter); iyimser gösterimi eşlemek için MESSAGE_CREATE'de geri gelir. Aynı nonce 2 dk içinde tekrar gelirse aynı mesaj döner (idempotent). */
  @maxLength(25) nonce?: string;

  /** Yanıt (5.2). Aynı kanaldaki mesaj olmalı. */
  message_reference?: MessageReference;

  /** `POST /v1/attachments` + complete ile hazırlanmış, bu kanala ait ekler (≤10). ATTACH_FILES. */
  @maxItems(10) attachment_ids?: Snowflake[];

  allowed_mentions?: AllowedMentions;
}

model UpdateMessageRequest {
  /** Yalnız yazar düzenler. */
  @maxLength(4000) content: string;
}

@tag("messages")
@route("/v1/channels/{channel_id}/messages")
namespace Messages {
  /**
   * Geçmiş (A-03). `before` / `after` / `around`'dan en çok biri; hiçbiri yoksa en yeniler.
   * Yanıt her zaman **yeniden eskiye** sıralı. VIEW_CHANNEL + READ_MESSAGE_HISTORY.
   */
  @get
  op list(
    @path channel_id: Snowflake,
    @query before?: Snowflake,
    @query after?: Snowflake,
    @query around?: Snowflake,
    @query @minValue(1) @maxValue(100) limit?: int32 = 50,
  ): Message[] | ApiError;

  @get
  @route("/{message_id}")
  op get(@path channel_id: Snowflake, @path message_id: Snowflake): Message | ApiError;

  /** SEND_MESSAGES (G-01, A-02). DB + outbox aynı işlemde; MESSAGE_CREATE yayılır. */
  @post
  op create(@path channel_id: Snowflake, @body body: CreateMessageRequest): Message | ApiError;

  /** Yalnız yazar. MESSAGE_UPDATE yayılır. */
  @patch(#{ implicitOptionality: false })
  @route("/{message_id}")
  op update(@path channel_id: Snowflake, @path message_id: Snowflake, @body body: UpdateMessageRequest): Message | ApiError;

  /** Yazar ya da MANAGE_MESSAGES (moderatör silmesi denetim kaydına düşer). Yumuşak silme (K32: 30 gün saklanır). */
  @delete
  @route("/{message_id}")
  op delete(@path channel_id: Snowflake, @path message_id: Snowflake, ...AuditReasonHeader): NoContent | ApiError;

  /** Okundu işaretle; `last_read_message_id = message_id`, `mention_count = 0`. MESSAGE_ACK (yalnız kendine) yayılır. */
  @post
  @route("/{message_id}/ack")
  op ack(@path channel_id: Snowflake, @path message_id: Snowflake, @body body?: AckRequest): NoContent | ApiError;

  /** Tepki ekle. `emoji` = URL-encoded Unicode emoji. ADD_REACTIONS (mesajda zaten olan tepkiye katılmak için gerekmez). */
  @put
  @route("/{message_id}/reactions/{emoji}/@me")
  op addReaction(@path channel_id: Snowflake, @path message_id: Snowflake, @path emoji: string): NoContent | ApiError;

  @delete
  @route("/{message_id}/reactions/{emoji}/@me")
  op removeOwnReaction(@path channel_id: Snowflake, @path message_id: Snowflake, @path emoji: string): NoContent | ApiError;

  /** Başkasının tepkisini kaldır. MANAGE_MESSAGES. */
  @delete
  @route("/{message_id}/reactions/{emoji}/{user_id}")
  op removeUserReaction(
    @path channel_id: Snowflake,
    @path message_id: Snowflake,
    @path emoji: string,
    @path user_id: Snowflake,
  ): NoContent | ApiError;

  /** Tepki verenler (kullanıcı kimliğine göre artan). */
  @get
  @route("/{message_id}/reactions/{emoji}")
  op listReactions(
    @path channel_id: Snowflake,
    @path message_id: Snowflake,
    @path emoji: string,
    @query after?: Snowflake,
    @query @minValue(1) @maxValue(100) limit?: int32 = 25,
  ): User[] | ApiError;
}
