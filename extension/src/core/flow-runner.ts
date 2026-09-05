import {
  drainPendingEvent,
  type FlowEvent,
  type FlowState,
} from "./flow.js";

export interface FlowStepResult {
  after: Pick<FlowState, "core">;
  follow: FlowEvent | null;
}

function eventPriority(event: FlowEvent): number {
  switch (event.type) {
    case "LOGOUT":
      return 3;
    case "REQUEST":
      return 2;
    default:
      return 1;
  }
}

/**
 * Serialize asynchronous flow steps while allowing callers to join the
 * active pass. A parked event is drained before the returned promise settles.
 */
export function createSerializedFlowRunner(
  step: (event: FlowEvent) => Promise<FlowStepResult>,
): (initialEvent: FlowEvent) => Promise<void> {
  let pendingEvent: FlowEvent | null = null;
  let activeRun: Promise<void> | null = null;

  return (initialEvent: FlowEvent): Promise<void> => {
    if (activeRun) {
      // Preserve control-event priority: logout > fresh login request >
      // observational cookie/tab/alarm events.
      if (
        pendingEvent === null ||
        eventPriority(initialEvent) >= eventPriority(pendingEvent)
      ) {
        pendingEvent = initialEvent;
      }
      return activeRun;
    }

    const run = (async () => {
      try {
        let event: FlowEvent | null = initialEvent;
        let guard = 0;
        while ((event !== null || pendingEvent !== null) && guard < 20) {
          guard++;
          const currentEvent = event ?? (pendingEvent as FlowEvent);
          // Keep a parked event through a follow-up chain. It must be available
          // to drainPendingEvent after HANDOFF_OK has produced the terminal
          // state, rather than being silently discarded at the chain boundary.
          if (event === null) pendingEvent = null;
          const { after, follow } = await step(currentEvent);
          event = follow ?? drainPendingEvent(currentEvent, after, pendingEvent);
          if (!follow) pendingEvent = null;
        }
      } catch (error) {
        // A parked event belongs to the failed pass. Do not replay it into a
        // later login attempt after a partial handoff failure.
        pendingEvent = null;
        throw error;
      }
    })();
    const joined = run.finally(() => {
      if (activeRun === joined) activeRun = null;
    });
    activeRun = joined;
    return joined;
  };
}
