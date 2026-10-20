//go:build integration

package app_test

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	lkauth "github.com/livekit/protocol/auth"

	"github.com/eirikaleid/chatapp/services/chatapp/internal/gateway"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/perm"
	"github.com/eirikaleid/chatapp/services/chatapp/internal/testenv"
)

func msgPath(cid string, more ...string) string {
	return "/v1/channels/" + cid + "/messages" + strings.Join(more, "")
}

func twoUsers(t *testing.T, e *testenv.Env, a, b string) (*testenv.User, *testenv.User, string, string) {
	t.Helper()
	o, m := e.NewUser(a), e.NewUser(b)
	g := createGuild(e, o, "Mesajlar", "")
	join(e, m, newInvite(e, o, chanID(g, "genel", 0), nil)["code"].(string)).Expect(200, "")
	return o, m, g["id"].(string), chanID(g, "genel", 0)
}

// KABUL 8 (mesaj yetkileri) + uç davranışları.
func TestMessagesCRUD(t *testing.T) {
	e := testenv.New(t)
	o, b, gid, ch := twoUsers(t, e, "mo", "mb")

	// Oluştur: içerik doğrulama, boş/aşırı uzun, bahsetme ayrıştırma, nonce tekilleştirme.
	e.Do("POST", msgPath(ch), o.Token, obj{"content": "   "}).Expect(422, "VALIDATION_FAILED")
	e.Do("POST", msgPath(ch), o.Token, obj{"content": strings.Repeat("a", 4001)}).Expect(422, "VALIDATION_FAILED")
	m1 := e.Do("POST", msgPath(ch), o.Token, obj{"content": "selam <@" + b.ID + "> @everyone", "nonce": "n1"}).Expect(200, "").Map()
	if m1["nonce"] != "n1" || m1["mention_everyone"] != true || len(list(m1["mentions"])) != 1 || m1["type"].(float64) != 0 {
		t.Fatalf("m1: %v", m1)
	}
	again := e.Do("POST", msgPath(ch), o.Token, obj{"content": "selam <@" + b.ID + "> @everyone", "nonce": "n1"}).Expect(200, "").Map()
	if again["id"] != m1["id"] {
		t.Fatalf("nonce tekilleştirme: %v vs %v", again["id"], m1["id"])
	}
	// Sıradan üye @everyone'ı bahsedemez (MENTION_EVERYONE yok) → düz metin.
	m2 := e.Do("POST", msgPath(ch), b.Token, obj{"content": "ben @everyone", "message_reference": obj{"message_id": m1["id"]}}).Expect(200, "").Map()
	if m2["mention_everyone"] != false || m2["type"].(float64) != 19 || m2["referenced_message"].(obj)["id"] != m1["id"] {
		t.Fatalf("m2: %v", m2)
	}
	// Yanıt: yanıtlanan yazar (o) bahsedilmiş sayılır.
	if len(list(m2["mentions"])) != 1 {
		t.Fatalf("yanıt bahsetmesi: %v", m2["mentions"])
	}
	e.Do("POST", msgPath(ch), b.Token, obj{"content": "x", "message_reference": obj{"message_id": "1"}}).Expect(422, "VALIDATION_FAILED")
	// Okunmamış bahsetme sayacı: B'yi anan 1 mesaj.
	rs, _ := e.Deps.Q().ListReadStates(t.Context(), mustID(t, b.ID))
	cnt := int32(0)
	for _, r := range rs {
		if r.ChannelID == mustID(t, ch) {
			cnt = r.MentionCount
		}
	}
	if cnt != 1 {
		t.Fatalf("mention_count=%d, 1 beklenir", cnt)
	}

	// Liste: yeniden eskiye, before/after/limit.
	l := list(e.Do("GET", msgPath(ch), b.Token, nil).Expect(200, "").Map2())
	if len(l) != 3 || l[0].(obj)["id"] != m2["id"] || l[2].(obj)["type"].(float64) != 7 { // 3. = katılım sistem mesajı
		t.Fatalf("liste: %v", l)
	}
	l = list(e.Do("GET", msgPath(ch)+"?before="+m2["id"].(string)+"&limit=1", b.Token, nil).Expect(200, "").Map2())
	if len(l) != 1 || l[0].(obj)["id"] != m1["id"] {
		t.Fatalf("before: %v", l)
	}
	l = list(e.Do("GET", msgPath(ch)+"?after="+m1["id"].(string), b.Token, nil).Expect(200, "").Map2())
	if len(l) != 1 || l[0].(obj)["id"] != m2["id"] {
		t.Fatalf("after: %v", l)
	}
	e.Do("GET", msgPath(ch)+"?before=1&after=2", b.Token, nil).Expect(422, "")

	// Düzenle: yalnız yazar.
	e.Do("PATCH", msgPath(ch, "/", m1["id"].(string)), b.Token, obj{"content": "hile"}).Expect(403, "MISSING_PERMISSIONS")
	up := e.Do("PATCH", msgPath(ch, "/", m1["id"].(string)), o.Token, obj{"content": "düzenlendi"}).Expect(200, "").Map()
	if up["content"] != "düzenlendi" || up["edited_timestamp"] == nil {
		t.Fatalf("düzenle: %v", up)
	}

	// Tepkiler.
	rp := func(mid, emoji string) string {
		return msgPath(ch, "/", mid, "/reactions/", url.PathEscape(emoji), "/@me")
	}
	e.Do("PUT", rp(m1["id"].(string), "👍"), b.Token, nil).Expect(204, "")
	e.Do("PUT", rp(m1["id"].(string), "👍"), b.Token, nil).Expect(204, "") // idempotent
	e.Do("PUT", rp(m1["id"].(string), "abc"), b.Token, nil).Expect(422, "VALIDATION_FAILED")
	g1 := e.Do("GET", msgPath(ch, "/", m1["id"].(string)), b.Token, nil).Expect(200, "").Map()
	r0 := list(g1["reactions"])[0].(obj)
	if r0["count"].(float64) != 1 || r0["me"] != true {
		t.Fatalf("tepki: %v", g1["reactions"])
	}
	us := list(e.Do("GET", msgPath(ch, "/", m1["id"].(string), "/reactions/", url.PathEscape("👍")), o.Token, nil).Expect(200, "").Map2())
	if len(us) != 1 {
		t.Fatalf("tepki verenler: %v", us)
	}
	e.Do("DELETE", rp(m1["id"].(string), "👍"), b.Token, nil).Expect(204, "")

	// Okundu.
	e.Do("POST", msgPath(ch, "/", m2["id"].(string), "/ack"), b.Token, nil).Expect(204, "")
	if len(e.Outbox("MESSAGE_ACK")) != 1 {
		t.Fatal("MESSAGE_ACK outbox'ta olmalı")
	}

	// Sil: başkasının mesajını MANAGE_MESSAGES'sız silemez; sahip siler; yumuşak silme + denetim kaydı.
	e.Do("DELETE", msgPath(ch, "/", m1["id"].(string)), b.Token, nil).Expect(403, "MISSING_PERMISSIONS")
	e.Do("DELETE", msgPath(ch, "/", m2["id"].(string)), o.Token, nil).Expect(204, "")
	e.Do("DELETE", msgPath(ch, "/", m2["id"].(string)), o.Token, nil).Expect(404, "UNKNOWN_MESSAGE")
	e.Do("DELETE", msgPath(ch, "/", m1["id"].(string)), b.Token, nil) // b yazar değil: zaten 403
	var delAt *time.Time
	testenv.Must(t, e.Deps.Pool.QueryRow(t.Context(), `SELECT deleted_at FROM messages WHERE id=$1`, mustID(t, m2["id"].(string))).Scan(&delAt))
	if delAt == nil {
		t.Fatal("yumuşak silme: deleted_at dolu olmalı")
	}
	al := e.Do("GET", "/v1/guilds/"+gid+"/audit-logs", o.Token, nil).Expect(200, "").Body
	if !strings.Contains(string(al), "72") && !strings.Contains(strings.ToLower(string(al)), "message_delete") {
		t.Fatalf("moderatör silmesi denetim kaydında olmalı: %s", al)
	}
	for _, ev := range []string{"MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "MESSAGE_REACTION_ADD", "MESSAGE_REACTION_REMOVE"} {
		if len(e.Outbox(ev)) == 0 {
			t.Fatalf("%s outbox'ta yok", ev)
		}
	}

	// KABUL 8: kanalda SEND_MESSAGES reddedilince 403; yazmayan okuyabilir.
	e.Do("PUT", "/v1/channels/"+ch+"/permissions/"+b.ID, o.Token, obj{"type": 1, "deny": perms(perm.SendMessages)}).Expect(204, "")
	e.Do("POST", msgPath(ch), b.Token, obj{"content": "yasak"}).Expect(403, "MISSING_PERMISSIONS")
	e.Do("GET", msgPath(ch), b.Token, nil).Expect(200, "")
	// Görünmez kanal: 404.
	e.Do("PUT", "/v1/channels/"+ch+"/permissions/"+b.ID, o.Token, obj{"type": 1, "deny": perms(perm.ViewChannel)}).Expect(204, "")
	e.Do("GET", msgPath(ch), b.Token, nil).Expect(404, "UNKNOWN_CHANNEL")
}

