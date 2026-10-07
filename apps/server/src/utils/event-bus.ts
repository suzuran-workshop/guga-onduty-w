import { EventEmitter } from 'node:events';

export const EventBus = new EventEmitter();
EventBus.setMaxListeners(100);