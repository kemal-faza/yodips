import { describe, expect, it } from "vitest";
import { initialState } from "./flow.js";
import {
  performHandoff,
  performLogout,
  performStatus,
} from "./lifecycle.js";

describe("lifecycle adapter operations", () => {
  it("does not resurrect a handoff cancelled during preflight", async () => {
    let epoch = 1;
    const calls: string[] = [];
    const result = await performHandoff({
      requestEpoch: 1,
      currentEpoch: () => epoch,
      appTabId: 42,
      deps: {
        getState: async () => initialState("auto"),
        removeResult: async () => true,
        tabAlive: async () => {
          epoch = 2;
          return false;
        },
        getFlowCookies: async () => [],
        setState: async () => {
          calls.push("setState");
        },
        runFlow: async () => {
          calls.push("runFlow");
        },
        getCachedResult: async () => undefined,
      },
    });

    expect(result.status).toBe("error");
    expect(calls).toEqual([]);
  });

  it("fails closed when a previous cached result cannot be removed", async () => {
    let preflightCalls = 0;
    const result = await performHandoff({
      requestEpoch: 1,
      currentEpoch: () => 1,
      appTabId: null,
      deps: {
        getState: async () => initialState("auto"),
        removeResult: async () => false,
        tabAlive: async () => {
          preflightCalls++;
          return false;
        },
        getFlowCookies: async () => [],
        setState: async () => {},
        runFlow: async () => {},
        getCachedResult: async () => undefined,
      },
    });

    expect(result).toEqual({
      status: "error",
      message: "Login tidak dapat dimulai dengan aman. Coba lagi.",
    });
    expect(preflightCalls).toBe(0);
  });

  it("never returns a cached token after the status epoch changes", async () => {
    let epoch = 1;
    const result = await performStatus({
      requestEpoch: 1,
      currentEpoch: () => epoch,
      deps: {
        getCachedResult: async () => {
          epoch = 2;
          return { status: "ok", accessToken: "stale-token" };
        },
        getState: async () => initialState("auto"),
      },
    });

    expect(result).toEqual({
      status: "error",
      message: "Sesi login berubah. Silakan ulangi login.",
    });
  });

  it("reports incomplete logout while attempting every cleanup step", async () => {
    const calls: string[] = [];
    const result = await performLogout({
      runLogout: async () => {
        calls.push("flow");
        throw new Error("teardown failed");
      },
      clearSessionCookies: async () => {
        calls.push("cookies");
        return false;
      },
      removeResult: async () => {
        calls.push("result");
        return false;
      },
    });

    expect(result.status).toBe("error");
    expect(calls).toEqual(["flow", "cookies", "result"]);
  });
});
