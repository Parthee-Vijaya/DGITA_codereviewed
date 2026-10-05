# Bevaring: deterministisk forslag uden sletning

`features/privacy/retention-preview.ts` beregner et afgrænset dry-run-resultat. Der er ingen DB-/storageadgang, netværk, sletning, køopdatering eller ændring af historiske sager. Tiden kommer fra et eksplicit input og aflæses ikke fra maskinens ur.

Resultatet er altid `destructive: false`. Mulige handlinger er `blocked`, `retain` eller `review_proposal`. En overskredet frist udløser kun et forslag til faglig vurdering; den udløser aldrig en kassation, arkivering eller fysisk sletning.

## Beslutningsrækkefølge

1. Aktivt legal hold blokerer. Ukendt/fraværende hold blokerer også; der findes ingen stiltiende standard for, at et hold er ophævet.
2. Et dokumenteret klart holdresultat skal have gyldige UTC-review-/udløbstider og stadig være aktuelt ved beregningstidspunktet.
3. Politik skal være eksplicit, versioneret og markeret godkendt med samme godkendte version, beslutningsreference og godkendelsestid. Den skal være gældende nu og angive `review_only`. Manglende/udløbet/uforståelig politik blokerer.
4. Sagsevidens skal angive afsluttet status, gyldig lukketid, positiv versionsnummer og et strukturelt gyldigt snapshot-SHA-256. Fremtidig/ukendt lukketid eller åben sag blokerer.
5. Klassifikation skal have præcis én regel. Der er ingen wildcard- eller catchall-regel. Dubletter og ugyldige intervaller afvises. Fristen er et eksplicit antal hele UTC-dage efter lukketid; der findes ingen kommunal standardfrist indbygget i koden.
6. Før fristen: `retain`. Fra fristen: `review_proposal`, med politikversion og beregnet tidspunkt. Frit sagsindhold, personoplysninger, tokens og uvedkommende inputfelter kopieres ikke til resultatet.

Inputkontrakten validerer strukturen; den **verificerer ikke**, at en fremsendt godkendelsesreference er ægte, at hash matcher den aktuelle DB-version, eller at kommunen faktisk har godkendt en politik. Der er derfor intet offentligt endpoint eller operatør-API, som ud fra klientinput kan oprette en autoritativ handling.

Ved en senere integration skal en autoriseret serveradapter hente aktuel lukket status/version, klassifikation, vedtaget politik og hold fra godkendte kilder. Operatøradgang skal afgrænses, og politik-/holdændringer skal auditeres. Alle forudsætninger skal genkontrolleres lige før en eventuel separat destruktiv handling. Denne ændring indeholder ingen sådan handling og kan ikke bruges som slettebemyndigelse.

## Reproducerbar lokal øvelse

Med repositoryets Node 24 og installerede dependencies:

```sh
node --import tsx scripts/retention-exercise.mjs
node --import tsx --test tests/retention-preview.test.mjs
```

Øvelsen har seks faste syntetiske scenarier: aktivt hold, ukendt hold, ukendt politik, åben sag, frist ikke udløbet og frist udløbet. Output indeholder kun scenarie-id og redigeret resultat og angiver `municipal_policy_approved: false`. Den hypotetiske 30-dagesregel er alene testinput. Den er ikke foreslået som en kommunal bevaringsfrist og må ikke kopieres til drift som en vedtaget politik.

Regressionstestene omfatter ugyldig/manglende godkendelse, versionsmismatch, udløb, manglende lukkeevidens, ukendt klassifikation, dubletregler, fristens præcise millisekundgrænse, ugyldige datoer, getters og syntetisk persondata-canary. De dokumenterer beregningen lokalt, ikke et udført slettejob eller kommunalt accepteret datalivscyklus.

## Manglende kommunale beslutninger

Dataansvarlig, systemejer og journal-/arkivansvarlig skal fastlægge formål, kategorier, autoritativ journal/arkiv, bevaring/kassation, legal hold og sletning af eksterne mail/PDF-/backupkopier. Drift skal afklare kilder, autorisation, audit og gendannelse. Der er ingen ny skematabel, ingen lagret politik og ingen ændring af eksisterende pilotdata. Organisatorisk accept forbliver U.
