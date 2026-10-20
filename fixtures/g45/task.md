# G45 · Mesaj uzunluk sınırı tek kaynak + doğru hata gösterimi (PLAN-C N3, N4)

Kök neden (ölçüldü): sunucu `services/chatapp/internal/message/handler.go` `validateContent` >4000 rune → 422 `VALIDATION_FAILED` + alan hatası `TOO_LONG`; web genel "Girdi doğrulanamadı." gösteriyor (alan mesajını değil). `Composer` `maxLength={4000}` UTF-16 sayıyor → uzun yapıştırma SESSİZCE kesiliyor. 4000 dört yerde kopya: DB CHECK (00001_init.sql), TypeSpec `@maxLength(4000)`, Go sabiti, Composer.

## Yapılacak
1. **Tek kaynak:** `contracts/` içinde sınır sabitleri (ör. `limits.tsp` ya da mevcut düzenin gerektirdiği yer): `MESSAGE_CONTENT_MAX = 4000` (ücretsiz). Go ve TS bu tek kaynaktan üretilsin/okunsun (`pnpm gen` hattına bağla). Go'daki ve web'deki elle yazılmış 4000'ler kaldırılır. Sınır değeri BU görevde 4000 KALIR (artış Dalga 8, K64/N4).
2. **DB:** yeni goose migration (numara: mevcut en büyük + 1): mesaj içeriği CHECK sınırını 16000'e gevşet (tavan; ileride premium artışında migration gerekmesin). Down: 4000'e geri (yalnız uzun satır yoksa; varsa down hata versin, sessiz kırpma yok).
3. **Sunucu hata:** `TOO_LONG` alan hatası yanıtında `max` ve `actual` değerleri (rune) dönsün (sözleşmede tanımlı alanlarla; yoksa ek, geriye uyumlu alan).
4. **Web gösterim:** API istemcisi 422'de alan hatasını okur; Composer altında "Mesaj çok uzun: X / 4000 karakter" (i18n anahtarı, mevcut `t()` sistemi). Genel "Girdi doğrulanamadı" yalnız alan hatası yoksa.
5. **Composer:** `maxLength` kaldır (yapıştırma kesilmez). Sayaç: son %10'da görünür, aşınca kırmızı; aşımda gönder düğmesi + Enter devre dışı. Sayım sunucuyla aynı birim (Unicode code point: `[...str].length`).
6. **"Dosya olarak gönder":** sınır aşıldığında sayacın yanında düğme → metni `mesaj.txt` (text/plain, UTF-8) eki olarak mevcut ek yükleme yoluyla gönderir, yazma alanını temizler. Ek boyut sınırı mevcut kuralla.
7. Mesaj DÜZENLEME yolu da aynı sınır, sayaç ve hata gösterimini kullanır.

## Kabul
- [ ] `pnpm gen` sonrası üretilen dosyalar güncel; `git grep -n "4000" -- services apps contracts` yalnız tek kaynak + üretilen dosyalar + testler
- [ ] Go: 4001 rune → 422 TOO_LONG max=4000 actual=4001; 4000 emoji (çok baytlı) → kabul (birim/integration)
- [ ] Migration up/down integration testi (`-tags integration`)
- [ ] vitest: 5000 karakter yapıştır → değer 5000 kalır, sayaç kırmızı, gönder kapalı; "dosya olarak gönder" `.txt` File üretir; 422 alan hatası metni görünür
- [ ] `cd services/chatapp && go build ./... && go vet ./... && go test ./...`; `pnpm lint && pnpm test && pnpm build`; `node scripts/denetle-uyumluluk.mjs` 0 ihlal

## Yasak
Sınırı 4000'den yükseltmek, mevcut ErrorCode değerlerini değiştirmek, e2e dosyalarını değiştirmek, `text-transform: uppercase`, sabit Türkçe metin (i18n anahtarı kullan), `git commit`.
