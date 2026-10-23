/**
 * SSE 事件总线 —— 进程内 EventEmitter 单例（类型化）。
 *
 * 修复现有缺陷：
 *  - 旧代码 record_revoked 事件从未 emit（SSE 撤回推送是死代码）→ records-repo.revoke 后由路由 emit。
 *  - 事件名/载荷类型化（旧代码约定式无类型）。
 *  - 2026-10-23：**listener 错误隔离**。原生 EventEmitter 的 emit 是同步的，listener 抛错会
 *    冒泡到 emit 调用方——钉钉推送 listener 一旦抛错就会 500 掉「创建记录」请求
 *    （推送失败绝不能影响打分主链路）。故 emit 内逐个 try/catch，并对返回 thenable 的
 *    listener 挂 .catch（异步拒绝不会变成 unhandledRejection 崩进程）。
 *
 * 边界（保留现状，非本次范围）：进程内单例，多实例部署需改 Redis Pub/Sub（见 ARCHITECTURE）。
 * ⚠ 多实例会重复推送（比 SSE 重复更严重）——见 services/notify.ts 的幂等说明。
 */
import { EventEmitter } from 'node:events';
import type { RecordCreatedEvent } from '@guga-onduty-w/shared';

// 再导出，让消费方（sse.ts）从一处拿全部事件载荷类型
export type { RecordCreatedEvent };

/** 撤回事件载荷（与 created 对称） */
export interface RecordRevokedEvent {
  recordId: string;
  campusId: string;
  timestamp: number;
}

export interface EventMap {
  record_created: RecordCreatedEvent;
  record_revoked: RecordRevokedEvent;
}

type EventName = keyof EventMap;

/** listener 抛错时的兜底处理（默认打 stderr；不 rethrow，避免影响 emit 调用方） */
function reportListenerError(event: string, err: unknown): void {
  // 此处不能用业务 logger（EventBus 是零依赖单例），走 console.error 即可
  console.error(`[event-bus] listener for "${event}" threw:`, err);
}

class TypedEventBus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(200);
  }
  /**
   * 发布事件。**listener 的错误被隔离**，不会冒泡到调用方。
   * 返回值仍是 void（fire-and-forget 语义）：需要等待结果的场景不该走事件总线。
   */
  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    for (const listener of this.emitter.listeners(event)) {
      try {
        const result = (listener as (p: EventMap[K]) => unknown)(payload);
        // 异步 listener（如钉钉推送）：挂 catch，防 unhandledRejection
        if (result instanceof Promise) {
          result.catch((err) => reportListenerError(event, err));
        }
      } catch (err) {
        reportListenerError(event, err);
      }
    }
  }
  on<K extends EventName>(event: K, listener: (payload: EventMap[K]) => void | Promise<void>): void {
    this.emitter.on(event, listener as (...args: any[]) => void);
  }
  off<K extends EventName>(event: K, listener: (payload: EventMap[K]) => void | Promise<void>): void {
    this.emitter.off(event, listener as (...args: any[]) => void);
  }
}

export const EventBus = new TypedEventBus();
