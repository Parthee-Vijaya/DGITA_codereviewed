# Lokal gendannelsesøvelse

K09 implementerer en reproducerbar øvelse med lokale syntetiske data. Den tilslutter ingen cloudkonto, ændrer ingen eksisterende database og er ikke en produktionsbackupadapter. Produktionsmarkerede databaser afvises. Kommunen skal stadig vælge backupplatform, isoleret målmiljø, RPO/RTO og journal-/arkivløsning.

## Eksport, kontrol og restore

Brug Node 24. Opret et lokalt JSON-objektindeks, der knytter hvert `storage_key` fra testdatabasen til den tilsvarende lokale fil. Indekset og bundlen er fortrolige arbejdsfiler; selv filnavne og metadata kan indeholde oplysninger. De må ikke committes eller lægges i den redigerede releaseevidens.

```sh
node scripts/recovery.mjs export --synthetic-test \
  --database /isolated/test.sqlite \
  --objects /isolated/object-index.json \
  --output /isolated/new-bundle

node scripts/recovery.mjs verify \
  --bundle /isolated/new-bundle --digest <digest-fra-eksport>

node scripts/recovery.mjs restore --synthetic-test \
  --bundle /isolated/new-bundle --digest <digest-fra-eksport> \
  --output /isolated/new-restore
```

Outputmapper skal være nye. Mapper oprettes med 0700 og filer med 0600. Funktionen bruger SQLite online-backup fremfor almindelig filkopiering af en kørende database; committede WAL-transaktioner kommer med. Derefter læses alle færdige bilag, kvitteringer og CMS-billeder, som DB-snapshottet refererer til. Størrelse og SHA-256 skal stemme. Samtidig fjernelse/ændring af en fil får eksporten til at fejle. `manifest.json` skrives først, når alle kontroller er bestået; en afbrudt eksport er ikke en komplet backup.

Manifestet fastholder databasehash, migreringschecksums, schemafingerprint, rækketal/-hashes og objektmanifest. Udgavens kode skal matche skemaet. Gem eksportens digest i et separat kontrolleret evidensspor: hashes opdager ændringer, men er ikke i sig selv en signatur fra en betroet afsender. Kommandoens stdout indeholder kun redigerede tællere, hashes og varigheder. Fejludskrifter indeholder ikke rå SQLite-fejl, stier, filnavne eller sagsdata.

Kontrollen efterprøver SQLite-integritet, fremmednøgler, kommunegrænser mellem referencer, binding af kvitteringer og lederanmodninger til den samme sags version, den aktuelle versionsbinding, snapshot-hashes, bilagsmanifest og alle refererede filer. Kendte historiske tomme versioner uden bilagsmanifest kan bevares; en version med bilag kræver manifest. En ledgerløs, ellers kompatibel pilotkopi mærkes `missing-legacy-test-only`; værktøjet opretter aldrig en ny ledger eller baseliner den automatisk. Gamle `application_attachments` uden checksum kræver særskilt kortlægning og afvises fremfor at blive udeladt.

## Karantæne

Databaser uden tenants afvises, så en tom kopi aldrig kan rapporteres som beskyttet uden en karantænemarkør. Restore bruger først filnavnet `database.incomplete`. Det normale filnavn `database.sqlite` offentliggøres først, når filkopiering, karantæne og integritetskontroller er bestået. Ved I/O-fejl kan den private, ufuldstændige mappe blive liggende, men den har ingen normal applikationsdatabase eller færdigmeldt restore.

Restore ændrer kun den nye kopi:

- Alle kopierede sessioner tilbagekaldes.
- Alle gamle bearerlink-hashes erstattes; åbne anmodninger annulleres. Gemte beslutninger og deres indhold bevares.
- Ikke-afsendt mail annulleres og indholdet neutraliseres; afsendelseshistorikken bevares.
- Hver tenant får `recovery-quarantine` i den eksisterende bootstrap-tabel.

Sagsversioner, bilag, kvitteringer, kommentarer og det append-only revisionsspor skal have samme rækker og hashes efter gendannelsen. Beslutningsindhold sammenlignes særskilt. Kopierede filer genverificeres efter kopiering. Kun et bestået forløb skriver `restore-result.json`.

Den normale applikationsopstart afviser karantænedatabasen; outbox har desuden selvstændige karantænechecks. Det beskytter også mod oprydning i det oprindelige fillager, hvis nogen fejlagtigt genbruger providerkonfigurationen. Kopien undersøges med offlineværktøjer. Der findes ingen automatisk genaktivering eller hemmeligt bypassflag. En fremtidig driftsrestore skal have et særskilt, reviewet forløb for isolerede storage-lokationer, afstemning og kommunal accept, før trafik åbnes.

## Test og afgrænsning

```sh
node --import tsx --test tests/recovery-bundle.test.mjs
```

Roundtrip-testen gendanner en hel syntetisk sag med version, bilag, gyldig PDF, audit, sessioner, lederanmodninger og mailstatus. Negativtestene ændrer/fjerner filer, DB, manifest, ledger, snapshot, skematrigger og tenantbinding. WAL- og legacyforsøg afprøves særskilt. Karantænen kontrolleres med applikationens faktiske miljøguard.

`durationMs` er den observerede lokale øvelsestid, ikke et accepteret RTO. Testværktøjet begrænser DB-kopien til 512 MiB og hvert objekt til 25 MiB. Det leverer ikke automatisk cloudbackup, kryptering i et eksternt backuplager, opbevaring, signering eller en godkendt journaleksport. Ingen credentials eller miljøfiler kopieres med bundlen. Fremadrettet kompatibilitet og fejlrollback dækkes af migrations-/skemaparitetstestene; egentlig artifact-rollback og cloudrestore afventer målmiljøet.