func TestJoinSystemMessage(t *testing.T) {
	e := testenv.New(t)
	o, b := e.NewUser("syso"), e.NewUser("sysb")
	g := createGuild(e, o, "Sistem", "community")
	sys, _ := g["system_channel_id"].(string)
	if sys == "" {
		t.Skip("şablonda sistem kanalı yok")
	}
	join(e, b, newInvite(e, o, sys, nil)["code"].(string)).Expect(200, "")
	l := list(e.Do("GET", msgPath(sys), o.Token, nil).Expect(200, "").Map2())
	if len(l) == 0 || l[0].(obj)["type"].(float64) != 7 {
		t.Fatalf("GUILD_MEMBER_JOIN sistem mesajı beklenir: %v", l)
	}
}

// KABUL 4 + 5: iki WS istemcisi, görünürlük süzmesi, RESUME, presence, typing.
func TestGatewayFlow(t *testing.T) {
	e := testenv.New(t)
	_, ts := e.StartGateway(gateway.Config{HeartbeatMS: 60000, OfflineGrace: 150 * time.Millisecond, PollEvery: 200 * time.Millisecond})
	o, b, gid, ch := twoUsers(t, e, "go", "gb")
	c := e.NewUser("gc") // gizli kanalı görmeyecek üçüncü kullanıcı
	join(e, c, newInvite(e, o, ch, nil)["code"].(string)).Expect(200, "")
	priv := e.Do("POST", "/v1/guilds/"+gid+"/channels", o.Token, obj{"name": "gizli", "type": 0,
		"permission_overwrites": []obj{{"id": gid, "type": 0, "deny": perms(perm.ViewChannel)}}}).Expect(201, "").Map()["id"].(string)

	wa, _ := testenv.DialWS(t, ts.URL)
	ready := wa.Identify(o.Token, nil)
	if len(list(ready["guilds"])) != 1 || ready["session_id"] == "" {
		t.Fatalf("READY: %v", ready)
	}
	wb, _ := testenv.DialWS(t, ts.URL)
	wb.Identify(b.Token, nil)
	wc, _ := testenv.DialWS(t, ts.URL)
	rc := wc.Identify(c.Token, nil)
	for _, gg := range list(rc["guilds"]) {
		for _, cc := range list(gg.(obj)["channels"]) {
			if cc.(obj)["id"] == priv {
				t.Fatal("READY gizli kanalı sızdırdı")
			}
		}
	}

	// KABUL 4: B gönderir, A ≤1 sn alır.
	start := time.Now()
	m := e.Do("POST", msgPath(ch), b.Token, obj{"content": "canlı"}).Expect(200, "").Map()
	ev := wa.ExpectWhere("MESSAGE_CREATE", time.Second, func(d map[string]any) bool { return d["id"] == m["id"] })
	lat := time.Since(start)
	t.Logf("G-01 uçtan uca (POST→WS) = %v", lat)
	if ev["guild_id"] != gid || ev["member"] == nil {
		t.Fatalf("olay yükü: %v", ev)
	}
	// Görünürlük: gizli kanal olayı yalnız izinlilere (o); b/c almaz.
	pm := e.Do("POST", msgPath(priv), o.Token, obj{"content": "sır"}).Expect(200, "").Map()
	wa.ExpectWhere("MESSAGE_CREATE", 2*time.Second, func(d map[string]any) bool { return d["id"] == pm["id"] })
	wc.ExpectWhere("MESSAGE_CREATE", time.Second, func(d map[string]any) bool { return d["id"] == m["id"] })
	wc.NoEvent("MESSAGE_CREATE", 500*time.Millisecond)

	// Typing: B yazıyor → A görür (B kendi olayını almaz).
	e.Do("POST", "/v1/channels/"+ch+"/typing", b.Token, nil).Expect(204, "")
	wa.ExpectWhere("TYPING_START", 2*time.Second, func(d map[string]any) bool { return d["user_id"] == b.ID })

	// RESUME: A kopar, kaçırır, geri gelir.
	seq, sess := wa.Seq, wa.Sess
	wa.C.CloseNow()
	m2 := e.Do("POST", msgPath(ch), b.Token, obj{"content": "kaçan"}).Expect(200, "").Map()
	time.Sleep(300 * time.Millisecond)
	wa2, _ := testenv.DialWS(t, ts.URL)
	wa2.Send(6, obj{"token": o.Token, "session_id": sess, "seq": seq})
	wa2.ExpectWhere("MESSAGE_CREATE", 2*time.Second, func(d map[string]any) bool { return d["id"] == m2["id"] })
	wa2.Expect("RESUMED", time.Second)
	// Geçersiz oturum → INVALID_SESSION(false).
	wx, _ := testenv.DialWS(t, ts.URL)
	wx.Send(6, obj{"token": o.Token, "session_id": "yok", "seq": 1})
	if f := wx.Read(2 * time.Second); f == nil || f.Op != 9 || string(f.D) != "false" {
		t.Fatalf("INVALID_SESSION beklenir: %+v", f)
	}
}

