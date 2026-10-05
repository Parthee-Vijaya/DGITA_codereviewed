# Driftsmålinger og afgrænset lokal evidens

K10 giver holdbar, redigeret jobstatus, administratorbeskyttede tenantaggregater, scannerudfald og en HTTP-alarmadapter. Det er implementering og lokal afprøvning; rigtig vagt, SLO, backup, providerkapacitet og kommunal driftsaccept er fortsat uafklaret.

## Konfiguration uden skjulte servicemål

| Servervariabel | Betydning |
| --- | --- |
| `DGITA_SCHEDULER_EXPECTED_INTERVAL_SECONDS` | Eksplicit forventet interval, 60 til 2.678.400 sekunder. Fravær/ugyldig værdi giver unknown. |
| `DGITA_MAIL_QUEUE_ALARM_SECONDS` | Eksplicit køalarmgrænse, 1 til 2.678.400 sekunder. Der findes ingen automatisk 10-minutters driftsgrænse. |
| `DGITA_OPERATIONS_ALARM_URL` | Godkendt HTTPS-sink uden URL-credentials/query/fragment. Kun local tillader HTTP på loopback til isoleret test. |
| `DGITA_OPERATIONS_ALARM_TOKEN` | Separat serversecret på 32–4096 tegn uden whitespace/controltegn; sendes kun som Authorization-header. |
| `DGITA_OPERATIONS_ALARM_TIMEOUT_MS` | Transporttimeout 100–10.000 ms; standard 2.000 ms. Det er en teknisk timeout, ikke et servicemål. |

Vercelcron bevares daglig (`0 6 * * *`), Cloudflareplanen hver andet minut. Ingen betalt plan ændres. Drift skal vælge et interval og en køgrænse, som passer til faktisk scheduler, forretning og kapacitet. At skrive 86400 i forventet interval beviser ikke, at Vercel har afviklet et job. Ugyldig/manglende alarmkonfiguration ses som `not_configured`/`invalid_configuration`; der hævdes ikke alarmlevering.

## Holdbar heartbeat

`runScheduledMaintenance` kører samme cleanup/mailpass på begge runtimes. Afslutningsstatus gemmes under `operations:maintenance:v1` i eksisterende `portal_bootstrap_state`, med tidspunkt, completed/failed, varighed og to booleske flags. Der gemmes ingen sags-/bruger-id'er, navne, mails, dokumentindhold, fritekstfejl eller globale andre-tenant-tællere. Tenant-id'et er kun den eksisterende DB-scopekobling.

Aktive tenants får samme observerede fælles schedulerstatus; det er ikke bevis for, at hver tenants kø blev tømt. En nyere heartbeat kan ikke overskrives af en ældre. Ved samme millisekund vinder failed over completed. Global recovery-quarantine blokerer heartbeatwrites. Skriveriet returnerer written med faktisk antal ændringer eller superseded, hvis en lige så ny/nyere status allerede findes. Ingen aktive tenants eller karantæne kan ikke meldes som en gemt heartbeat. `telemetryPersisted` er kun true ved written; superseded er et synligt, ikke-fejlende concurrencyresultat. Jobbets normale schema-/miljøkontrol skal også bestå; der er ingen omgåelse til en gendannelseskopi.

Fejl ved heartbeatlagring må ikke skjule mailpasset: resultatet angiver `telemetryPersisted: false`, en konstant redigeret fejl logges, og alarmadapteren kan forsøges. Hvis hele DB/app/scheduler er nede, kan denne kode ikke selv aflevere en heartbeat/alarm. Derfor kræves en separat ekstern monitor. Den målte jobvarighed vedrører cleanup/mailpasset, ikke en kapacitetsgaranti eller hele alarmtransportens varighed.

## Operatørvisning

`GET /api/operations/status` kræver login og aktuel adminrolle for en aktiv bruger/tenant. SQL genkontrollerer mandatet, også hvis callerens aktør er blevet gammel. Svaret er `no-store`; almindelig offentlig health/readiness er ikke udvidet med disse detaljer.

