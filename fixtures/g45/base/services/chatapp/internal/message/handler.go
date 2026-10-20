package message

import (
	"context"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/eirikaleid/chatapp/services/chatapp/internal/access"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/api"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/api/gen"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/audit"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/auth"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/core"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/outbox"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/perm"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/platform/db/dbq"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/ratelimit"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/snowflake"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/view"
)

const (
	maxContent     = 4000
	nonceWindow    = 2 * time.Minute
	maxEmojiPerMsg = 20
	maxMentions    = 100
	typeText       = int16(gen.ChannelTypeGUILDTEXT)
	typeVoice      = int16(gen.ChannelTypeGUILDVOICE) // ses kanalının yan metin sohbeti (EKRANLAR 6.6)
	typeDM         = int16(gen.ChannelTypeDM)
	typeGroupDM    = int16(gen.ChannelTypeGROUPDM)
)

type Handler struct {
	d             *core.Deps
	rl            *ratelimit.Limiter
	cache         *Cache
	channelLoader func(ctx context.Context, q *dbq.Queries, cid, uid int64) (*access.Channel, error)
}

func New(d *core.Deps) *Handler {
	return &Handler{
		d:     d,
		rl:    &ratelimit.Limiter{C: d.Valkey, Log: d.Log},
		cache: NewCache(d.Valkey),
	}
}

// Cache döner.
func (h *Handler) Cache() *Cache { return h.cache }

// SetCache testler için önbellek nesnesini değiştirmeyi sağlar.
func (h *Handler) SetCache(c *Cache) { h.cache = c }

func unknownMessage() *api.Error {
	return api.E(http.StatusNotFound, gen.ErrorCodeUNKNOWNMESSAGE, "Mesaj bulunamadı.")
}

func bad(field, code, msg string) *api.Error { return core.Unprocessable(field, code, msg) }

// emitMessageEvent sunucu kanalında guild yayını, DM kanalında ise tüm alıcılara tek tek outbox iletimi yapar.
func (h *Handler) emitMessageEvent(ctx context.Context, q *dbq.Queries, cid, gid int64, evName gen.GatewayEventName, payload any) error {
	if gid != 0 {
		return outbox.Emit(ctx, q, h.d.IDs, outbox.Event{Name: evName, GuildID: gid, Payload: payload})
	}
	recipients, err := q.GetChannelRecipients(ctx, cid)
	if err != nil {
		return err
	}
	for _, r := range recipients {
		if err := outbox.Emit(ctx, q, h.d.IDs, outbox.Event{Name: evName, UserID: r.ID, Payload: payload}); err != nil {
			return err
		}
	}
	return nil
}

// textChannel kanalı yükler (görünürlük: değilse 404) ve mesaj taşıyabilen (metin ya da ses) kanal olduğunu doğrular;
// kategori mesaj taşımaz.
func (h *Handler) textChannel(ctx context.Context, q *dbq.Queries, cid, uid int64) (*access.Channel, error) {
	if h.channelLoader != nil {
		return h.channelLoader(ctx, q, cid, uid)
	}
	ch, err := access.LoadChannel(ctx, q, cid, uid)
	if err != nil {
		return nil, err
	}
	if ch.Row.Type != typeText && ch.Row.Type != typeVoice && ch.Row.Type != typeDM && ch.Row.Type != typeGroupDM {
		return nil, bad("channel_id", "INVALID_FORMAT", "Bu kanalda mesaj yazılamaz.")
	}
	return ch, nil
}

// ───────────── okuma ─────────────

