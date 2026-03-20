import { describe, it, expect } from "vitest";
import { EventStream, StreamResult } from "./event-stream.js";
import type { StreamEvent, StreamResponse } from "../types.js";

function makeEvent(text: string): StreamEvent {
  return { type: "text_delta", text } as unknown as StreamEvent;
}

function makeResponse(stopReason = "end_turn"): StreamResponse {
  return {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    },
    stopReason,
    usage: { inputTokens: 10, outputTokens: 5 },
  } as unknown as StreamResponse;
}

describe("EventStream", () => {
  it("push and iterate collects all events", async () => {
    const stream = new EventStream<StreamEvent>();
    stream.push(makeEvent("a"));
    stream.push(makeEvent("b"));
    stream.push(makeEvent("c"));
    stream.close();

    const collected: StreamEvent[] = [];
    for await (const event of stream) {
      collected.push(event);
    }

    expect(collected).toHaveLength(3);
    expect((collected[0] as unknown as { text: string }).text).toBe("a");
    expect((collected[1] as unknown as { text: string }).text).toBe("b");
    expect((collected[2] as unknown as { text: string }).text).toBe("c");
  });

  it("close stops iteration", async () => {
    const stream = new EventStream<StreamEvent>();
    stream.push(makeEvent("x"));
    stream.close();

    const collected: StreamEvent[] = [];
    for await (const event of stream) {
      collected.push(event);
    }

    expect(collected).toHaveLength(1);
    expect((collected[0] as unknown as { text: string }).text).toBe("x");
  });

  it("abort throws error during iteration", async () => {
    const stream = new EventStream<StreamEvent>();
    const error = new Error("stream aborted");

    stream.push(makeEvent("before"));
    stream.abort(error);

    const collected: StreamEvent[] = [];
    await expect(async () => {
      for await (const event of stream) {
        collected.push(event);
      }
    }).rejects.toThrow("stream aborted");

    // The event pushed before abort should still be yielded
    expect(collected).toHaveLength(1);
    expect((collected[0] as unknown as { text: string }).text).toBe("before");
  });

  it("events pushed before iteration are available", async () => {
    const stream = new EventStream<StreamEvent>();

    // Push all events before consuming
    stream.push(makeEvent("1"));
    stream.push(makeEvent("2"));
    stream.push(makeEvent("3"));
    stream.close();

    const collected: StreamEvent[] = [];
    for await (const event of stream) {
      collected.push(event);
    }

    expect(collected).toHaveLength(3);
    expect((collected[0] as unknown as { text: string }).text).toBe("1");
    expect((collected[2] as unknown as { text: string }).text).toBe("3");
  });

  it("events pushed after iteration starts are received", async () => {
    const stream = new EventStream<StreamEvent>();

    const collected: StreamEvent[] = [];
    const iterating = (async () => {
      for await (const event of stream) {
        collected.push(event);
      }
    })();

    // Push events after iteration has started
    await Promise.resolve(); // let the iterator start waiting
    stream.push(makeEvent("late1"));
    await Promise.resolve();
    stream.push(makeEvent("late2"));
    await Promise.resolve();
    stream.close();

    await iterating;

    expect(collected).toHaveLength(2);
    expect((collected[0] as unknown as { text: string }).text).toBe("late1");
    expect((collected[1] as unknown as { text: string }).text).toBe("late2");
  });

  it("queue overflow drops oldest events when exceeding 10k", async () => {
    const stream = new EventStream<number>();

    // Push more than 10,000 events without consuming
    for (let i = 0; i < 10_002; i++) {
      stream.push(i);
    }
    stream.close();

    const collected: number[] = [];
    for await (const event of stream) {
      collected.push(event);
    }

    // After overflow at 10,001 items, queue is trimmed to 5,000 + new item
    // Then at 10,002 items (since 5,001 + more pushes), it may trim again
    // The key assertion: we should NOT have all 10,002 events
    expect(collected.length).toBeLessThan(10_002);
    // The last event should always be present
    expect(collected[collected.length - 1]).toBe(10_001);
  });
});

describe("StreamResult", () => {
  it("async iteration works with for-await", async () => {
    const result = new StreamResult();

    result.push(makeEvent("hello"));
    result.push(makeEvent("world"));
    result.complete(makeResponse());

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    expect(collected).toHaveLength(2);
    expect((collected[0] as unknown as { text: string }).text).toBe("hello");
    expect((collected[1] as unknown as { text: string }).text).toBe("world");
  });

  it("thenable - await directly returns response", async () => {
    const result = new StreamResult();

    result.push(makeEvent("data"));
    result.complete(makeResponse("end_turn"));

    const response = await result;

    expect((response as unknown as { stopReason: string }).stopReason).toBe("end_turn");
    expect((response as unknown as { usage: { inputTokens: number } }).usage.inputTokens).toBe(10);
  });

  it("complete resolves the response promise", async () => {
    const result = new StreamResult();
    const mockResponse = makeResponse("stop");

    result.push(makeEvent("x"));
    result.complete(mockResponse);

    const response = await result.response;

    expect(response).toBe(mockResponse);
  });

  it("abort rejects the response promise", async () => {
    const result = new StreamResult();
    const error = new Error("provider error");

    result.push(makeEvent("partial"));
    result.abort(error);

    await expect(result.response).rejects.toThrow("provider error");
  });

  it("then drains events when awaited directly without a consumer", async () => {
    const result = new StreamResult();

    // Push several events - these need to be drained for the stream to complete
    result.push(makeEvent("a"));
    result.push(makeEvent("b"));
    result.push(makeEvent("c"));
    result.complete(makeResponse());

    // Await directly (uses .then) - should drain events internally
    const response = await result;

    expect(response).toBeDefined();
    expect((response as unknown as { stopReason: string }).stopReason).toBe("end_turn");
  });
});
