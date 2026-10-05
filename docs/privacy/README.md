# Dataminimering og feltfortegnelse

[Datafortegnelsen](data-inventory.json) knytter hvert formularfelt og hver deklareret DB-kolonne til formål, dataflow og opbevarings-/acceptstatus. Den er et teknisk beslutningsgrundlag. `U` betyder ukendt eller ikke dokumenteret accepteret; det betyder ikke, at kommunen mangler en proces.

Fortegnelsen skelner mellem direkte identitet, personhenførbare metadata, fri tekst/dokumenter, private filreferencer og token-/hashdata. Et hash eller sags-id er ikke automatisk anonymt. Skjul/beskyt derfor også pseudonyme identifikatorer. Frie tekstfelter, bilagsnavne, URL-er, kommentarer og dokumenter kan indeholde persondata, selv når formularen handler om et IT-system.

`tests/privacy-inventory.test.mjs` sammenligner den statiske fortegnelse med formularens faktiske topniveaufelter og Drizzle-schemaets kolonner. Et nyt felt/en ny kolonne kræver en eksplicit opdatering. Nested JSON-strukturer er beskrevet, men testen er ikke en fuld analyse af alle eventbestemte payloads. Migrations-/runtimeparitet skal kontrolleres særskilt af schema-testen. Felternes nødvendighed, behandlingshjemmel, DPIA-screening og journal-/slettepolitik afgøres af kommunen; der er ingen automatisk sletning i denne ændring.

## Implementerede begrænsninger

- Nye testdatabaser og formularfixtures bruger neutrale identiteter og `example.invalid`; historiske pilotdata bevares. Se [testdataprofilen](test-data.md).
- Den eksisterende formularvalidering afviser ukendte inputfelter. Offentlige snapshotprojektioner kopierer kun kendte formular-/katalog-/bilagsfelter. Canarytesten verificerer, at injicerede interne oplysninger ikke følger med ud i denne browserpayload.
- `features/privacy/operational-log.ts` er en typed og runtimevalideret tilladelsesliste for almindelige driftslogs. Ukendte fejlobjekter, getters, fritekst og ekstra felter kopieres ikke. Auth-fejlhåndteringen anvender denne logger. Schedulerens events har en kontrakt med afgrænsede tællere/varighed/køalder og booleske flags; integration af jobs kontrolleres separat.
- Loggeren opretter selv hændelses-id og tid. Bruger-, kommune- og sags-id'er er ikke med i dens tilladte payload. Den beskyttede `portal_audit_events` er et særskilt, personhenførbart revisionsspor; den videresendes ikke til almindelige logs af denne logger.
- UI-valget NSIS/NIS2/GDPR beskrives som sikkerheds-/regelramme. Den historiske nøgle `legalBasis` bevarer sin wiresemantik og er ikke evidens for konkret GDPR-hjemmel.

## Restopgaver og ansvar

Systemejer/dataansvarlig skal beslutte nødvendige felter og information til brugerne, formål, behandlingsgrundlag, modtagere og bevaring. DPO rådgiver om DPIA-screening og databeskyttelse. Journal-/arkivansvarlig afklarer autoritativ journal, legal hold og kassation; drift afklarer backuper og kopier hos mail-/scanner-/storageleverandører.

Almindelige applikationslogs, autoriserede auditspor, mail/PDF og platformlogs har forskellige formål og adgangsbehov. Canarytests på én kodevej beviser ikke, at Vercel/Cloudflare, proxy, browserconsole, netværkscapture eller APM redigerer headers, query og dokumentindhold korrekt. Før reel miljøaccept skal disse sinks afprøves med syntetiske canaries i det valgte miljø, og adgang/retention skal dokumenteres. Der er ikke foretaget en automatisk fjernelse af forretningsfelter eller ændring af mailens forretningsflow uden en vedtaget politik.