func (h *Handler) MessagesList(ctx context.Context, req gen.MessagesListRequestObject) (gen.MessagesListResponseObject, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cid, err := core.ID(req.ChannelId)
	if err != nil {
		return nil, err
	}
	p := req.Params
	n := 0
	var before, after, around int64
	for _, c := range []struct {
		v   *string
		dst *int64
		f   string
	}{{p.Before, &before, "before"}, {p.After, &after, "after"}, {p.Around, &around, "around"}} {
		if c.v != nil {
			n++
			if *c.dst, err = core.ID(*c.v); err != nil {
				return nil, bad(c.f, "INVALID_FORMAT", "Geçersiz kimlik.")
			}
		}
	}
	if n > 1 {
		return nil, bad("before", "INVALID_FORMAT", "before, after, around'dan en çok biri verilebilir.")
	}
	limit := int32(50)
	if p.Limit != nil {
		limit = *p.Limit
	}
	if limit < 1 || limit > 100 {
		return nil, bad("limit", "OUT_OF_RANGE", "limit 1–100 olmalı.")
	}
	q := h.d.Q()
	ch, err := h.textChannel(ctx, q, cid, uid)
	if err != nil {
		return nil, err
	}
	if err := ch.Require(perm.ReadMessageHistory); err != nil {
		return nil, err
	}
	isInitial := before == 0 && after == 0 && around == 0
	if isInitial && limit <= MaxCachedMessages {
		if cached, hit, _ := h.cache.GetRecent(ctx, cid, limit); hit {
			return gen.MessagesList200JSONResponse(cached), nil
		}
	}
	var rows []dbq.Message
	switch {
	case after != 0:
		rows, err = q.ListMessagesAfter(ctx, dbq.ListMessagesAfterParams{ChannelID: cid, ID: after, Limit: limit})
		slices.Reverse(rows)
	case around != 0:
		half := limit / 2
		var older, newer []dbq.Message
		if older, err = q.ListMessagesBefore(ctx, dbq.ListMessagesBeforeParams{ChannelID: cid, ID: around + 1, Limit: limit - half}); err == nil {
			newer, err = q.ListMessagesAfter(ctx, dbq.ListMessagesAfterParams{ChannelID: cid, ID: around, Limit: half})
		}
		slices.Reverse(newer)
		rows = append(newer, older...)
	default:
		if before == 0 {
			before = 1<<63 - 1
		}
		rows, err = q.ListMessagesBefore(ctx, dbq.ListMessagesBeforeParams{ChannelID: cid, ID: before, Limit: limit})
	}
	if err != nil {
		return nil, err
	}
	out, err := Views(ctx, h.d, q, uid, cid, rows)
	if err != nil {
		return nil, err
	}
	if isInitial {
		_ = h.cache.Seed(ctx, cid, out)
	}
	return gen.MessagesList200JSONResponse(out), nil
}

func (h *Handler) MessagesGet(ctx context.Context, req gen.MessagesGetRequestObject) (gen.MessagesGetResponseObject, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := core.IDs(req.ChannelId, req.MessageId)
	if err != nil {
		return nil, err
	}
	q := h.d.Q()
	ch, err := h.textChannel(ctx, q, ids[0], uid)
	if err != nil {
		return nil, err
	}
	if err := ch.Require(perm.ReadMessageHistory); err != nil {
		return nil, err
	}
	m, err := q.GetMessage(ctx, dbq.GetMessageParams{ChannelID: ids[0], ID: ids[1]})
	if err != nil {
		if core.NotFound(err) {
			return nil, unknownMessage()
		}
		return nil, err
	}
	vs, err := Views(ctx, h.d, q, uid, ids[0], []dbq.Message{m})
	if err != nil {
		return nil, err
	}
	return gen.MessagesGet200JSONResponse(vs[0]), nil
}

// ───────────── bahsetmeler ─────────────

var (
	reUser = regexp.MustCompile(`<@!?(\d{1,19})>`)
	reRole = regexp.MustCompile(`<@&(\d{1,19})>`)
)

type mentions struct {
	everyone bool
	users    []int64
	roles    []int64
}

