#!/usr/bin/env node
// tokens.json → dist/ (tokens.css, index.js, index.d.ts, fonts.css, fonts.local.css + fonts/, tasarim/).
// Bağımlılıksız; fontsource paketleri yalnız font dosyalarını kopyalamak için okunur.
import { mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PAKET, tokenOku, temaCoz, olcuCoz, duzlestir, coz, cssAd, temalar } from './lib.mjs';

const kok = tokenOku();
const DIST = join(PAKET, 'dist');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const BASLIK = '/* ÜRETİLDİ — elle düzenleme. Kaynak: packages/tokens/tokens.json · `pnpm --filter @chatapp/tokens build` */\n';
const olcu = olcuCoz(kok);
const tema = Object.fromEntries(temalar(kok).map((t) => [t, temaCoz(kok, t)]));
const ham = Object.fromEntries(Object.entries(duzlestir(kok.ham)).map(([k, v]) => [k, coz(v, kok)]));
const VARSAYILAN = 'dark';

// Temalar aynı rol kümesini taşımalı.
const anahtarlar = Object.keys(tema[VARSAYILAN]).sort().join();
for (const t of Object.keys(tema)) {
  if (Object.keys(tema[t]).sort().join() !== anahtarlar) throw new Error(`Tema "${t}" rol kümesi "${VARSAYILAN}" ile aynı değil`);
}

// ---------- tokens.css ----------
const blok = (harita, girinti = '  ') =>
  Object.entries(harita).map(([k, v]) => `${girinti}${cssAd(k)}: ${v};`).join('\n');

const css = `${BASLIK}
/* Ölçüler (temadan bağımsız) */
:root {
${blok(olcu)}
}

/* Varsayılan tema / şablon kipi: ${VARSAYILAN} (Yörünge) */
:root,
[data-template="ada"][data-mode="${VARSAYILAN}"],
[data-theme="${VARSAYILAN}"] {
  color-scheme: dark;
${blok(tema[VARSAYILAN])}
}
${Object.keys(tema)
  .filter((t) => t !== VARSAYILAN && !t.startsWith('render_'))
  .map(
    (t) => `
[data-template="ada"][data-mode="${t}"],
[data-theme="${t}"] {
  color-scheme: ${t === 'light' ? 'light' : 'dark'};
${blok(tema[t])}
}`,
  )
  .join('\n')}

/* Render şablonu (PLAN-B S3, G34) */
[data-template="render"][data-mode="light"],
[data-template="render"][data-theme="light"],
[data-theme="render_light"] {
  color-scheme: light;
${blok(tema.render_light)}
}

[data-template="render"][data-mode="dark"],
[data-template="render"][data-theme="dark"],
[data-template="render"][data-mode="dev"],
[data-theme="render_dark"] {
  color-scheme: dark;
${blok(tema.render_dark)}
}

/* "Sistem" teması (Ayarlar 7.9): işletim sistemi tercihine uyar */
@media (prefers-color-scheme: light) {
  [data-template="ada"][data-mode="system"],
  [data-theme="system"] {
    color-scheme: light;
${blok(tema.light, '    ')}
  }
  [data-template="render"][data-mode="system"] {
    color-scheme: light;
${blok(tema.render_light, '    ')}
  }
}

@media (prefers-color-scheme: dark) {
  [data-template="ada"][data-mode="system"],
  [data-theme="system"] {
    color-scheme: dark;
${blok(tema.dark, '    ')}
  }
  [data-template="render"][data-mode="system"] {
    color-scheme: dark;
${blok(tema.render_dark, '    ')}
  }
}

/* Cam efekti yedeği ve saydamlık azaltma (K52 G27) */
@supports not (backdrop-filter: blur(1px)) {
  [data-template="ada"][data-mode="dark"],
  [data-theme="dark"] {
    ${cssAd('bg.surface')}: #1a1730;
  }
}

@media (prefers-reduced-transparency: reduce) {
  [data-template="ada"][data-mode="dark"],
  [data-theme="dark"] {
    ${cssAd('bg.surface')}: #1a1730;
  }
}

/* Hareket azaltma: tüm süreler sıfır, yalnız renk/opaklık anlık değişir */
@media (prefers-reduced-motion: reduce) {
  :root {
    ${cssAd('motion.duration.fast')}: 0ms;
    ${cssAd('motion.duration.normal')}: 0ms;
  }
}
`;
writeFileSync(join(DIST, 'tokens.css'), css);

// ---------- index.js / index.d.ts ----------
const tumAdlar = [...Object.keys(tema[VARSAYILAN]), ...Object.keys(olcu)];
const cssVar = Object.fromEntries(tumAdlar.map((k) => [k, `var(${cssAd(k)})`]));
const cssDegisken = Object.fromEntries(tumAdlar.map((k) => [k, cssAd(k)]));
const J = (o) => JSON.stringify(o, null, 2);

