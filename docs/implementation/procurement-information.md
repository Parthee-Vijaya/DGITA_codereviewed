# Personoplysningskategorier og anskaffelsesgrundlag

Formularen beholder sine ti trin. Trin 5, Investering, supplerer første års omkostninger med et manuelt anslag for den samlede kontraktværdi. Trin 6, Risiko & data, registrerer flere personoplysningskategorier uafhængigt af den eksisterende klassifikation af data.

## Personoplysningskategorier

`personalDataCategories` er et additivt, valgfrit felt i `dgita-v1`. Det indeholder højst fire forskellige værdier:

| Værdi | Visning |
| --- | --- |
| `ordinary` | Almindelige personoplysninger |
| `special` | Særlige kategorier (følsomme oplysninger) |
| `criminal` | Oplysninger om strafbare forhold |
| `national-id` | CPR-numre |

Ved nye indsendelser kræver persondata = Ja mindst én kategori. Alle fire kan vælges samtidig. Dataklassifikation er fortsat et separat valg med den hidtidige validering. Historiske klassifikationer omsættes ikke automatisk til kategorier. Persondata = Nej rydder kategorierne i formularen og fjerner dem fra den indsendte version, også ved direkte API-kald med skjulte svar.

## Investering og samlet kontraktværdi

`getFinanceTotal` er uændret: engangsomkostninger + ét års drift + øvrige omkostninger i første år. Formularen viser denne sum som **Omkostninger i første år**. Summen anvendes aldrig som et automatisk anslag for hele kontraktperioden.

| Felt | Betydning og grænse |
| --- | --- |
| `contractValueStatus` | `estimated`, `needs-clarification` eller ubesvaret `""` |
| `estimatedContractValueExVat` | Manuelt samlet beløb ekskl. moms for hele perioden, inklusive alle optioner og mulige forlængelser. Dansk beløbsformat, højst to decimaler, 0–1.000.000.000.000 kr., højst 32 tegn. |
| `contractDurationMonths` | Valgfri grundperiode uden forlængelser, helt antal måneder 1–1200, højst fire tegn. |
| `contractOptionsDescription` | Påkrævet ved anslag; beskriv optioner og forlængelser, eller skriv Ingen. Højst 4000 tegn. |
| `contractValueNote` | Påkrævet beregningsgrundlag og forudsætninger ved anslag. Højst 4000 tegn. |
| `contractCoverage` | `existing-agreement`, `new-contract`, `needs-clarification` eller ubesvaret `""` |
| `agreementReference` | Påkrævet ved eksisterende aftale. Almindelig dokument- eller journalreference, højst 2048 tegn og uden kontroltegn ved indsendelse. Referencen hentes ikke. |

Nye indsendelser kræver eksplicit status for kontraktværdi og aftaledækning. **Skal afklares** er et gyldigt svar, giver et opmærksomhedspunkt og tillader indsendelse til efterfølgende sagsbehandling. Når kontraktværdien skifter fra anslået til uafklaret, ryddes beløb, periode, optioner og beregningsgrundlag. Aftalereferencen ryddes, når anskaffelsen ikke længere angives dækket af en eksisterende aftale.

Der er ingen automatisk udbudstærskel, juridisk afgørelse eller godkendelse. Oplysningerne udgør grundlaget for manuel indkøbsvurdering.

## Kladders og historiske versioners kontrakt

Alle nye felter er additive og valgfrie på skemaniveau. Gamle kladder kan fortsat læses og gemmes uden at udfylde dem. Den eksisterende validering af typer er udvidet med lukkede valgmængder, entydige kategorier og tekstgrænser; ufuldstændige faglige svar tillades i kladder. Nye indsendelser valideres af samme engine på klient og server.

Læsning og oprettelse af en rettelseskladde giver neutrale, ubesvarede værdier. De oprindelige versionsbytes ændres ikke, og gamle klassifikationer eller førsteårstal bruges ikke til at opfinde nye svar. Skjulte svar udelades fra den låste indsendte version; sagsvisningens normalisering skjuler dem også defensivt.

`demoApplicationState` indeholder eksplicitte syntetiske eksempler. `legacyDemoApplicationState` er uændret og bevarer fraværet af de nye felter.

## Verifikation

- `features/application/procurement.test.mjs`: legacy-læsning, separate kategorier og klassifikation, kombinationer, grænseværdier, ugyldige beløb, validering og fjernelse af skjulte svar.
- `features/application/submission-validation.test.mjs`: reel lokal API, gem kladde, identiske klient/server-fejl, eksplicit uafklaret svar, faste indsendte versioner og afvisning af efterfølgende mutation.
- `tests/a11y/procurement-information.spec.ts`: desktop og mobil, tastatur, fejloplæsning, axe, gem/genoptag, flere kategorier, review, indsendelse og skjulte felter.

Skærmbilleder og testlogs gemmes under den ignorerede `work/`-mappe.
