import { createContext, useContext, useEffect, useRef, useCallback, useState, ReactNode } from 'react';
import { api } from '../api/index.js';
import { isPopupWindow } from '../utils/popup';

interface ProjectUpdate {
  id: number;
  name: string;
  services: string[];
}

interface UpdatesContextValue {
  updates: ProjectUpdate[];
  hasUpdates: boolean;
  notificationsEnabled: boolean;
  notificationsSupported: boolean;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  fetchUpdates: () => Promise<void>;
  toggleNotifications: () => Promise<void>;
  dismissProject: (projectId: number) => void;
  clearDismissed: () => Promise<void>;
}

const ProjectUpdatesContext = createContext<UpdatesContextValue | null>(null);

const NOTIFICATION_PERMISSION_KEY = 'web_notifications_enabled';
const DISMISSED_UPDATES_KEY = 'dismissed_updates';

function loadDismissedIds(): Set<number> {
  try {
    const stored = localStorage.getItem(DISMISSED_UPDATES_KEY);
    if (stored) {
      const ids = JSON.parse(stored) as number[];
      return new Set(ids);
    }
  } catch {}
  return new Set();
}

function saveDismissedIds(ids: Set<number>) {
  localStorage.setItem(DISMISSED_UPDATES_KEY, JSON.stringify([...ids]));
}

export function ProjectUpdatesProvider({ children }: { children: ReactNode }) {
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return localStorage.getItem(NOTIFICATION_PERMISSION_KEY) === 'true';
  });
  const [showModal, setShowModal] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(() => loadDismissedIds());
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const previousUpdatesRef = useRef<ProjectUpdate[]>([]);
  const fetchTimeoutRef = useRef<number | null>(null);

  // The Notification API silently refuses to prompt (and Notification.permission
  // stays 'default' forever) on an insecure origin — plain http on anything but
  // localhost/127.0.0.1. Surface that distinctly instead of looking like a no-op.
  const notificationsSupported = 'Notification' in window && window.isSecureContext;

  const requestNotificationPermission = useCallback(async () => {
    if (!notificationsSupported) {
      console.warn('Notifications require a secure context (HTTPS)');
      return false;
    }

    if (Notification.permission === 'granted') {
      localStorage.setItem(NOTIFICATION_PERMISSION_KEY, 'true');
      setNotificationsEnabled(true);
      return true;
    }

    if (Notification.permission === 'denied') {
      return false;
    }

    const permission = await Notification.requestPermission();
    const enabled = permission === 'granted';
    localStorage.setItem(NOTIFICATION_PERMISSION_KEY, String(enabled));
    setNotificationsEnabled(enabled);
    return enabled;
  }, []);

  const toggleNotifications = useCallback(async () => {
    if (notificationsEnabled) {
      localStorage.setItem(NOTIFICATION_PERMISSION_KEY, 'false');
      setNotificationsEnabled(false);
    } else {
      await requestNotificationPermission();
    }
  }, [notificationsEnabled, requestNotificationPermission]);

  const fetchUpdates = useCallback(async () => {
    try {
      const data = await api.system.getUpdates();
      const filtered = data.projects.filter(p => !dismissedIds.has(p.id));
      setUpdates(filtered);
    } catch (err) {
      console.error('Failed to fetch updates:', err);
    }
  }, [dismissedIds]);

  const sendNotification = useCallback((projects: ProjectUpdate[], isInitial: boolean) => {
    if (isPopupWindow()) return;
    if (!notificationsEnabled || Notification.permission !== 'granted') return;
    if (isInitial) return;

    const title = 'Mise à jour disponible';
    const body = projects.length === 1
      ? `${projects[0].name}: ${projects[0].services.join(', ')}`
      : `${projects.length} projets avec des mises à jour`;

    try {
      new Notification(title, {
        body,
        icon: '/icon.png',
        tag: 'updates',
      });
    } catch {}
  }, [notificationsEnabled]);

  const dismissProject = useCallback((projectId: number) => {
    setDismissedIds(prev => {
      const newSet = new Set(prev).add(projectId);
      saveDismissedIds(newSet);
      return newSet;
    });
    setUpdates(prev => prev.filter(p => p.id !== projectId));
  }, []);

  const clearDismissed = useCallback(async () => {
    setDismissedIds(new Set());
    saveDismissedIds(new Set());
    // Fetch directly rather than through fetchUpdates: that callback closes
    // over the dismissedIds from this render, which is still the pre-clear
    // set, so it would immediately re-filter out what we just un-dismissed.
    try {
      const data = await api.system.getUpdates();
      setUpdates(data.projects);
    } catch (err) {
      console.error('Failed to fetch updates:', err);
    }
  }, []);

  useEffect(() => {
    if (isPopupWindow()) return;
    fetchUpdates().then(() => setIsFirstLoad(false));
    fetchTimeoutRef.current = window.setInterval(fetchUpdates, 60000);
    return () => {
      if (fetchTimeoutRef.current) clearInterval(fetchTimeoutRef.current);
    };
  }, [fetchUpdates]);

  useEffect(() => {
    if (isPopupWindow()) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/events?token=${token}`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as { type: string; [key: string]: unknown };
          if (msg.type === 'project_update_available') {
            fetchUpdates();
          }
        } catch {}
      };

      ws.onclose = () => {
        setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [fetchUpdates]);

  useEffect(() => {
    const currentIds = new Set(previousUpdatesRef.current.map(p => p.id));
    const newProjects = updates.filter(p => !currentIds.has(p.id));

    if (newProjects.length > 0) {
      sendNotification(newProjects, isFirstLoad);
    }

    previousUpdatesRef.current = updates;
  }, [updates, sendNotification, isFirstLoad]);

  const value: UpdatesContextValue = {
    updates,
    hasUpdates: updates.length > 0,
    notificationsEnabled,
    notificationsSupported,
    showModal,
    setShowModal,
    fetchUpdates,
    toggleNotifications,
    dismissProject,
    clearDismissed,
  };

  return (
    <ProjectUpdatesContext.Provider value={value}>
      {children}
    </ProjectUpdatesContext.Provider>
  );
}

export function useProjectUpdates() {
  const context = useContext(ProjectUpdatesContext);
  if (!context) {
    throw new Error('useProjectUpdates must be used within a ProjectUpdatesProvider');
  }
  return context;
}