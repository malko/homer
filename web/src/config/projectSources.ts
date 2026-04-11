export interface ProjectSource {
  id: string;
  label: string;
  icon: string;
  description: string;
}

export const PROJECT_SOURCES: ProjectSource[] = [
  {
    id: 'create',
    label: 'Créer un nouveau projet',
    icon: '📄',
    description: 'Démarrer un nouveau projet avec un fichier docker-compose vide',
  },
  {
    id: 'docker-run',
    label: 'Depuis docker run',
    icon: '🐳',
    description: 'Convertir une commande docker run en projet compose',
  },
  {
    id: 'migrate',
    label: 'Migrer un container',
    icon: '🔄',
    description: 'Migrer un container existant vers compose',
  },
  {
    id: 'existing',
    label: 'Récupérer un projet',
    icon: '📂',
    description: 'Importer un projet existant depuis le dossier data',
  },
];