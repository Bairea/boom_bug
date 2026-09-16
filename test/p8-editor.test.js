import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../src/ui/editor.js';

// 假画布：记录监听器，提供固定 rect
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

// 世界坐标 → 伪客户端坐标
const CX = (wx) => RECT.left + (wx / 300) * RECT.width;
const CY = (wy) => RECT.top + (wy / 180) * RECT.height;
const pev = (wx, wy) => ({ clientX: CX(wx), clientY: CY(wy), button: 0 });

function setup() {
  const canvas = fakeCanvas();
  const ed = new Editor(canvas);
  return { canvas, ed };
}

test('编辑器: 点击放置虫子/砖块，kind 与 fixed 正确（R1 回归）', () => {
  const { ed } = setup();
  ed.tool = 'scarab';
  ed._down(pev(150, 170));
  ed.tool = 'roach';
  ed._down(pev(60, 175));
  ed.tool = 'brick';
  ed._down(pev(220, 168));
  ed.tool = 'firecracker';
  ed._down(pev(100, 176));
  const s = ed.specs;
  assert.equal(s.length, 4);
  assert.equal(s[0].kind, 'bug');
  assert.equal(s[0].fixed, true, '清道夫点击摆放必须继承固定勾选');
  assert.equal(s[1].kind, 'bug');
  assert.equal(s[2].kind, 'prop');
  assert.equal(s[3].kind, 'explosive');
});

test('编辑器: 窜天猴拖拽放置并瞄准', () => {
  const { ed } = setup();
  ed.tool = 'bottle';
  ed._down(pev(80, 130));
  ed._move(pev(140, 145));
  ed._up(pev(140, 145));
  assert.equal(ed.specs.length, 1);
  const b = ed.specs[0];
  assert.equal(b.t, 'bottle');
  assert.ok(Math.abs(b.angle - Math.atan2(15, 60)) < 0.01, `angle=${b.angle}`);
});

test('编辑器: 冲天炮拖拽瞄准被限制在竖直±25°', () => {
  const { ed } = setup();
  ed.tool = 'skyrocket';
  ed._down(pev(150, 170));
  ed._move(pev(150, 60)); // 想往正上
  ed._move(pev(230, 90)); // 想往右上很远（应被夹住）
  ed._up();
  const s = ed.specs[0];
  const UP = -Math.PI / 2;
  assert.ok(s.angle >= UP - 0.441 && s.angle <= UP + 0.441, `angle=${s.angle}`);
});

test('编辑器: 点中已放置的窜天猴进入重新瞄准（不新增）', () => {
  const { ed } = setup();
  ed.tool = 'bottle';
  ed._down(pev(80, 130));
  ed._move(pev(140, 145));
  ed._up();
  const n = ed.specs.length;
  const before = ed.specs[0].angle;
  // 再点它（同款工具）→ 拖到另一个方向
  ed._down(pev(80, 130));
  assert.equal(ed.specs.length, n, '不应新增');
  ed._move(pev(120, 80)); // 拖向上方
  ed._up();
  assert.notEqual(ed.specs[0].angle, before);
  assert.ok(ed.specs[0].angle < 0, '新朝向应指向上方');
});

test('编辑器: 配件安装/拆除有反馈且数量受限', () => {
  const { ed } = setup();
  const msgs = [];
  ed.onStatus = (m) => msgs.push(m);
  ed.tool = 'bottle';
  ed._down(pev(80, 130));
  ed._up();
  ed.tool = 'pin';
  ed._down(pev(80, 130));
  assert.deepEqual(ed.specs[0].acc, ['pin']);
  assert.ok(
    msgs.some((m) => m.includes('大头针') && m.includes('装上')),
    '应有安装反馈',
  );
  ed.tool = 'glue';
  ed._down(pev(80, 130));
  ed.tool = 'toothpick';
  ed._down(pev(80, 130));
  assert.equal(ed.specs[0].acc.length, 2, '最多2个配件');
  const lastMsg = msgs[msgs.length - 1];
  assert.ok(lastMsg.includes('最多'), '应提示上限');
  ed.tool = 'pin';
  ed._down(pev(80, 130)); // 再点一次拆除
  assert.deepEqual(ed.specs[0].acc, ['glue']);
  assert.ok(msgs.some((m) => m.includes('拆除')));
});

test('编辑器: 删除工具移除实体并重接绳子索引', () => {
  const { ed } = setup();
  ed.addSpec('bottle', 60, 100, { angle: 0 });
  ed.addSpec('roach', 90, 176);
  ed.addSpec('bottle', 120, 100, { angle: 0 });
  ed.ropeList.push({ a: 0, b: 2 }, { a: 1, b: 2 });
  ed.tool = 'eraser';
  ed._down(pev(90, 176)); // 删掉中间的蟑螂(idx1)
  assert.equal(ed.specs.length, 2);
  // 挂在被删实体上的绳消失；不涉删除的绳重接索引 [0,2]→[0,1]
  assert.deepEqual(ed.ropeList, [{ a: 0, b: 1 }]);
});

test('编辑器: 数量上限拦截', () => {
  const { ed } = setup();
  ed.tool = 'bottle';
  for (let i = 0; i < 8; i++) {
    ed._down(pev(30 + i * 30, 100));
    ed._up();
  }
  ed._down(pev(280, 100));
  ed._up();
  assert.equal(ed.specs.length, 8);
});
