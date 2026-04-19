# Fédération multi-instances HOMER

## Context

Aujourd'hui chaque déploiement HOMER est isolé : une instance = un homelab = sa propre DB, ses propres projets, ses propres comptes. L'utilisateur veut pouvoir installer HOMER sur plusieurs serveurs de son homelab et **les gérer de manière unifiée depuis n'importe laquelle des instances** : lister projets, modifier compose, lancer deploy, voir logs, gérer containers/volumes/networks — tout cela cross-instance.

L'objectif est de **fédérer** les instances (pas de cluster avec leader), chacune reste autonome et pilotable localement. La fédération ajoute :
1. **Découverte mutuelle** via mDNS (réutilise l'infra Avahi existante).
2. **Appairage manuel** avec code de confirmation côté humain (deux instances ne se parlent qu'après autorisation explicite).
3. **Authentification fédérée** : un utilisateur créé sur l'instance A peut se connecter sur l'instance B avec le même couple user/password.
4. **Opérations cross-instance** : l'UI locale peut agir sur les ressources d'un pair via proxy HTTP/WS.

## Décisions d'architecture validées

- **Modèle de données** : fédération pure — chaque instance conserve sa DB locale (`projects`, `proxy_hosts`, `containers`). Aucune réplication du métier. La seule donnée partagée concerne l'identité (voir ci-dessous).
- **Transport inter-instances** : HTTPS via le Caddy existant de chaque instance (utilise l'infra TLS locale déjà en place).
- **Temps réel** : WebSocket proxifié par l'instance locale. L'UI ne parle qu'à son serveur local ; celui-ci maintient des WS sortants vers les pairs et réémet les events tagués `peer_id`.
- **Identité utilisateur** : chaque user a une **instance d'origine (`home_instance_id`)** qui fait foi pour son mot de passe. Les autres instances délèguent l'auth au home node. Fallback via **hash mis en cache** (TTL 24h) si home node injoignable.
- **Pairing** : code de confirmation à 6 chiffres affiché des deux côtés (saisie mutuelle) + résolution explicite des conflits d'usernames avec **preuve de possession des deux mots de passe**.
- **Setup** : bouton "Rejoindre une fédération existante" dans le wizard de setup initial (pas de scan auto du LAN — saisie manuelle de l'adresse d'un nœud).

## Schéma de données

### Nouvelles tables (`server/src/db/index.ts`)

```sql
-- Identité de cette instance (ligne unique, créée au premier boot)
-- Stockée via settingQueries (pas de nouvelle table)
-- keys: 'instance_uuid', 'instance_name', 'instance_api_key' (secret, généré au boot)

-- Pairs fédérés
peer_instances
├─ id (PK, autoincrement)
├─ peer_uuid (TEXT UNIQUE NOT NULL)       -- UUID de l'instance distante
├─ peer_name (TEXT NOT NULL)              -- Nom lisible
├─ peer_url (TEXT NOT NULL)               -- https://homer-b.local
├─ shared_secret (TEXT NOT NULL)          -- Token machine partagé généré au pairing
├─ paired_at (INTEGER NOT NULL)           -- timestamp epoch
├─ last_seen (INTEGER)                    -- epoch du dernier heartbeat réussi
├─ status (TEXT)                          -- 'online'|'offline'|'unreachable'
└─ created_at

-- Pairings en cours (ephemeral, TTL 5 min)
pairing_requests
├─ id (PK)
├─ direction (TEXT)                       -- 'initiated'|'received'
├─ peer_url (TEXT)
├─ peer_uuid (TEXT, nullable au début)
├─ local_code (TEXT)                      -- 6 chiffres affichés à l'utilisateur local
├─ expected_remote_code (TEXT, nullable)  -- Code que l'utilisateur doit saisir (reçu du pair)
├─ expires_at (INTEGER)
└─ created_at
```

### Modification table `users`

```sql
ALTER TABLE users ADD COLUMN home_instance_uuid TEXT;  -- NULL = local (instance historique)
ALTER TABLE users ADD COLUMN cached_password_hash TEXT;  -- Fallback si home down
ALTER TABLE users ADD COLUMN cached_hash_expires_at INTEGER;
```

Migration : à l'ajout de la colonne, tous les users existants ont `home_instance_uuid = instance_uuid local` (rétro-compatible).

## Composants à créer / modifier

### Backend

| Fichier | Action | Rôle |
|---|---|---|
| `server/src/db/index.ts` | Modifier | Ajouter tables `peer_instances`, `pairing_requests` ; migration `users` ; exporter `peerQueries`, `pairingQueries` |
| `server/src/services/instance.ts` | **Nouveau** | `getLocalInstance()` (uuid, name, api_key, url public). Génère UUID + api_key au premier boot via `settingQueries` |
| `server/src/services/mdns.ts` | Étendre | Ajouter `publishSelfInstance()` appelée au startup : publie le domaine `homer-<uuid8>.local` pointant sur l'IP hôte. Réutilise `publishIfEnabled()`. |
| `server/src/services/mdns-supervisor.sh` | Étendre | Publier aussi le service `_homer._tcp` avec TXT records (`uuid=`, `name=`, `version=`, `url=`). Ajouter endpoint `avahi-browse -ptr _homer._tcp` exposé via un fichier JSON `data/mdns-discovered.json` rafraîchi toutes les N secondes |
| `server/src/services/peers.ts` | **Nouveau** | Client HTTP inter-instance (`peerRequest(peer, method, path, body)`) : ajoute header `X-Peer-Uuid` + HMAC avec `shared_secret`. Gestion retry + marquage `status`. Cache LRU pour responses GET courtes. |
| `server/src/services/peer-ws.ts` | **Nouveau** | Maintient un WS sortant par pair `online`. Reçoit les events du pair, les reémet en local via `fastify.broadcast()` avec `peer_uuid` ajouté au payload. Reconnexion exponentielle. |
| `server/src/routes/instances.ts` | **Nouveau** | Endpoints fédération (voir détail ci-dessous) |
| `server/src/routes/auth.ts` | Modifier | `/login` : si user a `home_instance_uuid != local`, déléguer au home node ; fallback sur `cached_password_hash` si home injoignable. `/setup` : accepter mode "join federation" qui consomme un pairing_request existant au lieu de créer un user. |
| `server/src/routes/*.ts` (projects, containers, proxy, import, home, system) | Ajouter | Middleware **proxy transparent** : si requête a `X-Peer-Uuid: <other>` → forward vers le pair via `peerRequest()` et relayer la réponse. Un seul hook `preHandler` global peut le faire avant les handlers métier. |
| `server/src/websocket/index.ts` | Modifier | Quand un client s'abonne à des events d'un `peer_uuid` distant, relayer les events reçus depuis `peer-ws.ts`. Ajouter messages `subscribe_peer_events`, `unsubscribe_peer_events`. |
| `server/src/index.ts` | Modifier | Au startup : générer UUID+api_key si absent, `publishSelfInstance()`, démarrer `peer-ws.ts` pour tous les pairs connus. Cleanup au shutdown. |

### Endpoints nouveaux (`/api/instances/*`)

```
GET    /api/instances/self              → { uuid, name, version, url }
GET    /api/instances                   → liste des pairs + status
GET    /api/instances/discover          → scan mDNS (lit data/mdns-discovered.json), filtre les pairs déjà appairés
POST   /api/instances/pair/initiate     → { peer_url } : contacte peer, reçoit son code, génère le local_code
                                        → retourne { local_code, remote_code, request_id }
POST   /api/instances/pair/confirm      → { request_id, entered_code } : vérifie code saisi, finalise
                                        → si conflits users, retourne { conflicts: [...] } et reste en pending
POST   /api/instances/pair/resolve      → { request_id, resolutions: [{username, password_local, password_remote, action: 'merge'|'rename'}] }
                                        → valide les 2 passwords avant de merger ou renommer
DELETE /api/instances/:uuid             → désappairer (notifie le pair)

# Endpoints appelés DE pair à pair (auth via HMAC sur shared_secret ou pairing_code)
POST   /api/instances/_peer/pair/hello  → handshake initial, retourne self info + pairing_code
POST   /api/instances/_peer/pair/finalize  → finalisation après confirmation du code
POST   /api/instances/_peer/auth/verify → { username, password } : le pair demande validation pour un user dont on est home
GET    /api/instances/_peer/users       → liste users (nom + home_uuid), pour détection conflits au pairing
POST   /api/instances/_peer/unpair      → notification de désappairage
```

### Frontend

| Fichier | Action | Rôle |
|---|---|---|
| `web/src/pages/Instances.tsx` | **Nouveau** | Page "Instances" : liste pairs + statut, bouton "Appairer" (saisie URL + flow code), bouton "Découvrir" (scan mDNS), actions désappairer |
| `web/src/pages/Auth.tsx` | Modifier | Wizard setup initial : ajouter bouton "Rejoindre une fédération existante" qui remplace l'écran "créer compte" par un écran "URL d'un nœud existant + login avec compte fédéré" |
| `web/src/api/index.ts` | Modifier | Ajouter paramètre optionnel `peerUuid` à toutes les méthodes ; si présent, ajoute header `X-Peer-Uuid: <uuid>` aux requêtes (le backend proxy transparentement) |
| `web/src/hooks/useInstances.ts` | **Nouveau** | Hook pour liste pairs + actions pairing |
| `web/src/hooks/useWebSocket.ts` | Modifier | Supporter abonnement aux events d'un pair distant |
| `web/src/pages/Projects.tsx` et autres | Modifier | Sélecteur d'instance en haut (tous / local / pair X) ; passe `peerUuid` au hook |
| `web/src/App.tsx` | Modifier | Nouvelle route `/instances` |

## Flux de pairing (détail)

```
[Instance A]                                  [Instance B]
Admin saisit URL de B
POST /pair/initiate { url: B }
  → HTTPS vers B: POST /_peer/pair/hello
                  { from_uuid, from_name, from_url }
                                                ← génère pairing_request côté B
                                                  local_code_B = "123456"
                                                ← retourne { to_uuid, to_name, local_code: "123456" }
  génère local_code_A = "789012"
  stocke pairing_request côté A
  retourne { local_code_A: "789012",
             remote_code: "123456",    ← code à saisir côté A (reçu de B)
             request_id }
Admin affiche local_code_A = "789012" dans UI A
Admin saisit "123456" (vu côté B) dans UI A
POST /pair/confirm { request_id, entered_code: "123456" }
  vérifie entered_code == remote_code ✓
  GET B: /_peer/users                      → liste users de B
  compare avec users locaux
    - conflit détecté: "alice" présent des 2 côtés avec hash ≠
  stocke en pending, retourne { conflicts: [{username: "alice", ...}] }

Admin voit le conflit, saisit pour chaque conflit:
  password_local (sa alice sur A) + password_remote (sa alice sur B)
POST /pair/resolve { resolutions: [...] }
  valide password_local contre hash local ✓
  POST B: /_peer/auth/verify { username, password_remote }  → B valide ✓
  merge: choisit A comme home (created_at plus ancien)
    → update users.home_instance_uuid pour alice sur B
  POST B: /_peer/pair/finalize { shared_secret, conflict_resolutions }
  finalise côté A et côté B:
    - insert peer_instances (A↔B avec shared_secret)
    - broadcast WS: 'peer_added'
    - ouvre WS sortant peer-ws
```

## Flux de login fédéré

```
alice se log sur instance B, son home est A
POST /api/auth/login { username: alice, password }
  lookup user: home_instance_uuid = <A>, pas local
  POST A: /_peer/auth/verify { username, password }
    → A vérifie bcrypt, retourne ok + cached hash signé
  cache le hash localement (TTL 24h)
  génère session token local
  retourne token

# Si A down:
POST A fail → fallback sur cached_password_hash si non expiré
  bcrypt.compare(password, cached_password_hash) → ok
  génère session token avec flag "offline_auth"
```

## Flux d'opération cross-instance

```
UI sur instance A veut voir projets de B
GET /api/projects  avec header X-Peer-Uuid: <B>
  preHandler détecte X-Peer-Uuid différent de local
  peerRequest(B, 'GET', '/api/projects')
    → HTTPS B: GET /api/projects + HMAC
    → B traite la requête normalement (la session de l'admin n'existe que sur A,
      donc l'auth entre A↔B se fait via shared_secret/HMAC, pas via Bearer token user)
  relay réponse vers UI

UI s'abonne aux logs d'un container de B
WS → instance A : subscribe_peer_events { peer_uuid: B, event_type: 'log_line', container_id: X }
  peer-ws.ts de A a déjà un WS ouvert vers B
  envoie à B: subscribe_logs { container_id: X }
  reçoit log_line events de B
  reémet en local avec payload enrichi { peer_uuid: B, ... }
  UI reçoit et affiche
```

## Sécurité

- **Shared secret par pair** : généré au pairing (32 bytes random), jamais transmis en clair après la phase initiale (handshake sur HTTPS).
- **HMAC sur toute requête `_peer/*`** : header `X-Peer-Signature: <hmac-sha256(body + timestamp)>` + `X-Peer-Timestamp` (rejet si > 60s skew).
- **Caddy TLS** : réutilise le cert local (`caddy-data/caddy/pki/authorities/local/root.crt` déjà exposé via `/api/proxy/root-ca`). Les pairs doivent accepter mutuellement le root CA de l'autre ; au pairing on échange le CA + on le stocke en `data/peer-ca/<uuid>.crt` et le client HTTP `peers.ts` l'ajoute au trust store de la requête (via `https.Agent({ca: ...})`).
- **Révocation** : `DELETE /api/instances/:uuid` purge shared_secret, invalide sessions fédérées issues de ce pair, unpublish éventuelle annonce mDNS dédiée.

## Découpage en phases d'implémentation

Pour livrer de manière incrémentale et testable :

1. **Fondations identité instance** — UUID+api_key au boot, `GET /api/instances/self`, publication mDNS de soi-même, endpoint frontend minimal qui affiche l'identité de l'instance.
2. **Discovery mDNS** — extension du supervisor pour `avahi-browse _homer._tcp`, fichier `data/mdns-discovered.json`, endpoint `/api/instances/discover`, UI page Instances en lecture seule.
3. **Pairing sans conflits** — flow complet `initiate/confirm/finalize` avec échange CA + shared_secret, pour le cas simple (usernames disjoints). Table `peer_instances`.
4. **Résolution conflits users** — détection au pairing, UI de résolution, endpoint `/pair/resolve` avec validation des 2 mots de passe.
5. **Auth fédérée** — `home_instance_uuid` sur users, délégation login, cached hash fallback, setup wizard "Rejoindre une fédération".
6. **Proxy REST transparent** — preHandler global sur toutes les routes métier, header `X-Peer-Uuid` côté client, sélecteur d'instance dans l'UI.
7. **Proxy WebSocket** — `peer-ws.ts`, relay events, messages `subscribe_peer_events`.
8. **Polish** — désappairage propre, statut online/offline en temps réel, reconnexion robuste, gestion des erreurs UI.

Chaque phase peut être mergée et validée indépendamment. La valeur utilisateur arrive dès la phase 6 (vue cross-instance fonctionnelle) ; la phase 7 améliore l'UX sur les opérations longues (deploy, logs).

## Fichiers critiques à modifier (récap)

**Backend**
- `server/src/db/index.ts` — nouvelles tables + migration users
- `server/src/services/mdns.ts` + `services/mdns-supervisor.sh` — self-advertise + discovery
- `server/src/services/instance.ts` **[nouveau]**
- `server/src/services/peers.ts` **[nouveau]**
- `server/src/services/peer-ws.ts` **[nouveau]**
- `server/src/routes/instances.ts` **[nouveau]**
- `server/src/routes/auth.ts` — login fédéré, setup federation
- `server/src/routes/*.ts` (projects, containers, proxy, import, home, system) — preHandler proxy
- `server/src/websocket/index.ts` — peer event relay
- `server/src/index.ts` — bootstrap services

**Frontend**
- `web/src/pages/Instances.tsx` **[nouveau]**
- `web/src/pages/Auth.tsx` — setup wizard federation
- `web/src/api/index.ts` — support `peerUuid`
- `web/src/hooks/useInstances.ts` **[nouveau]**
- `web/src/hooks/useWebSocket.ts` — peer events
- `web/src/pages/Projects.tsx`, `AllContainersPage.tsx`, `NetworksPage.tsx`, `ProxyPage.tsx`, `HomePage.tsx` — sélecteur instance
- `web/src/App.tsx` — route `/instances`

## Vérification

Le test end-to-end requiert deux instances HOMER sur le réseau local.

1. **Phase 1-2** : sur une instance, `GET /api/instances/self` retourne UUID stable ; `avahi-browse _homer._tcp` depuis le LAN voit l'annonce.
2. **Phase 3** : deux instances `homer-a.local` et `homer-b.local`. Depuis A, saisir URL de B, récupérer les deux codes, saisir mutuellement → les deux côtés ont une ligne dans `peer_instances` avec même `shared_secret`.
3. **Phase 4** : créer `alice` avec des passwords différents sur A et B avant le pairing, vérifier que le pairing détecte le conflit, que la résolution exige les deux mots de passe, et que le refus d'un des deux passwords empêche la finalisation.
4. **Phase 5** : après pairing, `alice` créée sur A peut se login sur B. Couper A, retenter login sur B → doit marcher via fallback cache. Laisser expirer 24h → doit échouer.
5. **Phase 6** : depuis UI de A, basculer sur instance B, voir les projets de B, déclencher un deploy → la commande s'exécute bien sur B, le résultat revient dans l'UI de A.
6. **Phase 7** : logs d'un container de B streamés en live dans l'UI de A ; couper puis rebrancher B → reconnexion automatique du WS relay.
7. **Désappairage** : `DELETE /api/instances/:uuid` depuis A → B est notifié, retire A de ses pairs, les sessions fédérées issues du shared_secret cessent de fonctionner.

Validation manuelle requise (pas de framework de test dans ce projet). Un script `scripts/test-federation.sh` lançant deux containers HOMER locaux avec des ports différents pourrait faciliter les tests futurs mais n'est pas bloquant.
