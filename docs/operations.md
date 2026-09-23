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

## Konkret afklaring efter Fase 26-deployment – 2026-09-22 (historisk plan)

Read-only metadata fra det eksisterende Supabase-projekt: PostgreSQL **17.6**, **15.510.675 bytes** database (ca. 15,5 MB, ikke en målt dumpstørrelse). Installerede extensions: pg_stat_statements 1.11, pgcrypto 1.3, plpgsql 1.0, supabase_vault 0.3.1 og uuid-ossp 1.1. Ingen forretningsrækker, passwords eller Vault-secrets er hentet. Work-miljøet har hverken Docker-runtime eller den nødvendige database-loginhemmelighed til en komplet pg_dump; MCP SQL-adgang er ikke i sig selv en komplet backupmekanisme.

### Anbefalet backupprøve uden nye hosted ressourcer

Backup fra det eksisterende hosted projekt og gendannelse på en isoleret **lokal** Supabase-kompatibel testinstans på operatørens Mac. Det er ikke restore til det nuværende produktionsprojekt og ikke en hosted-til-hosted katastrofeprøve. Den seneste godkendelse udelukker nye miljøer; det lokale mål skal derfor aftales, før det oprettes.

Konkret kræves:

1. Mac med plads til container-images og dump, en gratis container-runtime (fx Colima), Supabase CLI og en kompatibel PostgreSQL 17/Auth-basis. Docker Desktop må ikke antages gratis til enhver erhvervsbrug. Ingen installation foretages her.
2. Databaseadministratorens eksisterende session-pooler-forbindelse og password, indtastet lokalt og skjult; ingen passwordreset eller deling i chat. Backendens begrænsede app_backend-login er ikke tilstrækkeligt. TLS/CA-verificering bevares.
3. Adgangsbegrænset krypteret lokal opbevaring og en aftalt separat kopi på allerede tilgængelig krypteret opbevaring. Ingen automatisk betalt backupservice, Git-upload eller CI-artifact.
4. Rollen-, schema- og dataeksport med Supabase CLI samt særskilt migrationshistorik. Standard schema-dump udelader managed schemas; dataeksport/Auth-identiteter og eventuelle egne Auth/Storage-tilpasninger skal kontrolleres eksplicit mod de konkrete filer. Eksporter i en kort aftalt skrivepause eller brug én dokumenteret konsistent snapshotprocedure, så de separate filer ikke dækker forskellige forretningstilstande.
5. Kontroller versions-/extensionkompatibilitet, gendan til det tomme lokale mål med stop ved fejl, og sammenlign data, journal/saldi, roller, policies og medlemskaber. Prøv lokalt login med nye lokale sessions og virksomhed A/B. Kald mod hosted Auth/SMTP/Storage må ikke utilsigtet følge med. Genbrug ikke produktionssecrets lokalt, når en ny lokal nøgle kan bruges.
6. Bevar bevis for checksum, tidspunkt, omfang og varighed. Aftal ansvarlig operatør, frekvens, opbevaring og RPO/RTO. Manglende tabeller eller Auth-data må ikke blot udelades for at opnå PASS.

Pris for denne afgrænsede **hosted eksport + lokal restore**, på eksisterende Free-plan med gratis lokal software og allerede tilgængelig opbevaring: forventet **0 kr.**, realistisk worst-case **0 kr. i nye eksterne tjenesteudgifter**. Grundlag: ca. 15,5 MB kildedatabase, én afgrænset eksport, lokal compute, ingen nye abonnementer/hosted instanser. Supabase Free omfatter 5 GB egress; restkvoten kontrolleres før eksport, og ved utilstrækkelig kvote stoppes der uden opgradering. Strøm, arbejdstid og eventuelt køb af lokal hardware er ikke omfattet. Det er et teknisk adgangs-/scopepunkt, ikke et økonomisk stop for denne løsning.

