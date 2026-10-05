# DGITA-kandidaten før kommunal miljøtest

Målet er en vedligeholdelig og tilgængelig produktionskandidat med reproducerbart afprøvet sagsforløb, adgangsgrænser, dataminimering og gendannelse. Den eksisterende testpilot bevares. Frigivelse kræver efterfølgende miljøaccept; en lokal test kan ikke tildele denne accept.

## Leveret teknisk grundlag

| Pakke | Implementering og lokal prøve | Resterende accept |
| --- | --- | --- |
| K01 | Fuldt Next-forløb med lokale HTTP-providers, direkte og multipart-upload, scannerfejl, versionslås, beslutning, kvittering og mail. Worker-forløb separat. | Rigtig cloud/private storage, browser-CORS, Entra og Graph i valgt miljø. |
| K02 | Fælles scheduler/oprydning, maskinprincipal, betingede claims, uklar levering til afstemning, tilbagekaldelse og karantæne. | Cadence, kapacitet og mailservicemål. Vercels daglige cron er bevaret og er ikke godkendt som responsiv service. |
| K03 | Afgrænset esbuild-rettelse og Drizzle-/migrationsprøver. | Urettet braces-gæld i udviklings-/deployværktøjer; eksisterende frist 4. november 2026 og ejerbeslutning. |
| K04 | Uploadrepository og pilotseed opdelt; importgraf/kompleksitet i CI; schema-paritet og read-only legacykontrol. | Løbende review af målte komplekse funktioner. Subset-coverage må ikke udlægges som fuld coverage. |
| K05 | Formularlabels, fejl/fokus, tastatur og automatiske Chromium/axe-forløb, inklusive 320 CSS-pixels og alle ti trin. | Faktisk browserzoom og manuel skærmlæser med repræsentative brugere. |
| K06 | Autoriseret versionsbundet HTML-kvittering og særskilt tagged-PDF-prototype; gemte PDF-bytes bevares. | Faglig dokumentaccept og PDF/UA-/skærmlæserprøve; prototypen er ikke en produktions-PDF-konvertering. |
| K07 | Syntetiske nye fixtures, bevaret gammel pilotidentitet, felt-/datainventar og faste logfelter. | Nødvendighed, hjemmel, information, DPIA og accept af platformlogs/mailkopier. |
| K08 | Bounded sessioner, tilbagekaldelse, passiv polling uden idleforlængelse, atomisk lederrevocation og én beslutning pr. version. Retention giver kun reviewforslag. | IAM-/timeoutvalg, lederidentitet, bevaring og autoritative hold-/arkivkilder. |
| K09 | Online DB-backup, fil-/version-/tenantintegritet, afbrudt-kopi-/korruptionsprøver og obligatorisk restorekarantæne. | Cloudbackup, adskilt backuplager, reelt RPO/RTO, artifact-rollback og genåbning af drift. |
| K10 | Vedvarende heartbeat, tenantafgrænset adminstatus, scannertelemetri, lokal HTTP-alarm og syntetisk belastnings-/fejlprøve. | Uafhængig monitor, rigtig modtager/vagt og servicemål. Backupstatus er fortsat ukendt. |
| K11 | Kontrolregister med risiko, kode, test, foreslået ejer og restopgave. Redigeret evidens på ren eksakt SHA. | Udpegede risikoejere, gennemført proces/øvelse og organisatorisk accept. |
| K12 | 18 konkrete miljøscenarier og evidensskabelon klar. | Faktisk kommunal miljøafprøvning og menneskelig frigivelsesbeslutning. Alle felter står U. |

## Reproducerbar kontrol

Brug den låste Node 24-version og `npm ci`. Kør fra et rent checkout; runtimeprøver afviser uren eller ændret kilde:

```sh
npm run lint
npm run typecheck
node scripts/code-health.mjs --check
npm test
npm run build:next
npm run test:ci:next-e2e
npm run test:ci:production
npm run test:ci:e2e
PLAYWRIGHT_BROWSERS_PATH=node_modules/.cache/ms-playwright npx playwright install chromium
npm run test:ci:a11y
node scripts/ci-audit.mjs
node scripts/release-evidence.mjs
```

Next-build og efterfølgende prøver skal anvende samme SHA. Runtimebeviset indeholder run-id, kildeidentitet og start-/slutkontrol; det attesterer ikke på egen hånd et tidligere builds oprindelse. Kørselstid/tællere i `work/` er konkrete lokale målinger, ikke servicegarantier. De automatiske CI-gates afprøver begge builds, browser, audit, secrets, workflows og CodeQL på PR-kandidaten.

## Næste miljøtrin

Følg [miljøacceptpakken](municipal-acceptance.md). Den eksisterende Vercel-pilot havde ingen særskilt previewkonfiguration ved kontrollen; separate testressourcer og en entydig previewvej er nødvendige. Det eksisterende releaseworkflow bruger production-target, også når miljøvalget hedder pilot. Ingen ny deployment eller ændring af den gamle pilot er udført i kandidatpakken.

[Kontrolregisteret](governance/control-register.json), [gendannelsesøvelsen](recovery-exercise.md), [driftsmålingerne](operations-observability.md) og [tilgængelighedsprøverne](accessibility-testing.md) beskriver omfang og begrænsninger. Historisk score og betinget teknisk mål ændres ikke automatisk. ISO/ISMS, NIS2 og databeskyttelse kræver konkrete organisatoriske beslutninger og afprøvede processer.
