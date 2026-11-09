import { Inject, Injectable, Logger } from '@nestjs/common';

import { describeError } from '../logging/describe-error.js';
import type { WorkerLoop } from '../roles/role.js';
import { CallbackService } from './callbacks.js';
import { ExpanderService } from './expander.js';
import { PlannerService } from './planner.js';
import { DeliveryWorker } from './processor.js';
import { DELIVERY_SETTINGS, type DeliverySettings } from './settings.js';

/** How much one tick did, per phase. */
export interface TickResult {
  expanded: number;
  planned: number;
  deliveries: number;
  callbacks: number;
}

/**
 * The worker role's loop (KTD4): each tick expands accepted notifications, plans their recipients, works due
 * deliveries and sends due failure callbacks, a small batch of each. It polls again at once while a phase fills its
 * batch, otherwise after NOTIFICATION_WORKER_POLL_MS. Draining stops new ticks and waits for the current one.
 */
@Injectable()
export class DeliveryLoop implements WorkerLoop {
  private readonly logger = new Logger(DeliveryLoop.name);
  private readonly expander: ExpanderService;
  private readonly planner: PlannerService;
  private readonly worker: DeliveryWorker;
  private readonly callbacks: CallbackService;
  private readonly settings: DeliverySettings;
  private timer: NodeJS.Timeout | undefined;
  private current: Promise<void> | undefined;
  private stopped = true;

  constructor(
    @Inject(ExpanderService) expander: ExpanderService,
    @Inject(PlannerService) planner: PlannerService,
    @Inject(DeliveryWorker) worker: DeliveryWorker,
    @Inject(CallbackService) callbacks: CallbackService,
    @Inject(DELIVERY_SETTINGS) settings: DeliverySettings,
  ) {
    this.expander = expander;
    this.planner = planner;
    this.worker = worker;
    this.callbacks = callbacks;
    this.settings = settings;
  }

  start(): void {
    this.stopped = false;
    this.schedule(this.settings.pollIntervalMs);
  }

  async drain(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.current;
  }

  /** One pass over every phase. Each phase feeds the next, so they run in order. */
  async tick(): Promise<TickResult> {
    const expanded = await this.expander.expandBatch();
    const planned = await this.planner.planBatch();
    const deliveries = await this.worker.deliverBatch();
    const callbacks = await this.callbacks.sendBatch();
    return { expanded, planned, deliveries, callbacks };
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.current = this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    let busy = false;
    try {
      const done = await this.tick();
      busy = Object.values(done).some((count) => count >= this.settings.batchSize);
    } catch (error) {
      this.logger.error({ msg: 'A delivery worker tick failed', error: describeError(error) });
    } finally {
      this.current = undefined;
      this.schedule(busy ? 0 : this.settings.pollIntervalMs);
    }
  }
}
