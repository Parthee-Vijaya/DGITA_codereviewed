# Enkel AI-screening (F17)

Formularens eksisterende trin 6, **Risiko & data**, indeholder AI-spørgsmålet. De ti trin og de eksisterende komponenter, farver og typografi bevares.

- `aiUsage`: `ja`, `nej`, `ved-ikke` eller tomt/udeladt. En ny indsendelse kræver et eksplicit svar. “Ved ikke” giver vejledning om at kontakte kommunens digitaliserings- eller AI-ansvarlige.
- `aiPurpose`: manuel beskrivelse af opgaven, brugerne og anvendelsen af resultatet; obligatorisk ved Ja/Ved ikke, højst 4.000 tegn. Feltet udfyldes aldrig automatisk.
- `aiAssessmentUrl`: valgfrit link til kommunens aktuelle vurdering af anskaffelsen, højst 2.048 tegn. En indsendelse tillader kun HTTP(S)-links uden brugernavn, adgangskode eller kontroltegn. Linket hentes ikke af systemet.

Gamle `dgita-v1`-kladder kan stadig gemmes uden felterne. Ved læsning vises manglende historiske svar som **Ikke besvaret**, aldrig Nej. Der foretages ingen datamigrering eller omskrivning af tidligere indsendelser. Hvis en historisk version åbnes til rettelser, skal AI-spørgsmålet besvares før den nye version indsendes.

Ved skift til Nej ryddes formål og link i formularen. Serverens eksisterende beskæring fjerner felterne fra indsendelsen, også hvis en klient sender skjulte værdier. Kladdelagring tillader ufærdige tekstsvar og links; serverens fælles indsendelsesvalidering afviser ugyldige aktive links. Aktive hyperlinks i sagsvisningen skal bruge `isSafeAiAssessmentUrl`.

Screeningen er en oplysning til faglig afklaring. Den udfører ingen AI-kald, juridisk klassifikation, risikoklassifikation eller automatisk godkendelse. Kommunens faglige ansvarlige fastlægger yderligere dokumentation, modtagere og godkendelser. Lokale vejledningslinks er ikke opfundet.

Lokale enheds-, API- og browserprøver omfatter legacy-læsning, indsendelseskrav, ugyldige links, skjulte svar, manuel beskrivelse, gem/genoptag, tastatur og tilgængelighed. Disse prøver er ikke kommunal eller juridisk accept.

Verificeret lokalt den 9. oktober 2026 med Node 24: 42 målrettede enheds-/API-prøver og 2 browserprøver mod det isolerede syntetiske miljø. Browserprøverne dækker også sagsvisningens vurderingslink, særskilte filtre for Ja/Nej/Ved ikke/ubesvaret og CSV af de filtrerede sager. Automatisk tilgængelighedskontrol af formulartrinnet fandt ingen overtrædelser; desktop og mobil er gennemset visuelt. Typekontrol og lint er kørt på ændringen.
