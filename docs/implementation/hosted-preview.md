# Isoleret feature-preview på Vercel

Denne profil gør den gennemgåede funktionsbranch tilgængelig på Vercel med syntetiske data, inklusive KLE i ansøgningen og den særskilte KLE-afprøvning. Den er oprettet efter Parthees anmodning om en onlineafprøvning den 17. oktober 2026. `main`, den eksisterende pilot og produktionsgodkendelsen bevares. Udgangspunktet er handoff-PR #35; den konkrete leverances commit, URL og cloudkontroller skal registreres ved deployment.

## Afgrænsning og kildevalg

Det eksisterende workflow `Manual isolated Vercel preview` kræver en gennemgået SHA på beskyttet `main` og et fuldt inventar over preview, pilot og produktion. Det workflow samt release- og produktionsgates ændres ikke.

Feature-previewen leveres særskilt af operatøren fra den autoriserede funktionsbranch til et nyt, isoleret Vercel-projekt. Deployment skal bruge Preview-target og bevare eksisterende deploymentbeskyttelse. Der anvendes hverken `--prod`, promotion til den gamle pilot eller flytning af eksisterende domæner. Automatisk deployment fra vilkårlige branches må ikke få adgang til dette projekts credentials. Fraværende produktionsressourcer må ikke erstattes af opdigtede identifikatorer i det eksisterende releaseinventar.

Før deployment registreres den konkrete, rene commit og dens testresultater. Operatøren kontrollerer projekt-ID, ejerskab og faktisk adskillelse fra alle eksisterende database-/Blob-ressourcer. En lokal test af en miljøvariabel beviser ikke i sig selv, at en cloudressource er isoleret eller adgangsbeskyttet.

## KLE-adgang i den nye profil

`features/system-usage/preview-policy.ts` tillader fortsat den eksisterende lokale loopback-afprøvning. Hosted KLE kræver derudover samtlige følgende betingelser:

| Indstilling | Krav |
| --- | --- |
| `VERCEL` og `VERCEL_ENV` | Platformværdierne `1` og `preview`; produktion og development afvises |
| `VERCEL_PROJECT_ID` | Skal matche det særskilt konfigurerede `DGITA_PREVIEW_PROJECT_ID` |
| `DGITA_ENABLE_HOSTED_PREVIEW` | Præcis `true`; separat, eksplicit tilvalg |
| `DGITA_ENVIRONMENT` | Præcis `pilot`, som her betyder syntetisk testadgang |
| `DGITA_ENABLE_DEV_LOGIN`, `DGITA_ENABLE_DEMO_SEED`, `DGITA_ENABLE_KLE_PREVIEW` | Alle præcis `true` |
| `DGITA_TEST_ACCESS_SECRET` | Mindst 32 tegn, mindst otte forskellige tegn, ingen whitespace/kontroltegn. Opret en tilfældig, unik secret; minimumskontrollen må ikke forveksles med en måling af entropi |
| `DGITA_APP_ORIGIN` | En eksplicit HTTPS-origin uden loginoplysninger, sti, port, query eller fragment |
| `NEXT_PUBLIC_SITE_URL` | Samme værdi som `DGITA_APP_ORIGIN` |
| Request-origin og sidehost | Skal matche den konfigurerede origin eller præcis denne deployments serverleverede `VERCEL_URL` |
| Identitet | KLE-side, søgning og skrivning kræver fortsat en testidentitet (`dev`) og eksisterende rolle-/kommunekontrol |

En vilkårlig adresse under `vercel.app`, en uvedkommende branch-URL eller et brugerleveret `Host`-/`Forwarded`-felt giver ingen ekstra adgang. En forkert profil returnerer fortsat 404 for KLE-afprøvningen. Den almindelige portals testlogin beholder sin adgangskodekontrol, ratebegrænsning og sikre sessioncookies.

