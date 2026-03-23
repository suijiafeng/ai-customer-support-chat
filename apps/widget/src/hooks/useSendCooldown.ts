import { useCallback, useEffect, useRef, useState } from 'react';

// 前端限流：10 秒滑动窗口内最多 5 条（与服务端一致），超限先本地拦截并倒计时
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10000;

/** 发送限流与冷却倒计时：前端先拦截，服务端限流（429）作为最后一道防线。 */
export function useSendCooldown() {
  const [cooldown, setCooldown] = useState(0); // 限流倒计时（秒）：>0 时禁止发送
  const sendTimesRef = useRef<number[]>([]); // 最近发送时间戳：前端限流计数
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 启动/刷新限流倒计时：每秒递减，到 0 自动清除
  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
          sendTimesRef.current = []; // 倒计时结束：重置计数，可继续发送
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  // 发送前置检查：超限返回 false（保留输入框内容、不发请求，只给倒计时）；
  // 未超限则记录本次发送时间戳并返回 true。
  const checkRateLimit = useCallback(() => {
    const nowTs = Date.now();
    const recent = sendTimesRef.current.filter((t) => nowTs - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      sendTimesRef.current = recent;
      if (!cooldownTimerRef.current) {
        startCooldown(Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (nowTs - recent[0])) / 1000)));
      }
      return false;
    }
    sendTimesRef.current = [...recent, nowTs];
    return true;
  }, [startCooldown]);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  return { cooldown, checkRateLimit, startCooldown };
}
