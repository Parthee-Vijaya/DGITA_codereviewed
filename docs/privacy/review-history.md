# Intern vurderingshistorik

F01 tilføjer en beskrivelse af infrastrukturændringer i konsulentens interne vurdering. `Ja` kræver en beskrivelse ved gemning; `Nej` fjerner den fra den aktuelle vurdering. Historiske snapshots bevarer det, der faktisk blev gemt tidligere.

Fra migration `0007_dgita_review_history` gemmer hver vellykket konsulentgemning et uforanderligt snapshot i `portal_dgita_review_history`. Snapshot, aktuel vurdering, sagsrevision og audit gemmes i samme transaktion. En konflikt eller fejl i historik/audit må ikke efterlade en delvis gemning. Snapshottet bindes til kommunen, sagen, den aktuelle ansøgningsversion, sagsrevision, behandlerens stabile identitet og tidspunktet. En vurdering af en endnu ikke indsendt kladde har eksplicit ingen ansøgningsversion; der opfindes ikke et versions-id.

Den eksisterende `portal_dgita_approvals` forbliver den aktuelle vurdering og brugerfladens datakilde. Genindsendelse nulstiller den nye versions vurdering, mens de tidligere historiksnapshots bevares. UI og layout ændres ikke af historiklagringen.

## Adgang og udlevering

Historikken er intern. `listApprovalHistoryForActor` kræver konsulent/admin og samme kommune som sagen. Funktionen har ingen offentlig HTTP-rute og føjes ikke til arbejdsområdets almindelige payload, brugerens aktivitet, lederlink eller HTML-/PDF-kvitteringer. Det offentlige beslutningsfelt `notes` er fortsat adskilt fra intern fritekst. Udvidelse af kvittering eller journaleksport kræver en særskilt aftalt projektion.

Databasetriggere afviser opdatering og sletning af historikrækker og kontrollerer sag, kommune, revision, version og behandler ved indsættelse. Dette er applikationens databasebeskyttelse; det er ikke et bevis for uforanderlighed over for en privilegeret databaseadministrator eller manipulation af en backup.

## Eksisterende data og bevaring

Migrationen er additiv. Den ændrer ikke tidligere vurderinger og udfylder ikke historik bagud. Historik, som den tidligere én-række-pr.-sag-model allerede har overskrevet, kan ikke genskabes uden særskilt dokumentation. En eksisterende aktuel vurdering er fortsat tilgængelig, men får først et historiksnapshot, når en ny gemning gennemføres. Historik før ikrafttrædelsen skal derfor vises som ukendt, hvis en historikvisning senere bygges.

Fritekst og behandleridentitet kan være personhenførbare. Formål, nødvendighed, adgang, bevaringsperiode, journalisering, legal hold og håndtering af kopier skal afklares under R25–R32 af systemejer/dataansvarlig, journal-/arkivansvarlig og drift med DPO-rådgivning. `U` i datafortegnelsen betyder fortsat uafklaret accept. Den tekniske append-only-beskyttelse fastsætter ikke en permanent bevaringspolitik. En fremtidig godkendt slette-/arkivprocedure skal udformes og testes særskilt; denne ændring aktiverer ingen sletning.

Backuper af databasen indeholder også denne tabel. En restore skal anvende schema og migrationsmanifest med migration 0007 og verificere historikkens bindinger. Generel journaleksport og ekstern arkivkvittering er fortsat restopgaver.

## Kontrol

`tests/review-history.test.mjs` kontrollerer successive gemninger, genindsendelse, tenant-/rollegrænser, skjult intern tekst i bruger/leder/kvitteringspayloads, uforanderlighed samt atomisk rollback ved konflikt og historik-/auditfejl. Schema-, migrations- og feltfortegnelsestests verificerer migration/bootstrap-paritet og registrering af de nye kolonner.
