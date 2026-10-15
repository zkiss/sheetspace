// The frontend intentionally does not depend on Node's ambient types.  The
// analyzer runs in Vitest/Node, so keep its small runtime surface explicit.
declare module 'node:fs' { const fs: any; export = fs; }
declare module 'node:os' { const os: any; export = os; }
declare module 'node:path' { const path: any; export = path; }
declare module 'node:child_process' { export const execFileSync: any; }
declare module 'node:url' { export const fileURLToPath: any; }
