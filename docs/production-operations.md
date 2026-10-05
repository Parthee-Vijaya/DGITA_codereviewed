# Drift, identitet og produktionsaccept

Denne vejledning beskriver koden pr. 5. oktober 2026 og arbejdet før rigtig kommunal drift. Entra-flow, sikkerhedskontroller, migrationsrunner og frigivelsesflow er implementeret lokalt. Kommunens identitetsudbyder, datalagre, scanner, mailadgang og gendannelsesprocedure er endnu ikke live-accepteret. Se også [CI/CD og frigivelse](ci-cd.md) og [miljøskabelonen](../.env.example).

## Miljøer og ansvar

| Område | Pilot | Produktion | Ansvar/evidens |
| --- | --- | --- | --- |
| Data | Kun syntetiske sager og dokumenter | Godkendte formål og datakategorier | Systemejer godkender anvendelse med relevante fagansvarlige |
| Runtime | `DGITA_ENVIRONMENT=pilot` | `DGITA_ENVIRONMENT=production` | Drift verificerer runtimeværdier, ikke kun buildværdier |
| Testadgang | `DGITA_ENABLE_DEV_LOGIN=true`; beskyttet testkode | `DGITA_ENABLE_DEV_LOGIN=false`, `DGITA_ENABLE_DEMO_SEED=false` | Testroller bevares i piloten; negativ test i produktion |
| Infrastruktur | Eget Vercel-projekt, Turso-DB og privat Blob-lager | Nyt, særskilt projekt, DB og privat Blob-lager | Drift dokumenterer ressource-id, ejer, region, adgang og aftaler |
| Identitet | Testlogin og eventuelt separat Entra-app med testkonti | Kommunal Entra-app og provisionerede DB-roller | IAM og systemejer godkender tildelinger og livscyklus |
| Mail | Blokeret uden præcis modtagerliste | Godkendt afsender og modtagerpolitik | Exchange-/mailansvarlig tester begrænset adgang |
| Secrets | Egne værdier | Egne værdier og rotationsplan | Secretlager, mindst mulige adgange, navngiven ejer |

`portal_environment` mærker databasen som `test` eller `production`. Lokal og pilot deler kategorien `test`; brug stadig adskilte databaser, når de er forskellige driftsmiljøer. En database mærket `test` afvises af produktion, og eksisterende `identity_provider='dev'` afvises i en produktionsdatabase. Markøren må ikke ommærkes for at genbruge pilotdata. Den kontrollerer hverken Blob-lagerets identitet eller geografisk placering; adskillelsen skal verificeres i platformopsætningen.

Angiv altid miljøet eksplicit. Kompatibilitetsreglen bevarer eksisterende testlogin, når det er eksplicit slået til uden miljøangivelse; brug den ikke til produktionsopsætning. Demo-seed skal være eksplicit aktiveret gennem seed-/testloginflag og må aldrig anvendes i produktion. Native Next bruger `.env.local`; lokal Cloudflare/Vinext kan bruge `.dev.vars`. Kopiér ikke disse filer, hentede Vercel-miljøfiler eller databaseeksporter til Git/Actions-artifacts.

De arvede testfixtures indeholder navngivne personaer og kommunale mailadresser. Syntetiske sagsforløb er derfor ikke dokumentation for anonymiserede eller persondatafri testidentiteter. Gennemgå og neutralisér navne/adresser før offentlig pilot efter pilotejerens beslutning, og bevar den præcise mail-allowlist som særskilt afsendelseskontrol.

## Entra-login og provisionering

