// Shared with the DEV-only server. No HTTP is performed by this gate.
export {smokeLimits as limits, checkSmokeGate as checkDevOperationGate} from '../worker/structured/smoke-gate.ts';