// KABUL 5: presence online → offline (+ görünmez = offline).
func TestPresence(t *testing.T) {
	e := testenv.New(t)
	_, ts := e.StartGateway(gateway.Config{HeartbeatMS: 60000, OfflineGrace: 150 * time.Millisecond, PollEvery: 200 * time.Millisecond})
	o, b, _, _ := twoUsers(t, e, "po", "pb")
	wa, _ := testenv.DialWS(t, ts.URL)
	wa.Identify(o.Token, nil)
	wb, _ := testenv.DialWS(t, ts.URL)
	t0 := time.Now()
	wb.Identify(b.Token, nil)
	wa.ExpectWhere("PRESENCE_UPDATE", 2*time.Second, func(d map[string]any) bool {
		return d["status"] == "online" && d["user"].(obj)["id"] == b.ID
	})
	t.Logf("G-02 çevrimiçi bildirimi = %v", time.Since(t0))
	vk := e.Deps.Valkey
	if v, err := vk.Do(t.Context(), vk.B().Hget().Key("presence:"+b.ID).Field("web").Build()).ToString(); err != nil || v != "online" {
		t.Fatalf("Valkey presence HASH: %q %v", v, err)
	}
	// Durum değişimi (op 3): dnd.
	wb.Send(3, obj{"status": "dnd", "since": nil, "afk": false})
	wa.ExpectWhere("PRESENCE_UPDATE", 2*time.Second, func(d map[string]any) bool { return d["status"] == "dnd" })
	// Görünmez: başkalarına offline.
	wb.Send(3, obj{"status": "invisible", "since": nil, "afk": false})
	wa.ExpectWhere("PRESENCE_UPDATE", 2*time.Second, func(d map[string]any) bool { return d["status"] == "offline" })
	wb.Send(3, obj{"status": "online", "since": nil, "afk": false})
	wa.ExpectWhere("PRESENCE_UPDATE", 2*time.Second, func(d map[string]any) bool { return d["status"] == "online" })
	// Kopma: ≤ grace sonrası offline.
	t1 := time.Now()
	wb.C.CloseNow()
	wa.ExpectWhere("PRESENCE_UPDATE", 3*time.Second, func(d map[string]any) bool { return d["status"] == "offline" && d["user"].(obj)["id"] == b.ID })
	t.Logf("G-02 kopma→offline = %v", time.Since(t1))
}

