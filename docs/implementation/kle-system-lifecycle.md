# KLE, kritikalitet og systemanvendelse

## Første levering · 14. oktober 2026

Arbejdet ligger på `feat/kle-system-lifecycle`. Branchen tager udgangspunkt i fjerde etape (`693a362`) og samler de nyere rettelser fra main (`3c41099`) i `77aad34`. Main og de tidligere arbejdsbranches er ikke ændret. Den oprindelige feedbackplan er kildegrundlag og er ikke redigeret.

Målet er, at kommunen kan følge en lokal systemanvendelse gennem hele levetiden: forstå de understøttede opgaver, dokumentere kritikalitet på et kendt kildegrundlag, lade rette ansvarlige gennemgå ændringer og holde KITOS ajour uden at overskrive andres oplysninger. Anskaffelser er tilknyttede hændelser; de skal ikke være selve systemregisteret.

Denne levering er en lokal afprøvning af den manuelle kæde: KLE-valg → opgavematch → begrundet lokal vurdering → registrantens bekræftelse. Den findes på `/afproevning/kle` og bruger eksisterende formularfelter, knapper, farver og tastaturmønstre. Den normale navigation og anskaffelsesformular er bevaret. Komponenterne kan integreres i formularen efter afprøvning og kildeaccept.

## Hvad der virker

- Søgning og valg af flere emner. Koder behandles som tekst; indledende nuller bevares. Grupper udvider ikke automatisk til underemner, og udgåede emner kan ikke nyvælges eller bekræftes.
- Flere opgaver kan matche samme kode. Direkte match, muligt match, intet match og uafklaret grundlag er forskellige tilstande. Intet match udgør ikke en sikkerheds- eller NIS2-afgørelse.
- Lokal opgave og afhængigheder beskrives manuelt. Ældre fritekst bevares særskilt; der udledes ingen autoritative koder fra den.
- Lokal kritikalitet kræver et aktivt valg og en begrundelse. Eksempelskalaen er ikke kommunens vedtagne skala og ikke et KITOS-opslag.
- En selvstændig systemanvendelse kan gemmes, genåbnes og revideres uden en anskaffelsessag. Ingen eksisterende sager migreres automatisk til dette register.
- Identitet og tidspunkt for bekræftelse fastsættes af serveren. Ændret navn, opgave, kodevalg, begrundelse eller kildegrundlag gør tidligere bekræftelse historisk. En ændret opgave kræver genlæsning af vurderingen.
- Hver gemning får en uforanderlig revision. Samtidig gemning afvises med mulighed for at hente den nyeste version, mens indtastningerne bevares. Gentaget oprettelse efter mistet svar skaber ikke dubletter.

## Kilder og adgang

Kun opdigtede `DEMO.*`-koder og opgavematch følger med. De har eksplicit kilde-ID, version og status `acceptedForUse: false`. Det officielle KLE-register og KL's liste er ikke indlæst. Der foretages ingen udgående kald til KLE, KITOS, SHIELD eller en AI-tjeneste.

Afprøvningen kræver alle fire lokale indstillinger: `DGITA_ENVIRONMENT=local`, `DGITA_ENABLE_DEV_LOGIN=true`, `DGITA_ENABLE_KLE_PREVIEW=true` og en `DGITA_APP_ORIGIN` på loopback. HTTP-adressen skal matche den konfigurerede adresse. Hosted miljøer, pilot og produktion afvises. Derudover kræves en aktiv lokal testidentitet. API'et tjekker samme oprindelse og returnerer private svar uden cache.

Hver testbruger kan kun se egne eksempelregistreringer i egen tenant. En teknisk admin får ikke adgang til andres registreringer. Det er afgrænsning af afprøvningen, ikke den kommende kommunale rettighedsmodel. `recorded_by_user_id` betyder registrant; det betyder ikke systemejer. Fritekstfeltet Systemejer, ansøgerens ID og konsulentrollen giver ingen nye mandater.

## Datamodel og migration

Den additive migration `0008_system_usage_reviews` tilføjer `portal_system_usages` og `portal_system_usage_revisions`. Der er ingen ændring af gamle formulardata. Registeret har et internt ID og reserverede felter til KITOS-organisations- og anvendelses-UUID; databasekontrol kræver, at de er tomme i denne syntetiske levering. Katalog-ID må ikke bruges som anvendelses-ID.

Revisionshistorikken omfatter navn, KLE/opgave/vurderingsgrundlag, handling, registrant og tidspunkt. Databasekontrol forbyder ændring/sletning af historik og sikrer sammenhæng mellem tenant, registrant og revision. Aktuel registrering og historik gemmes atomisk. Normal drift har ingen slettefunktion. Bevaring og autoriseret sletning skal besluttes under R25–R32, før rigtige oplysninger må registreres.

Bindingen til vurderingsgrundlaget er et kanonisk indholdssnapshot, ikke en digital signatur. Serveren kontrollerer bindingen mod de aktive kilder. Eksterne rapportpakker skal senere have SHA-256 og entydige referencer til systemanvendelses-/sagsversion.

## Næste leveringer og accept

Den strukturerede opgaveliste findes i [kle-system-lifecycle-plan.json](kle-system-lifecycle-plan.json). Den udbygger F02/F03/F05/F06/F15/F23 samt R05/R11/R12/R25/R26/R29 i den eksisterende plan; disse punkter lukkes ikke af en lokal prototype.

1. Accepter KLE-brugsgrundlag, kildeversioner og kommunens KL-grundlag. Byg kontrolleret import med kildehash, dato, sidehenvisning og review af ændringer. Definér KITOS-feltmapping, herunder lokale tilføjelser/fravalg og den lokalt valgte kritikalitetsskala.
2. Fastlæg systemejer, stedfortræder, koordinator og sikkerhedsfunktion med stabile identiteter og et eksplicit mandat. Tilføj verificeret lokal KITOS-anvendelse og forbindelser til flere anskaffelser. Aktivér derefter reel ejerbekræftelse.
3. Afprøv 10–15 anvendelser manuelt, også fælles login og integrationer. Registrér tidsforbrug, uklarheder og opgaver, der bliver overset. Fastlæg reviewfrister og eskalation før automatiske påmindelser.
4. Indfør versionsbundne SHIELD-pakker og synlig håndtering af forældede rapporter. AI-forslag/JEV må først aktiveres efter et menneskeligt mærket testsæt og accept af kvaliteten.
5. Start KITOS-opdatering med en gennemgåelig ændringsliste. Automatisk skrivning afventer test af PATCH-semantik, samtidighed, gentagelser, konfliktbehandling og genlæsning. Et nyt opslag umiddelbart før skrivning er ikke alene en garanti mod samtidige ændringer.

## Verifikation

Brug Node 24 og lockfilen. `npm test` kontrollerer domæne, database, migration og eksisterende regressionsprøver. `npm run lint`, `npm run typecheck`, `node scripts/code-health.mjs --check` og `npm run build:next` kontrollerer integrationen. De eksisterende fire runtimeforløb bevares.

`npm run test:ci:kle-preview` starter en isoleret lokal testdatabase med eksplicit aktiveret afprøvning. Browserprøverne kontrollerer valg, gemning, genindlæsning, serverbekræftelse, fornyet gennemgang, tastatur, mobil, tilgængelighed og genforsøg efter et mistet svar. Det normale pilot-/produktionsforløb skal fortsat afvise afprøvnings-API'et.

Lokal teknisk verifikation, GitHub CI, kommunal procesaccept og produktionsintegration er særskilte forhold. Denne levering giver ingen automatisk forhøjelse af compliance-score.
