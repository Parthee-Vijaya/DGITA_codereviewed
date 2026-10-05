# HTML-kvittering og tagget PDF-prototype (K06)

## HTML i portalen

Sagens kvitteringsknapper omfatter nu en HTML-visning på `/cases/{caseNumber}/receipt`. Visningen kræver portal-login og anvender samme serverfunktion til kommune-/ejerafgrænsning som PDF-kvitteringen. URL'en omdirigeres til et eksplicit `kind` og `version`; et versions-id fra en anden sag afvises. En almindelig bruger ser kun egne sager, mens konsulenter og administratorer fortsat er afgrænset til deres kommune.

HTML viser det låste `portal_application_versions.snapshot_json`, kontrolleret mod versionens gemte SHA-256. Formularafsnittene er fælles med den eksisterende PDF-renderer. En senere aktuel version ændrer ikke en tidligere versionsbundet URL. Visningen bruger overskrifter, beskrivelseslister, danske navne, tastaturfokus og tekstombrydning. React escaper sagsindholdet. Svaret er dynamisk og har `Cache-Control: private, no-store, max-age=0` samt `X-Robots-Tag: noindex, nofollow, noarchive`.

Lederkvitteringen kræver præcis én afsluttet beslutning for den pågældende version. En tvetydig ældre historik med flere afsluttede lederbeslutninger afvises; visningen vælger eller omskriver ikke en beslutning. Den afsluttende D-GITA-kvittering kræver en lukket sag og den versionsbundne godkendelsesrække. Beslutningskommentar og sagsbehandlerens gemte `updatedBy` anvendes først efter afslutning; den eksisterende servervalidering afviser senere redigering af en lukket sag. Aktuelle profilnavne og øvrige interne felter indgår ikke i HTML. Kontaktnavn fra den oprindelige ansøgning bevares i snapshotsektionerne.

HTML-visningen opretter ingen PDF, skriver ingen Blob og ændrer ingen eksisterende kvitteringshash. PDF-linket sender samme `kind` og `version` til den eksisterende PDF-rute. Et browserregressionsforløb bekræfter samme PDF-bytes og hash før og efter et HTML-besøg. HTML-layout kan forbedres senere; det er sagsversionen og den afsluttede beslutning, som er fastholdt, ikke en gemt kopi af HTML-bytes.

### Kendt begrænsning i eksisterende PDF

Den eksisterende PDF-renderer kan hente anmoderens/sagsbehandlerens aktuelle profilnavn ved førstegenerering eller gendannelse af en manglende Blob. En allerede gemt PDF er fortsat hashbeskyttet. Dette arbejde omskriver ikke historiske PDF-filer og ændrer ikke deres format. HTML undgår denne mutable profilmetadata. En eventuel ændring af den eksisterende PDF's kilde til profilnavne skal ske som en særskilt, versionsstyret ændring.

## Særskilt PDF-prototype

`features/receipt/tagged-pdf-prototype.ts` er en udviklingsprototype, som ikke kaldes fra produktionsruter, outbox eller den eksisterende PDF-renderer. Den forbruger det samme `ReceiptView`, returnerer bytes og gemmer dem ikke. Den har:

- dokumentsprog `da-DK`, dokumenttitel og eksplicit prototypebeskrivelse;
- `StructTreeRoot` med `Document`, H1, H2, P og Link i læserækkefølge;
- markeret tekst med MCID og Unicode `ActualText`, komplet `ParentTree` samt MCR-referencer til de korrekte sider;
- tab-rækkefølge efter struktur og en linkannotation med `StructParent`/OBJR til den præcise HTML-version, som fortsat kræver login;
- tekstombrydning, lange ord og sidebrud uden lydløs afkortning.

Prototypen bruger PDF-standardfonte, som ikke er indlejret. Tegn uden for fontenes tegnsæt giver en eksplicit fejl i stedet for ændret sagsindhold. Den udgiver sig ikke for at overholde PDF/UA og indsætter ingen PDF/UA-identifikator. Før et produktionsformat kan vælges, skal der tilføjes egnet fontdækning og indlejring, køres en uafhængig PDF/UA-validator og foretages dokument-/skærmlæseraccept. En strukturtest alene beviser ikke, at et dokument fungerer med et konkret hjælpemiddel.

## Verificeret lokalt

- `tests/receipt-access.test.mjs`: seks isolerede databasetests dækker ejer/kommune/version, hashafvisning, ingen PDF-mutation, historisk version efter ny aktuel version samt låst beslutning, ændret profilnavn og afvisning af tvetydig beslutningshistorik.
- `tests/receipt-view.test.mjs`: fire tests dækker HTML-escaping/dataminimering, endelige beslutninger, flersidet strukturtræ med samtlige MCID-/MCR-/linkreferencer og afvisning af usikre destinationer eller ikke-understøttede tegn.
- Browserforløbet i `tests/a11y/application.spec.ts` bruger en faktisk lokal sag og lederbeslutning, åbner den kanoniske HTML-kvittering, kontrollerer adgangs-/cacheheaders, kører axe og bekræfter uændrede PDF-bytes.
- Next-produktionsbuild er gennemført. En syntetisk PDF på to sider er rasteriseret med Poppler og begge sider visuelt kontrolleret for indhold/ombrydning. `pdfinfo` rapporterede `Tagged: yes`, `Suspects: no`, `JavaScript: no` og A4.

Automatisk axe-, tastatur-, struktur- og renderkontrol er udført. Manuel VoiceOver/NVDA/JAWS-accept, PDF/UA-validering og kommunal miljøaccept er endnu ikke udført. Testadgang og eksisterende produktions-PDF-flow er bevaret.

## Kildegrundlag

[W3C PDF3: korrekt læse- og tab-rækkefølge](https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF3) og [PDF16: dokumentsprog](https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF16) beskriver de relevante dokumentegenskaber. [PDF Association: Logical Structure Objects](https://pdfa.org/download-area/cheat-sheets/LogicalStructureObjects.pdf) beskriver relationerne mellem strukturtræ, MCID, ParentTree og annotationer. Disse kilder er designgrundlag; de er ikke en certificering af prototypen.