writeFileSync(
  join(DIST, 'index.js'),
  `${BASLIK}
/** Bileşenlerde KULLANILACAK olan: rol adı → "var(--hk-…)". Ham değer yerine bunu yaz. */
export const cssVar = Object.freeze(${J(cssVar)});

/** Rol adı → CSS değişken adı ("--hk-…"). */
export const cssDegisken = Object.freeze(${J(cssDegisken)});

/** v('bg.surface') → "var(--hk-bg-surface)" */
export function v(ad) {
  const d = cssVar[ad];
  if (!d) throw new Error('Bilinmeyen token: ' + ad);
  return d;
}

export const TEMALAR = Object.freeze(${J(Object.keys(tema))});
export const VARSAYILAN_TEMA = '${VARSAYILAN}';

/** Çözülmüş tema renkleri — yalnız CSS değişkeni kullanılamayan yerde (canvas, grafik, Electron yerel). */
export const tema = Object.freeze(${J(tema)});

/** Çözülmüş ölçüler. */
export const olcu = Object.freeze(${J(olcu)});

/** Ham palet — UI kodunda KULLANMA (lint yakalamaz ama TASARIM.md yasaklar); yalnız yeni rol tasarlarken. */
export const ham = Object.freeze(${J(ham)});
`,
);

const birlesim = (a) => a.map((x) => JSON.stringify(x)).join('\n  | ');
const kayit = (o) => `{\n${Object.keys(o).map((k) => `    readonly ${JSON.stringify(k)}: string;`).join('\n')}\n  }`;
writeFileSync(
  join(DIST, 'index.d.ts'),
  `${BASLIK}
export type TemaAdi = ${birlesim(Object.keys(tema))};
export type RenkRolu =
  | ${birlesim(Object.keys(tema[VARSAYILAN]))};
export type OlcuAdi =
  | ${birlesim(Object.keys(olcu))};
export type TokenAdi = RenkRolu | OlcuAdi;

export declare const cssVar: Readonly<Record<TokenAdi, string>>;
export declare const cssDegisken: Readonly<Record<TokenAdi, string>>;
export declare function v(ad: TokenAdi): string;
export declare const TEMALAR: readonly TemaAdi[];
export declare const VARSAYILAN_TEMA: '${VARSAYILAN}';
export declare const tema: Readonly<Record<TemaAdi, Readonly<Record<RenkRolu, string>>>>;
export declare const olcu: Readonly<Record<OlcuAdi, string>>;
export declare const ham: ${kayit(ham)};
`,
);

// ---------- fonts ----------
const FONTLAR = [
  { paket: '@fontsource-variable/bricolage-grotesque', aile: 'Bricolage Grotesque Variable', dosyaOnEk: 'bricolage-grotesque', agirlik: '200 800', variable: true },
  { paket: '@fontsource-variable/space-grotesk', aile: 'Space Grotesk Variable', dosyaOnEk: 'space-grotesk', agirlik: '300 700', variable: true },
  { paket: '@fontsource-variable/jetbrains-mono', aile: 'JetBrains Mono Variable', dosyaOnEk: 'jetbrains-mono', agirlik: '100 800', variable: true },
  { paket: '@fontsource/ibm-plex-mono', aile: 'IBM Plex Mono', dosyaOnEk: 'ibm-plex-mono', agirliklar: ['400', '600'], variable: false },
];
// Türkçe: ç ö ü (latin) + ı İ ş ğ (latin-ext, U+0100–017F). İkisi de zorunlu.
const ALTKUMELER = {
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext':
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
};

// Paketleyici (Vite/Electron) için: fontsource'u içe aktarır, font dosyaları paketle birlikte gelir (CDN yok).
const fontImports = [
  '@import "@fontsource-variable/bricolage-grotesque/wght.css";',
  '@import "@fontsource-variable/space-grotesk/wght.css";',
  '@import "@fontsource-variable/jetbrains-mono/wght.css";',
  '@import "@fontsource/ibm-plex-mono/400.css";',
  '@import "@fontsource/ibm-plex-mono/600.css";',
];
writeFileSync(
  join(DIST, 'fonts.css'),
  `${BASLIK}${fontImports.join('\n')}\n`,
);

