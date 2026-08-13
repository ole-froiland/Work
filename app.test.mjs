import test from 'node:test';
import assert from 'node:assert/strict';

import { formatTime, nextQueuePhase, totalQueueMinutes } from './app.js';

test('formats timer values', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(65), '01:05');
  assert.equal(formatTime(45 * 60), '45:00');
});

test('moves from a task to a break and then to the next task', () => {
  assert.deepEqual(nextQueuePhase('work', 0, 3), { phase: 'break', taskIndex: 0 });
  assert.deepEqual(nextQueuePhase('break', 0, 3), { phase: 'work', taskIndex: 1 });
});

test('finishes directly after the final task', () => {
  assert.deepEqual(nextQueuePhase('work', 2, 3), { phase: 'done', taskIndex: 2 });
  assert.deepEqual(nextQueuePhase('work', 0, 1), { phase: 'done', taskIndex: 0 });
});

test('adds different task durations and only pauses between tasks', () => {
  const tasks = [{ minutes: 15 }, { minutes: 45 }, { minutes: 20 }];
  assert.equal(totalQueueMinutes(tasks, 5), 90);
  assert.equal(totalQueueMinutes([{ minutes: 30 }], 10), 30);
  assert.equal(totalQueueMinutes([], 5), 0);
});
