# G46 · Kanal ayarı kapanması + taşmayan açılır bileşenler + alan boyları (PLAN-C N1, N5, N6)

## N1 — Kanal ayarları
`apps/web/src/features/settings/ChannelSettings.tsx`: kaydet başarılıysa başarı bildirimi (mevcut toast) + pencere KAPANIR. Kural (proje genel): Esc ile kapanır; kirli formda Esc/kapat → "Değişiklikler kaydedilsin mi?" (Kaydet / Kaydetmeden çık / Vazgeç). Aynı davranışı GuildSettings ve ServerSettings'teki tekil-alan kaydetmelerinde kontrol et; tutarsızsa ortak hook'a (`useDirtyCloseGuard` gibi) çıkar.

## N5 — Konumlama
`apps/web/src/ui/Menu.tsx` elle `getBoundingClientRect` + `position: fixed` kullanıyor, çarpışma yok. Yeni bağımlılık İZİNLİ: `@floating-ui/react` (yalnız bu). Tek yardımcı (`ui/floating.ts` ya da hook) ile flip + shift + size (yükseklik görünür alana sığmazsa iç kaydırma), `autoUpdate`. Kullanan yerler: Menu, Tooltip, açılır listeler/combobox, emoji seçici, bağlam menüsü, profil kartı açılırı — `git grep` ile bul, hepsini taşı. Modallar: max-height `100dvh - kenar boşluğu`, içerik kaydırılır, alt düğmeler görünür kalır (390 px dahil).

## N6 — Alan boyları
Tasarım token'ı: `--field-min-height` (tek satır) ve textarea için otomatik büyüme (içerikle büyür, en fazla 50vh, sonra kaydırma). Mesaj düzenleme alanı tam genişlik, en az 3 satır. Kanal açıklaması/konu, sunucu açıklaması, profil hakkında gibi çok satırlı alanlar textarea + otomatik büyüme.

## Kabul
- [ ] vitest: ChannelSettings ad değiştir → kaydet → onClose çağrılır; kirli formda Esc → onay iletişimi
- [ ] vitest/jsdom yetmezse Playwright birim-sayfa: 390×844 ve 1280×800'de ekranın 4 köşesine yakın tetikleyiciden açılan Menu'nun `getBoundingClientRect` tamamı görünür alanda (yeni e2e dosyası `apps/web/e2e/konumlama.spec.ts` İZİNLİ; mevcut e2e dosyalarına dokunma)
- [ ] `pnpm lint && pnpm test && pnpm build`; `node scripts/denetle-uyumluluk.mjs` 0 ihlal
- [ ] Tablo/yerleşim: taşma yok, metin kesilmesi yok (ellipsis yalnız tek satırlı adlarda + title/tooltip)

## Yasak
Başka yeni bağımlılık, mevcut e2e dosyalarını değiştirmek, `text-transform: uppercase`, sabit Türkçe metin (i18n anahtarı), `git commit`.

## Düzeltme turu 1 (bağımsız denetim bulguları)
1. `apps/web/e2e/konumlama.spec.ts` SAHTE: `setContent` + CDN'den floating-ui + el yazması fallback — gerçek uygulamayı test etmiyor. Sil ve yeniden yaz: gerçek uygulamada (mevcut e2e yığını/mock düzeniyle) gerçek `Menu`yu 390×844 ve 1280×800'de ekranın dört köşesine yakın tetikleyiciden aç, menü kutusunun `getBoundingClientRect` tamamının görünür alanda olduğunu doğrula. Harici ağ (CDN) YASAK.
2. `SettingsLayer` `dirty`/`onSave` hiçbir yerden verilmiyor → GuildSettings, ServerSettings ve UserSettings'te bağla; kirli formda Esc → onay iletişimi testleri.
3. `MessageItem.tsx` düzenleme alanı: ham `<textarea>` yerine `TextArea autoGrow` (≥3 satır, tam genişlik, ≤50vh).
4. `Menu.tsx:210` statik satır içi stil → CSS sınıfı.
5. `apps/web/package.json` bağımlılık sırasını eski haline getir (yalnız `@floating-ui/react` satırı eklensin).
6. Sunucu açıklaması alanı da `TextArea autoGrow` mu, kontrol et; değilse yap.
