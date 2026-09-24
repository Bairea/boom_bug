# 视觉与动画升级清单（2026-09-19 夜间→晨间 · R89–R295，终巡检收官）

> 应目标「界面和动画太差劲，调研 skill 提升并持续迭代到早 9 点」而生。
> 全程模拟层零改动，确定性不受影响；每轮 npm test 全绿 + 实机截图验证。

## 调研结论

| 技能 | 安装量 | 采纳点 |
| --- | --- | --- |
| game-feel（gamedev-skills） | 4.3K | trauma² 震屏、hit-stop 顿帧、squash & stretch、反馈分级 |
| web-design-guidelines（Vercel） | 646K | 焦点可见、显式 transition 属性、reduced-motion、select 配色 |
| canvas-design（Anthropic） | 108K | 加法混合辉光、预渲染精灵、做减法的 second pass |
| animation-principles（dylantarre） | 889 | 迪士尼十二法则在游戏中的应用 |

网络调研补充：`globalCompositeOperation='lighter'` 加法混合、预渲染辉光精灵替代 shadowBlur、双层 canvas 合成。

## 视觉升级

- **场景氛围**：分层桌面（渐变+台灯辉光+暗角）、玻璃盒质感、金属边框+螺丝、双层软阴影
- **辉光粒子**：三层爆闪、双描边冲击环、渐冷火花、余烬、纸屑、水花、冰霜、扬尘、彩带雨
- **物件美术**：全部物件渐变/高光/倒角重绘；虫虫 idle 生命感；引信越烧越短
- **手感 juice**：trauma² 震屏（+滚转+方向性推镜）、大威力顿帧、全屏白闪（连锁防过曝）、
  squash & stretch（着陆/击倒/裂甲/起跳）、时间涟漪双环、镜头向爆心缓推
- **界面 chrome**：渐变标题、统一按钮体系、玻璃拟态胶囊与 HUD、报告卡级联入场+滚动计数、
  时间线深度着色、模式指示点、全屏模式（⛶/F）

## 真问题修复（夜间发现）

1. 气球渲染位置加倍（drawItem 双重位移）—— R91
2. 状态胶囊过期文案（实验结束后仍显示"进行中"）—— R143
3. 着陆检测从未触发（fx.observe 读 vy 而视图字段是 speedY）—— R212
4. DPR 逻辑尺寸错乱（canvas.width 放大后 W/H 未除回）—— R157

## 无障碍

- `prefers-reduced-motion` 全链路（震屏/白闪降压、跳过顿帧/彩带/颗粒动画）
- 图标按钮 aria-label、静音 aria-pressed、help/report dialog 语义、画布 role=img
- 复选框/输入焦点环修复、场景下拉选项显式配色（Windows 深色模式）

## 质量证据

- 152 个无头测试全绿（新增 7 条视觉回归）
- 0.4–0.5ms/帧 渲染（60fps 预算的 1/30+）
- 全场景快进 soak ×3、混合交互 soak、18 局随机点击 soak —— 均 0 JS 错误
- 终巡检（08:30）：10 场景 report/replay soak 零 JS 错误；确定性核心零改动（同种子同操作=同灾难 ✓）—— 视觉与动画大翻新交付完成（R296–R299 为回归 soak 与文档收尾）
