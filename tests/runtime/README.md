# Lokal runtimekontrakt

`npm run build:next && npm run test:ci:next-e2e` starter den byggede Next-server i et nyt, midlertidigt workspace. Node kører i production-mode; applikationens miljø er udtrykkeligt pilot med testlogin og syntetiske data. SQLite-filen og alle fixtures slettes ved afslutning. Den byggede applikation ændres ikke for testen.

Node-preloaden `provider-dispatch.mjs` sender kun de fem navngivne providerhosts til en lokal HTTP-fixture og afviser øvrig outbound-fetch. Appens normale libSQL-, Blob-, scanner- og Graph-adaptere kører. Det kontrollerer transportkontrakten, scanning fail-closed, versionslåste bilag/PDF, godkendelse, afslutning, korrektion og mailkøen. Blob-delegation og Graph-accept er simulerede; dette beviser ikke cloudlagerets signaturvalidering, levering af mail eller kommunalt login. Ingen autentificerede cloudkald udføres.

`npm run test:ci:production` kører separat med produktionsmiljø uden forbindelser: liveness skal være 200, readiness 503, anonym sagsadgang 401 og testlogin 403. `npm run test:ci:e2e` fastholder forløbet på Cloudflare/vinext-isolatet. CI gemmer afgrænsede, syntetiske resultater i `work/ci/`.

`npm run test:ci:a11y` bruger samme Cloudflare-isolat til browserpakken. Chromium installeres i en særskilt cache og vælges med `PLAYWRIGHT_BROWSERS_PATH`; testene får samme friske approvalsecret som serveren. Runtimepakkens implementering kræver browserpakken fra K05 ved integration.