// parseMentions içerikten @kullanıcı/@rol/@everyone ayrıştırır. allowed_mentions.parse verilmişse yalnız listelenen türler
// sayılır; @everyone MENTION_EVERYONE ister; rol bahsi rol `mentionable` ya da MENTION_EVERYONE ister; kullanıcılar sunucu üyesi olmalı.
func (h *Handler) parseMentions(ctx context.Context, q *dbq.Queries, ch *access.Channel, content string, am *gen.AllowedMentions) (mentions, error) {
	var out mentions
	users, roles, every := true, true, true
	if am != nil && am.Parse != nil {
		users, roles, every = false, false, false
		for _, t := range *am.Parse {
			switch t {
			case gen.AllowedMentionTypeUsers:
				users = true
			case gen.AllowedMentionTypeRoles:
				roles = true
			case gen.AllowedMentionTypeEveryone:
				every = true
			}
		}
	}
	if every && ch.Perms.Has(perm.MentionEveryone) && (strings.Contains(content, "@everyone") || strings.Contains(content, "@here")) {
		out.everyone = true
	}
	if roles {
		for _, mt := range reRole.FindAllStringSubmatch(content, maxMentions) {
			id, _ := strconv.ParseInt(mt[1], 10, 64)
			_, ok := ch.Guild.Roles[id]
			if !ok || id == ch.Row.GuildID {
				continue
			}
			if !ch.Perms.Has(perm.MentionEveryone) {
				row, err := q.GetRole(ctx, dbq.GetRoleParams{ID: id, GuildID: ch.Row.GuildID})
				if err != nil || !row.Mentionable {
					continue
				}
			}
			if !slices.Contains(out.roles, id) {
				out.roles = append(out.roles, id)
			}
		}
	}
	if users {
		var cand []int64
		for _, mt := range reUser.FindAllStringSubmatch(content, maxMentions) {
			id, _ := strconv.ParseInt(mt[1], 10, 64)
			if !slices.Contains(cand, id) {
				cand = append(cand, id)
			}
		}
		if len(cand) > 0 {
			members, err := q.FilterGuildMembers(ctx, dbq.FilterGuildMembersParams{GuildID: ch.Row.GuildID, Ids: cand})
			if err != nil {
				return out, err
			}
			out.users = members
		}
	}
	return out, nil
}

func validateContent(content string, hasAttachments bool) error {
	if utf8.RuneCountInString(content) > maxContent {
		return bad("content", "TOO_LONG", "Mesaj en çok 4000 karakter olabilir.")
	}
	if strings.TrimSpace(content) == "" && !hasAttachments {
		return bad("content", "REQUIRED", "Mesaj boş olamaz.")
	}
	return nil
}

// ───────────── oluştur ─────────────