Hosted KLE afvises, hvis der er konfigurerede værdier under `DGITA_GRAPH_*`, `DGITA_ENTRA_*`, `DGITA_FK_*` eller `DGITA_MALWARE_SCAN_*`, eller hvis `CRON_SECRET` / `DGITA_MAIL_ALLOWED_RECIPIENTS` er udfyldt. Denne profil er kun til afprøvning med eksempeldata. Den omfatter ingen officiel KL-datakilde, KITOS-/SHIELD-synkronisering eller accept af rigtige forretningsdata.

## Database, filer og kommunikation

- Opret en ny Turso-database og en særskilt token. Anvend aldrig den eksisterende pilots eller produktionens database. `TURSO_DATABASE_URL` og `TURSO_AUTH_TOKEN` konfigureres som Preview-miljøværdier.
- Opret et nyt **privat** Blob-lager og bind det til det nye projekt. Brug `BLOB_STORE_ID` med projektets OIDC-adgang. Undlad `BLOB_READ_WRITE_TOKEN`, som ellers har forrang og kan pege på et andet lager.
- Sæt `NEXT_PUBLIC_DGITA_UPLOAD_MODE=vercel-blob`, så dokumenter sendes direkte til det private lager. Afprøv upload, autoriseret download og afvisning af anonym adgang med en syntetisk fil.
- Opret en særskilt tilfældig `DGITA_APPROVAL_TOKEN_SECRET` på mindst 32 tegn. Genbrug hverken den nye testadgangskode eller secrets fra andre miljøer.
- Initialisér den tomme database med de reviewede migreringer fra samme commit, inden den bruges. Den ikke-produktive runtime kan bootstrappe schemaet og mærker databasen permanent som `test`; den mærkning adskiller ikke to forskellige pilotmiljøer. Den eksterne ressourcekontrol er derfor nødvendig.
- Demo-seed bruger de eksisterende syntetiske fixtures. Indtast og upload kun eksempeldata. Der må ikke kopieres rigtige sager eller persondata til denne afprøvning.
- Mail forbliver blokeret af pilotens tomme modtagerliste, manglende Graph-konfiguration og manglende cron-secret. En lokal mailkø er ikke dokumentation for afsendelse.
- Der er ingen rigtig malwaretjeneste i denne profil. Syntetiske bilag får status `not_configured`, aldrig en opdigtet ren scanning. Produktionens krav om scanning er uændret.

## Verifikation før linket afleveres

Kontrollér og registrér følgende på den faktiske deployment:

1. Deployment-ID, commit, korrekt projekt, Preview-target og uændret beskyttelse. Kontrollér særskilt, at `main` og eksisterende pilotdomæner er uændrede.
2. `/api/healthz` og `/api/readyz`, login-side, afvisning af anonym adgang og forkert testadgangskode.
3. Login som bruger, D-GITA-konsulent og administrator samt de eksisterende rollegrænser.
4. KLE-søgning, valgfri udfyldelse i ansøgningen, gem/genindlæs og særskilt KLE-afprøvning. Hjælpeteksten om mødet med D-GITA-konsulenten og markeringen af syntetiske data bevares.
5. Syntetisk bilagsupload/download, privat lageradgang og blokeret ekstern mail.
6. Mobil/desktop og almindelig navigation. Koden ændrer ingen layout- eller stilregler.

Gem testresultater uden adgangskoder, tokens, sessionscookies eller rå miljøfiler. Lokale policytests og en grøn build er nødvendige kodekontroller; de erstatter ikke disse cloud- og browserkontroller. Først efter faktisk verifikation må handoffen sige, at den hostede preview er klar.

## Tilbageførsel

KLE kan lukkes straks ved at sætte `DGITA_ENABLE_HOSTED_PREVIEW=false` i det dedikerede projekts Preview-miljø og lave en ny deployment, eller ved at deaktivere denne previewdeployment. Eksisterende pilot og produktion behøver ingen ændring. Sletning af testressourcer og rotation af adgang kræver en særskilt, dokumenteret oprydning; behold nødvendig testdokumentation uden secrets.
