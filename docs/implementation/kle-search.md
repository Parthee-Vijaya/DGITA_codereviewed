# Integreret KLE-søgning

## Levering og afgrænsning

Søgningen på `/afproevning/kle` foregår i DGITA og bevarer den eksisterende formular, checkbokse og valgte emner. Kode, titel, stikord og beskrivelse er søgbare. Flere ord skal alle passe; præcise koder og titler rangeres højest. Udgåede emner kan ikke nyvælges. Resultater hentes i sider, så et fuldt katalog ikke skal vises på én gang.

Den aktive kilde er fortsat de opdigtede `DEMO.*`-emner. Der er ingen hentning af officielle KLE-records, automatisk synkronisering, aktivering af licenserede data eller ændring af pilot/produktion. Aftalen med KL er ikke markeret som afklaret.

## Katalog og kilde

`features/kle/catalog.ts` definerer og validerer en normaliseret katalogpakke: kilde-ID, version, status, emnernes UUID og tekstkode, niveau, udgået-status samt valgfri stikord og beskrivelse. Koder med indledende nuller forbliver tekst. Pakken indeholder også kildeadresse, hentetidspunkt, filformat og SHA-256 af inputfilen. En klargjort pakke må ikke være markeret `acceptedForUse: true`.

`features/kle/provider.ts` opbygger et uforanderligt søgekatalog. En senere licenseret kilde afvises, indtil dens brug er accepteret. Den nuværende route anvender eksplicit den syntetiske provider; et HTTP-felt eller en miljøvariabel kan ikke skifte den til en officiel kilde. Filens checksum dokumenterer inputtets identitet, ikke en aftale eller faglig godkendelse.

Søge- og vurderingsgrundlag skal pege på samme publicerede version. Klienten afviser resultater med forkert kilde eller version og ukendte emner. Søgetekst ændrer ikke vurderingen. Et ændret kodevalg gør derimod den eksisterende bekræftelse forældet efter de allerede etablerede regler. Stikord til søgning ændrer ikke i sig selv indholdet af en vurdering.

## Brugeroplevelse og datavej

Feltet venter kort på, at brugeren skriver færdig. Forældede svar og afbrudte søgninger erstatter ikke nyere resultater. Fejl giver mulighed for genforsøg, mens valgte emner og resten af kladden bevares. Resultatantal, indlæsning og fejl er tilgængelige for hjælpemidler.

Vejledningen forklarer, at KLE-emner og kritikalitet udfyldes sammen med en D-GITA-konsulent. Brugeren kan starte med en beskrivelse og gemme registreringen med uafklarede felter; kun navnet er nødvendigt for en ny kladde. Krav før bekræftelse er tydeligt adskilt fra gemning. Dette er procesvejledning; automatisk deling, konsulentadgang og fælles redigering er fortsat ikke aktiveret.

`POST /api/kle/search` modtager `{ query, offset, limit }`, kræver en aktiv lokal testbruger og samme oprindelse, begrænser søgeteksten til 256 tegn og returnerer højst 50 emner. Svaret indeholder kilde, resultater, total og sidetal. Kun den udtrykkeligt aktiverede lokale afprøvning har adgang; almindelig pilot og produktion returnerer 404.

Søgeteksten ligger i forespørgslens body og gemmes ikke af funktionen. Den tilføjes ikke til browserhistorik, eksterne links eller appens log. KLE Online-linket åbner den officielle søgeside uden at sende den indtastede tekst. Kontrol af eventuel platform-/APM-logning er fortsat en del af miljøaccepten.

## Før officielle data aktiveres

Offlineværktøjet kan afprøves med den opdigtede fixture eller senere anvendes på en autoriseret fil. Brug Node 24 og projektets installerede afhængigheder:

```sh
npm run kle:prepare -- \
  --input tests/fixtures/kle-full-plan-synthetic.xml \
  --output work/kle-prepared.json \
  --version test-2026-10-14 \
  --source-url https://api.kle-online.dk/resources/kle/emneplan \
  --retrieved-at 2026-10-14T10:00:00.000Z
```

Outputmappen skal findes, og outputfilen skal være ny. Kommandoen henter ingen data og overskriver aldrig en eksisterende fil. Metadata i eksemplet er testmetadata; ved en autoriseret eksport skal version og tidspunkt afspejle den faktiske kilde.

Adapteren er bygget efter [det dokumenterede fuld-emneplan-skema 1.2](https://skemaer.kle-online.dk/rest_1_2/KLE-REST-Emneplan-fuld-version-1-2.xsd). Den understøtter UTF-8, emneplan uden navnerum, hovedgrupper/grupper/emner, UUID, direkte stikord, vejledning som ren tekst samt udgået/flyttet-status. Facetbundne stikord, retskilder, filtre og bevaringsfelter kontrolleres strukturelt, men indgår ikke i søgeindekset. Den er ikke en fuld XSD 1.1-validator og er endnu ikke afprøvet mod en autoriseret aktuel eksport. Alle poster skal have en gyldig UUID, også historiske; en manglende identitet stopper hele importen og skal afklares med kilden.

Uventede XML-varianter, identitetskollisioner, ugyldigt hierarki og DOCTYPE/ENTITY afvises. Inputgrænser er 32 MiB, 500.000 XML-noder og dybde 32; kataloget har egne grænser for poster og tekst. XML-parseren er alene en udviklingsafhængighed til offlineværktøjet og indgår ikke i søgerutens runtime.

1. Kontrollér, at den skriftlige aftale med KL dækker DGITA's brug, opbevaring og opdatering af kataloget.
2. Klargør en autoriseret eksport offline. Kontrollér den konkrete eksport mod adapteren, antal emner, stikord, hierarki, UUID, udgåede emner og kildeversion. Gennemgå forskellen fra sidste version.
3. Publicér en accepteret, uforanderlig version gennem en særskilt ændring og dokumentér aftalehenvisningen. En netværksfejl må ikke erstatte sidste gyldige katalog eller omskrive gemte vurderinger.
4. Tilslut samme version til søgning og vurdering. Før et fuldt officielt katalog bruges, flyttes evaluering/opslag af valgte poster til serveren, så kataloget ikke sendes samlet til browseren. Den nuværende afprøvning sender kun sine få eksempelposter.
5. Afklar den selvstændige KL-opgavekilde og gennemgå datamodellens syntetiske afgrænsning. Et gyldigt KLE-emne er ikke i sig selv et NIS2-match eller en kommunal ejeraccept. Reel registrering kræver også de allerede planlagte rettigheder og bevaringsbeslutninger.

## Officielle referencer

- [KLE-REST](https://api.kle-online.dk/) beskriver opslag, fuld emneplan med stikord, UUID, historik og krav om skriftlig aftale. Dokumentationen beskriver ikke et generelt fritekstsøgeendpoint til eksterne systemer.
- [KLE Online – hjælp](https://www.kle-online.dk/hj%C3%A6lp) beskriver dybe links til emner og handlingsfacetter.

Kontrolleret 14. oktober 2026. Der er kun brugt dokumentation/skemaer og opdigtede testdata i udviklingen.