func (h *Handler) MessagesCreate(ctx context.Context, req gen.MessagesCreateRequestObject) (gen.MessagesCreateResponseObject, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := core.RequireVerifiedEmail(ctx, h.d, uid); err != nil {
		return nil, err
	}
	cid, err := core.ID(req.ChannelId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, bad("body", "REQUIRED", "İstek gövdesi gerekli.")
	}
	b := req.Body
	content := ""
	if b.Content != nil {
		content = *b.Content
	}
	var attIDs []int64
	if b.AttachmentIds != nil {
		if len(*b.AttachmentIds) > 10 {
			return nil, bad("attachment_ids", "TOO_LONG", "En çok 10 dosya eklenebilir.")
		}
		for i, s := range *b.AttachmentIds {
			id, err := core.FieldID("attachment_ids."+strconv.Itoa(i), s)
			if err != nil {
				return nil, err
			}
			if slices.Contains(attIDs, id) {
				return nil, bad("attachment_ids."+strconv.Itoa(i), "INVALID_FORMAT", "Aynı dosya iki kez verilmiş.")
			}
			attIDs = append(attIDs, id)
		}
	}
	if err := validateContent(content, len(attIDs) > 0); err != nil {
		return nil, err
	}
	nonce := ""
	if b.Nonce != nil && *b.Nonce != "" {
		if utf8.RuneCountInString(*b.Nonce) > 25 {
			return nil, bad("nonce", "TOO_LONG", "nonce en çok 25 karakter.")
		}
		nonce = *b.Nonce
	}
	var refID int64
	if b.MessageReference != nil {
		if refID, err = core.FieldID("message_reference.message_id", b.MessageReference.MessageId); err != nil {
			return nil, err
		}
	}
	if ok, _ := h.rl.Hit(ctx, "msg:"+core.S(uid), 20, 10*time.Second); !ok {
		return nil, api.E(http.StatusTooManyRequests, gen.ErrorCodeRATELIMITED, "Çok hızlı mesaj gönderiyorsunuz.")
	}

	var out gen.Message
	err = h.d.Tx(ctx, func(q *dbq.Queries) error {
		ch, err := h.textChannel(ctx, q, cid, uid)
		if err != nil {
			return err
		}
		if err := ch.Require(perm.SendMessages); err != nil {
			return err
		}
		if len(attIDs) > 0 {
			if err := ch.Require(perm.AttachFiles); err != nil {
				return err
			}
			for i, id := range attIDs {
				a, err := q.GetAttachment(ctx, id)
				f := "attachment_ids." + strconv.Itoa(i)
				if err != nil {
					if core.NotFound(err) {
						return bad(f, "INVALID_FORMAT", "Dosya bulunamadı.")
					}
					return err
				}
				if a.UploaderID != uid || a.Purpose != core.PurposeMessage || a.Status != 1 || a.MessageID != nil || a.ChannelID == nil || *a.ChannelID != cid {
					return bad(f, "INVALID_FORMAT", "Dosya bu mesaj için kullanılamaz ya da yükleme tamamlanmamış.")
				}
			}
		}
		if nonce != "" {
			if err := q.LockNonce(ctx, core.S(cid)+":"+core.S(uid)+":"+nonce); err != nil {
				return err
			}
			lower := int64(snowflake.FromTime(core.Now().Add(-nonceWindow)))
			if ex, err := q.FindMessageByNonce(ctx, dbq.FindMessageByNonceParams{ChannelID: cid, AuthorID: uid, Nonce: &nonce, ID: lower}); err == nil {
				vs, err := Views(ctx, h.d, q, uid, cid, []dbq.Message{ex})
				if err != nil {
					return err
				}
				out = vs[0]
				out.Nonce = &nonce
				return nil // idempotent: olay yeniden yayılmaz
			} else if !core.NotFound(err) {
				return err
			}
		}
		typ := int16(gen.MessageTypeDEFAULT)
		var refAuthor int64
		var refp *int64
		if refID != 0 {
			ref, err := q.GetMessage(ctx, dbq.GetMessageParams{ChannelID: cid, ID: refID})
			if err != nil {
				if core.NotFound(err) {
					return bad("message_reference.message_id", "INVALID_FORMAT", "Yanıtlanan mesaj bu kanalda yok.")
				}
				return err
			}
			typ, refp, refAuthor = int16(gen.MessageTypeREPLY), &refID, ref.AuthorID
		}
		men, err := h.parseMentions(ctx, q, ch, content, b.AllowedMentions)
		if err != nil {
			return err
		}
		if refAuthor != 0 && refAuthor != uid && (b.AllowedMentions == nil || b.AllowedMentions.RepliedUser == nil || *b.AllowedMentions.RepliedUser) && !slices.Contains(men.users, refAuthor) {
			if ms, err := q.FilterGuildMembers(ctx, dbq.FilterGuildMembersParams{GuildID: ch.Row.GuildID, Ids: []int64{refAuthor}}); err != nil {
				return err
			} else if len(ms) > 0 {
				men.users = append(men.users, refAuthor)
			}
		}
		id := h.d.NewID()
		var np *string
		if nonce != "" {
			np = &nonce
		}
		var gidPtr *int64
		if ch.Row.GuildID != 0 {
			gidPtr = &ch.Row.GuildID
		}
		row, err := q.InsertMessage(ctx, dbq.InsertMessageParams{ChannelID: cid, ID: id, GuildID: gidPtr, AuthorID: uid, Type: typ, Content: content,
			ReferencedMessageID: refp, MentionEveryone: men.everyone, MentionUserIds: nz(men.users), MentionRoleIds: nz(men.roles), Nonce: np})
		if err != nil {
			return err
		}
		if len(attIDs) > 0 {
			n, err := q.AttachToMessage(ctx, dbq.AttachToMessageParams{ChannelID: &cid, UploaderID: uid, MessageID: &id, Ids: attIDs})
			if err != nil {
				return err
			}
			if int(n) != len(attIDs) {
				return bad("attachment_ids", "INVALID_FORMAT", "Dosyalardan biri başka bir mesaja bağlanmış.")
			}
		}
		if err := q.SetChannelLastMessage(ctx, dbq.SetChannelLastMessageParams{ID: cid, LastMessageID: &id}); err != nil {
			return err
		}
		if len(men.users) > 0 || len(men.roles) > 0 || men.everyone {
			if err := q.BumpMentions(ctx, dbq.BumpMentionsParams{ChannelID: cid, GuildID: ch.Row.GuildID, AuthorID: uid, Everyone: men.everyone, UserIds: nz(men.users), RoleIds: nz(men.roles)}); err != nil {
				return err
			}
		}
		if err := q.MarkReadForAuthor(ctx, dbq.MarkReadForAuthorParams{UserID: uid, ChannelID: cid, LastReadMessageID: &id}); err != nil {
			return err
		}
		vs, err := Views(ctx, h.d, q, 0, cid, []dbq.Message{row})
		if err != nil {
			return err
		}
		out = vs[0]
		if nonce != "" {
			out.Nonce = &nonce
		}
		pm, err := partial(ctx, q, ch.Row.GuildID, uid)
		if err != nil {
			return err
		}
		return h.emitMessageEvent(ctx, q, cid, ch.Row.GuildID, gen.GatewayEventNameMESSAGECREATE, Event(out, pm))
	})
	if err != nil {
		return nil, err
	}
	_ = h.cache.Push(ctx, cid, out)
	return gen.MessagesCreate200JSONResponse(out), nil
}

