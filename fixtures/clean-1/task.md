# G01 · ErrorCode genişletilebilir enum (K44)

## Amaç
OpenAPI'de `ErrorCode` şemasına `x-extensible-enum` işareti gelsin; böylece ileride yeni hata kodu eklemek oasdiff'te kırıcı sayılmasın.

## Önce oku
- AGENTS.md
- contracts/src/common.tsp (ErrorCode)
- contracts/scripts/postprocess.mjs (OpenAPI'ye uzantı ekleme deseni burada var)

## Dosyalar
Değiştir: contracts/scripts/postprocess.mjs
Üretilecek (yalnız `pnpm gen` ile): contracts/out/openapi.yaml ve gen'in değiştirdiği üretilmiş dosyalar
Başka hiçbir dosyaya dokunma.

## Yapılacaklar
1. postprocess.mjs'e küçük bir adım ekle: `components.schemas.ErrorCode` varsa ona `x-extensible-enum: true` yaz. Enum listesini (`enum:`) SİLME ya da değiştirme. Başka şemaya dokunma. Mevcut yorum üslubuyla 1–2 satır "neden" yorumu ekle.
2. `pnpm gen` koş.
3. Üretilmiş Go/TS dosyalarında anlamlı değişiklik olmamalı (yalnız openapi.yaml'da yeni satır beklenir). Değişiklik olursa ŞÜPHE'ye yaz.

## Kabul ölçütü
- [ ] `grep -n "x-extensible-enum" contracts/out/openapi.yaml` → ErrorCode altında tek satır
- [ ] `pnpm gen` ikinci kez koşunca `git status` yeni değişiklik göstermiyor (kararlı)
- [ ] oasdiff breaking komutu (AGENTS.md) ERR vermiyor
- [ ] `cd services/chatapp && go build ./...` hatasız

## Yasak
- `common.tsp`'de enum üyelerini değiştirmek, TypeSpec decorator denemeleri ile sözleşme yapısını değiştirmek
- Bağımlılık eklemek
