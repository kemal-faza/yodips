import {
  decideHandoffRequest,
  handoffSyncResponse,
  initialState,
  isPhaseSatisfied,
  pollStatusForEpoch,
  type FlowEvent,
  type FlowState,
  type PollStatus,
} from "./flow.js";
import { evaluateCookies, type CookieLite } from "./cookies.js";
import type { OutboundStatus } from "./contract.js";

export interface HandoffLifecycleDeps {
  getState: () => Promise<FlowState>;
  setState: (state: FlowState) => Promise<void>;
  /**
   * Remove the cached handoff result ONLY when it belongs to the CURRENT
   * operation epoch. A result cached before an MV3 service-worker restart
   * (or before a logout that never finished) carries an older tag and must
   * NOT be removable by a fresh login — see lifecycle epoch persistence.
   */
  removeResult: (epoch: number) => Promise<boolean>;
  tabAlive: (tabId: number | null) => Promise<boolean>;
  getFlowCookies: (tabId: number | null) => Promise<CookieLite[]>;
  runFlow: (event: FlowEvent) => Promise<void>;
  getCachedResult: () => Promise<OutboundStatus | undefined>;
  onReset?: (state: FlowState, reason: "zombie-tab" | "satisfied-phase") => void;
}

export interface PerformHandoffInput {
  requestEpoch: number;
  currentEpoch: () => number;
  appTabId: number | null;
  deps: HandoffLifecycleDeps;
}

const cancelledHandoff = (): OutboundStatus => ({
  status: "error",
  message: "Login dibatalkan karena logout.",
});

export async function performHandoff({
  requestEpoch,
  currentEpoch,
  appTabId,
  deps,
}: PerformHandoffInput): Promise<OutboundStatus> {
  const cancelled = () => requestEpoch !== currentEpoch();
  if (cancelled()) return cancelledHandoff();

  let state = await deps.getState();
  if (cancelled()) return cancelledHandoff();
  // Only a result tagged with THIS epoch may be cleared by this login. A
  // pre-restart result (older tag) survives — it belongs to an operation the
  // user never finished (e.g. logout interrupted by an SW kill), and the
  // status poll must keep rejecting it via the epoch fence.
  if (!(await deps.removeResult(requestEpoch))) {
    return {
      status: "error",
      message: "Login tidak dapat dimulai dengan aman. Coba lagi.",
    };
  }

  const decision = decideHandoffRequest({
    state,
    tabAlive: await deps.tabAlive(state.tabId),
    phaseSatisfied: isPhaseSatisfied(
      state,
      evaluateCookies(await deps.getFlowCookies(state.tabId)),
    ),
  });
  if (cancelled()) return cancelledHandoff();

  if (decision.kind === "reset") {
    deps.onReset?.(state, decision.reason);
    state = initialState(state.mode);
  } else if (decision.kind === "already-started") {
    return {
      status: "started",
      mode: decision.mode,
      message: "Login sedang berjalan.",
    };
  }

  await deps.setState({ ...state, appTabId });
  if (cancelled()) return cancelledHandoff();
  await deps.runFlow({ type: "REQUEST", mode: "auto" });
  if (cancelled()) return cancelledHandoff();

  const after = await deps.getState();
  const cached = await deps.getCachedResult();
  if (cancelled()) return cancelledHandoff();
  return handoffSyncResponse(after, cached);
}

export interface LogoutLifecycleDeps {
  runLogout: () => Promise<void>;
  clearSessionCookies: () => Promise<boolean>;
  removeResult: (epoch: number) => Promise<boolean>;
  onFlowError?: (error: unknown) => void;
  onIncomplete?: (details: {
    flowCleared: boolean;
    cookiesCleared: boolean;
    resultCleared: boolean;
  }) => void;
}

export async function performLogout(
  deps: LogoutLifecycleDeps,
): Promise<OutboundStatus> {
  let flowCleared = true;
  try {
    await deps.runLogout();
  } catch (error) {
    flowCleared = false;
    deps.onFlowError?.(error);
  }

  const cookiesCleared = await deps.clearSessionCookies();
  const resultCleared = await deps.removeResult(0);
  if (!flowCleared || !cookiesCleared || !resultCleared) {
    deps.onIncomplete?.({ flowCleared, cookiesCleared, resultCleared });
    return {
      status: "error",
      message: "Logout belum selesai sempurna. Silakan coba lagi.",
    };
  }
  // OutboundStatus requires accessToken on ok; a logout carries none, but the
  // type is shared with handoff results. Callers only read `status`.
  return { status: "ok" as const, accessToken: "" };
}

export interface StatusLifecycleDeps {
  getCachedResult: () => Promise<OutboundStatus | undefined>;
  getState: () => Promise<Pick<FlowState, "core" | "service">>;
}

export async function performStatus({
  requestEpoch,
  currentEpoch,
  deps,
}: {
  requestEpoch: number;
  currentEpoch: () => number;
  deps: StatusLifecycleDeps;
}): Promise<PollStatus> {
  const cached = await deps.getCachedResult();
  if (requestEpoch !== currentEpoch()) {
    return pollStatusForEpoch(requestEpoch, currentEpoch(), undefined, {
      core: "idle",
      service: null,
    });
  }
  const state = await deps.getState();
  return pollStatusForEpoch(requestEpoch, currentEpoch(), cached, state);
}
