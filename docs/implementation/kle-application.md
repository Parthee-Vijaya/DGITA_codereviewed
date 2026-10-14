# KLE-valg i ansøgningen

## Omfang

`feat/kle-in-application` bygger på tekstafklaringen i PR #30. I den lokale afprøvning kan brugeren søge og vælge KLE-emner ved spørgsmål 30 i den eksisterende ansøgningsformular. Spørgsmålets placering, de ti trin og den almindelige sagsbehandling bevares. Brugeren udfylder det, vedkommende kan, og kan få hjælp til resten på mødet med D-GITA-konsulenten.

KLE er valgfrit. En tom søgning, manglende valg eller en søgefejl forhindrer ikke gemning eller indsendelse af en ellers gyldig ansøgning. Funktionen tilføjer ingen deling, konsulentanmodning, ejerbekræftelse eller automatisk registrering af systemanvendelser.

## Gemning og visning

Det additive felt `kleSelection` indeholder de valgte emners UUID, kode og titel samt kilde-ID, kildeversion, navn og type. Den eksisterende fritekst i `kleTopics` bevares særskilt og kan stadig redigeres. Fritekst bliver ikke automatisk til verificerede emner. Gamle kladder uden det nye felt kan fortsat åbnes.

Valgene følger ansøgningens eksisterende gemning, samtidighedskontrol, indsendte version og rettelsesforløb. De vises ved gennemgang, i sagsdetaljen og i kvitteringens beslutningsgrundlag. En tidligere indsendt version ændres ikke ved senere rettelser. Dette er dokumentation af valgte emner, ikke en faglig eller juridisk godkendelse.

Serveren kontrollerer kilde og valgte emner mod den aktuelle, uforanderlige eksempelversion. Forfalskede titler, ukendte identiteter, udgåede emner, dubletter og forkert kildeversion afvises. En fremtidig officiel katalogaktivering skal særskilt håndtere historiske kildeversioner; denne levering aktiverer ingen officielle data.

## Afprøvningsgrænse

Søgefeltet vises kun med de eksisterende lokale KLE-indstillinger, korrekt lokal host og en aktiv udviklingsidentitet. Søge-API og gemning kontrollerer også grænsen på serveren. Pilot og produktion beholder det almindelige fritekstfelt og afviser nye strukturerede eksempelvalg. Ingen miljøflag eller offentlige miljøer er aktiveret af denne ændring.

## Verifikation

Kode- og databasetest dækker den additive kontrakt, gamle kladder, valgfrihed, kildekontrol, miljøgrænse og versionsbevaring. Browserforløbene i `tests/a11y/kle-application.spec.ts` dækker valg, gemning, genåbning, indsendelse, kvittering, fejltilstande samt tastatur og mobil. De køres med den eksisterende isolerede KLE-suite. De almindelige browser- og produktionsforløb kontrollerer fortsat løsningen uden KLE-afprøvning.
