# Databaseskema og ældre pilotkopier

`tests/schema-parity.test.mjs` opretter to isolerede SQLite-databaser: én med alle versionsstyrede migrationer og én med pilotens runtime-bootstrap. Testen sammenligner kolonner, defaults, nøgler, indeks, fremmednøgler, CHECK-regler og triggers. Ændringer i migrationshistorikken kontrolleres særskilt af checksum-ledger og migrationstestene. Testene kører under den eksisterende `npm run test:unit` i CI.

Den første kontrol fandt en forskel i metadata for `portal_environment.id`: migrationen havde eksplicit `NOT NULL`, mens bootstrap anvendte den implicitte INTEGER PRIMARY KEY-regel. Bootstrap er bragt i overensstemmelse med migrationen. Eksisterende databaser ændres ikke af denne rettelse.

## Undersøg en isoleret kopi

Brug Node24 og en konsistent SQLite-kopi fra det relevante backupværktøj. Kopiér ikke kun `.sqlite`-filen fra en kørende WAL-database; backup skal inkludere de committede transaktioner. Brug aldrig en produktionsdatabase som testfixture.

```sh
node scripts/schema-check.mjs --database /isolated/path/pilot-copy.sqlite
```

Kommandoen åbner filen med `readOnly: true`. Den skriver hverken datarækker, migrationsledger eller miljømarkør. JSON-resultatet indeholder skemafingerprints, kategorier af afvigelser, integritetsstatus og ledgerstatus; ingen sagsdata eller forbindelsesoplysninger. Exit0 kræver både præcis skemaparitet, præcis ledger og intakt database. En ledgerløs pilot giver exit1, også hvis skemaet passer.

Et match er **ikke** tilladelse til at baseline en gammel database. Ved en ældre pilot skal ansvarlig database-/driftsmedarbejder først godkende backup, datakortlægning, migrationsforsøg på kopi og verificeret restore. Eksisterende brugere, sagsversioner, filer og revisionsspor skal afstemmes. Først derefter kan en særskilt versionsstyret overgang og et rollbackforløb vurderes. Der er ingen automatisk baselinefunktion.

## Bevis og afgrænsning

Testene opdager fjernede immutabilitetstriggers, manglende unikke indeks, ekstra kolonner/tabeller samt ændringer i CHECK, sammensatte fremmednøgler og udtryksindeks. Et opgraderingsforsøg fra forrige migration bevarer syntetiske brugerrækker. Legacykontrollen verificeres byte-for-byte uden ændring af inputfilen.

Kontrollen sammenligner `portal_*`-objekter. Den er ikke et bevis for korrekt faktisk databehandling, private Blob-rettigheder, backupkonsistens eller kommunal driftsaccept. D1-/Turso-tjenestens konkrete version og begrænsninger skal fortsat afprøves i målmiljøet.
