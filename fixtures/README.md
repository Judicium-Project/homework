# fixtures — ölçüm korpusu (Faz 2)

Kaynak: ChatApp deposu (`~/Developer/kisisel/chatapp-wt-chatapp`, salt okundu). Her fixture: `task.md`, `base.txt`, `change.diff`, `contract.toml`, `expected.yaml` (+ g45'te `run-cached.log`).


| fixture | base | agy commit | görev dosyası |
|---|---|---|---|
| g45 | 5e22662 | 8e2144a (`wip(G45): agy tur 0`) | `gorev/G45-...` @5e22662 (orijinal) |
| g46 | 83d974a | eec883e (`wip(G46): agy tur 0`) | `gorev/G46-...` @5e22662 (orijinal) |
| g46-tur1 | 97d8078 | e1e08b0 (`wip(G46): tur 1 + package.json sirasi elle duzeltildi`) | `gorev/G46-...` @97d8078 (orijinal + Düzeltme turu 1) |
| clean-1 | 1769670 | e8c95a0 (`G01 agy`) | `gorev/G01-...` @9506130 |
| clean-2 | 3eb4fca | 8709f2d (`feat(web): ses kartı sol sütunda ... (G32)`) | `gorev/G32-...` @3eb4fca |

`expected.yaml` evidence alanlarındaki "Düzeltme turu N" atıfları, fixture `task.md`'sinde OLMAYAN sonraki görev sürümlerine işaret eder (task.md orijinal/önceki sürümdür); atıfın yanındaki hash o sürümün commit'idir: G45 turu 1 @3cd92dc, G46 turu 1 @97d8078, G46 turu 2 @562d4da, G46 turu 3 @fcbaf1b.

Görev dosyalarında frontmatter YOK (K46 hattı öncesi düz Markdown). Tam hash: `base.txt`.

## Çıkarım komutları
```sh
R=~/Developer/kisisel/chatapp-wt-chatapp
git -C $R rev-parse 5e22662 > fixtures/g45/base.txt
git -C $R diff 5e22662 8e2144a -- . ':(exclude)services/chatapp/internal/api/gen/api.gen.go' > fixtures/g45/change.diff
git -C $R show 5e22662:gorev/G45-mesaj-siniri-hata.md > fixtures/g45/task.md
git -C $R diff 83d974a eec883e > fixtures/g46/change.diff
git -C $R show 5e22662:gorev/G46-pencere-konumlama-alanlar.md > fixtures/g46/task.md
git -C $R diff 97d8078 e1e08b0 > fixtures/g46-tur1/change.diff
git -C $R show 97d8078:gorev/G46-pencere-konumlama-alanlar.md > fixtures/g46-tur1/task.md
git -C $R diff 1769670 e8c95a0 -- . ':(exclude)services/chatapp/internal/api/gen/api.gen.go' > fixtures/clean-1/change.diff
git -C $R show 9506130:gorev/G01-errorcode-genisletilebilir.md > fixtures/clean-1/task.md
git -C $R rev-parse 3eb4fca > fixtures/clean-2/base.txt
git -C $R diff 3eb4fca 8709f2d > fixtures/clean-2/change.diff
git -C $R show 3eb4fca:gorev/G32-ses-karti-sol-sutun.md > fixtures/clean-2/task.md
```
"agy commit" = depodaki `wip(Gxx): agy tur N` commit'i; `git diff base..agy` bu iki hash arasındadır.

## Kesimler ve sınırlar
- `api.gen.go` (g45, clean-1) dışlandı: üretilmiş, gömülü base64 OpenAPI spec.
- g46-tur1: commit agy çıktısı + geliştiricinin elle package.json düzeltmesi karışık; saf agy diff'i yok. package.json sırası bulgusu (eski G46T1-3) bu yüzden çıkarıldı: e1e08b0'daki sıra değişimi geliştiricinin elle geri düzeltmesi (83d974a sırası geri geliyor); A1'in package.json koşulu `g46/G46-2` ile ölçülür.
- g45 sorun 3 (sahte yeşil, turbo önbelleği) diff'te iz bırakmaz; yalnız görev dosyasındaki `--force` satırı kanıt. Ham koşu logu bulunamadı; ölçüm "koşucu testi" (expected.yaml G45-3) ve girdisi SENTETİK `g45/run-cached.log` (aşağıya bak).
- G46 tur 2/3 (isVisible ile sessiz atlama) ayrı fixture değil; bulgular `gorev/G46` Düzeltme turu 2/3'te.
- "Beklenen katman" HAFIZA.md hedefi + bekçi kural adaylarından çıkarım; tartışmalı olanlar expected.yaml'da işaretli.

## Sır taraması
grep (token, secret, passw, api key, bearer, private key, .env, AKIA, JWT, e-posta, IPv4, /Users/, uzun base64/hex) çalıştırıldı. **Gerçek sır bulunmadı; `REDACTED` ile değiştirilen: yok.** İncelenip bırakılanlar (placeholder/loopback/test verisi):
- g45/change.diff:633,647 — `o.Token` (test değişken adı); 792,811 — `postgres://chatapp@127.0.0.1:54320/...` (parolasız loopback test DSN); 826 — `limit@example.com`.
- g46/change.diff:369 — `test@example.com`; 1674-1690 — pnpm-lock `integrity` sha512 (public paket özeti).
- g46-tur1/change.diff:8 — `http://localhost:5410` (E2E varsayılanı); 547-548 — `smtpPassword` değişken adı.
- clean-2/change.diff:86 — `test@example.com` (test verisi); g45/run-cached.log sentetik, sır yok.
- `@chatapp/tokens`, `tokens.json` — tasarım token'ı, kimlik bilgisi değil.

## clean-1 seçim gerekçesi
G01 (ErrorCode `x-extensible-enum`): agy yazdı, Claude denetledi, tek commit ile kabul — depoda düzeltme turu commit'i yok (`G03/G04/G05` gibi `gorev: ... düzeltme turu` yok), PLAN'da "✅" ile kapandı. Küçük (1 satır yaml + 6 satır mjs), kapsam görev dosyasıyla birebir (yalnız `postprocess.mjs` + üretilen `openapi.yaml`), bağımlılık/test değişikliği yok. Sınırlama: "sorunsuz" kanıtı dolaylı (fix-round yokluğu); ayrı bağımsız denetim raporu depoda bulunamadı.

## contract.toml şeması (Faz 3 `.homework.toml` okuyucusu bunu kullanacak)
Özgün `task.md` metninden türetilmiş, DONDURULMUŞ sözleşme; her dosyanın başındaki yorum türetme gerekçesini verir. Uydurma yok: metinde olmayan alan boş bırakılır, belirsiz yol geniş glob + yorumla işaretlenir.

| anahtar | tür | anlam |
|---|---|---|
| `version` | int | şema sürümü (1) |
| `task`, `source` | string | görev kimliği; görev dosyası + commit |
| `allowed_paths` | string[] glob | değiştirilebilecek yollar; dışındaki her değişiklik kapsam taşması |
| `required_paths` | glob[] | görevin değiştirilmesini şart koştuğu dosyalar (K16); diff'te dokunulmayan → bulgu. Metinde yol yoksa alan yok/boş (uydurma yok) |
| `allowed_dependencies` | string[] | eklenebilecek paket adları; boş = yeni bağımlılık yok |
| `generated_by` | string | üretilmiş dosyaları yaratan komut (örn. `pnpm gen`); boş = yok. Çıktısı yol denetiminde izinli sayılır |
| `acceptance` | string[] | kabul KOMUTLARI, task.md'de yazıldığı gibi; koşucu önbelleksiz koşar |
| `acceptance_manual` | string[] | komut olmayan / beklenti metni olan maddeler (makine koşmaz; rapor/denetim içindir) |
| `[forbidden].paths` | glob[] | yasak yollar |
| `[forbidden].paths_except` | glob[] | `paths` içinde istisnalar (örn. yeni izinli e2e dosyası) |
| `[forbidden].patterns` | `{regex, globs}`[] | eklenen satırlarda yasak desen. UYARI: clean-2 deseni negatif lookahead kullanır (RE2 değil; Python `re`) |
| `[forbidden].notes` | string[] | mekanikleştirilemeyen yasaklar (insan/ikinci katman denetimi) |

| `[tests].exempt` | glob[] | (Faz 3) test-koruma denetiminin atlanacağı test dosyaları (görevin yeniden yazmasına izin verilen) |
| `[rules].disable` | string[] | (Faz 3) kapatılacak kural kimlikleri |
| `[rules].e2e_paths` | glob[] | (Faz 3) e2e kurallarının uygulanacağı yollar; varsayılan `**/e2e/**`, `**/*.e2e.*`, `**/playwright/**` |
| `env_passthrough` | string[] | (Faz 3) kabul komutlarına sabit izin listesine (PATH, HOME, LANG, LC_*, TMPDIR, TERM, CI) ek olarak geçirilecek ortam değişkeni adları; frontmatter'dan eklenemez |

Bilinmeyen anahtar `homework check`'te girdi hatasıdır (exit 2): yazım hatası bir denetimi sessizce kapatmasın.
Depo içindeki sözleşme ve görev dosyası `--base` sürümünden okunur (`git show`); çalışma ağacı/head farklıysa `contract-modified`/`task-modified` bulgusu ve kabul komutları koşmaz.
Görev frontmatter'ı (`--task`) sözleşmeyi yalnız genişletir: `files`→allowed_paths, `allowed_deps`→allowed_dependencies, `accept`→acceptance, `forbid_extra`→forbidden.patterns.

## base/ (Faz 3)
Her fixture'da `base/`: change.diff'in değiştirdiği/sildiği dosyaların taban içeriği (yeni dosyalar yok). `CHATAPP_REPO=<yol> scripts/fixtures-snapshot.sh` ile çıkarılır (ChatApp salt okunur). Testler bunu boş geçici depoya kopyalayıp change.diff'i uygular; CI ChatApp'suz koşar. Sır taraması (20.10, Faz 3): token/parola atama, AKIA, JWT, özel anahtar, kimlikli URL, uzun base64 — bulgu yok; yalnız test e-postaları (`*@example.com`, `*@chatapp.test`, `owner@test.com`) ve `127.0.0.1`.

`acceptance` boş + yorum notu: ilgili kabul maddesi komut içermiyorsa (şu an hiçbir fixture'da tamamen boş değil; komutsuz maddeler `acceptance_manual`'da).

## g45/run-cached.log — SENTETİK (moon biçimi)
Gerçek koşu logu değildir; moon 2.x cache-hit çıktı biçimine göre elle yazıldı. Biçim moon kaynağından doğrulandı (moonrepo/moon `crates/console/src/reporter.rs` @7c3b6f3, cli 2.6.2): cache-hit görev satırı `▮▮▮▮ <proje>:<görev> (cached, <süre>, <hash8>)`, özet `Tasks: N completed (M cached)` + `Time: … ❯❯❯ to the moon` (hepsi cache ise). Resmi doküman yalnız "terminalde 'cached' mesajı görürsünüz" der (concepts/cache); tam biçim dokümanda yok, kaynaktan alındı. Paket/proje kimlikleri, süreler, hash'ler, test sayıları gerçek koşudan DEĞİL.
ChatApp 5e22662/8e2144a'da `turbo.json` YOK; kök `package.json` `moon run :build|:test|:lint` kullanır (K16: moon). HAFIZA'daki "turbo önbelleği" aslında moon önbelleğidir; G45 görev dosyasındaki `pnpm turbo ... --force` satırı depoda çalışmayan bir komuttur. Önbelleksiz koşu: `moon run <hedef> --force` (resmi: "bypass cache") ya da global `--cache off` / `MOON_CACHE=off` (resmi: commands/overview). Koşucu deseni araç başına (moon/turbo/go `-count=1`). moon deseni: `\((cached|cached from remote)[,)]` ya da `\(\d+ cached\)`.

## clean-2 seçim gerekçesi
G32 (ses kartı sol sütuna, 8709f2d): UI yüzeyi (Shell.tsx, VoiceCard.tsx, shell.module.css + yeni VoiceCard.test.tsx; 4 dosya, +204/-85). Görev dosyası depoda tek commit'te (7923511) yazıldı, sonradan değişmedi (`git log -- gorev/G32*`); commit sonrası `G32` geçen yalnız bir docs commit'i (3eb4fca) var, düzeltme turu commit'i yok. Değişen dosya seti görevdeki "Yalnız: ..." listesiyle birebir; yeni bağımlılık, e2e, package.json değişikliği yok; `useMemo` import'u hâlâ kullanılıyor. Aday tarama: G29/G31/G33/G38/G22 de düzeltmesiz ama çok `style={{`/`as unknown as` içerir; G30 `as unknown as` + görev listesi dışı css içerir → temiz örnek olarak uygun görülmedi.
Sınırlamalar: (1) yalnız tsx + css yüzeyi var; e2e ve package.json yüzeyine dokunan düzeltmesiz örnek bulunamadı (G07 e2e, düzeltme turu aldı). (2) Commit mesajında `agy` işareti yok (yazar hepsinde aynı); "agy yazdı" kanıtı yalnız görev hattı bağlamından dolaylı. (3) "Sorunsuz" kanıtı dolaylı (fix-round yokluğu), bağımsız denetim raporu yok. (4) `.voiceCardStreamActive` içinde 2 adet `!important` var (kural adayı değil ama A2'de yanlış pozitif riski); G32 görevi `!important` yasaklamaz.
