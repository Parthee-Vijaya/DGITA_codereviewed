# Interne vurderinger af databeskyttelse og anskaffelse

F13 og F14 tilføjer to valgfrie dokumentationsfelter til D-GITAs interne sagsbehandling. De ligger i den eksisterende `internal_fields_json` på den aktuelle ansøgningsversion. Ældre sager og klienter kan undlade felterne; der kræves ingen databasemigration.

`documented` betyder, at sagsbehandleren har udfyldt den krævede dokumentation. Det er ikke en juridisk godkendelse, en automatisk lovlighedsvurdering eller et nyt krav for D-GITAs endelige beslutning. Den eksisterende ledergodkendelse, sagslåsning og adskillelse mellem internt nej og endeligt afslag gælder fortsat. Nye beslutningskrav afventer F15 og en accepteret proces.

## Datakontrakt

`DgitaApproval.privacyAssessment` og `DgitaApproval.procurementAssessment` er valgfrie objekter. Begge bruger status `not-started`, `in-progress` eller `documented`. Manglende felter på ældre sager bevares som manglende; læsning fabrikerer ingen registrering eller dokumenteret status.

| Databeskyttelse | Indhold | Maksimal længde |
| --- | --- | --- |
| `processingBasis` | Konkret behandlingsgrundlag eller begrundet ikke-relevans | 2.000 |
| `controllerRelation` | Tomt, `processor`, `independent-controller`, `joint-controller`, `not-applicable` eller `needs-clarification` | Fast værdisæt |
| `relationReason` | Begrundelse for den afgrænsede relation | 4.000 |
| `dpaNeed` | Tomt, `required`, `not-required` eller `needs-clarification` | Fast værdisæt |
| `dpaReason` | Begrundelse for behovet for databehandleraftale | 4.000 |
| `dpiaScreening` | Tomt, `required`, `not-required` eller `needs-clarification` | Fast værdisæt |
| `dpiaReason` | Begrundelse for screeningens resultat | 4.000 |
| `reference` | Dokument- eller journalreference | 1.000 |

| Anskaffelse | Indhold | Maksimal længde |
| --- | --- | --- |
| `procedure` | Manuelt beskrevet anskaffelsesprocedure | 1.000 |
| `rationale` | Konkret begrundelse | 4.000 |
| `reference` | Dokument- eller journalreference | 1.000 |
| `ruleCheckedOn` | Gyldig kalenderdato i formatet `YYYY-MM-DD` eller tomt | 10 |

Ved `documented` skal alle tekstfelter være udfyldt, og valg må hverken være tomme eller `needs-clarification`. Behandlingsgrundlag, begrundelser og procedure kræver mindst tre tegn efter trimning; referencer kræver mindst ét. Anskaffelsesvurderingen kræver også en gyldig kontroldato. `not-applicable` er et manuelt valg ved relationer uden persondatabehandling og kræver stadig konkret begrundelse. Ufuldstændigt arbejde kan gemmes som `in-progress` eller `not-started`. En angivet kontroldato skal altid være gyldig, uanset status.

Den historiske nøgle `legalBasis` indeholder fortsat en rammeværksmarkering (`NSIS`, `NIS2` eller `GDPR`). Den udfylder aldrig behandlingsgrundlaget. Vurderingsfelterne udleder heller ingen svar fra ansøgerens persondatafelter, beløb, AI-screening eller katalogvalg. Referencer er almindelig tekst; systemet henter ikke adresser eller eksterne dokumenter fra feltet.

## Registrering, historik og adgang

Ved en faktisk ændring i en vurderings indhold skriver serveren `recordedBy` (stabilt internt bruger-id), `recordedByName` (navnesnapshot), `recordedAt` (UTC) og `applicationVersionId` (aktuel version, eventuelt `null` på en kladde). Klienten kan ikke bestemme disse værdier. Uændrede vurderinger beholder den tidligere metadata, også hvis andre D-GITA-felter gemmes af en anden medarbejder. Et tomt, uændret standardobjekt får ingen registreringsmetadata. En ældre klient, der helt udelader vurderingsobjektet, sletter ikke allerede gemt dokumentation.

Vurderinger indgår i den eksisterende uforanderlige vurderingshistorik. Den aktuelle visning henter kun den aktuelle ansøgningsversions interne felter. Ved genindsendelse vises ingen tidligere dokumenteret vurdering som gældende på den nye version; den tidligere dokumentation findes fortsat i historikken. Sagsrevision og aktuel ansøgningsversion kontrolleres igen i den samme transaktion som vurdering, historik og audit. En tabt samtidig gemning kan ikke skrive vurderingen eller dens metadata.

Brugerfladen viser den aktuelle vurdering og en linje med navn og tidspunkt for dens senest gemte ændring. Tidligere vurderingssnapshots bevares på serveren og kan læses gennem den interne serverfunktion `listApprovalHistoryForActor`; funktionen er endnu ikke koblet til et særskilt API eller en historikvisning i produktet. Sagens eksisterende historikfane viser generelle aktivitetshændelser, ikke indholdet af de tidligere vurderinger. En historikvisning er derfor en separat fremtidig forbedring.

Kun konsulenter og administratorer med adgang til den samme kommune kan læse og gemme felterne. De indgår ikke i ansøgerens arbejdsområde, offentlig aktivitet, lederens beslutningsgrundlag eller HTML-/PDF-kvitteringer. Et eksplicit endeligt afslag bevarer eksisterende vurderinger og registreringsmetadata; den offentlige afslagsbegrundelse holdes i det eksisterende separate felt.

## Verifikation

`tests/case-assessments.test.mjs` kontrollerer legacy-fravær, sikker læsenormalisering, strenge typer/værdisæt/længder, kalenderdatoer og dokumentationskrav. Den anvender reel transaktionel SQLite til at kontrollere forfalsket metadata, uændrede felter, rettigheder, kommuneadskillelse, gamle revisioner, versionsskift, samtidige ændringer, lederlås, rollback og endeligt afslag. Lækagetest kontrollerer både payloads og indhold i den genererede PDF.

Disse er lokale automatiserede kodeprøver. De dokumenterer ikke en juridisk vurdering, kommunal procesaccept, produktionsdrift eller et godkendt pilotforløb.