Kilder: [Supabase Free-pris og kvoter](https://supabase.com/pricing), [CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [platform til selvhostet gendannelse](https://supabase.com/docs/guides/self-hosting/restore-from-platform), [Colima](https://github.com/abiosoft/colima).

Status: `HOSTED_BACKUP_EXPORT: NOT_RUN`, `HOSTED_BACKUP_LOCAL_RESTORE: NOT_RUN`. Ingen rå produktionsbackup er hentet. En eventuel ny hosted restore-instans er ikke valgt eller godkendt og kræver særskilt konkret pris-/ressourceafklaring.

### Frontendpilot: billigste afgrænsede muligheder

| Løsning | Adgang og levetid | Forventet / realistisk worst-case ekstern merudgift |
| --- | --- | --- |
| Eksisterende Mac, lokal backend og mkcert HTTPS | Samme betroede Wi-Fi, egne godkendte testenheder; Mac/processer skal være tændt. Ingen offentlig permanent adresse | 0 / 0 kr. på uændret opsætning og Supabase Free |
| Statisk Cloudflare Pages Free, uden Functions/Workers og uden købt domæne | Vedvarende offentlig HTTPS-adresse på pages.dev, mens projektet beholdes; login kræves fortsat for data | Selve frontendhosting 0 / 0 kr. inden for Free-grænser. En nødvendig Railway CORS-konfigurationsdeployment vurderes separat: forventet 0–0,30 kr., worst-case 1–3 kr. |

Anbefaling: genbrug den allerede afprøvede lokale HTTPS-opsætning til en lille, overvåget pilot på samme Wi-Fi. Opdater den lokale checkout kontrolleret uden at overskrive mkcert-/miljøindstillinger; bekræft gældende Mac-IP, certifikattillid, API-ready og foto deaktiveret. Ingen port-forwarding eller offentlig eksponering af Vite. Pilotens brugere/netværk er endnu ikke bekræftet; derfor er adgangsløsningen ikke endeligt accepteret.

Hvis adgang udefra er nødvendig, er statisk Pages Free en konkret mulighed: build apps/web, kun offentlige VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY og VITE_API_BASE_URL til Railway; tillad den præcise HTTPS-origin i backend-CORS. Ingen wildcard-CORS eller secrets i frontend. Afstem Auth-redirects, hvis de relevante loginflows bruger dem. Dette kræver en ny frontendservice og konfigurationsændring, som **ikke** er omfattet af godkendelsen, og er derfor ikke udført. CORS-ændringens eventuelle normale deployment er en anden handling end den nu godkendte deployment af 261fc75. Løbende pilottrafik på Railway kan ikke prissættes sikkert uden antal brugere, varighed og brugsmønster; ingen ubegrænset 0 kr.-garanti for backenden.

Kilder: [Pages statiske requests er gratis](https://developers.cloudflare.com/pages/functions/pricing/), [Free-grænser](https://developers.cloudflare.com/pages/platform/limits/). Ingen nye tjenester, domæner eller deployments er oprettet som led i denne vurdering.

## Udført backup-/gendannelsesprøve – 2026-09-23

Den særskilt godkendte hosted eksport → isoleret lokal databasegendannelse er afsluttet med operatørbekræftet PASS. [Fase 26-evidens](phase-26.md#faktisk-hosted-backup--lokal-databasegendannelse--afsluttet-2026-09-23) dokumenterer kommandometode, kontrolsummer, fejl under tilslutning og begrænsninger. Denne status erstatter planens tidligere NOT_RUN og krav om godkendelse af lokalt mål.

Faktisk procedure afveg fra CLI-planen: én konsistent fuld pg_dump custom-archive, separat passwordfri pg_dumpall-rolleeksport, identitetskontrolleret lokal kopi og atomisk fuld pg_restore til en ny tom database. Alle 88 tabeller er gendannet; 405 COPY-rækker i 87 datablokke og 2 sekvenstællere matcher backupen præcist. Projektroller gendannet; eksisterende managed systemroller genbrugt. TLS verify-full bevaret. Produktionsdatabasen blev ikke overskrevet, nulstillet eller ændret af prøvekommandoerne.

Backup ligger i `~/lager-backup-fase26/backup` på operatørens FileVault-krypterede Mac, uden for repository; den må ikke uploades til Git/chat. Krypteringen følger disken, ikke filerne ved kopiering. Lokal Colima-profil `lager-backup-test` er stoppet. Der er ikke etableret en separat kopi uden for Mac, automatisk backupfrekvens, retention eller aftalte/målte RPO/RTO. Databasepasswords/runtime-secrets skal fortsat opbevares separat.

Ingen ny applikations-/Auth-loginprøve er udført på denne gendannelse. Storage-filer, Vault-dekryptering, komplette managed rolleafvigelser og hosted-til-hosted recovery er ikke verificeret. Eksakt varighed og faktisk billing/restkvote er ikke verificeret. Den accepterede prisramme var forventet/worst-case 0/0 kr. i eksterne tjenesteudgifter; ingen hosted ressourcer/planer/limits blev ændret.

Stop efter dokumentation som ønsket. Frontendpilot og den samlede slutstatus behandles særskilt; ingen automatisk UI/UX-runde. Foto forbliver deaktiveret hosted.

## Valgt frontendpilot og afslutning – 2026-09-23

Den eksisterende lokale HTTPS-opsætning er valgt som pilotadgang for Fase 26: Mac-frontend og lokal backend, samme betroede Wi-Fi, certifikattillid på testenheder og kørende Mac/processer. Tidligere fysisk iPhone-/QR-evidens genbruges fra Fase 23; tablet er fortsat NOT_RUN. Det er en lokal overvåget pilot, ikke offentlig eller uafhængig døgnadgang. Intet dokumenteret fasekrav kræver en offentlig adresse. Cloudflare Pages og andre hostingforslag ovenfor forbliver uvalgte alternativer, ikke nødvendige afslutningskrav.

Fase 26 er afsluttet inden for brugerens accepterede omfang; se endelig [fasebeskrivelse](phase-26.md). Backupaccepten i `8665ed0` bevares uændret med login/applikationsadgang efter restore NOT_RUN, Storage-filer uden for omfang og ingen off-device kopi. Fast backupansvar/frekvens/retention og RPO/RTO er fortsat driftsopfølgning, ikke etableret ved faseafslutningen. Ingen ny aktuel Mac-build-/tilgængelighedstest påstås.

Dokumentationsafslutning: 0/0 kr. forventet/worst-case ekstern merudgift, ingen hosting, deployments, migrationer eller ressourceændringer. Ingen automatisk UI/UX-runde. Foto forbliver deaktiveret hosted.
