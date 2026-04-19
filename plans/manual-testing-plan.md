# Plan de test manuel — Fédération multi-instances

## Prérequis

Deux instances HOMER accessibles sur le réseau local, appelées **A** et **B** dans ce document.

```bash
# Option 1 : deux containers locaux sur ports différents
docker run -d --name homer-a -p 4001:4000 -e HOMER_INSTANCE_NAME=homer-a ...
docker run -d --name homer-b -p 4002:4000 -e HOMER_INSTANCE_NAME=homer-b ...

# Option 2 : deux machines du homelab avec Caddy
# homer-a.local  →  https://homer-a.local
# homer-b.local  →  https://homer-b.local
```

Les tests supposent que les deux instances **n'ont pas encore d'utilisateur** au démarrage de chaque section (réinitialiser la DB entre les sections si nécessaire).

---

## Phase 1 — Identité de l'instance

### Objectif
Chaque instance génère un UUID stable et l'expose via l'API.

### Étapes

1. Démarrer l'instance A.
2. `GET /api/instances/self` → noter l'UUID retourné (ex. `uuid-A`).
3. Redémarrer l'instance A.
4. `GET /api/instances/self` → vérifier que l'UUID est **identique** à celui noté.
5. Vérifier que `name` correspond au hostname ou à `HOMER_INSTANCE_NAME`.
6. Si `HOMER_DOMAIN` est défini, vérifier que `url` est présent et correct.

### Résultat attendu
- UUID stable entre redémarrages.
- `name`, `version`, `url` cohérents avec la configuration.

---

## Phase 2 — Découverte mDNS

### Prérequis
- Le container a accès à Avahi sur la machine hôte (socket D-Bus monté).
- Les deux instances sont sur le même réseau local.

### Étapes

