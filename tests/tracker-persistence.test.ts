import { describe, expect, it } from "vitest";
import { ChangeTracker } from "../src/data/change-tracker";
import { attachTrackerPersistence } from "../src/data/persist";

describe("persistencia del tracker de cambios", () => {
  it("la persistencia y la UI escuchan a la vez: nadie pisa al otro", () => {
    const tracker = new ChangeTracker();
    attachTrackerPersistence(tracker);
    const seen: string[] = [];
    tracker.addListener(() => seen.push("ui"));
    tracker.mark("sales", "s1");
    expect(seen).toEqual(["ui"]);
    expect(tracker.pendingCount()).toBe(1);
  });

  it("restaura pendientes guardados y notifica a los interesados", () => {
    const tracker = new ChangeTracker();
    let calls = 0;
    tracker.addListener(() => {
      calls += 1;
    });
    tracker.restore({ dirty: { sales: ["s1", "s2"] }, deltas: { "sales:s1": { profit: 10 } } });
    expect(tracker.pendingCount()).toBe(2);
    expect(calls).toBe(1);
  });

  it("desuscribirse deja de notificar", () => {
    const tracker = new ChangeTracker();
    let calls = 0;
    const off = tracker.addListener(() => {
      calls += 1;
    });
    tracker.mark("sales", "s1");
    off();
    tracker.mark("sales", "s2");
    expect(calls).toBe(1);
  });
});
