# Tilgængelighed: kode og testgrænse

K05 samler spørgsmål, beløbsfelter, upload og fejltekst i `features/application/ApplicationFields.tsx`. Native labels bevares, custom beløbsfelter får eget tilgængeligt navn, og hjælpetekster/fejl kobles med id'er. Trinskift flytter fokus til trinoverskrift; validering til fejloversigt. Uploadlisten har en vedvarende høflig live-region. Tutorialen bevarer fokusfælden og returnerer til profilknappen, når den oprindelige menuknap er fjernet. Godkendelsessiden fokuserer fejl eller gemt beslutning, bruger samme tidszone ved server-/klientrendering og aktiverer først beslutningsknapper, når klientens handlers er klar.

## Automatiske prøver

- Node 24 og `npm ci` fra lockfil. Browserafhængigheder: Playwright og axe-core.
- `npx playwright install chromium` installerer den låste browsers version.
- `DGITA_E2E_BASE_URL=http://127.0.0.1:<port> npx playwright test` kræver en isoleret lokal pilotserver med friske syntetiske data og samme midlertidige `DGITA_APPROVAL_TOKEN_SECRET` i server/testproces. Config afviser andre værter. CI-runneren ejer opstart, miljø og oprydning.
- `npx tsx --test tests/application-fields.test.mjs tests/interface-controls.test.mjs` kontrollerer feltnavne og id-relationer; `npm test` bygger og kører hele den eksisterende regressionstestpakke.

Browserprøverne dækker pilotlogin, alle ti formulartrin, beløbsfejl, radio-piletaster og ét tabstop, slutvalidering, forkert uploadtype, tutorialens Tab/Shift-Tab/Escape/fokusretur samt en faktisk indsendelse og ledergodkendelse med fejlkorrektion via tastatur. Formularprøverne bruger en syntetisk draft-/approverfixture med mocket persistence; lederprøven bruger lokal API, DB og midlertidigt bearerlink. Mockede UI-prøver er ikke bevis for cloudintegration. Browseren bruger Europe/Copenhagen for at opdage server-/klientforskelle.

Axe køres på login- og godkendelsessiderne, formularens indholdsområde og tutorialdialogen med WCAG 2.0/2.1 A/AA-tags, uden regelundertrykkelse. Resultater beskriver dette scope. De er ikke en fuld vurdering af øvrig portal, PDF, faktisk hjælpemiddelteknologi eller WCAG-overensstemmelse. Playwright rapporterer regel-id og selector frem for sagsindhold. Trace, video og screenshot er slået fra; CI skal kun anvende syntetiske identiteter og kortvarige testcredentials. Fejllogs kan stadig indeholde syntetiske test-URL'er og skal håndteres som testartefakter med begrænset opbevaring.

## Manuel accept står åben

Der er ikke udført en egentlig VoiceOver/NVDA-accept i denne kodepakke. Den kommunale test skal dokumentere navngiven browser/skærmlæser, version, dato og tester samt fulde forløb for anmoder, leder og sagsbehandler. Kontrollér fokusorden og synlig fokusmarkering, navne/roller/værdier, fejl- og statusannoncering, navigation uden mus, zoom/reflow, kontrast og PDF-læserækkefølge. Afprøv også afvisning/rettelse, timeout, udløbet/tilbagekaldt link og fejl i eksterne tjenester. Automatiske fund og menneskelig vurdering registreres hver for sig.

Kilder: [W3C om evaluering](https://www.w3.org/WAI/WCAG22/Understanding/conformance), [Playwrights tilgængelighedstest](https://playwright.dev/docs/accessibility-testing), [W3C fokusorden](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html). Det gældende retlige scope og standardversion accepteres særskilt af kommunen.
