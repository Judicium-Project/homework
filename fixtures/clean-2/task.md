# G32 · Ses kartı sol sütuna, düğme taşması biter (PLAN-B S1)

## Amaç
Kullanıcı: sese girince "seste olanlar" kartı sağ sütunda üyelerin üstünde çıkıyor; düğmeler (Mikrofon / Ekran / Ayrıl, yazılı) 280 px sütundan **sağa taşıyor**; konum da kötü. Karar: ses bağlantı kartı **sol sütunda, kanal listesinin altında, kullanıcı çubuğunun (UserBar) hemen üstünde** (Discord mantığı). Katılımcılar zaten kanal listesinde ses kanalının altında gösteriliyor (`ChannelList.tsx` ~256–270) → kartta katılımcı listesi tekrarlanmaz.

## Önce oku
- AGENTS.md, design/TASARIM.md (ham değer yasak; token kullan)
- apps/web/src/features/shell/{Shell.tsx, VoiceCard.tsx, shell.module.css, ChannelList.tsx, UserBar.tsx, Drawers.tsx}
- apps/web/src/ui/{Button.tsx, Tooltip.tsx (varsa)}, apps/web/src/i18n/tr.ts, apps/web/src/i18n/trVoice.ts
- apps/web/e2e/*.spec.ts ve e2e/voice.mjs — `data-testid="voice-card"` ve düğme etiketlerini kullanan seçiciler KORUNMALI

## Dosyalar
Yalnız: Shell.tsx, VoiceCard.tsx, shell.module.css, i18n dosyaları, gerekirse yeni `VoiceCard.test.tsx`. Başka dosya gerekirse DUR ve raporla.

## Yapılacaklar
1. **Konum:** `VoiceCard` sağ sütundan (`rightCol`) ve üye çekmecesinden (`membersDrawer`) çıkar; sol sütunda `<ChannelColumn />` ile `<UserBar />` arasına koy. Kanal listesi kaydırılır, kart + UserBar altta sabit kalır (kart kanal listesini aşağı itip taşırmaz). Sağ sütun yalnız üye paneli olur; `showRightCol` hesabı yalnız `membersColumn && guildId`'e göre güncellenir (artık `inVoice` sağ sütunu açmaz).
2. **Kart içeriği (sıkı):**
   - Üst satır: durum ("Sese bağlı", ses yeşili token) + altında kanal adı (tek satır, `text-overflow: ellipsis`); satır tıklanınca kanala gider (mevcut davranış).
   - Katılımcı listesi kaldırılır (kanal listesinde var).
   - Kontroller: **ikon düğmeler** (`IconButton`) tek satırda — Mikrofon (susturma durumu), Ekran paylaş, Ayrıl (danger). Her birinin `aria-label`'ı mevcut metin (`micLabel`, `voice.bar.share`, `voice.leave`) ve tooltip'i aynı metin. `aria-pressed` ve izin reddi davranışı aynen korunur.
   - Kendi yayını açıkken ekran düğmesi vurgulu.
3. **Taşma garantisi:** kartın ve içindeki her öğenin `min-width: 0`; kontrol satırı `display:flex; flex-wrap: nowrap`, düğmeler sabit boyut token'ı. Sütun 230 px'te bile yatay taşma olmaz. Yazılı düğme kalmaz.
4. **Mobil (MOBILE_QUERY):** mevcut `VoiceLiveStrip` aynen kalır; nav çekmecesi açılınca kart sol sütunda görünür (çekmece zaten sol sütunu içeriyor).
5. Ham değer yok, `text-transform` yalnız `none`.

## Testler / Kabul
- [ ] `pnpm --filter ./apps/web lint && pnpm --filter ./apps/web test && pnpm --filter ./apps/web build`
- [ ] Yeni birim testi `VoiceCard.test.tsx`: ses bağlıyken kart 3 ikon düğmeyi `aria-label` ile içerir; katılımcı listesi yok; Ayrıl tıklanınca `voice.leave` çağrılır (mock).
- [ ] `grep -n "VoiceCard" apps/web/src/features/shell/Shell.tsx` → yalnız sol sütunda 1 kullanım
- [ ] e2e seçicileri bozulmadı (raporda: `voice-card` ve düğme etiketlerini kullanan satırlar ve yeni kabukta karşılıkları)
- [ ] `grep -rn "text-transform" apps/web/src` yalnız `none`
- [ ] Raporda: 230 px sol sütunda taşmayı hangi CSS kuralları engelliyor (tek satır)

## Yasak
Token/tasarım değeri değişikliği, ses motoru (`voice/engine.ts`) mantığı, API, e2e testini değiştirmek, yeni bağımlılık, `git commit`.