func nz(s []int64) []int64 {
	if s == nil {
		return []int64{}
	}
	return s
}

// PostMemberJoin katılımda sistem mesajı (GUILD_MEMBER_JOIN) yazar; sistem kanalı yoksa hiçbir şey yapmaz.
// Üyelik eklendikten sonra, aynı işlemde çağrılır.
func PostMemberJoin(ctx context.Context, d *core.Deps, q *dbq.Queries, g dbq.Guild, userID int64) error {
	if g.SystemChannelID == nil {
		return nil
	}
	cid := *g.SystemChannelID
	id := d.NewID()
	row, err := q.InsertMessage(ctx, dbq.InsertMessageParams{ChannelID: cid, ID: id, GuildID: &g.ID, AuthorID: userID,
		Type: int16(gen.MessageTypeGUILDMEMBERJOIN), MentionUserIds: []int64{}, MentionRoleIds: []int64{}})
	if err != nil {
		return err
	}
	if err := q.SetChannelLastMessage(ctx, dbq.SetChannelLastMessageParams{ID: cid, LastMessageID: &id}); err != nil {
		return err
	}
	vs, err := Views(ctx, d, q, 0, cid, []dbq.Message{row})
	if err != nil {
		return err
	}
	pm, err := partial(ctx, q, g.ID, userID)
	if err != nil {
		return err
	}
	return outbox.Emit(ctx, q, d.IDs, outbox.Event{Name: gen.GatewayEventNameMESSAGECREATE, GuildID: g.ID, Payload: Event(vs[0], pm)})
}

// ───────────── düzenle / sil ─────────────