IAM opretter en fortrolig **Web**-app i én konkret workforce-tenant. Registrér præcis `${DGITA_APP_ORIGIN}/api/auth/entra/callback`. Produktionens origin er HTTPS uden sti, query eller fragment. En anden deploymentadresse er ikke en gyldig callbackadresse. Appen bruger authorization code med PKCE S256, `openid profile email`, nonce og krypteret kortlivet state-cookie; der bruges ikke implicit flow, refresh token eller Graph-adgang til login. [Microsofts redirectvejledning](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri) og [authorization code-flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

Sæt serverværdierne `DGITA_ENTRA_TENANT_ID`, `DGITA_ENTRA_CLIENT_ID`, `DGITA_ENTRA_CLIENT_SECRET`, `DGITA_ENTRA_PORTAL_TENANT_ID`, `DGITA_ENTRA_REDIRECT_URI` og `DGITA_OIDC_STATE_SECRET`. Tenant/client skal være GUID'er. Valgfri `DGITA_ENTRA_ISSUER` skal være præcis `https://login.microsoftonline.com/<tenant-guid>/v2.0`. `common`/`organizations` accepteres ikke. State-secret skal have mindst 32 tegn med høj entropi og være adskilt fra øvrige secrets. `.env.example` aktiverer ingen rigtig identitetsudbyder.

Entra identificerer personen; **administratorprovisionerede DB-roller er autoritative**. Tokenclaims som email, domæne, groups og roles opretter ingen brugere og giver ingen portalrettigheder. En enkelt konfigureret Entra-tenant knyttes til en enkelt allerede oprettet portaltenant. Kommunegrænsen kontrolleres ved login og senere sessionsopslag.

En godkendt onboardingbestilling skal angive portaltenant, verificeret Entra-user-object-id (`oid`), rolle, godkender og reviewdato. Bind værdier fra bestillingen i en kontrolleret databaseprocedure; indsæt aldrig personoplysninger eller credentials i versionsstyrede SQL-filer. Dette er skabeloner med bindparametre:

```sql
INSERT INTO portal_tenants (id, slug, name, status)
VALUES (?, ?, ?, 'active');

INSERT INTO portal_users
  (id, tenant_id, identity_provider, external_subject, email, display_name, status)
VALUES (?, ?, 'entra', ?, ?, ?, 'active');

INSERT INTO portal_user_roles (id, tenant_id, user_id, role, created_by_user_id)
VALUES (?, ?, ?, ?, ?);
```

Opret kun tenant, hvis den ikke findes. `external_subject` er lowercase `<tenant-guid>:<user-object-guid>`; brug personens object-id i den konfigurerede tenant, aldrig appens/serviceprincipalens object-id. Rollens `tenant_id` skal matche brugeren. Portalrollerne er `user`, `dgita_consultant` og `admin`; brugergrænsefladen kalder konsulentrollen `consultant`. Første admin oprettes gennem en godkendt bootstrapprocedure, hvor eventuelt manglende `created_by_user_id` dokumenteres uden at fabrikere en eksisterende administrator. Gem bestilling og ændringsspor i kommunens adgangsadministration.

`approver` er en særskilt godkenderrolle. Den giver ikke i sig selv almindeligt portal-login; en leder, der skal logge ind, skal også have en portalrolle. Ansøgeren eller samme personlige mailadresse må ikke vælges som godkender. Et udsendt godkendelseslink er fortsat en tidsbegrænset bearer-adgang; det kræver ikke Entra-login hos modtageren. Kommunen skal acceptere denne godkendelsesform og PDF-afsendelse eller kræve et senere flow med autentificeret godkender. Entra-login til portalen ændrer ikke dette forhold.

Test før accept: korrekt bruger/kommune får forventet rolle; ukendt bruger, anden tenant, inaktiv bruger/tenant og manglende rolle afvises. Test også fjernet rolle på eksisterende session, udløbet login, genbrug af callback og testlogin afvist i produktion. IAM skal konfigurere og afprøve Conditional Access/MFA, apptildeling og kontrolleret testkonto. Koden fortolker ikke ID-tokenet som dokumentation for MFA. [Microsofts dokumentation for stabile `tid`/`oid`-claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference).

Sessioner har 12 timers levetid; DB-bruger/tenant/roller kontrolleres igen ved requests. Der er ingen SCIM-/Graph-synkronisering eller back-channel logout. Ved afgang skal IAM/systemejer derfor deaktivere DB-brugeren/fjerne roller og tilbagekalde sessioner i driftsproceduren; en ændring alene i Entra afslutter ikke automatisk en eksisterende portalsession. Profilnavn/mail opdateres heller ikke automatisk fra tokenet.

## Database og migration

`scripts/migrate.mjs` anvender journalen `drizzle/meta/_journal.json`. Hver migration kører i egen skrivetransaktion; ID, SHA-256 og tidspunkt gemmes i `__dgita_migrations`. Ændret checksum for en anvendt migration stopper kørslen. Et fejlende trin rulles tilbage; tidligere gennemførte trin i samme kørsel forbliver anvendt. Historiske SQL-filer skal være uforanderlige. Efter migration kontrolleres `integrity_check` og `foreign_key_check`.

Ved en ny migration genererer udvikleren `db/migration-manifest.json` med `node scripts/migration-manifest.mjs` og reviewer/committer SQL, journal og manifest samlet. Produktion sammenligner ledgerens ID'er og checksums med det indbyggede manifest; manglende, ændrede eller ekstra trin afvises. Manifestgeneratoren migrerer ingen database og skal ikke køres for at maskere en driftfejl.

**Frisk database:** Bekræft ressource-id og miljø i driftsreview. Indlæs kun målmiljøets `TURSO_DATABASE_URL` og `TURSO_AUTH_TOKEN` fra secretlageret, og kør fra den godkendte release:

```sh
node scripts/migrate.mjs
node scripts/check-production-config.mjs
```

Den første kommando ændrer mål-DB; den anden kontrollerer konfigurationens struktur og opretter ikke eksterne ressourcer. Node skal opfylde repositoryets `engines`. Gentag migrationskørslen mod en isoleret kopi og forvent nul nye trin. Verificér journal/checksums, triggers, indeks og constraints; provisionér derefter tenant og brugere. Produktion opretter ikke tabeller automatisk i en request. Test/pilot kan fortsat initialisere schema ved opstart.

**Eksisterende pilot uden migrationsledger:** Kør ikke alle migrationer blindt. En pilot kan være initialiseret af runtime-DDL uden `__dgita_migrations`; første `CREATE TABLE` vil da kollidere. Runneren har ingen automatisk baseline eller import af en anden værktøjskædes ledger. Bevar den nuværende pilot og testadgang, og tag en konsistent kopi af DB og private filer. På kopien skal databaseansvarlig sammenligne `sqlite_master`, kolonner, indeks, fremmednøgler og triggers med hver migrations forventede sluttilstand. Udarbejd en reviewet, miljøspecifik reconciliation/baseline, afprøv den på kopien, og registrér kun checksum for et trin, hvis dets faktiske tilstand er dokumenteret. Manglende objekter oprettes ved en eksplicit godkendt ændring; markér dem aldrig som anvendt uden evidens. Denne baselineprocedure er endnu ikke automatiseret eller kørt på en rigtig pilot.

Hvis bevaring af syntetiske pilotsager ikke er nødvendig, kan en ny separat pilot bygges fra frisk schema efter pilotejerens beslutning, mens den gamle bevares frem til accept. Produktion starter i alle tilfælde fra egen database; ingen genbrug af pilotens markør eller testidentiteter. Cloudflare/D1-migration og Vercel/Turso-ledger er forskellige driftsveje; denne runner retter sig mod Turso/libSQL.

## Dokumentkontrol og filstorage

Produktion frigiver kun bilag med `scan_status='clean'`. Det gælder upload, versionsindsendelse og autoriseret download, også via godkendelseslinks. Multipart scannes før lagring. Direkte Blob-upload kontrolleres under en lease: byteantal, type, checksum og scannerresultat skal stemme, før status bliver `ready`. Ved malwarefund/fejl anvendes en holdbar sletteclaim. Rettelsesversioner scannes igen ved kopiering. Pilot uden scanner får `not_configured`, aldrig et påstået rent resultat.

| Scannerkontrakt | Krav |
| --- | --- |
| Konfiguration | `DGITA_MALWARE_SCAN_URL` HTTPS uden credentials/query/fragment; token mindst 32 tegn; timeout 100–30.000 ms, standard 10.000 |
| Request | POST dokumentbytes som `application/octet-stream`; `Authorization: Bearer …`; `X-Content-SHA256` af de faktiske bytes; redirects afvises |
| Størrelse | Maksimal upload følger `MAX_UPLOAD_BYTES`; aktuelt 25 MiB |
| Response | JSON `{"verdict":"clean","sha256":"<64 lowercase hex>"}` eller `infected`; samme digest som request; højst 8.192 bytes |
| Fejl | Ukendt resultat, forkert digest, timeout, transportfejl og manglende konfiguration frigiver ikke produktionsbilaget |
| Ejerskab | Kommunal sikkerhed/drift godkender tjeneste, databehandling, region, retention, signaturopdatering, overvågning og incidentvej |

Tjenesten modtager hele dokumentindholdet. Repositoryet indeholder en adapter og kontrakt, ingen deployet malwaremotor eller dokumenteret detektionsrate. Accept kræver en rigtig tjeneste med aftalte fil-/arkivformater, håndtering af krypterede filer og kontrollerede positive/negative testfiler. En hashbundet `clean`-respons dokumenterer tjenestens svar, ikke i sig selv at motoren er korrekt eller opdateret.

Drift skal afprøve privat Blob-adgang, uploadkvoter, store filer, downloadintegritet, lease-udløb og oprydning efter tabt forbindelse. Separate `BLOB_STORE_ID`/credentials og lagerrettigheder verificeres eksternt; DB-markøren beskytter ikke mod et fejlkonfigureret fælles fillager.

## Mail, secrets og tokenlivscyklus

Mail bruger en særskilt serverapp med `DGITA_GRAPH_*` og en navngiven afsenderpostkasse. Exchange-administratoren skal begrænse adgang til den aftalte postkasse og teste afvisning fra en anden. Microsoft beskriver Application RBAC som den aktuelle model; den lægges sammen med andre Entra-grants, så en samtidig bred tilladelse kan ophæve den tilsigtede begrænsning. [Exchange Application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).

Lokal/pilot blokerer levering uden `DGITA_MAIL_ALLOWED_RECIPIENTS`. Listen accepterer højst 100 præcise adresser og ingen wildcards; to/cc/bcc/replyTo kontrolleres før Graph-tokenanmodning. Produktionsmiljøet tillader almindelig levering, når listen er tom; anvend listen under kontrolleret idriftsættelse. Modtagerlisten begrænser ikke afsenderpostkassens Graph-rettigheder. Mailkøen bruger afsendelsesstatus og kontrolleret retry; en usikker afsendelsestilstand kræver afstemning mod udbyderen, ikke blind genafsendelse.

Generér uafhængige værdier for Entra-app, Graph-app, OIDC-state, approval-token, cron, testadgang, DB og eventuel Blob-fallback. Gem version, ejer, udløb og rotationsdato i secretlageret. Brug kortlivede platformidentiteter, hvor adapteren understøtter dem. Secrets må ikke indgå i buildlogs, browserbundler eller eksempler. Kun dokumenterede `NEXT_PUBLIC_*`-værdier må være offentlige.

Rotation har forskellige følger: OIDC-state-secret afbryder igangværende loginforsøg; eksisterende portalsessioner tilbagekaldes særskilt ved kompromittering. Rotation af approval-secret tilbagekalder **ikke** allerede udsendte bearerlinks, fordi de valideres mod gemte tokenhashes. En kontrolleret procedure skal derfor annullere åbne godkendelser, annullere/scrub tilhørende kølagte mails og udstede nye links efter accept. Allerede afsendte PDF'er kan ikke kaldes tilbage af portalen. De konkrete administrations-/rotationsprocedurer er endnu ikke automatiseret.

## Backup, gendannelse og rollback

Systemejer og drift fastlægger RPO (acceptabelt datatab), RTO (gendannelsestid), retention, geografisk placering, kryptering, adskilt backupadgang og testhyppighed. Ingen af værdierne er fastsat eller målt af koden. Tag backup før schemaændringer, og registrér release-SHA, migrationsledger/checksums og referencetidspunkt sammen med backupjobbet.

En anvendelig kopi omfatter database og dokumentobjekter med manifest over storage-locator, størrelse og SHA-256. Database-only backup kan efterlade manglende bilag; et lager alene genskaber ikke versioner, godkendelser og rettigheder. Afklar log-/sletteretention og backupbevaring. Turso dokumenterer kopi/gendannelse til ny database på et tidspunkt; den konkrete plans retention og rettigheder skal bekræftes. [Turso `db create`](https://docs.turso.tech/cli/db/create). Blob-durabilitet og replikering er ikke evidens for, at kommunen kan gendanne slettede objekter; afprøv egen gendannelsesvej. [Vercel Blob](https://vercel.com/docs/vercel-blob).

Gendannelsesøvelse udføres afskærmet med udgående mail/cron blokeret på platformniveau og kontrolleret adgang. En produktionskopi beholder sin `production`-markør og må ikke sættes i pilottilstand eller tilføres testlogin. Brug godkendte operatoridentiteter og en særskilt kontrolleret origin/appregistrering ved funktionstest. Tilbagekald kopierede sessioner og åbne bearerlinks; stil kopieret mailkø i kontrolleret karantæne, så gamle notifikationer ikke sendes igen. Nyt Blob-store ændrer locators; godkendt remapping skal tage hensyn til versions-/audit-immutability. Der findes endnu ikke et automatisk værktøj til denne samlede gendannelse.

Acceptér øvelsen, når integritets-/fremmednøglekontrol er ren, filmanifest/hash stemmer, roller og kommunegrænser virker, versionshistorik og auditspor er intakte, og målt RPO/RTO opfylder aftalen. Gem kun redigeret testrapport i generel dokumentation; rå backup/persondata forbliver i godkendt driftslager.

Ved releasefejl: stop promotion, bevar kandidatens evidens, og vurder hændelsen. Applikationsrollback til tidligere verificeret artifact kræver bagudkompatibelt schema **og samme migrationsmanifest**. Den strenge ledgerkontrol afviser et ældre artifact efter nye migrationer, også ved additive schemaændringer. Brug i så fald en reviewet fremadrettet rollbackrelease med kompatibel kode og aktuelt manifest, eller en afprøvet koordineret gendannelse efter beslutning om datatab. Runneren har ingen down-migration. Stop mail og nye skriverier før database-/Blob-konsistensskift via platformens adgangs-/trafikkontrol; der findes endnu ikke en indbygget vedligeholdelsesknap. Frigiv ikke en tidligere sårbar version alene for at få grøn healthcheck.

## Readiness, alarmer og resterende accept

`GET /api/healthz` viser kun, at applikationen svarer. `GET /api/readyz` kontrollerer i produktion konfigurationsstruktur, databaseadgang, præcis migrationsledger/checksums mod release-manifest, miljømarkør og `SELECT 1`. Ledger-/miljøkontrollen sker ved schemainitialisering og er cachet pr. proces; den er ikke en løbende inspektion af alle faktiske kolonner/triggers. Den anvender ingen migration automatisk. Et grønt svar beviser ikke fungerende Blob, Entra, Graph eller scanner, korrekte regioner/aftaler eller kommunal accept. `node scripts/check-production-config.mjs` kontrollerer kun miljøkonfiguration; hver adapters strengere runtimevalidering og rigtig integrationstest skal også bestå.

| Frigivelseskrav | Ejer | Evidens før produktion |
| --- | --- | --- |
| Platform/dataadskillelse | Drift/systemejer | Adskilte id'er/adgange, regioner, aftaler, datakategorier og miljømarkør |
| Identitet/livscyklus | IAM/systemejer | Rigtig Entra-test, MFA/Conditional Access, rollebestillinger, afgang/rotation og testlogin afvist |
| Godkenderflow | Systemejer/sikkerhed | Accept af bearer/PDF eller ændringskrav; tilbagekaldelse, samtidighed og selv-/kryds-tenant-afvisning |
| Scanner/filer | Sikkerhed/drift | Rigtig scanner, positive/negative/fejltest, private filer og holdbar oprydning |
| Mail | Exchange/drift | Begrænset afsender, modtagerliste, fuldt godkendelsesflow og ingen uautoriseret afsendelse |
| Data/gendannelse | Database-/backupansvarlig | Migration på kopi, ledger, integritet, koordineret restore og målt RPO/RTO |
| CI/CD | Repo-/driftsansvarlig | Obligatoriske checks/review, beskyttede environments, aktuelt CLI-audit og afprøvet staged release/rollback |
| Overvågning/beredskab | Drift/sikkerhed | Alarmer og modtager for 5xx/readiness, scannerfejl, uploadophobning, køalder, backupfejl og secretudløb; gennemført alarm-/incidentøvelse |
| Kommunal anvendelse | Systemejer/fagansvarlige | Risikovurdering, databehandling/retention/arkivering, DPIA-screening og manuel tilgængelighedsaccept efter faktisk scope |

Der er ingen dokumenteret ekstern go-live-accept. Appens og deploymentværktøjets separate, præcise og tidsbegrænsede dependency-undtagelser fremgår af [CI/CD-dokumentet](ci-cd.md). CLI-overrides er kompatibilitetstestet, men efterlader en kendt braces-rest-risiko; der er ingen critical-undtagelse. De tekniske undtagelser er ikke en kommunal risikoaccept. `DGITA_PRODUCTION_APPROVED=true` registrerer frigivelsesbeslutningen, men erstatter ikke evidensen.

Driftslogs skal undlade rå tokens, login-callbackquery, godkendelses-URL'er, dokumentindhold og fritekst. Fastlæg adgang/retention for audit- og platformlogs og test redigering i ingress, APM og fejlopsamling; applikationens sikre fejltekster garanterer ikke, at en proxy undlader at logge URL'er. Der er ikke implementeret en samlet SIEM-/alarmintegration eller automatiseret arkiverings-/sletteprocedure.

Eksterne tekniske kilder ovenfor er læst 5. oktober 2026. Vejledningen dokumenterer tekniske forudsætninger og manglende driftsbevis; den er ikke en certificering eller erklæring om samlet lov-/standardoverholdelse.
