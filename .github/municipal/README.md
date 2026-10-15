# Mestský image (Konvertor PDF)

Fork drží zdrojáky čo najbližšie k upstreamu (alam00000/bentopdf). Všetky
úpravy pre mesto robí `prepare.sh` až pri builde, na dočasnej kópii, a nikdy
sa necommitujú. Upstream zmeny sa preto mergujú bez konfliktov a úpravy sa
na ne aplikujú automaticky.

| Skript | Čo robí |
|---|---|
| `sync-upstream.sh` | stiahne upstream, vypíše čo skontrolovať (nové knižnice, binárky vo `vendor/`, nové externé hosty, nové URL parametre), zmerguje do vetvy `sync-upstream-<dátum>` |
| `prepare.sh` | premenuje produkt, pribalí všetky WASM/OCR/font súbory do `public/wasm`, pridá CSP len na vlastnú doménu, zapíše build argumenty |
| `verify.sh` | spustí hotový image a overí CSP na každej odpovedi, pribalené súbory a názov |
| `build-local.sh` | lokálny build z commitnutého HEAD: export, `prepare.sh`, `docker build`, `verify.sh` |
| `verify-engine.sh` | zbuilduje PDF engine (`vendor/bentopdf-pdfium`) zo zdrojákov bez cache a porovná sha256 s vendorovaným tarballom; ~1 h, aj ako workflow **Verify PDF engine** |

## Aktualizácia z upstreamu

```bash
bash .github/municipal/sync-upstream.sh     # report + merge do novej vetvy
npm ci && npm run test:run
bash .github/municipal/build-local.sh       # http://localhost:8080 ako SITE_URL
bash .github/municipal/verify-engine.sh     # len ak sa zmenil vendor/ (report to ukáže)
git push origin sync-upstream-<dátum>       # PR do main
```

Potom v GitHub Actions spustite **Build municipal image**. Vstupy: `site_url`,
`brand_name` (predvolene Konvertor PDF), `ocr_languages` (predvolene
slk,ces,eng). Image: `ghcr.io/<owner>/bentopdf:<verzia>-<číslo behu>`.
Push prebehne iba ak prejde `verify.sh`.

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