func (h *Handler) MessagesUpdate(ctx context.Context, req gen.MessagesUpdateRequestObject) (gen.MessagesUpdateResponseObject, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := core.IDs(req.ChannelId, req.MessageId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, bad("body", "REQUIRED", "İstek gövdesi gerekli.")
	}
	content := req.Body.Content
	var out gen.Message
	err = h.d.Tx(ctx, func(q *dbq.Queries) error {
		ch, err := h.textChannel(ctx, q, ids[0], uid)
		if err != nil {
			return err
		}
		if err := ch.Require(perm.SendMessages); err != nil { // yazma izni kalkmış yazar düzenleyemez
			return err
		}
		m, err := q.GetMessage(ctx, dbq.GetMessageParams{ChannelID: ids[0], ID: ids[1]})
		if err != nil {
			if core.NotFound(err) {
				return unknownMessage()
			}
			return err
		}
		if m.AuthorID != uid || m.Type == int16(gen.MessageTypeGUILDMEMBERJOIN) {
			return access.ErrMissing() // yalnız yazar, yalnız kendi mesajı
		}
		atts, err := q.ListMessageAttachments(ctx, dbq.ListMessageAttachmentsParams{ChannelID: &ids[0], Ids: []int64{ids[1]}})
		if err != nil {
			return err
		}
		if err := validateContent(content, len(atts) > 0); err != nil {
			return err
		}
		men, err := h.parseMentions(ctx, q, ch, content, nil)
		if err != nil {
			return err
		}
		row, err := q.UpdateMessageContent(ctx, dbq.UpdateMessageContentParams{ChannelID: ids[0], ID: ids[1], Content: content,
			MentionEveryone: men.everyone, MentionUserIds: nz(men.users), MentionRoleIds: nz(men.roles)})
		if err != nil {
			return err
		}
		vs, err := Views(ctx, h.d, q, uid, ids[0], []dbq.Message{row})
		if err != nil {
			return err
		}
		out = vs[0]
		pm, err := partial(ctx, q, ch.Row.GuildID, uid)
		if err != nil {
			return err
		}
		bc, err := Views(ctx, h.d, q, 0, ids[0], []dbq.Message{row})
		if err != nil {
			return err
		}
		return h.emitMessageEvent(ctx, q, ids[0], ch.Row.GuildID, gen.GatewayEventNameMESSAGEUPDATE, Event(bc[0], pm))
	})
	if err != nil {
		return nil, err
	}
	_ = h.cache.Update(ctx, ids[0], out)
	return gen.MessagesUpdate200JSONResponse(out), nil
}

func (h *Handler) MessagesDelete(ctx context.Context, req gen.MessagesDeleteRequestObject) (gen.MessagesDeleteResponseObject, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := core.IDs(req.ChannelId, req.MessageId)
	if err != nil {
		return nil, err
	}
	err = h.d.Tx(ctx, func(q *dbq.Queries) error {
		ch, err := h.textChannel(ctx, q, ids[0], uid)
		if err != nil {
			return err
		}
		m, err := q.GetMessage(ctx, dbq.GetMessageParams{ChannelID: ids[0], ID: ids[1]})
		if err != nil {
			if core.NotFound(err) {
				return unknownMessage()
			}
			return err
		}
		if m.AuthorID != uid {
			if err := ch.Require(perm.ManageMessages); err != nil {
				return err
			}
		}
		if _, err := q.SoftDeleteMessage(ctx, dbq.SoftDeleteMessageParams{ChannelID: ids[0], ID: ids[1], DeletedBy: &uid}); err != nil {
			return err
		}
		if m.AuthorID != uid && ch.Row.GuildID != 0 { // moderatör silmesi denetim kaydına düşer
			if err := audit.Write(ctx, q, h.d.IDs, audit.Entry{GuildID: ch.Row.GuildID, ActorID: uid, Action: gen.AuditLogActionMESSAGEDELETE,
				TargetID: core.S(m.AuthorID), Reason: core.Reason(req.Params.XAuditLogReason),
				Options: map[string]string{"channel_id": core.S(ids[0]), "count": "1"}}); err != nil {
				return err
			}
		}
		var gidStr gen.Snowflake
		if ch.Row.GuildID != 0 {
			gidStr = core.S(ch.Row.GuildID)
		}
		return h.emitMessageEvent(ctx, q, ids[0], ch.Row.GuildID, gen.GatewayEventNameMESSAGEDELETE,
			gen.MessageDeleteEvent{Id: core.S(ids[1]), ChannelId: core.S(ids[0]), GuildId: gidStr})
	})
	if err != nil {
		return nil, err
	}
	_ = h.cache.Delete(ctx, ids[0], ids[1])
	return gen.MessagesDelete204Response{}, nil
}

// ───────────── okundu ─────────────

