declare module '*.tgz' { const bytes: ArrayBuffer; export default bytes; }
declare module '*.rev' { const text: string; export default text; }
declare module '*/qb.mjs' { const text: string; export default text; }
declare module '*/boot.sh' { const text: string; export default text; }
declare module '*/box-api.mjs' { const text: string; export default text; }
declare module '*/mergejob.mjs' { const text: string; export default text; }
declare module '*/gitpush.js' {
  export class Objects { map: Map<string, { type: string; body: Uint8Array }>; put(type: string, body: Uint8Array): string; blob(text: string): string; tree(snapshot: Map<string, string>): string; commit(tree: string, parents: string[], message: string, whenMs: number): string; }
  export function push(o: { remote: string; token: string; branch?: string; oldSha: string; newSha: string; objs: { type: string; body: Uint8Array }[] }): Promise<{ ok: boolean; status: number; bytes: number; detail: string }>;
}
