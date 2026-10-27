/**
 * What exists inside the sandbox, and what doesn't.
 *
 * An extension runs in a bare JavaScript engine with no `window`, no `document` and no network of
 * its own, so none of those are declared here: if the editor says one isn't defined, it isn't there
 * at run time either. The one door out is `crystal`, which the classes in this package wrap.
 */
export {};

declare global {
  /** Crystal's raw host object. Prefer the classes from "@crystal/extension", which are typed and documented. */
  const crystal: {
    readonly manifest: { readonly name: string; readonly version: string; readonly capabilities: readonly string[]; readonly network: readonly string[] };
    on(name: string, handler: (data: any) => unknown): void;
    readonly ui: Record<string, (...args: any[]) => any>;
    readonly storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void>; list(): Promise<string[]> };
    readonly http: { fetch(url: string, options?: { method?: string; headers?: Record<string, string>; body?: unknown }): Promise<{ status: number; ok: boolean; contentType: string; text: string; json(): any }> };
    notify(text: string): Promise<void>;
  };

  function setTimeout(handler: () => void, ms?: number): number;
  function setInterval(handler: () => void, ms?: number): number;
  function clearTimeout(id: number): void;
  function clearInterval(id: number): void;

  const console: {
    log(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}
