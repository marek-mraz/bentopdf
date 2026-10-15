# Mestský image (Konvertor PDF)

Fork drží zdrojáky čo najbližšie k upstreamu (alam00000/bentopdf). Všetky
úpravy pre mesto robí `prepare.sh` až pri builde, na dočasnej kópii, a nikdy
sa necommitujú. Upstream zmeny sa preto mergujú bez konfliktov a úpravy sa
na ne aplikujú automaticky.

| Skript | Čo robí |
|---|---|
| `sync-upstream.sh` | stiahne upstream, vypíše čo skontrolovať (nové knižnice, binárky vo `vendor/`, nové externé hosty, nové URL parametre), zmerguje do vetvy `sync-upstream-<dátum>` |
| `prepare.sh` | nahradí názov, pätu a adresu zástupnými textami, pribalí všetky WASM/OCR/font súbory do `public/wasm`, pridá CSP len na vlastnú doménu, zapíše build argumenty |
| `runtime-config.sh` | beží pri štarte kontajnera a doplní `BRAND_NAME`, `FOOTER_TEXT`, `SITE_URL` z env |
| `verify.sh` | spustí hotový image s vlastným názvom a overí CSP na každej odpovedi, pribalené súbory, názov a že nezostal žiadny zástupný text |
| `build-local.sh` | lokálny build z commitnutého HEAD: export, `prepare.sh`, `docker build`, `verify.sh` |
| `verify-engine.sh` | zbuilduje PDF engine (`vendor/bentopdf-pdfium`) zo zdrojákov bez cache a porovná sha256 s vendorovaným tarballom; ~1 h, aj ako workflow **Verify PDF engine** |

## Aktualizácia z upstreamu

```bash
bash .github/municipal/sync-upstream.sh     # report + merge do novej vetvy
npm ci && npm run test:run
bash .github/municipal/build-local.sh       # image konvertor-pdf:local
bash .github/municipal/verify-engine.sh     # len ak sa zmenil vendor/ (report to ukáže)
git push origin sync-upstream-<dátum>       # PR do main
```

Potom v GitHub Actions spustite **Build municipal image**. Jediný vstup je
`ocr_languages` (predvolene slk,ces,eng). Image:
`ghcr.io/<owner>/bentopdf:<verzia>-<číslo behu>`. Push prebehne iba ak prejde
`verify.sh`.

## Nastavenie pri spustení

Názov, päta ani adresa nie sú v image. Doplní ich `runtime-config.sh` pri
štarte kontajnera z env:

| Premenná | Predvolene | Význam |
|---|---|---|
| `SITE_URL` | `http://localhost:8080` | adresa, na ktorej ľudia stránku otvárajú, bez cesty (`https://pdf.mesto.sk`); prehliadač z nej načítava WASM a OCR súbory |
| `BRAND_NAME` | `Konvertor PDF` | názov v hlavičke, titulkoch a textoch |
| `FOOTER_TEXT` | odkaz na zdrojový kód tohto forku | text päty; licencia AGPL-3.0 vyžaduje, aby používateľom ukazoval cestu k zdrojovému kódu |
| `ROBOTS_NOINDEX` | `false` | `true` zakáže indexovanie vyhľadávačmi (upstream) |

```bash
docker run -d -p 8080:8080 \
  -e SITE_URL=https://pdf.mesto.sk \
  -e BRAND_NAME="Konvertor PDF" \
  ghcr.io/marek-mraz/bentopdf:<tag>
```

- Hodnotu so znakmi `<` `>` `"` `'` `\` `$` `&` `|`, spätným apostrofom
  alebo novým riadkom kontajner odmietne a nenaštartuje; hodnoty idú bez
  escapovania do HTML, JSON a JS.
- Ak stránku otvoríte cez inú adresu než `SITE_URL`, nástroje s WASM/OCR
  nepôjdu (CSP povoľuje len vlastnú adresu).
- Nový kontajner pri prvom štarte prepisuje ~3100 súborov, nginx odpovie
  asi po 20 s. Reštart toho istého kontajnera je okamžitý.
- Zmena env znamená nový kontajner (`docker compose up -d` ho vytvorí sám).
  Návštevník, ktorý už má stránku v cache, uvidí starý názov v časti
  vykresľovanej cez JS, kým mu cache súborov nevyprší; HTML a preklady sa
  obnovia do hodiny.
- Kontajner s `--read-only` nepôjde: skript prepisuje súbory vo
  `/usr/share/nginx/html`.

## Bez externých zdrojov

Prehliadač nesťahuje kód ani fonty z CDN: PyMuPDF, Ghostscript, CoherentPDF,
Tesseract (+ jazyky), OCR a editor fonty sú v image pod `/wasm/`. Druhá
hlavička `Content-Security-Policy` povoľuje len `'self'`; prehliadač vynúti
obe politiky naraz, takže ani prípadná nová CDN adresa z upstreamu sa
nenačíta. `verify.sh` build zastaví, ak táto hlavička chýba.

Licencie: BentoPDF, PyMuPDF, Ghostscript, CoherentPDF sú AGPL-3.0, Tesseract
Apache-2.0, fonty OFL-1.1. Pri AGPL nasadení je pribalenie v poriadku;
zdrojový kód je verejný a odkazuje naň päta stránky. Licencie pribalených
balíkov sú v image pod `/wasm/licenses/`.