func (h *Handler) MessagesAck(ctx context.Context, req gen.MessagesAckRequestObject) (gen.MessagesAckResponseObject, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := core.IDs(req.ChannelId, req.MessageId)
	if err != nil {
		return nil, err
	}
	manual := req.Body != nil && req.Body.Manual != nil && *req.Body.Manual
	err = h.d.Tx(ctx, func(q *dbq.Queries) error {
		ch, err := access.LoadChannel(ctx, q, ids[0], uid)
		if err != nil {
			return err
		}
		if err := ch.Require(perm.ReadMessageHistory); err != nil { // geçmişi okuyamayan okundu işaretleyemez
			return err
		}
		rs, err := q.AckChannel(ctx, dbq.AckChannelParams{UserID: uid, ChannelID: ids[0], LastReadMessageID: &ids[1], Manual: manual})
		if err != nil {
			return err
		}
		last := ids[1]
		if rs.LastReadMessageID != nil {
			last = *rs.LastReadMessageID
		}
		return outbox.Emit(ctx, q, h.d.IDs, outbox.Event{Name: gen.GatewayEventNameMESSAGEACK, GuildID: ch.Row.GuildID, UserID: uid,
			Payload: gen.MessageAckEvent{ChannelId: core.S(ids[0]), MessageId: core.S(last), MentionCount: rs.MentionCount}})
	})
	if err != nil {
		return nil, err
	}
	return gen.MessagesAck204Response{}, nil
}

// ───────────── tepkiler ─────────────

// checkEmoji Beta 0: yalnız Unicode emoji (ASCII harf/boşluk yok; # * 0-9 yalnız keycap dizisinde).
func checkEmoji(e string) error {
	n := utf8.RuneCountInString(e)
	if n < 1 || n > 16 {
		return bad("emoji", "INVALID_FORMAT", "Geçersiz emoji.")
	}
	high := false
	for _, r := range e {
		switch {
		case r >= 0x80:
			high = true
		case r == '#' || r == '*' || (r >= '0' && r <= '9'):
		default:
			return bad("emoji", "INVALID_FORMAT", "Yalnız Unicode emoji kullanılabilir.")
		}
	}
	if !high {
		return bad("emoji", "INVALID_FORMAT", "Yalnız Unicode emoji kullanılabilir.")
	}
	return nil
}

func reactionEvent(cid, mid, gid, uid int64, emoji string, member *gen.PartialMember) gen.MessageReactionEvent {
	return gen.MessageReactionEvent{UserId: core.S(uid), ChannelId: core.S(cid), MessageId: core.S(mid), GuildId: core.S(gid),
		Emoji: gen.Emoji{Id: api.NullOf[gen.Snowflake](), Name: emoji}, Member: member}
}

func (h *Handler) MessagesAddReaction(ctx context.Context, req gen.MessagesAddReactionRequestObject) (gen.MessagesAddReactionResponseObject, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := core.IDs(req.ChannelId, req.MessageId)
	if err != nil {
		return nil, err
	}
	if err := checkEmoji(req.Emoji); err != nil {
		return nil, err
	}
	err = h.d.Tx(ctx, func(q *dbq.Queries) error {
		ch, err := h.textChannel(ctx, q, ids[0], uid)
		if err != nil {
			return err
		}
		if err := ch.Require(perm.ReadMessageHistory); err != nil {
			return err
		}
		if _, err := q.GetMessage(ctx, dbq.GetMessageParams{ChannelID: ids[0], ID: ids[1]}); err != nil {
			if core.NotFound(err) {
				return unknownMessage()
			}
			return err
		}
		exists, err := q.EmojiExistsOnMessage(ctx, dbq.EmojiExistsOnMessageParams{ChannelID: ids[0], MessageID: ids[1], Emoji: req.Emoji})
		if err != nil {
			return err
		}
		if !exists { // yeni emoji = ADD_REACTIONS; var olan tepkiye katılmak serbest
			if err := ch.Require(perm.AddReactions); err != nil {
				return err
			}
			if n, err := q.CountMessageEmojis(ctx, dbq.CountMessageEmojisParams{ChannelID: ids[0], MessageID: ids[1]}); err != nil {
				return err
			} else if n >= maxEmojiPerMsg {
				return bad("emoji", "OUT_OF_RANGE", "Bir mesaja en çok 20 farklı tepki eklenebilir.")
			}
		}
		n, err := q.InsertReaction(ctx, dbq.InsertReactionParams{ChannelID: ids[0], MessageID: ids[1], Emoji: req.Emoji, UserID: uid})
		if err != nil || n == 0 {
			return err // zaten vardı: olay yok (idempotent)
		}
		pm, err := partial(ctx, q, ch.Row.GuildID, uid)
		if err != nil {
			return err
		}
		return h.emitMessageEvent(ctx, q, ids[0], ch.Row.GuildID, gen.GatewayEventNameMESSAGEREACTIONADD,
			reactionEvent(ids[0], ids[1], ch.Row.GuildID, uid, req.Emoji, pm))
	})
	if err != nil {
		return nil, err
	}
	_ = h.cache.Delete(ctx, ids[0], ids[1])
	return gen.MessagesAddReaction204Response{}, nil
}

