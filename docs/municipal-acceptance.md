# Kommunal miljøaccept — lokal forberedelse

Denne pakke gør acceptprøverne klar til udførelse. Den attesterer ikke et kommunalt miljø, en cloudplatform, juridisk efterlevelse eller produktion. Alle faktiske acceptresultater er **U — uafklaret**, og `productionApproved` er `false`.

Den maskinlæsbare skabelon er [environment-acceptance.json](governance/environment-acceptance.json). `local_ready_to_test` betyder, at scenarier og evidensfelter er forberedt. `external_acceptance` kræver særskilte prøver i det faktiske, isolerede miljø og en dokumenteret beslutning fra udpegede ansvarlige. Lokale syntetiske testresultater er forberedende beviser; de opgraderer aldrig automatisk en ekstern status.

## Før en previewtest

1. Fastlås en ren kandidats fulde SHA, dependency-lockhash, byggekommando, Node-version og artefaktdigest. Registrér immutable deployment-id/URL. Resultater fra en tidligere SHA kan ikke være den endelige kandidats acceptbevis.
2. Registrér den gamle pilots deployment, aliaser og ufølsomme funktionstilstand. Den skal være bevaret efter prøven. Undgå ændringer i dens projektsettings, credentials, data og domæner.
3. Vælg en entydig, isoleret previewkonfiguration med syntetiske data, egne database-/private lagerressourcer og egne secrets. Skabelonen indeholder ingen envværdier. Ressourceidentiteter kontrolleres i et godkendt bevislager uden at kopiere credentials til repoet.
4. Bekræft public origin, adgangskode til offentlig pilot, cookiepolitik og deploymentbeskyttelse. En intern Next-loopbackadresse må ikke omgå kravene til den offentlige preview. Fjendtlig Origin og manglende Origin på skrivninger skal afvises.
5. Brug en særskilt godkendt testmodtager, hvis maillevering faktisk afprøves. Lokal Graph-fixture viser providerkontrakten, ikke levering af en mail eller kommunens mailbox-afgrænsning.

## Den konkrete Vercel-begrænsning

Read-only kontrollen 5. oktober 2026 viste kun production/development-variablemetadata for det eksisterende `dgita`-projekt; ingen preview-variablemetadata. Værdier blev ikke dekrypteret eller kopieret. Core-kandidaten havde ikke lokal `.vercel`-projektbinding. Lokal CLI-autentifikation fungerede, men det beviser hverken korrekte previewressourcer eller autorisation til produktion.

Det eksisterende `.github/workflows/release-vercel.yml` henter **production**-konfiguration, bygger med `--prod` og uploader med `--prebuilt --prod --skip-domain`. Det gælder også workflowvalget `pilot`. `--skip-domain` ændrer ikke target til preview. Dette workflow må derfor ikke bruges som genvej til den nu autoriserede isolerede previewtest.

Previewforberedelsen kræver en eksplicit previewvej med entydigt projektvalg, isolerede forbindelser og beskyttet testadgang. Der må ikke køres promotion, production-pull, `--prod` eller ændring af den gamle pilots aliaser som en del af denne pakke. Der oprettes ingen betalt plan eller ny købsforpligtelse. [Vercels environments](https://vercel.com/docs/deployments/environments) og [cronbegrænsninger](https://vercel.com/docs/cron-jobs/usage-and-pricing) skal indgå i miljøvalget.

## Obligatoriske prøvespor

| Spor | Centrale prøver | Foreslået ansvarlig rolle |
|---|---|---|
| ENV-01, REL-01 | Pilot bevaret, isolerede ressourcer, præcis SHA og artefakt | Platform- og releaseansvarlig |
| AUTH-01–03, ACCESS-01 | Entra/tenant/roller, rolleafgang, aktive sessioner, offentlig pilotkode, negativ adgang | Identitets-, sikkerheds- og systemansvarlig |
| BLOB-01, SCAN-01 | Browserens presign/PUT/complete-forløb, private bytes, TTL, integritet, scannerfejl | Lager- og sikkerhedsansvarlig |
| MAIL-01, JOB-01, OPS-01 | Afgrænset Graph-adgang, faktisk levering, jobidentitet, overlap/retry, heartbeat og alarmer | Mail- og driftsansvarlig |
| REC-01, REL-02 | Isoleret restorekarantæne, checksums, rollback og datakompatibilitet | Drift og releaseansvarlig |
| A11Y-01–02 | Browser, tastatur, skærmlæser, versionsbundet HTML/PDF | Tilgængelighedsansvarlig og testbrugere |
| GOV-01–02, SEC-01 | Hændelse, retention, datakategorier, afhængigheder og restgæld | Data-/procesejer med relevante faglige reviewere |

Rollerne er forslag, ikke personudpegninger eller juridiske ansvarsplaceringer. Alle konkrete rolle-/beslutningsreferencer står uafklaret i JSON-filen.

## Lokale bevisers grænser

Det lokale Next-forløb afprøver et production-build i eksplicit pilottilstand med syntetiske providerfixtures. Det viser upload/scan, indsendelse, beslutning, kvittering, korrektion og mailbehandling lokalt. Den fulde API-test dækker både multipart `/api/uploads` og direkte `presign → Blob PUT → complete` med lokale HTTP-fixtures, inklusive ejer-/Origin-afvisning, checksumfejl og scannerfejl. Browserens CORS og den rigtige direkte providergren skal afprøves samlet i den valgte previewkonfiguration. Lokal Blob-signering er ikke cloudlagerets faktiske signaturvalidering.

Schedulerens fælles job har claim-/versionsbinding, tilbagekaldelseskontrol, recoverykarantæne, backoff og afvisning af blind genlevering. Dets 45 sekunder er et budget for nye claims efter oprydningen, ikke en garanteret samlet runtime. Vercels eksisterende daglige cadence er bevaret; den er ikke accepteret som responsiv mailservice. Faktisk køalder, interval, kapacitet, modtagelse af alarmer og manglende ticks skal måles i det valgte miljø. Preview-READY er ikke et cron- eller driftsbevis.

Browser-/axe-tests erstatter ikke tastatur- og skærmlæserprøver med aftalte hjælpemidler. En tagged-PDF-prototype er heller ikke i sig selv en godkendt produktions-PDF. Sletnings-/retention-dry-run giver ikke tilladelse til destruktiv sletning. En isoleret restore med karantæne er ikke en automatisk driftsgenåbning.

## Registrering og beslutning

Hvert scenarie skal have kandidat-SHA, artefakthash, miljøreference, tidspunkt, udførende rolle, redigerede evidensreferencer, forventet og observeret resultat samt en særskilt reviewerbeslutning. Godkendte beviser får kontrolsum og redaktionsreview. Tokens, envværdier, aktive bearerlinks, sessioncookies, produktionsdokumenter og rå persondata må ikke gemmes i denne pakke.

Statusserne er U (uafklaret), P (bestået med reviewet miljøevidens) og F (fejl/afvist). En ikke udført prøve bliver ved med at være U. Alle obligatoriske miljøscenarier skal have accepteret evidens for den samme kandidat og det samme miljø, før den ansvarlige beslutning om produktion kan registreres. Dokumentet giver ingen juridisk certificering og ændrer ikke `productionApproved=false`.
