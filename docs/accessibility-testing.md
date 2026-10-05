# Tilgængelighed: kode og testgrænse

K05 samler spørgsmål, beløbsfelter, upload og fejltekst i `features/application/ApplicationFields.tsx`. Native labels bevares, custom beløbsfelter får eget tilgængeligt navn, og hjælpetekster/fejl kobles med id'er. Trinskift flytter fokus til trinoverskrift; validering til fejloversigt. Uploadlisten har en vedvarende høflig live-region. Tutorialen bevarer fokusfælden og returnerer til profilknappen, når den oprindelige menuknap er fjernet. Godkendelsessiden fokuserer fejl eller gemt beslutning, bruger samme tidszone ved server-/klientrendering og aktiverer først beslutningsknapper, når klientens handlers er klar.

## Automatiske prøver

- Node 24 og `npm ci` fra lockfil. Browserafhængigheder: Playwright og axe-core.
- `npx playwright install chromium` installerer den låste browsers version.
- `DGITA_E2E_BASE_URL=http://127.0.0.1:<port> npx playwright test` kræver en isoleret lokal pilotserver med friske syntetiske data og samme midlertidige `DGITA_APPROVAL_TOKEN_SECRET` i server/testproces. Config afviser andre værter. CI-runneren ejer opstart, miljø og oprydning.
- `npx tsx --test tests/application-fields.test.mjs tests/interface-controls.test.mjs` kontrollerer feltnavne og id-relationer; `npm test` bygger og kører hele den eksisterende regressionstestpakke.

Browserprøverne dækker pilotlogin, alle ti formulartrin, beløbsfejl, radio-piletaster og ét tabstop, slutvalidering, forkert uploadtype, tutorialens Tab/Shift-Tab/Escape/fokusretur samt en faktisk indsendelse og ledergodkendelse med fejlkorrektion via tastatur. Formularprøverne bruger en syntetisk draft-/approverfixture med mocket persistence; lederprøven bruger lokal API, DB og midlertidigt bearerlink. Mockede UI-prøver er ikke bevis for cloudintegration. Browseren bruger Europe/Copenhagen for at opdage server-/klientforskelle.

Axe køres efter afsluttede, tidsbegrænsede CSS-overgange på login- og godkendelsessiderne, formularens indholdsområde og tutorialdialogen med WCAG 2.0/2.1 A/AA-tags, uden regelundertrykkelse. Resultater beskriver dette scope. De er ikke en fuld vurdering af øvrig portal, PDF, faktisk hjælpemiddelteknologi eller WCAG-overensstemmelse. Playwright rapporterer regel-id og selector frem for sagsindhold. Trace og video er slået fra. Reflow-/fokusprøver gemmer kun et screenshot ved fejl; øvrige screenshots er slået fra; CI skal kun anvende syntetiske identiteter og kortvarige testcredentials. Fejllogs kan stadig indeholde syntetiske test-URL'er og skal håndteres som testartefakter med begrænset opbevaring.

### Smal visning: 320 CSS-pixels

To ekstra Chromiumforløb bruger en viewport på 320 × 800 CSS-pixels. Det afprøver reflow ved den samme layoutbredde, som et 1280-pixelvindue har ved 400 % zoom. Browserens egentlige zoomfunktion, andre skærmhøjder og hjælpemidler er ikke afprøvet her.

Formularprøven gennemløber alle ti trin sekventielt med Enter på Fortsæt, kontrollerer axe og vandret overflow på hvert trin og måler, at den fokuserede overskrift er synlig under den faste topbjælke. Slutvalideringen skal vise og fokusere fejlen; Space markerer samtykke, og den native tab-rækkefølge fører til indsendelse. Denne UI-prøve bruger den beskrevne forudfyldte syntetiske draftfixture og mocket persistence. Den er ikke en manuel udfyldning af enhver betinget feltkombination.

Kvitteringsprøven opretter en faktisk lokal sag via API, læser dens versionsbundne HTML ved 320 pixels, ombryder en lang ubrudt reference og kontrollerer Tab/Shift-Tab, PDF-download via Enter samt retur til sagen. Den omfatter hele den viste HTML-side med axe.

Prøverne fandt og rettede formularens vandret rullende trinnavigation, en lang trinoverskrift som udvidede grid-layoutet samt fokus, der blev skjult af topbjælken eller flyttet ud af syne efter ændret trinhøjde. Navigationen ombrydes nu i kolonner, formularen kan krympe og ombryde lange ord, og fokusskift sker efter layout med plads til topbjælken. De konkrete regressioner måler også indhold, som ellers kunne være skjult af en ancestors overflow-regel. Ved reflow-/fokusfejl vedhæftes et screenshot af de syntetiske testdata til Playwright-resultatet.

## Manuel accept står åben

Der er ikke udført en egentlig VoiceOver/NVDA-accept i denne kodepakke. Den kommunale test skal dokumentere navngiven browser/skærmlæser, version, dato og tester samt fulde forløb for anmoder, leder og sagsbehandler. Kontrollér fokusorden og synlig fokusmarkering, navne/roller/værdier, fejl- og statusannoncering, navigation uden mus, zoom/reflow, kontrast og PDF-læserækkefølge. Afprøv også afvisning/rettelse, timeout, udløbet/tilbagekaldt link og fejl i eksterne tjenester. Automatiske fund og menneskelig vurdering registreres hver for sig.

Kilder: [W3C om evaluering](https://www.w3.org/WAI/WCAG22/Understanding/conformance), [Playwrights tilgængelighedstest](https://playwright.dev/docs/accessibility-testing), [W3C fokusorden](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html). Det gældende retlige scope og standardversion accepteres særskilt af kommunen.
