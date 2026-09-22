# Drift og gendannelse – pilotgrænse

## Nuværende evidens

Fase 1–25 har dokumenteret CI og afgrænset online-verifikation. Fase 23: access-500 er NOT_REPRODUCED med lokal diagnostik; tablet NOT_RUN; tidligere fysisk QR-kontrol genbrugt. Fase 25: positiv hosted forecast-preview og komplekse scenarier NOT_RUN på tomt datagrundlag. Lokale diagnostik-/menuændringer er ikke automatisk en del af main. Foto er deaktiveret. Frontend har kun lokal HTTPS på Mac, ikke en dokumenteret offentlig pilotadresse.

Fase 26 samler en ny tværgående syntetisk test, afgrænset lokal belastning og recovery-prøve. Dette er ikke fuld produktionscertificering. Se [resultater og testomfang](phase-26.md).

## Backup: kræver faktisk driftsprocedure før pilot

Supabase-organisationen er på Free. Der må ikke antages automatiske daglige backups/PITR på denne plan. [Supabase anbefaler regelmæssig eksport og separat opbevaring for Free](https://supabase.com/docs/guides/platform/backups). En planopgradering er ikke foreslået eller aktiveret.

Før pilot skal følgende dokumenteres med en faktisk prøve og ejerens accept:

1. Ansvarlig operatør, backupfrekvens og opbevaringstid. Forslag til acceptmål: højst 24 timers datatab (RPO) og gendannelse inden for 4 timer (RTO); målene er endnu ikke aftalt eller målt hosted.
2. Backup til eksisterende, adgangsbegrænset og krypteret opbevaring uden for databaseværten; ingen dumps i Git, chat, CI-artifacts eller frontend. Omfang og ekstern udgift vurderes før eksport. Ingen nye betalte tjenester oprettes automatisk.
3. Medtag app/app_private-data, schema, funktioner, policies, grants, rolletilhørsforhold og sekvenser; Auth-identiteter skal kunne genskabes med samme UUID'er. Afstem den konkrete Supabase-eksportprocedure før brug: app_backend er med vilje for begrænset til fuld backup, og managed Auth/Storage kan ikke behandles som almindelige egne schemas.
4. Runtime-secrets, brugerdefinerede rollepasswords, Supabase-konfiguration og Railway-indstillinger skal kunne genskabes fra separat sikker opbevaring. Databasebackup er ikke en kopi af deploymentkonfigurationen. Custom-role passwords er ikke med i Supabase-downloadbackups.
5. Storage-databaseposter er kun metadata, ikke filindhold. Ingen fotobackup eller filgendannelse påstås testet; fotos er deaktiverede. Før eventuel senere fotoaktivering kræves særskilt objektbackup/adgangsprøve.
6. Gem timestamp, kildens version, filstørrelse og checksum. Restore altid først til et isoleret, tomt, godkendt mål; aldrig overwrite/reset af det eksisterende hosted projekt. Ny hosted testinstans kræver særskilt godkendelse.
7. Kontroller dataantal/hash, journal mod saldo, reservationer, historik, RLS/ACL, medlemskaber og roller. Kræv nyt login efter restore: backup kan indeholde gamle sessions/revokationsdata. Test virksomhed A/B og genforsøg af tidligere bogføringer uden dubletter. Mål faktisk datatab og varighed.

Den automatiske lokale recovery-prøve bruger fuld native PostgreSQL dump/restore og roller i **to separate lokale instanser**, men kun syntetiske Auth-tabeller. Den dokumenterer database- og applikationsintegritet, ikke en komplet Supabase-platformgendannelse. Primærreferencer: [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

## Fejl og rollback

- Ved fejl: registrer tidspunkt, route, HTTP-status og requestId. Del aldrig token/password eller rå databaseforbindelsesstrenge. Brug Railway-forbindelsen til aktiv commit/status og relevante logs.
- Health/live betyder kun, at processen svarer. Health/ready skal også være 200. Login/session og virksomhedstilladelser skal kontrolleres separat.
- Ved access-500: brug eksisterende `ACCESS_FAILURE:`-diagnostik hvis den lokale opsætning har den. Ingen bred genanalyse uden konkret hændelse; tidligere NOT_REPRODUCED ændres kun ved ny evidens.
- Stop berørte skriverutiner ved mistanke om inkonsistens. Ret ikke journalhistorik med direkte UPDATE/DELETE; brug eksisterende modsatrettede posteringer og dokumenter årsag.
- Applikationsrollback skal pege på en kendt kompatibel commit. Migrationer må ikke genkøres eller rulles tilbage blindt. Fase 26 har ingen migration. Manuel deployment og alle handlinger uden sikker prisgrænse kræver særskilt afklaring/godkendelse.
- En lokal belastningsmåling siger ikke noget sikkert om hosted kapacitet. Ingen hosted loadtest eller automatisk pool-/replica-/RAM-forøgelse er autoriseret.

## Pilot og UI/UX

Før pilot skal den faktiske backup-/restoreprocedure, den valgte frontendadgang og accepterede testafgrænsninger være afklaret. Slutstatus skal gennemgås med brugeren. Ingen automatisk overgang til redesign, nye integrationer eller en ny fase.
