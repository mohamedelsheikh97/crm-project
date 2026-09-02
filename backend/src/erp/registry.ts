import { env } from '../config/env.js';

import { simulatorAdapter } from './simulator.js';
import type { ErpAdapter, ErpAdapterInfo } from './types.js';

/**
 * Config → adapter (Phase 11, US4, FR-039a, research D11).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PROVIDER COMES FROM THE ENVIRONMENT. ENABLEMENT COMES FROM THE DATABASE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * That division is Phase 5's, and `channels/registry.ts` states it in the same
 * words. It is what FR-039a needs: an administrator can switch ERP sync off
 * without a deployment, and CANNOT re-point it at a different adapter through a
 * screen. The environment decides which code runs; a screen decides whether it
 * runs.
 *
 * A `switch` with one arm looks like ceremony and is not: adding a real adapter
 * is meant to be one branch here plus one file, and a function that returned the
 * simulator directly would have to be rewritten rather than extended. See
 * `contracts/erp-adapter-contract.md` § 7 for the shape of that work — if it
 * turns out to need more than this, the contract is missing something.
 */
export function adapter(): ErpAdapter {
  switch (env.ERP_PROVIDER) {
    case 'simulator':
      return simulatorAdapter;
    default:
      /**
       * Unreachable while `ERP_PROVIDER` is a single-value enum, and kept so
       * that adding a value to that enum without adding a branch here is a type
       * error rather than a silent fall-through to the simulator.
       *
       * That fall-through is exactly the failure FR-039a guards against: a
       * deployment believing it is talking to a real ERP while an agent reads
       * invented order data.
       */
      throw new Error(`ERP_PROVIDER "${String(env.ERP_PROVIDER)}" has no adapter`);
  }
}

/** What the administration screen displays. Includes `isSimulated`. */
export function describe(): ErpAdapterInfo {
  return adapter().describe();
}

/**
 * Whether the active adapter is a simulator.
 *
 * Read by the order surface so the screen can say so (FR-039a). An agent quoting
 * simulated order status to a customer is the quiet failure this phase can most
 * easily ship, and the defence is that every surface showing the data says where
 * it came from.
 */
export function isSimulated(): boolean {
  return describe().isSimulated;
}
