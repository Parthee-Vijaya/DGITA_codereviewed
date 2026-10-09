# Personvalg, katalogrelationer og arbejdsfiltre

Anden etape bygger videre på PR #18. De eksisterende sider, formularens ti trin og visuelle komponenter bevares. Nye valg og filtre bruger de samme kontroltyper og tilpasses den smalle visning.

## Ansvar på sagen · F02

Hovedansvarlig, yderligere ansvarlige og IT-konsulent vælges blandt kommunens registrerede, aktive konsulenter og administratorer. Valget gemmer personens stabile database-id; navn og arbejdsmail hjælper med at skelne personer i listen. Op til 20 yderligere ansvarlige gemmes som særskilte ID’er. Der er ét primært ansvar, som bruges i arbejdskøens filter. Tildeling ændrer ikke personens adgangsrettigheder eller ledermandat.

Serveren genkontrollerer person, kommune, aktiv status og kvalificerende rolle ved gemning. Samtidig deaktivering giver konflikt uden en delvist gemt vurdering eller historik. Et tomt hovedvalg fjerner tildelingen. Eksisterende tildeling bevares, når anmoderen genindsender en ny version.

Gamle tekster bliver ikke automatisk til personidentiteter. Et nyt navnebaseret kald kan kun matches til én entydig aktiv person; nye klienter bruger ID. Uændrede historiske angivelser kan bevares ved andre rettelser. Fratrådte personer kan ikke vælges på ny; en eksisterende tilknytning forbliver synlig indtil bevidst omfordeling. Historiske vurderinger omskrives ikke.

Personlisten er et internt opslag i portalens registrerede konti. Tilslutning til kommunens autoritative person-/organisationskilde, afdelingsopslag og en accepteret fratrædelsesprocedure er fortsat åbne under F02/R05. Leverancen påstår ikke, at disse eksterne kilder er tilsluttet.

## Erstatning og tilkøb · F03

De to relationer kan vælges i det eksisterende systemkatalog. Det valgte katalog-id, navn og tekniske revision følger kladden og den indsendte version. En ukendt eller ændret katalogpost afvises ved indsendelse med vejledning om at vælge igen. Et system uden katalogpost kan angives manuelt med en begrundelse.

Skift af relevante styrende svar rydder relationer, der ikke længere gælder. Gamle tekstsvar vises fortsat; ved ny indsendelse skal relationen bekræftes som katalogvalg eller manuel angivelse. Eksisterende indsendte snapshots og gemte kvitteringer bevares.

Kildens opdateringsdato er ikke dokumenteret. Brugerfladen siger derfor, at datoen er ukendt. En teknisk revision viser ændringer i de lokale katalogdata; den er ikke dokumentation for KITOS-kildens aktualitet. Katalogejer, opdateringskadence og kildeaccept står stadig åbne.

## Konsulentens arbejdsfiltre · F10

| Filter | Definition |
| --- | --- |
| Afventer leder | En åben godkendelsesanmodning på den aktuelle ansøgningsversion med gyldig frist og gyldigt ledermandat. |
| Mangler oplysninger | Sagen står eksplicit i `changes_requested`, så anmoderen kan rette. Et afslag alene placerer ikke sagen her. |
| Ufordelte | Sagen har ingen primær ansvarlig. En inaktiv, tidligere ansvarlig tæller fortsat som tildelt og kræver bevidst omfordeling. |
| Mine sager | Den aktuelle bruger er primær ansvarlig, identificeret ved provider og subject; et ens visningsnavn er utilstrækkeligt. |

En åben lederanmodning låser fortsat den interne vurdering, også når fristen eller mandatet er udløbet eller anmodningen vedrører en gammel version. Overblik → Ledergodkendelse har en eksplicit tilbagekald-knap, som bruger den eksisterende serverkontrol og opdaterer sagen. Besluttede anmodninger ændres ikke. Det interne request-id udleveres kun til konsulent/admin; tildeling giver ingen nye rettigheder.

Arbejdsstatus og ansvar kombineres med søgning og fase. CSV bruger præcis den filtrerede liste og beholder beskyttelsen mod regnearksformler. Nulresultater vises tydeligt, og filtrene kan nulstilles. Kommunegrænsen kontrolleres servermæssigt og igen i filtreringen.

## Roller · F23

Den eksisterende rollemodel er bevaret, indtil procesvalget er afklaret:

| Handling | Bruger | Konsulent | Kommunal admin |
| --- | --- | --- | --- |
| Opret egen ansøgning | Ja | Nej | Ja |
| Læs egne ansøgninger | Ja | Som del af kommunens sager | Ja |
| Behandl kommunens sager | Nej | Ja | Ja |
| Redigér portalindhold | Nej | Nej | Ja |
| Administrér en anden kommune | Nej | Nej | Nej |
| Træf lederbeslutning | Kræver særskilt aktivt ledermandat | Samme krav | Samme krav |

Forslaget er, at konsulenter også må oprette ansøgninger, men hverken behandle eller se intern behandling på egne sager. Det omfatter serverens læse- og skrivegrænser, ikke kun skjulte knapper. Admin skal følge samme egenbehandlingsregel. Forslaget er endnu ikke aktiveret eller registreret som kommunalt accepteret.

Lederflowets nuværende link bekræfter den valgte leders mandat, men kræver ikke login hos den person, der klikker. En stærkere identitetskontrol er et særskilt R05/R06-forløb. Personlisten i denne etape ændrer ikke det forhold.

## Prøver og accept

Serverprøver dækker samme navne, forskellige identitetsudbydere, to kommuner, inaktive personer, historiske værdier, rydning, genindsendelse og samtidige ændringer. Katalogprøver dækker gamle tekstsvar, manuel begrundelse og ændret katalogrevision. Browserprøver gemmer/genindlæser personvalg, kombinerer filtre og sammenholder den viste liste med CSV. F02, F03 og F23 lukkes ikke organisatorisk af disse lokale prøver.
