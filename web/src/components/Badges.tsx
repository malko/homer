import { FolderOpenIcon, BoxIcon, DatabaseIcon, LayersIcon, CpuIcon, GlobeIcon } from './Icons';

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function Badge({ children, className = '', title, onClick, style }: BadgeProps) {
  return (
    <span 
      className={`badge ${className}`} 
      title={title}
      onClick={onClick}
      style={style}
    >
      {children}
    </span>
  );
}

interface ProjectBadgeProps {
  project: string;
  onClick?: () => void;
}

export function ProjectBadge({ project, onClick }: ProjectBadgeProps) {
  return (
    <Badge className="badge-project" onClick={onClick} title={onClick ? 'Cliquer pour filtrer' : undefined}>
      <FolderOpenIcon size={12} />
      {project}
    </Badge>
  );
}

interface ServiceBadgeProps {
  service: string;
}

export function ServiceBadge({ service }: ServiceBadgeProps) {
  return (
    <Badge className="badge-service">
      <BoxIcon size={12} />
      {service}
    </Badge>
  );
}

interface DriverBadgeProps {
  driver: string;
}

export function DriverBadge({ driver }: DriverBadgeProps) {
  return (
    <Badge className="badge-driver" title={`Driver: ${driver}`}>
      <CpuIcon size={12} />
      {driver}
    </Badge>
  );
}

interface ScopeBadgeProps {
  scope: string;
}

export function ScopeBadge({ scope }: ScopeBadgeProps) {
  return (
    <Badge className="badge-scope" title={`Scope: ${scope}`}>
      <GlobeIcon size={12} />
      {scope}
    </Badge>
  );
}

interface OrphanBadgeProps {
  label?: string;
}

export function OrphanBadge({ label = 'non utilisé' }: OrphanBadgeProps) {
  return (
    <Badge className="badge-orphan" title="Volume non utilisé par aucun container">
      {label}
    </Badge>
  );
}

interface ContainerBadgeProps {
  container: string;
}

export function ContainerBadge({ container }: ContainerBadgeProps) {
  return (
    <Badge className="badge-container" title={`Container: ${container}`}>
      <BoxIcon size={12} />
      {container}
    </Badge>
  );
}

interface InternalBadgeProps {
  internal: boolean;
}

export function InternalBadge({ internal }: InternalBadgeProps) {
  return (
    <Badge className={internal ? 'badge-internal-yes' : 'badge-internal-no'} title={internal ? 'Réseau interne' : 'Réseau externe'}>
      {internal ? 'interne' : 'externe'}
    </Badge>
  );
}

interface UsedBadgeProps {
  used: boolean;
}

export function UsedBadge({ used }: UsedBadgeProps) {
  return (
    <Badge className={used ? 'badge-used' : 'badge-unused'} title={used ? 'Réseau utilisé' : 'Réseau inutilisé'}>
      {used ? 'utilisé' : 'inutilisé'}
    </Badge>
  );
}