// #13: bağlıyken sunucuya katılan kullanıcının durumu (GUILD_CREATE sonrası) mevcut üyelere PRESENCE_UPDATE olarak gider;
// yeniden bağlanmadan çevrimdışı görünmez. Katılmadan önce seçtiği durum (dnd) korunur; ortak sunucusu olmayan almaz.
func TestPresenceOnGuildJoin(t *testing.T) {
	e := testenv.New(t)
	_, ts := e.StartGateway(gateway.Config{HeartbeatMS: 60000, OfflineGrace: 150 * time.Millisecond, PollEvery: 200 * time.Millisecond})
	o, b, gid, ch := twoUsers(t, e, "jo", "jb")
	c := e.NewUser("jc")   // bağlı, henüz üye değil
	out := e.NewUser("jx") // hiçbir ortak sunucusu yok
	wo, _ := testenv.DialWS(t, ts.URL)
	wo.Identify(o.Token, nil)
	wb, _ := testenv.DialWS(t, ts.URL)
	wb.Identify(b.Token, nil)
	wo.ExpectWhere("PRESENCE_UPDATE", 2*time.Second, func(d map[string]any) bool { return d["user"].(obj)["id"] == b.ID })
	wx, _ := testenv.DialWS(t, ts.URL)
	wx.Identify(out.Token, nil)
	wc, _ := testenv.DialWS(t, ts.URL)
	if r := wc.Identify(c.Token, nil); len(list(r["guilds"])) != 0 {
		t.Fatalf("c henüz üye değil: %v", r["guilds"])
	}
	// Katılmadan önce durum değişir; ortak sunucu olmadığı için kimseye gitmez (op 3 bağlantı goroutine'inde
	// hemen işlenir, GUILD_CREATE ise outbox relay'inden ≥ PollEvery sonra gelir).
	wc.Send(3, obj{"status": "dnd", "since": nil, "afk": false})

	t0 := time.Now()
	join(e, c, newInvite(e, o, ch, nil)["code"].(string)).Expect(200, "")
	wc.ExpectWhere("GUILD_CREATE", 2*time.Second, func(d map[string]any) bool { return d["id"] == gid })
	isC := func(d map[string]any) bool {
		return d["user"].(obj)["id"] == c.ID && d["guild_id"] == gid && d["status"] == "dnd"
	}
	wo.ExpectWhere("PRESENCE_UPDATE", 2*time.Second, isC)
	wb.ExpectWhere("PRESENCE_UPDATE", 2*time.Second, isC)
	t.Logf("katılım→presence = %v", time.Since(t0))
	// NoEvent okuma zaman aşımında bağlantıyı kapatır: yalnız sonda kullanılır.
	wx.NoEvent("PRESENCE_UPDATE", 400*time.Millisecond)
}