func (h *Handler) removeReaction(ctx context.Context, cid, mid, actor, target int64, emoji string) error {
	if err := checkEmoji(emoji); err != nil {
		return err
	}
	err := h.d.Tx(ctx, func(q *dbq.Queries) error {
		ch, err := h.textChannel(ctx, q, cid, actor)
		if err != nil {
			return err
		}
		if target != actor {
			if err := ch.Require(perm.ManageMessages); err != nil {
				return err
			}
		}
		if _, err := q.GetMessage(ctx, dbq.GetMessageParams{ChannelID: cid, ID: mid}); err != nil {
			if core.NotFound(err) {
				return unknownMessage()
			}
			return err
		}
		n, err := q.DeleteReaction(ctx, dbq.DeleteReactionParams{ChannelID: cid, MessageID: mid, Emoji: emoji, UserID: target})
		if err != nil || n == 0 {
			return err
		}
		return h.emitMessageEvent(ctx, q, cid, ch.Row.GuildID, gen.GatewayEventNameMESSAGEREACTIONREMOVE,
			reactionEvent(cid, mid, ch.Row.GuildID, target, emoji, nil))
	})
	if err != nil {
		return err
	}
	_ = h.cache.Delete(ctx, cid, mid)
	return nil
}

func (h *Handler) MessagesRemoveOwnReaction(ctx context.Context, req gen.MessagesRemoveOwnReactionRequestObject) (gen.MessagesRemoveOwnReactionResponseObject, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := core.IDs(req.ChannelId, req.MessageId)
	if err != nil {
		return nil, err
	}
	if err := h.removeReaction(ctx, ids[0], ids[1], uid, uid, req.Emoji); err != nil {
		return nil, err
	}
	return gen.MessagesRemoveOwnReaction204Response{}, nil
}

func (h *Handler) MessagesRemoveUserReaction(ctx context.Context, req gen.MessagesRemoveUserReactionRequestObject) (gen.MessagesRemoveUserReactionResponseObject, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := core.IDs(req.ChannelId, req.MessageId, req.UserId)
	if err != nil {
		return nil, err
	}
	if err := h.removeReaction(ctx, ids[0], ids[1], uid, ids[2], req.Emoji); err != nil {
		return nil, err
	}
	return gen.MessagesRemoveUserReaction204Response{}, nil
}

func (h *Handler) MessagesListReactions(ctx context.Context, req gen.MessagesListReactionsRequestObject) (gen.MessagesListReactionsResponseObject, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := core.IDs(req.ChannelId, req.MessageId)
	if err != nil {
		return nil, err
	}
	var after int64
	if req.Params.After != nil {
		if after, err = core.ID(*req.Params.After); err != nil {
			return nil, err
		}
	}
	limit := int32(25)
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	if limit < 1 || limit > 100 {
		return nil, bad("limit", "OUT_OF_RANGE", "limit 1–100 olmalı.")
	}
	q := h.d.Q()
	ch, err := h.textChannel(ctx, q, ids[0], uid)
	if err != nil {
		return nil, err
	}
	if err := ch.Require(perm.ReadMessageHistory); err != nil {
		return nil, err
	}
	us, err := q.ListReactionUsers(ctx, dbq.ListReactionUsersParams{ChannelID: ids[0], MessageID: ids[1], Emoji: req.Emoji, UserID: after, Limit: limit})
	if err != nil {
		return nil, err
	}
	out := make(gen.MessagesListReactions200JSONResponse, 0, len(us))
	for _, u := range us {
		out = append(out, view.User(u))
	}
	return out, nil
}
