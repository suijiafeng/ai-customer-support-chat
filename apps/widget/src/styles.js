export default `
.afw { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
.fab { width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
  background: #2457c5; color: #fff; font-size: 22px; box-shadow: 0 6px 18px rgba(0,0,0,.25); }
.panel { position: absolute; right: 0; bottom: 70px; width: 340px; height: 480px;
  background: #fff; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.22);
  display: flex; flex-direction: column; overflow: hidden; }
.head { background: #2457c5; color: #fff; padding: 12px 14px; font-weight: 600;
  display: flex; justify-content: space-between; align-items: center; }
.x { background: transparent; border: none; color: #fff; font-size: 20px; cursor: pointer; }
.list { flex: 1; overflow-y: auto; padding: 12px; background: #f5f7fb; }
.hint { color: #888; font-size: 13px; text-align: center; margin: 16px 8px; }
.row { display: flex; margin: 6px 0; }
.row.customer { justify-content: flex-end; }
.bubble { max-width: 78%; padding: 8px 11px; border-radius: 12px; font-size: 14px;
  line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.customer .bubble { background: #2457c5; color: #fff; border-bottom-right-radius: 4px; }
.ai .bubble, .agent .bubble { background: #fff; color: #222; border: 1px solid #e4e8f0; border-bottom-left-radius: 4px; }
.agent .bubble { border-color: #2f855a; }
.system .bubble { background: #fff7e6; color: #ad6800; font-size: 12px; margin: 0 auto; }
.typing { color: #999; }
.inputbar { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #eee; }
textarea { flex: 1; resize: none; border: 1px solid #d9dde6; border-radius: 8px;
  padding: 8px; font-size: 14px; outline: none; font-family: inherit; }
.send { border: none; background: #2457c5; color: #fff; border-radius: 8px;
  padding: 0 16px; cursor: pointer; }
.send:disabled { opacity: .5; cursor: not-allowed; }
`;
