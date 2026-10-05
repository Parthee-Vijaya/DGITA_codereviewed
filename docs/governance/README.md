# Kontroller, ansvar og releaseevidens

[Kontrolregisteret](control-register.json) beskriver 15 udvalgte risici og deres kontrol, implementering, testhenvisning, foreslåede ejer, reviewdato og restopgave. Det er et teknisk bidrag til kommunens governance. Det er ikke et fuldt kontrolkatalog, et ISO-certifikat, en NIS2-afgørelse eller en produktionsgodkendelse.

Alle organisatoriske acceptfelter står som `U`: ukendt eller ikke dokumenteret accepteret. Ejere er funktioner, der foreslås udpeget; ingen navngiven person tillægges en godkendelse. `technical_record_date` er datoen for registerarbejdet, mens `human_review_date` er tom. Kommunens CISO/systemejer skal indplacere kontrollerne i det faktisk vedtagne scope, udpege ejere, følge op på afvigelser og gennemføre øvelser. [ISO beskriver et organisatorisk ISMS](https://www.iso.org/standard/27001), og [SAMSIK har en særskilt kommunal NIS2-vejledning](https://samsik.dk/wp-content/uploads/2025/07/Vejledning-til-kommuner-om-NIS-2-loven.pdf). Registeret foretager ingen generel konklusion om alle kommuners direkte omfattelse.

Dataminimering indgår gennem [feltfortegnelsen](../privacy/data-inventory.json) og de konkrete K07-kontroller. De skal anvendes sammen med kommunens beslutninger om formål, hjemmel, information og bevaring. [Datatilsynets designvejledning](https://www.datatilsynet.dk/regler-og-vejledning/behandlingssikkerhed/databeskyttelse-gennem-design-og-standardindstillinger). Tilgængelighed kræver særskilt vurdering af relevante web-/dokumentkrav og faktisk afprøvning; automatiske tests er kun en del af evidensen. [DIGST om lovgivning](https://digst.dk/tilsyn/webtilgaengelighed/lovgivning/). Kilder læst 5. oktober 2026; den fulde ISO-standard er ikke gennemgået.

## Generér redigeret evidens

Kør med repositoryets Node 24 og installerede dependencies fra en ren, committet kilde:

```sh
node scripts/release-evidence.mjs
```

Generatoren kører de udtrykkeligt valgte lokale `privacy`- og `governance`-tests via Node-testevents. Den skriver `work/release-evidence/release-evidence.json` og `control-evidence.csv`. Filerne er ignorerede af git og egner sig til en særskilt CI-artifact eller reviewpakke. Generatoren aktiverer ingen deployment og kontakter ingen kommunal service. Der videresendes ikke app-/providercredentials eller `NODE_OPTIONS` til de afgrænsede testprocesser.

`--suite privacy` eller `--suite governance` måler kun den valgte suite. `--references-only` giver et registerudtræk uden at køre tests; det kan også bruges på en ændret worktree og markerer denne som uren. Målte resultater kræver ren kilde og gemmer eksakt commit samt SHA-256 af registeret. Kildeidentiteten kontrolleres igen efter testene. En mislykket/ufuldstændig suite giver en ikke-bestået måling og procesexit 1.

| Evidensfelt | Betydning |
| --- | --- |
| `reference_only_not_run` | Testfilen findes som henvisning. Generatoren har ikke kørt den. |
| `executed_in_selected_suite` | Filen indgik i en faktisk valgt testkørsel; det tilknyttede resultat gælder hele suiten. |
| `measurements[].counts` | Faktiske tællere fra Node-runnerens samlede testevent, ikke tal indtastet i registeret. |
| `control_acceptance: not_assessed` | En bestået suite accepterer ikke automatisk hele kontrollen. |
| `external_acceptance: U` | Cloudintegration, kommunal drift og organisatorisk accept er ikke verificeret. |

Reporteren fjerner testnavne, assertion-detaljer, stdout, stderr og rå fejl. JSON/CSV indeholder kun kildeidentitet, tilladte repo-stier, kontrol-id'er, tællere, varighed og faste statusfelter. Fritekst fra registeret, miljøværdier, URL-er og navngivne data kopieres ikke ind i artefakten. Canarytesten afprøver også en faktisk fejlende child-test med syntetisk navn/log/fejlindhold. Rå backup, sager, headers og auth-data må fortsat ikke gives til generatoren. Applikationens øvrige CI-output/platformlogs skal kontrolleres særskilt.

Dette erstatter ikke build/lint/typecheck, fuld regression, live GitHub-kontrol, dependency-audit, eksakt SHA-SARIF, browser-/skærmlæsertest eller ekstern driftsaccept. Der findes ingen indlæsning af vilkårlige eksterne JSON-logs som automatisk godkendt testbevis. Når nye suites tilføjes, skal deres isolation, redigering og registerkobling gennemgås.

## Beslutning og opfølgning

Den historiske vurdering er 40/100. 52/100 er en betinget teknisk målsætning; generatoren ændrer ingen score. Samlet ISO/ISMS og NIS2 forbliver på niveau 1, indtil der er en udpeget ejer og afprøvet proces. Organisatorisk U er uændret af nye dokumenter eller grønne lokale tests. Før en score genvurderes, sammenholder ansvarlig reviewer faktisk test-/miljøevidens med dimensionens fulde scope.

Brug [hændelsesøvelsen](incident-exercise.md) til at gå fra dokument til afprøvet proces. Registeret skal opdateres ved release, ændret risiko/leverandør, hændelse og review. Ved dokumenteret ejerudpegning eller organisatorisk accept skal register-/evidensschemaet udvides reviewet; den nuværende generator må ikke ændre U til accept ud fra fritekst.