func lkClaims(t *testing.T, e *testenv.Env, tok string) *lkauth.ClaimGrants {
	t.Helper()
	v, err := lkauth.ParseAPIToken(tok)
	if err != nil {
		t.Fatal(err)
	}
	_, claims, err := v.Verify(e.Deps.Cfg.LiveKit.APISecret.Reveal())
	if err != nil {
		t.Fatal(err)
	}
	return claims
}

// M-03 test vektörleri: izinli · izinsiz 403 · SPEAK yok · STREAM yok · başka kanal yok · ömür ≤60 sn.
func TestVoiceJoinGrants(t *testing.T) {
	e := testenv.New(t)
	o, b, gid, text := twoUsers(t, e, "vo", "vb")
	vc := e.Do("POST", "/v1/guilds/"+gid+"/channels", o.Token, obj{"name": "ses", "type": 2}).Expect(201, "").Map()["id"].(string)
	vc2 := e.Do("POST", "/v1/guilds/"+gid+"/channels", o.Token, obj{"name": "ses2", "type": 2}).Expect(201, "").Map()["id"].(string)

	// 1) izinli: tüm kaynaklar + oda = voice:<id> + ömür ≤ 60 sn.
	r := e.Do("POST", "/v1/voice/join", b.Token, obj{"channel_id": vc}).Expect(200, "").Map()
	cl := lkClaims(t, e, r["token"].(string))
	if cl.Video == nil || cl.Video.Room != "voice:"+vc || !cl.Video.RoomJoin || cl.Identity != b.ID || cl.Video.CanPublish == nil || !*cl.Video.CanPublish ||
		len(cl.Video.CanPublishSources) != 4 || !*cl.Video.CanSubscribe {
		t.Fatalf("grant: %+v %+v", cl, cl.Video)
	}
	if ttl := cl.Video; ttl == nil {
		t.Fatal()
	}
	exp, _ := time.Parse(time.RFC3339, r["expires_at"].(string))
	if d := time.Until(exp); d > 60*time.Second || d < 30*time.Second {
		t.Fatalf("ömür: %v", d)
	}
	if r["room"] != "voice:"+vc || r["voice_state"].(obj)["channel_id"] != vc {
		t.Fatalf("yanıt: %v", r)
	}
	// başka kanala geçiş: eski ses durumu silinir (tek bağlantı).
	e.Do("POST", "/v1/voice/join", b.Token, obj{"channel_id": vc2}).Expect(200, "")
	if n := len(e.Outbox("VOICE_STATE_UPDATE")); n < 3 {
		t.Fatalf("VOICE_STATE_UPDATE (join, ayrıl, join) beklenir: %d", n)
	}
	// metin kanalına katılım olmaz.
	e.Do("POST", "/v1/voice/join", b.Token, obj{"channel_id": text}).Expect(422, "")
	// 2) izinsiz: CONNECT yok → 403.
	e.Do("PUT", "/v1/channels/"+vc+"/permissions/"+b.ID, o.Token, obj{"type": 1, "deny": perms(perm.Connect)}).Expect(204, "")
	e.Do("POST", "/v1/voice/join", b.Token, obj{"channel_id": vc}).Expect(403, "MISSING_PERMISSIONS")
	// 3) SPEAK yok → canPublish false, mikrofon kaynağı yok.
	e.Do("PUT", "/v1/channels/"+vc+"/permissions/"+b.ID, o.Token, obj{"type": 1, "deny": perms(perm.Speak)}).Expect(204, "")
	cl = lkClaims(t, e, e.Do("POST", "/v1/voice/join", b.Token, obj{"channel_id": vc}).Expect(200, "").Map()["token"].(string))
	if *cl.Video.CanPublish {
		t.Fatal("SPEAK yokken canPublish false olmalı")
	}
	for _, s := range cl.Video.CanPublishSources {
		if s == "microphone" {
			t.Fatal("SPEAK yokken mikrofon kaynağı olmamalı")
		}
	}
	// 4) STREAM yok → yalnız mikrofon.
	e.Do("PUT", "/v1/channels/"+vc+"/permissions/"+b.ID, o.Token, obj{"type": 1, "deny": perms(perm.Stream)}).Expect(204, "")
	cl = lkClaims(t, e, e.Do("POST", "/v1/voice/join", b.Token, obj{"channel_id": vc}).Expect(200, "").Map()["token"].(string))
	if len(cl.Video.CanPublishSources) != 1 || cl.Video.CanPublishSources[0] != "microphone" || !*cl.Video.CanPublish {
		t.Fatalf("STREAM yok → yalnız mikrofon: %+v", cl.Video)
	}
	// 5) başka kanal yok: yalnız o oda (token tek odaya).
	if cl.Video.Room != "voice:"+vc || strings.Contains(cl.Video.Room, vc2) {
		t.Fatalf("oda: %s", cl.Video.Room)
	}
	// Durum bayrakları + STREAM izni olmadan self_stream 403; ayrıl.
	e.Do("PATCH", "/v1/voice/state", b.Token, obj{"self_mute": true}).Expect(200, "")
	e.Do("PATCH", "/v1/voice/state", b.Token, obj{"self_stream": true}).Expect(403, "MISSING_PERMISSIONS")
	e.Do("POST", "/v1/voice/leave", b.Token, nil).Expect(204, "")
	e.Do("PATCH", "/v1/voice/state", b.Token, obj{"self_mute": true}).Expect(404, "")
	// K32: oturum meta verisi.
	var n int
	testenv.Must(t, e.Deps.Pool.QueryRow(t.Context(), `SELECT count(*) FROM voice_sessions WHERE user_id=$1 AND ip<>'' AND left_at IS NOT NULL`, mustID(t, b.ID)).Scan(&n))
	if n < 1 {
		t.Fatal("voice_sessions kaydı (IP+port, çıkış) yok")
	}
	_ = json.Marshal
}
