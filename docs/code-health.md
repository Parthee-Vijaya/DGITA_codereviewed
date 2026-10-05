# Kodehelbred og første opdeling

Kør med Node 24 efter `npm ci`:

```sh
node scripts/code-health.mjs --check
```

Rapporten bruger TypeScript-parseren til at måle funktionernes beslutningspunkter: `if`, løkker, `case`, `catch`, ternære udtryk og korte logiske udtryk. Grundværdien er 1, og indlejrede funktioner tælles selvstændigt. Målingen er en reproducerbar prioriteringshjælp; den beviser ikke korrekthed. Linjetal er kun beskrivende.

Runtime-importgrafen omfatter statiske imports/exports og dynamiske imports med literal sti; deklarationer, der udelukkende er type-imports, udelades. Ikke-literal dynamik kan ikke udledes af denne statiske kontrol. Provideroversigten følger direkte imports af libSQL, Vercel Blob og Cloudflare-bindings. Den er ikke en fuldstændig transitive browserbundle-analyse.

## Baseline den 5. oktober 2026

På `81898be` fandtes 115 kildefiler og ingen runtime-importcykler. De største målte funktioner var `ApplicationFormView` (96), `PortalClient` (38), `decideLeaderApproval` (36) og `productionConfigurationIssues` (35). Tal for UI inkluderer betinget rendering. De må derfor ikke sammenlignes ukritisk med SQL-/sikkerhedsfunktioner.

`.github/code-health-policy.json` fastholder nul nye cykler, de eksisterende providergrænser samt baselineværdier for 13 navngivne kritiske funktioner. Der er intet globalt krav om maksimal filstørrelse eller testprocent. En legitim ny beslutningsgren eller flyttet adapter kræver en konkret, reviewet policyændring med testcase; en højere grænse må ikke bruges til at skjule en regression. Funktionsomdøbning kræver tilsvarende opdateret identitet i politikken.

## Uploadforløbet

`server-repository.ts` eksporterer fortsat samme offentlige funktioner. Uploadoprettelse, kvoter, verifikationsleases, færdiggørelse, kassation og oprydning ligger nu i `upload-repository.ts`. Fælles DB-/ejerkontrol ligger i `repository-support.ts`, så modulerne kan genbruge adgangsgrænser uden en importcyklus.

Udtrækket reducerede hovedmodulet fra 1698 til 903 linjer; uploadmodulet har 735 og de fælles funktioner 88. Alle 32 navngivne funktionskroppe blev sammenlignet direkte med Git-baselinen og var byte-identiske efter flytningen. SQL, CAS-betingelser, kvoter, leases, audit og fejlmeddelelser blev bevaret. Ingen funktions kompleksitet er reduceret alene ved flytningen.

Den afgrænsede regressionstest bestod 47 test, herunder upload-/leasescenarier og enterprise-persistence. Den følgende V8-måling omfatter kun denne testgruppe, og er **ikke** den samlede testdækning eller en godkendelse af de udækkede grene:

| Modul | Linjer dækket | Grene dækket |
|---|---:|---:|
| Uploadrepository |88,57%|59,57%|
| Sagsrepository |72,90%|57,58%|
| Fælles repositoryfunktioner |84,09%|76,47%|

```sh
node --import tsx --experimental-test-coverage \
  --test-coverage-include='**/features/application/upload-repository.ts' \
  --test-coverage-include='**/features/application/server-repository.ts' \
  --test-coverage-include='**/features/application/repository-support.ts' \
  --test features/application/*.test.mjs \
  tests/enterprise-persistence.test.mjs tests/enterprise-regressions.test.mjs
```

Næste testprioriteter vælges ud fra sikkerhedsgrene og fuldt API-forløb: tabte providersvar, samtidig indsendelse/cleanup, tenantgrænser og versionsskift. Yderligere opdeling af formular/state og pilotseed kan derefter vurderes med samme målemetode. En anden menneskelig reviewer er fortsat et udestående før kommunal frigivelse.
