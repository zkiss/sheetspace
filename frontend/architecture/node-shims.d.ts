// The frontend intentionally does not depend on Node's ambient types.  The
// analyzer runs in Vitest/Node, so keep its small runtime surface explicit.
declare module 'node:fs' { const fs: any; export = fs; }
declare module 'node:os' { const os: any; export = os; }
declare module 'node:path' { const path: any; export = path; }