1. Démarrer A et B.
2. Sur le réseau local : `avahi-browse -ptr _homer._tcp` → vérifier que les deux instances apparaissent avec leurs TXT records (`uuid=`, `name=`, `url=`).
3. Dans l'UI de A → page **Fédération** → bouton **Découvrir**.
4. Vérifier que B apparaît dans la liste (et vice-versa depuis l'UI de B).
5. Vérifier que les instances **déjà appairées** n'apparaissent pas dans la liste de découverte.

### Résultat attendu
- Les deux instances visibles via mDNS.
- La liste de découverte exclut les pairs déjà connus.

---

## Phase 3 — Appairage sans conflit utilisateur

### Prérequis
- Instance A : créer un compte `alice` (mot de passe `passwordA`).
- Instance B : créer un compte `bob` (mot de passe `passwordB`).
- Aucun username en commun entre A et B.

### Étapes

1. Dans l'UI de A → **Fédération** → **Appairer** → saisir l'URL de B → **Initier**.
2. Vérifier que deux codes à 6 chiffres s'affichent (code local de A, code attendu de B).
3. Dans l'UI de B → **Fédération** → section **Demandes reçues** → vérifier que le code local de B correspond au "code attendu" affiché dans l'UI de A.
4. Dans l'UI de A → saisir le code affiché côté B → **Confirmer**.
5. Vérifier le message de succès et que B apparaît dans la liste des instances appairées de A.
6. Vérifier que A apparaît dans la liste des instances appairées de B.

### Résultat attendu
- Les deux côtés ont une entrée `peer_instances` avec le même `shared_secret`.
- Aucun conflit détecté.
- Le code saisi incorrect → message d'erreur, appairage non finalisé.

---

## Phase 4 — Résolution de conflits utilisateurs au pairing

### Prérequis
- Instance A : compte `alice` (mot de passe `pwdAliceA`).
- Instance B : compte `alice` (mot de passe `pwdAliceB`).
- Les deux mots de passe sont **différents** (simule deux comptes indépendants pour le même username).

### Étapes

1. Initier l'appairage depuis A vers B (même flow que Phase 3, étapes 1–4).
2. Après confirmation du code, vérifier que l'UI affiche une étape **"Résolution de conflits"** mentionnant `alice`.
3. Saisir un mot de passe local **incorrect** pour `alice` → **Valider** → vérifier le message d'erreur.
4. Saisir le bon mot de passe local (`pwdAliceA`) mais un mot de passe distant **incorrect** → **Valider** → message d'erreur.
5. Saisir les deux mots de passe corrects (`pwdAliceA` pour local, `pwdAliceB` pour distant) → **Valider et appairer**.
6. Vérifier le succès et que les deux instances sont bien appairées.
7. Dans la DB de B : vérifier que `alice.home_instance_uuid` pointe vers l'UUID de A.

### Résultat attendu
- L'appairage est bloqué tant qu'on ne prouve pas la possession des deux comptes.
- Après résolution, l'appairage se finalise normalement.

---

## Phase 5 — Authentification fédérée

### 5.1 — Login délégué (instance home joignable)

**Prérequis :** A et B appairés, `alice` a `home_instance_uuid = UUID-A`.

1. Se déconnecter de B.
2. Se connecter sur B avec les credentials `alice` / `pwdAliceA`.
3. Vérifier la connexion réussie.
4. Vérifier dans les logs serveur de B que la requête de vérification a bien été envoyée vers A.

**Résultat attendu :** Login réussi via délégation à A.

---

### 5.2 — Fallback sur hash en cache (instance home injoignable)

**Prérequis :** suite de 5.1 (le hash est mis en cache après le premier login réussi).

1. Couper l'instance A (ou la rendre injoignable — pare-feu, stop container).
2. Se déconnecter de B.
3. Se connecter sur B avec `alice` / `pwdAliceA`.
4. Vérifier que le login **réussit** malgré A injoignable.

**Résultat attendu :** Login réussi via hash mis en cache localement (TTL 24 h).

---

### 5.3 — Expiration du cache (optionnel — nécessite manipulation de la DB)

1. Dans la DB de B, modifier `alice.cached_hash_expires_at` à une valeur passée (ex. `1`).
2. Couper A.
3. Tenter de se connecter sur B → vérifier le **refus** (cache expiré).

**Résultat attendu :** Login refusé quand le home est injoignable et le cache expiré.

---

### 5.4 — Wizard "Rejoindre une fédération"

**Prérequis :** Instance C fraîche (aucun utilisateur), A opérationnelle avec compte `alice`.

1. Accéder à l'UI de C → écran de setup.
2. Cliquer **"Join an existing federation instead"**.
3. Saisir l'URL de A, username `alice`, mot de passe `pwdAliceA` → **Join Federation**.
4. Vérifier que C est connectée en tant qu'`alice`.
5. Vérifier dans la DB de C que `alice.home_instance_uuid = UUID-A` et qu'une entrée `peer_instances` pour A existe.

**Résultat attendu :** L'instance C démarre directement avec un compte fédéré, sans créer de compte local.

---

## Phase 6 — Proxy REST cross-instance

### Prérequis
- A et B appairés.
- B a au moins un projet créé.

### Étapes

1. Dans l'UI de A → sélecteur d'instance en haut → choisir **B**.
2. Naviguer sur la page **Projets** → vérifier que les projets de B sont listés.
3. Naviguer sur **Containers** → vérifier que les containers de B sont listés.
4. Déclencher un **deploy** d'un projet de B depuis l'UI de A → vérifier que l'opération s'exécute bien sur B.
5. Revenir sur **Instance locale** dans le sélecteur → vérifier que les projets de A sont affichés.

### Résultat attendu
- Toutes les pages métier reflètent les ressources de l'instance sélectionnée.
- Les opérations (deploy, stop…) s'exécutent bien sur l'instance cible.
- Repasser en local restitue les données locales.

---

## Phase 7 — Proxy WebSocket cross-instance

### Prérequis
- A et B appairés, au moins un container en cours d'exécution sur B.

### Étapes

1. Dans l'UI de A, sélectionner l'instance **B**.
2. Ouvrir les **logs** d'un container de B → vérifier que les lignes de log s'affichent en streaming.
3. Déclencher un **deploy** d'un projet de B depuis l'UI de A → vérifier que les lignes de sortie s'affichent en temps réel.
4. Couper puis rétablir la connexion réseau vers B → vérifier que les logs reprennent automatiquement après reconnexion du WS pair (dans les ~30 s).

### Résultat attendu
- Les streams de logs et de deploy transitent bien de B vers l'UI de A.
- La reconnexion est automatique après coupure réseau.

---

## Phase 8 — Heartbeat et statut temps réel

### Prérequis
- A et B appairés.

### Étapes

1. Dans l'UI de A → page **Fédération** → noter le statut affiché pour B (doit être `online`).
2. Couper l'instance B.
3. Attendre au maximum **60 secondes** (2 cycles de heartbeat à 30 s).
4. Vérifier que le statut de B passe à `offline` **sans recharger la page**.
5. Relancer B.
6. Attendre ≤ 60 s → vérifier que le statut repasse à `online` sans rechargement.
7. Fermer tous les onglets du navigateur (0 client WS connecté).
8. Vérifier dans les logs du serveur A qu'aucune requête de heartbeat n'est émise vers B.
9. Rouvrir l'UI → vérifier que le heartbeat reprend.

### Résultat attendu
- Statut mis à jour en temps réel dans l'UI.
- **Aucune** requête réseau vers les pairs quand aucun client n'est connecté.

---

## Phase 3 bis — Désappairage

### Prérequis : A et B appairés.

1. Dans l'UI de A → **Fédération** → **Désappairer** B → confirmer.
2. Vérifier que B disparaît de la liste des pairs de A.
3. Vérifier que A disparaît de la liste des pairs de B (notification reçue).
4. Tenter de sélectionner B dans le sélecteur d'instance de A → B ne doit plus apparaître.
5. Tenter de se connecter sur B avec un compte `alice` (home = A) → doit **échouer** si le cache est expiré.

### Résultat attendu
- Les deux instances retirent mutuellement leur entrée `peer_instances`.
- L'accès cross-instance cesse immédiatement.

---

## Matrice de vérification rapide

| # | Fonctionnalité | Vérifié |
|---|---|---|
| 1 | UUID stable entre redémarrages | ☐ |
| 2 | Découverte mDNS fonctionne | ☐ |
| 3 | Appairage sans conflit | ☐ |
| 4 | Détection et résolution conflit username | ☐ |
| 5.1 | Login délégué (home joignable) | ☐ |
| 5.2 | Login via cache (home down) | ☐ |
| 5.3 | Cache expiré → refus | ☐ |
| 5.4 | Setup "Join federation" | ☐ |
| 6 | Proxy REST cross-instance | ☐ |
| 7 | Proxy WS cross-instance (logs, deploy) | ☐ |
| 7b | Reconnexion WS automatique | ☐ |
| 8 | Statut pair en temps réel | ☐ |
| 8b | Pas de heartbeat sans client connecté | ☐ |
| 9 | Désappairage propre (bilatéral) | ☐ |
