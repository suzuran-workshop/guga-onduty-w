/**
 * SSE 事件总线 —— 进程内 EventEmitter 单例（类型化）。
 *
 * 修复现有缺陷：
 *  - 旧代码 record_revoked 事件从未 emit（SSE 撤回推送是死代码）→ records-repo.revoke 后由路由 emit。
 *  - 事件名/载荷类型化（旧代码约定式无类型）。
 *
 * 边界（保留现状，非本次范围）：进程内单例，多实例部署需改 Redis Pub/Sub（见 ARCHITECTURE）。
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

class TypedEventBus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(200);
  }
  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    this.emitter.emit(event, payload);
  }
  on<K extends EventName>(event: K, listener: (payload: EventMap[K]) => void): void {
    this.emitter.on(event, listener as (...args: any[]) => void);
  }
  off<K extends EventName>(event: K, listener: (payload: EventMap[K]) => void): void {
    this.emitter.off(event, listener as (...args: any[]) => void);
  }
}

export const EventBus = new TypedEventBus();
