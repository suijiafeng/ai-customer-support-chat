// 演示站的展示数据：只在前端使用，不进入后端，与真实功能数据隔离。

export interface DemoEntry {
  number: string;
  title: string;
  description: string;
  path: string;
  secondary?: boolean;
}

export const DEMO_ENTRIES: DemoEntry[] = [
  {
    number: '01',
    title: '访客端',
    description: '嵌入式 Widget 演示，访客从这里发送消息。',
    path: '/embed/',
  },
  {
    number: '02',
    title: '客服端',
    description: '会话工作台演示，客服从这里查看并回复消息。',
    path: '/workstation/',
    secondary: true,
  },
];

export const DEMO_STEPS = [
  { text: '打开访客端并发送一条消息', linkText: '访客端', path: '/embed/' },
  { text: '打开客服端并选择新会话', linkText: '客服端', path: '/workstation/' },
  { text: '回复消息，返回访客端查看同步结果', linkText: '访客端', path: '/embed/' },
];