// Paketleyicisiz statik sayfa (design/onizleme.html) için: dosyalar dist/fonts/ altına kopyalanır.
mkdirSync(join(DIST, 'fonts'), { recursive: true });
const yuzler = [];
let eksik = 0;
for (const f of FONTLAR) {
  if (f.variable) {
    for (const [alt, aralik] of Object.entries(ALTKUMELER)) {
      const ad = `${f.dosyaOnEk}-${alt}-wght-normal.woff2`;
      const kaynak = join(PAKET, 'node_modules', f.paket, 'files', ad);
      if (!existsSync(kaynak)) {
        eksik++;
        continue;
      }
      copyFileSync(kaynak, join(DIST, 'fonts', ad));
      yuzler.push(`@font-face {
  font-family: '${f.aile}';
  font-style: normal;
  font-display: swap;
  font-weight: ${f.agirlik};
  src: url(./fonts/${ad}) format('woff2-variations'), url(./fonts/${ad}) format('woff2');
  unicode-range: ${aralik};
}`);
    }
  } else {
    for (const w of f.agirliklar) {
      for (const [alt, aralik] of Object.entries(ALTKUMELER)) {
        const ad = `${f.dosyaOnEk}-${alt}-${w}-normal.woff2`;
        const kaynak = join(PAKET, 'node_modules', f.paket, 'files', ad);
        if (!existsSync(kaynak)) {
          eksik++;
          continue;
        }
        copyFileSync(kaynak, join(DIST, 'fonts', ad));
        yuzler.push(`@font-face {
  font-family: '${f.aile}';
  font-style: normal;
  font-display: swap;
  font-weight: ${w};
  src: url(./fonts/${ad}) format('woff2');
  unicode-range: ${aralik};
}`);
      }
    }
  }
}
writeFileSync(join(DIST, 'fonts.local.css'), `${BASLIK}${yuzler.join('\n\n')}\n`);
if (eksik) console.warn(`! ${eksik} font dosyası yok (pnpm install --ignore-workspace koşulmadı mı?) — fonts.local.css sistem yedeğine düşer`);

// ---------- tasarim kütüphanesi kopyası (DTCG, `tasarim` CLI şeması) ----------
const renk = (v) => ({ $type: 'color', $value: v });
const px = (v) => (v && v.endsWith('rem') ? `${parseFloat(v) * 16}px` : v);
const boyut = (v) => ({ $type: 'dimension', $value: px(v) });
const aile = (s) => ({ $type: 'fontFamily', $value: (s || '').split(',').map((x) => x.trim().replace(/^'|'$/g, '')) });
function tasarimTema(t) {
  const r = tema[t];
  const chatapp = {};
  for (const [k, val] of Object.entries(r)) if (typeof val === 'string' && val.startsWith('#')) chatapp[k.replace(/\./g, '_')] = renk(val);
  return {
    renk: {
      aksan: { 50: renk(r['accent.subtle'] ?? '#fbebe4'), 600: renk(r['accent.base']), 700: renk(r['accent.hover']) },
      zemin: renk(r['bg.content']),
      metin: renk(r['text.primary']),
      metin_ikincil: renk(r['text.secondary']),
      baglanti: renk(r['text.link']),
      chatapp,
    },
    radius: { kontrol: boyut(r['radius.md'] ?? olcu['radius.md']), kart: boyut(r['radius.lg'] ?? olcu['radius.lg']), modal: boyut(olcu['radius.xl']) },
    aralik: Object.fromEntries(['1', '2', '3', '4', '6', '8', '12', '16'].map((k) => [k, boyut(olcu[`space.${k}`])])),
    font: { govde: aile(r['font.family.sans']), baslik: aile(r['font.family.sans']), kod: aile(r['font.family.mono']) },
    tip: {
      kucuk: boyut(olcu['font.size.sm']),
      govde: boyut(olcu['font.size.base']),
      ara_baslik: boyut(olcu['font.size.xl']),
      baslik: boyut(olcu['font.size.2xl']),
    },
    agirlik: {
      normal: { $type: 'fontWeight', $value: 400 },
      orta: { $type: 'fontWeight', $value: 500 },
      kalin: { $type: 'fontWeight', $value: 600 },
    },
    golge: { hafif: { $type: 'shadow', $value: r['shadow.toast'] }, yuksek: { $type: 'shadow', $value: r['shadow.overlay'] } },
    hareket: { hizli: { $type: 'duration', $value: olcu['motion.duration.fast'] }, normal: { $type: 'duration', $value: olcu['motion.duration.normal'] } },
  };
}
mkdirSync(join(DIST, 'tasarim'), { recursive: true });
writeFileSync(join(DIST, 'tasarim', 'tokens.json'), J(tasarimTema('light')) + '\n');
writeFileSync(join(DIST, 'tasarim', 'tokens.koyu.json'), J(tasarimTema('dark')) + '\n');
writeFileSync(join(DIST, 'tasarim', 'tokens.dev.json'), J(tasarimTema('dev')) + '\n');
writeFileSync(join(DIST, 'tasarim', 'render.json'), J(tasarimTema('render_light')) + '\n');
writeFileSync(join(DIST, 'tasarim', 'render.koyu.json'), J(tasarimTema('render_dark')) + '\n');

console.log(`✓ dist/ üretildi: ${Object.keys(tema).length} tema × ${Object.keys(tema[VARSAYILAN]).length} renk rolü, ${Object.keys(olcu).length} ölçü, ${yuzler.length} font yüzü`);
