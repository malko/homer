import { useState, useEffect, useCallback } from 'react';
import { api, type Project, type AutoUpdatePolicy, type ProjectUpdatePayload } from '../api';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setError(null);
      const data = await api.projects.list();
      setProjects(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const addProject = async (name: string, options?: { autoUpdate?: boolean; autoUpdatePolicy?: AutoUpdatePolicy; watchEnabled?: boolean }) => {
    const project = await api.projects.create({ name, ...options });
    setProjects((prev) => [project, ...prev]);
    return project;
  };

  const updateProject = async (id: number, data: ProjectUpdatePayload) => {
    const updated = await api.projects.update(id, data);
    setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  };

  const deleteProject = async (id: number) => {
    await api.projects.delete(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  const deployProject = async (id: number) => {
    await api.projects.deploy(id);
    await fetchProjects();
  };

  const updateProjectImages = async (id: number) => {
    const result = await api.projects.updateImages(id);
    await fetchProjects();
    return result;
  };

  return {
    projects,
    loading,
    error,
    refetch: fetchProjects,
    addProject,
    updateProject,
    deleteProject,
    deployProject,
    updateProjectImages,
  };
}
