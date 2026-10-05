# Testdata og bagudkompatibilitet

Nye testdatabaser bruger profilen `synthetic-v1`: neutrale navne, stabile test-id'er og mailadresser under `example.invalid`. Den eksisterende tenantnøgle `kalundborg` bevares som teknisk kompatibilitetsnøgle; nye tenantnavne er `Testkommune`. Dette er ikke anonymisering af allerede gemte sager.

Profilvalget skrives én gang i den eksisterende `portal_bootstrap_state` med scope `test-fixture-profile`. Der er ingen ny tabel eller automatisk konvertering. Profilen vælges kun bag de eksisterende, eksplicitte testlogin-/seedmiljøkontroller. Production må fortsat ikke have testlogin eller seed aktiveret.

- Tom database: vælg `synthetic-v1` og opret de neutrale fixtures.
- Kendte historiske udviklingsidentiteter eller eksisterende seedmarkør: vælg `legacy-v1`. Historiske id'er og sagsreferencer bevares.
- Blandede identitetsprofiler, ukendt gemt profil eller ukendte eksisterende data: stop og kræv konkret operatørvurdering.
- Eksisterende gemt profil: fasthold den. Ændring af en miljøvariabel konverterer ikke databasen.

Ved testlogin læses eksisterende navn, mail og kommunenavn fra databasen; standardfixtures må ikke skrive dem tilbage som erstatning. En manglende historisk testkonto genskabes ikke af loginopslaget. Udviklede sagsversioner og indhold bevares af seedens eksisterende insert/versionsværn. De afgrænsede historiske reparationsregler er bevaret og dækket af deres tidligere regressionstests.

`seedPortalDefaults` eksporteres fortsat fra `features/workspace/server-repository.ts`, men seedimplementeringen ligger i `pilot-seed.ts`. `DEMO_VIEWERS`, `DEMO_CASES` og `demoApplicationState` er kompatibilitetsnavne for nye neutrale fixtures. `LEGACY_*` og `legacyDemoApplicationState` understøtter historiske pilotsager. Historiske personaoplysninger findes derfor stadig i kildekompatibiliteten og kan findes i eksisterende databaser.

Før en eksisterende pilot offentliggøres skal dataansvarlig og pilotteknisk ejer beslutte og dokumentere en særskilt neutralisering eller kontrolleret ny database. Dette arbejde har ikke læst, slettet eller omskrevet en livepilot. Backup, journaliseringsbehov, modtagerpolitik og tilbageførsel skal afklares før en eventuel konvertering; fysisk sletning er ikke implementeret her.

## D-GITA-rammefeltet

UI kalder nu valget NSIS/NIS2/GDPR en **relevant sikkerheds- og regelramme**. Den historiske API-/snapshotnøgle `legalBasis` og de tre wireværdier bevares. De har aldrig dokumenteret en konkret behandlingshjemmel efter GDPR artikel 6/9. Et gammelt valg omskrives derfor ikke til en ny juridisk betydning. Kommunens konkret vurderede hjemmel, formål og eventuelle konsekvensanalyse kræver særskilt dokumentation og accept.

## Lokal verifikation

`tests/privacy-fixtures.test.mjs` afprøver ny neutral database, profiler, bevarelse af gemte identiteter/indhold/sager, afvisning af ukendte og blandede profiler samt historiske wireværdier. `tests/demo-seed-consistency.test.mjs` afprøver eksplicit legacy-profilens tidligere reparationsregler. Disse tests dokumenterer afgrænset lokal funktion, ikke kommunal miljøaccept.
