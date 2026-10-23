# Mestský image (Konvertor PDF)

Fork drží zdrojáky čo najbližšie k upstreamu (alam00000/bentopdf). Všetky
úpravy pre mesto robí `prepare.sh` až pri builde, na dočasnej kópii, a nikdy
sa necommitujú. Upstream zmeny sa preto mergujú bez konfliktov a úpravy sa
na ne aplikujú automaticky.

| Skript | Čo robí |
|---|---|
| `sync-upstream.sh` | stiahne upstream, vypíše čo skontrolovať (nové knižnice, binárky vo `vendor/`, nové externé hosty, nové URL parametre), zmerguje do vetvy `sync-upstream-<dátum>` |
| `prepare.sh` | nahradí názov, pätu a adresu zástupnými textami, pribalí všetky WASM/OCR/font súbory do `public/wasm`, pridá CSP len na vlastnú doménu, v jednoduchom režime nechá na stránkach nástrojov viditeľné časté otázky (FAQ), zapíše build argumenty |
| `runtime-config.sh` | beží pri štarte kontajnera a zapíše `BRAND_NAME`, `FOOTER_TEXT`, `SITE_URL` z env do `/etc/nginx/tmp/municipal.conf`; nginx ich dosadí do odpovedí |
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

Každý push do `main` spustí workflow **Build municipal image**, ktorý image
zbuilduje, overí cez `verify.sh` a až potom pushne ako
`ghcr.io/<owner>/bentopdf:<verzia>-<číslo behu>`, jeden tag pre linux/amd64
aj linux/arm64 (Docker si stiahne správnu variantu sám). Ručne ho spustíte len ak
chcete iné OCR jazyky (vstup `ocr_languages`, predvolene slk,ces,eng).

## Nastavenie pri spustení

Názov, päta ani adresa nie sú v image. Súbory v image majú namiesto nich
zástupné texty. `runtime-config.sh` pri štarte kontajnera zapíše hodnoty z env
do `/etc/nginx/tmp/municipal.conf` a nginx ich dosadí do každej odpovede
(`sub_filter`). Súbory v `/usr/share/nginx/html` sa nemenia:

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

- Hodnotu so znakmi `<` `>` `"` `'` `\` `$` `&` `|` `;` `{` `}`, spätným
  apostrofom alebo novým riadkom kontajner odmietne a nenaštartuje; hodnoty
  idú bez escapovania do HTML, JSON, JS a do konfigurácie nginx.
- Ak stránku otvoríte cez inú adresu než `SITE_URL`, nástroje s WASM/OCR
  nepôjdu (CSP povoľuje len vlastnú adresu).
- Kontajner štartuje hneď, nič sa neprepisuje.
- Zmena env znamená nový kontajner (`docker compose up -d` ho vytvorí sám).
  Návštevník, ktorý už má stránku v cache, uvidí starý názov v časti
  vykresľovanej cez JS, kým mu cache súborov nevyprší; HTML a preklady sa
  obnovia do hodiny.
- Kontajner môže bežať s read-only súborovým systémom. Zapisovať potrebuje
  len do `/etc/nginx/tmp` (v Kubernetes `emptyDir`, v Dockeri
  `--read-only --tmpfs /etc/nginx/tmp:uid=101,gid=101`).

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

## Binárne súbory tretích strán

Do image idú hotové binárky, ktoré sa nedajú prečítať ako zdrojový kód (WASM,
minifikovaný JS, fonty). `binaries.sha256` obsahuje SHA-256 každej z nich:
čo pribalí `prepare.sh` (PyMuPDF, Ghostscript, CoherentPDF, Tesseract, OCR
dáta, fonty) aj čo upstream commituje (LibreOffice, qpdf, CoherentPDF,
prehliadače pdf.js, `vendor/`). Ak sa ktorýkoľvek súbor zmení alebo pribudne
nový, build sa zastaví. Po kontrole pôvodu nových súborov:

```bash
UPDATE_BINARIES=1 bash .github/municipal/build-local.sh   # prepíše zoznam
git diff .github/municipal/binaries.sha256                 # skontrolovať, commitnúť
```

Pôvod súborov v zozname bol overený 23. 10. 2026:

| Súbor | Overenie |
|---|---|
| `vendor/bentopdf-pdfium` | `verify-engine.sh` ho zostaví zo zdroja a porovná bit po bite |
| `vendor/hyper-compress-wasm` | zhodný s npm 1.0.3, podpísaná proveniencia (GitHub Actions, alam00000/bentopdf-hyper-compress) |
| `public/libreoffice-wasm` | zhodný s npm `@matbee/libreoffice-converter` 2.3.1, podpísaná proveniencia |
| `public/qpdf.wasm` | zhodný s npm `@neslinesli93/qpdf-wasm` 0.3.0 |
| `public/coherentpdf.browser.min.js` | npm `coherentpdf` 2.5.5 + hlavička s licenciou |
| `public/pdfjs-viewer`, `public/pdfjs-annotation-viewer` | jadro a worker zhodné s vydaniami Mozilla pdf.js 5.4.296 a 4.3.136; úpravy upstreamu v prehliadači sú čitateľný kód (písma podpisu, bez predvoleného súboru) |
| PyMuPDF (`@bentopdf/pymupdf-wasm` 0.11.16) | podpísaná proveniencia (GitHub Actions) |
| Ghostscript, Tesseract, CoherentPDF z npm | pevná verzia, podpis registra npm, bez proveniencie |
| `vendor/bentopdf-viewer`, `pdfjs-annotation-extension.js` | bez nezávislého overenia (zostavuje upstream) |

Základné image sú pripnuté cez digest (`NODE_IMAGE`, `NGINX_IMAGE` v
`prepare.sh`); nový digest zistí `docker buildx imagetools inspect <image>`.
Akcie v `build-sk.yml` sú pripnuté cez SHA commitu. Pred pushom image
`build-sk.yml` spustí Trivy a zastaví sa pri HIGH/CRITICAL zraniteľnosti,
ktorá má opravu; image dostane podpísanú provenienciu a SBOM.
