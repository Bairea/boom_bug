import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../src/ui/editor.js';

// R68: 编辑器点击拾取半径 5→12 —— 配件/删除/连绳不必点正中心（玩家反馈）
const RECT = { left: 100, top: 50, width: 900, height: 540 };
function fakeCanvas() {
  const listeners = {};
  return {
    width: 960,
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] ?? []).push(fn);
    },
    getBoundingClientRect: () => RECT,
    __fire(type, ev) {
      for (const fn of listeners[type] ?? []) fn(ev);
    },
  };
}
const CX = (wx) => RECT.left + (wx / 300) * RECT.width;
const CY = (wy) => RECT.top + (wy / 180) * RECT.height;
const pev = (wx, wy) => ({ clientX: CX(wx), clientY: CY(wy), button: 0 });

test('hitSpec: 偏 10px 仍命中（旧半径 5 会漏），偏 20px 不命中', () => {
  const ed = new Editor(fakeCanvas());
  ed.addSpec('firecracker', 150, 90);
  assert.equal(ed.hitSpec(160, 90), 0, '偏 10px 应命中');
  assert.equal(ed.hitSpec(170, 90), null, '偏 20px 不应命中');
});

test('删除：偏 10px 点击也能移除物体', () => {
  const ed = new Editor(fakeCanvas());
  ed.addSpec('roach', 60, 90);
  ed.tool = 'eraser';
  ed._down(pev(70, 90));
  assert.equal(ed.specs.length, 0, '偏 10px 的删除应生效');
});

test('配件安装：偏 10px 点击爆炸物也能装上牙签', () => {
  const ed = new Editor(fakeCanvas());
  ed.addSpec('firecracker', 200, 90);
  ed.tool = 'toothpick';
  ed._down(pev(190, 90));
  assert.deepEqual(ed.specs[0].acc, ['toothpick'], '牙签应装上');
});

test('绳子连接：偏 10px 依次点击两物可连接', () => {
  const ed = new Editor(fakeCanvas());
  ed.addSpec('firecracker', 100, 90);
  ed.addSpec('firecracker', 200, 90);
  ed.tool = 'rope';
  ed._down(pev(90, 90));
  ed._down(pev(210, 90));
  assert.equal(ed.ropeList.length, 1, '绳子应连上');
  assert.deepEqual(ed.ropeList[0], { a: 0, b: 1 });
});
