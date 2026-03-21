import chokidar, { FSWatcher } from 'chokidar';
import { projectQueries, Project } from '../db/index.js';
import { deployProject } from './docker.js';

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private watchedProjects: Map<number, string> = new Map();
  private deployDebounce: Map<number, NodeJS.Timeout> = new Map();

  initialize() {
    this.watcher = chokidar.watch([], {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', (filePath) => {
      this.handleFileChange(filePath);
    });

    this.watcher.on('add', (filePath) => {
      this.handleFileChange(filePath);
    });

    const projects = projectQueries.getAll();
    projects.forEach((project) => {
      if (project.watch_enabled) {
        this.addProject(project);
      }
    });
  }

  addProject(project: Project) {
    if (!this.watcher) return;
    
    this.watchedProjects.set(project.id, project.path);
    this.watcher.add(project.path);
    
    const dir = project.path.includes('/') 
      ? project.path.substring(0, project.path.lastIndexOf('/'))
      : '.';
    
    this.watcher.add(`${dir}/**/*.yml`);
    this.watcher.add(`${dir}/**/*.yaml`);
    this.watcher.add(`${dir}/docker-compose.yml`);
    this.watcher.add(`${dir}/docker-compose.yaml`);
  }

  removeProject(projectId: number) {
    if (!this.watcher) return;
    
    const path = this.watchedProjects.get(projectId);
    if (path) {
      this.watcher.unwatch(path);
      this.watchedProjects.delete(projectId);
    }
    
    const timeout = this.deployDebounce.get(projectId);
    if (timeout) {
      clearTimeout(timeout);
      this.deployDebounce.delete(projectId);
    }
  }

  private handleFileChange(filePath: string) {
    for (const [projectId, projectPath] of this.watchedProjects) {
      if (filePath.startsWith(projectPath.substring(0, projectPath.lastIndexOf('/')))) {
        this.debouncedDeploy(projectId);
        break;
      }
    }
  }

  private debouncedDeploy(projectId: number) {
    const existing = this.deployDebounce.get(projectId);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(async () => {
      try {
        await deployProject(projectId);
        console.log(`Auto-deployed project ${projectId} after file change`);
      } catch (error) {
        console.error(`Failed to auto-deploy project ${projectId}:`, error);
      }
      this.deployDebounce.delete(projectId);
    }, 2000);

    this.deployDebounce.set(projectId, timeout);
  }

  close() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.deployDebounce.forEach((timeout) => clearTimeout(timeout));
    this.deployDebounce.clear();
  }
}

export const watcher = new FileWatcher();
