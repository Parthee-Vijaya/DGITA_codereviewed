# Sessioner og tilbagekaldelse

## Tidsgrænser

`DGITA_SESSION_MAX_SECONDS` angiver den absolutte levetid, og `DGITA_SESSION_IDLE_SECONDS` angiver maksimal inaktivitet mellem aktive portalrequests. Begge er heltal fra 60 til 43200 sekunder; idle må ikke overstige den absolutte grænse. Ugyldige værdier afviser autentifikation, også hvis cookien stadig findes.

Pilotens standard er fortsat 12 timer, så testadgangen bevares. Produktion har et teknisk forslag på 12 timer absolut og 30 minutters inaktivitet. IAM/systemejer skal acceptere konkrete værdier før kommunal frigivelse. Der er ikke indført en kommunal beslutning via disse defaults.

Serveren kontrollerer både den gemte udløbstid, oprettelsestid, seneste aktivitet, tilbagekaldelse og den aktuelle bruger-/tenantstatus og rolle ved hver beskyttet request. En strammere konfiguration gælder også eksisterende sessioner. Aktivitet kan aldrig forlænge den absolutte udløbstid. `last_seen_at` opdateres højst én gang pr. minut (eller hvert kvarte idleinterval ved korte grænser); derfor kan oplevet idleudløb være op til dette interval tidligere end seneste request.

Automatisk notifikationspolling bruger `recordActivity: false`: en åben fane holder ikke sig selv i live. Nye passive poll-/heartbeatendpoints skal følge samme mønster. Serveren måler portalrequests, ikke fysisk tilstedeværelse eller lokale tastetryk; en formular med tekst, der endnu ikke er gemt, kan derfor udløbe. Konfigurér pilotforsøg og QA ud fra dette.

## Tilbagekald sessioner

Den autentificerede, originbeskyttede `POST /api/auth/sessions/revoke` modtager `{}` for egne sessioner eller `{"userId":"..."}` for en bruger i samme organisation. Sidstnævnte kræver administratorrolle. Endpointet er et operatør-API; adgangskontrol sker på serveren.

Alle eksisterende målbrugerens sessioner tilbagekaldes i samme transaktion som revisionshændelsen `auth.sessions_revoked`. Ved egne sessioner udløber svarets cookie også. Næste beskyttede request afvises. Tilbagekaldelse er ikke spærring af fremtidigt login: permanent brugerafgang kræver også deaktivering af den provisionerede bruger/IAM-livscyklus. Der skrives ikke tokens, cookies eller mailadresser i hændelsens payload.

## Tilbagekald lederlink

`DELETE /api/cases/{caseNumber}/approval-request` modtager `{"requestId":"..."}` og kræver konsulent/admin i samme organisation. ID kommer fra oprettelsen af anmodningen. API'et tilbagekalder det konkrete link; det opretter ikke et nyt link.

Tilbagekaldelse kan vinde før beslutningscommit, også efter at en beslutning midlertidigt er markeret `approving`/`rejecting`. Beslutningens eksisterende atomiske gate opdager det og opretter ingen beslutning, notifikation eller beslutningsmail. Efter committed beslutningsaudit returneres 409, og historikken bevares. Gentagen tilbagekaldelse er idempotent. En afventende aktuel sag går tilbage til `submitted`, så D-GITA kan sende en ny anmodning efter behov.

Kølagt/fejlet linkmail annulleres, og ubekræftet mailindhold neutraliseres. En mail under behandling beholder sin leveringsstatus, så usikker levering ikke fejlagtigt genafsendes. Mandatet kontrolleres igen før afsendelse. Et Graph-kald, der allerede er begyndt, kan ikke trækkes tilbage; linket i en eventuelt leveret mail er stadig ugyldigt.

## Verifikation

`features/auth/session-lifecycle.test.mjs` og `session-administration.test.mjs` dækker grænsetidspunkter, konfiguration, samtidige aktivitetsskrivninger, passiv polling, tenantisolering, auditrollback og selve session-endpointet. `features/approval/operator-revocation.test.mjs` dækker tilbagekaldelse før/efter både godkendelse og afvisning, versionsbevaring, scope, gentagelse og auditrollback. Eksisterende mandat-/outbox-racetests gælder fortsat.

Dette erstatter ikke rigtig Entra/MFA- og brugerafgangstest. Autentificeret ledergodkendelse bør afklares som produktionsvalg; de nuværende tidsbegrænsede bearerlinks bevares i pilot, og en ny loginvariant er ikke stiltiende indført.

En sagsversion med en allerede committet lederbeslutning kan ikke få en ny lederanmodning. Både forkontrol og den atomiske skrivebetingelse håndhæver dette; et samtidigt beslutningscommit kan ikke overskrives. En tilbagekaldt, ubesluttet anmodning kan erstattes. En ny beslutning kræver en ny sagsversion. Historiske beslutninger og PDF-filer omskrives ikke.

Testloginens lokale undtagelse kræver både lokal requestadresse og lokal konfigureret offentlig adresse. Vercel-runtime får aldrig localhost-undtagelsen. Dermed kan en reverse proxys interne HTTP-adresse ikke fjerne pilotens kodekrav; sessionscookies får `Secure`, når den betroede offentlige adresse er HTTPS eller miljøet er Vercel. Også cookieudløb bruger den samme politik.

Entra-status/start/callback accepterer Nexts interne HTTP-loopbackadresse alene, når requestens Host er identisk med den faste HTTPS-adresse i konfigurationen. Forwarded-headere vælger aldrig loginadresse; andre offentlige adresser, suffixer, porte og manglende Host afvises. Redirect, krypteret flowcookie, state/PKCE/nonce og provisionerede DB-roller forbliver bundet til den kanoniske konfiguration. Dette er lokalt afprøvet med signeret test-IdP og replayafvisning, ikke rigtig Entra-accept.
