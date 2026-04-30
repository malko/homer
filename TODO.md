# TODO

## Vérification des mises à jour
- [ ] revoir les web notifs qui popent trop souvent et qui reste même quand le container est updater

## Update
* [ ] Revoir le système d'update des containers avec relance des services et possibilité de nettoyer les images inutilisées, vérifier que ça fonctionne ou corriger

## Moniteur système
- [ ] revoir le design des graphiques

## Page Projets

## UI/UX
- [x] modifier avec le design créer pour
- [x] revoir la page fédération pour qu'elle soit plus dans le ton du reste
- [x] Déplacer la page fédération dans settings
- [x] Ajouter quelques choix de thèmes dans la section paramètres et changer le theme par défaut pour un theme plus sombre
- [ ] revoir navigation de la page projet => le menu sur la gauche c'est pas beau avec le menu principal ça fait double menu c'est moche
- [ ] Pour le paramètre d'intervalle de vérification des mises à jour proposer des options par défaut (6h, 12h, 1 jours, 1 semaine) et laisser la possibilité à l'utilisateur de saisir une valeur custom 
- [ ] internationnalisation
- [ ] Ajouter une note sur le rechargement du navigateur lors de l'appairage (vérifier si c'est déjà fait)
- [x] Ajouter un bouton pour redémarrer l'instance dans les settings
- [x] Pas de feedback sur bouton vérifier les mises à jour dans settings system

## Fédération
- [ ] Au moment de l'appairage avec un noeud on devrait ajouter tout les noeud de la fédération automatiquement (j'appaire une fois pour toute la fédération)

## Accès distant
- Permettre à l'utilisateur d'intégrer facilement un client tailscale (et/ou alternative) pour pouvoir accéder à son homelab de manière sécurisé sans forcément exposé des ports à l'extérieur

## PAAS
- [ ] Permettre d'ajouter un projet à partir d'un dépot git et en faire un site statique, ou lancemet d'un projet avec docker compose. Adapater le systeme d'update en conséquence.
    -  [ ] les builds pour les projets devront être exécutés dans des conteneurs isolés et jetables pour éviter de compromettre le système hote si les dépendances sont compromises. 

## Template system (docker compose):
- [ ] Regarder les templates proposer par d'autres solutions commes dokploy, casaos etc... et voir comment on pourrait permettre d'importer des templates depuis ces différentes sources.
    - [ ] nécessité de pouvoir gérer des fichiers d'initialisation en plus du simple docker compose
    - [ ] avoir des générateurs types mot de passe, nom de domaine etc pour pouvoir utiliser des templates types dokploy
    - [ ] définir notre propre système de template pour qu'il soit le plus simple à unifier avec les autres systemes (Volonté de créer ensuite un standard ?)
    - [ ] permettre de récupérer un template à partir d'un dépot git

## Backup:
- [ ] implement differents backups systems: network share, s3, nas system... 
- [ ] propose different strategies for backup:
    - config only, db only volumes ?
    - how many backups should be kept, when to run incremental vs full backup, password protection for backups etc...
    - backup strategies for the db and global conf should go to global settings, details of what needs to be backup for projects should be set in projects
- [ ] Once we have backup added to the UI and the backend we need to implement restore from backup
    - Backup listing from global settings and from projects
    - Restore button to restore to a particular backup
    - delete button to delete some past backup

## Security:
- [ ] revoir et traité les points du plan [security-fix.md](plans/security-fix.md)

## Bugs: 
- [x] terminal en distant ne fonctionne toujours pas
- [x] start / stop compose en distant ne fonctionne pas en distant
- [x] connexion websocket pour notifs en temps réel du status distant ne fonctionne pas on fallback sur 10secondes polling
    => et si on autorisait le cross origin pour les instances et qu'on se connectait directement à l'autre backend ?
- [x] demande de restart ne fonctionne pas ni local ni distant