Svaret omfatter kun egen tenants unresolved/queued/processing/failed-køtællere og alder. `uncertain` er en konservativ optælling, som kræver leverandørafstemning: `MAIL_DELIVERY_STATE_UNKNOWN` samt failed `GRAPH_TIMEOUT`/`GRAPH_NETWORK_ERROR`. De to Graph-koder kan også hidrøre fra tokenstadiet; tallet er ikke bevis for faktiske dobbeltleveringer eller at alle mails nåede transporten.

Jobmissing er unknown uden gyldigt forventet interval. Med konfigureret interval markeres manglende heartbeat som missing/not_observed; en gemt heartbeat er missing, når alderen overstiger intervallet. En beskadiget/fremtidig markør giver unknown. Der er ingen indbygget kalender, graceperiode eller accept af en ny deployments første planlagte tick; monitoransvarlig skal håndtere dette i sin idriftsættelsesprocedure.

Scanneraggregatet tæller **aktuelt beholdte bilagsrækker** med failed/infected/pending. Det er ikke en kumulativ scannerfejlrate: multipart afvises før bilagslagring, og gamle rækker kan ændres/ryddes op. `historicalFailureTotal` står derfor unknown. Scanneradapteren udsender samtidig typed, allowlisted events med udfald og afgrænset varighed. Hverken filbytes, checksum, filnavn, identitet, URL, providerfejl eller token indgår. En rigtig logopsamler skal beregne trends/alarmer på disse events og have godkendt adgang/retention.

Backupstatus er altid unknown, indtil en særskilt verificeret backup-/restorekilde er integreret. En grøn lokal K09-øvelse gælder ikke automatisk den læste tenants faktiske cloudbackup. Sidste alarmlevering er jobresultat/logevidens; den holdbare heartbeat er ikke en kvittering fra en rigtig vagt.

## HTTP-alarm og lokale tests

Alarmen indeholder kun fast event/schema, booleans for jobfejl/cleanup/kø/telemetri og varighed. Modtageren kommer alene fra serverkonfiguration. Redirects afvises, fejl-/responsindhold kopieres ikke til logs, og timeout dækker transport/afslutning. `delivered` betyder, at sinken returnerede HTTP 2xx; det beviser ikke, at en person eller downstream on-call-tjeneste læste alarmen.

Kør `node --import tsx --test tests/operations.test.mjs tests/scheduled-maintenance.test.mjs` med Node 24. Tests omfatter genåbnet DB, heartbeatorden, karantæne, live rollefratagelse, anden tenants data, manglende interval, redigeret scanner-timeout, DB-telemetrifault, anonymt endpoint og en faktisk lokal HTTP-sink med timeout-/konfigurationsafvisning.

Den samtidige øvelse kører 50 syntetiske jobkald mod SQLite-heartbeat og lokal HTTP-sink. Cleanup/mailforretningen er deterministiske testadaptere med injicerede fejl. `work/operations-tests/load-evidence.json` indeholder faktisk antal kald, forventede/modtagne HTTP-alarmer, samlet varighed, p95 og maksimum. Det er en måling af netop denne lokale øvelse, ikke en garanti om Graph, scanner, Vercel, R2/Blob, databaseplan eller produktionsgennemløb. Ingen rigtige mailmodtagere eller eksterne alarmtjenester kontaktes af testen.

## Resterende accept

Drift/SOC og systemejer skal udpege monitor-/alarmmodtager, intervaller, servicemål, vagt/eskalation og logretention. Afprøv rigtig alarmkæde, totalt jobstop, provider-/DB-svigt, kapacitetsgrænser og gendannelse på den valgte platform. Leverandør-/region-/aftaleforhold og kommunal hændelsesproces kræver særskilt godkendelse. Lokale tests ændrer ingen samlet score og flytter ikke organisatorisk U til accept.
