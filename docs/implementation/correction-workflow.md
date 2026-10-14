# Supplering og afsluttende beslutning

F11/F12 har særskilte handlinger for at bede om flere oplysninger og for at give endeligt afslag. De bruger den eksisterende adgang for konsulent/administrator. Der er ingen rolleændring, ny ekstern integration eller automatisk datamigration.

## Anmodning om flere oplysninger

`POST /api/workspace`:

```json
{
  "action": "application.request-information",
  "caseId": "ITA-12345678",
  "reason": "Beskriv adgang og ansvar nærmere.",
  "dueDate": "2099-12-01",
  "expectedVersionId": "aktuelt-versions-id",
  "expectedRowVersion": 7
}
```

Svaret er `{ "request": InformationRequest }`, hvor `InformationRequest` indeholder `reason`, `dueDate`, `requestedAt`, `applicationVersionId` og den nye `revision`. Begrundelsen er offentlig for anmoderen. Fristen skal være en gyldig kalenderdato, som ikke ligger før dags dato i København. Fristen er en opfølgningsdato; systemet lukker ikke automatisk sagen, når den udløber.

Handlingen flytter en indsendt sag til `changes_requested` / `Indsendt`. Den gemmer begrundelse og frist i det eksisterende append-only auditspor og opretter en portalnotifikation til ejeren. Status, revision, audithændelse og notifikation gemmes i samme transaktion. Der sendes ikke en ny e-mail fra denne handling.

Anmodningen er unik for kildens ansøgningsversion. Identiske gentagelser under `changes_requested`, herunder samtidige klik og gentagelse efter mistet svar, returnerer samme resultat. En anden begrundelse eller frist på samme version giver 409. En ny genindsendt version kan få sin egen anmodning.

Sagens ejer åbner rettelser gennem den eksisterende `beginApplicationCorrection` og indsender med `submitApplication`. Resultatet fra åbning af rettelser indeholder også den aktuelle `informationRequest`, så offentlig begrundelse og frist følger med ind i formularen. Det eksisterende `rejection`-felt bruges fortsat kun om en faktisk afvisning fra lederen. Genindsendelsen opretter en ny uforanderlig version. Tidligere snapshots, deres bilag, feltkommentarer og interne vurderingshistorik bevares. Nye rettelser bruger kopier af tidligere bilag. Den gamle lederbeslutning følger ikke med som godkendelse af den nye version.

Åbne lederanmodninger (`pending`, `approving`, `rejecting`) spærrer for retur, også hvis linket er udløbet. D-GITA skal tilbagekalde anmodningen gennem den særskilte handling. Åbning af rettelser tilbagekalder aldrig selv et lederlink.

## Positiv D-GITA-beslutning

En `approval.save` med `approved: "Ja"` kræver en faktisk committed ledergodkendelse af præcis `current_version_id`. Både lederanmodningen og dens tilsvarende `approval.approved`-audit skal være til stede, høre til samme kommune og sag samt til den aktuelle version. Den seneste anmodning for versionen skal være godkendt, og beslutningen skal være truffet senest ved linkets udløb.

Et allerede udløbet link kan ikke erstatte en lederbeslutning. Omvendt ophæver linkets senere udløb ikke en rettidigt truffet, dokumenteret godkendelse. Historien omskrives ikke ved læsning. Manglende, uafsluttede, afviste, tilbagekaldte eller tidligere versions beslutninger kan ikke bruges til positiv D-GITA-beslutning eller positiv afslutning.

Kontrollen foretages både før lagring og i den atomiske opdatering sammen med sagens revision, aktuelle version og fraværet af åbne lederanmodninger. En samtidig ændring giver 409 uden delvis lagring af vurdering, historik, audit eller slutnotifikation.

## Endeligt afslag

`POST /api/workspace`:

```json
{
  "action": "approval.reject",
  "caseId": "ITA-12345678",
  "reason": "Sagen kan ikke godkendes på det foreliggende grundlag.",
  "expectedVersionId": "aktuelt-versions-id",
  "expectedRowVersion": 7,
  "expectedUpdatedAt": null
}
```

