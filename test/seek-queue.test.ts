import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { SEEK_QUEUE_JS } from "../src/ui/seek-queue";

type SeekQueue = {
  nudge(deltaSec: number, currentSec: number, durationSec: number): number;
  pending(): number | null;
  cancel(): void;
};

function setup(delayMs = 400) {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sent: number[] = [];
  const context = createContext({
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    }
  });
  runInContext(SEEK_QUEUE_JS, context);
  const create = runInContext("createSeekQueue", context) as (opts: { delayMs: number; send: (sec: number) => void }) => SeekQueue;
  const queue = create({ delayMs, send: (sec) => sent.push(sec) });
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= now && timers.has(id)) {
        timers.delete(id);
        timer.fn();
      }
    }
  };
  return { queue, sent, advance };
}

test("three quick nudges collapse into one send at start + 30", () => {
  const { queue, sent, advance } = setup();
  assert.equal(queue.nudge(10, 100, 600), 110);
  advance(200);
  assert.equal(queue.nudge(10, 100, 600), 120);
  advance(200);
  assert.equal(queue.nudge(10, 100, 600), 130);
  assert.equal(queue.pending(), 130);
  advance(399);
  assert.deepEqual(sent, []);
  advance(1);
  assert.deepEqual(sent, [130]);
  assert.equal(queue.pending(), null);
  advance(5000);
  assert.deepEqual(sent, [130]);
});

test("target is clamped to [0, duration]", () => {
  const { queue, sent, advance } = setup();
  assert.equal(queue.nudge(-10, 4, 600), 0);
  assert.equal(queue.nudge(-10, 4, 600), 0);
  advance(400);
  assert.deepEqual(sent, [0]);
  assert.equal(queue.nudge(10, 595, 600), 600);
  advance(400);
  assert.deepEqual(sent, [0, 600]);
});

test("a nudge after the send starts from currentSec again", () => {
  const { queue, sent, advance } = setup();
  queue.nudge(10, 100, 600);
  advance(400);
  assert.deepEqual(sent, [110]);
  assert.equal(queue.nudge(-10, 50, 600), 40);
  advance(400);
  assert.deepEqual(sent, [110, 40]);
});

test("cancel prevents the pending send", () => {
  const { queue, sent, advance } = setup();
  queue.nudge(10, 100, 600);
  queue.cancel();
  assert.equal(queue.pending(), null);
  advance(1000);
  assert.deepEqual(sent, []);
});
