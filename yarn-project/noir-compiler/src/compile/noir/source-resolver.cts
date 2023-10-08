// Shim module to force the use of the CJS build of source-resolver, the same build used by noir_wasm
type SourceResolver = {
  initializeResolver: (resolver: (source_id: string) => string) => void;
};
const resolve: SourceResolver = require('@noir-lang/source-resolver');
export const initializeResolver = resolve.initializeResolver;
