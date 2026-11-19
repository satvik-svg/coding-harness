import { DockerManager } from '../sandbox/dockerManager';
import { logger } from '../logger';

interface ActiveTaskEntry {
  controller: AbortController;
  containerId?: string;
  cancelHandlers: Array<() => Promise<void> | void>;
}

const activeTasks = new Map<string, ActiveTaskEntry>();
const cancelledTasks = new Set<string>();

/**
 * Registers an executing task so it can be cancelled mid-flight.
 */
export function registerActiveTask(taskId: string) {
  const controller = new AbortController();
  const entry: ActiveTaskEntry = {
    controller,
    cancelHandlers: [],
  };
  activeTasks.set(taskId, entry);

  // If cancel was requested while the job was transitioning from queued to running
  if (cancelledTasks.has(taskId)) {
    controller.abort();
  }

  return {
    signal: controller.signal,
    setContainerId(containerId: string) {
      entry.containerId = containerId;
    },
    onCancel(handler: () => Promise<void> | void) {
      entry.cancelHandlers.push(handler);
      if (controller.signal.aborted) {
        void Promise.resolve(handler()).catch(() => {});
      }
    },
  };
}

/**
 * Cleans up tracking references after a task completes, fails, or cancels.
 */
export function unregisterActiveTask(taskId: string): void {
  activeTasks.delete(taskId);
  cancelledTasks.delete(taskId);
}

/**
 * Checks whether a task has been flagged as cancelled.
 */
export function isTaskCancelled(taskId: string): boolean {
  return cancelledTasks.has(taskId) || Boolean(activeTasks.get(taskId)?.controller.signal.aborted);
}

/**
 * Signals cancellation for a running or queued task, terminating child processes
 * and stopping/removing any running Docker sandbox container.
 */
export async function cancelActiveTask(taskId: string): Promise<boolean> {
  cancelledTasks.add(taskId);
  const entry = activeTasks.get(taskId);
  if (!entry) {
    return false;
  }

  logger.info(`Cancelling active task ${taskId}...`);
  entry.controller.abort();

  for (const handler of entry.cancelHandlers) {
    try {
      await handler();
    } catch (err) {
      logger.warn(`Cancel handler error for task ${taskId}:`, err);
    }
  }

  if (entry.containerId) {
    const cid = entry.containerId;
    entry.containerId = undefined;
    try {
      await DockerManager.stopAndRemoveContainer(cid);
    } catch (err) {
      logger.warn(`Failed stopping container ${cid} during cancel:`, err);
    }
  }

  return true;
}
