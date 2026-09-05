import { describe, expect, it } from "vitest";
import { drainPendingEvent, type FlowEvent } from "./flow.js";
import { createSerializedFlowRunner } from "./flow-runner.js";
import {
  createLifecycleCoordinator,
  createSerialQueue,
  createSingleFlight,
} from "./single-flight.js";

describe("handoff race protection", () => {
  it("joins concurrent handoff admissions instead of running the backend handoff twice", async () => {
    const flight = createSingleFlight<string>();
    let calls = 0;
    let resolve: (value: string) => void = () => {};
    const gate = new Promise<string>((next) => {
      resolve = next;
    });

    const first = flight(async () => {
      calls++;
      return gate;
    });
    const second = flight(async () => {
      calls++;
      return "wrong-generation";
    });

    expect(second).toBe(first);
    resolve("first-generation");
    await expect(Promise.all([first, second])).resolves.toEqual([
      "first-generation",
      "first-generation",
    ]);
    expect(calls).toBe(1);
  });

  it("keeps a joined caller pending until the active flow drains HANDOFF_OK", async () => {
    const events: FlowEvent["type"][] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runFlow = createSerializedFlowRunner(async (event) => {
      events.push(event.type);
      if (event.type === "REQUEST") {
        await gate;
        return {
          after: { core: "handoff" as const },
          follow: { type: "HANDOFF_OK", token: "first-generation" },
        };
      }
      return { after: { core: "done" as const }, follow: null };
    });

    const first = runFlow({ type: "REQUEST", mode: "auto" });
    const joined = runFlow({ type: "REQUEST", mode: "auto" });
    expect(joined).toBe(first);
    let settled = false;
    void joined.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();

    await joined;
    expect(events).toEqual(["REQUEST", "HANDOFF_OK"]);
  });

  it("does not replay a parked REQUEST after HANDOFF_OK completes", () => {
    expect(
      drainPendingEvent(
        { type: "HANDOFF_OK", token: "first-generation" },
        { core: "done" },
        { type: "REQUEST", mode: "auto" },
      ),
    ).toBeNull();
  });

  it("releases a failed admission so the next attempt can run", async () => {
    const flight = createSingleFlight<string>();
    let calls = 0;
    const failure = new Error("handoff failed");
    const first = flight(async () => {
      calls++;
      throw failure;
    });
    const joined = flight(async () => {
      calls++;
      return "unexpected";
    });

    expect(joined).toBe(first);
    await expect(first).rejects.toBe(failure);
    await expect(
      flight(async () => {
        calls++;
        return "second-attempt";
      }),
    ).resolves.toBe("second-attempt");
    expect(calls).toBe(2);
  });

  it("keeps logout ahead of later events while a handoff is active", async () => {
    const events: FlowEvent["type"][] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runFlow = createSerializedFlowRunner(async (event) => {
      events.push(event.type);
      if (event.type === "REQUEST") {
        await gate;
        return {
          after: { core: "handoff" as const },
          follow: { type: "HANDOFF_OK", token: "first-generation" },
        };
      }
      return { after: { core: "idle" as const }, follow: null };
    });

    const active = runFlow({ type: "REQUEST", mode: "auto" });
    const logout = runFlow({ type: "LOGOUT" });
    runFlow({ type: "COOKIE_SET", changed: ["MoodleSession"] });
    release();

    await logout;
    await active;
    expect(events).toEqual(["REQUEST", "HANDOFF_OK", "LOGOUT"]);
  });

  it("keeps a parked REQUEST ahead of later observational events", async () => {
    const events: FlowEvent["type"][] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runFlow = createSerializedFlowRunner(async (event) => {
      events.push(event.type);
      if (event.type === "REQUEST") {
        await gate;
        return {
          after: { core: "handoff" as const },
          follow: { type: "HANDOFF_OK", token: "first-generation" },
        };
      }
      return { after: { core: "done" as const }, follow: null };
    });

    const active = runFlow({ type: "REQUEST", mode: "auto" });
    runFlow({ type: "REQUEST", mode: "auto" });
    runFlow({ type: "COOKIE_SET", changed: ["MoodleSession"] });
    release();

    await active;
    expect(events).toEqual(["REQUEST", "HANDOFF_OK"]);
  });

  it("runs lifecycle tasks in order even when an earlier task fails", async () => {
    const queue = createSerialQueue();
    const events: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue(async () => {
      events.push("first-start");
      await gate;
      events.push("first-end");
      throw new Error("first failed");
    });
    const second = queue(async () => {
      events.push("second");
    });

    release();
    await expect(first).rejects.toThrow("first failed");
    await second;
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });

  it("fences a pre-logout handoff and lets a new epoch run afterward", async () => {
    const lifecycle = createLifecycleCoordinator();
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const oldEpoch = lifecycle.beginHandoff();
    const oldHandoff = lifecycle.handoff(oldEpoch, async () => {
      order.push("old-start");
      await gate;
      order.push("old-end");
      return lifecycle.currentEpoch() === oldEpoch ? "old" : "cancelled";
    });

    lifecycle.invalidate();
    const logout = lifecycle.enqueue(async () => {
      order.push("logout");
    });
    const freshEpoch = lifecycle.beginHandoff();
    const freshHandoff = lifecycle.handoff(
      freshEpoch,
      async () => {
        order.push("fresh");
        return "fresh";
      },
    );

    expect(freshHandoff).not.toBe(oldHandoff);
    release();
    await expect(oldHandoff).resolves.toBe("cancelled");
    await logout;
    await expect(freshHandoff).resolves.toBe("fresh");
    expect(order).toEqual(["old-start", "old-end", "logout", "fresh"]);
  });

  it("clears parked events when the active flow fails", async () => {
    const events: FlowEvent["type"][] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failure = new Error("handoff failed");
    let requestCalls = 0;
    const runFlow = createSerializedFlowRunner(async (event) => {
      events.push(event.type);
      if (event.type === "REQUEST") {
        requestCalls++;
        await gate;
        if (requestCalls === 1) throw failure;
      }
      return { after: { core: "done" as const }, follow: null };
    });

    const active = runFlow({ type: "REQUEST", mode: "auto" });
    const joined = runFlow({ type: "REQUEST", mode: "auto" });
    release();

    await expect(active).rejects.toBe(failure);
    expect(joined).toBe(active);
    await runFlow({ type: "COOKIE_SET", changed: ["MoodleSession"] });
    expect(events).toEqual(["REQUEST", "COOKIE_SET"]);
  });

  it("keeps unrelated parked events after HANDOFF_OK", () => {
    const cookieEvent = { type: "COOKIE_SET" as const, changed: ["MoodleSession"] };
    expect(
      drainPendingEvent(
        { type: "HANDOFF_OK", token: "first-generation" },
        { core: "done" },
        cookieEvent,
      ),
    ).toBe(cookieEvent);
  });
});
