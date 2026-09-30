import { describe, expect, it } from "vitest";
import { drainPendingEvent, type FlowEvent } from "./flow.js";
import { createSerializedFlowRunner } from "./flow-runner.js";
import { createLifecycleCoordinator } from "./single-flight.js";

describe("handoff race protection", () => {
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
    const lifecycle = createLifecycleCoordinator();
    const events: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = lifecycle.enqueue(async () => {
      events.push("first-start");
      await gate;
      events.push("first-end");
      throw new Error("first failed");
    });
    const second = lifecycle.enqueue(async () => {
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

  it("restores a persisted epoch on SW restart so a pre-restart cached result stays fenced", async () => {
    // Simulate: login completed at epoch 3 and cached a result; the SW is
    // killed mid-logout (epoch bumped to 4 in memory but the process died
    // before the persisted result was removed). On restart the persisted
    // epoch 4 is restored, and the stale result tagged 3 is unreachable.
    const lifecycle = createLifecycleCoordinator();
    lifecycle.restoreEpoch(4);

    // A fresh login request begins a NEW epoch, never joins the restored one.
    const fresh = lifecycle.beginHandoff();
    expect(fresh).toBe(5);
  });

  it("restoreEpoch never rewinds an already-advanced in-memory epoch", () => {
    const lifecycle = createLifecycleCoordinator();
    lifecycle.beginHandoff(); // → 1
    lifecycle.invalidate(); // → 2
    // A stale persisted value (e.g. written before the last invalidate) must
    // not pull the epoch backwards.
    lifecycle.restoreEpoch(1);
    expect(lifecycle.currentEpoch()).toBe(2);
    lifecycle.restoreEpoch(0);
    expect(lifecycle.currentEpoch()).toBe(2);
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
