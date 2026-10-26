import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

/**
 * 这里刻意**不包 StrictMode**。
 * StrictMode 在开发模式下会把组件挂载两次，而「开始质询」是一次有副作用的 POST
 * （同一会话只能跑一次，第二次会被后端按 409 挡回来）。
 * 与其在业务代码里到处写「已发过请求」的守卫，不如老老实实只挂载一次。
 */
const host = document.getElementById('root');
if (host === null) {
  throw new Error('页面缺少 #root 挂载点');
}

createRoot(host).render(<App />);