`expectedUpdatedAt` er den senest læste interne vurderings `updatedAt`, eller `null` hvis der ikke findes en vurdering af denne version. Svaret er `{ "approval": DgitaApproval }`.

Den eksplicitte `reason` er den offentlige afslagsbegrundelse og gemmes som vurderingens `notes`, som den eksisterende slutkvittering benytter. De øvrige allerede gemte interne vurderingsfelter og deres historik bevares. Handlingen gemmer `approved: "Nej"`, `phase: "Afsluttet"` og sagsstatus `closed`, sammen med et versionsbundet `application.finally_rejected`-audit. Den eksisterende slutkvittering, slutnotifikation og mailkø bruges. Positiv ledergodkendelse er ikke et krav for afslag.

Afslag kan også gives, mens sagen afventer rettelser, eksempelvis efter lederens afvisning. En åben lederanmodning skal fortsat tilbagekaldes først. En samtidig rettelse af kladden eller genindsendelse rammer revisionskontrollen; efter afslutning kan den gamle rettelsesfane hverken gemme eller genindsende.

Identisk gentagelse med samme version, oprindelige revision og begrundelse returnerer samme afslagsbeslutning uden dublerede hændelser, notifikationer eller mails. En anden begrundelse, revision eller version giver 409. `closed` er terminal: almindelig vurdering, retur og rettelser kan ikke genåbne sagen.

Valget `Nej` i de almindelige vurderingsfelter er en intern vurdering og sætter sagens status til `under_review`. Det giver ikke automatisk adgang til rettelser. `Nej` sammen med `Afsluttet` via den almindelige gemmehandling afvises; endeligt afslag kræver den særskilte handling. Historiske `rejected`-sager læses uændret og kan kun returneres til anmoderen ved den eksplicitte returhandling.

## Læsekontrakt og ældre sager

Live `CaseRecord` indeholder `currentVersionId`, `revision`, `informationRequest`, `hasCurrentLeaderApproval` og `finalDecision`. `finalDecision` er kun udfyldt for en afsluttet sag med en faktisk gemt D-GITA-beslutning på den aktuelle version og indeholder alene `outcome` (`approved`/`rejected`), den offentlige `reason` og `decidedAt`. En historisk ledergodkendelse er ikke i sig selv en endelig D-GITA-afgørelse. `informationRequest` er enten den aktuelle versions offentlige anmodning eller `null`. Projektionen udvælger de fem offentlige felter og videregiver aldrig vilkårligt audit-payload eller interne vurderingsfelter. `hasCurrentLeaderApproval` bruger samme kvalificerende forespørgsel som serverens beslutningskontrol; serveren er stadig autoriteten ved lagring.

`aiUsage` projekteres som `ja`, `nej`, `ved-ikke` eller tomt svar fra den aktuelle gemte formular. Manglende historiske svar behandles som tomme. Statisk ældre fixturedata kan mangle de nye valgfrie TypeScript-felter. Der opfindes ingen ledergodkendelser, returbegrundelser, frister eller AI-svar for historiske sager.

Der kræves ingen ny databasekolonne eller migration: det eksisterende uforanderlige auditspor er lagringskontrakten for offentlige anmodninger og den særskilte afslagsmarkør. Nye hændelser opstår kun gennem konkrete handlinger.

## Verifikation

`tests/correction-workflow.test.mjs` bruger de virkelige repository-services og en isoleret transaktionel SQLite-database med syntetiske data. Prøverne dækker kommune- og rolleadgang, fristvalidering, versionsbinding, idempotens ved parallelle klik, åbne lederlinks, genindsendelse til version 2, bevaring af snapshots/bilag/kommentarer, manglende og ugyldige lederbeslutninger, rettidig godkendelse efter linkudløb, eksplicit terminalt afslag, gamle rettelsesfaner, samtidige revisioner/ledertilstande og rollback ved audit- eller notifikationsfejl.

Den eksisterende slutkvitteringsprøve er opdateret til først at gennemføre en rigtig ledergodkendelse, før en positiv D-GITA-afslutning testes. Denne lokale kontrol dokumenterer ikke godkendelse af kommunens produktionsmiljø eller levering af eksterne mails.
