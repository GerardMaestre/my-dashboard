const logger = require('../utils/logger');

class TaskQueue {
    constructor() {
        this.queue = [];
        this.running = false;
        this.currentTask = null;
    }

    /**
     * @param {string} id - Unique ID for the task
     * @param {Function} taskFn - An async function that runs the logic (returns {ok, message})
     * @param {object} meta - Additional metadata
     */
    enqueue(id, taskFn, meta = {}) {
        if (this.queue.some(t => t.id === id)) {
            logger.warn(`[Queue] Task ${id} is already in the queue. Skipping duplicate enqueuing.`);
            return;
        }

        this.queue.push({ id, taskFn, meta, addedAt: new Date() });
        logger.info(`[Queue] Task enqueued: ${id} (Total: ${this.queue.length})`);
        
        if (!this.running) {
            this.runNext();
        }
    }

    async runNext() {
        if (this.queue.length === 0) {
            this.running = false;
            this.currentTask = null;
            logger.info('[Queue] All tasks completed.');
            return;
        }

        this.running = true;
        this.currentTask = this.queue.shift();
        
        logger.info(`[Queue] Running task: ${this.currentTask.id}`);

        try {
            const startTime = Date.now();
            const result = await this.currentTask.taskFn();
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);

            if (result && result.ok) {
                logger.info(`[Queue] Task ${this.currentTask.id} finished successfully in ${duration}s: ${result.message || 'success'}`);
            } else {
                logger.warn(`[Queue] Task ${this.currentTask.id} failed in ${duration}s: ${result ? result.message : 'no result'}`);
            }
        } catch (e) {
            logger.error(`[Queue] Critical error in task ${this.currentTask.id}: ${e.message}`);
        }

        // Wait a small bit before the next task to normalize CPU
        setTimeout(() => this.runNext(), 1000);
    }

    getStatus() {
        return {
            running: this.running,
            current: this.currentTask ? { id: this.currentTask.id, meta: this.currentTask.meta } : null,
            pending: this.queue.map(t => ({ id: t.id, meta: t.meta }))
        };
    }
}

const taskQueue = new TaskQueue();
module.exports = taskQueue;
