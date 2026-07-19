/**
 * Heuristic to decide whether a `docker compose pull` actually fetched new
 * image content, based on its output. Shared by the streaming and
 * non-streaming update paths so they report the same `changed` result and only
 * force-recreate when something really changed.
 */
export function composePullChanged(output: string): boolean {
  return output.includes('Pulled') || output.includes('Downloaded');
}
