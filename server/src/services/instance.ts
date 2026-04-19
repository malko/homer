import { randomBytes, randomUUID } from 'crypto';
import { hostname } from 'os';
import { settingQueries } from '../db/index.js';

export interface LocalInstance {
  uuid: string;
  name: string;
  apiKey: string;
  url: string | null;
  version: string;
}

const SETTING_UUID = 'instance_uuid';
const SETTING_API_KEY = 'instance_api_key';
const SETTING_NAME = 'instance_name';

let cached: LocalInstance | null = null;

function readVersion(): string {
  return process.env.HOMER_VERSION || process.env.npm_package_version || 'dev';
}

function defaultInstanceName(): string {
  const envName = process.env.HOMER_INSTANCE_NAME;
  if (envName && envName.trim()) return envName.trim();
  try {
    return hostname() || 'homer';
  } catch {
    return 'homer';
  }
}

function publicUrl(): string | null {
  const domain = process.env.HOMER_DOMAIN?.trim();
  if (domain) {
    return domain.startsWith('http') ? domain : `https://${domain}`;
  }
  const ip = process.env.HOST_IP?.trim();
  if (ip) {
    return `http://${ip}:${process.env.PORT || '4000'}`;
  }
  return null;
}

export function getLocalInstance(): LocalInstance {
  if (cached) {
    return { ...cached, url: publicUrl(), version: readVersion() };
  }

  let uuid = settingQueries.get(SETTING_UUID);
  if (!uuid) {
    uuid = randomUUID();
    settingQueries.set(SETTING_UUID, uuid);
    console.log(`[instance] Generated new instance UUID: ${uuid}`);
  }

  let apiKey = settingQueries.get(SETTING_API_KEY);
  if (!apiKey) {
    apiKey = randomBytes(32).toString('hex');
    settingQueries.set(SETTING_API_KEY, apiKey);
    console.log('[instance] Generated new instance API key');
  }

  let name = settingQueries.get(SETTING_NAME);
  if (!name) {
    name = defaultInstanceName();
    settingQueries.set(SETTING_NAME, name);
  }

  cached = {
    uuid,
    name,
    apiKey,
    url: publicUrl(),
    version: readVersion(),
  };
  return cached;
}

export function setInstanceName(name: string): LocalInstance {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Instance name cannot be empty');
  settingQueries.set(SETTING_NAME, trimmed);
  if (cached) cached.name = trimmed;
  return getLocalInstance();
}

export function selfDomain(): string {
  const { uuid } = getLocalInstance();
  return `homer-${uuid.slice(0, 8)}.local`;
}
