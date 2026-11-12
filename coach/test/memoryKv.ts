/** In-memory stand-in for a Workers KV namespace: get, getWithMetadata, put (with metadata) and paged list. */
export function memoryKv(pageSize = 1000) {
  const data = new Map<string, { value: string; metadata: unknown }>();
  const kv = {
    async get(key: string, type?: string) {
      const value = data.get(key)?.value ?? null;
      return type === "json" && value !== null ? JSON.parse(value) : value;
    },
    async getWithMetadata(key: string) {
      const entry = data.get(key);
      return { value: entry?.value ?? null, metadata: entry?.metadata ?? null, cacheStatus: null };
    },
    async put(key: string, value: string, options: { metadata?: unknown } = {}) {
      data.set(key, { value, metadata: options.metadata ?? null });
    },
    async list({ prefix = "", cursor }: { prefix?: string; cursor?: string } = {}) {
      const names = [...data.keys()].filter((name) => name.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = names.slice(start, start + pageSize);
      const done = start + pageSize >= names.length;
      return {
        keys: page.map((name) => ({ name, metadata: data.get(name)!.metadata })),
        list_complete: done,
        cursor: done ? undefined : String(start + pageSize),
        cacheStatus: null,
      };
    },
  };
  return { data, kv: kv as unknown as KVNamespace };
}
