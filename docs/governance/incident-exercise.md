# Øvelse: leverandørsvigt og mistænkt dokumenthændelse

**Status:** klar til afprøvning; ingen kommunal øvelse registreret. Gennemføres på syntetiske testsager i et isoleret testmiljø. Ingen rigtige brugere, credentials eller dokumenter må indgå i generel øvelsesevidens. Automatisk teknisk fault injection er ikke en ledelses-/vagtøvelse.

**Foreslåede deltagere:** systemejer, kommunal CISO/beredskabsansvarlig, drift/SOC, IAM/Exchange, leverandørkontakt og dataansvarlig med DPO-rådgivning. Udpeg øvelsesleder, beslutningstager og referent før start. Der er ikke udpeget eller kontaktet nogen af disse af repositoryet.

## Forberedelse

Registrér release-SHA, miljøtype, kontrol-id'er C02/C05/C10/C11/C14/C15, testtidspunkt og teknisk observer. Bekræft syntetiske data, blokeret udgående mail uden for testmodtager, isoleret DB/storage og en kendt tilbageførselsvej. Fastlæg midlertidige øvelsesmål og kontaktvej; de er ikke et vedtaget produktionsservicemål. Beslut hvem der må stoppe writes, rotere secrets og bestille gendannelse.

## Forløb

1. **Scanner-timeout.** Lad en testadapter undlade at svare. Verificér, at produktionspolitikken ikke frigiver bilaget eller den tilknyttede version. Notér faktiske timestamps, afvisningsklasse og om en testalarm modtages. Manglende alarm er et åbent fund.
2. **Uklar maillevering.** Simulér transporttimeout efter request. Verificér køens tilstand og at en uklar levering ikke blindt genafsendes. Drift beskriver, hvordan den afstemmes med udbyderen; en testdouble er ikke bevis for Graphs faktiske levering.
3. **Mandat tilbagekaldes.** Fjern et syntetisk mandat efter kølægning. Verificér, at senere PDF/token/afsendelse og beslutning afvises. IAM og systemejer beskriver og tidsmåler den autoriserede afgangsvej.
4. **Mistænkt databrud.** Øvelsesleder giver et fiktivt fund af en forkert modtager eller lækket link. Deltagerne beslutter afgrænsning, bevisbevaring, tilbagekaldelse, kontakt og vurdering af underretningspligter ud fra aktuelt scope. Ingen myndigheds- eller personunderretning afsendes af øvelsen.
5. **Gendannelse.** Genskab godkendt syntetisk DB-/filpakke i isoleret mål, kontroller hashes/versionshistorik og karantæne for sessioner/links/mail. Mål faktisk forløbstid og datatab; hvis værktøj eller backup mangler, registrér dette som ikke udført. En plan er ikke en bestået restore.
6. **Beslutning og opfølgning.** Hvert fund får foreslået ejer, frist, kontrol-id og nødvendig genafprøvning. Ledelse/risikoejer tager stilling til restopgaver efter faktisk mandat. Produktionen frigives ikke af dette manuskript.

## Redigeret referat

Gem kun øvelses-id, SHA, syntetisk miljøtype, tider/varigheder, kontrol-id, udført/ikke udført, forventet/faktisk status, beslutningsfunktion, aftalt opfølgning og link til et adgangsbeskyttet bevislager. Generel repo-evidens må ikke indeholde navne/mail, tokens, præcise interne ressourcer eller rå sags-/logpayloads. Faktiske godkendelser og personers mandat opbevares efter kommunens dokumentationspolitik; et foreslået ejernavn må ikke fremstilles som samtykke.

Afslut med ansvarlig reviewdato, accepterede resultater, ikke afprøvede dele og næste øvelse. Først derefter kan registeret få procesbevis og en eventuel ny vurdering. Hændelsens væsentlighed, modtagere og myndighedsfrister afgøres ud fra aktuelt regelsæt og kommunens konkrete scope; dette manuskript træffer ingen juridisk afgørelse.
